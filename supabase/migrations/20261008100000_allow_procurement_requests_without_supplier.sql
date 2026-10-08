alter table public.procurement_requests
  alter column supplier_id drop not null;

create or replace function public.search_procurement_requests(
  p_search text default null,
  p_status text default null,
  p_supplier_id uuid default null
)
returns table (
  request_id uuid,
  product_id uuid,
  product_serial_number text,
  requested_name text,
  supplier_id uuid,
  supplier_name text,
  requested_quantity bigint,
  delivered_quantity bigint,
  status text,
  created_at timestamptz,
  created_by_user_id uuid,
  created_by_full_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_search text := nullif(pg_catalog.btrim(p_search), '');
  v_escaped_search text;
  v_contains_pattern text;
  v_prefix_pattern text;
begin
  if not (
    public.current_user_is_admin()
    or public.has_permission('procurement.view')
  ) then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_status is not null
    and p_status not in ('active', 'partly_delivered', 'resolved')
  then
    raise exception 'Invalid Procurement status'
      using errcode = '22023';
  end if;

  if v_search is not null then
    v_escaped_search := pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          v_search,
          pg_catalog.chr(92),
          pg_catalog.chr(92) || pg_catalog.chr(92)
        ),
        '%',
        pg_catalog.chr(92) || '%'
      ),
      '_',
      pg_catalog.chr(92) || '_'
    );
    v_contains_pattern := '%' || pg_catalog.lower(v_escaped_search) || '%';
    v_prefix_pattern := v_escaped_search || '%';
  end if;

  return query
  select
    request.id,
    request.product_id,
    product.serial_number,
    request.requested_name,
    request.supplier_id,
    supplier.name,
    request.requested_quantity,
    request.delivered_quantity,
    request.status,
    request.created_at,
    request.created_by_user_id,
    creator.full_name
  from public.procurement_requests as request
  left join public.products as product
    on product.id = request.product_id
  left join public.suppliers as supplier
    on supplier.id = request.supplier_id
  join public.user_profiles as creator
    on creator.id = request.created_by_user_id
  where
    (p_status is null or request.status = p_status)
    and (p_supplier_id is null or request.supplier_id = p_supplier_id)
    and (
      v_search is null
      or pg_catalog.lower(request.requested_name)
        like v_contains_pattern escape '\'
      or product.serial_number like v_prefix_pattern escape '\'
    )
  order by
    case request.status
      when 'active' then 1
      when 'partly_delivered' then 2
      when 'resolved' then 3
    end,
    request.created_at desc,
    request.id;
end;
$function$;

revoke all privileges
  on function public.create_procurement_request_for_product(uuid, uuid, bigint)
  from public, anon, authenticated;
drop function public.create_procurement_request_for_product(uuid, uuid, bigint);

create function public.create_procurement_request_for_product(
  p_product_id uuid,
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
  product_is_active boolean;
  product_name text;
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

  if p_product_id is null then
    raise exception 'Product is required'
      using errcode = '22023';
  end if;

  if p_requested_quantity is null or p_requested_quantity <= 0 then
    raise exception 'Requested quantity must be greater than zero'
      using errcode = '22023';
  end if;

  select product.name, product.is_active
  into product_name, product_is_active
  from public.products as product
  where product.id = p_product_id
  for share;

  if not found or not product_is_active then
    raise exception 'Product is unavailable'
      using errcode = 'PRQ03';
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
    p_product_id,
    product_name,
    null,
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
    p_summary => 'Created Procurement request for ' || product_name,
    p_entity_id => created_request_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'product_id', p_product_id,
      'requested_name', product_name,
      'supplier_id', null,
      'requested_quantity', p_requested_quantity,
      'delivered_quantity', 0,
      'status', 'active'
    )
  );

  return created_request_id;
end;
$function$;

revoke all privileges
  on function public.create_procurement_request_for_product(uuid, bigint)
  from public, anon, authenticated;
grant execute
  on function public.create_procurement_request_for_product(uuid, bigint)
  to authenticated;

revoke all privileges
  on function public.create_procurement_request_for_new_component(text, uuid, bigint)
  from public, anon, authenticated;
drop function public.create_procurement_request_for_new_component(text, uuid, bigint);

create function public.create_procurement_request_for_new_component(
  p_requested_name text,
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

  if p_requested_quantity is null or p_requested_quantity <= 0 then
    raise exception 'Requested quantity must be greater than zero'
      using errcode = '22023';
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
    null,
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
      'supplier_id', null,
      'requested_quantity', p_requested_quantity,
      'delivered_quantity', 0,
      'status', 'active'
    )
  );

  return created_request_id;
end;
$function$;

revoke all privileges
  on function public.create_procurement_request_for_new_component(text, bigint)
  from public, anon, authenticated;
grant execute
  on function public.create_procurement_request_for_new_component(text, bigint)
  to authenticated;

create or replace function public.create_product_from_procurement_request(
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
  created_product_supplier_id uuid := null;
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

  if current_request.supplier_id is null
    and normalized_catalog_number is not null
  then
    raise exception 'Catalog Number requires a Supplier'
      using errcode = '22023';
  end if;

  if current_request.supplier_id is not null then
    select supplier.is_active
    into supplier_is_active
    from public.suppliers as supplier
    where supplier.id = current_request.supplier_id
    for share;

    if not found or not supplier_is_active then
      raise exception 'Supplier is unavailable'
        using errcode = 'PRQ04';
    end if;
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

  if current_request.supplier_id is not null then
    created_product_supplier_id := public.create_product_supplier(
      created_product_id,
      current_request.supplier_id,
      normalized_catalog_number
    );
  end if;

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
