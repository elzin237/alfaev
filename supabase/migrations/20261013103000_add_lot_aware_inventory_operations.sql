drop function public.create_product_supplier(uuid, uuid, text);
drop function public.update_product_supplier(uuid, text);
drop function public.get_product_suppliers_for_product(uuid);
drop function public.get_product_suppliers_for_supplier(uuid);

create function public.create_product_supplier(
  p_product_id uuid,
  p_supplier_id uuid,
  p_catalog_number text,
  p_description text default null
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
  normalized_description text;
begin
  actor_profile_id := public.current_product_supplier_mutation_actor_id();
  if actor_profile_id is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_id is null or p_supplier_id is null then
    raise exception 'Product and Supplier are required' using errcode = '22023';
  end if;

  normalized_catalog_number := nullif(pg_catalog.btrim(p_catalog_number), '');
  normalized_description := nullif(pg_catalog.btrim(p_description), '');
  if normalized_catalog_number is null then
    raise exception 'Catalog Number is required' using errcode = 'PSR05';
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
  if not found or not current_supplier.is_active then
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
      current_product.id, current_supplier.id, normalized_catalog_number,
      normalized_description, true, changed_at, actor_profile_id,
      changed_at, actor_profile_id
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
      'catalog_number', normalized_catalog_number,
      'description', normalized_description,
      'is_active', true
    )
  );
  return created_relation_id;
end;
$function$;

create function public.update_product_supplier(
  p_product_supplier_id uuid,
  p_catalog_number text,
  p_description text default null
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
  normalized_description text;
begin
  actor_profile_id := public.current_product_supplier_mutation_actor_id();
  if actor_profile_id is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_supplier_id is null then
    raise exception 'ProductSupplier relationship is required' using errcode = '22023';
  end if;

  normalized_catalog_number := nullif(pg_catalog.btrim(p_catalog_number), '');
  normalized_description := nullif(pg_catalog.btrim(p_description), '');
  if normalized_catalog_number is null then
    raise exception 'Catalog Number is required' using errcode = 'PSR05';
  end if;

  select relationship.* into current_relation
  from public.product_suppliers as relationship
  where relationship.id = p_product_supplier_id
  for update;
  if not found then
    raise exception 'ProductSupplier relationship not found' using errcode = 'P0002';
  end if;
  if not current_relation.is_active then
    raise exception 'Archived ProductSupplier relationships cannot be edited'
      using errcode = 'PSR01';
  end if;

  actor_profile_id := public.current_product_supplier_mutation_actor_id();
  if actor_profile_id is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if current_relation.catalog_number = normalized_catalog_number
    and current_relation.description is not distinct from normalized_description
  then
    return current_relation.id;
  end if;

  changed_at := pg_catalog.clock_timestamp();
  begin
    update public.product_suppliers as relationship
    set catalog_number = normalized_catalog_number,
        description = normalized_description,
        updated_at = changed_at,
        updated_by_user_id = actor_profile_id
    where relationship.id = current_relation.id;
  exception when unique_violation then
    raise exception 'ProductSupplier relationship already exists' using errcode = 'PSR04';
  end;

  perform public.append_audit_log(
    p_action_type => 'product_supplier.updated',
    p_entity_type => 'product_supplier',
    p_summary => 'Updated ProductSupplier details',
    p_entity_id => current_relation.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'product_id', current_relation.product_id,
      'supplier_id', current_relation.supplier_id,
      'catalog_number', current_relation.catalog_number,
      'description', current_relation.description,
      'is_active', current_relation.is_active
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'product_id', current_relation.product_id,
      'supplier_id', current_relation.supplier_id,
      'catalog_number', normalized_catalog_number,
      'description', normalized_description,
      'is_active', current_relation.is_active
    )
  );
  return current_relation.id;
end;
$function$;

