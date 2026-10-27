-- Phase 3C: private atomic Finished Goods fulfillment. No activation/backfill.
-- Existing reserve/release history, physical ledger and source allocations remain authoritative.
alter table public.finished_goods_project_reservation_events
  add column inventory_movement_id uuid
    references public.inventory_movements(id) on delete restrict,
  add constraint finished_goods_fulfillment_movement_unique unique (inventory_movement_id);
alter table public.finished_goods_project_reservation_events
  drop constraint finished_goods_project_reservation_events_event_type_check,
  drop constraint finished_goods_project_reservation_events_check,
  add constraint finished_goods_reservation_event_type_valid
    check (event_type in ('reserved','released','fulfilled')),
  add constraint finished_goods_reservation_event_arithmetic
    check ((event_type = 'reserved' and quantity_after::numeric = quantity_before::numeric + requested_quantity::numeric)
      or (event_type in ('released','fulfilled') and quantity_after::numeric = quantity_before::numeric - requested_quantity::numeric)),
  add constraint finished_goods_fulfillment_movement_required
    check ((event_type = 'fulfilled') = (inventory_movement_id is not null));

-- Same canonical consumption calculation and queue; no second demand ledger.
create or replace function public.calculate_open_project_commitments(
  p_product_id uuid default null
)
returns table (
  project_id uuid,
  project_name text,
  product_id uuid,
  planned_requirement numeric,
  actual_project_consumption numeric,
  outstanding_commitment numeric
)
language sql
stable
set search_path = ''
as $function$
  with planned as (
    select
      project.id as project_id,
      project.name as project_name,
      component.product_id,
      pg_catalog.sum(component.required_quantity::numeric) as planned_requirement
    from public.projects as project
    join public.project_products as project_product
      on project_product.project_id = project.id
    join public.project_product_components as component
      on component.project_product_id = project_product.id
    where project.status in ('planned', 'in_progress', 'on_hold')
      and (p_product_id is null or component.product_id = p_product_id)
    group by project.id, project.name, component.product_id
  ),
  consumed as (
    select
      movement.project_id,
      movement.product_id,
      pg_catalog.sum(-movement.quantity_delta::numeric) as consumed_quantity
    from public.inventory_movements as movement
    where movement.project_id is not null
      and movement.quantity_delta < 0
      and movement.source_type in ('work_order', 'pcb_production_input', 'finished_goods_reservation_fulfillment')
      and (p_product_id is null or movement.product_id = p_product_id)
    group by movement.project_id, movement.product_id
  )
  select
    planned.project_id,
    planned.project_name,
    planned.product_id,
    planned.planned_requirement,
    coalesce(consumed.consumed_quantity, 0::numeric),
    greatest(
      planned.planned_requirement -
        coalesce(consumed.consumed_quantity, 0::numeric),
      0::numeric
    )
  from planned
  left join consumed
    on consumed.project_id = planned.project_id
    and consumed.product_id = planned.product_id;
$function$;

create or replace function public.queue_project_shortage_reconciliation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  affected_product_id uuid;
begin
  if tg_table_name = 'inventory_balances' then
    if tg_op <> 'DELETE'
      and new.warehouse_id in (
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000003'::uuid
      )
    then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), new.product_id)
      on conflict do nothing;
    end if;
    if tg_op <> 'INSERT'
      and old.warehouse_id in (
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000003'::uuid
      )
    then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), old.product_id)
      on conflict do nothing;
    end if;
  elsif tg_table_name = 'inventory_movements' then
    if tg_op = 'INSERT'
      and new.project_id is not null
      and new.quantity_delta < 0
      and new.source_type in ('work_order', 'pcb_production_input', 'finished_goods_reservation_fulfillment')
    then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), new.product_id)
      on conflict do nothing;
    end if;
  elsif tg_table_name = 'project_product_components' then
    if tg_op <> 'DELETE' then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), new.product_id)
      on conflict do nothing;
    end if;
    if tg_op <> 'INSERT' then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), old.product_id)
      on conflict do nothing;
    end if;
  elsif tg_table_name = 'projects'
    and new.status is distinct from old.status
  then
    for affected_product_id in
      select distinct component.product_id
      from public.project_products as project_product
      join public.project_product_components as component
        on component.project_product_id = project_product.id
      where project_product.project_id = new.id
      order by component.product_id
    loop
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), affected_product_id)
      on conflict do nothing;
    end loop;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function public.calculate_open_project_commitments(uuid),
  public.queue_project_shortage_reconciliation() from public, anon, authenticated, service_role;

