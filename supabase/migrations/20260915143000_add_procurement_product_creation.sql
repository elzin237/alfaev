create function public.create_product_from_procurement_request(
  p_request_id uuid,
  p_name text,
  p_category text,
  p_brand_id uuid default null,
  p_catalog_number text default null
)
returns table (
  product_id uuid,
  serial_number text
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  brand_is_active boolean;
  changed_at timestamptz;
  created_product_id uuid;
  created_product_supplier_id uuid;
  created_serial_number text;
  current_request public.procurement_requests%rowtype;
  normalized_catalog_number text;
  normalized_category text;
  normalized_name text;
  supplier_is_active boolean;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'Procurement request is required'
      using errcode = '22023';
  end if;

  normalized_name := pg_catalog.btrim(p_name);
  normalized_category := pg_catalog.btrim(p_category);
  normalized_catalog_number := nullif(
    pg_catalog.btrim(p_catalog_number),
    ''
  );

  if normalized_name is null or pg_catalog.length(normalized_name) = 0 then
    raise exception 'Product name is required'
      using errcode = '22023';
  end if;

  if normalized_category is null
    or pg_catalog.length(normalized_category) = 0
  then
    raise exception 'Product category is required'
      using errcode = '22023';
  end if;

  select request.*
  into current_request
  from public.procurement_requests as request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Procurement request not found'
      using errcode = 'P0002';
  end if;

  if current_request.status not in ('active', 'partly_delivered') then
    raise exception 'Resolved Procurement requests cannot create Products'
      using errcode = 'PRQ02';
  end if;

  if current_request.product_id is not null then
    raise exception 'Procurement request already has a Product'
      using errcode = 'PRQ05';
  end if;

  select supplier.is_active
  into supplier_is_active
  from public.suppliers as supplier
  where supplier.id = current_request.supplier_id
  for share;

  if not found or not supplier_is_active then
    raise exception 'Supplier is unavailable'
      using errcode = 'PRQ04';
  end if;

  if p_brand_id is not null then
    select brand.is_active
    into brand_is_active
    from public.brands as brand
    where brand.id = p_brand_id
    for share;

    if not found or not brand_is_active then
      raise exception 'Brand is unavailable'
        using errcode = 'PRD04';
    end if;
  end if;

  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  select created.product_id, created.serial_number
  into created_product_id, created_serial_number
  from public.create_product(
    normalized_name,
    normalized_category,
    p_brand_id
  ) as created;

  created_product_supplier_id := public.create_product_supplier(
    created_product_id,
    current_request.supplier_id,
    normalized_catalog_number
  );

  changed_at := pg_catalog.clock_timestamp();

  update public.procurement_requests as request
  set product_id = created_product_id,
      updated_at = changed_at,
      updated_by_user_id = actor_profile_id
  where request.id = current_request.id;

  perform public.append_audit_log(
    p_action_type => 'procurement.product_linked',
    p_entity_type => 'procurement_request',
    p_summary => 'Created and linked Product ' || created_serial_number ||
      ' from Procurement request',
    p_entity_id => current_request.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'product_id', null,
      'requested_name', current_request.requested_name,
      'supplier_id', current_request.supplier_id,
      'requested_quantity', current_request.requested_quantity,
      'delivered_quantity', current_request.delivered_quantity,
      'status', current_request.status,
      'resolved_at', current_request.resolved_at,
      'resolved_by_user_id', current_request.resolved_by_user_id
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'product_id', created_product_id,
      'product_serial_number', created_serial_number,
      'product_supplier_id', created_product_supplier_id,
      'requested_name', current_request.requested_name,
      'supplier_id', current_request.supplier_id,
      'requested_quantity', current_request.requested_quantity,
      'delivered_quantity', current_request.delivered_quantity,
      'status', current_request.status,
      'resolved_at', current_request.resolved_at,
      'resolved_by_user_id', current_request.resolved_by_user_id
    )
  );

  return query
  select created_product_id, created_serial_number;
end;
$function$;

revoke all privileges
  on function public.create_product_from_procurement_request(
    uuid,
    text,
    text,
    uuid,
    text
  )
  from public, anon, authenticated;

grant execute
  on function public.create_product_from_procurement_request(
    uuid,
    text,
    text,
    uuid,
    text
  )
  to authenticated;
