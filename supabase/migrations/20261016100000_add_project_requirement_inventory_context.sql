drop function public.get_project_planning(uuid);

create function public.get_project_planning(p_project_id uuid)
returns table (
  project_product_id uuid,
  project_product_name text,
  component_id uuid,
  product_id uuid,
  serial_number text,
  product_name text,
  product_kind text,
  required_quantity text,
  category text,
  brand_name text,
  physical_quantity text,
  committed_to_projects text,
  available_after_commitments text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  can_view_inventory boolean;
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

  can_view_inventory := public.current_user_is_admin()
    or public.has_permission('inventory.view');

  return query
  with product_commitments as (
    select
      commitment.product_id,
      pg_catalog.sum(commitment.outstanding_commitment) as committed_quantity
    from public.calculate_open_project_commitments() as commitment
    group by commitment.product_id
  )
  select
    project_product.id,
    project_product.name,
    component.id,
    product.id,
    product.serial_number,
    product.name,
    product.product_kind,
    component.required_quantity::text,
    case when can_view_inventory then product.category else null::text end,
    case when can_view_inventory then brand.name else null::text end,
    case when can_view_inventory then balance.quantity::text else null::text end,
    case when can_view_inventory and product.id is not null then
      coalesce(commitment.committed_quantity, 0::numeric)::text
    else null::text end,
    case when can_view_inventory and product.id is not null then
      (balance.quantity::numeric -
        coalesce(commitment.committed_quantity, 0::numeric))::text
    else null::text end
  from public.project_products as project_product
  left join public.project_product_components as component
    on component.project_product_id = project_product.id
  left join public.products as product
    on product.id = component.product_id
  left join public.brands as brand
    on brand.id = product.brand_id
  left join public.inventory_balances as balance
    on balance.product_id = product.id
  left join product_commitments as commitment
    on commitment.product_id = product.id
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
