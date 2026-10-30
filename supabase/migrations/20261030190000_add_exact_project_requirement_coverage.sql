-- 179: private Admin-declared coverage, never inferred from WorkOrder.project_id.
-- No Inventory formula, reservation, consumption writer or activation is changed.
create table public.work_order_requirement_coverage_evidence (
  request_id uuid primary key,
  state_id uuid not null references public.work_order_material_reservation_states(id),
  requirement_id uuid not null,
  warehouse_id uuid not null references public.inventory_warehouses(id),
  material_version bigint not null check(material_version>0),
  requirement_updated_at timestamptz not null check(isfinite(requirement_updated_at)),
  quantity bigint not null check(quantity>=0),
  supersedes_request_id uuid unique references public.work_order_requirement_coverage_evidence(request_id),
  evidence_revision bigint not null check(evidence_revision>0),
  work_order_id uuid not null,
  product_id uuid not null references public.products(id),
  project_id uuid not null,
  project_product_id uuid not null,
  project_updated_at timestamptz not null,
  material_updated_at timestamptz not null,
  material_required bigint not null check(material_required>0),
  requirement_quantity bigint not null check(requirement_quantity>0),
  warehouse_held bigint not null check(warehouse_held>=0),
  actor_user_id uuid not null references public.user_profiles(id),
  auth_user_id uuid not null references auth.users(id),
  declared_at timestamptz not null default clock_timestamp(),
  unique(state_id,requirement_id,warehouse_id,evidence_revision),
  check(quantity<=material_required and quantity<=requirement_quantity and quantity<=warehouse_held)
);
alter table public.work_order_requirement_coverage_evidence enable row level security;
create index work_order_coverage_requirement_idx on public.work_order_requirement_coverage_evidence(requirement_id);
revoke all on public.work_order_requirement_coverage_evidence from public,anon,authenticated,service_role;

-- Outstanding requirement quantity is provable only when no consumption exists
-- for this Project/Product. ANY unassigned historical consumption remains Unknown;
-- no FIFO/pro-rata distribution of aggregate Project consumption is invented.
create view public.work_order_requirement_coverage_current with(security_invoker=true) as
select e.* from public.work_order_requirement_coverage_evidence e
join public.work_order_material_reservation_states s on s.id=e.state_id
join public.work_orders w on w.id=s.live_work_order_id
join public.project_product_components r on r.id=e.requirement_id
join public.project_products g on g.id=r.project_product_id
join public.projects p on p.id=g.project_id
join public.work_order_material_reservation_allocations a on a.state_id=s.id and a.warehouse_id=e.warehouse_id
where e.quantity>0 and w.status='draft' and s.status='active'
  and (not public.is_calculator_finished_product(s.product_id) or e.warehouse_id='10000000-0000-4000-8000-000000000002'::uuid)
  and e.work_order_id=w.id and e.product_id=s.product_id and r.product_id=e.product_id
  and s.version=e.material_version and s.draft_updated_at=w.updated_at and e.material_updated_at=w.updated_at
  and s.required_quantity=e.material_required
  and e.material_required::numeric=(select coalesce(sum(i.quantity::numeric),0) from public.work_order_items i where i.work_order_id=w.id and i.product_id=e.product_id)
  and e.requirement_updated_at=r.updated_at and e.requirement_quantity=r.required_quantity
  and e.project_product_id=g.id and e.project_id=p.id and e.project_updated_at=p.updated_at
  and p.status in ('planned','in_progress','on_hold') and a.held_quantity=e.warehouse_held
  and not exists(select 1 from public.work_order_requirement_coverage_evidence newer
    where newer.state_id=e.state_id and newer.requirement_id=e.requirement_id and newer.warehouse_id=e.warehouse_id and newer.evidence_revision>e.evidence_revision)
  and not exists(select 1 from public.inventory_movements m where m.project_id=p.id and m.product_id=e.product_id
    and m.quantity_delta<0 and m.source_type in ('work_order','pcb_production_input','finished_goods_reservation_fulfillment'));
revoke all on public.work_order_requirement_coverage_current from public,anon,authenticated,service_role;

create function public.guard_exact_work_order_requirement_coverage()
returns trigger language plpgsql security definer set search_path='' as $f$
declare actor uuid:=public.current_active_user_profile_id();
  s public.work_order_material_reservation_states%rowtype; w public.work_orders%rowtype;
  r public.project_product_components%rowtype; g public.project_products%rowtype; p public.projects%rowtype;
  prior public.work_order_requirement_coverage_evidence%rowtype;
  held bigint; required_now numeric; existing_state numeric; existing_requirement numeric; existing_warehouse numeric; independent numeric;
