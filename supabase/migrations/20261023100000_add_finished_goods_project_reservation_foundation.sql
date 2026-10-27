-- Phase 3A is NON-EXECUTABLE for application roles. Phase 3B must protect every
-- warehouse debit, demand edit, and Project lifecycle path before granting either
-- mutation RPC. No baseline reservation or physical Inventory change is performed.
insert into public.permission_definitions (key, module, label, description, is_delegable)
values ('inventory.finished_goods.reserve', 'inventory', 'Reserve Finished Goods for Projects',
  'Dedicated reservation capability; application mutations remain disabled until debit protection is deployed.', true);

create table public.finished_goods_project_reservations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  warehouse_id uuid not null default '10000000-0000-4000-8000-000000000002'
    references public.inventory_warehouses(id) on delete restrict,
  reserved_quantity bigint not null check (reserved_quantity >= 0),
  version bigint not null check (version > 0),
  created_at timestamptz not null,
  created_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  updated_at timestamptz not null,
  updated_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  unique (project_id, product_id),
  check (warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid)
);
create index finished_goods_project_reservations_product_idx
  on public.finished_goods_project_reservations (product_id, project_id)
  where reserved_quantity > 0;

create table public.finished_goods_project_reservation_events (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.finished_goods_project_reservations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  event_type text not null check (event_type in ('reserved', 'released')),
  quantity_before bigint not null check (quantity_before >= 0),
  quantity_after bigint not null check (quantity_after >= 0),
  reservation_version bigint not null check (reservation_version > 0),
  request_id uuid not null unique,
  actor_user_id uuid not null references public.user_profiles(id) on delete restrict,
  requested_quantity bigint not null check (requested_quantity > 0),
  expected_version bigint not null check (expected_version >= 0),
  created_at timestamptz not null,
  unique (reservation_id, reservation_version),
  check ((event_type = 'reserved' and quantity_after::numeric = quantity_before::numeric + requested_quantity::numeric)
      or (event_type = 'released' and quantity_after::numeric = quantity_before::numeric - requested_quantity::numeric))
);

alter table public.finished_goods_project_reservations enable row level security;
alter table public.finished_goods_project_reservation_events enable row level security;
-- No direct table privileges, including for service_role. Reads use trusted RPCs.
revoke all on public.finished_goods_project_reservations,
  public.finished_goods_project_reservation_events from public, anon, authenticated, service_role;

create function public.enforce_finished_goods_reservation_history()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if tg_table_name = 'finished_goods_project_reservation_events' or tg_op = 'DELETE' then
    raise exception 'Reservation history is immutable' using errcode = '55000';
  end if;
  if (pg_catalog.to_jsonb(new) - array['reserved_quantity','version','updated_at','updated_by_user_id'])
    is distinct from
    (pg_catalog.to_jsonb(old) - array['reserved_quantity','version','updated_at','updated_by_user_id'])
    or new.version <> old.version + 1
    or new.reserved_quantity = old.reserved_quantity
  then
    raise exception 'Invalid reservation state transition' using errcode = '55000';
  end if;
  return new;
end;
$function$;
create trigger finished_goods_reservations_preserve_identity
before update or delete on public.finished_goods_project_reservations
for each row execute function public.enforce_finished_goods_reservation_history();
create trigger finished_goods_reservation_events_immutable
before update or delete on public.finished_goods_project_reservation_events
for each row execute function public.enforce_finished_goods_reservation_history();
revoke all on function public.enforce_finished_goods_reservation_history()
  from public, anon, authenticated, service_role;

-- Private algorithm, exercised only by the database-owner local test harness.
-- Existing application/Edge functions do not call it. No role gets EXECUTE here.
create function public.change_finished_goods_project_reservation(
  p_project_id uuid, p_product_id uuid, p_quantity bigint,
  p_expected_version bigint, p_request_id uuid, p_release boolean
)
returns table (reservation_id uuid, project_id uuid, product_id uuid,
  reserved_quantity bigint, reservation_version bigint, event_id uuid)
language plpgsql volatile security definer set search_path = '' as $function$
declare
  actor_id uuid;
  current_state public.finished_goods_project_reservations%rowtype;
  receipt public.finished_goods_project_reservation_events%rowtype;
  current_status text;
  active_product boolean;
  physical_quantity bigint;
  demand numeric;
  total_reserved numeric;
  before_quantity bigint;
  after_quantity bigint;
  next_version bigint;
  recorded_at timestamptz;
  event_kind text;
