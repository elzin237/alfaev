create function public.archive_product(p_product_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  changed_at timestamptz;
  current_product public.products%rowtype;
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

  select public.products.*
  into current_product
  from public.products
  where public.products.id = p_product_id
  for update;

  if not found then
    raise exception 'Product not found'
      using errcode = 'P0002';
  end if;

  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('inventory.products.edit')
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

  if not current_product.is_active then
    raise exception 'Product is already archived'
      using errcode = 'PRD01';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  update public.products
  set is_active = false,
      archived_at = changed_at,
      archived_by_user_id = actor_profile_id,
      updated_at = changed_at,
      updated_by_user_id = actor_profile_id
  where public.products.id = current_product.id;

  perform public.append_audit_log(
    p_action_type => 'product.archived',
    p_entity_type => 'product',
    p_summary => 'Archived Product ' || current_product.serial_number ||
      ' - ' || current_product.name,
    p_entity_id => current_product.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'serial_number', current_product.serial_number,
      'name', current_product.name,
      'category', current_product.category,
      'brand_id', current_product.brand_id,
      'product_kind', current_product.product_kind,
      'is_active', true,
      'archived_at', null,
      'archived_by_user_id', null
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'serial_number', current_product.serial_number,
      'name', current_product.name,
      'category', current_product.category,
      'brand_id', current_product.brand_id,
      'product_kind', current_product.product_kind,
      'is_active', false,
      'archived_at', changed_at,
      'archived_by_user_id', actor_profile_id
    )
  );

  return current_product.id;
end;
$function$;

revoke all privileges
  on function public.archive_product(uuid)
  from public, anon, authenticated;

grant execute
  on function public.archive_product(uuid)
  to authenticated;
