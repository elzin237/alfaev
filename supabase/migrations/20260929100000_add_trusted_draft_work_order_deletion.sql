create function public.delete_draft_work_order(
  p_work_order_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  work_order_id uuid,
  work_order_number text
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  before_materials jsonb;
  current_work_order public.work_orders%rowtype;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.delete_draft')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_work_order_id is null then
    raise exception 'Work Order ID is required'
      using errcode = '22023';
  end if;

  if p_expected_updated_at is null then
    raise exception 'Expected Work Order update timestamp is required'
      using errcode = '22023';
  end if;

  actor_profile_id := public.current_active_user_profile_id();
  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  select work_order.*
  into current_work_order
  from public.work_orders as work_order
  where work_order.id = p_work_order_id
  for update;

  if not found then
    raise exception 'Work Order not found'
      using errcode = 'P0002';
  end if;

  -- Authorization can change while the caller waits for the Work Order lock.
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.delete_draft')
    )
    or public.current_active_user_profile_id() is distinct from actor_profile_id
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if current_work_order.status <> 'draft' then
    raise exception 'Finished Work Orders cannot be deleted'
      using errcode = 'WOR02';
  end if;

  if current_work_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'Work Order Draft has changed. Reload and try again.'
      using errcode = 'WOR05';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'product_id', item.product_id,
        'quantity', item.quantity
      )
      order by item.product_id
    ),
    '[]'::jsonb
  )
  into before_materials
  from public.work_order_items as item
  where item.work_order_id = current_work_order.id;

  delete from public.work_order_items as item
  where item.work_order_id = current_work_order.id;

  delete from public.work_orders as work_order
  where work_order.id = current_work_order.id;

  perform public.append_audit_log(
    p_action_type => 'work_order.deleted',
    p_entity_type => 'work_order',
    p_summary => 'Deleted Work Order ' || current_work_order.work_order_number,
    p_entity_id => current_work_order.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'work_order_id', current_work_order.id,
      'work_order_number', current_work_order.work_order_number,
      'status', current_work_order.status,
      'project_id', current_work_order.project_id,
      'customer_name_snapshot', current_work_order.customer_name_snapshot,
      'description', current_work_order.description,
      'materials', before_materials
    ),
    p_after_data => null
  );

  return query
  select current_work_order.id, current_work_order.work_order_number;
end;
$function$;

revoke all privileges
  on function public.delete_draft_work_order(uuid, timestamptz)
  from public, anon, authenticated;

grant execute
  on function public.delete_draft_work_order(uuid, timestamptz)
  to authenticated;