begin
  actor_id := public.current_active_user_profile_id();
  if actor_id is null or not (public.current_user_is_admin() or (
    public.has_permission('projects.view') and public.has_permission('projects.edit')
    and public.has_permission('inventory.finished_goods.view')
    and public.has_permission('inventory.finished_goods.reserve')
  )) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_project_id is null or p_product_id is null or p_quantity is null or p_quantity <= 0
    or p_expected_version is null or p_expected_version < 0
    or p_request_id is null or p_release is null then
    raise exception 'Valid reservation parameters are required' using errcode = '22023';
  end if;
  event_kind := case when p_release then 'released' else 'reserved' end;
  -- Serializes even absent receipts; collisions serialize but never change identity.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  if public.current_active_user_profile_id() is distinct from actor_id or not (
    public.current_user_is_admin() or (public.has_permission('projects.view')
      and public.has_permission('projects.edit') and public.has_permission('inventory.finished_goods.view')
      and public.has_permission('inventory.finished_goods.reserve'))
  ) then raise exception 'Access denied' using errcode = '42501'; end if;
  select event.* into receipt from public.finished_goods_project_reservation_events event
    where event.request_id = p_request_id;
  if found then
    if receipt.actor_user_id <> actor_id then
      raise exception 'Access denied' using errcode = '42501';
    end if;
    if receipt.project_id <> p_project_id or receipt.product_id <> p_product_id
      or receipt.requested_quantity <> p_quantity or receipt.expected_version <> p_expected_version
      or receipt.event_type <> event_kind then
      raise exception 'Reservation request does not match its original operation' using errcode = 'FGR01';
    end if;
    return query select receipt.reservation_id, receipt.project_id, receipt.product_id,
      receipt.quantity_after, receipt.reservation_version, receipt.id;
    return;
  end if;
  select project.status into current_status from public.projects project
    where project.id = p_project_id for update;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if current_status not in ('planned','in_progress','on_hold') then
    raise exception 'Project is closed for reservations' using errcode = 'FGR02';
  end if;
  select product.is_active into active_product from public.products product
    where product.id = p_product_id and product.product_kind = 'pcb_finished_good'
      and exists (select 1 from public.pcb_cards card where card.output_product_id = product.id)
    for share;
  if not found or (not p_release and not active_product) then
    raise exception 'Finished Product is unavailable' using errcode = 'FGR03';
  end if;
  -- One FG balance lock serializes competing Projects reserving the same Product.
  select balance.quantity into physical_quantity from public.inventory_balances balance
    where balance.product_id = p_product_id
      and balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid for update;
  if not found then raise exception 'Finished Goods balance not found' using errcode = 'FGR03'; end if;
  -- Recheck authorization after waiting on locks.
  if public.current_active_user_profile_id() is distinct from actor_id or not (
    public.current_user_is_admin() or (public.has_permission('projects.view')
      and public.has_permission('projects.edit') and public.has_permission('inventory.finished_goods.view')
      and public.has_permission('inventory.finished_goods.reserve'))
  ) then raise exception 'Access denied' using errcode = '42501'; end if;
  select state.* into current_state from public.finished_goods_project_reservations state
    where state.project_id = p_project_id and state.product_id = p_product_id for update;
  if coalesce(current_state.version, 0) <> p_expected_version then
    raise exception 'Reservation version is stale' using errcode = 'FGR04';
  end if;
  before_quantity := coalesce(current_state.reserved_quantity, 0);
  if p_release then
    if p_quantity > before_quantity then
      raise exception 'Release exceeds reserved quantity' using errcode = 'FGR05';
    end if;
    after_quantity := before_quantity - p_quantity;
  else
    select commitment.outstanding_commitment into demand
      from public.calculate_open_project_commitments(p_product_id) commitment
      where commitment.project_id = p_project_id;
    if demand is null or before_quantity::numeric + p_quantity::numeric > demand then
      raise exception 'Reservation exceeds explicit outstanding Product demand' using errcode = 'FGR06';
    end if;
    select coalesce(pg_catalog.sum(state.reserved_quantity::numeric), 0) into total_reserved
      from public.finished_goods_project_reservations state where state.product_id = p_product_id;
    if total_reserved + p_quantity::numeric > physical_quantity::numeric then
      raise exception 'Insufficient unreserved Finished Goods stock' using errcode = 'FGR07';
    end if;
    after_quantity := before_quantity + p_quantity;
  end if;
  next_version := coalesce(current_state.version, 0) + 1;
  recorded_at := pg_catalog.clock_timestamp();
  if current_state.id is null then
    insert into public.finished_goods_project_reservations as state (
      project_id, product_id, reserved_quantity, version, created_at, created_by_user_id,
      updated_at, updated_by_user_id
    ) values (p_project_id, p_product_id, after_quantity, next_version, recorded_at,
      actor_id, recorded_at, actor_id) returning state.* into current_state;
  else
    update public.finished_goods_project_reservations state set reserved_quantity = after_quantity,
      version = next_version, updated_at = recorded_at, updated_by_user_id = actor_id
      where state.id = current_state.id;
  end if;
  insert into public.finished_goods_project_reservation_events as event (
    reservation_id, project_id, product_id, event_type, quantity_before, quantity_after,
    reservation_version, request_id, actor_user_id, requested_quantity, expected_version, created_at
  ) values (current_state.id, p_project_id, p_product_id, event_kind, before_quantity,
    after_quantity, next_version, p_request_id, actor_id, p_quantity, p_expected_version, recorded_at)
    returning event.* into receipt;
  perform public.append_audit_log(
    p_action_type => 'finished_goods_reservation.' || event_kind,
    p_entity_type => 'finished_goods_reservation', p_entity_id => current_state.id,
    p_summary => case when p_release then 'Released Finished Goods Project reservation'
      else 'Reserved Finished Goods for Project' end,
    p_before_data => pg_catalog.jsonb_build_object('reserved_quantity', before_quantity),
    p_after_data => pg_catalog.jsonb_build_object('project_id', p_project_id,
      'product_id', p_product_id, 'reserved_quantity', after_quantity, 'version', next_version)
  );
  return query select current_state.id, p_project_id, p_product_id,
    after_quantity, next_version, receipt.id;
