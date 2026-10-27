-- TC-06: preserve production accounting and contracts; change free capacity only.
create function public.get_production_free_warehouse_quantity(p_product_id uuid,p_warehouse_id uuid)
returns numeric language sql volatile security invoker set search_path = '' as $function$
  select coalesce((select greatest(balance.quantity::numeric
    - public.active_test_warehouse_hold_quantity(balance.product_id,balance.warehouse_id)
    - case when balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid
      then coalesce((select pg_catalog.sum(state.reserved_quantity::numeric)
        from public.finished_goods_project_reservations state where state.product_id = balance.product_id),0::numeric)
      else 0::numeric end,0::numeric)
    from public.inventory_balances balance where balance.product_id = p_product_id
      and balance.warehouse_id = p_warehouse_id),0::numeric);
$function$;
revoke all on function public.get_production_free_warehouse_quantity(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function public.get_production_eligible_quantity(p_product_id uuid)
returns bigint language sql volatile security invoker set search_path = '' as $function$
  select coalesce(pg_catalog.sum(public.get_production_free_warehouse_quantity(balance.product_id,balance.warehouse_id)),0::numeric)::bigint
  from public.inventory_balances balance where balance.product_id = p_product_id
    and (not public.is_calculator_finished_product(p_product_id)
      or balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid)
    and balance.warehouse_id in ('10000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000003'::uuid,'10000000-0000-4000-8000-000000000002'::uuid);
$function$;
revoke all on function public.get_production_eligible_quantity(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.get_work_order_warehouse_source_allocation_plan(p_work_order_id uuid)
returns table (product_id uuid, warehouse_id uuid, warehouse_code text, warehouse_name text,
  warehouse_priority smallint, source_lot_id uuid, source_kind text,
  supplier_name_snapshot text, catalog_number_snapshot text,
  supplier_description_snapshot text, allocated_quantity bigint, received_at timestamptz)
language plpgsql volatile security invoker set search_path = '' as $function$
declare material record; finished_input boolean; planned_quantity numeric; capacities jsonb;
begin
  if p_work_order_id is null then raise exception 'Work Order ID is required' using errcode = '22023'; end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Production plan requires READ COMMITTED isolation' using errcode = '25000'; end if;
  for material in
    select item.product_id,pg_catalog.sum(item.quantity::numeric)::bigint quantity
    from public.work_order_items item where item.work_order_id = p_work_order_id
    group by item.product_id order by item.product_id
  loop
    perform product.id from public.products product where product.id = material.product_id for share;
    finished_input := public.is_calculator_finished_product(material.product_id);
    perform balance.product_id from public.inventory_balances balance where balance.product_id = material.product_id
      order by public.production_warehouse_priority(balance.warehouse_id) for update;
    perform lot.id from public.inventory_source_lots lot where lot.product_id = material.product_id and lot.remaining_quantity > 0
      and (not finished_input or lot.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid)
      order by public.production_warehouse_priority(lot.warehouse_id),lot.received_at,lot.id for update;
    -- All blocking Product/balance/lot locks precede the wall-clock hold reads.
    -- Freeze each warehouse capacity for this one plan; holds reserve quantities,
    -- not lot identities. No soft Project-demand deduction belongs in production.
    select pg_catalog.jsonb_object_agg(balance.warehouse_id::text,
      public.get_production_free_warehouse_quantity(balance.product_id,balance.warehouse_id)::text)
      into capacities from public.inventory_balances balance where balance.product_id = material.product_id
      and (not finished_input or balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid);
    select coalesce(pg_catalog.sum(least(lots.quantity,coalesce((capacities->>lots.warehouse_id::text)::numeric,0::numeric))),0::numeric)
      into planned_quantity from (
        select lot.warehouse_id,pg_catalog.sum(lot.remaining_quantity::numeric) quantity
        from public.inventory_source_lots lot where lot.product_id = material.product_id and lot.remaining_quantity > 0
          and (not finished_input or lot.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid)
        group by lot.warehouse_id
      ) lots;
    if planned_quantity < material.quantity::numeric then
      raise exception 'Insufficient physical Inventory' using errcode = 'IVB02'; end if;
    return query
    with lot_prefix as (
      select lot.*,public.production_warehouse_priority(lot.warehouse_id) priority,
        coalesce(pg_catalog.sum(lot.remaining_quantity::numeric) over (
          partition by lot.warehouse_id order by lot.received_at,lot.id rows between unbounded preceding and 1 preceding),0::numeric) before_in_warehouse
      from public.inventory_source_lots lot where lot.product_id = material.product_id and lot.remaining_quantity > 0
        and (not finished_input or lot.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid)
    ), eligible as (
      select prefix.*,least(prefix.remaining_quantity::numeric,
        greatest(coalesce((capacities->>prefix.warehouse_id::text)::numeric,0::numeric)-prefix.before_in_warehouse,0::numeric)) usable
      from lot_prefix prefix
    ), fifo as (
      select eligible.*,coalesce(pg_catalog.sum(eligible.usable) over (
        order by eligible.priority,eligible.received_at,eligible.id rows between unbounded preceding and 1 preceding),0::numeric) before_in_plan
      from eligible where eligible.usable > 0
    )
    select fifo.product_id,fifo.warehouse_id,warehouse.code,warehouse.display_name,
      fifo.priority,fifo.id,fifo.source_kind,fifo.supplier_name_snapshot,
      fifo.catalog_number_snapshot,fifo.supplier_description_snapshot,
      least(fifo.usable,material.quantity::numeric-fifo.before_in_plan)::bigint,fifo.received_at
    from fifo join public.inventory_warehouses warehouse on warehouse.id = fifo.warehouse_id
    where fifo.before_in_plan < material.quantity::numeric order by fifo.priority,fifo.received_at,fifo.id;
  end loop;
end;
$function$;
revoke all on function public.get_work_order_warehouse_source_allocation_plan(uuid)
  from public, anon, authenticated, service_role;
