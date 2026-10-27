-- Calculator-linked inputs consume only already-manufactured, unreserved FG.
-- No historical stock movement, reservation backfill or BOM expansion.
create or replace function public.get_production_eligible_quantity(p_product_id uuid)
returns bigint language sql stable security invoker set search_path = '' as $function$
  select coalesce(pg_catalog.sum(case when balance.warehouse_id =
    '10000000-0000-4000-8000-000000000002'::uuid then greatest(balance.quantity::numeric - coalesce((
      select pg_catalog.sum(state.reserved_quantity::numeric)
      from public.finished_goods_project_reservations state where state.product_id = p_product_id
    ), 0::numeric), 0::numeric) else balance.quantity::numeric end), 0::numeric)::bigint
  from public.inventory_balances balance where balance.product_id = p_product_id
    and (balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid
      or not exists (select 1 from public.pcb_cards card
        join public.products product on product.id = card.output_product_id
        where card.output_product_id = p_product_id and product.product_kind = 'pcb_finished_good'))
    and balance.warehouse_id in ('10000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000003'::uuid, '10000000-0000-4000-8000-000000000002'::uuid);
$function$;
revoke all on function public.get_production_eligible_quantity(uuid)
  from public, anon, authenticated, service_role;

-- Keep the existing projection, FIFO order, warehouse priority and fingerprints.
-- Product -> balances -> lots is compatible with the existing production paths.
create or replace function public.get_work_order_warehouse_source_allocation_plan(p_work_order_id uuid)
returns table (product_id uuid, warehouse_id uuid, warehouse_code text, warehouse_name text,
  warehouse_priority smallint, source_lot_id uuid, source_kind text,
  supplier_name_snapshot text, catalog_number_snapshot text,
  supplier_description_snapshot text, allocated_quantity bigint, received_at timestamptz)
language plpgsql volatile security invoker set search_path = '' as $function$
declare material record; available_fg numeric; planned_quantity numeric; finished_input boolean;
begin
  if p_work_order_id is null then raise exception 'Work Order ID is required' using errcode = '22023'; end if;
  for material in
    select item.product_id, pg_catalog.sum(item.quantity::numeric)::bigint quantity
    from public.work_order_items item where item.work_order_id = p_work_order_id
    group by item.product_id order by item.product_id
  loop
    perform product.id from public.products product where product.id = material.product_id for share;
    select product.product_kind = 'pcb_finished_good' and exists (
      select 1 from public.pcb_cards card where card.output_product_id = product.id)
      into finished_input from public.products product where product.id = material.product_id;
    perform balance.product_id from public.inventory_balances balance
      where balance.product_id = material.product_id
      order by public.production_warehouse_priority(balance.warehouse_id) for update;
    select greatest(balance.quantity::numeric - coalesce((
      select pg_catalog.sum(state.reserved_quantity::numeric)
      from public.finished_goods_project_reservations state where state.product_id = material.product_id
    ), 0::numeric), 0::numeric) into available_fg
      from public.inventory_balances balance where balance.product_id = material.product_id
        and balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid;
    perform lot.id from public.inventory_source_lots lot
      where lot.product_id = material.product_id and lot.remaining_quantity > 0
        and (not finished_input or lot.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid)
      order by public.production_warehouse_priority(lot.warehouse_id), lot.received_at, lot.id for update;
    select coalesce(pg_catalog.sum(case when lot.warehouse_id <>
      '10000000-0000-4000-8000-000000000002'::uuid then lot.remaining_quantity::numeric else 0::numeric end),0::numeric)
      + least(coalesce(available_fg,0::numeric),coalesce(pg_catalog.sum(case when lot.warehouse_id =
      '10000000-0000-4000-8000-000000000002'::uuid then lot.remaining_quantity::numeric else 0::numeric end),0::numeric))
      into planned_quantity from public.inventory_source_lots lot
      where lot.product_id = material.product_id and lot.remaining_quantity > 0
        and (not finished_input or lot.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid);
    if planned_quantity < material.quantity::numeric then
      raise exception 'Insufficient physical Inventory' using errcode = 'IVB02';
    end if;
    return query
    with lot_prefix as (
      select lot.*, public.production_warehouse_priority(lot.warehouse_id) priority,
        coalesce(pg_catalog.sum(lot.remaining_quantity::numeric) over (
          partition by lot.warehouse_id order by lot.received_at, lot.id
          rows between unbounded preceding and 1 preceding),0::numeric) before_in_warehouse
      from public.inventory_source_lots lot where lot.product_id = material.product_id and lot.remaining_quantity > 0
        and (not finished_input or lot.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid)
    ), eligible as (
      select prefix.*, case when prefix.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid
        then least(prefix.remaining_quantity::numeric,
          greatest(coalesce(available_fg,0::numeric) - prefix.before_in_warehouse,0::numeric))
        else prefix.remaining_quantity::numeric end usable
      from lot_prefix prefix
    ), fifo as (
      select eligible.*, coalesce(pg_catalog.sum(eligible.usable) over (
        order by eligible.priority, eligible.received_at, eligible.id
        rows between unbounded preceding and 1 preceding),0::numeric) before_in_plan
      from eligible where eligible.usable > 0
    )
    select fifo.product_id, fifo.warehouse_id, warehouse.code, warehouse.display_name,
      fifo.priority, fifo.id, fifo.source_kind, fifo.supplier_name_snapshot,
      fifo.catalog_number_snapshot, fifo.supplier_description_snapshot,
      least(fifo.usable,material.quantity::numeric - fifo.before_in_plan)::bigint, fifo.received_at
    from fifo join public.inventory_warehouses warehouse on warehouse.id = fifo.warehouse_id
    where fifo.before_in_plan < material.quantity::numeric
    order by fifo.priority, fifo.received_at, fifo.id;
  end loop;
end;
$function$;
revoke all on function public.get_work_order_warehouse_source_allocation_plan(uuid)
  from public, anon, authenticated, service_role;


-- Warehouse-only aggregate: no Project identities or Project-view requirement.
create function public.get_finished_goods_inventory_commitments()
returns table (product_id uuid, physical_quantity bigint,
  committed_to_projects bigint, available_after_commitments bigint)
language plpgsql stable security definer set search_path = '' as $function$
begin
  if public.current_active_user_profile_id() is null or not (
    public.current_user_is_admin() or public.has_permission('inventory.finished_goods.view')
  ) then raise exception 'Access denied' using errcode = '42501'; end if;

  return query
  with reserved as (
    select state.product_id, pg_catalog.sum(state.reserved_quantity::numeric) quantity
    from public.finished_goods_project_reservations state
    where state.reserved_quantity > 0 group by state.product_id
  )
  select product.id, coalesce(balance.quantity,0::bigint),
    coalesce(reserved.quantity,0::numeric)::bigint,
    (coalesce(balance.quantity,0::bigint)::numeric - coalesce(reserved.quantity,0::numeric))::bigint
  from public.products product
  left join public.inventory_balances balance on balance.product_id = product.id
    and balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid
  left join reserved on reserved.product_id = product.id
  where exists (select 1 from public.pcb_cards card where card.output_product_id = product.id)
  order by product.serial_number, product.id;
end;
$function$;
revoke all on function public.get_finished_goods_inventory_commitments()
  from public, anon, authenticated, service_role;
grant execute on function public.get_finished_goods_inventory_commitments() to authenticated;
