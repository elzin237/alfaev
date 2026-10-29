-- WO-07: explicit operator-only initialization; deployment itself writes no history.
-- The existing reconciler also visits other Drafts sharing a selected Product.
-- Bound that entire scope, not merely a caller's nominated Work Order.
create function public.initialize_work_order_material_shortages(
  p_product_ids uuid[], p_max_pairs integer default 100
)
returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
declare
  selected_product uuid;
  pair_count integer;
begin
  if p_product_ids is null or cardinality(p_product_ids) not between 1 and 20
    or array_ndims(p_product_ids) <> 1
    or array_position(p_product_ids,null) is not null
    or (select count(distinct id) from unnest(p_product_ids) id) <> cardinality(p_product_ids)
    or p_max_pairs is null or p_max_pairs not between 1 and 100 then
    raise exception 'Invalid bounded shortage initialization scope' using errcode='22023';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Read committed isolation required' using errcode='25001';
  end if;
  -- Freeze candidate membership before measuring the bound. No balance locks or
  -- accounting writes; callers must use a short lock/statement timeout.
  lock table public.work_orders, public.work_order_items in share mode;
  if exists(select 1 from unnest(p_product_ids) as selected(id)
    where not exists(select 1 from public.products p where p.id=selected.id)) then
    raise exception 'Unknown Product in initialization scope' using errcode='22023';
  end if;
  select count(*) into pair_count from (
    select i.product_id,i.work_order_id from public.work_order_items i
      join public.work_orders w on w.id=i.work_order_id and w.status='draft'
      where i.product_id=any(p_product_ids)
    union
    select e.product_id,e.work_order_id from public.work_order_material_shortage_episodes e
      where e.product_id=any(p_product_ids) and e.resolved_at is null
  ) candidates;
  if pair_count > p_max_pairs then
    raise exception 'Shortage initialization exceeds approved pair bound' using errcode='54000';
  end if;
  for selected_product in select id from unnest(p_product_ids) id order by id loop
    perform public.reconcile_work_order_material_shortages_for_product(selected_product);
  end loop;
  return jsonb_build_object('processed_products',cardinality(p_product_ids)::text,
    'affected_pairs',pair_count::text);
end;
$fn$;
revoke all on function public.initialize_work_order_material_shortages(uuid[],integer)
  from public,anon,authenticated,service_role;
comment on function public.initialize_work_order_material_shortages(uuid[],integer) is
  'Operator-only bounded reconciliation. Explicit approved transaction required; never invoked by Dashboard reads. Does not replay old delivery intents.';
