-- 178: private, inert Admin independence evidence. No existing writer/read is
-- changed and no historical material is classified automatically.
create table public.work_order_requirement_attribution_evidence (
  request_id uuid primary key,
  state_id uuid not null references public.work_order_material_reservation_states(id) on delete restrict,
  work_order_id uuid not null,
  product_id uuid not null references public.products(id) on delete restrict,
  material_version bigint not null check(material_version>0),
  material_updated_at timestamptz not null check(isfinite(material_updated_at)),
  required_quantity bigint not null check(required_quantity>0),
  independent_quantity bigint not null check(independent_quantity>=0 and independent_quantity<=required_quantity),
  declaration_kind text not null check(declaration_kind in ('admin_confirmed_independence','unknown')),
  evidence_revision bigint not null check(evidence_revision>0),
  supersedes_request_id uuid references public.work_order_requirement_attribution_evidence(request_id) on delete restrict,
  actor_user_id uuid not null references public.user_profiles(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  declared_at timestamptz not null default clock_timestamp() check(isfinite(declared_at)),
  unique(state_id,evidence_revision),
  unique(supersedes_request_id),
  check((declaration_kind='unknown' and independent_quantity=0) or
    (declaration_kind='admin_confirmed_independence' and independent_quantity>0)),
  check((evidence_revision=1 and supersedes_request_id is null) or
    (evidence_revision>1 and supersedes_request_id is not null))
);
alter table public.work_order_requirement_attribution_evidence enable row level security;
revoke all on public.work_order_requirement_attribution_evidence from public,anon,authenticated,service_role;

create function public.guard_work_order_requirement_attribution()
returns trigger language plpgsql security definer set search_path='' as $f$
declare s public.work_order_material_reservation_states%rowtype;
  w public.work_orders%rowtype; previous public.work_order_requirement_attribution_evidence%rowtype;
  actor uuid:=public.current_active_user_profile_id(); required_now numeric;
begin
  if TG_OP<>'INSERT' then raise exception 'Attribution history is immutable' using errcode='55000';end if;
  if auth.uid() is null or actor is null or not public.current_user_is_admin() then
    raise exception 'Active Admin required' using errcode='42501';end if;
  -- Parent -> state matches the existing Draft lifecycle lock order. No stock
  -- locks or stock writers are involved in an independence declaration.
  select * into w from public.work_orders where id=new.work_order_id for update;
  select * into s from public.work_order_material_reservation_states where id=new.state_id for update;
  perform id from public.user_profiles where id=actor and auth_user_id=auth.uid() and is_active and is_admin for share;
  if not found or new.actor_user_id is distinct from actor or new.auth_user_id is distinct from auth.uid() then
    raise exception 'Attribution actor mismatch' using errcode='42501';end if;
  select coalesce(sum(i.quantity::numeric),0) into required_now from public.work_order_items i
    where i.work_order_id=w.id and i.product_id=new.product_id;
  if w.id is null or w.status<>'draft' or s.id is null or s.status<>'active' or s.live_work_order_id is distinct from w.id
    or s.work_order_id is distinct from w.id or s.product_id is distinct from new.product_id
    or new.material_version is distinct from s.version or new.material_updated_at is distinct from w.updated_at
    or s.draft_updated_at is distinct from w.updated_at or new.required_quantity::numeric is distinct from required_now
    or s.required_quantity::numeric is distinct from required_now then
    raise exception 'Material evidence is stale or inconsistent' using errcode='WRA01';end if;
  select * into previous from public.work_order_requirement_attribution_evidence where state_id=s.id order by evidence_revision desc limit 1;
  if new.supersedes_request_id is distinct from previous.request_id or new.evidence_revision is distinct from coalesce(previous.evidence_revision,0)+1 then
    raise exception 'Attribution evidence changed' using errcode='WRA02';end if;
  new.declared_at:=clock_timestamp();
  return new;
end;
$f$;
create trigger work_order_requirement_attribution_guard before insert or update or delete
  on public.work_order_requirement_attribution_evidence for each row execute function public.guard_work_order_requirement_attribution();
create trigger work_order_requirement_attribution_no_truncate before truncate
  on public.work_order_requirement_attribution_evidence for each statement execute function public.guard_work_order_requirement_attribution();

-- Owner-only preparation contract, NOT an application RPC. Zero explicitly
-- supersedes a declaration with Unknown; positive quantities are a replacement
-- snapshot, never an additive increment. Exact authorized replay returns history.
create function public.declare_work_order_material_independence(
  p_request_id uuid,p_state_id uuid,p_material_version bigint,
  p_supersedes_request_id uuid,p_independent_quantity bigint
) returns uuid language plpgsql volatile security definer set search_path='' as $f$
declare actor uuid:=public.current_active_user_profile_id();
  original public.work_order_requirement_attribution_evidence%rowtype;
  s public.work_order_material_reservation_states%rowtype; prior_revision bigint;
begin
  if auth.uid() is null or actor is null or not public.current_user_is_admin() then
    raise exception 'Active Admin required' using errcode='42501';end if;
  if p_request_id is null or p_state_id is null or p_material_version is null or p_material_version<=0
    or p_independent_quantity is null or p_independent_quantity<0
    or current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Invalid attribution declaration' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('wo-requirement-attribution:'||p_request_id::text,0));
  select * into original from public.work_order_requirement_attribution_evidence where request_id=p_request_id;
  if found then
    perform id from public.user_profiles where id=actor and auth_user_id=auth.uid() and is_active and is_admin for share;
    if not found then raise exception 'Active Admin required' using errcode='42501';end if;
    if original.actor_user_id is distinct from actor or original.auth_user_id is distinct from auth.uid() then
      raise exception 'Attribution actor mismatch' using errcode='42501';end if;
    if original.state_id is distinct from p_state_id or original.material_version is distinct from p_material_version
      or original.supersedes_request_id is distinct from p_supersedes_request_id or original.independent_quantity is distinct from p_independent_quantity then
      raise exception 'Attribution request payload differs' using errcode='WRA03';end if;
    return original.request_id;
  end if;
  select * into s from public.work_order_material_reservation_states where id=p_state_id;
  if not found then raise exception 'Material state not found' using errcode='P0002';end if;
  perform id from public.work_orders where id=s.live_work_order_id for update;
  select * into s from public.work_order_material_reservation_states where id=p_state_id for update;
  select coalesce(max(evidence_revision),0) into prior_revision from public.work_order_requirement_attribution_evidence where state_id=s.id;
  insert into public.work_order_requirement_attribution_evidence(request_id,state_id,work_order_id,product_id,material_version,
    material_updated_at,required_quantity,independent_quantity,declaration_kind,evidence_revision,supersedes_request_id,actor_user_id,auth_user_id)
  values(p_request_id,s.id,s.work_order_id,s.product_id,p_material_version,s.draft_updated_at,s.required_quantity,p_independent_quantity,
    case when p_independent_quantity=0 then 'unknown' else 'admin_confirmed_independence' end,
    prior_revision+1,p_supersedes_request_id,actor,auth.uid());
  return p_request_id;
end;
$f$;

-- All three concepts remain separate. Verified Project coverage deliberately
-- stays zero until a genuine requirement-ownership/consumption proof producer
-- exists. A missing Project link or zero coverage NEVER proves independence.
create view public.work_order_requirement_attribution_current with(security_invoker=true) as
select s.id state_id,s.work_order_id,s.product_id,
  current_material.required_quantity,
  0::numeric verified_coverage_quantity,
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
left join lateral(select * from public.work_order_requirement_attribution_evidence evidence
  where evidence.state_id=s.id order by evidence_revision desc limit 1) e on true;
create view public.work_order_requirement_attribution_totals with(security_invoker=true) as
select *,required_quantity-verified_coverage_quantity-admin_independent_quantity unknown_quantity
from public.work_order_requirement_attribution_current;
revoke all on public.work_order_requirement_attribution_current,public.work_order_requirement_attribution_totals from public,anon,authenticated,service_role;
revoke all on function public.guard_work_order_requirement_attribution(),
  public.declare_work_order_material_independence(uuid,uuid,bigint,uuid,bigint) from public,anon,authenticated,service_role;
