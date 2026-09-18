-- A confirmed Component import is one trusted, all-or-nothing Product creation.
-- The file is parsed by a later client task; this boundary accepts only data.
create function public.bulk_import_components(p_rows jsonb)
returns table (
  input_index integer,
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
  actor_is_admin boolean;
  row_count integer;
  row_position integer := 0;
  input_row jsonb;
  normalized_name text;
  normalized_category text;
  normalized_brand text;
  normalized_names text[] := '{}'::text[];
  normalized_categories text[] := '{}'::text[];
  normalized_brands text[] := '{}'::text[];
  brand_lookup_keys text[] := '{}'::text[];
  locked_brand_keys text[] := '{}'::text[];
  locked_brand_ids uuid[] := '{}'::uuid[];
  brand_record record;
  resolved_brand_id uuid;
  created_product_id uuid;
  created_product_ids uuid[] := '{}'::uuid[];
  allocated_serial text;
  batch_created_at timestamptz;
begin
  if auth.uid() is null or not (
    public.current_user_is_admin()
    or public.has_permission('inventory.products.create')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  -- Hold the actor and, for a delegate, the grant stable through commit.
  select profile.id, profile.is_admin
  into actor_profile_id, actor_is_admin
  from public.user_profiles as profile
  where profile.auth_user_id = auth.uid() and profile.is_active
  for share;

  if not found then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if not actor_is_admin then
    perform 1
    from public.user_permissions as permission
    join public.permission_definitions as definition
      on definition.id = permission.permission_definition_id
    where permission.user_id = actor_profile_id
      and definition.key = 'inventory.products.create'
      and definition.is_delegable
    for share of permission, definition;
    if not found then
      raise exception 'Access denied' using errcode = '42501';
    end if;
  end if;

  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Invalid Component import' using errcode = '22023';
  end if;
  row_count := pg_catalog.jsonb_array_length(p_rows);
  if row_count < 1 or row_count > 1000 then
    raise exception 'Invalid Component import size' using errcode = '22023';
  end if;

  -- Parse and normalize the complete batch before allocating any Serial.
  for input_row in
    select entry.value
    from pg_catalog.jsonb_array_elements(p_rows) as entry(value)
  loop
    if pg_catalog.jsonb_typeof(input_row) <> 'object' then
      raise exception 'Invalid Component import row' using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(input_row) as supplied(property_name)
      where supplied.property_name not in ('name', 'category', 'brand')
    ) or not (input_row ? 'name')
      or not (input_row ? 'category')
      or pg_catalog.jsonb_typeof(input_row->'name') <> 'string'
      or pg_catalog.jsonb_typeof(input_row->'category') <> 'string'
      or (
        input_row ? 'brand'
        and pg_catalog.jsonb_typeof(input_row->'brand')
          not in ('string', 'null')
      )
    then
      raise exception 'Invalid Component import row' using errcode = '22023';
    end if;

    normalized_name := pg_catalog.btrim(input_row->>'name');
    normalized_category := pg_catalog.btrim(input_row->>'category');
    if normalized_name is null or pg_catalog.length(normalized_name) = 0
      or normalized_category is null
      or pg_catalog.length(normalized_category) = 0
    then
      raise exception 'Component name and category are required'
        using errcode = '22023';
    end if;

    normalized_brand := null;
    if pg_catalog.jsonb_typeof(input_row->'brand') = 'string' then
      normalized_brand := nullif(
        pg_catalog.btrim(input_row->>'brand'), ''
      );
    end if;
    normalized_names := pg_catalog.array_append(normalized_names, normalized_name);
    normalized_categories := pg_catalog.array_append(
      normalized_categories, normalized_category
    );
    normalized_brands := pg_catalog.array_append(
      normalized_brands, normalized_brand
    );
    if normalized_brand is not null
      and pg_catalog.array_position(
        brand_lookup_keys, pg_catalog.lower(normalized_brand)
      ) is null
    then
      brand_lookup_keys := pg_catalog.array_append(
        brand_lookup_keys, pg_catalog.lower(normalized_brand)
      );
    end if;
  end loop;

  -- Stable name order prevents two imports from taking shared Brand locks in
  -- opposite orders. FOR SHARE blocks archive/name changes until commit.
  for brand_record in
    select brand.id, pg_catalog.lower(brand.name) as name_key, brand.is_active
    from public.brands as brand
    where pg_catalog.lower(brand.name) = any(brand_lookup_keys)
    order by pg_catalog.lower(brand.name), brand.id
    for share of brand
  loop
    if not brand_record.is_active then
      raise exception 'Brand is unavailable' using errcode = 'PRD04';
    end if;
    locked_brand_keys := pg_catalog.array_append(
      locked_brand_keys, brand_record.name_key
    );
    locked_brand_ids := pg_catalog.array_append(locked_brand_ids, brand_record.id);
  end loop;
  if pg_catalog.cardinality(locked_brand_ids)
    <> pg_catalog.cardinality(brand_lookup_keys)
  then
    raise exception 'Brand is unavailable' using errcode = 'PRD04';
  end if;

  batch_created_at := pg_catalog.clock_timestamp();
  for row_position in 1..row_count loop
    resolved_brand_id := null;
    if normalized_brands[row_position] is not null then
      resolved_brand_id := locked_brand_ids[
        pg_catalog.array_position(
          locked_brand_keys,
          pg_catalog.lower(normalized_brands[row_position])
        )
      ];
    end if;

    allocated_serial := public.allocate_product_serial_number();
    insert into public.products as inserted (
      serial_number, name, category, brand_id, product_kind, is_active,
      created_at, created_by_user_id, updated_at, updated_by_user_id
    ) values (
      allocated_serial,
      normalized_names[row_position],
      normalized_categories[row_position],
      resolved_brand_id,
      'component',
      true,
      batch_created_at,
      actor_profile_id,
      batch_created_at,
      actor_profile_id
    ) returning inserted.id into created_product_id;

    created_product_ids := pg_catalog.array_append(
      created_product_ids, created_product_id
    );
    input_index := row_position;
    product_id := created_product_id;
    serial_number := allocated_serial;
    return next;
  end loop;

  perform public.append_audit_log(
    p_action_type => 'product.bulk_imported',
    p_entity_type => 'product',
    p_summary => 'Bulk imported ' || row_count::text || ' Components',
    p_entity_id => null,
    p_after_data => pg_catalog.jsonb_build_object(
      'created_count', row_count,
      'created_product_ids', pg_catalog.to_jsonb(created_product_ids)
    )
  );
end;
$function$;

revoke all privileges
  on function public.bulk_import_components(jsonb)
  from public, anon, authenticated;

grant execute
  on function public.bulk_import_components(jsonb)
  to authenticated;
