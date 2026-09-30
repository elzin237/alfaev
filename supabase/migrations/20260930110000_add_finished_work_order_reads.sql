create index inventory_movements_work_order_source_created_id_idx
  on public.inventory_movements (
    source_id,
    created_at desc,
    id desc
  )
  where source_type = 'work_order';

create function public.get_finished_work_order_detail(
  p_work_order_id uuid
)
returns table (
  work_order_id uuid,
  work_order_number text,
  project_id uuid,
  project_name text,
  customer_name_snapshot text,
  description text,
  created_at timestamptz,
  finished_at timestamptz,
  finished_by_user_id uuid,
  finished_by_full_name text,
  pdf_id uuid,
  document_version integer,
  generated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  work_order_status text;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_work_order_id is null then
    raise exception 'Work Order ID is required'
      using errcode = '22023';
  end if;

  select work_order.status
  into work_order_status
  from public.work_orders as work_order
  where work_order.id = p_work_order_id;

  if not found then
    raise exception 'Work Order not found'
      using errcode = 'P0002';
  end if;

  if work_order_status <> 'finished' then
    raise exception 'Finished Work Order is required'
      using errcode = 'WOR10';
  end if;

  return query
  select
    work_order.id,
    work_order.work_order_number,
    work_order.project_id,
    project.name,
    work_order.customer_name_snapshot,
    work_order.description,
    work_order.created_at,
    work_order.finished_at,
    work_order.finished_by_user_id,
    finisher.full_name,
    pdf.id,
    pdf.document_version,
    pdf.generated_at
  from public.work_orders as work_order
  join public.projects as project
    on project.id = work_order.project_id
  join public.user_profiles as finisher
    on finisher.id = work_order.finished_by_user_id
  left join public.work_order_pdfs as pdf
    on pdf.work_order_id = work_order.id
  where work_order.id = p_work_order_id;
end;
$function$;

revoke all privileges
  on function public.get_finished_work_order_detail(uuid)
  from public, anon, authenticated;

grant execute
  on function public.get_finished_work_order_detail(uuid)
  to authenticated;

create function public.list_finished_work_order_materials(
  p_work_order_id uuid
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
declare
  work_order_status text;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_work_order_id is null then
    raise exception 'Work Order ID is required'
      using errcode = '22023';
  end if;

  select work_order.status
  into work_order_status
  from public.work_orders as work_order
  where work_order.id = p_work_order_id;

  if not found then
    raise exception 'Work Order not found'
      using errcode = 'P0002';
  end if;

  if work_order_status <> 'finished' then
    raise exception 'Finished Work Order is required'
      using errcode = 'WOR10';
  end if;

  return query
  select
    item.product_id,
    product.serial_number,
    product.name,
    item.quantity::text
  from public.work_order_items as item
  join public.products as product
    on product.id = item.product_id
  where item.work_order_id = p_work_order_id
  order by product.serial_number, item.id;
end;
$function$;

revoke all privileges
  on function public.list_finished_work_order_materials(uuid)
  from public, anon, authenticated;

grant execute
  on function public.list_finished_work_order_materials(uuid)
  to authenticated;

create function public.list_finished_work_order_movements(
  p_work_order_id uuid
)
returns table (
  movement_id uuid,
  product_id uuid,
  serial_number text,
  product_name text,
  quantity_delta text,
  quantity_before text,
  quantity_after text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  work_order_status text;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_work_order_id is null then
    raise exception 'Work Order ID is required'
      using errcode = '22023';
  end if;

  select work_order.status
  into work_order_status
  from public.work_orders as work_order
  where work_order.id = p_work_order_id;

  if not found then
    raise exception 'Work Order not found'
      using errcode = 'P0002';
  end if;

  if work_order_status <> 'finished' then
    raise exception 'Finished Work Order is required'
      using errcode = 'WOR10';
  end if;

  return query
  select
    movement.id,
    movement.product_id,
    product.serial_number,
    product.name,
    movement.quantity_delta::text,
    movement.quantity_before::text,
    movement.quantity_after::text,
    movement.created_at
  from public.inventory_movements as movement
  join public.products as product
    on product.id = movement.product_id
  where movement.source_type = 'work_order'
    and movement.source_id = p_work_order_id
  order by movement.created_at desc, movement.id desc;
end;
$function$;

revoke all privileges
  on function public.list_finished_work_order_movements(uuid)
  from public, anon, authenticated;

grant execute
  on function public.list_finished_work_order_movements(uuid)
  to authenticated;
