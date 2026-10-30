-- 181: bounded Admin-only context for the existing migration-180 workflow.
-- Read-only. No accounting, writer, evidence, activation or backfill changes.
create function public.get_work_order_attribution_context(p_work_order_id uuid,p_product_id uuid,p_limit integer default 20,p_after uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare s public.work_order_material_reservation_states%rowtype; w public.work_orders%rowtype;
  t record; independent_request uuid; allocations jsonb; requirements jsonb; more boolean; last_id uuid;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null or not public.current_user_is_admin() then raise exception 'Active Admin required' using errcode='42501';end if;
  if p_work_order_id is null or p_product_id is null or p_limit is null or p_limit<1 or p_limit>50 then raise exception 'Invalid attribution context' using errcode='22023';end if;
  select * into w from public.work_orders where id=p_work_order_id;
  select * into s from public.work_order_material_reservation_states where live_work_order_id=w.id and product_id=p_product_id and status='active';
  if w.id is null or w.status<>'draft' or s.id is null or s.draft_updated_at is distinct from w.updated_at
    or s.required_quantity::numeric<>(select coalesce(sum(i.quantity::numeric),0) from public.work_order_items i where i.work_order_id=w.id and i.product_id=p_product_id) then
    raise exception 'Current tracked Draft material unavailable; no historical initialization' using errcode='WRC10';end if;
  select a.*,r.held_quantity,r.uncovered_quantity into t from public.work_order_requirement_attribution_totals a
    join public.work_order_material_reservation_totals r on r.id=a.state_id where a.state_id=s.id;
  select request_id into independent_request from public.work_order_requirement_attribution_evidence where state_id=s.id order by evidence_revision desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('warehouse_id',a.warehouse_id,'held',a.held_quantity::text) order by a.warehouse_id),'[]'::jsonb)
    into allocations from public.work_order_material_reservation_allocations a where a.state_id=s.id;
  with candidates as materialized (
    select r.id,r.updated_at,r.required_quantity,g.name group_name,p.name project_name,
      not exists(select 1 from public.inventory_movements m where m.project_id=p.id and m.product_id=p_product_id and m.quantity_delta<0
        and m.source_type in ('work_order','pcb_production_input','finished_goods_reservation_fulfillment')) known
    from public.project_product_components r join public.project_products g on g.id=r.project_product_id
    join public.projects p on p.id=g.project_id where r.product_id=p_product_id and p.status in ('planned','in_progress','on_hold')
      and (p_after is null or r.id>p_after) order by r.id limit p_limit+1
  ), page as (select * from candidates order by id limit p_limit)
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'revision',r.updated_at,'project_name',r.project_name,'group_name',r.group_name,
    'quantity',r.required_quantity::text,'outstanding',case when r.known then r.required_quantity::text else null end,
    'allocations',(select coalesce(jsonb_agg(jsonb_build_object('warehouse_id',a.warehouse_id,'request_id',prior.request_id,'quantity',coalesce(current.quantity,0)::text,
      'max_quantity',case when r.known then greatest(least(
        s.required_quantity::numeric-t.admin_independent_quantity-(t.verified_coverage_quantity-coalesce(current.quantity,0)),
        a.held_quantity::numeric-(select coalesce(sum(c.quantity::numeric),0) from public.work_order_requirement_coverage_current c where c.state_id=s.id and c.warehouse_id=a.warehouse_id)+coalesce(current.quantity,0),
        r.required_quantity::numeric-(select coalesce(sum(c.quantity::numeric),0) from public.work_order_requirement_coverage_current c where c.requirement_id=r.id)+coalesce(current.quantity,0)),0)::text else '0' end
    ) order by a.warehouse_id),'[]'::jsonb) from public.work_order_material_reservation_allocations a
      left join lateral(select e.request_id from public.work_order_requirement_coverage_evidence e where e.state_id=s.id and e.requirement_id=r.id and e.warehouse_id=a.warehouse_id order by evidence_revision desc limit 1) prior on true
      left join public.work_order_requirement_coverage_current current on current.state_id=s.id and current.requirement_id=r.id and current.warehouse_id=a.warehouse_id
      where a.state_id=s.id)) order by r.id),'[]'::jsonb),
    (select count(*)>p_limit from candidates) into requirements,more from page r;
  last_id:=(requirements->-1->>'id')::uuid;
  return jsonb_build_object('schema',1,'work_order_id',w.id,'product_id',p_product_id,'state_id',s.id,'material_version',s.version::text,
    'draft_updated_at',w.updated_at,'as_of',statement_timestamp(),'required',s.required_quantity::text,'held',t.held_quantity::text,'uncovered',t.uncovered_quantity::text,
    'coverage',t.verified_coverage_quantity::text,'independent',t.admin_independent_quantity::text,'unknown',t.unknown_quantity::text,
    'independence_request_id',independent_request,'max_independent',(s.required_quantity::numeric-t.verified_coverage_quantity)::text,
    'allocations',allocations,'requirements',requirements,'has_more',more,'next_after',case when more then last_id else null end);
end;
$f$;
revoke all on function public.get_work_order_attribution_context(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_work_order_attribution_context(uuid,uuid,integer,uuid) to authenticated;
