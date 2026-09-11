create function public.current_product_supplier_mutation_actor_id()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
begin
  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    return null;
  end if;

  if public.current_user_is_admin()
    or public.has_permission('inventory.products.edit')
    or public.has_permission('suppliers.edit')
  then
    return actor_profile_id;
  end if;

  return null;
end;
$function$;

revoke all privileges
  on function public.current_product_supplier_mutation_actor_id()
  from public, anon, authenticated;

create function public.create_product_supplier(
  p_product_id uuid,
  p_supplier_id uuid,
  p_catalog_number text default null
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
  created_relation_id uuid;
  current_product public.products%rowtype;
  current_supplier public.suppliers%rowtype;
  normalized_catalog_number text;
begin
  actor_profile_id := public.current_product_supplier_mutation_actor_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_product_id is null then
    raise exception 'Product is required'
      using errcode = '22023';
  end if;

  if p_supplier_id is null then
    raise exception 'Supplier is required'
      using errcode = '22023';
  end if;

  normalized_catalog_number := nullif(
    pg_catalog.btrim(p_catalog_number),
    ''
  );

  select product.*
  into current_product
  from public.products as product
  where product.id = p_product_id
  for share;

  if not found or not current_product.is_active then
    raise exception 'Product is unavailable'
      using errcode = 'PSR02';
  end if;

  select supplier.*
  into current_supplier
  from public.suppliers as supplier
  where supplier.id = p_supplier_id
  for share;

  if not found or not current_supplier.is_active then
    raise exception 'Supplier is unavailable'
      using errcode = 'PSR03';
  end if;

  actor_profile_id := public.current_product_supplier_mutation_actor_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  begin
    insert into public.product_suppliers as created_relation (
      product_id,
      supplier_id,
      catalog_number,
      is_active,
      created_at,
      created_by_user_id,
      updated_at,
      updated_by_user_id
    )
    values (
      current_product.id,
      current_supplier.id,
      normalized_catalog_number,
      true,
      changed_at,
      actor_profile_id,
      changed_at,
      actor_profile_id
    )
    returning created_relation.id into created_relation_id;
  exception
    when unique_violation then
      raise exception 'ProductSupplier relationship already exists'
        using errcode = 'PSR04';
  end;

  perform public.append_audit_log(
    p_action_type => 'product_supplier.created',
    p_entity_type => 'product_supplier',
    p_summary => 'Linked Product ' || current_product.serial_number ||
      ' to Supplier ' || current_supplier.name,
    p_entity_id => created_relation_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'product_id', current_product.id,
      'supplier_id', current_supplier.id,
      'catalog_number', normalized_catalog_number,
      'is_active', true
    )
  );

  return created_relation_id;
end;
$function$;

create function public.update_product_supplier(
  p_product_supplier_id uuid,
  p_catalog_number text
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
  current_relation public.product_suppliers%rowtype;
  normalized_catalog_number text;
begin
  actor_profile_id := public.current_product_supplier_mutation_actor_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_product_supplier_id is null then
    raise exception 'ProductSupplier relationship is required'
      using errcode = '22023';
  end if;

  normalized_catalog_number := nullif(
    pg_catalog.btrim(p_catalog_number),
    ''
  );

  select product_supplier.*
  into current_relation
  from public.product_suppliers as product_supplier
  where product_supplier.id = p_product_supplier_id
  for update;

  if not found then
    raise exception 'ProductSupplier relationship not found'
      using errcode = 'P0002';
  end if;

  actor_profile_id := public.current_product_supplier_mutation_actor_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if not current_relation.is_active then
    raise exception 'Archived ProductSupplier relationships cannot be edited'
      using errcode = 'PSR01';
  end if;

  if current_relation.catalog_number is not distinct from
    normalized_catalog_number
  then
    return current_relation.id;
  end if;

  changed_at := pg_catalog.clock_timestamp();

  begin
    update public.product_suppliers
    set catalog_number = normalized_catalog_number,
        updated_at = changed_at,
        updated_by_user_id = actor_profile_id
    where public.product_suppliers.id = current_relation.id;
  exception
    when unique_violation then
      raise exception 'ProductSupplier relationship already exists'
        using errcode = 'PSR04';
  end;

  perform public.append_audit_log(
    p_action_type => 'product_supplier.updated',
    p_entity_type => 'product_supplier',
    p_summary => 'Updated ProductSupplier Catalog Number',
    p_entity_id => current_relation.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'product_id', current_relation.product_id,
      'supplier_id', current_relation.supplier_id,
      'catalog_number', current_relation.catalog_number,
      'is_active', current_relation.is_active
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'product_id', current_relation.product_id,
      'supplier_id', current_relation.supplier_id,
      'catalog_number', normalized_catalog_number,
      'is_active', current_relation.is_active
    )
  );

  return current_relation.id;
end;
$function$;

create function public.archive_product_supplier(
  p_product_supplier_id uuid
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
  current_relation public.product_suppliers%rowtype;
begin
  actor_profile_id := public.current_product_supplier_mutation_actor_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_product_supplier_id is null then
    raise exception 'ProductSupplier relationship is required'
      using errcode = '22023';
  end if;

  select product_supplier.*
  into current_relation
  from public.product_suppliers as product_supplier
  where product_supplier.id = p_product_supplier_id
  for update;

  if not found then
    raise exception 'ProductSupplier relationship not found'
      using errcode = 'P0002';
  end if;

  actor_profile_id := public.current_product_supplier_mutation_actor_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if not current_relation.is_active then
    raise exception 'ProductSupplier relationship is already archived'
      using errcode = 'PSR01';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  update public.product_suppliers
  set is_active = false,
      archived_at = changed_at,
      archived_by_user_id = actor_profile_id,
      updated_at = changed_at,
      updated_by_user_id = actor_profile_id
  where public.product_suppliers.id = current_relation.id;

  perform public.append_audit_log(
    p_action_type => 'product_supplier.archived',
    p_entity_type => 'product_supplier',
    p_summary => 'Archived ProductSupplier relationship',
    p_entity_id => current_relation.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'product_id', current_relation.product_id,
      'supplier_id', current_relation.supplier_id,
      'catalog_number', current_relation.catalog_number,
      'is_active', true,
      'archived_at', null,
      'archived_by_user_id', null
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'product_id', current_relation.product_id,
      'supplier_id', current_relation.supplier_id,
      'catalog_number', current_relation.catalog_number,
      'is_active', false,
      'archived_at', changed_at,
      'archived_by_user_id', actor_profile_id
    )
  );

  return current_relation.id;
end;
$function$;

revoke all privileges
  on function public.create_product_supplier(uuid, uuid, text)
  from public, anon, authenticated;
revoke all privileges
  on function public.update_product_supplier(uuid, text)
  from public, anon, authenticated;
revoke all privileges
  on function public.archive_product_supplier(uuid)
  from public, anon, authenticated;

grant execute
  on function public.create_product_supplier(uuid, uuid, text)
  to authenticated;
grant execute
  on function public.update_product_supplier(uuid, text)
  to authenticated;
grant execute
  on function public.archive_product_supplier(uuid)
  to authenticated;
