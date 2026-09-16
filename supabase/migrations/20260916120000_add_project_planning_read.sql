create function public.get_project_planning(p_project_id uuid)
returns table (
  project_product_id uuid,
  project_product_name text,
  component_id uuid,
  product_id uuid,
  serial_number text,
  product_name text,
  product_kind text,
  required_quantity bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not (
    public.current_user_is_admin()
    or public.has_permission('projects.view')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_project_id is null then
    raise exception 'Project is required' using errcode = '22023';
  end if;

  return query
  select
    project_product.id,
    project_product.name,
    component.id,
    product.id,
    product.serial_number,
    product.name,
    product.product_kind,
    component.required_quantity
  from public.project_products as project_product
  left join public.project_product_components as component
    on component.project_product_id = project_product.id
  left join public.products as product
    on product.id = component.product_id
  where project_product.project_id = p_project_id
  order by
    pg_catalog.lower(project_product.name),
    project_product.name,
    project_product.id,
    product.serial_number nulls first,
    component.id;
end;
$function$;

revoke all privileges
  on function public.get_project_planning(uuid)
  from public, anon, authenticated;

grant execute
  on function public.get_project_planning(uuid)
  to authenticated;
