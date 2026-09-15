create function public.create_procurement_request_for_product(
  p_product_id uuid,
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
  product_is_active boolean;
  product_name text;
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

  if p_product_id is null or p_supplier_id is null then
    raise exception 'Product and Supplier are required'
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
    p_product_id,
    product_name,
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
    p_summary => 'Created Procurement request for ' || product_name,
    p_entity_id => created_request_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'product_id', p_product_id,
      'requested_name', product_name,
      'supplier_id', p_supplier_id,
      'requested_quantity', p_requested_quantity,
      'delivered_quantity', 0,
      'status', 'active'
    )
  );

  return created_request_id;
end;
$function$;

create function public.search_procurement_product_choices(
  p_search text default null
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
  v_search text := nullif(pg_catalog.btrim(p_search), '');
  v_escaped_search text;
  v_contains_pattern text;
  v_prefix_pattern text;
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
  select product.id, product.serial_number, product.name
  from public.products as product
  where product.is_active
    and (
      v_search is null
      or pg_catalog.lower(product.name)
        like v_contains_pattern escape '\'
      or product.serial_number like v_prefix_pattern escape '\'
    )
  order by product.serial_number, product.id;
end;
$function$;

create function public.list_active_procurement_supplier_choices()
returns table (
  supplier_id uuid,
  supplier_name text
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
      or public.has_permission('procurement.create')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  return query
  select supplier.id, supplier.name
  from public.suppliers as supplier
  where supplier.is_active
  order by
    pg_catalog.lower(supplier.name),
    supplier.name,
    supplier.id;
end;
$function$;

revoke all privileges
  on function public.create_procurement_request_for_product(uuid, uuid, bigint)
  from public, anon, authenticated;
revoke all privileges
  on function public.search_procurement_product_choices(text)
  from public, anon, authenticated;
revoke all privileges
  on function public.list_active_procurement_supplier_choices()
  from public, anon, authenticated;

grant execute
  on function public.create_procurement_request_for_product(uuid, uuid, bigint)
  to authenticated;
grant execute
  on function public.search_procurement_product_choices(text)
  to authenticated;
grant execute
  on function public.list_active_procurement_supplier_choices()
  to authenticated;
