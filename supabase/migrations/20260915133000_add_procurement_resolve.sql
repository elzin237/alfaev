create function public.resolve_procurement_request(
  p_request_id uuid
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
  current_product_id uuid;
  current_requested_name text;
  current_requested_quantity bigint;
  current_status text;
  current_supplier_id uuid;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('procurement.resolve')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'Procurement request is required'
      using errcode = '22023';
  end if;

  select
    request.product_id,
    request.requested_name,
    request.supplier_id,
    request.requested_quantity,
    request.delivered_quantity,
    request.status
  into
    current_product_id,
    current_requested_name,
    current_supplier_id,
    current_requested_quantity,
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
      or public.has_permission('procurement.resolve')
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

  if current_status not in ('active', 'partly_delivered') then
    raise exception 'Resolved Procurement requests cannot be resolved again'
      using errcode = 'PRQ02';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  update public.procurement_requests as request
  set status = 'resolved',
      resolved_at = changed_at,
      resolved_by_user_id = actor_profile_id,
      updated_at = changed_at,
      updated_by_user_id = actor_profile_id
  where request.id = p_request_id;

  perform public.append_audit_log(
    p_action_type => 'procurement.resolved',
    p_entity_type => 'procurement_request',
    p_summary => 'Resolved Procurement request',
    p_entity_id => p_request_id,
    p_before_data => pg_catalog.jsonb_build_object(
      'product_id', current_product_id,
      'requested_name', current_requested_name,
      'supplier_id', current_supplier_id,
      'requested_quantity', current_requested_quantity,
      'delivered_quantity', current_delivered_quantity,
      'remaining_quantity',
        current_requested_quantity - current_delivered_quantity,
      'status', current_status,
      'resolved_at', null,
      'resolved_by_user_id', null
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'product_id', current_product_id,
      'requested_name', current_requested_name,
      'supplier_id', current_supplier_id,
      'requested_quantity', current_requested_quantity,
      'delivered_quantity', current_delivered_quantity,
      'remaining_quantity',
        current_requested_quantity - current_delivered_quantity,
      'status', 'resolved',
      'resolved_at', changed_at,
      'resolved_by_user_id', actor_profile_id
    )
  );

  return p_request_id;
end;
$function$;

revoke all privileges
  on function public.resolve_procurement_request(uuid)
  from public, anon, authenticated;

grant execute
  on function public.resolve_procurement_request(uuid)
  to authenticated;
