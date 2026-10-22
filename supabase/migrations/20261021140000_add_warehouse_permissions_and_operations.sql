-- Independently authorized warehouse reads, adjustments, and transfers.
-- Existing Product-only Inventory and production operations remain bound to
-- Raw Materials by migration 136.

insert into public.permission_definitions (
  key, module, label, description, is_delegable
) values
  (
    'inventory.raw_materials.view', 'inventory',
    'View Raw Materials Warehouse',
    'View Raw Materials stock and history.', true
  ),
  (
    'inventory.raw_materials.adjust', 'inventory',
    'Adjust Raw Materials Warehouse',
    'Add, remove, correct, and transfer Raw Materials stock.', true
  ),
  (
    'inventory.finished_goods.view', 'inventory',
    'View Finished Goods Warehouse',
    'View Finished Goods stock and history.', true
  ),
  (
    'inventory.finished_goods.adjust', 'inventory',
    'Adjust Finished Goods Warehouse',
    'Add, remove, correct, and transfer Finished Goods stock.', true
  ),
  (
    'inventory.customs.view', 'inventory',
    'View Customs Warehouse',
    'View Customs Warehouse stock and history.', true
  ),
  (
    'inventory.customs.adjust', 'inventory',
    'Adjust Customs Warehouse',
    'Add, remove, correct, and transfer Customs Warehouse stock.', true
  );

-- Preserve legacy Raw Materials access for every non-Admin profile that held
-- inventory.view when this migration was applied. Reuse the original grantor
-- as migration provenance without fabricating an acting user or audit event.
insert into public.user_permissions (
  user_id, permission_definition_id, granted_at, granted_by_user_id
)
select
  profile.id,
  raw_view_definition.id,
  pg_catalog.clock_timestamp(),
  legacy_grant.granted_by_user_id
from public.user_profiles as profile
join public.user_permissions as legacy_grant
  on legacy_grant.user_id = profile.id
join public.permission_definitions as legacy_definition
  on legacy_definition.id = legacy_grant.permission_definition_id
  and legacy_definition.key = 'inventory.view'
cross join public.permission_definitions as raw_view_definition
where not profile.is_admin
  and raw_view_definition.key = 'inventory.raw_materials.view'
on conflict (user_id, permission_definition_id) do nothing;

create or replace function public.get_user_permissions_admin(p_user_id uuid)
returns table (
  permission_key text,
  module text,
  label text,
  description text,
  granted boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'User is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.user_profiles where id = p_user_id
  ) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  return query
  select
    definition.key,
    definition.module,
    definition.label,
    definition.description,
    exists (
      select 1
      from public.user_permissions as user_permission
      where user_permission.user_id = p_user_id
        and user_permission.permission_definition_id = definition.id
    )
  from public.permission_definitions as definition
  where definition.is_delegable
  order by
    case definition.module
      when 'dashboard' then 1
      when 'projects' then 2
      when 'procurement' then 3
      when 'suppliers' then 4
      when 'inventory' then 5
      when 'pcb' then 6
      when 'work_orders' then 7
      when 'archive' then 8
      else 9
    end,
    case definition.key
      when 'dashboard.view' then 1
      when 'projects.view' then 2
      when 'projects.create' then 3
      when 'projects.edit' then 4
      when 'projects.archive' then 5
      when 'projects.alerts.receive' then 6
      when 'projects.alerts.send' then 7
      when 'procurement.view' then 8
      when 'procurement.create' then 9
      when 'procurement.edit' then 10
      when 'procurement.change_status' then 11
      when 'procurement.resolve' then 12
      when 'suppliers.view' then 13
      when 'suppliers.create' then 14
      when 'suppliers.edit' then 15
      when 'suppliers.archive' then 16
      when 'inventory.view' then 17
      when 'inventory.raw_materials.view' then 18
      when 'inventory.raw_materials.adjust' then 19
      when 'inventory.finished_goods.view' then 20
      when 'inventory.finished_goods.adjust' then 21
      when 'inventory.customs.view' then 22
      when 'inventory.customs.adjust' then 23
      when 'inventory.products.create' then 24
      when 'inventory.products.edit' then 25
      when 'inventory.brands.manage' then 26
      when 'inventory.barcodes.generate' then 27
      when 'pcb.view' then 28
      when 'pcb.create' then 29
      when 'pcb.edit' then 30
      when 'pcb.produce' then 31
      when 'pcb.archive' then 32
      when 'work_orders.view' then 33
      when 'work_orders.create' then 34
      when 'work_orders.edit_draft' then 35
      when 'work_orders.finish' then 36
      when 'work_orders.delete_draft' then 37
      when 'archive.view' then 38
      else 39
    end,
    definition.key;
