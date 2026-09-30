create index inventory_movements_project_work_order_usage_created_id_idx
  on public.inventory_movements (
    project_id,
    created_at desc,
    id desc
  )
  where movement_type = 'work_order'
    and source_type = 'work_order'
    and quantity_delta < 0;

create function public.list_project_work_order_material_usage(
  p_project_id uuid
)
returns table (
  movement_id uuid,
  project_id uuid,
  product_id uuid,
  serial_number text,
  product_name text,
  quantity text,
  work_order_id uuid,
  work_order_number text,
  consumed_at timestamptz
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
  select
    movement.id,
    movement.project_id,
    movement.product_id,
    product.serial_number,
    product.name,
    (0::numeric - movement.quantity_delta::numeric)::text,
    work_order.id,
    work_order.work_order_number,
    movement.created_at
  from public.inventory_movements as movement
  join public.work_orders as work_order
    on work_order.id = movement.source_id
  join public.products as product
    on product.id = movement.product_id
  where movement.movement_type = 'work_order'
    and movement.source_type = 'work_order'
    and movement.source_id = work_order.id
    and movement.project_id = p_project_id
    and work_order.project_id = p_project_id
    and work_order.status = 'finished'
    and movement.quantity_delta < 0
  order by movement.created_at desc, movement.id desc;
end;
$function$;

revoke all privileges
  on function public.list_project_work_order_material_usage(uuid)
  from public, anon, authenticated;

grant execute
  on function public.list_project_work_order_material_usage(uuid)
  to authenticated;
