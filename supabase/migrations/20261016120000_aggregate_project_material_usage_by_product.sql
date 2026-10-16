drop function public.list_project_material_usage(uuid);

create function public.list_project_material_usage(
  p_project_id uuid
)
returns table (
  product_id uuid,
  serial_number text,
  product_name text,
  quantity text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_project_id is null then
    raise exception 'Project ID is required'
      using errcode = '22023';
  end if;

  perform 1
  from public.projects as project
  where project.id = p_project_id;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  return query
  with usage_rows as (
    select
      movement.product_id,
      0::numeric - movement.quantity_delta::numeric as quantity
    from public.inventory_movements as movement
    join public.work_orders as work_order
      on work_order.id = movement.source_id
    where movement.movement_type = 'work_order'
      and movement.source_type = 'work_order'
      and movement.source_id = work_order.id
      and movement.project_id = p_project_id
      and work_order.project_id = p_project_id
      and work_order.status = 'finished'
      and movement.quantity_delta < 0

    union all

    select
      movement.product_id,
      0::numeric - movement.quantity_delta::numeric as quantity
    from public.inventory_movements as movement
    join public.pcb_production_runs as production_run
      on production_run.id = movement.source_id
    where movement.movement_type = 'pcb_production_input'
      and movement.source_type = 'pcb_production_input'
      and movement.source_id = production_run.id
      and movement.project_id = p_project_id
      and production_run.project_id = p_project_id
      and production_run.status = 'completed'
      and movement.quantity_delta < 0
  ), aggregated_usage as (
    select
      usage.product_id,
      pg_catalog.sum(usage.quantity) as quantity
    from usage_rows as usage
    group by usage.product_id
  )
  select
    product.id as product_id,
    product.serial_number,
    product.name as product_name,
    usage.quantity::text as quantity
  from aggregated_usage as usage
  join public.products as product
    on product.id = usage.product_id
  order by product.serial_number asc, product.id asc;
end;
$function$;

revoke all privileges
  on function public.list_project_material_usage(uuid)
  from public, anon, authenticated;

grant execute
  on function public.list_project_material_usage(uuid)
  to authenticated;
