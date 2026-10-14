alter table public.suppliers
  add column catalog_number text,
  add column description text;

do $block$
declare
  conflicting_supplier record;
begin
  if exists (
    select 1 from public.suppliers
    where id = '131c727b-0928-4184-9fb9-6ad3319c4380'::uuid
      and name <> 'ANSOYO'
  ) then
    raise exception 'ANSOYO Supplier identity does not match the approved backfill';
  end if;
  if exists (
    select 1 from public.suppliers
    where id = 'a79bb2bc-3998-4d7c-ad99-0819bbbf2be1'::uuid
      and name <> 'IBP'
  ) then
    raise exception 'IBP Supplier identity does not match the approved backfill';
  end if;

  select supplier.id, supplier.name
  into conflicting_supplier
  from public.suppliers as supplier
  join public.product_suppliers as relationship
    on relationship.supplier_id = supplier.id
   and relationship.is_active
  where supplier.id not in (
    '131c727b-0928-4184-9fb9-6ad3319c4380'::uuid,
    'a79bb2bc-3998-4d7c-ad99-0819bbbf2be1'::uuid
  )
  group by supplier.id, supplier.name
  having pg_catalog.count(distinct relationship.catalog_number) <> 1
  limit 1;
  if found then
    raise exception 'Supplier % (%) has no deterministic active Catalog Number backfill',
      conflicting_supplier.name, conflicting_supplier.id;
  end if;

  update public.suppliers
  set catalog_number = 'ansoyo26'
  where id = '131c727b-0928-4184-9fb9-6ad3319c4380'::uuid
    and name = 'ANSOYO';

  update public.suppliers
  set catalog_number = 'ibp26'
  where id = 'a79bb2bc-3998-4d7c-ad99-0819bbbf2be1'::uuid
    and name = 'IBP';

  with catalog_candidates as (
    select distinct relationship.supplier_id, relationship.catalog_number
    from public.product_suppliers as relationship
    where relationship.is_active
      and relationship.catalog_number is not null
      and relationship.supplier_id not in (
        '131c727b-0928-4184-9fb9-6ad3319c4380'::uuid,
        'a79bb2bc-3998-4d7c-ad99-0819bbbf2be1'::uuid
      )
  ), deterministic_catalog as (
    select candidate.supplier_id, candidate.catalog_number
    from catalog_candidates as candidate
    where not exists (
      select 1
      from catalog_candidates as other
      where other.supplier_id = candidate.supplier_id
        and other.catalog_number <> candidate.catalog_number
    )
  )
  update public.suppliers as supplier
  set catalog_number = deterministic_catalog.catalog_number
  from deterministic_catalog
  where supplier.id = deterministic_catalog.supplier_id;

  if exists (
    select 1 from public.suppliers as supplier
    where supplier.is_active
      and (
        supplier.catalog_number is null
        or pg_catalog.length(pg_catalog.btrim(supplier.catalog_number)) = 0
      )
  ) then
    raise exception 'Every active Supplier requires an authoritative Catalog Number'
      using errcode = 'SUP04';
  end if;
end;
$block$;

alter table public.suppliers
  add constraint suppliers_catalog_number_normalized
    check (
      catalog_number is null
      or (
        catalog_number = pg_catalog.btrim(catalog_number)
        and pg_catalog.length(catalog_number) between 1 and 200
      )
    ),
  add constraint suppliers_description_normalized
    check (
      description is null
      or (
        description = pg_catalog.btrim(description)
        and pg_catalog.length(description) between 1 and 2000
      )
    ),
  add constraint suppliers_active_catalog_required
    check (not is_active or catalog_number is not null);

