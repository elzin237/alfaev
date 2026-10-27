-- TC-03: authorized reads only. No Save, stock protection, or expiry mutation.
create function public.search_test_calculator_products(p_search text default null, p_limit integer default 50)
returns table (product_id uuid, name text, serial_number text, product_kind text, source_policy text)
language plpgsql stable security definer set search_path = '' as $function$
declare term text := nullif(pg_catalog.btrim(p_search), ''); fg_access boolean; all_access boolean;
begin
  if public.current_active_user_profile_id() is null or not (public.current_user_is_admin() or (
    public.has_permission('test_calculator.view') and public.has_permission('test_calculator.manage')
  )) then raise exception 'Access denied' using errcode = '42501'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or pg_catalog.length(term) > 200 then
    raise exception 'Invalid search parameters' using errcode = '22023'; end if;
  fg_access := public.current_user_is_admin() or public.has_permission('inventory.finished_goods.view');
  all_access := fg_access and (public.current_user_is_admin() or (
    public.has_permission('inventory.raw_materials.view') and public.has_permission('inventory.customs.view')));
  if not fg_access then raise exception 'Access denied' using errcode = '42501'; end if;
  return query
  select product.id, product.name, product.serial_number, product.product_kind,
    case when public.is_calculator_finished_product(product.id) then 'finished_goods_only' else 'raw_customs_fg' end
  from public.products product
  where product.is_active and (
    public.is_calculator_finished_product(product.id) or (product.product_kind = 'component' and all_access)
  ) and (term is null or pg_catalog.strpos(pg_catalog.lower(product.name),pg_catalog.lower(term)) > 0
    or pg_catalog.strpos(product.serial_number,term) = 1)
  order by product.serial_number, product.id limit p_limit;