drop trigger inventory_movements_queue_project_shortage_reconciliation on public.inventory_movements;
create trigger inventory_movements_queue_project_shortage_reconciliation
after insert on public.inventory_movements for each row
when (new.project_id is not null and new.quantity_delta < 0
  and new.source_type in ('work_order','pcb_production_input','finished_goods_reservation_fulfillment'))
execute function public.queue_project_shortage_reconciliation();

drop trigger project_consumption_protect_finished_goods_reservations on public.inventory_movements;
create trigger project_consumption_protect_finished_goods_reservations
after insert on public.inventory_movements for each row
when (new.project_id is not null and new.quantity_delta < 0
  and new.source_type in ('work_order','pcb_production_input','finished_goods_reservation_fulfillment'))
execute function public.protect_finished_goods_reservation_demand();

-- Reciprocal, deferred validation lets the existing primitive create the movement
-- and FIFO allocations before the immutable receipt is appended in the same call.
-- No orphan/spoofed fulfillment source may commit, even through an internal primitive.
create function public.validate_finished_goods_fulfillment_link()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  receipt public.finished_goods_project_reservation_events%rowtype;
  movement public.inventory_movements%rowtype;
  allocated numeric;
begin
  if tg_table_name = 'inventory_movements' then
    select event.* into receipt from public.finished_goods_project_reservation_events event
      where event.id = new.source_id and event.event_type = 'fulfilled';
    if not found then raise exception 'Invalid fulfillment provenance' using errcode = 'FGR09'; end if;
    movement := new;
  else
    receipt := new;
    select item.* into movement from public.inventory_movements item where item.id = new.inventory_movement_id;
    if not found then raise exception 'Invalid fulfillment provenance' using errcode = 'FGR09'; end if;
  end if;
  if receipt.inventory_movement_id is distinct from movement.id
    or movement.source_id is distinct from receipt.id
    or movement.source_type is distinct from 'finished_goods_reservation_fulfillment'
    or movement.movement_type is distinct from 'finished_goods_reservation_fulfillment'
    or movement.project_id is distinct from receipt.project_id
    or movement.product_id is distinct from receipt.product_id
    or movement.actor_user_id is distinct from receipt.actor_user_id
    or movement.warehouse_id is distinct from '10000000-0000-4000-8000-000000000002'::uuid
    or movement.quantity_delta::numeric <> -receipt.requested_quantity::numeric
    or movement.reversal_of_movement_id is not null
    or not exists (select 1 from public.finished_goods_project_reservations state
      where state.id = receipt.reservation_id and state.project_id = receipt.project_id
        and state.product_id = receipt.product_id)
  then raise exception 'Invalid fulfillment provenance' using errcode = 'FGR09'; end if;
  select coalesce(pg_catalog.sum(allocation.allocated_quantity::numeric),0::numeric) into allocated
    from public.inventory_source_allocations allocation
    where allocation.outbound_inventory_movement_id = movement.id
      and allocation.product_id = movement.product_id and allocation.warehouse_id = movement.warehouse_id;
  if allocated <> receipt.requested_quantity::numeric then
    raise exception 'Invalid fulfillment provenance' using errcode = 'FGR09';
  end if;
  return null;
end;
$function$;
revoke all on function public.validate_finished_goods_fulfillment_link()
  from public, anon, authenticated, service_role;
create constraint trigger finished_goods_fulfillment_movement_link
after insert on public.inventory_movements deferrable initially deferred
for each row when (new.source_type = 'finished_goods_reservation_fulfillment')
execute function public.validate_finished_goods_fulfillment_link();
create constraint trigger finished_goods_fulfillment_receipt_link
after insert on public.finished_goods_project_reservation_events deferrable initially deferred
for each row when (new.event_type = 'fulfilled')
execute function public.validate_finished_goods_fulfillment_link();

