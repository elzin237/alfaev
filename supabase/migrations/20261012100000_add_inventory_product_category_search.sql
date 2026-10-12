create index products_category_search_trgm_idx
  on public.products
  using gin (pg_catalog.lower(category) extensions.gin_trgm_ops);

create or replace function public.search_inventory_products(
  p_search text default null
)
returns table (
  id uuid,
  serial_number text,
  name text,
  category text,
  brand_name text,
  product_kind text,
  is_active boolean,
  quantity bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_search text := nullif(pg_catalog.btrim(p_search), '');
  v_escaped_search text;
  v_contains_pattern text;
  v_prefix_pattern text;
begin
  if not (
    public.current_user_is_admin()
    or public.has_permission('inventory.view')
  ) then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if v_search is not null then
    v_escaped_search := pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          v_search,
          pg_catalog.chr(92),
          pg_catalog.chr(92) || pg_catalog.chr(92)
        ),
        '%',
        pg_catalog.chr(92) || '%'
      ),
      '_',
      pg_catalog.chr(92) || '_'
    );
    v_contains_pattern := '%' || pg_catalog.lower(v_escaped_search) || '%';
    v_prefix_pattern := v_escaped_search || '%';
  end if;

  return query
  select
    product.id,
    product.serial_number,
    product.name,
    product.category,
    brand.name,
    product.product_kind,
    product.is_active,
    balance.quantity
  from public.products as product
  join public.inventory_balances as balance
    on balance.product_id = product.id
  left join public.brands as brand
    on brand.id = product.brand_id
  where
    v_search is null
    or pg_catalog.lower(product.name) like v_contains_pattern escape '\'
    or pg_catalog.lower(product.category) like v_contains_pattern escape '\'
    or product.serial_number like v_prefix_pattern escape '\'
    or exists (
      select 1
      from public.product_suppliers as product_supplier
      where product_supplier.product_id = product.id
        and product_supplier.catalog_number is not null
        and pg_catalog.lower(product_supplier.catalog_number)
          like v_contains_pattern escape '\'
    )
  order by product.serial_number, product.id;
end;
$function$;

revoke all privileges
  on function public.search_inventory_products(text)
  from public, anon, authenticated;

grant execute
  on function public.search_inventory_products(text)
  to authenticated;