end;
$function$;
revoke all on function public.search_test_calculator_products(text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_test_calculator_products(text,integer) to authenticated;

-- Quantities enter and leave as decimal strings: no JSON number can round bigint.
-- No context/exclusion parameter: a caller cannot ignore its own existing holds.
create function public.preview_test_calculation(p_items jsonb)
returns table (
  product_id uuid, name text, serial_number text, product_kind text,
  required_quantity text, eligible_free_quantity text, project_priority_quantity text,
  eligible_availability text, reservable_quantity text, missing_quantity text,
  provisional_warehouse_quantities jsonb, as_of timestamptz, save_will_recalculate boolean
)
language plpgsql stable security definer set search_path = '' as $function$
declare entry jsonb; ids uuid[] := '{}'::uuid[]; key uuid; read_at timestamptz := pg_catalog.statement_timestamp();
  fg_access boolean; all_access boolean;
begin
  if public.current_active_user_profile_id() is null or not (public.current_user_is_admin() or (
    public.has_permission('test_calculator.view') and public.has_permission('test_calculator.manage')
  )) then raise exception 'Access denied' using errcode = '42501'; end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'Items must be an array' using errcode = '22023'; end if;
  if pg_catalog.jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Select 1 to 100 Products' using errcode = '22023'; end if;
  for entry in select element.value from pg_catalog.jsonb_array_elements(p_items) element loop
    if pg_catalog.jsonb_typeof(entry) <> 'object' then
      raise exception 'Invalid item' using errcode = '22023'; end if;
    if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(entry)) <> 2
      or not (entry ? 'product_id' and entry ? 'quantity')
      or pg_catalog.jsonb_typeof(entry->'product_id') <> 'string'
      or pg_catalog.jsonb_typeof(entry->'quantity') <> 'string'
      or (entry->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.length(entry->>'quantity') > 19
      or (entry->>'quantity') !~ '^[1-9][0-9]*$'
    then raise exception 'Invalid item' using errcode = '22023'; end if;
    if (entry->>'quantity')::numeric > 9223372036854775807::numeric then
      raise exception 'Quantity exceeds bigint range' using errcode = '22023'; end if;
    key := (entry->>'product_id')::uuid;
    if key = any(ids) then raise exception 'Duplicate Product' using errcode = '22023'; end if;
    ids := pg_catalog.array_append(ids,key);
  end loop;
  fg_access := public.current_user_is_admin() or public.has_permission('inventory.finished_goods.view');
  all_access := fg_access and (public.current_user_is_admin() or (
    public.has_permission('inventory.raw_materials.view') and public.has_permission('inventory.customs.view')));
  -- One generic denial for missing, archived, unlinked finished, or unauthorized IDs.
  if exists (select 1 from pg_catalog.unnest(ids) requested(id)
    left join public.products product on product.id = requested.id
    where product.id is null or not product.is_active or not fg_access
      or not (public.is_calculator_finished_product(product.id) or (product.product_kind = 'component' and all_access)))
  then raise exception 'Access denied' using errcode = '42501'; end if;
  -- Missing structural balances are not fabricated zero stock.
  if exists (select 1 from public.products product where product.id = any(ids) and (
    select pg_catalog.count(*) from public.inventory_balances balance where balance.product_id = product.id
      and (not public.is_calculator_finished_product(product.id)
        or balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid)
  ) <> case when public.is_calculator_finished_product(product.id) then 1 else 3 end)
  then raise exception 'Test source data unavailable' using errcode = '55000'; end if;

  return query
  with requested as (
    select (element.value->>'product_id')::uuid id, (element.value->>'quantity')::numeric required
    from pg_catalog.jsonb_array_elements(p_items) element
  ), identities as (
    select requested.*, product.name product_name, product.serial_number serial, product.product_kind kind,
      public.is_calculator_finished_product(product.id) finished
    from requested join public.products product on product.id = requested.id
  ), active_tests as (
    select hold.product_id, hold.warehouse_id, pg_catalog.sum(hold.quantity::numeric) quantity
    from public.test_calculation_holds hold join public.test_calculations calculation on calculation.id = hold.calculation_id
    where hold.product_id = any(ids) and calculation.expires_at > read_at
    group by hold.product_id,hold.warehouse_id
  ), projects as (
    select state.product_id, pg_catalog.sum(state.reserved_quantity::numeric) quantity
    from public.finished_goods_project_reservations state where state.product_id = any(ids) group by state.product_id
  ), free as (
    select identity.*, balance.warehouse_id, warehouse.code, public.production_warehouse_priority(balance.warehouse_id) priority,
      greatest(balance.quantity::numeric - coalesce(active_tests.quantity,0::numeric) -
        case when warehouse.code = 'finished_goods' then coalesce(projects.quantity,0::numeric) else 0::numeric end,0::numeric) quantity
    from identities identity join public.inventory_balances balance on balance.product_id = identity.id
    join public.inventory_warehouses warehouse on warehouse.id = balance.warehouse_id
    left join active_tests on active_tests.product_id = identity.id and active_tests.warehouse_id = balance.warehouse_id
    left join projects on projects.product_id = identity.id
    where not identity.finished or warehouse.code = 'finished_goods'
  ), demand as (
    select identity.id, case when identity.finished then 0::numeric else coalesce((
      select pg_catalog.sum(commitment.outstanding_commitment) from public.calculate_open_project_commitments(identity.id) commitment
    ),0::numeric) end quantity from identities identity
  ), totals as (
    select free.id, pg_catalog.sum(free.quantity) free_quantity,
      greatest(pg_catalog.sum(free.quantity) - demand.quantity,0::numeric) capacity, demand.quantity project_quantity
    from free join demand on demand.id = free.id group by free.id,demand.quantity
  ), ordered as (
    select free.*, totals.free_quantity, totals.capacity, totals.project_quantity,
      least(free.required,totals.capacity) reservable,
      coalesce(pg_catalog.sum(free.quantity) over (partition by free.id order by free.priority
        rows between unbounded preceding and 1 preceding),0::numeric) preceding_quantity
    from free join totals on totals.id = free.id
  )
  select ordered.id, ordered.product_name, ordered.serial, ordered.kind, ordered.required::text,
    ordered.free_quantity::text, ordered.project_quantity::text, ordered.capacity::text,
    ordered.reservable::text, (ordered.required - ordered.reservable)::text,
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('warehouse_id',ordered.warehouse_id,'warehouse_code',ordered.code,
      'quantity',least(ordered.quantity,greatest(ordered.reservable-ordered.preceding_quantity,0::numeric))::text) order by ordered.priority),
    read_at, true
  from ordered group by ordered.id,ordered.product_name,ordered.serial,ordered.kind,ordered.required,
    ordered.free_quantity,ordered.project_quantity,ordered.capacity,ordered.reservable
  order by ordered.serial,ordered.id;
end;
$function$;
revoke all on function public.preview_test_calculation(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.preview_test_calculation(jsonb) to authenticated;
