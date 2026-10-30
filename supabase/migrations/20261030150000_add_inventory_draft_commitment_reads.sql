-- 175: additive, snapshot-consistent reads. Existing Inventory/health RPCs stay unchanged.
create function public.get_inventory_reservation_accounting(
  p_warehouse_id uuid,p_search text default null,p_active boolean default true,
  p_limit integer default 100,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare permission_key text; observed_at timestamptz:=statement_timestamp(); result jsonb; scope_ids uuid[]; scope_name text;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null then raise exception 'Access denied' using errcode='42501';end if;
  permission_key:=public.inventory_warehouse_permission_key(p_warehouse_id,'view');
  if not(public.current_user_is_admin() or public.has_permission(permission_key))
    or (p_warehouse_id='10000000-0000-4000-8000-000000000001'::uuid and not(public.current_user_is_admin() or public.has_permission('inventory.customs.view'))) then
    raise exception 'Access denied' using errcode='42501';end if;
  if p_limit is null or p_limit<1 or p_limit>200 or p_offset is null or p_offset<0 or p_offset>1000000
    or (p_search is not null and length(p_search)>200) then raise exception 'Invalid accounting pagination' using errcode='22023';end if;
  scope_ids:=case when p_warehouse_id='10000000-0000-4000-8000-000000000001'::uuid then
    array[p_warehouse_id,'10000000-0000-4000-8000-000000000003'::uuid] else array[p_warehouse_id] end;
  scope_name:=case p_warehouse_id when '10000000-0000-4000-8000-000000000001'::uuid then 'raw_customs_planning'
    when '10000000-0000-4000-8000-000000000002'::uuid then 'finished_goods_reservations' else 'customs_physical' end;
  with candidates as materialized (
    select listed.* from public.search_inventory_products_by_warehouse(p_warehouse_id,p_search) listed
    where p_active is null or listed.is_active=p_active order by listed.serial_number,listed.id limit p_limit+1 offset p_offset
  ), page as materialized (select * from candidates order by serial_number,id limit p_limit),
  quantities as (
    select p.id,p.serial_number,p.name,p.is_active,p.quantity physical,
      (select sum(b.quantity::numeric) from public.inventory_balances b where b.product_id=p.id and b.warehouse_id=any(scope_ids)) scope_physical,
      (select count(*) from public.inventory_balances b where b.product_id=p.id and b.warehouse_id=any(scope_ids)) balance_count,
      case when scope_name='raw_customs_planning' then coalesce((select sum(c.outstanding_commitment) from public.calculate_open_project_commitments() c where c.product_id=p.id),0::numeric) else 0::numeric end demand,
      case when scope_name='finished_goods_reservations' then coalesce((select sum(r.reserved_quantity::numeric) from public.finished_goods_project_reservations r where r.product_id=p.id),0::numeric) else 0::numeric end fg,
      coalesce((select sum(t.quantity) from public.active_test_holds_at(observed_at,array[p.id]) t where t.warehouse_id=any(scope_ids)),0::numeric) tests,
      (select sum(public.active_draft_warehouse_hold_quantity(p.id,w)) from unnest(scope_ids) w) held,
      public.active_draft_warehouse_hold_quantity(p.id,p_warehouse_id) warehouse_held
    from page p
  ) select jsonb_build_object('schema',1,'warehouse_id',p_warehouse_id,'quantity_scope',scope_name,'as_of',observed_at,
    'offset',p_offset,'limit',p_limit,'has_more',(select count(*)>p_limit from candidates),
    'complete_sources',coalesce((select bool_and(q.balance_count=cardinality(scope_ids)) from quantities q),true),
    'items',coalesce((select jsonb_agg(jsonb_build_object('product_id',q.id,'serial_number',q.serial_number,'product_name',q.name,'is_active',q.is_active,
      'physical_quantity',q.physical::text,'scope_physical_quantity',q.scope_physical::text,'project_demand_quantity',q.demand::text,
      'fg_reserved_quantity',q.fg::text,'test_held_quantity',q.tests::text,'work_order_held_quantity',q.held::text,
      'warehouse_work_order_held_quantity',q.warehouse_held::text,'project_coverage_quantity','0',
      'available_after_projects',(q.scope_physical-q.demand-q.fg)::text,
      'hard_available_quantity',greatest(q.scope_physical-q.fg-q.tests-q.held,0::numeric)::text,
      'net_available_after_all_commitments',(q.scope_physical-q.demand-q.fg-q.tests-q.held)::text) order by q.serial_number,q.id) from quantities q),'[]'::jsonb)) into result;
  if not(result->>'complete_sources')::boolean then raise exception 'Inventory source data unavailable' using errcode='55000';end if;
  return result-'complete_sources';
end;
$f$;

-- Additive Work Order read: same authority/snapshot as existing availability.
-- R is saved aggregate demand even for legacy/uninitialized Drafts; H is real
-- live allocation only. U is not a physical hold and has no warehouse assignment.
create function public.get_work_order_material_commitment_status(p_work_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare base jsonb; materials jsonb;
begin
  base:=public.get_work_order_material_availability(p_work_order_id);
  if exists(select 1 from jsonb_array_elements(base->'materials') m where
    coalesce((select t.held_quantity::numeric from public.work_order_material_reservation_totals t
      where t.work_order_id=p_work_order_id and t.product_id=(m->>'product_id')::uuid),0)>(m->>'required_quantity')::numeric) then
    raise exception 'Work Order commitment state unavailable' using errcode='55000';end if;
  select coalesce(jsonb_agg(m.value||jsonb_build_object('held_quantity',coalesce(t.held_quantity::text,'0'),
    'uncovered_quantity',((m.value->>'required_quantity')::numeric-coalesce(t.held_quantity,0)::numeric)::text,
    'reservation_initialized',t.id is not null) order by m.ordinality),'[]'::jsonb) into materials
  from jsonb_array_elements(base->'materials') with ordinality m(value,ordinality)
  left join public.work_order_material_reservation_totals t on t.work_order_id=p_work_order_id and t.product_id=(m.value->>'product_id')::uuid;
  return base||jsonb_build_object('materials',materials);
end;
$f$;

-- Coalesce allocation-only changes into the existing deferred Product queue.
-- Never lock Work Orders/Projects from a stock/allocation trigger.
create function public.queue_draft_commitment_shortage_reconciliation()
returns trigger language plpgsql volatile security definer set search_path='' as $f$
declare affected uuid; before_id uuid; after_id uuid;
begin
  if tg_table_name='work_order_material_reservation_allocations' then
    if tg_op<>'INSERT' then before_id:=old.state_id;end if;
    if tg_op<>'DELETE' then after_id:=new.state_id;end if;
    for affected in select distinct s.product_id from public.work_order_material_reservation_states s where s.id in (before_id,after_id) order by s.product_id loop
      insert into public.work_order_material_shortage_reconciliation_queue(transaction_id,product_id) values(txid_current(),affected) on conflict do nothing;
    end loop;
  else
    if tg_op<>'INSERT' then before_id:=old.product_id;end if;
    if tg_op<>'DELETE' then after_id:=new.product_id;end if;
    for affected in select distinct v.id from (values(before_id),(after_id)) v(id) where v.id is not null order by v.id loop
      insert into public.work_order_material_shortage_reconciliation_queue(transaction_id,product_id) values(txid_current(),affected) on conflict do nothing;
    end loop;
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end;
$f$;
create trigger draft_allocations_queue_material_shortage after insert or update or delete
on public.work_order_material_reservation_allocations for each row execute function public.queue_draft_commitment_shortage_reconciliation();
create trigger draft_states_queue_material_shortage after insert or update of status,live_work_order_id or delete
on public.work_order_material_reservation_states for each row execute function public.queue_draft_commitment_shortage_reconciliation();
revoke all on function public.get_inventory_reservation_accounting(uuid,text,boolean,integer,integer),
  public.get_work_order_material_commitment_status(uuid),public.queue_draft_commitment_shortage_reconciliation() from public,anon,authenticated,service_role;
grant execute on function public.get_inventory_reservation_accounting(uuid,text,boolean,integer,integer),public.get_work_order_material_commitment_status(uuid) to authenticated;