end;
$function$;
revoke all on function public.change_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid,boolean)
  from public, anon, authenticated, service_role;

create function public.reserve_finished_goods_for_project(
  p_project_id uuid, p_product_id uuid, p_quantity bigint, p_expected_version bigint, p_request_id uuid
)
returns table (reservation_id uuid, project_id uuid, product_id uuid,
  reserved_quantity bigint, reservation_version bigint, event_id uuid)
language sql volatile security definer set search_path = '' as $function$
  select * from public.change_finished_goods_project_reservation(
    p_project_id, p_product_id, p_quantity, p_expected_version, p_request_id, false);
$function$;
create function public.release_finished_goods_project_reservation(
  p_project_id uuid, p_product_id uuid, p_quantity bigint, p_expected_version bigint, p_request_id uuid
)
returns table (reservation_id uuid, project_id uuid, product_id uuid,
  reserved_quantity bigint, reservation_version bigint, event_id uuid)
language sql volatile security definer set search_path = '' as $function$
  select * from public.change_finished_goods_project_reservation(
    p_project_id, p_product_id, p_quantity, p_expected_version, p_request_id, true);
$function$;
-- Deliberately NO authenticated/service_role grants. Owner-only local proofs do
-- not imply application access. Only a reviewed Phase 3B migration may enable these.
revoke all on function public.reserve_finished_goods_for_project(uuid,uuid,bigint,bigint,uuid),
  public.release_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid)
  from public, anon, authenticated, service_role;

create function public.list_project_finished_goods_reservations(p_project_id uuid)
returns table (reservation_id uuid, product_id uuid, reserved_quantity bigint,
  reservation_version bigint, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $function$
begin
  if public.current_active_user_profile_id() is null or not (public.current_user_is_admin()
    or (public.has_permission('projects.view') and public.has_permission('inventory.finished_goods.view')))
  then raise exception 'Access denied' using errcode = '42501'; end if;
  if p_project_id is null then raise exception 'Project is required' using errcode = '22023'; end if;
  return query select state.id, state.product_id, state.reserved_quantity, state.version, state.updated_at
    from public.finished_goods_project_reservations state where state.project_id = p_project_id
    order by state.product_id, state.id;
end;
$function$;
create function public.list_project_finished_goods_reservation_events(p_project_id uuid)
returns table (event_id uuid, reservation_id uuid, product_id uuid, event_type text,
  quantity_before bigint, quantity_after bigint, reservation_version bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $function$
begin
  if public.current_active_user_profile_id() is null or not (public.current_user_is_admin()
    or (public.has_permission('projects.view') and public.has_permission('inventory.finished_goods.view')))
  then raise exception 'Access denied' using errcode = '42501'; end if;
  if p_project_id is null then raise exception 'Project is required' using errcode = '22023'; end if;
  return query select event.id, event.reservation_id, event.product_id, event.event_type,
    event.quantity_before, event.quantity_after, event.reservation_version, event.created_at
    from public.finished_goods_project_reservation_events event where event.project_id = p_project_id
    order by event.created_at desc, event.id desc;
end;
$function$;
revoke all on function public.list_project_finished_goods_reservations(uuid),
  public.list_project_finished_goods_reservation_events(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_project_finished_goods_reservations(uuid),
  public.list_project_finished_goods_reservation_events(uuid) to authenticated;
