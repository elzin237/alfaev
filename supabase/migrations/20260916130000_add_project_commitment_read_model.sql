-- This internal calculation is called only by the two authorized Inventory reads.
-- Keep arithmetic numeric: sums across Projects can exceed one bigint even though
-- each stored quantity is bigint. No stock or planning row is changed here.
create function public.calculate_open_project_commitments(p_product_id uuid default null)
returns table (
  project_id uuid,
  project_name text,
  product_id uuid,
  planned_requirement numeric,
  actual_project_consumption numeric,
  outstanding_commitment numeric
)
language sql
stable
set search_path = ''
as $function$
  with planned as (
    select
      project.id as project_id,
      project.name as project_name,
      component.product_id,
      pg_catalog.sum(component.required_quantity::numeric) as planned_requirement
    from public.projects as project
    join public.project_products as project_product
      on project_product.project_id = project.id
    join public.project_product_components as component
      on component.project_product_id = project_product.id
    where project.status in ('planned', 'in_progress', 'on_hold')
      and (p_product_id is null or component.product_id = p_product_id)
    group by project.id, project.name, component.product_id
  ),
  consumed as (
    select
      movement.project_id,
      movement.product_id,
      pg_catalog.sum(-movement.quantity_delta::numeric) as consumed_quantity
    from public.inventory_movements as movement
    where movement.project_id is not null
      and movement.quantity_delta < 0
      and movement.source_type in ('work_order', 'pcb_production_input')
      and (p_product_id is null or movement.product_id = p_product_id)
    group by movement.project_id, movement.product_id
  )
  select
    planned.project_id,
    planned.project_name,
    planned.product_id,
    planned.planned_requirement,
    coalesce(consumed.consumed_quantity, 0::numeric),
    greatest(
      planned.planned_requirement -
        coalesce(consumed.consumed_quantity, 0::numeric),
      0::numeric
    )
  from planned
  left join consumed
    on consumed.project_id = planned.project_id
    and consumed.product_id = planned.product_id;
$function$;

revoke all privileges
  on function public.calculate_open_project_commitments(uuid)
  from public, anon, authenticated;

create function public.get_inventory_project_commitments()
returns table (
  product_id uuid,
  physical_quantity bigint,
  committed_to_projects numeric,
  available_after_commitments numeric
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
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  return query
  select
    product.id,
    balance.quantity,
    coalesce(pg_catalog.sum(commitment.outstanding_commitment), 0::numeric),
    balance.quantity::numeric -
      coalesce(pg_catalog.sum(commitment.outstanding_commitment), 0::numeric)
  from public.products as product
  join public.inventory_balances as balance
    on balance.product_id = product.id
  left join public.calculate_open_project_commitments() as commitment
    on commitment.product_id = product.id
  group by product.id, product.serial_number, balance.quantity
  order by product.serial_number, product.id;
end;
$function$;

create function public.get_product_project_commitments(p_product_id uuid)
returns table (
  project_id uuid,
  project_name text,
  planned_requirement numeric,
  actual_project_consumption numeric,
  outstanding_commitment numeric
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
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_id is null then
    raise exception 'Product is required' using errcode = '22023';
  end if;

  return query
  select
    commitment.project_id,
    commitment.project_name,
    commitment.planned_requirement,
    commitment.actual_project_consumption,
    commitment.outstanding_commitment
  from public.calculate_open_project_commitments(p_product_id) as commitment
  where commitment.outstanding_commitment > 0
  order by pg_catalog.lower(commitment.project_name),
    commitment.project_name, commitment.project_id;
end;
$function$;

revoke all privileges
  on function public.get_inventory_project_commitments()
  from public, anon, authenticated;
revoke all privileges
  on function public.get_product_project_commitments(uuid)
  from public, anon, authenticated;

grant execute
  on function public.get_inventory_project_commitments()
  to authenticated;
grant execute
  on function public.get_product_project_commitments(uuid)
  to authenticated;