do $block$
begin
  if exists (
    select 1
    from public.product_suppliers as relationship
    where relationship.is_active
    group by relationship.product_id, relationship.supplier_id
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'Duplicate active ProductSupplier relationships prevent Supplier catalog correction';
  end if;
end;
$block$;

create unique index product_suppliers_one_active_pair_idx
  on public.product_suppliers (product_id, supplier_id)
  where is_active;

drop function public.create_supplier(text, text, text, text, text);
drop function public.update_supplier(uuid, text, text, text, text, text);

create function public.create_supplier(
  p_name text,
  p_catalog_number text,
  p_country text,
  p_description text default null,
  p_contact_person_name text default null,
  p_contact_phone text default null,
  p_contact_email text default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  supplier_id uuid;
  changed_at timestamptz;
  normalized_name text;
  normalized_catalog_number text;
  normalized_description text;
  normalized_country text;
  normalized_contact_person_name text;
  normalized_contact_phone text;
  normalized_contact_email text;
begin
  if auth.uid() is null or not (
    public.current_user_is_admin() or public.has_permission('suppliers.create')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  actor_profile_id := public.current_active_user_profile_id();
  if actor_profile_id is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  normalized_name := pg_catalog.btrim(p_name);
  normalized_catalog_number := pg_catalog.btrim(p_catalog_number);
  normalized_description := nullif(pg_catalog.btrim(p_description), '');
  normalized_country := pg_catalog.btrim(p_country);
  normalized_contact_person_name := nullif(pg_catalog.btrim(p_contact_person_name), '');
  normalized_contact_phone := nullif(pg_catalog.btrim(p_contact_phone), '');
  normalized_contact_email := pg_catalog.lower(nullif(pg_catalog.btrim(p_contact_email), ''));

  if normalized_name is null or pg_catalog.length(normalized_name) = 0 then
    raise exception 'Supplier name is required' using errcode = '22023';
  end if;
  if normalized_catalog_number is null
    or pg_catalog.length(normalized_catalog_number) = 0
    or pg_catalog.length(normalized_catalog_number) > 200
  then
    raise exception 'Supplier Catalog Number is required' using errcode = 'SUP04';
  end if;
  if normalized_description is not null
    and pg_catalog.length(normalized_description) > 2000
  then
    raise exception 'Supplier Description is too long' using errcode = '22023';
  end if;
  if normalized_country is null or pg_catalog.length(normalized_country) = 0 then
    raise exception 'Supplier country is required' using errcode = '22023';
  end if;
  if normalized_contact_email is not null
    and normalized_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'Supplier email is invalid' using errcode = 'SUP03';
  end if;

  changed_at := pg_catalog.clock_timestamp();
  begin
    insert into public.suppliers (
      name, catalog_number, description, country, contact_person_name,
      contact_phone, contact_email, is_active, created_at,
      created_by_user_id, updated_at, updated_by_user_id
    ) values (
      normalized_name, normalized_catalog_number, normalized_description,
      normalized_country, normalized_contact_person_name,
      normalized_contact_phone, normalized_contact_email, true, changed_at,
      actor_profile_id, changed_at, actor_profile_id
    ) returning id into supplier_id;
  exception when unique_violation then
    raise exception 'Supplier name already exists' using errcode = 'SUP02';
  end;

  perform public.append_audit_log(
    p_action_type => 'supplier.created',
    p_entity_type => 'supplier',
    p_summary => 'Created Supplier ' || normalized_name,
    p_entity_id => supplier_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'name', normalized_name,
      'catalog_number', normalized_catalog_number,
      'description', normalized_description,
      'country', normalized_country,
      'contact_person_name', normalized_contact_person_name,
      'contact_phone', normalized_contact_phone,
      'contact_email', normalized_contact_email,
      'is_active', true
    )
  );
  return supplier_id;
end;
$function$;

create function public.update_supplier(
  p_supplier_id uuid,
  p_name text,
  p_catalog_number text,
  p_country text,
  p_description text default null,
  p_contact_person_name text default null,
  p_contact_phone text default null,
  p_contact_email text default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  current_supplier public.suppliers%rowtype;
  changed_at timestamptz;
  normalized_name text;
  normalized_catalog_number text;
  normalized_description text;
  normalized_country text;
  normalized_contact_person_name text;
  normalized_contact_phone text;
  normalized_contact_email text;
begin
  if auth.uid() is null or not (
    public.current_user_is_admin() or public.has_permission('suppliers.edit')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_supplier_id is null then
    raise exception 'Supplier is required' using errcode = '22023';
  end if;
  actor_profile_id := public.current_active_user_profile_id();
  if actor_profile_id is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  normalized_name := pg_catalog.btrim(p_name);
  normalized_catalog_number := pg_catalog.btrim(p_catalog_number);
  normalized_description := nullif(pg_catalog.btrim(p_description), '');
  normalized_country := pg_catalog.btrim(p_country);
  normalized_contact_person_name := nullif(pg_catalog.btrim(p_contact_person_name), '');
  normalized_contact_phone := nullif(pg_catalog.btrim(p_contact_phone), '');
  normalized_contact_email := pg_catalog.lower(nullif(pg_catalog.btrim(p_contact_email), ''));

  if normalized_name is null or pg_catalog.length(normalized_name) = 0 then
    raise exception 'Supplier name is required' using errcode = '22023';
  end if;
  if normalized_catalog_number is null
    or pg_catalog.length(normalized_catalog_number) = 0
    or pg_catalog.length(normalized_catalog_number) > 200
  then
    raise exception 'Supplier Catalog Number is required' using errcode = 'SUP04';
  end if;
  if normalized_description is not null
    and pg_catalog.length(normalized_description) > 2000
  then
    raise exception 'Supplier Description is too long' using errcode = '22023';
  end if;
  if normalized_country is null or pg_catalog.length(normalized_country) = 0 then
    raise exception 'Supplier country is required' using errcode = '22023';
  end if;
  if normalized_contact_email is not null
    and normalized_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'Supplier email is invalid' using errcode = 'SUP03';
  end if;

  select supplier.* into current_supplier
  from public.suppliers as supplier
  where supplier.id = p_supplier_id
  for update;
  if not found then
    raise exception 'Supplier not found' using errcode = 'P0002';
  end if;
  if not current_supplier.is_active then
    raise exception 'Archived Suppliers cannot be edited' using errcode = 'SUP01';
  end if;

  actor_profile_id := public.current_active_user_profile_id();
  if actor_profile_id is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if current_supplier.name = normalized_name
    and current_supplier.catalog_number = normalized_catalog_number
    and current_supplier.description is not distinct from normalized_description
    and current_supplier.country = normalized_country
    and current_supplier.contact_person_name is not distinct from normalized_contact_person_name
    and current_supplier.contact_phone is not distinct from normalized_contact_phone
    and current_supplier.contact_email is not distinct from normalized_contact_email
  then
    return current_supplier.id;
  end if;

  changed_at := pg_catalog.clock_timestamp();
  begin
    update public.suppliers as supplier
    set name = normalized_name,
        catalog_number = normalized_catalog_number,
        description = normalized_description,
        country = normalized_country,
        contact_person_name = normalized_contact_person_name,
        contact_phone = normalized_contact_phone,
        contact_email = normalized_contact_email,
        updated_at = changed_at,
        updated_by_user_id = actor_profile_id
    where supplier.id = current_supplier.id;
  exception when unique_violation then
    raise exception 'Supplier name already exists' using errcode = 'SUP02';
  end;

  perform public.append_audit_log(
    p_action_type => 'supplier.updated',
    p_entity_type => 'supplier',
    p_summary => 'Updated Supplier ' || current_supplier.name,
    p_entity_id => current_supplier.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'name', current_supplier.name,
      'catalog_number', current_supplier.catalog_number,
      'description', current_supplier.description,
      'country', current_supplier.country,
      'contact_person_name', current_supplier.contact_person_name,
      'contact_phone', current_supplier.contact_phone,
      'contact_email', current_supplier.contact_email
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'name', normalized_name,
      'catalog_number', normalized_catalog_number,
      'description', normalized_description,
      'country', normalized_country,
      'contact_person_name', normalized_contact_person_name,
      'contact_phone', normalized_contact_phone,
      'contact_email', normalized_contact_email
    )
  );
  return current_supplier.id;
end;
$function$;

revoke all privileges on function public.create_supplier(
  text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all privileges on function public.update_supplier(
  uuid, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_supplier(
  text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.update_supplier(
  uuid, text, text, text, text, text, text, text
) to authenticated;

drop function public.create_product_supplier(uuid, uuid, text, text);
drop function public.update_product_supplier(uuid, text, text);

create function public.create_product_supplier(
  p_product_id uuid,
  p_supplier_id uuid
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  changed_at timestamptz;
  created_relation_id uuid;
  current_product public.products%rowtype;
  current_supplier public.suppliers%rowtype;
begin
  actor_profile_id := public.current_product_supplier_mutation_actor_id();
  if actor_profile_id is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_id is null or p_supplier_id is null then
    raise exception 'Product and Supplier are required' using errcode = '22023';
  end if;

  select product.* into current_product
  from public.products as product
  where product.id = p_product_id
  for share;
  if not found or not current_product.is_active then
    raise exception 'Product is unavailable' using errcode = 'PSR02';
  end if;
  select supplier.* into current_supplier
  from public.suppliers as supplier
  where supplier.id = p_supplier_id
  for share;
  if not found or not current_supplier.is_active
    or current_supplier.catalog_number is null
  then
    raise exception 'Supplier is unavailable' using errcode = 'PSR03';
  end if;

  actor_profile_id := public.current_product_supplier_mutation_actor_id();
  if actor_profile_id is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  changed_at := pg_catalog.clock_timestamp();
  begin
    insert into public.product_suppliers as relationship (
      product_id, supplier_id, catalog_number, description, is_active,
      created_at, created_by_user_id, updated_at, updated_by_user_id
    ) values (
      current_product.id, current_supplier.id,
      current_supplier.catalog_number, null, true,
      changed_at, actor_profile_id, changed_at, actor_profile_id
    ) returning relationship.id into created_relation_id;
  exception when unique_violation then
    raise exception 'ProductSupplier relationship already exists' using errcode = 'PSR04';
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
      'is_active', true
    )
  );
  return created_relation_id;
end;
$function$;

revoke all privileges on function public.create_product_supplier(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_product_supplier(uuid, uuid)
  to authenticated;

create or replace function public.get_product_suppliers_for_product(p_product_id uuid)
returns table (
  relationship_id uuid,
  supplier_id uuid,
  supplier_name text,
  supplier_is_active boolean,
  catalog_number text,
  description text,
  relationship_is_active boolean
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if not (
    public.current_user_is_admin()
    or public.has_permission('inventory.view')
    or public.has_permission('suppliers.view')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_id is null then
    raise exception 'Product is required' using errcode = '22023';
  end if;
  return query
  select relationship.id, supplier.id, supplier.name, supplier.is_active,
    supplier.catalog_number, supplier.description, relationship.is_active
  from public.product_suppliers as relationship
  join public.suppliers as supplier on supplier.id = relationship.supplier_id
  where relationship.product_id = p_product_id
  order by relationship.is_active desc, pg_catalog.lower(supplier.name),
    supplier.name, relationship.id;
end;
$function$;

create or replace function public.get_product_suppliers_for_supplier(p_supplier_id uuid)
returns table (
  relationship_id uuid,
  product_id uuid,
  product_serial_number text,
  product_name text,
  product_is_active boolean,
  catalog_number text,
  description text,
  relationship_is_active boolean
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if not (
    public.current_user_is_admin()
    or public.has_permission('inventory.view')
    or public.has_permission('suppliers.view')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_supplier_id is null then
    raise exception 'Supplier is required' using errcode = '22023';
  end if;
  return query
  select relationship.id, product.id, product.serial_number, product.name,
    product.is_active, supplier.catalog_number, supplier.description,
    relationship.is_active
  from public.product_suppliers as relationship
  join public.products as product on product.id = relationship.product_id
  join public.suppliers as supplier on supplier.id = relationship.supplier_id
  where relationship.supplier_id = p_supplier_id
  order by relationship.is_active desc, product.serial_number, relationship.id;
end;
$function$;

create or replace function public.list_active_inventory_source_choices(p_product_id uuid)
returns table (
  product_supplier_id uuid,
  supplier_id uuid,
  supplier_name text,
  catalog_number text,
  description text
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_id is null then
    raise exception 'Product is required' using errcode = '22023';
  end if;
  return query
  select relationship.id, supplier.id, supplier.name,
    supplier.catalog_number, supplier.description
  from public.product_suppliers as relationship
  join public.suppliers as supplier on supplier.id = relationship.supplier_id
  where relationship.product_id = p_product_id
    and relationship.is_active
    and supplier.is_active
    and supplier.catalog_number is not null
  order by pg_catalog.lower(supplier.name), supplier.name,
    supplier.catalog_number, relationship.id;
end;
$function$;

create or replace function public.apply_inventory_delta(
  p_product_id uuid,
  p_quantity_delta bigint,
  p_movement_type text,
  p_reason text default null,
  p_source_type text default null,
  p_source_id uuid default null,
  p_project_id uuid default null,
  p_reversal_of_movement_id uuid default null,
  p_product_supplier_id uuid default null,
  p_inventory_source_kind text default null
)
returns table (movement_id uuid, quantity_before bigint, quantity_after bigint)
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  changed_at timestamptz;
  created_movement_id uuid;
  current_quantity bigint;
  normalized_movement_type text;
  normalized_reason text;
  normalized_source_type text;
  resulting_quantity bigint;
  effective_source_kind text;
  source_relationship public.product_suppliers%rowtype;
  source_supplier public.suppliers%rowtype;
begin
  if p_product_id is null or p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'Product and nonzero quantity delta are required' using errcode = '22023';
  end if;
  normalized_movement_type := pg_catalog.btrim(p_movement_type);
  if normalized_movement_type is null or pg_catalog.length(normalized_movement_type) = 0 then
    raise exception 'Movement type is required' using errcode = '22023';
  end if;
  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  normalized_source_type := nullif(pg_catalog.btrim(p_source_type), '');
  effective_source_kind := coalesce(
    p_inventory_source_kind,
    case when p_quantity_delta > 0
      and normalized_source_type = 'pcb_production_output'
      then 'internal_production' else null end
  );
  actor_profile_id := public.current_active_user_profile_id();
  if actor_profile_id is null then
    raise exception 'An active authenticated user is required' using errcode = '42501';
  end if;
  perform profile.id
  from public.user_profiles as profile
  where profile.id = actor_profile_id
    and profile.auth_user_id = auth.uid()
    and profile.is_active
  for share;
  if not found then
    raise exception 'An active authenticated user is required' using errcode = '42501';
  end if;

  select balance.quantity into current_quantity
  from public.inventory_balances as balance
  where balance.product_id = p_product_id
  for update;
  if not found then
    raise exception 'Inventory balance not found' using errcode = 'IVB01';
  end if;
  resulting_quantity := current_quantity + p_quantity_delta;
  if resulting_quantity < 0 then
    raise exception 'Inventory quantity cannot be negative' using errcode = 'IVB02';
  end if;

  if p_quantity_delta > 0 then
    if effective_source_kind = 'supplier' then
      if p_product_supplier_id is null then
        raise exception 'ProductSupplier source is required' using errcode = 'IVL03';
      end if;
      select relationship.* into source_relationship
      from public.product_suppliers as relationship
      where relationship.id = p_product_supplier_id
      for share;
      if not found or not source_relationship.is_active
        or source_relationship.product_id <> p_product_id
      then
        raise exception 'ProductSupplier source is unavailable' using errcode = 'IVL03';
      end if;
      select supplier.* into source_supplier
      from public.suppliers as supplier
      where supplier.id = source_relationship.supplier_id
      for share;
      if not found or not source_supplier.is_active
        or source_supplier.catalog_number is null
      then
        raise exception 'Supplier source is unavailable' using errcode = 'IVL03';
      end if;
    elsif effective_source_kind = 'internal_production' then
      if p_product_supplier_id is not null
        or normalized_source_type <> 'pcb_production_output'
      then
        raise exception 'Internal production source is invalid' using errcode = 'IVL03';
      end if;
    else
      raise exception 'Inventory source is required for inbound stock' using errcode = 'IVL03';
    end if;
  elsif p_product_supplier_id is not null or effective_source_kind is not null then
    raise exception 'Outbound stock source is allocated automatically' using errcode = 'IVL03';
  end if;

  changed_at := pg_catalog.clock_timestamp();
  update public.inventory_balances as balance
  set quantity = resulting_quantity, updated_at = changed_at
  where balance.product_id = p_product_id;

  insert into public.inventory_movements as inserted (
    product_id, movement_type, quantity_delta, quantity_before, quantity_after,
    reason, source_type, source_id, project_id, actor_user_id, created_at,
    reversal_of_movement_id
  ) values (
    p_product_id, normalized_movement_type, p_quantity_delta, current_quantity,
    resulting_quantity, normalized_reason, normalized_source_type, p_source_id,
    p_project_id, actor_profile_id, changed_at, p_reversal_of_movement_id
  ) returning inserted.id into created_movement_id;

  if p_quantity_delta < 0 then
    perform public.consume_inventory_source_lots(
      p_product_id, -p_quantity_delta, created_movement_id
    );
  elsif effective_source_kind = 'supplier' then
    insert into public.inventory_source_lots (
      product_id, source_kind, product_supplier_id, supplier_id,
      supplier_name_snapshot, catalog_number_snapshot,
      supplier_description_snapshot, received_quantity, remaining_quantity,
      originating_inventory_movement_id, received_at, actor_user_id
    ) values (
      p_product_id, 'supplier', source_relationship.id,
      source_supplier.id, source_supplier.name,
      source_supplier.catalog_number, source_supplier.description,
      p_quantity_delta, p_quantity_delta, created_movement_id, changed_at,
      actor_profile_id
    );
  else
    insert into public.inventory_source_lots (
      product_id, source_kind, received_quantity, remaining_quantity,
      originating_inventory_movement_id, received_at, actor_user_id
    ) values (
      p_product_id, 'internal_production', p_quantity_delta, p_quantity_delta,
      created_movement_id, changed_at, actor_profile_id
    );
  end if;
  return query select created_movement_id, current_quantity, resulting_quantity;
end;
$function$;

drop function public.create_product_from_procurement_request(uuid, text, text, uuid, text);

create function public.create_product_from_procurement_request(
  p_request_id uuid,
  p_name text,
  p_category text,
  p_brand_id uuid default null
)
returns table (product_id uuid, serial_number text)
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  brand_is_active boolean;
  changed_at timestamptz;
  created_product_id uuid;
  created_product_supplier_id uuid := null;
  created_serial_number text;
  current_request public.procurement_requests%rowtype;
  normalized_category text;
  normalized_name text;
  supplier_is_active boolean;
  supplier_catalog_number text;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'Procurement request is required' using errcode = '22023';
  end if;
  normalized_name := pg_catalog.btrim(p_name);
  normalized_category := pg_catalog.btrim(p_category);
  if normalized_name is null or pg_catalog.length(normalized_name) = 0 then
    raise exception 'Product name is required' using errcode = '22023';
  end if;
  if normalized_category is null or pg_catalog.length(normalized_category) = 0 then
    raise exception 'Product category is required' using errcode = '22023';
  end if;

  select request.* into current_request
  from public.procurement_requests as request
  where request.id = p_request_id
  for update;
  if not found then
    raise exception 'Procurement request not found' using errcode = 'P0002';
  end if;
  if current_request.status not in ('active', 'partly_delivered') then
    raise exception 'Resolved Procurement requests cannot create Products' using errcode = 'PRQ02';
  end if;
  if current_request.product_id is not null then
    raise exception 'Procurement request already has a Product' using errcode = 'PRQ05';
  end if;

  if current_request.supplier_id is not null then
    select supplier.is_active, supplier.catalog_number
    into supplier_is_active, supplier_catalog_number
    from public.suppliers as supplier
    where supplier.id = current_request.supplier_id
    for share;
    if not found or not supplier_is_active or supplier_catalog_number is null then
      raise exception 'Supplier is unavailable' using errcode = 'PRQ04';
    end if;
  end if;
  if p_brand_id is not null then
    select brand.is_active into brand_is_active
    from public.brands as brand
    where brand.id = p_brand_id
    for share;
    if not found or not brand_is_active then
      raise exception 'Brand is unavailable' using errcode = 'PRD04';
    end if;
  end if;
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  actor_profile_id := public.current_active_user_profile_id();
  if actor_profile_id is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select created.product_id, created.serial_number
  into created_product_id, created_serial_number
  from public.create_product(normalized_name, normalized_category, p_brand_id) as created;
  if current_request.supplier_id is not null then
    created_product_supplier_id := public.create_product_supplier(
      created_product_id, current_request.supplier_id
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
  return query select created_product_id, created_serial_number;
end;
$function$;

revoke all privileges on function public.create_product_from_procurement_request(
  uuid, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.create_product_from_procurement_request(
  uuid, text, text, uuid
) to authenticated;
