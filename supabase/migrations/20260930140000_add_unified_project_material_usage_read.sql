create index inventory_movements_project_pcb_input_usage_created_id_idx
  on public.inventory_movements (
    project_id,
    created_at desc,
    id desc
  )
  where movement_type = 'pcb_production_input'
    and source_type = 'pcb_production_input'
    and quantity_delta < 0;

create function public.list_project_material_usage(
  p_project_id uuid
)
returns table (
  movement_id uuid,
  project_id uuid,
  product_id uuid,
  serial_number text,
  product_name text,
  quantity text,
  source_type text,
  source_id uuid,
  source_label text,
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
  with usage_rows as (
    select
      movement.id as movement_id,
      movement.project_id,
      movement.product_id,
      product.serial_number,
      product.name as product_name,
      (0::numeric - movement.quantity_delta::numeric)::text as quantity,
      'work_order'::text as source_type,
      work_order.id as source_id,
      work_order.work_order_number as source_label,
      movement.created_at as consumed_at
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

    union all

    select
      movement.id as movement_id,
      movement.project_id,
      movement.product_id,
      product.serial_number,
      product.name as product_name,
      (0::numeric - movement.quantity_delta::numeric)::text as quantity,
      'pcb_production'::text as source_type,
      production_run.id as source_id,
      pcb_card.name as source_label,
      movement.created_at as consumed_at
    from public.inventory_movements as movement
    join public.pcb_production_runs as production_run
      on production_run.id = movement.source_id
    join public.pcb_cards as pcb_card
      on pcb_card.id = production_run.pcb_card_id
    join public.products as product
      on product.id = movement.product_id
    where movement.movement_type = 'pcb_production_input'
      and movement.source_type = 'pcb_production_input'
      and movement.source_id = production_run.id
      and movement.project_id = p_project_id
      and production_run.project_id = p_project_id
      and production_run.status = 'completed'
      and movement.quantity_delta < 0
  )
  select
    usage.movement_id,
    usage.project_id,
    usage.product_id,
    usage.serial_number,
    usage.product_name,
    usage.quantity,
    usage.source_type,
    usage.source_id,
    usage.source_label,
    usage.consumed_at
  from usage_rows as usage
  order by usage.consumed_at desc, usage.movement_id desc;
end;
$function$;

revoke all privileges
  on function public.list_project_material_usage(uuid)
  from public, anon, authenticated;

grant execute
  on function public.list_project_material_usage(uuid)
  to authenticated;
