create function public.resolve_work_order_product_barcode(
  p_work_order_id uuid,
  p_serial_number text
)
returns table (
  product_id uuid,
  serial_number text,
  name text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_work_order_status text;
  resolved_product public.products%rowtype;
begin
  if auth.uid() is null
    or public.current_active_user_profile_id() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.edit_draft')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_work_order_id is null then
    raise exception 'Work Order ID is required'
      using errcode = '22023';
  end if;

  if p_serial_number is null
    or not (p_serial_number ~ '^[0-9]{7}$')
  then
    raise exception 'Enter a 7-digit Serial Number'
      using errcode = '22023';
  end if;

  select work_order.status
  into current_work_order_status
  from public.work_orders as work_order
  where work_order.id = p_work_order_id;

  if not found then
    raise exception 'Work Order not found'
      using errcode = 'P0002';
  end if;

  if current_work_order_status <> 'draft' then
    raise exception 'Finished Work Orders cannot be modified'
      using errcode = 'WOR02';
  end if;

  select product.*
  into resolved_product
  from public.products as product
  where product.serial_number = p_serial_number;

  if not found then
    raise exception 'Product not found'
      using errcode = 'P0002';
  end if;

  if not resolved_product.is_active
    or resolved_product.product_kind not in ('component', 'pcb_finished_good')
  then
    raise exception 'Product is unavailable for Work Order'
      using errcode = 'PRD05';
  end if;

  return query
  select
    resolved_product.id,
    resolved_product.serial_number,
    resolved_product.name;
end;
$function$;

revoke all privileges
  on function public.resolve_work_order_product_barcode(uuid, text)
  from public, anon, authenticated;

grant execute
  on function public.resolve_work_order_product_barcode(uuid, text)
  to authenticated;