end;
$function$;

create function public.inventory_warehouse_permission_key(
  p_warehouse_id uuid,
  p_capability text
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  normalized_capability text := pg_catalog.lower(pg_catalog.btrim(p_capability));
begin
  if p_warehouse_id is null
    or normalized_capability not in ('view', 'adjust')
  then
    raise exception 'Valid warehouse and capability are required'
      using errcode = '22023';
  end if;

  if p_warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid then
    return 'inventory.raw_materials.' || normalized_capability;
  elsif p_warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid then
    return 'inventory.finished_goods.' || normalized_capability;
  elsif p_warehouse_id = '10000000-0000-4000-8000-000000000003'::uuid then
    return 'inventory.customs.' || normalized_capability;
  end if;
  raise exception 'Warehouse not found' using errcode = 'P0002';
end;
$function$;

revoke all privileges on function
  public.inventory_warehouse_permission_key(uuid, text)
  from public, anon, authenticated, service_role;

create function public.search_inventory_products_by_warehouse(
  p_warehouse_id uuid,
  p_search text default null
)
returns table (
  id uuid,
  warehouse_id uuid,
  serial_number text,
  name text,
  category text,
  brand_name text,
  product_kind text,
  is_active boolean,
  quantity bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  required_permission text;
  normalized_search text := nullif(pg_catalog.btrim(p_search), '');
  escaped_search text;
  contains_pattern text;
  prefix_pattern text;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  required_permission := public.inventory_warehouse_permission_key(
    p_warehouse_id, 'view'
  );
  if not (
    public.current_user_is_admin()
    or public.has_permission(required_permission)
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if normalized_search is not null then
    escaped_search := pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          normalized_search,
          pg_catalog.chr(92),
          pg_catalog.chr(92) || pg_catalog.chr(92)
        ),
        '%', pg_catalog.chr(92) || '%'
      ),
      '_', pg_catalog.chr(92) || '_'
    );
    contains_pattern := '%' || pg_catalog.lower(escaped_search) || '%';
    prefix_pattern := escaped_search || '%';
  end if;

  return query
  select
    product.id,
    balance.warehouse_id,
    product.serial_number,
    product.name,
    product.category,
    brand.name,
    product.product_kind,
    product.is_active,
    balance.quantity
  from public.products as product
  join public.inventory_balances as balance
    on balance.product_id = product.id
    and balance.warehouse_id = p_warehouse_id
  left join public.brands as brand on brand.id = product.brand_id
  where normalized_search is null
    or pg_catalog.lower(product.name) like contains_pattern escape '\'
    or pg_catalog.lower(product.category) like contains_pattern escape '\'
    or product.serial_number like prefix_pattern escape '\'
    or exists (
      select 1
      from public.product_suppliers as relationship
      where relationship.product_id = product.id
        and relationship.catalog_number is not null
        and pg_catalog.lower(relationship.catalog_number)
          like contains_pattern escape '\'
    )
  order by product.serial_number, product.id;
end;
$function$;

