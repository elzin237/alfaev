create function public.create_procurement_request_for_new_component(
  p_requested_name text,
  p_supplier_id uuid,
  p_requested_quantity bigint
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
  created_request_id uuid;
  normalized_requested_name text;
  supplier_is_active boolean;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('procurement.create')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  normalized_requested_name := pg_catalog.btrim(p_requested_name);

  if normalized_requested_name is null
    or pg_catalog.length(normalized_requested_name) = 0
  then
    raise exception 'Requested name is required'
      using errcode = '22023';
  end if;

  if p_supplier_id is null then
    raise exception 'Supplier is required'
      using errcode = '22023';
  end if;

  if p_requested_quantity is null or p_requested_quantity <= 0 then
    raise exception 'Requested quantity must be greater than zero'
      using errcode = '22023';
  end if;

  select supplier.is_active
  into supplier_is_active
  from public.suppliers as supplier
  where supplier.id = p_supplier_id
  for share;

  if not found or not supplier_is_active then
    raise exception 'Supplier is unavailable'
      using errcode = 'PRQ04';
  end if;

  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('procurement.create')
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

  changed_at := pg_catalog.clock_timestamp();

  insert into public.procurement_requests as inserted (
    product_id,
    requested_name,
    supplier_id,
    requested_quantity,
    delivered_quantity,
    status,
    created_at,
    created_by_user_id,
    updated_at,
    updated_by_user_id,
    resolved_at,
    resolved_by_user_id
  )
  values (
    null,
    normalized_requested_name,
    p_supplier_id,
    p_requested_quantity,
    0,
    'active',
    changed_at,
    actor_profile_id,
    changed_at,
    actor_profile_id,
    null,
    null
  )
  returning inserted.id into created_request_id;

  perform public.append_audit_log(
    p_action_type => 'procurement.created',
    p_entity_type => 'procurement_request',
    p_summary => 'Created Procurement request for ' || normalized_requested_name,
    p_entity_id => created_request_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'product_id', null,
      'requested_name', normalized_requested_name,
      'supplier_id', p_supplier_id,
      'requested_quantity', p_requested_quantity,
      'delivered_quantity', 0,
      'status', 'active'
    )
  );

  return created_request_id;
end;
$function$;

revoke all privileges
  on function public.create_procurement_request_for_new_component(text, uuid, bigint)
  from public, anon, authenticated;

grant execute
  on function public.create_procurement_request_for_new_component(text, uuid, bigint)
  to authenticated;