revoke all privileges on function public.create_product_supplier(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all privileges on function public.update_product_supplier(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_product_supplier(uuid, uuid, text, text)
  to authenticated;
grant execute on function public.update_product_supplier(uuid, text, text)
  to authenticated;

create function public.get_product_suppliers_for_product(p_product_id uuid)
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
    relationship.catalog_number, relationship.description, relationship.is_active
  from public.product_suppliers as relationship
  join public.suppliers as supplier on supplier.id = relationship.supplier_id
  where relationship.product_id = p_product_id
  order by relationship.is_active desc, pg_catalog.lower(supplier.name),
    supplier.name, relationship.catalog_number nulls first, relationship.id;
end;
$function$;

create function public.get_product_suppliers_for_supplier(p_supplier_id uuid)
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
    product.is_active, relationship.catalog_number, relationship.description,
    relationship.is_active
  from public.product_suppliers as relationship
  join public.products as product on product.id = relationship.product_id
  where relationship.supplier_id = p_supplier_id
  order by relationship.is_active desc, product.serial_number,
    relationship.catalog_number nulls first, relationship.id;
end;
$function$;

revoke all privileges on function public.get_product_suppliers_for_product(uuid)
  from public, anon, authenticated;
revoke all privileges on function public.get_product_suppliers_for_supplier(uuid)
  from public, anon, authenticated;
grant execute on function public.get_product_suppliers_for_product(uuid) to authenticated;
grant execute on function public.get_product_suppliers_for_supplier(uuid) to authenticated;

create function public.list_active_inventory_source_choices(p_product_id uuid)
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
    relationship.catalog_number, relationship.description
  from public.product_suppliers as relationship
  join public.suppliers as supplier on supplier.id = relationship.supplier_id
  where relationship.product_id = p_product_id
    and relationship.is_active
    and supplier.is_active
  order by pg_catalog.lower(supplier.name), supplier.name,
    relationship.catalog_number, relationship.id;
end;
$function$;

create function public.list_inventory_source_lots(p_product_id uuid)
returns table (
  source_lot_id uuid,
  source_kind text,
  received_at timestamptz,
  supplier_name text,
  catalog_number text,
  description text,
  received_quantity text,
  remaining_quantity text,
  added_by_full_name text
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if auth.uid() is null or not (
    public.current_user_is_admin() or public.has_permission('inventory.view')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_id is null then
    raise exception 'Product is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  return query
  select lot.id, lot.source_kind, lot.received_at,
    case lot.source_kind
      when 'supplier' then lot.supplier_name_snapshot
      when 'legacy_unknown' then 'Legacy / Unknown'
      else 'Internal Production'
    end,
    lot.catalog_number_snapshot,
    lot.supplier_description_snapshot,
    lot.received_quantity::text,
    lot.remaining_quantity::text,
    profile.full_name
  from public.inventory_source_lots as lot
  left join public.user_profiles as profile on profile.id = lot.actor_user_id
  where lot.product_id = p_product_id
  order by lot.received_at desc, lot.id desc;
end;
$function$;

revoke all privileges on function public.list_active_inventory_source_choices(uuid)
  from public, anon, authenticated;
revoke all privileges on function public.list_inventory_source_lots(uuid)
  from public, anon, authenticated;
grant execute on function public.list_active_inventory_source_choices(uuid) to authenticated;
grant execute on function public.list_inventory_source_lots(uuid) to authenticated;

create function public.consume_inventory_source_lots(
  p_product_id uuid,
  p_quantity bigint,
  p_outbound_inventory_movement_id uuid
)
returns void
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  lot_record record;
  movement_product_id uuid;
  remaining_to_allocate bigint;
  taken_quantity bigint;
begin
  if p_product_id is null or p_quantity is null or p_quantity <= 0
    or p_outbound_inventory_movement_id is null
  then
    raise exception 'Valid source allocation input is required' using errcode = '22023';
  end if;

  select movement.product_id into movement_product_id
  from public.inventory_movements as movement
  where movement.id = p_outbound_inventory_movement_id
    and movement.quantity_delta < 0;
  if not found or movement_product_id <> p_product_id then
    raise exception 'Outbound Inventory movement does not match Product'
      using errcode = 'IVL03';
  end if;

  remaining_to_allocate := p_quantity;
  for lot_record in
    select lot.id, lot.remaining_quantity
    from public.inventory_source_lots as lot
    where lot.product_id = p_product_id and lot.remaining_quantity > 0
    order by lot.received_at, lot.id
    for update
  loop
    exit when remaining_to_allocate = 0;
    taken_quantity := least(lot_record.remaining_quantity, remaining_to_allocate);
    update public.inventory_source_lots as lot
    set remaining_quantity = lot.remaining_quantity - taken_quantity
    where lot.id = lot_record.id;
    insert into public.inventory_source_allocations (
      outbound_inventory_movement_id, source_lot_id, product_id, allocated_quantity
    ) values (
      p_outbound_inventory_movement_id, lot_record.id, p_product_id, taken_quantity
    );
    remaining_to_allocate := remaining_to_allocate - taken_quantity;
  end loop;

  if remaining_to_allocate <> 0 then
    raise exception 'Inventory source lots are insufficient' using errcode = 'IVB02';
  end if;
end;
$function$;

revoke all privileges on function public.consume_inventory_source_lots(uuid, bigint, uuid)
  from public, anon, authenticated;

drop function public.apply_inventory_delta(uuid, bigint, text, text, text, uuid, uuid, uuid);

create function public.apply_inventory_delta(
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
    case
      when p_quantity_delta > 0
        and normalized_source_type = 'pcb_production_output'
      then 'internal_production'
      else null
    end
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
      if not found or not source_supplier.is_active then
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
      source_relationship.supplier_id, source_supplier.name,
      source_relationship.catalog_number, source_relationship.description,
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

revoke all privileges on function public.apply_inventory_delta(
  uuid, bigint, text, text, text, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;

drop function public.manual_adjust_inventory(uuid, text, bigint, text);

create function public.manual_adjust_inventory(
  p_product_id uuid,
  p_adjustment_type text,
  p_quantity bigint,
  p_reason text,
  p_product_supplier_id uuid
)
returns table (movement_id uuid, quantity_before bigint, quantity_after bigint)
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  applied record;
  current_product public.products%rowtype;
  current_quantity bigint;
  normalized_adjustment_type text;
  normalized_reason text;
  quantity_delta bigint;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_id is null or p_quantity is null then
    raise exception 'Product and quantity are required' using errcode = 'MIA01';
  end if;
  normalized_adjustment_type := pg_catalog.lower(pg_catalog.btrim(p_adjustment_type));
  normalized_reason := pg_catalog.btrim(p_reason);
  if normalized_adjustment_type is null
    or normalized_adjustment_type not in ('add', 'remove', 'correction')
    or normalized_reason is null or pg_catalog.length(normalized_reason) = 0
  then
    raise exception 'Invalid Inventory adjustment' using errcode = 'MIA01';
  end if;
  if normalized_adjustment_type in ('add', 'remove') and p_quantity <= 0 then
    raise exception 'Add and Remove quantity must be greater than zero' using errcode = 'MIA01';
  end if;
  if normalized_adjustment_type = 'correction' and p_quantity < 0 then
    raise exception 'Correction target cannot be negative' using errcode = 'MIA01';
  end if;

  select product.* into current_product from public.products as product
  where product.id = p_product_id for update;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
  if not current_product.is_active then
    raise exception 'Product is unavailable for Inventory adjustment' using errcode = 'PRD01';
  end if;
  perform 1
  from public.user_profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.is_active
    and profile.is_admin
  for share;
  if not found then raise exception 'Access denied' using errcode = '42501'; end if;

  select balance.quantity into current_quantity
  from public.inventory_balances as balance
  where balance.product_id = p_product_id
  for update;
  if not found then raise exception 'Inventory balance not found' using errcode = 'IVB01'; end if;

  quantity_delta := case normalized_adjustment_type
    when 'add' then p_quantity
    when 'remove' then -p_quantity
    else p_quantity - current_quantity
  end;
  if quantity_delta = 0 then
    raise exception 'Correction target already equals current stock' using errcode = 'MIA02';
  end if;
  if quantity_delta > 0 and p_product_supplier_id is null then
    raise exception 'ProductSupplier source is required for inbound stock' using errcode = 'IVL03';
  end if;
  if quantity_delta < 0 and p_product_supplier_id is not null then
    raise exception 'Outbound stock source is allocated automatically' using errcode = 'IVL03';
  end if;

  select * into applied from public.apply_inventory_delta(
    p_product_id => p_product_id,
    p_quantity_delta => quantity_delta,
    p_movement_type => 'manual_' || normalized_adjustment_type,
    p_reason => normalized_reason,
    p_source_type => 'manual_adjustment',
    p_source_id => null,
    p_project_id => null,
    p_reversal_of_movement_id => null,
    p_product_supplier_id => p_product_supplier_id,
    p_inventory_source_kind => case when quantity_delta > 0 then 'supplier' else null end
  );

  perform public.append_audit_log(
    p_action_type => 'inventory.manual_adjusted',
    p_entity_type => 'product_inventory',
    p_summary => 'Manual Inventory ' || normalized_adjustment_type ||
      ' for Product ' || current_product.serial_number,
    p_entity_id => current_product.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'product_id', current_product.id, 'quantity', applied.quantity_before
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'product_id', current_product.id,
      'adjustment_type', normalized_adjustment_type,
      'entered_quantity', p_quantity,
      'movement_type', 'manual_' || normalized_adjustment_type,
      'movement_id', applied.movement_id,
      'quantity_before', applied.quantity_before,
      'quantity_delta', quantity_delta,
      'quantity_after', applied.quantity_after,
      'reason', normalized_reason,
      'product_supplier_id', p_product_supplier_id
    )
  );
  return query select applied.movement_id, applied.quantity_before, applied.quantity_after;
end;
$function$;

revoke all privileges on function public.manual_adjust_inventory(uuid, text, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.manual_adjust_inventory(uuid, text, bigint, text, uuid)
  to authenticated;
