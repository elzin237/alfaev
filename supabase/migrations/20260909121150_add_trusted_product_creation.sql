create function public.create_product(
  p_name text,
  p_category text,
  p_brand_id uuid default null
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
  allocated_serial_number text;
  brand_is_active boolean;
  changed_at timestamptz;
  created_product_id uuid;
  normalized_category text;
  normalized_name text;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('inventory.products.create')
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

  normalized_name := pg_catalog.btrim(p_name);
  normalized_category := pg_catalog.btrim(p_category);

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

  allocated_serial_number := public.allocate_product_serial_number();
  changed_at := pg_catalog.clock_timestamp();

  insert into public.products as inserted (
    serial_number,
    name,
    category,
    brand_id,
    product_kind,
    is_active,
    created_at,
    created_by_user_id,
    updated_at,
    updated_by_user_id
  )
  values (
    allocated_serial_number,
    normalized_name,
    normalized_category,
    p_brand_id,
    'component',
    true,
    changed_at,
    actor_profile_id,
    changed_at,
    actor_profile_id
  )
  returning inserted.id into created_product_id;

  perform public.append_audit_log(
    p_action_type => 'product.created',
    p_entity_type => 'product',
    p_summary => 'Created Product ' || allocated_serial_number ||
      ' - ' || normalized_name,
    p_entity_id => created_product_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'serial_number', allocated_serial_number,
      'name', normalized_name,
      'category', normalized_category,
      'brand_id', p_brand_id,
      'product_kind', 'component',
      'is_active', true
    )
  );

  return query
  select created_product_id, allocated_serial_number;
end;
$function$;

revoke all privileges
  on function public.create_product(text, text, uuid)
  from public, anon, authenticated;

grant execute
  on function public.create_product(text, text, uuid)
  to authenticated;
