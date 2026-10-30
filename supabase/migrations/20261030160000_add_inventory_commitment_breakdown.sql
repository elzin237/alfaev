-- 176: additive read only. Each request selects ONE metric, never a mixed total.
-- Cursor contains only an authorized last source ID and a visible-snapshot digest.
-- A changed snapshot requires restarting pagination; no persistent snapshot writes.
create function public.get_inventory_commitment_breakdown(
  p_product_id uuid,p_warehouse_id uuid,p_metric text,p_scope text default 'warehouse',
  p_limit integer default 50,p_cursor jsonb default null
) returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare
  observed_at timestamptz:=statement_timestamp(); scope_ids uuid[]; permission_key text;
  source_allowed boolean; context_allowed boolean; source_rows jsonb; visible_rows jsonb;
  metric_total numeric; visible_total numeric; before_total numeric; page_total numeric; after_total numeric;
  snapshot_key text; last_id uuid; page_rows jsonb; more boolean; next_cursor jsonb; product_serial text;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null then raise exception 'Access denied' using errcode='42501';end if;
  permission_key:=public.inventory_warehouse_permission_key(p_warehouse_id,'view');
  if not(public.current_user_is_admin() or public.has_permission(permission_key)) then raise exception 'Access denied' using errcode='42501';end if;
  if p_product_id is null or p_scope is null or p_scope not in ('warehouse','raw_customs')
    or p_metric is null or p_metric not in ('project_demand','fg_project_reservation','test_hold','work_order_reservation')
    or p_limit is null or p_limit<1 or p_limit>100
    or (p_scope='raw_customs' and p_warehouse_id<>'10000000-0000-4000-8000-000000000001'::uuid)
    or (p_metric='project_demand' and p_scope<>'raw_customs')
    or (p_metric='fg_project_reservation' and (p_scope<>'warehouse' or p_warehouse_id<>'10000000-0000-4000-8000-000000000002'::uuid)) then
    raise exception 'Invalid commitment scope or metric' using errcode='22023';end if;
  scope_ids:=case when p_scope='raw_customs' then array[p_warehouse_id,'10000000-0000-4000-8000-000000000003'::uuid] else array[p_warehouse_id] end;
  if p_scope='raw_customs' and not(public.current_user_is_admin() or public.has_permission('inventory.customs.view')) then raise exception 'Access denied' using errcode='42501';end if;
  -- Reuse authoritative listing membership (not structural balances).
  select p.serial_number into product_serial from public.products p where p.id=p_product_id;
  if product_serial is null or not exists(select 1 from public.search_inventory_products_by_warehouse(p_warehouse_id,product_serial) p where p.id=p_product_id) then
    raise exception 'Product not found in this warehouse' using errcode='P0002';end if;
  source_allowed:=public.current_user_is_admin() or public.has_permission(case p_metric
    when 'project_demand' then 'projects.view' when 'fg_project_reservation' then 'projects.view'
    when 'test_hold' then 'test_calculator.view' else 'work_orders.view' end);
  -- Global R/H/U may include other warehouses. Omit it unless all are authorized.
  context_allowed:=source_allowed and (public.current_user_is_admin() or (
    public.has_permission('inventory.raw_materials.view') and public.has_permission('inventory.customs.view') and public.has_permission('inventory.finished_goods.view')));
  with sources as (
    select c.project_id id,c.project_name label,c.outstanding_commitment quantity,null::numeric required,null::numeric held,null::numeric uncovered
      from public.calculate_open_project_commitments() c where p_metric='project_demand' and c.product_id=p_product_id and c.outstanding_commitment>0
    union all
    select r.project_id,p.name,sum(r.reserved_quantity::numeric),null::numeric,null::numeric,null::numeric
      from public.finished_goods_project_reservations r join public.projects p on p.id=r.project_id
      where p_metric='fg_project_reservation' and r.product_id=p_product_id and r.warehouse_id=any(scope_ids) and r.reserved_quantity>0 group by r.project_id,p.name
    union all
    select t.calculation_id,c.name,sum(t.quantity),null::numeric,null::numeric,null::numeric
      from public.active_test_holds_at(observed_at,array[p_product_id]) t join public.test_calculations c on c.id=t.calculation_id
      where p_metric='test_hold' and t.warehouse_id=any(scope_ids) group by t.calculation_id,c.name
    union all
    select s.work_order_id,w.work_order_number,sum(a.held_quantity::numeric),
      case when context_allowed then t.required_quantity::numeric end,case when context_allowed then t.held_quantity::numeric end,case when context_allowed then t.uncovered_quantity::numeric end
      from public.work_order_material_reservation_states s join public.work_order_material_reservation_allocations a on a.state_id=s.id
      join public.work_orders w on w.id=s.live_work_order_id and w.id=s.work_order_id and w.status='draft'
      join public.work_order_material_reservation_totals t on t.id=s.id
      where p_metric='work_order_reservation' and s.product_id=p_product_id and s.status='active' and a.warehouse_id=any(scope_ids)
      group by s.work_order_id,w.work_order_number,t.required_quantity,t.held_quantity,t.uncovered_quantity
  ) select coalesce(jsonb_agg(jsonb_build_object('source_id',id,'source_type',p_metric,'label',label,'quantity',quantity::text,
      'navigation_allowed',true,'required_quantity',required::text,'held_quantity',held::text,'uncovered_quantity',uncovered::text) order by id),'[]'::jsonb),coalesce(sum(quantity),0)
    into source_rows,metric_total from sources where quantity>0;
  visible_rows:=case when source_allowed then source_rows else '[]'::jsonb end;
  select coalesce(sum((v->>'quantity')::numeric),0) into visible_total from jsonb_array_elements(visible_rows) v;
  snapshot_key:=md5(jsonb_build_array(auth.uid(),public.current_active_user_profile_id(),p_product_id,p_warehouse_id,p_metric,p_scope,scope_ids,visible_rows,metric_total::text,context_allowed)::text);
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or (select array_agg(k order by k) from jsonb_object_keys(p_cursor) k)<>array['after_id','snapshot']::text[]
      or jsonb_typeof(p_cursor->'after_id')<>'string' or jsonb_typeof(p_cursor->'snapshot')<>'string' or length(p_cursor::text)>250
      or p_cursor->>'snapshot'<>snapshot_key or (p_cursor->>'after_id')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Commitment cursor stale or invalid; restart pagination' using errcode='ICB01';end if;
    last_id:=(p_cursor->>'after_id')::uuid;
    if not exists(select 1 from jsonb_array_elements(visible_rows) v where (v->>'source_id')::uuid=last_id) then raise exception 'Commitment cursor stale or invalid' using errcode='ICB01';end if;
  end if;
  select coalesce(sum((v->>'quantity')::numeric),0) into before_total from jsonb_array_elements(visible_rows) v where (v->>'source_id')::uuid<=last_id;
  select coalesce(jsonb_agg(page.v order by (page.v->>'source_id')::uuid),'[]'::jsonb) into page_rows from
    (select v from jsonb_array_elements(visible_rows) v where last_id is null or (v->>'source_id')::uuid>last_id order by (v->>'source_id')::uuid limit p_limit) page;
  select coalesce(sum((v->>'quantity')::numeric),0) into page_total from jsonb_array_elements(page_rows) v;
  after_total:=visible_total-before_total-page_total; more:=after_total>0;
  next_cursor:=case when more then jsonb_build_object('snapshot',snapshot_key,'after_id',page_rows->-1->>'source_id') else null end;
  return jsonb_build_object('schema',1,'product_id',p_product_id,'warehouse_id',p_warehouse_id,'scope',p_scope,'scope_warehouse_ids',scope_ids,
    'metric',p_metric,'as_of',observed_at,'metric_total',metric_total::text,'visible_total',visible_total::text,
    'restricted_remainder',(metric_total-visible_total)::text,'restricted_label',case when metric_total>visible_total then 'Restricted sources' else null end,
    'visible_before_quantity',before_total::text,'page_subtotal',page_total::text,'visible_after_quantity',after_total::text,
    'limit',p_limit,'has_more',more,'next_cursor',next_cursor,'items',page_rows);
end;
$f$;
revoke all on function public.get_inventory_commitment_breakdown(uuid,uuid,text,text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_inventory_commitment_breakdown(uuid,uuid,text,text,integer,jsonb) to authenticated;
