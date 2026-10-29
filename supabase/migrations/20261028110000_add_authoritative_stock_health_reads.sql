-- LS-02: physical-stock classification only; no accounting or configuration writes.
create function public.inventory_stock_health_status(p_physical bigint, p_minimum bigint)
returns text language sql immutable security invoker set search_path = '' as $function$
  select case when p_minimum is null then 'NOT_CONFIGURED'
    when p_physical = 0 then 'OUT_OF_STOCK'
    when p_physical < p_minimum then 'LOW_STOCK' else 'HEALTHY' end;
$function$;
revoke all on function public.inventory_stock_health_status(bigint,bigint)
  from public, anon, authenticated, service_role;

-- Private shared projection. The existing listing enforces warehouse authorization
-- and authoritative membership; callers run under the same statement snapshot.
create function public.inventory_stock_health_rows(p_warehouse_id uuid, p_search text, p_active boolean)
returns table (
  product_id uuid, serial_number text, product_name text, is_active boolean,
  warehouse_id uuid, warehouse_code text, warehouse_name text,
  physical_quantity bigint, minimum_quantity bigint, health_status text, configuration_version bigint
)
language sql stable security invoker set search_path = '' as $function$
  select listed.id, listed.serial_number, listed.name, listed.is_active,
    warehouse.id, warehouse.code, warehouse.display_name, listed.quantity,
    minimum.minimum_quantity,
    public.inventory_stock_health_status(listed.quantity, minimum.minimum_quantity), minimum.version
  from public.search_inventory_products_by_warehouse(p_warehouse_id,p_search) listed
  join public.inventory_warehouses warehouse on warehouse.id = listed.warehouse_id
  left join public.inventory_stock_minimums minimum
    on minimum.product_id = listed.id and minimum.warehouse_id = listed.warehouse_id
  where p_active is null or listed.is_active = p_active;
$function$;
revoke all on function public.inventory_stock_health_rows(uuid,text,boolean)
  from public, anon, authenticated, service_role;

create function public.get_inventory_stock_health(
  p_warehouse_id uuid, p_search text default null, p_health_status text default null,
  p_active boolean default true, p_limit integer default 100, p_offset integer default 0
)
returns table (
  product_id uuid, serial_number text, product_name text, is_active boolean,
  warehouse_id uuid, warehouse_code text, warehouse_name text,
  physical_quantity text, minimum_quantity text, health_status text, configuration_version text
)
language plpgsql stable security definer set search_path = '' as $function$
declare required_permission text;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null then
    raise exception 'Access denied' using errcode = '42501'; end if;
  required_permission := public.inventory_warehouse_permission_key(p_warehouse_id,'view');
  if not (public.current_user_is_admin() or public.has_permission(required_permission)) then
    raise exception 'Access denied' using errcode = '42501'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 or p_offset is null or p_offset < 0
    or (p_search is not null and pg_catalog.length(p_search) > 200)
    or (p_health_status is not null and p_health_status not in (
      'NOT_CONFIGURED','OUT_OF_STOCK','LOW_STOCK','HEALTHY')) then
    raise exception 'Invalid stock health filters or pagination' using errcode = '22023'; end if;
  return query select health.product_id,health.serial_number,health.product_name,health.is_active,
    health.warehouse_id,health.warehouse_code,health.warehouse_name,
    health.physical_quantity::text,health.minimum_quantity::text,health.health_status,
    health.configuration_version::text
  from public.inventory_stock_health_rows(p_warehouse_id,p_search,p_active) health
  where p_health_status is null or health.health_status = p_health_status
  order by pg_catalog.lower(health.product_name),health.product_id
  limit p_limit offset p_offset;
end;
$function$;
revoke all on function public.get_inventory_stock_health(uuid,text,text,boolean,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_inventory_stock_health(uuid,text,text,boolean,integer,integer) to authenticated;

create function public.get_dashboard_stock_health(p_critical_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null
    or not (public.current_user_is_admin() or public.has_permission('dashboard.view')) then
    raise exception 'Access denied' using errcode = '42501'; end if;
  if p_critical_limit is null or p_critical_limit < 1 or p_critical_limit > 100 then
    raise exception 'Critical item limit must be between 1 and 100' using errcode = '22023'; end if;
  -- One materialized authorized projection supplies both sections. STABLE uses
  -- the calling statement's MVCC snapshot, including nested listing functions.
  with authorized as materialized (
    select warehouse.id,warehouse.code,warehouse.display_name,warehouse.sort_order
    from public.inventory_warehouses warehouse
    where public.current_user_is_admin() or public.has_permission(
      public.inventory_warehouse_permission_key(warehouse.id,'view'))
  ), health as materialized (
    select health_row.* from authorized warehouse
    cross join lateral public.inventory_stock_health_rows(warehouse.id,null,true) health_row
  ), summaries as (
    select warehouse.id,warehouse.code,warehouse.display_name,warehouse.sort_order,
      pg_catalog.count(health.product_id) total,
      pg_catalog.count(health.product_id) filter (where health.health_status='HEALTHY') healthy,
      pg_catalog.count(health.product_id) filter (where health.health_status='LOW_STOCK') low_stock,
      pg_catalog.count(health.product_id) filter (where health.health_status='OUT_OF_STOCK') out_of_stock,
      pg_catalog.count(health.product_id) filter (where health.health_status='NOT_CONFIGURED') not_configured
    from authorized warehouse left join health on health.warehouse_id=warehouse.id
    group by warehouse.id,warehouse.code,warehouse.display_name,warehouse.sort_order
  ), critical as materialized (
    select health.*,case when health.health_status='OUT_OF_STOCK' then 0 else 1 end priority
    from health where health.health_status in ('OUT_OF_STOCK','LOW_STOCK')
    order by priority,pg_catalog.lower(health.product_name),health.warehouse_id,health.product_id
    limit p_critical_limit
  )
  select pg_catalog.jsonb_build_object(
    'as_of',pg_catalog.statement_timestamp(),
    'warehouses',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'warehouse_id',summary.id,'warehouse_code',summary.code,'warehouse_name',summary.display_name,
      'product_count',summary.total::text,'healthy_count',summary.healthy::text,
      'low_stock_count',summary.low_stock::text,'out_of_stock_count',summary.out_of_stock::text,
      'not_configured_count',summary.not_configured::text) order by summary.sort_order)
      from summaries summary),'[]'::jsonb),
    'critical_items',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'product_id',item.product_id,'serial_number',item.serial_number,'product_name',item.product_name,
      'warehouse_id',item.warehouse_id,'warehouse_code',item.warehouse_code,'warehouse_name',item.warehouse_name,
      'physical_quantity',item.physical_quantity::text,'minimum_quantity',item.minimum_quantity::text,
      'health_status',item.health_status,'configuration_version',item.configuration_version::text)
      order by item.priority,pg_catalog.lower(item.product_name),item.warehouse_id,item.product_id)
      from critical item),'[]'::jsonb)
  ) into result;
  return result;
end;
$function$;
revoke all on function public.get_dashboard_stock_health(integer) from public, anon, authenticated, service_role;
grant execute on function public.get_dashboard_stock_health(integer) to authenticated;