begin
  if TG_OP<>'INSERT' then raise exception 'Coverage history is immutable' using errcode='55000';end if;
  if auth.uid() is null or actor is null or not public.current_user_is_admin() then raise exception 'Active Admin required' using errcode='42501';end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'READ COMMITTED required' using errcode='22023';end if;
  select * into s from public.work_order_material_reservation_states where id=new.state_id;
  select * into w from public.work_orders where id=s.live_work_order_id for update;
  select * into r from public.project_product_components where id=new.requirement_id;
  select * into g from public.project_products where id=r.project_product_id;
  -- Work Order -> all involved Projects (UUID order) -> requirement -> Product
  -- -> state. Matches existing planning/lifecycle/Finish serialization boundaries.
  perform id from public.projects where id in (g.project_id,w.project_id) order by id for no key update;
  select * into r from public.project_product_components where id=new.requirement_id for update;
  select * into g from public.project_products where id=r.project_product_id;
  select * into p from public.projects where id=g.project_id;
  perform id from public.products where id=s.product_id for update;
  select * into s from public.work_order_material_reservation_states where id=new.state_id for update;
  perform id from public.user_profiles where id=actor and auth_user_id=auth.uid() and is_active and is_admin for share;
  if not found or new.actor_user_id is distinct from actor or new.auth_user_id is distinct from auth.uid() then raise exception 'Active Admin required' using errcode='42501';end if;
  select coalesce(sum(i.quantity::numeric),0) into required_now from public.work_order_items i where i.work_order_id=w.id and i.product_id=s.product_id;
  if w.id is null or w.status<>'draft' or s.status<>'active' or s.live_work_order_id is distinct from w.id
    or s.draft_updated_at is distinct from w.updated_at or new.material_version is distinct from s.version
    or s.required_quantity::numeric is distinct from required_now or r.id is null or r.product_id is distinct from s.product_id
    or r.updated_at is distinct from new.requirement_updated_at or p.id is null or p.status not in ('planned','in_progress','on_hold')
    or new.warehouse_id not in ('10000000-0000-4000-8000-000000000001'::uuid,'10000000-0000-4000-8000-000000000002'::uuid,'10000000-0000-4000-8000-000000000003'::uuid)
    or (public.is_calculator_finished_product(s.product_id) and new.warehouse_id<>'10000000-0000-4000-8000-000000000002'::uuid)
    then raise exception 'Coverage requirement revision is unavailable or stale' using errcode='WRC10';end if;
  if new.quantity>0 and exists(select 1 from public.inventory_movements m where m.project_id=p.id and m.product_id=s.product_id
    and m.quantity_delta<0 and m.source_type in ('work_order','pcb_production_input','finished_goods_reservation_fulfillment')) then
    raise exception 'Exact requirement outstanding quantity is Unknown: unattributed consumption' using errcode='WRC11';end if;
  select * into prior from public.work_order_requirement_coverage_evidence where state_id=s.id and requirement_id=r.id and warehouse_id=new.warehouse_id order by evidence_revision desc limit 1;
  if new.supersedes_request_id is distinct from prior.request_id then raise exception 'Coverage evidence changed' using errcode='WRC12';end if;
  select coalesce(a.held_quantity,0) into held from public.work_order_material_reservation_allocations a where a.state_id=s.id and a.warehouse_id=new.warehouse_id;
  held:=coalesce(held,0);
  select coalesce(sum(e.quantity::numeric) filter(where e.state_id=s.id),0),
    coalesce(sum(e.quantity::numeric) filter(where e.requirement_id=r.id),0),
    coalesce(sum(e.quantity::numeric) filter(where e.state_id=s.id and e.warehouse_id=new.warehouse_id),0)
    into existing_state,existing_requirement,existing_warehouse from public.work_order_requirement_coverage_current e
    where (e.state_id=s.id or e.requirement_id=r.id)
      and not(e.state_id=s.id and e.requirement_id=r.id and e.warehouse_id=new.warehouse_id);
  select admin_independent_quantity into independent from public.work_order_requirement_attribution_current where state_id=s.id;
  if new.quantity<0 or existing_state+new.quantity::numeric+coalesce(independent,0)>required_now
    or existing_requirement+new.quantity::numeric>r.required_quantity::numeric
    or existing_warehouse+new.quantity::numeric>held::numeric then raise exception 'Coverage exceeds attributable requirement or Held' using errcode='23514';end if;
  new.work_order_id:=w.id;new.product_id:=s.product_id;new.project_id:=p.id;new.project_product_id:=g.id;
  new.project_updated_at:=p.updated_at;new.material_updated_at:=w.updated_at;new.material_required:=s.required_quantity;
  new.requirement_quantity:=r.required_quantity;new.warehouse_held:=held;new.evidence_revision:=coalesce(prior.evidence_revision,0)+1;
  new.declared_at:=clock_timestamp();return new;
