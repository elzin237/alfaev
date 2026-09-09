create function public.update_product(
  p_product_id uuid,
  p_name text,
  p_category text,
  p_brand_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  brand_is_active boolean;
  changed_at timestamptz;
  current_product public.products%rowtype;
  normalized_category text;
  normalized_name text;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('inventory.products.edit')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_product_id is null then
    raise exception 'Product is required'
      using errcode = '22023';
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

  select public.products.*
  into current_product
  from public.products
  where public.products.id = p_product_id
  for update;

  if not found then
    raise exception 'Product not found'
      using errcode = 'P0002';
  end if;

  if not current_product.is_active then
    raise exception 'Archived Products cannot be edited'
      using errcode = 'PRD01';
  end if;

  if p_brand_id is distinct from current_product.brand_id
    and p_brand_id is not null
  then
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

  if current_product.name = normalized_name
    and current_product.category = normalized_category
    and current_product.brand_id is not distinct from p_brand_id
  then
    return current_product.id;
  end if;

  changed_at := pg_catalog.clock_timestamp();

  update public.products
  set name = normalized_name,
      category = normalized_category,
      brand_id = p_brand_id,
      updated_at = changed_at,
      updated_by_user_id = actor_profile_id
  where public.products.id = current_product.id;

  perform public.append_audit_log(
    p_action_type => 'product.updated',
    p_entity_type => 'product',
    p_summary => 'Updated Product ' || current_product.serial_number ||
      ' - ' || normalized_name,
    p_entity_id => current_product.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'serial_number', current_product.serial_number,
      'name', current_product.name,
      'category', current_product.category,
      'brand_id', current_product.brand_id,
      'product_kind', current_product.product_kind,
      'is_active', current_product.is_active
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'serial_number', current_product.serial_number,
      'name', normalized_name,
      'category', normalized_category,
      'brand_id', p_brand_id,
      'product_kind', current_product.product_kind,
      'is_active', current_product.is_active
    )
  );

  return current_product.id;
end;
$function$;

revoke all privileges
  on function public.update_product(uuid, text, text, uuid)
  from public, anon, authenticated;

grant execute
  on function public.update_product(uuid, text, text, uuid)
  to authenticated;