create function public.fulfill_finished_goods_project_reservation(
  p_reservation_id uuid, p_project_id uuid, p_product_id uuid,
  p_quantity bigint, p_expected_version bigint, p_request_id uuid
)
returns table (reservation_id uuid, project_id uuid, product_id uuid,
  reserved_quantity bigint, reservation_version bigint, event_id uuid,
  movement_id uuid, physical_quantity_before bigint, physical_quantity_after bigint)
language plpgsql volatile security definer set search_path = '' as $function$
declare
  actor_id uuid;
  state public.finished_goods_project_reservations%rowtype;
  receipt public.finished_goods_project_reservation_events%rowtype;
  movement public.inventory_movements%rowtype;
  project_status text;
  physical bigint;
  demand numeric;
  total_reserved numeric;
  event_key uuid;
  recorded_at timestamptz;
  applied record;
begin
  actor_id := public.current_active_user_profile_id();
  if actor_id is null or not (public.current_user_is_admin() or (
    public.has_permission('projects.view') and public.has_permission('projects.edit')
    and public.has_permission('inventory.finished_goods.view')
    and public.has_permission('inventory.finished_goods.reserve')
  )) then raise exception 'Access denied' using errcode = '42501'; end if;
  if p_reservation_id is null or p_project_id is null or p_product_id is null
    or p_quantity is null or p_quantity <= 0 or p_expected_version is null
    or p_expected_version < 1 or p_request_id is null then
    raise exception 'Valid fulfillment parameters are required' using errcode = '22023';
  end if;
  -- Same request lock namespace as reserve/release; cross-operation reuse is rejected.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
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
    if receipt.event_type <> 'fulfilled' or receipt.reservation_id <> p_reservation_id
      or receipt.project_id <> p_project_id or receipt.product_id <> p_product_id
      or receipt.requested_quantity <> p_quantity or receipt.expected_version <> p_expected_version then
      raise exception 'Fulfillment request does not match its original operation' using errcode = 'FGR01';
    end if;
    select item.* into movement from public.inventory_movements item where item.id = receipt.inventory_movement_id;
    return query select receipt.reservation_id,receipt.project_id,receipt.product_id,
      receipt.quantity_after,receipt.reservation_version,receipt.id,
      movement.id,movement.quantity_before,movement.quantity_after;
    return;
  end if;
  select project.status into project_status from public.projects project where project.id = p_project_id for update;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if project_status not in ('planned','in_progress','on_hold') then
    raise exception 'Project is closed for fulfillment' using errcode = 'FGR02';
  end if;
  -- New physical debits follow the existing active-Product rule. Historical
  -- receipt replay above remains possible; archived reservations can still be released.
  perform product.id from public.products product where product.id = p_product_id
    and product.is_active and product.product_kind = 'pcb_finished_good'
    and exists (select 1 from public.pcb_cards card where card.output_product_id = product.id)
    for share;
  if not found then raise exception 'Finished Product is unavailable' using errcode = 'FGR03'; end if;
  select balance.quantity into physical from public.inventory_balances balance
    where balance.product_id = p_product_id
      and balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid for update;
  if not found then raise exception 'Finished Goods balance not found' using errcode = 'FGR03'; end if;
  select reservation.* into state from public.finished_goods_project_reservations reservation
    where reservation.id = p_reservation_id and reservation.project_id = p_project_id
      and reservation.product_id = p_product_id for update;
  if not found then raise exception 'Reservation not found' using errcode = 'P0002'; end if;
  if state.version <> p_expected_version then
    raise exception 'Reservation version is stale' using errcode = 'FGR04';
  end if;
  if p_quantity > state.reserved_quantity then
    raise exception 'Fulfillment exceeds reserved quantity' using errcode = 'FGR05';
  end if;
  select commitment.outstanding_commitment into demand
    from public.calculate_open_project_commitments(p_product_id) commitment where commitment.project_id = p_project_id;
  select coalesce(pg_catalog.sum(reservation.reserved_quantity::numeric),0::numeric) into total_reserved
    from public.finished_goods_project_reservations reservation where reservation.product_id = p_product_id;
  if demand is null or state.reserved_quantity::numeric > demand then
    raise exception 'Reservation exceeds outstanding Product demand' using errcode = 'FGR06';
  end if;
  if physical::numeric < total_reserved or physical < p_quantity then
    raise exception 'Insufficient Finished Goods stock' using errcode = 'FGR07';
  end if;
  -- Authorization cannot disappear while this operation waits on stock/state.
  perform profile.id from public.user_profiles profile where profile.id = actor_id
    and profile.auth_user_id = auth.uid() and profile.is_active for share;
  if not public.current_user_is_admin() then
    perform permission.user_id from public.user_permissions permission
      join public.permission_definitions definition on definition.id = permission.permission_definition_id
      where permission.user_id = actor_id and definition.key in (
        'projects.view','projects.edit','inventory.finished_goods.view','inventory.finished_goods.reserve')
      order by definition.key for share of permission,definition;
  end if;
  if public.current_active_user_profile_id() is distinct from actor_id or not (
    public.current_user_is_admin() or (public.has_permission('projects.view')
      and public.has_permission('projects.edit') and public.has_permission('inventory.finished_goods.view')
      and public.has_permission('inventory.finished_goods.reserve'))
  ) then raise exception 'Access denied' using errcode = '42501'; end if;
  event_key := gen_random_uuid();
  recorded_at := pg_catalog.clock_timestamp();
  -- Reduce the reservation while holding Project -> Product -> balance -> state
  -- locks BEFORE the physical debit. The unchanged universal hard-stock trigger
  -- then protects every other Project's reservation without any bypass.
  update public.finished_goods_project_reservations reservation
    set reserved_quantity = state.reserved_quantity - p_quantity, version = state.version + 1,
      updated_at = recorded_at, updated_by_user_id = actor_id where reservation.id = state.id;
  select * into applied from public.apply_inventory_delta_in_warehouse(
    p_product_id,'10000000-0000-4000-8000-000000000002'::uuid,-p_quantity,
    'finished_goods_reservation_fulfillment','Fulfilled Finished Goods Project reservation',
    'finished_goods_reservation_fulfillment',event_key,p_project_id
  );
  insert into public.finished_goods_project_reservation_events as event (
    id,reservation_id,project_id,product_id,event_type,quantity_before,quantity_after,
    reservation_version,request_id,actor_user_id,requested_quantity,expected_version,created_at,inventory_movement_id
  ) values (event_key,state.id,p_project_id,p_product_id,'fulfilled',state.reserved_quantity,
    state.reserved_quantity-p_quantity,state.version+1,p_request_id,actor_id,p_quantity,p_expected_version,
    recorded_at,applied.movement_id) returning event.* into receipt;
  -- This is the same canonical demand after its movement, not a separate counter.
  select commitment.outstanding_commitment into demand
    from public.calculate_open_project_commitments(p_product_id) commitment where commitment.project_id = p_project_id;
  if demand is null or receipt.quantity_after::numeric > demand then
    raise exception 'Fulfillment invalidates remaining demand' using errcode = 'FGR06';
  end if;
  perform public.append_audit_log(
    p_action_type=>'finished_goods_reservation.fulfilled',
    p_entity_type=>'finished_goods_reservation',p_entity_id=>state.id,
    p_summary=>'Fulfilled Finished Goods Project reservation',
    p_before_data=>pg_catalog.jsonb_build_object('reserved_quantity',state.reserved_quantity),
    p_after_data=>pg_catalog.jsonb_build_object('project_id',p_project_id,'product_id',p_product_id,
      'reserved_quantity',receipt.quantity_after,'version',receipt.reservation_version,
      'inventory_movement_id',applied.movement_id,'fulfilled_quantity',p_quantity)
  );
  return query select state.id,p_project_id,p_product_id,receipt.quantity_after,receipt.reservation_version,
    receipt.id,applied.movement_id,applied.quantity_before,applied.quantity_after;
end;
$function$;
revoke all on function public.fulfill_finished_goods_project_reservation(uuid,uuid,uuid,bigint,bigint,uuid),
  public.change_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid,boolean),
  public.reserve_finished_goods_for_project(uuid,uuid,bigint,bigint,uuid),
  public.release_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid)
  from public, anon, authenticated, service_role;
