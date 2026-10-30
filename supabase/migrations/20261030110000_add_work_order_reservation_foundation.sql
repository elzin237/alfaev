-- 171: private, inert Draft commitment foundation. No existing writer/read hooks.
create table public.work_order_material_reservation_receipts (
  request_id uuid primary key,
  work_order_id uuid not null,
  work_order_number text not null,
  actor_user_id uuid not null references public.user_profiles(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  operation text not null check (operation in ('create','edit','delete','finish')),
  expected_updated_at timestamptz,
  submitted_payload jsonb not null check (jsonb_typeof(submitted_payload)='object'),
  receipt jsonb not null check (jsonb_typeof(receipt)='object'),
  created_at timestamptz not null default clock_timestamp() check (isfinite(created_at)),
  transaction_id bigint not null default txid_current(),
  unique (request_id,work_order_id,actor_user_id)
);
create table public.work_order_material_reservation_states (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null,
  live_work_order_id uuid references public.work_orders(id) on delete set null,
  product_id uuid not null references public.products(id) on delete restrict,
  required_quantity bigint not null check (required_quantity>=0),
  version bigint not null check (version>0),
  draft_updated_at timestamptz not null check (isfinite(draft_updated_at)),
  status text not null default 'active' check (status in ('active','consumed','released')),
  last_request_id uuid not null references public.work_order_material_reservation_receipts(request_id),
  created_at timestamptz not null default clock_timestamp() check (isfinite(created_at)),
  unique(work_order_id,product_id), unique(id,work_order_id,product_id),
  check (live_work_order_id is null or live_work_order_id=work_order_id)
);
create table public.work_order_material_reservation_allocations (
  state_id uuid not null references public.work_order_material_reservation_states(id) on delete restrict,
  warehouse_id uuid not null references public.inventory_warehouses(id) on delete restrict,
  held_quantity bigint not null check (held_quantity>0),
  state_version bigint not null check (state_version>0),
  primary key(state_id,warehouse_id)
);
create index work_order_reservation_live_product_idx on public.work_order_material_reservation_states(product_id,live_work_order_id)
  where status='active' and live_work_order_id is not null;
create table public.work_order_material_reservation_events (
  id uuid primary key default gen_random_uuid(),
  state_id uuid not null,
  work_order_id uuid not null,
  product_id uuid not null,
  warehouse_id uuid references public.inventory_warehouses(id) on delete restrict,
  state_version bigint not null check (state_version>0),
  request_id uuid not null,
  actor_user_id uuid not null,
  event_type text not null check (event_type in ('allocated','released','consumed','requirement_changed')),
  quantity bigint not null check (quantity>0),
  quantity_before bigint not null check (quantity_before>=0),
  quantity_after bigint not null check (quantity_after>=0),
  created_at timestamptz not null default clock_timestamp() check (isfinite(created_at)),
  foreign key(state_id,work_order_id,product_id) references public.work_order_material_reservation_states(id,work_order_id,product_id),
  foreign key(request_id,work_order_id,actor_user_id) references public.work_order_material_reservation_receipts(request_id,work_order_id,actor_user_id),
  check ((event_type='requirement_changed' and warehouse_id is null
      and abs(quantity_after::numeric-quantity_before::numeric)=quantity::numeric)
    or (event_type='allocated' and warehouse_id is not null
      and quantity_after::numeric=quantity_before::numeric+quantity::numeric)
    or (event_type in ('released','consumed') and warehouse_id is not null
      and quantity_after::numeric=quantity_before::numeric-quantity::numeric)),
  unique nulls not distinct(state_id,state_version,warehouse_id,event_type)
);
create index work_order_reservation_event_order_idx on public.work_order_material_reservation_events(state_id,warehouse_id,state_version);
-- Evidence candidates are retained, but cannot confer coverage without a later
-- reviewed trusted proof producer. Merely supplying a Project ID is not proof.
create table public.work_order_project_requirement_coverage (
  id uuid primary key default gen_random_uuid(),
  state_id uuid not null references public.work_order_material_reservation_states(id),
  warehouse_id uuid not null references public.inventory_warehouses(id),
  requirement_id uuid not null,
  project_product_id uuid not null,
  project_id uuid not null,
  product_id uuid not null references public.products(id),
  requirement_updated_at timestamptz not null check (isfinite(requirement_updated_at)),
  requirement_quantity bigint not null check (requirement_quantity>0),
  proposed_quantity bigint not null check (proposed_quantity>0 and proposed_quantity<=requirement_quantity),
  proof jsonb not null check (jsonb_typeof(proof)='object' and proof<>'{}'::jsonb),
  request_id uuid not null references public.work_order_material_reservation_receipts(request_id),
  effective_quantity bigint generated always as (0::bigint) stored,
  unique(state_id,warehouse_id,requirement_id,request_id)
);

create function public.guard_work_order_reservation_foundation()
returns trigger language plpgsql security invoker set search_path='' as $f$
declare s public.work_order_material_reservation_states%rowtype;
  r public.work_order_material_reservation_receipts%rowtype; prior_quantity bigint;
begin
  if tg_table_name in ('work_order_material_reservation_events','work_order_material_reservation_receipts','work_order_project_requirement_coverage')
    and tg_op<>'INSERT' then raise exception 'Reservation history is immutable' using errcode='55000'; end if;
  if tg_table_name='work_order_material_reservation_receipts' then
    if not exists(select 1 from public.work_orders w where w.id=new.work_order_id and w.work_order_number=new.work_order_number)
      or not exists(select 1 from public.user_profiles p where p.id=new.actor_user_id and p.auth_user_id=new.auth_user_id)
      or not(new.submitted_payload @> jsonb_build_object('work_order_id',new.work_order_id,'auth_user_id',new.auth_user_id,'operation',new.operation))
      or not(new.receipt @> jsonb_build_object('request_id',new.request_id,'work_order_id',new.work_order_id,'operation',new.operation))
      or (new.operation<>'create' and new.expected_updated_at is null)
    then raise exception 'Invalid reservation receipt ownership' using errcode='23514'; end if;
  elsif tg_table_name='work_order_material_reservation_states' then
    if tg_op='DELETE' then raise exception 'Reservation state history is retained' using errcode='55000'; end if;
    -- Only the existing Work Order FK cleanup may detach the live reference.
    -- No operational release, event, stock change or legacy delete hook is added.
    if tg_op='UPDATE' and new.live_work_order_id is null and old.live_work_order_id is not null
      and pg_trigger_depth()>1 and not exists(select 1 from public.work_orders w where w.id=old.live_work_order_id)
      and (to_jsonb(new)-'live_work_order_id')=(to_jsonb(old)-'live_work_order_id') then return new; end if;
    if new.live_work_order_id is distinct from new.work_order_id
      or (tg_op='INSERT' and new.version<>1)
      or (tg_op='UPDATE' and (old.status<>'active' or new.version::numeric<>old.version::numeric+1
        or new.last_request_id=old.last_request_id
        or (to_jsonb(new)-array['required_quantity','version','draft_updated_at','status','last_request_id'])
          is distinct from (to_jsonb(old)-array['required_quantity','version','draft_updated_at','status','last_request_id'])))
    then raise exception 'Invalid reservation state version/identity' using errcode='23514'; end if;
    select * into r from public.work_order_material_reservation_receipts where request_id=new.last_request_id;
    if r.work_order_id is distinct from new.work_order_id or r.transaction_id<>txid_current() then raise exception 'Wrong request owner' using errcode='23514'; end if;
  elsif tg_table_name='work_order_material_reservation_events' then
    select * into strict s from public.work_order_material_reservation_states where id=new.state_id for update;
    select * into strict r from public.work_order_material_reservation_receipts where request_id=new.request_id;
    if (new.event_type='consumed' and r.operation<>'finish')
      or (new.event_type='released' and r.operation not in ('edit','delete','finish'))
      or (new.event_type='requirement_changed' and r.operation not in ('create','edit'))
      or (new.event_type='allocated' and r.operation not in ('create','edit','finish')) then
      raise exception 'Event/request operation mismatch' using errcode='23514'; end if;
    if new.state_version<>s.version or new.request_id<>s.last_request_id or not exists(
      select 1 from public.work_order_material_reservation_receipts candidate_receipt where candidate_receipt.request_id=new.request_id and candidate_receipt.transaction_id=txid_current()) then raise exception 'Stale event identity' using errcode='23514'; end if;
    select e.quantity_after into prior_quantity from public.work_order_material_reservation_events e
      where e.state_id=new.state_id and e.warehouse_id is not distinct from new.warehouse_id
      order by e.state_version desc,e.created_at desc,e.id desc limit 1;
    if new.quantity_before<>coalesce(prior_quantity,0) then raise exception 'Discontinuous reservation event' using errcode='23514'; end if;
    if new.event_type='allocated' then
      perform product.id from public.products product where product.id=s.product_id for update;
      perform balance.product_id from public.inventory_balances balance where balance.product_id=s.product_id and balance.warehouse_id=new.warehouse_id for update;
      if (public.is_calculator_finished_product(s.product_id) and new.warehouse_id<>'10000000-0000-4000-8000-000000000002'::uuid)
        or new.quantity_after>s.required_quantity or
        (select coalesce(sum(a.held_quantity::numeric),0) from public.work_order_material_reservation_allocations a where a.state_id=s.id)>s.required_quantity
        or not exists(select 1 from public.work_order_material_reservation_allocations a where a.state_id=s.id and a.warehouse_id=new.warehouse_id and a.held_quantity=new.quantity_after)
        or (select coalesce(sum(a.held_quantity::numeric),0) from public.work_order_material_reservation_allocations a
          join public.work_order_material_reservation_states owner_state on owner_state.id=a.state_id
          join public.work_orders w on w.id=owner_state.live_work_order_id and w.status='draft'
          where owner_state.status='active' and owner_state.product_id=s.product_id and a.warehouse_id=new.warehouse_id)
          >public.get_production_free_warehouse_quantity(s.product_id,new.warehouse_id)
      then raise exception 'Allocation is not stock-backed' using errcode='23514'; end if;
    end if;
  elsif tg_table_name='work_order_project_requirement_coverage' then
    select * into strict s from public.work_order_material_reservation_states where id=new.state_id;
    select * into strict r from public.work_order_material_reservation_receipts where request_id=new.request_id;
    if r.work_order_id<>s.work_order_id or s.product_id<>new.product_id or not exists(
      select 1 from public.project_product_components c join public.project_products p on p.id=c.project_product_id
      where c.id=new.requirement_id and c.project_product_id=new.project_product_id and p.project_id=new.project_id
        and c.product_id=new.product_id and c.updated_at=new.requirement_updated_at and c.required_quantity=new.requirement_quantity)
    then raise exception 'Invalid exact requirement evidence' using errcode='23514'; end if;
  end if;
  return new;
end;
$f$;

create function public.check_work_order_reservation_foundation()
returns trigger language plpgsql security definer set search_path='' as $f$
declare key_id uuid; s public.work_order_material_reservation_states%rowtype;
  material_total numeric; held numeric; required_event bigint; stock record;
begin
  if tg_table_name='work_order_material_reservation_states' then key_id:=new.id;
  elsif tg_op='DELETE' then key_id:=old.state_id; else key_id:=new.state_id; end if;
  select * into strict s from public.work_order_material_reservation_states where id=key_id;
  -- Detached historical rows never represent effective commitments. Deletion
  -- remains compatible before the separately implemented explicit release writer.
  if s.live_work_order_id is null then return null; end if;
  select sum(a.held_quantity::numeric) into held from public.work_order_material_reservation_allocations a where a.state_id=s.id;
  held:=coalesce(held,0);
  if held>s.required_quantity or (s.status<>'active' and held<>0) then
    raise exception 'Allocation exceeds requirement/lifecycle' using errcode='23514'; end if;
  if s.status='active' then
    select sum(i.quantity::numeric) into material_total from public.work_order_items i where i.work_order_id=s.work_order_id and i.product_id=s.product_id;
    if coalesce(material_total,0)<>s.required_quantity or not exists(select 1 from public.work_orders w
      where w.id=s.live_work_order_id and w.status='draft' and w.updated_at=s.draft_updated_at) then
      raise exception 'Requirement does not match saved Draft' using errcode='23514'; end if;
  end if;
  select e.quantity_after into required_event from public.work_order_material_reservation_events e
    where e.state_id=s.id and e.event_type='requirement_changed' order by e.state_version desc limit 1;
  if coalesce(required_event,0)<>s.required_quantity then raise exception 'Required event missing' using errcode='23514'; end if;
  if exists(
    with ledger as (select e.warehouse_id,sum(case when e.event_type='allocated' then e.quantity::numeric else -e.quantity::numeric end) quantity
      from public.work_order_material_reservation_events e where e.state_id=s.id and e.warehouse_id is not null group by e.warehouse_id)
    select 1 from ledger l full join public.work_order_material_reservation_allocations a on a.state_id=s.id and a.warehouse_id=l.warehouse_id
    where (a.state_id=s.id or l.warehouse_id is not null) and (coalesce(l.quantity,0)<>coalesce(a.held_quantity,0)::numeric
      or coalesce(a.state_version,1)>s.version or (a.state_id is not null and a.state_version is distinct from
        (select max(e.state_version) from public.work_order_material_reservation_events e where e.state_id=s.id and e.warehouse_id=a.warehouse_id)))) then raise exception 'Allocation/event ledger mismatch' using errcode='23514'; end if;
  -- Validation locks only on the NEW private boundary; existing accounting
  -- functions/triggers are untouched. Operational debit integration is later.
  perform p.id from public.products p where p.id=s.product_id for update;
  if exists(select 1 from public.work_order_material_reservation_allocations a where a.state_id=s.id and not exists(
    select 1 from public.inventory_balances b where b.product_id=s.product_id and b.warehouse_id=a.warehouse_id)) then
    raise exception 'Inventory source unavailable' using errcode='23514'; end if;
  for stock in select a.warehouse_id,b.quantity from public.work_order_material_reservation_allocations a
    join public.inventory_balances b on b.product_id=s.product_id and b.warehouse_id=a.warehouse_id
    where a.state_id=s.id order by a.warehouse_id for update of b
  loop
    if stock.quantity is null or (public.is_calculator_finished_product(s.product_id)
      and stock.warehouse_id<>'10000000-0000-4000-8000-000000000002'::uuid)
      or (select coalesce(sum(a.held_quantity::numeric),0) from public.work_order_material_reservation_allocations a
        join public.work_order_material_reservation_states owner on owner.id=a.state_id
        join public.work_orders w on w.id=owner.live_work_order_id and w.status='draft'
        where owner.status='active' and owner.product_id=s.product_id and a.warehouse_id=stock.warehouse_id)
        > public.get_production_free_warehouse_quantity(s.product_id,stock.warehouse_id)
    then raise exception 'Insufficient eligible physical stock' using errcode='23514'; end if;
  end loop;
  return null;
end;
$f$;

create view public.work_order_material_reservation_totals with (security_invoker=true) as
  select s.id,s.work_order_id,s.product_id,s.required_quantity,s.version,
    (case when s.status='active' and w.status='draft' then coalesce(sum(a.held_quantity::numeric),0) else 0 end)::bigint held_quantity,
    (case when s.status='active' and w.status='draft' then s.required_quantity::numeric-coalesce(sum(a.held_quantity::numeric),0) else 0 end)::bigint uncovered_quantity
  from public.work_order_material_reservation_states s left join public.work_orders w on w.id=s.live_work_order_id
  left join public.work_order_material_reservation_allocations a on a.state_id=s.id group by s.id,w.status;

do $install$
declare name text;
begin
  foreach name in array array['work_order_material_reservation_receipts','work_order_material_reservation_states',
    'work_order_material_reservation_allocations','work_order_material_reservation_events','work_order_project_requirement_coverage'] loop
    execute format('alter table public.%I enable row level security',name);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
    if name<>'work_order_material_reservation_allocations' then
      execute format('create trigger reservation_foundation_guard before insert or update or delete on public.%I for each row execute function public.guard_work_order_reservation_foundation()',name);
    end if;
    if name in ('work_order_material_reservation_states','work_order_material_reservation_allocations','work_order_material_reservation_events') then
      execute format('create constraint trigger reservation_foundation_consistent after insert or update or delete on public.%I deferrable initially deferred for each row execute function public.check_work_order_reservation_foundation()',name);
    end if;
  end loop;
end;
$install$;
create function public.reject_work_order_reservation_truncate() returns trigger language plpgsql security invoker set search_path='' as $f$
begin raise exception 'Reservation records cannot be truncated' using errcode='55000'; end;
$f$;
do $install$ declare name text; begin
  foreach name in array array['work_order_material_reservation_receipts','work_order_material_reservation_states',
    'work_order_material_reservation_allocations','work_order_material_reservation_events','work_order_project_requirement_coverage'] loop
    execute format('create trigger reservation_foundation_no_truncate before truncate on public.%I for each statement execute function public.reject_work_order_reservation_truncate()',name);
  end loop;
end; $install$;
revoke all on public.work_order_material_reservation_totals from public,anon,authenticated,service_role;
revoke all on function public.guard_work_order_reservation_foundation(),public.check_work_order_reservation_foundation(),
  public.reject_work_order_reservation_truncate() from public,anon,authenticated,service_role;