create function public.get_inventory_product_by_warehouse(
  p_product_id uuid,
  p_warehouse_id uuid
)
returns table (
  product_id uuid,
  warehouse_id uuid,
  warehouse_code text,
  serial_number text,
  name text,
  category text,
  brand_id uuid,
  brand_name text,
  brand_is_active boolean,
  product_kind text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  quantity bigint,
  balance_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  required_permission text;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_id is null then
    raise exception 'Product is required' using errcode = '22023';
  end if;
  required_permission := public.inventory_warehouse_permission_key(
    p_warehouse_id, 'view'
  );
  if not (
    public.current_user_is_admin()
    or public.has_permission(required_permission)
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  return query
  select
    product.id,
    balance.warehouse_id,
    warehouse.code,
    product.serial_number,
    product.name,
    product.category,
    product.brand_id,
    brand.name,
    brand.is_active,
    product.product_kind,
    product.is_active,
    product.created_at,
    product.updated_at,
    product.archived_at,
    balance.quantity,
    balance.updated_at
  from public.products as product
  join public.inventory_balances as balance
    on balance.product_id = product.id
    and balance.warehouse_id = p_warehouse_id
  join public.inventory_warehouses as warehouse
    on warehouse.id = balance.warehouse_id
  left join public.brands as brand on brand.id = product.brand_id
  where product.id = p_product_id;
end;
$function$;

create function public.list_active_inventory_source_choices_by_warehouse(
  p_product_id uuid,
  p_warehouse_id uuid
)
returns table (
  product_supplier_id uuid,
  supplier_id uuid,
  supplier_name text,
  catalog_number text,
  description text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  product_is_active boolean;
  required_permission text;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_id is null then
    raise exception 'Product is required' using errcode = '22023';
  end if;
  required_permission := public.inventory_warehouse_permission_key(
    p_warehouse_id, 'adjust'
  );
  if not (
    public.current_user_is_admin()
    or public.has_permission(required_permission)
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select product.is_active into product_is_active
  from public.products as product
  where product.id = p_product_id;
  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  if not product_is_active then
    raise exception 'Product is unavailable for Inventory adjustment'
      using errcode = 'PRD01';
  end if;

  return query
  select
    relationship.id,
    supplier.id,
    supplier.name,
    supplier.catalog_number,
    supplier.description
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

create function public.get_inventory_stock_availability_by_warehouse(
  p_product_id uuid,
  p_warehouse_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  required_permission text;
  available_quantity bigint;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_id is null then
    raise exception 'Product is required' using errcode = '22023';
  end if;
  required_permission := public.inventory_warehouse_permission_key(
    p_warehouse_id, 'view'
  );
  if not (
    public.current_user_is_admin()
    or public.has_permission(required_permission)
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select balance.quantity into available_quantity
  from public.inventory_balances as balance
  where balance.product_id = p_product_id
    and balance.warehouse_id = p_warehouse_id;
  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  return available_quantity;
end;
$function$;

create function public.get_inventory_movements_for_product_by_warehouse(
  p_product_id uuid,
  p_warehouse_id uuid
)
returns table (
  movement_id uuid,
  warehouse_id uuid,
  created_at timestamptz,
  movement_type text,
  quantity_delta bigint,
  quantity_before bigint,
  quantity_after bigint,
  reason text,
  source_type text,
  source_id uuid,
  project_id uuid,
  reversal_of_movement_id uuid,
  actor_user_id uuid,
  actor_full_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  required_permission text;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_id is null then
    raise exception 'Product is required' using errcode = '22023';
  end if;
  required_permission := public.inventory_warehouse_permission_key(
    p_warehouse_id, 'view'
  );
  if not (
    public.current_user_is_admin()
    or public.has_permission(required_permission)
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  return query
  select
    movement.id,
    movement.warehouse_id,
    movement.created_at,
    movement.movement_type,
    movement.quantity_delta,
    movement.quantity_before,
    movement.quantity_after,
    movement.reason,
    movement.source_type,
    movement.source_id,
    movement.project_id,
    movement.reversal_of_movement_id,
    movement.actor_user_id,
    actor.full_name
  from public.inventory_movements as movement
  join public.user_profiles as actor on actor.id = movement.actor_user_id
  where movement.product_id = p_product_id
    and movement.warehouse_id = p_warehouse_id
  order by movement.created_at desc, movement.id desc;
end;
$function$;

create function public.list_inventory_source_lots_by_warehouse(
  p_product_id uuid,
  p_warehouse_id uuid
)
returns table (
  source_lot_id uuid,
  warehouse_id uuid,
  source_kind text,
  received_at timestamptz,
  supplier_name text,
  catalog_number text,
  description text,
  received_quantity text,
  remaining_quantity text,
  added_by_full_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  required_permission text;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_id is null then
    raise exception 'Product is required' using errcode = '22023';
  end if;
  required_permission := public.inventory_warehouse_permission_key(
    p_warehouse_id, 'view'
  );
  if not (
    public.current_user_is_admin()
    or public.has_permission(required_permission)
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  return query
  select
    lot.id,
    lot.warehouse_id,
    lot.source_kind,
    lot.received_at,
    case lot.source_kind
      when 'supplier' then lot.supplier_name_snapshot
      when 'legacy_unknown' then 'Legacy / Unknown'
      when 'warehouse_transfer' then 'Warehouse Transfer'
      else 'Internal Production'
    end,
    lot.catalog_number_snapshot,
    lot.supplier_description_snapshot,
    lot.received_quantity::text,
    lot.remaining_quantity::text,
    actor.full_name
  from public.inventory_source_lots as lot
  left join public.user_profiles as actor on actor.id = lot.actor_user_id
  where lot.product_id = p_product_id
    and lot.warehouse_id = p_warehouse_id
  order by lot.received_at desc, lot.id desc;
end;
$function$;

alter table public.inventory_source_lots
  drop constraint inventory_source_lots_source_kind_valid,
  drop constraint inventory_source_lots_source_context_valid,
  add constraint inventory_source_lots_source_kind_valid
    check (source_kind in (
      'supplier', 'legacy_unknown', 'internal_production', 'warehouse_transfer'
    )),
  add constraint inventory_source_lots_source_context_valid
    check (
      (
        source_kind = 'supplier'
        and product_supplier_id is not null
        and supplier_id is not null
        and supplier_name_snapshot is not null
        and catalog_number_snapshot is not null
        and originating_inventory_movement_id is not null
        and actor_user_id is not null
      )
      or (
        source_kind = 'legacy_unknown'
        and product_supplier_id is null
        and supplier_id is null
        and supplier_name_snapshot is null
        and catalog_number_snapshot is null
        and supplier_description_snapshot is null
        and originating_inventory_movement_id is null
        and actor_user_id is null
      )
      or (
        source_kind in ('internal_production', 'warehouse_transfer')
        and product_supplier_id is null
        and supplier_id is null
        and supplier_name_snapshot is null
        and catalog_number_snapshot is null
        and supplier_description_snapshot is null
        and originating_inventory_movement_id is not null
        and actor_user_id is not null
      )
    );

create or replace function public.list_inventory_source_lots(p_product_id uuid)
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
language plpgsql
stable
security definer
set search_path = ''
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
  select
    lot.id,
    lot.source_kind,
    lot.received_at,
    case lot.source_kind
      when 'supplier' then lot.supplier_name_snapshot
      when 'legacy_unknown' then 'Legacy / Unknown'
      when 'warehouse_transfer' then 'Warehouse Transfer'
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
    and lot.warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
  order by lot.received_at desc, lot.id desc;
end;
$function$;

create function public.consume_inventory_source_lots_in_warehouse(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_quantity bigint,
  p_outbound_inventory_movement_id uuid
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  lot_record record;
  movement_product_id uuid;
  movement_warehouse_id uuid;
  remaining_to_allocate bigint;
  taken_quantity bigint;
begin
  if p_product_id is null or p_warehouse_id is null
    or p_quantity is null or p_quantity <= 0
    or p_outbound_inventory_movement_id is null
  then
    raise exception 'Valid source allocation input is required'
      using errcode = '22023';
  end if;

  select movement.product_id, movement.warehouse_id
  into movement_product_id, movement_warehouse_id
  from public.inventory_movements as movement
  where movement.id = p_outbound_inventory_movement_id
    and movement.quantity_delta < 0;
  if not found or movement_product_id <> p_product_id
    or movement_warehouse_id <> p_warehouse_id
  then
    raise exception 'Outbound Inventory movement does not match warehouse Product'
      using errcode = 'IVL03';
  end if;

  remaining_to_allocate := p_quantity;
  for lot_record in
    select lot.id, lot.remaining_quantity
    from public.inventory_source_lots as lot
    where lot.product_id = p_product_id
      and lot.warehouse_id = p_warehouse_id
      and lot.remaining_quantity > 0
    order by lot.received_at, lot.id
    for update
  loop
    exit when remaining_to_allocate = 0;
    taken_quantity := least(lot_record.remaining_quantity, remaining_to_allocate);
    update public.inventory_source_lots as lot
    set remaining_quantity = lot.remaining_quantity - taken_quantity
    where lot.id = lot_record.id;
    insert into public.inventory_source_allocations (
      outbound_inventory_movement_id, source_lot_id, product_id,
      warehouse_id, allocated_quantity
    ) values (
      p_outbound_inventory_movement_id, lot_record.id, p_product_id,
      p_warehouse_id, taken_quantity
    );
    remaining_to_allocate := remaining_to_allocate - taken_quantity;
  end loop;

  if remaining_to_allocate <> 0 then
    raise exception 'Inventory source lots are insufficient' using errcode = 'IVB02';
  end if;
end;
$function$;

revoke all privileges on function
  public.consume_inventory_source_lots_in_warehouse(uuid, uuid, bigint, uuid)
  from public, anon, authenticated, service_role;

create function public.apply_inventory_delta_in_warehouse(
  p_product_id uuid,
  p_warehouse_id uuid,
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
returns table (
  movement_id uuid,
  quantity_before bigint,
  quantity_after bigint
)
language plpgsql
volatile
security invoker
set search_path = ''
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
  if p_product_id is null or p_warehouse_id is null
    or p_quantity_delta is null or p_quantity_delta = 0
  then
    raise exception 'Product, warehouse, and nonzero quantity delta are required'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.inventory_warehouses where id = p_warehouse_id
  ) then
    raise exception 'Warehouse not found' using errcode = 'P0002';
  end if;
  normalized_movement_type := pg_catalog.btrim(p_movement_type);
  if normalized_movement_type is null
    or pg_catalog.length(normalized_movement_type) = 0
  then
    raise exception 'Movement type is required' using errcode = '22023';
  end if;
  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  normalized_source_type := nullif(pg_catalog.btrim(p_source_type), '');
  effective_source_kind := p_inventory_source_kind;

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
    and balance.warehouse_id = p_warehouse_id
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
    elsif effective_source_kind = 'warehouse_transfer' then
      if p_product_supplier_id is not null
        or normalized_source_type <> 'warehouse_transfer'
        or p_source_id is null
      then
        raise exception 'Warehouse transfer source is invalid' using errcode = 'IVL03';
      end if;
    else
      raise exception 'Inventory source is required for inbound stock'
        using errcode = 'IVL03';
    end if;
  elsif p_product_supplier_id is not null or effective_source_kind is not null then
    raise exception 'Outbound stock source is allocated automatically'
      using errcode = 'IVL03';
  end if;

  changed_at := pg_catalog.clock_timestamp();
  update public.inventory_balances as balance
  set quantity = resulting_quantity, updated_at = changed_at
  where balance.product_id = p_product_id
    and balance.warehouse_id = p_warehouse_id;

  insert into public.inventory_movements (
    product_id, warehouse_id, movement_type, quantity_delta,
    quantity_before, quantity_after, reason, source_type, source_id,
    project_id, actor_user_id, created_at, reversal_of_movement_id
  ) values (
    p_product_id, p_warehouse_id, normalized_movement_type, p_quantity_delta,
    current_quantity, resulting_quantity, normalized_reason,
    normalized_source_type, p_source_id, p_project_id, actor_profile_id,
    changed_at, p_reversal_of_movement_id
  ) returning id into created_movement_id;

  if p_quantity_delta < 0 then
    perform public.consume_inventory_source_lots_in_warehouse(
      p_product_id, p_warehouse_id, -p_quantity_delta, created_movement_id
    );
  elsif effective_source_kind = 'supplier' then
    insert into public.inventory_source_lots (
      product_id, warehouse_id, source_kind, product_supplier_id,
      supplier_id, supplier_name_snapshot, catalog_number_snapshot,
      supplier_description_snapshot, received_quantity, remaining_quantity,
      originating_inventory_movement_id, received_at, actor_user_id
    ) values (
      p_product_id, p_warehouse_id, 'supplier', source_relationship.id,
      source_supplier.id, source_supplier.name,
      source_supplier.catalog_number, source_supplier.description,
      p_quantity_delta, p_quantity_delta, created_movement_id,
      changed_at, actor_profile_id
    );
  else
    insert into public.inventory_source_lots (
      product_id, warehouse_id, source_kind, received_quantity,
      remaining_quantity, originating_inventory_movement_id,
      received_at, actor_user_id
    ) values (
      p_product_id, p_warehouse_id, 'warehouse_transfer', p_quantity_delta,
      p_quantity_delta, created_movement_id, changed_at, actor_profile_id
    );
  end if;

  return query select created_movement_id, current_quantity, resulting_quantity;
end;
$function$;

revoke all privileges on function
  public.apply_inventory_delta_in_warehouse(
    uuid, uuid, bigint, text, text, text, uuid, uuid, uuid, uuid, text
  ) from public, anon, authenticated, service_role;

create function public.adjust_inventory_warehouse(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_adjustment_type text,
  p_quantity bigint,
  p_reason text,
  p_product_supplier_id uuid default null
)
returns table (
  movement_id uuid,
  warehouse_id uuid,
  quantity_before bigint,
  quantity_after bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  actor_is_admin boolean;
  applied record;
  current_product public.products%rowtype;
  current_quantity bigint;
  normalized_adjustment_type text;
  normalized_reason text;
  quantity_delta bigint;
  required_permission text;
  warehouse_code text;
begin
  if auth.uid() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_id is null or p_quantity is null then
    raise exception 'Product and quantity are required' using errcode = 'MIA01';
  end if;
  required_permission := public.inventory_warehouse_permission_key(
    p_warehouse_id, 'adjust'
  );
  normalized_adjustment_type := pg_catalog.lower(pg_catalog.btrim(p_adjustment_type));
  normalized_reason := pg_catalog.btrim(p_reason);
  if normalized_adjustment_type is null
    or normalized_adjustment_type not in ('add', 'remove', 'correction')
    or normalized_reason is null or pg_catalog.length(normalized_reason) = 0
  then
    raise exception 'Invalid Inventory adjustment' using errcode = 'MIA01';
  end if;
  if normalized_adjustment_type in ('add', 'remove') and p_quantity <= 0 then
    raise exception 'Add and Remove quantity must be greater than zero'
      using errcode = 'MIA01';
  end if;
  if normalized_adjustment_type = 'correction' and p_quantity < 0 then
    raise exception 'Correction target cannot be negative' using errcode = 'MIA01';
  end if;

  select product.* into current_product
  from public.products as product
  where product.id = p_product_id
  for update;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
  if not current_product.is_active then
    raise exception 'Product is unavailable for Inventory adjustment'
      using errcode = 'PRD01';
  end if;

  select balance.quantity into current_quantity
  from public.inventory_balances as balance
  where balance.product_id = p_product_id
    and balance.warehouse_id = p_warehouse_id
  for update;
  if not found then
    raise exception 'Inventory balance not found' using errcode = 'IVB01';
  end if;

  actor_profile_id := public.current_active_user_profile_id();
  select profile.is_admin into actor_is_admin
  from public.user_profiles as profile
  where profile.id = actor_profile_id
    and profile.auth_user_id = auth.uid()
    and profile.is_active
  for share;
  if not found then raise exception 'Access denied' using errcode = '42501'; end if;
  if not actor_is_admin then
    perform user_permission.user_id
    from public.user_permissions as user_permission
    join public.permission_definitions as definition
      on definition.id = user_permission.permission_definition_id
    where user_permission.user_id = actor_profile_id
      and definition.key = required_permission
    for share of user_permission, definition;
    if not found then raise exception 'Access denied' using errcode = '42501'; end if;
  end if;

  quantity_delta := case normalized_adjustment_type
    when 'add' then p_quantity
    when 'remove' then -p_quantity
    else p_quantity - current_quantity
  end;
  if quantity_delta = 0 then
    raise exception 'Correction target already equals current stock'
      using errcode = 'MIA02';
  end if;
  if quantity_delta > 0 and p_product_supplier_id is null then
    raise exception 'ProductSupplier source is required for inbound stock'
      using errcode = 'IVL03';
  end if;
  if quantity_delta < 0 and p_product_supplier_id is not null then
    raise exception 'Outbound stock source is allocated automatically'
      using errcode = 'IVL03';
  end if;

  select * into applied
  from public.apply_inventory_delta_in_warehouse(
    p_product_id, p_warehouse_id, quantity_delta,
    'manual_' || normalized_adjustment_type, normalized_reason,
    'manual_adjustment', null, null, null, p_product_supplier_id,
    case when quantity_delta > 0 then 'supplier' else null end
  );
  select code into warehouse_code
  from public.inventory_warehouses where id = p_warehouse_id;

  perform public.append_audit_log(
    p_action_type => 'inventory.warehouse_adjusted',
    p_entity_type => 'product_inventory',
    p_summary => 'Inventory ' || normalized_adjustment_type || ' for Product '
      || current_product.serial_number || ' in ' || warehouse_code,
    p_entity_id => current_product.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'product_id', current_product.id,
      'warehouse_id', p_warehouse_id,
      'quantity', applied.quantity_before
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'product_id', current_product.id,
      'warehouse_id', p_warehouse_id,
      'adjustment_type', normalized_adjustment_type,
      'entered_quantity', p_quantity,
      'movement_id', applied.movement_id,
      'quantity_before', applied.quantity_before,
      'quantity_delta', quantity_delta,
      'quantity_after', applied.quantity_after,
      'reason', normalized_reason,
      'product_supplier_id', p_product_supplier_id
    )
  );

  return query select
    applied.movement_id, p_warehouse_id,
    applied.quantity_before, applied.quantity_after;
end;
$function$;

create table public.inventory_warehouse_transfers (
  id uuid primary key,
  product_id uuid not null,
  source_warehouse_id uuid not null,
  destination_warehouse_id uuid not null,
  quantity bigint not null,
  reason text not null,
  outbound_movement_id uuid not null unique,
  inbound_movement_id uuid not null unique,
  actor_user_id uuid not null,
  created_at timestamptz not null,
  constraint inventory_warehouse_transfers_product_id_fkey
    foreign key (product_id) references public.products(id) on delete restrict,
  constraint inventory_warehouse_transfers_source_warehouse_id_fkey
    foreign key (source_warehouse_id)
    references public.inventory_warehouses(id) on delete restrict,
  constraint inventory_warehouse_transfers_destination_warehouse_id_fkey
    foreign key (destination_warehouse_id)
    references public.inventory_warehouses(id) on delete restrict,
  constraint inventory_warehouse_transfers_actor_user_id_fkey
    foreign key (actor_user_id)
    references public.user_profiles(id) on delete restrict,
  constraint inventory_warehouse_transfers_outbound_context_fkey
    foreign key (outbound_movement_id, product_id, source_warehouse_id)
    references public.inventory_movements(id, product_id, warehouse_id)
    on delete restrict,
  constraint inventory_warehouse_transfers_inbound_context_fkey
    foreign key (inbound_movement_id, product_id, destination_warehouse_id)
    references public.inventory_movements(id, product_id, warehouse_id)
    on delete restrict,
  constraint inventory_warehouse_transfers_quantity_positive check (quantity > 0),
  constraint inventory_warehouse_transfers_warehouses_distinct
    check (source_warehouse_id <> destination_warehouse_id),
  constraint inventory_warehouse_transfers_reason_normalized
    check (reason = pg_catalog.btrim(reason) and pg_catalog.length(reason) > 0)
);

create index inventory_warehouse_transfers_product_created_idx
  on public.inventory_warehouse_transfers (product_id, created_at desc, id desc);

create function public.prevent_inventory_warehouse_transfer_mutation()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  raise exception 'Inventory warehouse transfers are immutable'
    using errcode = '55000';
  return old;
end;
$function$;

revoke all privileges on function
  public.prevent_inventory_warehouse_transfer_mutation()
  from public, anon, authenticated, service_role;

create trigger inventory_warehouse_transfers_reject_update_delete
before update or delete on public.inventory_warehouse_transfers
for each row execute function
  public.prevent_inventory_warehouse_transfer_mutation();

alter table public.inventory_warehouse_transfers enable row level security;
revoke all privileges on table public.inventory_warehouse_transfers
  from public, anon, authenticated;

create function public.transfer_inventory_between_warehouses(
  p_product_id uuid,
  p_source_warehouse_id uuid,
  p_destination_warehouse_id uuid,
  p_quantity bigint,
  p_reason text
)
returns table (
  transfer_id uuid,
  outbound_movement_id uuid,
  inbound_movement_id uuid,
  source_quantity_after bigint,
  destination_quantity_after bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  actor_is_admin boolean;
  current_product public.products%rowtype;
  destination_applied record;
  destination_before bigint;
  destination_permission text;
  generated_transfer_id uuid := gen_random_uuid();
  normalized_reason text := pg_catalog.btrim(p_reason);
  outbound_applied record;
  source_before bigint;
  source_permission text;
  source_warehouse_code text;
  destination_warehouse_code text;
begin
  if auth.uid() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_id is null or p_quantity is null or p_quantity <= 0
    or normalized_reason is null or pg_catalog.length(normalized_reason) = 0
  then
    raise exception 'Product, positive quantity, and reason are required'
      using errcode = '22023';
  end if;
  if p_source_warehouse_id is null or p_destination_warehouse_id is null
    or p_source_warehouse_id = p_destination_warehouse_id
  then
    raise exception 'Distinct source and destination warehouses are required'
      using errcode = '22023';
  end if;
  source_permission := public.inventory_warehouse_permission_key(
    p_source_warehouse_id, 'adjust'
  );
  destination_permission := public.inventory_warehouse_permission_key(
    p_destination_warehouse_id, 'adjust'
  );

  -- Canonical mutation lock order: Product, balances by warehouse UUID, then
  -- source lots by warehouse/received_at/id inside the allocation helper.
  select product.* into current_product
  from public.products as product
  where product.id = p_product_id
  for update;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
  if not current_product.is_active then
    raise exception 'Product is unavailable for Inventory transfer'
      using errcode = 'PRD01';
  end if;

  perform balance.product_id
  from public.inventory_balances as balance
  where balance.product_id = p_product_id
    and balance.warehouse_id in (
      p_source_warehouse_id, p_destination_warehouse_id
    )
  order by balance.warehouse_id
  for update;
  if not found or (
    select count(*) from public.inventory_balances as balance
    where balance.product_id = p_product_id
      and balance.warehouse_id in (
        p_source_warehouse_id, p_destination_warehouse_id
      )
  ) <> 2 then
    raise exception 'Inventory balance not found' using errcode = 'IVB01';
  end if;

  select profile.is_admin into actor_is_admin
  from public.user_profiles as profile
  where profile.auth_user_id = auth.uid() and profile.is_active
  for share;
  if not found then raise exception 'Access denied' using errcode = '42501'; end if;
  actor_profile_id := public.current_active_user_profile_id();
  if not actor_is_admin then
    perform user_permission.user_id
    from public.user_permissions as user_permission
    join public.permission_definitions as definition
      on definition.id = user_permission.permission_definition_id
    where user_permission.user_id = actor_profile_id
      and definition.key in (source_permission, destination_permission)
    order by definition.key
    for share of user_permission, definition;
    if (
      select count(*)
      from public.user_permissions as user_permission
      join public.permission_definitions as definition
        on definition.id = user_permission.permission_definition_id
      where user_permission.user_id = actor_profile_id
        and definition.key in (source_permission, destination_permission)
    ) <> 2 then
      raise exception 'Access denied' using errcode = '42501';
    end if;
  end if;

  select quantity into source_before
  from public.inventory_balances
  where product_id = p_product_id and warehouse_id = p_source_warehouse_id;
  select quantity into destination_before
  from public.inventory_balances
  where product_id = p_product_id and warehouse_id = p_destination_warehouse_id;
  if source_before < p_quantity then
    raise exception 'Inventory quantity cannot be negative' using errcode = 'IVB02';
  end if;

  select * into outbound_applied
  from public.apply_inventory_delta_in_warehouse(
    p_product_id, p_source_warehouse_id, -p_quantity,
    'warehouse_transfer_out', normalized_reason, 'warehouse_transfer',
    generated_transfer_id, null, null, null, null
  );
  select * into destination_applied
  from public.apply_inventory_delta_in_warehouse(
    p_product_id, p_destination_warehouse_id, p_quantity,
    'warehouse_transfer_in', normalized_reason, 'warehouse_transfer',
    generated_transfer_id, null, null, null, 'warehouse_transfer'
  );

  insert into public.inventory_warehouse_transfers (
    id, product_id, source_warehouse_id, destination_warehouse_id,
    quantity, reason, outbound_movement_id, inbound_movement_id,
    actor_user_id, created_at
  ) values (
    generated_transfer_id, p_product_id, p_source_warehouse_id,
    p_destination_warehouse_id, p_quantity, normalized_reason,
    outbound_applied.movement_id, destination_applied.movement_id,
    actor_profile_id, pg_catalog.clock_timestamp()
  );

  select code into source_warehouse_code
  from public.inventory_warehouses where id = p_source_warehouse_id;
  select code into destination_warehouse_code
  from public.inventory_warehouses where id = p_destination_warehouse_id;
  perform public.append_audit_log(
    p_action_type => 'inventory.warehouse_transferred',
    p_entity_type => 'product_inventory',
    p_summary => 'Transferred Product ' || current_product.serial_number
      || ' from ' || source_warehouse_code || ' to '
      || destination_warehouse_code,
    p_entity_id => current_product.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'product_id', p_product_id,
      'source_warehouse_id', p_source_warehouse_id,
      'source_quantity', source_before,
      'destination_warehouse_id', p_destination_warehouse_id,
      'destination_quantity', destination_before
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'transfer_id', generated_transfer_id,
      'product_id', p_product_id,
      'quantity', p_quantity,
      'reason', normalized_reason,
      'source_warehouse_id', p_source_warehouse_id,
      'source_quantity', outbound_applied.quantity_after,
      'destination_warehouse_id', p_destination_warehouse_id,
      'destination_quantity', destination_applied.quantity_after,
      'outbound_movement_id', outbound_applied.movement_id,
      'inbound_movement_id', destination_applied.movement_id
    )
  );

  return query select
    generated_transfer_id,
    outbound_applied.movement_id,
    destination_applied.movement_id,
    outbound_applied.quantity_after,
    destination_applied.quantity_after;
end;
$function$;

revoke all privileges on function
  public.search_inventory_products_by_warehouse(uuid, text),
  public.get_inventory_product_by_warehouse(uuid, uuid),
  public.list_active_inventory_source_choices_by_warehouse(uuid, uuid),
  public.get_inventory_stock_availability_by_warehouse(uuid, uuid),
  public.get_inventory_movements_for_product_by_warehouse(uuid, uuid),
  public.list_inventory_source_lots_by_warehouse(uuid, uuid),
  public.adjust_inventory_warehouse(uuid, uuid, text, bigint, text, uuid),
  public.transfer_inventory_between_warehouses(uuid, uuid, uuid, bigint, text)
  from public, anon, authenticated;

grant execute on function
  public.search_inventory_products_by_warehouse(uuid, text),
  public.get_inventory_product_by_warehouse(uuid, uuid),
  public.list_active_inventory_source_choices_by_warehouse(uuid, uuid),
  public.get_inventory_stock_availability_by_warehouse(uuid, uuid),
  public.get_inventory_movements_for_product_by_warehouse(uuid, uuid),
  public.list_inventory_source_lots_by_warehouse(uuid, uuid),
  public.adjust_inventory_warehouse(uuid, uuid, text, bigint, text, uuid),
  public.transfer_inventory_between_warehouses(uuid, uuid, uuid, bigint, text)
  to authenticated;

comment on table public.inventory_warehouse_transfers is
  'Immutable atomic transfer history. Source provenance remains reachable through the outbound movement allocations; destination stock is represented by a warehouse_transfer source lot.';
