create function public.get_product_suppliers_for_product(
  p_product_id uuid
)
returns table (
  relationship_id uuid,
  supplier_id uuid,
  supplier_name text,
  supplier_is_active boolean,
  catalog_number text,
  relationship_is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not (
    public.current_user_is_admin()
    or public.has_permission('inventory.view')
    or public.has_permission('suppliers.view')
  ) then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_product_id is null then
    raise exception 'Product is required'
      using errcode = '22023';
  end if;

  return query
  select
    product_supplier.id,
    supplier.id,
    supplier.name,
    supplier.is_active,
    product_supplier.catalog_number,
    product_supplier.is_active
  from public.product_suppliers as product_supplier
  join public.suppliers as supplier
    on supplier.id = product_supplier.supplier_id
  where product_supplier.product_id = p_product_id
  order by
    product_supplier.is_active desc,
    pg_catalog.lower(supplier.name),
    supplier.name,
    product_supplier.catalog_number nulls first,
    product_supplier.id;
end;
$function$;

create function public.list_active_supplier_choices_for_product_supplier()
returns table (
  supplier_id uuid,
  supplier_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not (
    public.current_user_is_admin()
    or public.has_permission('inventory.products.edit')
    or public.has_permission('suppliers.edit')
  ) then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  return query
  select supplier.id, supplier.name
  from public.suppliers as supplier
  where supplier.is_active
  order by
    pg_catalog.lower(supplier.name),
    supplier.name,
    supplier.id;
end;
$function$;

revoke all privileges
  on function public.get_product_suppliers_for_product(uuid)
  from public, anon, authenticated;
revoke all privileges
  on function public.list_active_supplier_choices_for_product_supplier()
  from public, anon, authenticated;

grant execute
  on function public.get_product_suppliers_for_product(uuid)
  to authenticated;
grant execute
  on function public.list_active_supplier_choices_for_product_supplier()
  to authenticated;
