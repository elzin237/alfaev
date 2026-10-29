-- WO-01: snapshot-safe advisory availability; never reserves or posts Inventory.
-- Share the existing production capacity rule, with an explicit observation time.
create function public.get_production_free_warehouse_quantity_at(
  p_product_id uuid, p_warehouse_id uuid, p_as_of timestamptz
)
returns numeric language sql stable security invoker set search_path = '' as $function$
  select coalesce((select greatest(balance.quantity::numeric
    - coalesce((select pg_catalog.sum(hold.quantity::numeric)
      from public.test_calculation_holds hold
      join public.test_calculations calculation on calculation.id = hold.calculation_id
      where hold.product_id = balance.product_id and hold.warehouse_id = balance.warehouse_id
        and calculation.expires_at > p_as_of),0::numeric)
    - case when balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid
      then coalesce((select pg_catalog.sum(state.reserved_quantity::numeric)
        from public.finished_goods_project_reservations state
        where state.product_id = balance.product_id),0::numeric)
      else 0::numeric end,0::numeric)
    from public.inventory_balances balance where balance.product_id = p_product_id
      and balance.warehouse_id = p_warehouse_id),0::numeric);
$function$;
revoke all on function public.get_production_free_warehouse_quantity_at(uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;

-- Preserve the production API, volatility and post-lock wall-clock semantics.
-- Only factor the unchanged arithmetic into the common snapshot-safe core.
create or replace function public.get_production_free_warehouse_quantity(p_product_id uuid,p_warehouse_id uuid)
returns numeric language sql volatile security invoker set search_path = '' as $function$
  select public.get_production_free_warehouse_quantity_at(
    p_product_id,p_warehouse_id,pg_catalog.clock_timestamp());
$function$;
revoke all on function public.get_production_free_warehouse_quantity(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.get_work_order_material_availability(p_work_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  current_order public.work_orders%rowtype;
  observed_at timestamptz := pg_catalog.statement_timestamp();
  materials jsonb;
begin
  -- Same authority as Work Order detail, with explicit active-profile validation.
  if auth.uid() is null or public.current_active_user_profile_id() is null
    or not (public.current_user_is_admin() or public.has_permission('work_orders.view')) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_work_order_id is null then
    raise exception 'Work Order ID is required' using errcode = '22023';
  end if;
  select work_order.* into current_order from public.work_orders work_order
    where work_order.id = p_work_order_id;
  if not found then raise exception 'Work Order not found' using errcode = 'P0002'; end if;
  if current_order.status <> 'draft' then
    raise exception 'Draft Work Order is required' using errcode = 'WOR02';
  end if;

  -- Structural balances must exist. Missing state is an error, not invented zero.
  if exists (select 1 from public.work_order_items item
    cross join (values ('10000000-0000-4000-8000-000000000001'::uuid),
      ('10000000-0000-4000-8000-000000000002'::uuid),
      ('10000000-0000-4000-8000-000000000003'::uuid)) warehouse(id)
    left join public.inventory_balances balance on balance.product_id = item.product_id
      and balance.warehouse_id = warehouse.id
    where item.work_order_id = p_work_order_id and balance.product_id is null) then
    raise exception 'Inventory balance not found' using errcode = 'IVB01';
  end if;

  -- Every nested read is STABLE: one caller MVCC snapshot and one expiry instant.
  with required as materialized (
    select item.product_id,pg_catalog.sum(item.quantity::numeric)::bigint quantity
    from public.work_order_items item where item.work_order_id = p_work_order_id
    group by item.product_id
  ), availability as materialized (
    select product.id,product.serial_number,product.name,product.is_active,
      required.quantity required_quantity,
      (select pg_catalog.sum(public.get_production_free_warehouse_quantity_at(
        balance.product_id,balance.warehouse_id,observed_at))::bigint
        from public.inventory_balances balance where balance.product_id = product.id
          and balance.warehouse_id in ('10000000-0000-4000-8000-000000000001'::uuid,
            '10000000-0000-4000-8000-000000000002'::uuid,
            '10000000-0000-4000-8000-000000000003'::uuid)
          and (not public.is_calculator_finished_product(product.id)
            or balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid)
      ) eligible_quantity
    from required join public.products product on product.id = required.product_id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'product_id',available.id,'serial_number',available.serial_number,
    'product_name',available.name,'product_is_active',available.is_active,
    'required_quantity',available.required_quantity::text,
    'eligible_quantity',available.eligible_quantity::text,
    'missing_quantity',greatest(available.required_quantity::numeric
      - available.eligible_quantity::numeric,0::numeric)::text,
    'has_shortage',available.required_quantity > available.eligible_quantity
  ) order by available.serial_number,available.id),'[]'::jsonb) into materials
  from availability available;

  return pg_catalog.jsonb_build_object('work_order_id',current_order.id,
    'work_order_number',current_order.work_order_number,'status',current_order.status,
    'updated_at',current_order.updated_at,'as_of',observed_at,'materials',materials);
end;
$function$;
revoke all on function public.get_work_order_material_availability(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_work_order_material_availability(uuid) to authenticated;
