create function public.get_work_order_material_inventory(
  p_work_order_id uuid,
  p_product_id uuid
)
returns table (
  product_id uuid,
  current_inventory bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_inventory_quantity bigint;
  current_product_is_active boolean;
  current_product_kind text;
  current_work_order_status text;
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

  if p_product_id is null then
    raise exception 'Product ID is required'
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

  select product.is_active, product.product_kind
  into current_product_is_active, current_product_kind
  from public.products as product
  where product.id = p_product_id;

  if not found then
    raise exception 'Product not found'
      using errcode = 'P0002';
  end if;

  if not current_product_is_active
    or current_product_kind not in ('component', 'pcb_finished_good')
  then
    raise exception 'Product is unavailable for Work Order'
      using errcode = 'PRD05';
  end if;

  select balance.quantity
  into current_inventory_quantity
  from public.inventory_balances as balance
  where balance.product_id = p_product_id;

  if not found then
    raise exception 'Inventory balance not found'
      using errcode = 'IVB01';
  end if;

  return query
  select p_product_id, current_inventory_quantity;
end;
$function$;

revoke all privileges
  on function public.get_work_order_material_inventory(uuid, uuid)
  from public, anon, authenticated;

grant execute
  on function public.get_work_order_material_inventory(uuid, uuid)
  to authenticated;
