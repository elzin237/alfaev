create function public.get_product_suppliers_for_supplier(
  p_supplier_id uuid
)
returns table (
  relationship_id uuid,
  product_id uuid,
  product_serial_number text,
  product_name text,
  product_is_active boolean,
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

  if p_supplier_id is null then
    raise exception 'Supplier is required'
      using errcode = '22023';
  end if;

  return query
  select
    product_supplier.id,
    product.id,
    product.serial_number,
    product.name,
    product.is_active,
    product_supplier.catalog_number,
    product_supplier.is_active
  from public.product_suppliers as product_supplier
  join public.products as product
    on product.id = product_supplier.product_id
  where product_supplier.supplier_id = p_supplier_id
  order by
    product_supplier.is_active desc,
    product.serial_number,
    product_supplier.catalog_number nulls first,
    product_supplier.id;
end;
$function$;

create function public.list_active_product_choices_for_product_supplier()
returns table (
  product_id uuid,
  product_serial_number text,
  product_name text
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
  select product.id, product.serial_number, product.name
  from public.products as product
  where product.is_active
  order by product.serial_number, product.id;
end;
$function$;

revoke all privileges
  on function public.get_product_suppliers_for_supplier(uuid)
  from public, anon, authenticated;
revoke all privileges
  on function public.list_active_product_choices_for_product_supplier()
  from public, anon, authenticated;

grant execute
  on function public.get_product_suppliers_for_supplier(uuid)
  to authenticated;
grant execute
  on function public.list_active_product_choices_for_product_supplier()
  to authenticated;
