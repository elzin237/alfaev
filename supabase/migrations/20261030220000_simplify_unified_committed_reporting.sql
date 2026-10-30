-- 182: approved additive REPORTING metric, not unique demand or protected stock.
-- Historical attribution/evidence and every availability/reservation writer stay intact.
create or replace function public.get_inventory_unified_committed(p_product_id uuid,p_warehouse_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare scope_ids uuid[]; scope_name text; serial text; demand numeric:=0; held numeric:=0;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null then raise exception 'Access denied' using errcode='42501';end if;
  if not(public.current_user_is_admin() or public.has_permission(public.inventory_warehouse_permission_key(p_warehouse_id,'view'))) then raise exception 'Access denied' using errcode='42501';end if;
  scope_name:=case when p_warehouse_id='10000000-0000-4000-8000-000000000001'::uuid then 'raw_customs' else 'warehouse' end;
  if scope_name='raw_customs' and not(public.current_user_is_admin() or public.has_permission('inventory.customs.view')) then raise exception 'Access denied' using errcode='42501';end if;
  select serial_number into serial from public.products where id=p_product_id;
  if serial is null or not exists(select 1 from public.search_inventory_products_by_warehouse(p_warehouse_id,serial) p where p.id=p_product_id) then raise exception 'Product not found in warehouse' using errcode='P0002';end if;
  scope_ids:=case when scope_name='raw_customs' then array[p_warehouse_id,'10000000-0000-4000-8000-000000000003'::uuid] else array[p_warehouse_id] end;
  if scope_name='raw_customs' then select coalesce(sum(outstanding_commitment),0) into demand from public.calculate_open_project_commitments(p_product_id);end if;
  select coalesce(sum(public.active_draft_warehouse_hold_quantity(p_product_id,warehouse_id)),0) into held from unnest(scope_ids) warehouse_id;
  return jsonb_build_object('schema',2,'metric_definition','project_demand_plus_work_order_held',
    'product_id',p_product_id,'warehouse_id',p_warehouse_id,'scope',scope_name,'as_of',statement_timestamp(),
    'project_demand',demand::text,'work_order_held',held::text,'committed_quantity',(demand+held)::text);
end;
$f$;

create or replace function public.get_inventory_unified_commitment_breakdown(p_product_id uuid,p_warehouse_id uuid,p_limit integer default 25,p_cursor jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare observation jsonb; scope_ids uuid[]; can_project boolean; can_work_order boolean; rows_visible jsonb;
  source_subtotal numeric; visible_subtotal numeric; before_subtotal numeric; page_subtotal numeric; after_subtotal numeric;
  digest text; after_key text; page_rows jsonb; more boolean; next_key text;
begin
  observation:=public.get_inventory_unified_committed(p_product_id,p_warehouse_id);
  if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'Invalid page limit' using errcode='22023';end if;
  scope_ids:=case when observation->>'scope'='raw_customs' then array[p_warehouse_id,'10000000-0000-4000-8000-000000000003'::uuid] else array[p_warehouse_id] end;
  can_project:=public.current_user_is_admin() or public.has_permission('projects.view');
  can_work_order:=public.current_user_is_admin() or public.has_permission('work_orders.view');
  with sources as (
    select 'project_demand'::text kind,c.project_id id,c.project_name label,c.outstanding_commitment quantity,can_project allowed,'project'::text target
    from public.calculate_open_project_commitments(p_product_id) c where observation->>'scope'='raw_customs' and c.outstanding_commitment>0
    union all
    select 'work_order_held',w.id,w.work_order_number,sum(a.held_quantity::numeric),can_work_order,'work_order'
    from public.work_order_material_reservation_states s join public.work_orders w on w.id=s.live_work_order_id and w.id=s.work_order_id and w.status='draft'
    join public.work_order_material_reservation_allocations a on a.state_id=s.id and a.warehouse_id=any(scope_ids)
    where s.status='active' and s.product_id=p_product_id and a.held_quantity>0 group by w.id,w.work_order_number
  ) select coalesce(jsonb_agg(jsonb_build_object('key',kind||':'||id::text,'source_type',kind,'source_id',id,'label',label,
      'quantity',quantity::text,'navigation_allowed',true,'target_type',target) order by kind,id) filter(where allowed),'[]'::jsonb),
    coalesce(sum(quantity),0),coalesce(sum(quantity) filter(where allowed),0)
    into rows_visible,source_subtotal,visible_subtotal from sources;
  if source_subtotal<>(observation->>'committed_quantity')::numeric then raise exception 'Breakdown consistency unavailable' using errcode='55000';end if;
  digest:=md5(jsonb_build_array(2,auth.uid(),public.current_active_user_profile_id(),observation-'as_of',rows_visible,source_subtotal::text)::text);
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or length(p_cursor::text)>300 or
      (select array_agg(k order by k) from jsonb_object_keys(p_cursor) k) is distinct from array['after_key','snapshot']::text[]
      or p_cursor->>'snapshot' is distinct from digest or not exists(select 1 from jsonb_array_elements(rows_visible) r where r->>'key'=p_cursor->>'after_key') then
      raise exception 'Unified commitment cursor stale; restart' using errcode='ICB01';end if;
    after_key:=p_cursor->>'after_key';
  end if;
  select coalesce(sum((r->>'quantity')::numeric),0) into before_subtotal from jsonb_array_elements(rows_visible) r where r->>'key'<=after_key;
  select coalesce(jsonb_agg(r order by r->>'key'),'[]'::jsonb) into page_rows from
    (select r from jsonb_array_elements(rows_visible) r where after_key is null or r->>'key'>after_key order by r->>'key' limit p_limit) page;
  select coalesce(sum((r->>'quantity')::numeric),0) into page_subtotal from jsonb_array_elements(page_rows) r;
  next_key:=page_rows->-1->>'key';
  more:=exists(select 1 from jsonb_array_elements(rows_visible) r where r->>'key'>next_key);
  after_subtotal:=visible_subtotal-before_subtotal-page_subtotal;
  return jsonb_build_object('schema',2,'observation',observation,'source_subtotal',source_subtotal::text,
    'visible_subtotal',visible_subtotal::text,'restricted_subtotal',(source_subtotal-visible_subtotal)::text,
    'restricted_label',case when source_subtotal>visible_subtotal then 'Restricted sources' else null end,'limit',p_limit,
    'before_subtotal',before_subtotal::text,'page_subtotal',page_subtotal::text,'after_subtotal',after_subtotal::text,
    'items',page_rows,'has_more',more,'next_cursor',case when more then jsonb_build_object('snapshot',digest,'after_key',next_key) else null end);
end;
$f$;
revoke all on function public.get_inventory_unified_committed(uuid,uuid),public.get_inventory_unified_commitment_breakdown(uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_inventory_unified_committed(uuid,uuid),public.get_inventory_unified_commitment_breakdown(uuid,uuid,integer,jsonb) to authenticated;
