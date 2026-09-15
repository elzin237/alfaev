create function public.update_procurement_delivered_quantity(
  p_request_id uuid,
  p_delivered_quantity bigint
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  changed_at timestamptz;
  current_delivered_quantity bigint;
  current_status text;
  derived_status text;
  request_requested_quantity bigint;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('procurement.change_status')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'Procurement request is required'
      using errcode = '22023';
  end if;

  if p_delivered_quantity is null or p_delivered_quantity < 0 then
    raise exception 'Delivered quantity must be zero or greater'
      using errcode = '22023';
  end if;

  select
    request.requested_quantity,
    request.delivered_quantity,
    request.status
  into
    request_requested_quantity,
    current_delivered_quantity,
    current_status
  from public.procurement_requests as request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Procurement request not found'
      using errcode = 'P0002';
  end if;

  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('procurement.change_status')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if current_status = 'resolved' then
    raise exception 'Resolved Procurement requests cannot be modified'
      using errcode = 'PRQ02';
  end if;

  if p_delivered_quantity > request_requested_quantity then
    raise exception 'Delivered quantity cannot exceed requested quantity'
      using errcode = '22023';
  end if;

  derived_status := case
    when p_delivered_quantity = 0 then 'active'
    else 'partly_delivered'
  end;

  if current_delivered_quantity = p_delivered_quantity
    and current_status = derived_status
  then
    return p_request_id;
  end if;

  changed_at := pg_catalog.clock_timestamp();

  update public.procurement_requests as request
  set delivered_quantity = p_delivered_quantity,
      status = derived_status,
      updated_at = changed_at,
      updated_by_user_id = actor_profile_id
  where request.id = p_request_id;

  perform public.append_audit_log(
    p_action_type => 'procurement.delivery_updated',
    p_entity_type => 'procurement_request',
    p_summary => 'Updated Procurement delivered quantity',
    p_entity_id => p_request_id,
    p_before_data => pg_catalog.jsonb_build_object(
      'requested_quantity', request_requested_quantity,
      'delivered_quantity', current_delivered_quantity,
      'remaining_quantity',
        request_requested_quantity - current_delivered_quantity,
      'status', current_status
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'requested_quantity', request_requested_quantity,
      'delivered_quantity', p_delivered_quantity,
      'remaining_quantity',
        request_requested_quantity - p_delivered_quantity,
      'status', derived_status
    )
  );

  return p_request_id;
end;
$function$;

revoke all privileges
  on function public.update_procurement_delivered_quantity(uuid, bigint)
  from public, anon, authenticated;

grant execute
  on function public.update_procurement_delivered_quantity(uuid, bigint)
  to authenticated;