end;
$f$;
create trigger exact_requirement_coverage_guard before insert or update or delete on public.work_order_requirement_coverage_evidence
  for each row execute function public.guard_exact_work_order_requirement_coverage();
create trigger exact_requirement_coverage_no_truncate before truncate on public.work_order_requirement_coverage_evidence
  for each statement execute function public.guard_exact_work_order_requirement_coverage();

create function public.declare_work_order_requirement_coverage(p_request_id uuid,p_state_id uuid,p_material_version bigint,
  p_requirement_id uuid,p_requirement_updated_at timestamptz,p_warehouse_id uuid,p_quantity bigint,p_supersedes_request_id uuid default null)
returns uuid language plpgsql volatile security definer set search_path='' as $f$
declare actor uuid:=public.current_active_user_profile_id(); original public.work_order_requirement_coverage_evidence%rowtype;
begin
  if auth.uid() is null or actor is null or not public.current_user_is_admin() then raise exception 'Active Admin required' using errcode='42501';end if;
  if p_request_id is null or p_state_id is null or p_material_version is null or p_material_version<=0 or p_requirement_id is null
    or p_requirement_updated_at is null or not isfinite(p_requirement_updated_at) or p_warehouse_id is null or p_quantity is null or p_quantity<0
    or current_setting('transaction_isolation')<>'read committed' then raise exception 'Invalid coverage request' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('wo-requirement-coverage:'||p_request_id::text,0));
  select * into original from public.work_order_requirement_coverage_evidence where request_id=p_request_id;
  if found then
    perform id from public.user_profiles where id=actor and auth_user_id=auth.uid() and is_active and is_admin for share;
    if not found or original.actor_user_id<>actor or original.auth_user_id<>auth.uid() then raise exception 'Coverage actor mismatch' using errcode='42501';end if;
    if original.state_id is distinct from p_state_id or original.material_version is distinct from p_material_version
      or original.requirement_id is distinct from p_requirement_id or original.requirement_updated_at is distinct from p_requirement_updated_at
      or original.warehouse_id is distinct from p_warehouse_id or original.quantity is distinct from p_quantity
      or original.supersedes_request_id is distinct from p_supersedes_request_id then raise exception 'Coverage request payload differs' using errcode='WRC13';end if;
    return p_request_id;
  end if;
  -- Trigger fills and validates authoritative snapshots before NOT NULL checks.
  insert into public.work_order_requirement_coverage_evidence(request_id,state_id,requirement_id,warehouse_id,material_version,
    requirement_updated_at,quantity,supersedes_request_id,actor_user_id,auth_user_id)
  values(p_request_id,p_state_id,p_requirement_id,p_warehouse_id,p_material_version,p_requirement_updated_at,p_quantity,p_supersedes_request_id,actor,auth.uid());
  return p_request_id;
end;
$f$;

-- Extend only private attribution projections; Inventory coverage remains zero.
create or replace view public.work_order_requirement_attribution_current with(security_invoker=true) as
select s.id state_id,s.work_order_id,s.product_id,current_material.required_quantity,
  (select coalesce(sum(c.quantity::numeric),0) from public.work_order_requirement_coverage_current c where c.state_id=s.id) verified_coverage_quantity,
  case when w.status='draft' and s.status='active' and s.live_work_order_id=w.id
    and e.material_version=s.version and e.material_updated_at=w.updated_at
    and s.draft_updated_at=w.updated_at and e.required_quantity::numeric=current_material.required_quantity
    and s.required_quantity::numeric=current_material.required_quantity
    then e.independent_quantity::numeric else 0::numeric end admin_independent_quantity,
  e.request_id latest_evidence_request_id
from public.work_order_material_reservation_states s
left join public.work_orders w on w.id=s.live_work_order_id
cross join lateral(select case when w.status='draft' then coalesce(sum(i.quantity::numeric),0) else 0::numeric end required_quantity
  from public.work_order_items i where i.work_order_id=w.id and i.product_id=s.product_id) current_material
left join lateral(select * from public.work_order_requirement_attribution_evidence evidence where evidence.state_id=s.id order by evidence_revision desc limit 1) e on true;

create function public.check_work_order_attribution_partition()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
  if exists(select 1 from public.work_order_requirement_attribution_totals where state_id=new.state_id and unknown_quantity<0) then
    raise exception 'Independence overlaps verified coverage' using errcode='23514';end if;return new;
end;
$f$;
create trigger work_order_attribution_partition after insert on public.work_order_requirement_attribution_evidence
  for each row execute function public.check_work_order_attribution_partition();
revoke all on function public.guard_exact_work_order_requirement_coverage(),public.check_work_order_attribution_partition(),
  public.declare_work_order_requirement_coverage(uuid,uuid,bigint,uuid,timestamptz,uuid,bigint,uuid) from public,anon,authenticated,service_role;
