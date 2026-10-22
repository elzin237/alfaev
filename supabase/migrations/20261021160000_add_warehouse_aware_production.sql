-- Warehouse-aware Work Order and PCB production. Production consumes in the
-- reviewed Raw Materials -> Customs -> Finished Goods order while Project
-- shortage calculations intentionally remain on their migration-138 baseline.

create function public.production_warehouse_priority(p_warehouse_id uuid)
returns smallint
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case p_warehouse_id
    when '10000000-0000-4000-8000-000000000001'::uuid then 1::smallint
    when '10000000-0000-4000-8000-000000000003'::uuid then 2::smallint
    when '10000000-0000-4000-8000-000000000002'::uuid then 3::smallint
    else null::smallint
  end;
$function$;

-- Extend the internal warehouse mutation primitive only for trusted PCB output.
-- Browser roles retain no EXECUTE privilege on this function.
create or replace function public.apply_inventory_delta_in_warehouse(
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
    elsif effective_source_kind = 'internal_production' then
      if p_product_supplier_id is not null
        or p_warehouse_id <> '10000000-0000-4000-8000-000000000002'::uuid
        or normalized_movement_type <> 'pcb_production_output'
        or normalized_source_type <> 'pcb_production_output'
        or p_source_id is null
      then
        raise exception 'Internal production source is invalid' using errcode = 'IVL03';
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
      p_product_id, p_warehouse_id, effective_source_kind,
      p_quantity_delta, p_quantity_delta, created_movement_id,
      changed_at, actor_profile_id
    );
  end if;

  return query select created_movement_id, current_quantity, resulting_quantity;
end;
$function$;

revoke all privileges on function
  public.apply_inventory_delta_in_warehouse(
    uuid, uuid, bigint, text, text, text, uuid, uuid, uuid, uuid, text
  ) from public, anon, authenticated, service_role;

-- Fail fast if migration-138 compatibility bodies no longer match the reviewed
-- definitions. These replacements preserve signatures, grants, and wrappers.
create function pg_temp.replace_production_function_text(
  p_signature text,
  p_old text,
  p_new text,
  p_expected_count integer
)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  function_oid oid;
  definition text;
  actual_count integer;
begin
  function_oid := pg_catalog.to_regprocedure(p_signature);
  if function_oid is null then
    raise exception 'Required production function is missing: %', p_signature;
  end if;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  actual_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, p_old, ''))
  ) / pg_catalog.length(p_old);
  if actual_count <> p_expected_count then
    raise exception 'Unexpected definition for %: expected % replacements, found %',
      p_signature, p_expected_count, actual_count;
  end if;
  execute pg_catalog.replace(definition, p_old, p_new);
end;
$function$;


revoke all privileges on function public.production_warehouse_priority(uuid)
  from public, anon, authenticated, service_role;

create function public.get_production_eligible_quantity(p_product_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $function$
  select coalesce(pg_catalog.sum(balance.quantity::numeric), 0::numeric)::bigint
  from public.inventory_balances as balance
  where balance.product_id = p_product_id
    and balance.warehouse_id in (
      '10000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000003'::uuid,
      '10000000-0000-4000-8000-000000000002'::uuid
    );
$function$;

revoke all privileges on function public.get_production_eligible_quantity(uuid)
  from public, anon, authenticated, service_role;

create function public.get_work_order_warehouse_source_allocation_plan(
  p_work_order_id uuid
)
returns table (
  product_id uuid,
  warehouse_id uuid,
  warehouse_code text,
  warehouse_name text,
  warehouse_priority smallint,
  source_lot_id uuid,
  source_kind text,
  supplier_name_snapshot text,
  catalog_number_snapshot text,
  supplier_description_snapshot text,
  allocated_quantity bigint,
  received_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  material record;
  planned_quantity numeric;
begin
  if p_work_order_id is null then
    raise exception 'Work Order ID is required' using errcode = '22023';
  end if;

  for material in
    select item.product_id,
      pg_catalog.sum(item.quantity::numeric)::bigint as quantity
    from public.work_order_items as item
    where item.work_order_id = p_work_order_id
    group by item.product_id
    order by item.product_id
  loop
    -- Product, warehouse priority, and FIFO order is shared by preflight,
    -- fingerprinting, and mutation. Every eligible lot is locked before use.
    perform 1
    from public.inventory_source_lots as lot
    where lot.product_id = material.product_id
      and lot.warehouse_id in (
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000003'::uuid,
        '10000000-0000-4000-8000-000000000002'::uuid
      )
      and lot.remaining_quantity > 0
    order by public.production_warehouse_priority(lot.warehouse_id),
      lot.received_at, lot.id
    for update;

    select coalesce(pg_catalog.sum(lot.remaining_quantity::numeric), 0::numeric)
    into planned_quantity
    from public.inventory_source_lots as lot
    where lot.product_id = material.product_id
      and lot.warehouse_id in (
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000003'::uuid,
        '10000000-0000-4000-8000-000000000002'::uuid
      )
      and lot.remaining_quantity > 0;

    if planned_quantity < material.quantity::numeric then
      raise exception 'Insufficient physical Inventory' using errcode = 'IVB02';
    end if;

    return query
    with fifo as (
      select lot.*,
        public.production_warehouse_priority(lot.warehouse_id) as priority,
        coalesce(
          pg_catalog.sum(lot.remaining_quantity::numeric) over (
            order by public.production_warehouse_priority(lot.warehouse_id),
              lot.received_at, lot.id
            rows between unbounded preceding and 1 preceding
          ),
          0::numeric
        ) as quantity_before_lot
      from public.inventory_source_lots as lot
      where lot.product_id = material.product_id
        and lot.warehouse_id in (
          '10000000-0000-4000-8000-000000000001'::uuid,
          '10000000-0000-4000-8000-000000000003'::uuid,
          '10000000-0000-4000-8000-000000000002'::uuid
        )
        and lot.remaining_quantity > 0
    )
    select fifo.product_id, fifo.warehouse_id, warehouse.code,
      warehouse.display_name, fifo.priority, fifo.id, fifo.source_kind,
      fifo.supplier_name_snapshot, fifo.catalog_number_snapshot,
      fifo.supplier_description_snapshot,
      least(
        fifo.remaining_quantity::numeric,
        material.quantity::numeric - fifo.quantity_before_lot
      )::bigint,
      fifo.received_at
    from fifo
    join public.inventory_warehouses as warehouse
      on warehouse.id = fifo.warehouse_id
    where fifo.quantity_before_lot < material.quantity::numeric
    order by fifo.priority, fifo.received_at, fifo.id;
  end loop;
end;
$function$;

revoke all privileges on function
  public.get_work_order_warehouse_source_allocation_plan(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.get_work_order_source_allocation_plan(
  p_work_order_id uuid
)
returns table (
  product_id uuid,
  source_lot_id uuid,
  source_kind text,
  supplier_name_snapshot text,
  catalog_number_snapshot text,
  supplier_description_snapshot text,
  allocated_quantity bigint,
  received_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  return query
  select plan.product_id, plan.source_lot_id, plan.source_kind,
    plan.supplier_name_snapshot, plan.catalog_number_snapshot,
    plan.supplier_description_snapshot, plan.allocated_quantity,
    plan.received_at
  from public.get_work_order_warehouse_source_allocation_plan(
    p_work_order_id
  ) as plan
  order by plan.product_id, plan.warehouse_priority,
    plan.received_at, plan.source_lot_id;
end;
$function$;

create or replace function public.get_work_order_source_allocation_fingerprint(
  p_work_order_id uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  fingerprint text;
begin
  select pg_catalog.md5(coalesce(pg_catalog.string_agg(
    plan.product_id::text || ':' || plan.warehouse_id::text || ':' ||
      plan.source_lot_id::text || ':' || plan.allocated_quantity::text,
    '|' order by plan.product_id, plan.warehouse_priority,
      plan.received_at, plan.source_lot_id
  ), ''))
  into fingerprint
  from public.get_work_order_warehouse_source_allocation_plan(
    p_work_order_id
  ) as plan;
  return fingerprint;
end;
$function$;

-- Production precheck exposes one combined quantity, never a warehouse
-- breakdown. Warehouse-specific data remains behind trusted production paths.
create or replace function public.get_pcb_production_precheck(p_pcb_card_id uuid)
returns table (
  card_id uuid, card_name text, output_product_id uuid,
  output_serial_number text, output_product_is_active boolean,
  active_bom_version_id uuid, active_bom_version_number text,
  input_product_id uuid, input_product_name text, input_serial_number text,
  input_product_is_active boolean, quantity_per_card text,
  available_quantity text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_version_id uuid;
  current_version_number bigint;
begin
  if auth.uid() is null or not (
    public.current_user_is_admin() or public.has_permission('pcb.produce')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_pcb_card_id is null then
    raise exception 'PCB Card ID is required' using errcode = '22023';
  end if;
  perform 1 from public.pcb_cards as card where card.id = p_pcb_card_id;
  if not found then raise exception 'PCB Card not found' using errcode = 'P0002'; end if;
  perform 1 from public.pcb_cards as card
    where card.id = p_pcb_card_id and card.is_active;
  if not found then raise exception 'PCB Card is archived' using errcode = 'PCB07'; end if;
  select version.id, version.version_number
  into current_version_id, current_version_number
  from public.pcb_bom_versions as version
  where version.pcb_card_id = p_pcb_card_id and version.is_active;
  if not found or exists (
    select 1 from public.pcb_bom_versions as version
    where version.pcb_card_id = p_pcb_card_id
      and version.version_number > current_version_number
  ) then
    raise exception 'Active PCB BOM is unavailable' using errcode = 'PCB06';
  end if;
  return query
  select card.id, card.name, output_product.id, output_product.serial_number,
    output_product.is_active, version.id, version.version_number::text,
    input_product.id, input_product.name, input_product.serial_number,
    input_product.is_active, item.quantity_per_card::text,
    case when input_product.id is null then null
      else public.get_production_eligible_quantity(input_product.id)::text end
  from public.pcb_cards as card
  join public.products as output_product on output_product.id = card.output_product_id
  join public.pcb_bom_versions as version on version.id = current_version_id
  left join public.pcb_bom_items as item on item.bom_version_id = version.id
  left join public.products as input_product on input_product.id = item.component_product_id
  where card.id = p_pcb_card_id
  order by input_product.serial_number nulls first, item.id;
end;
$function$;

select pg_temp.replace_production_function_text(
  'public.preflight_finish_work_order(uuid,timestamp with time zone)',
  $old$for balance_record in
    select balance.product_id, balance.quantity
    from public.work_order_items as item
    join public.inventory_balances as balance
      on balance.product_id = item.product_id
      and balance.warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
    where item.work_order_id = current_work_order.id
    order by balance.product_id
    for update of balance
  loop
    balance_count := balance_count + 1;
  end loop;

  if balance_count <> item_count_value then
    raise exception 'Inventory balance not found'
      using errcode = 'IVB01';
  end if;

  select pg_catalog.bool_and(balance.quantity >= item.quantity)
  into inventory_sufficient_value
  from public.work_order_items as item
  join public.inventory_balances as balance
    on balance.product_id = item.product_id
      and balance.warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
  where item.work_order_id = current_work_order.id;$old$,
  $new$for balance_record in
    select balance.product_id, balance.warehouse_id, balance.quantity
    from public.work_order_items as item
    join public.inventory_balances as balance
      on balance.product_id = item.product_id
    where item.work_order_id = current_work_order.id
      and balance.warehouse_id in (
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000003'::uuid,
        '10000000-0000-4000-8000-000000000002'::uuid
      )
    order by balance.product_id,
      public.production_warehouse_priority(balance.warehouse_id)
    for update of balance
  loop
    balance_count := balance_count + 1;
  end loop;

  if balance_count <> item_count_value * 3 then
    raise exception 'Inventory balance not found'
      using errcode = 'IVB01';
  end if;

  select pg_catalog.bool_and(
    public.get_production_eligible_quantity(item.product_id) >= item.quantity
  )
  into inventory_sufficient_value
  from public.work_order_items as item
  where item.work_order_id = current_work_order.id;$new$,
  1
);

select pg_temp.replace_production_function_text(
  'public.preflight_finish_work_order(uuid,timestamp with time zone)',
  $old$    balance.quantity,
    greatest(
      item.quantity::numeric - balance.quantity::numeric,
      0::numeric
    )::bigint
  from public.work_order_items as item
  join public.products as product
    on product.id = item.product_id
  join public.inventory_balances as balance
    on balance.product_id = item.product_id
      and balance.warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
  where item.work_order_id = current_work_order.id$old$,
  $new$    public.get_production_eligible_quantity(item.product_id),
    greatest(
      item.quantity::numeric
        - public.get_production_eligible_quantity(item.product_id)::numeric,
      0::numeric
    )::bigint
  from public.work_order_items as item
  join public.products as product
    on product.id = item.product_id
  where item.work_order_id = current_work_order.id$new$,
  1
);

select pg_temp.replace_production_function_text(
  'public.preflight_finish_pcb_production_work_order(uuid,timestamp with time zone,text)',
  $old$  select pg_catalog.count(*)
  into balance_count
  from (
    select balance.product_id
    from public.inventory_balances as balance
    where balance.warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
      and (balance.product_id = card_record.output_product_id
       or balance.product_id in (
         select item.product_id
         from public.work_order_items as item
         where item.work_order_id = current_work_order.id
       ))
    order by balance.product_id
    for update
  ) as locked_balance;

  if balance_count <> required_balance_count then
    raise exception 'Inventory balance not found' using errcode = 'IVB01';
  end if;

  select coalesce(
    pg_catalog.bool_and(balance.quantity::numeric >= combined.required),
    true
  )
  into inventory_sufficient_value
  from (
    select item.product_id, pg_catalog.sum(item.quantity::numeric) as required
    from public.work_order_items as item
    where item.work_order_id = current_work_order.id
    group by item.product_id
  ) as combined
  join public.inventory_balances as balance
    on balance.product_id = combined.product_id
    and balance.warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid;$old$,
  $new$  select pg_catalog.count(*)
  into balance_count
  from (
    select balance.product_id, balance.warehouse_id
    from public.inventory_balances as balance
    where balance.warehouse_id in (
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000003'::uuid,
        '10000000-0000-4000-8000-000000000002'::uuid
      )
      and (balance.product_id = card_record.output_product_id
       or balance.product_id in (
         select item.product_id
         from public.work_order_items as item
         where item.work_order_id = current_work_order.id
       ))
    order by balance.product_id,
      public.production_warehouse_priority(balance.warehouse_id)
    for update
  ) as locked_balance;

  if balance_count <> required_balance_count * 3 then
    raise exception 'Inventory balance not found' using errcode = 'IVB01';
  end if;

  select coalesce(pg_catalog.bool_and(
    public.get_production_eligible_quantity(combined.product_id)::numeric
      >= combined.required
  ), true)
  into inventory_sufficient_value
  from (
    select item.product_id, pg_catalog.sum(item.quantity::numeric) as required
    from public.work_order_items as item
    where item.work_order_id = current_work_order.id
    group by item.product_id
  ) as combined;$new$,
  1
);

drop function public.list_finished_work_order_materials(uuid);

create function public.list_finished_work_order_materials(p_work_order_id uuid)
returns table (
  product_id uuid,
  serial_number text,
  product_name text,
  quantity text,
  source_kind text,
  supplier_name text,
  catalog_number text,
  supplier_description text,
  warehouse_id uuid,
  warehouse_code text,
  warehouse_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  work_order_status text;
begin
  if auth.uid() is null or not (
    public.current_user_is_admin() or public.has_permission('work_orders.view')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_work_order_id is null then
    raise exception 'Work Order ID is required' using errcode = '22023';
  end if;
  select work_order.status into work_order_status
  from public.work_orders as work_order where work_order.id = p_work_order_id;
  if not found then raise exception 'Work Order not found' using errcode = 'P0002'; end if;
  if work_order_status <> 'finished' then
    raise exception 'Finished Work Order is required' using errcode = 'WOR10';
  end if;

  return query
  with allocated_rows as materialized (
    select allocation.product_id, product.serial_number,
      product.name as product_name, allocation.allocated_quantity,
      lot.source_kind, lot.supplier_name_snapshot,
      coalesce(lot.catalog_number_snapshot, '—') as catalog_number,
      lot.supplier_description_snapshot, allocation.warehouse_id,
      warehouse.code as warehouse_code,
      warehouse.display_name as warehouse_name,
      public.production_warehouse_priority(allocation.warehouse_id) as priority,
      lot.received_at, lot.id as source_lot_id,
      allocation.id as allocation_id
    from public.inventory_source_allocations as allocation
    join public.inventory_source_lots as lot on lot.id = allocation.source_lot_id
    join public.inventory_movements as movement
      on movement.id = allocation.outbound_inventory_movement_id
    join public.products as product on product.id = allocation.product_id
    join public.inventory_warehouses as warehouse
      on warehouse.id = allocation.warehouse_id
    left join public.pcb_production_runs as run
      on movement.source_type = 'pcb_production_input'
     and run.id = movement.source_id
    where (
      movement.source_type = 'work_order'
      and movement.source_id = p_work_order_id
    ) or (
      movement.source_type = 'pcb_production_input'
      and run.work_order_id = p_work_order_id
    )
  ),
  historical_unattributed_rows as materialized (
    select item.product_id, product.serial_number,
      product.name as product_name, item.quantity as allocated_quantity,
      'legacy_unknown'::text as source_kind,
      null::text as supplier_name_snapshot, '—'::text as catalog_number,
      null::text as supplier_description_snapshot,
      null::uuid as warehouse_id, null::text as warehouse_code,
      null::text as warehouse_name, null::smallint as priority,
      item.added_at as received_at, item.id as source_lot_id,
      item.id as allocation_id
    from public.work_order_items as item
    join public.products as product on product.id = item.product_id
    where item.work_order_id = p_work_order_id
      and not exists (
        select 1 from allocated_rows as allocated
        where allocated.product_id = item.product_id
      )
  ),
  result_rows as (
    select * from allocated_rows
    union all
    select * from historical_unattributed_rows
  )
  select result.product_id, result.serial_number, result.product_name,
    result.allocated_quantity::text, result.source_kind,
    result.supplier_name_snapshot, result.catalog_number,
    result.supplier_description_snapshot, result.warehouse_id,
    result.warehouse_code, result.warehouse_name
  from result_rows as result
  order by result.serial_number, result.product_id,
    result.priority nulls last, result.received_at,
    result.source_lot_id, result.allocation_id;
end;
$function$;

revoke all privileges on function public.list_finished_work_order_materials(uuid)
  from public, anon, authenticated;
grant execute on function public.list_finished_work_order_materials(uuid)
  to authenticated;

drop function public.list_finished_work_order_movements(uuid);

create function public.list_finished_work_order_movements(p_work_order_id uuid)
returns table (
  movement_id uuid,
  product_id uuid,
  serial_number text,
  product_name text,
  quantity_delta text,
  quantity_before text,
  quantity_after text,
  created_at timestamptz,
  warehouse_id uuid,
  warehouse_code text,
  warehouse_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  work_order_status text;
begin
  if auth.uid() is null or not (
    public.current_user_is_admin() or public.has_permission('work_orders.view')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_work_order_id is null then
    raise exception 'Work Order ID is required' using errcode = '22023';
  end if;
  select work_order.status into work_order_status
  from public.work_orders as work_order where work_order.id = p_work_order_id;
  if not found then raise exception 'Work Order not found' using errcode = 'P0002'; end if;
  if work_order_status <> 'finished' then
    raise exception 'Finished Work Order is required' using errcode = 'WOR10';
  end if;

  return query
  select movement.id, movement.product_id, product.serial_number,
    product.name, movement.quantity_delta::text,
    movement.quantity_before::text, movement.quantity_after::text,
    movement.created_at, movement.warehouse_id, warehouse.code,
    warehouse.display_name
  from public.inventory_movements as movement
  join public.products as product on product.id = movement.product_id
  join public.inventory_warehouses as warehouse
    on warehouse.id = movement.warehouse_id
  where (
    movement.source_type = 'work_order'
    and movement.source_id = p_work_order_id
  ) or (
    movement.source_type in ('pcb_production_input', 'pcb_production_output')
    and exists (
      select 1 from public.pcb_production_runs as run
      where run.id = movement.source_id
        and run.work_order_id = p_work_order_id
    )
  )
  order by movement.created_at desc, movement.id desc;
end;
$function$;

revoke all privileges on function public.list_finished_work_order_movements(uuid)
  from public, anon, authenticated;
grant execute on function public.list_finished_work_order_movements(uuid)
  to authenticated;


select pg_temp.replace_production_function_text(
  'public.finish_generic_work_order_internal(uuid,timestamp with time zone,text,text)',
  $old$  -- Apply in Product-ID order. Every balance is already locked by Task 117;
  -- apply_inventory_delta re-enters that lock, updates the balance, and creates
  -- exactly one immutable movement for this Work Order material.
  for material_record in
    select item.product_id, item.quantity
    from public.work_order_items as item
    where item.work_order_id = p_work_order_id
    order by item.product_id
  loop
    select applied.movement_id
    into applied_movement_id
    from public.apply_inventory_delta(
      p_product_id => material_record.product_id,
      p_quantity_delta => -material_record.quantity,
      p_movement_type => 'work_order',
      p_reason => null,
      p_source_type => 'work_order',
      p_source_id => p_work_order_id,
      p_project_id => trusted_project_id,
      p_reversal_of_movement_id => null
    ) as applied;

    if applied_movement_id is null then
      raise exception 'Work Order Inventory movement was not created'
        using errcode = 'IVB01';
    end if;

    movement_ids := pg_catalog.array_append(
      movement_ids,
      applied_movement_id
    );
  end loop;

  if pg_catalog.cardinality(movement_ids) <> validated_item_count then
    raise exception 'Work Order Inventory movements are incomplete'
      using errcode = 'IVB01';
  end if;$old$,
  $new$  -- One immutable outbound movement is created per Product/warehouse.
  -- The shared plan has already locked exact lots in canonical priority order.
  for material_record in
    select plan.product_id, plan.warehouse_id, plan.warehouse_priority,
      pg_catalog.sum(plan.allocated_quantity::numeric)::bigint as quantity
    from public.get_work_order_warehouse_source_allocation_plan(
      p_work_order_id
    ) as plan
    group by plan.product_id, plan.warehouse_id, plan.warehouse_priority
    order by plan.product_id, plan.warehouse_priority
  loop
    select applied.movement_id
    into applied_movement_id
    from public.apply_inventory_delta_in_warehouse(
      p_product_id => material_record.product_id,
      p_warehouse_id => material_record.warehouse_id,
      p_quantity_delta => -material_record.quantity,
      p_movement_type => 'work_order',
      p_reason => null,
      p_source_type => 'work_order',
      p_source_id => p_work_order_id,
      p_project_id => trusted_project_id,
      p_reversal_of_movement_id => null,
      p_product_supplier_id => null,
      p_inventory_source_kind => null
    ) as applied;

    if applied_movement_id is null then
      raise exception 'Work Order Inventory movement was not created'
        using errcode = 'IVB01';
    end if;
    movement_ids := pg_catalog.array_append(movement_ids, applied_movement_id);
  end loop;

  if pg_catalog.cardinality(movement_ids) = 0 then
    raise exception 'Work Order Inventory movements are incomplete'
      using errcode = 'IVB01';
  end if;$new$,
  1
);

select pg_temp.replace_production_function_text(
  'public.finish_pcb_work_order_internal(uuid,timestamp with time zone,text,text,text)',
  $old$  for material_record in
    select
      item.product_id,
      pg_catalog.sum(item.quantity::numeric)::bigint as quantity
    from public.work_order_items as item
    where item.work_order_id = p_work_order_id
    group by item.product_id
    order by item.product_id
  loop
    select applied.movement_id
    into applied_movement_id
    from public.apply_inventory_delta(
      p_product_id => material_record.product_id,
      p_quantity_delta => -material_record.quantity,
      p_movement_type => 'pcb_production_input',
      p_reason => null,
      p_source_type => 'pcb_production_input',
      p_source_id => created_run_id,
      p_project_id => trusted_project_id,
      p_reversal_of_movement_id => null
    ) as applied;
    if applied_movement_id is null then
      raise exception 'PCB input movement was not created'
        using errcode = 'IVB01';
    end if;
    input_movement_count := input_movement_count + 1;
    movement_ids := pg_catalog.array_append(movement_ids, applied_movement_id);
  end loop;

  if input_movement_count <> expected_input_movement_count then
    raise exception 'PCB input movements are incomplete'
      using errcode = 'IVB01';
  end if;$old$,
  $new$  expected_input_movement_count := 0;
  for material_record in
    select plan.product_id, plan.warehouse_id, plan.warehouse_priority,
      pg_catalog.sum(plan.allocated_quantity::numeric)::bigint as quantity
    from public.get_work_order_warehouse_source_allocation_plan(
      p_work_order_id
    ) as plan
    group by plan.product_id, plan.warehouse_id, plan.warehouse_priority
    order by plan.product_id, plan.warehouse_priority
  loop
    expected_input_movement_count := expected_input_movement_count + 1;
    select applied.movement_id
    into applied_movement_id
    from public.apply_inventory_delta_in_warehouse(
      p_product_id => material_record.product_id,
      p_warehouse_id => material_record.warehouse_id,
      p_quantity_delta => -material_record.quantity,
      p_movement_type => 'pcb_production_input',
      p_reason => null,
      p_source_type => 'pcb_production_input',
      p_source_id => created_run_id,
      p_project_id => trusted_project_id,
      p_reversal_of_movement_id => null,
      p_product_supplier_id => null,
      p_inventory_source_kind => null
    ) as applied;
    if applied_movement_id is null then
      raise exception 'PCB input movement was not created'
        using errcode = 'IVB01';
    end if;
    input_movement_count := input_movement_count + 1;
    movement_ids := pg_catalog.array_append(movement_ids, applied_movement_id);
  end loop;

  if input_movement_count <> expected_input_movement_count then
    raise exception 'PCB input movements are incomplete'
      using errcode = 'IVB01';
  end if;$new$,
  1
);

select pg_temp.replace_production_function_text(
  'public.finish_pcb_work_order_internal(uuid,timestamp with time zone,text,text,text)',
  $old$    from public.apply_inventory_delta(
      p_product_id => trusted_output_product_id,
      p_quantity_delta => actual_good_value,
      p_movement_type => 'pcb_production_output',
      p_reason => null,
      p_source_type => 'pcb_production_output',
      p_source_id => created_run_id,
      p_project_id => trusted_project_id,
      p_reversal_of_movement_id => null
    ) as applied;$old$,
  $new$    from public.apply_inventory_delta_in_warehouse(
      p_product_id => trusted_output_product_id,
      p_warehouse_id => '10000000-0000-4000-8000-000000000002'::uuid,
      p_quantity_delta => actual_good_value,
      p_movement_type => 'pcb_production_output',
      p_reason => null,
      p_source_type => 'pcb_production_output',
      p_source_id => created_run_id,
      p_project_id => trusted_project_id,
      p_reversal_of_movement_id => null,
      p_product_supplier_id => null,
      p_inventory_source_kind => 'internal_production'
    ) as applied;$new$,
  1
);

-- New Calculator work orders are always General Stock. The replay branch stays
-- before this check so historical Project-linked requests remain replayable.
select pg_temp.replace_production_function_text(
  'public.create_pcb_production_work_order(uuid,text,uuid,uuid)',
  $old$  if found then
    if existing_record.pcb_card_id is distinct from p_pcb_card_id
      or existing_record.planned_quantity is distinct from planned_quantity_value
      or existing_record.project_id is distinct from p_project_id
    then
      raise exception 'Creation request was already used for different PCB production data'
        using errcode = 'PCB13';
    end if;

    return query
    select existing_record.work_order_id, existing_record.work_order_number;
    return;
  end if;$old$,
  $new$  if found then
    if existing_record.pcb_card_id is distinct from p_pcb_card_id
      or existing_record.planned_quantity is distinct from planned_quantity_value
      or existing_record.project_id is distinct from p_project_id
    then
      raise exception 'Creation request was already used for different PCB production data'
        using errcode = 'PCB13';
    end if;

    return query
    select existing_record.work_order_id, existing_record.work_order_number;
    return;
  end if;

  if p_project_id is not null then
    raise exception 'New PCB production Work Orders do not accept a Project'
      using errcode = 'PCB10';
  end if;$new$,
  1
);

-- Both PDF snapshot overloads must produce the exact warehouse-aware fingerprint
-- later supplied to Finish. Their public projections remain unchanged.
select pg_temp.replace_production_function_text(
  'public.get_work_order_pdf_snapshot(uuid,timestamp with time zone)',
  'public.get_work_order_source_allocation_plan(',
  'public.get_work_order_warehouse_source_allocation_plan(',
  1
);
select pg_temp.replace_production_function_text(
  'public.get_work_order_pdf_snapshot(uuid,timestamp with time zone)',
  $old$plan.product_id::text || ':' || plan.source_lot_id::text || ':' ||
        plan.allocated_quantity::text,
      '|' order by plan.product_id, plan.received_at, plan.source_lot_id$old$,
  $new$plan.product_id::text || ':' || plan.warehouse_id::text || ':' ||
        plan.source_lot_id::text || ':' || plan.allocated_quantity::text,
      '|' order by plan.product_id, plan.warehouse_priority,
        plan.received_at, plan.source_lot_id$new$,
  1
);
select pg_temp.replace_production_function_text(
  'public.get_work_order_pdf_snapshot(uuid,timestamp with time zone)',
  'order by product.serial_number, plan.product_id, plan.received_at, plan.source_lot_id',
  'order by product.serial_number, plan.product_id, plan.warehouse_priority, plan.received_at, plan.source_lot_id',
  2
);

select pg_temp.replace_production_function_text(
  'public.get_work_order_pdf_snapshot(uuid,timestamp with time zone,text)',
  'public.get_work_order_source_allocation_plan(',
  'public.get_work_order_warehouse_source_allocation_plan(',
  1
);
select pg_temp.replace_production_function_text(
  'public.get_work_order_pdf_snapshot(uuid,timestamp with time zone,text)',
  $old$plan.product_id::text || ':' || plan.source_lot_id::text || ':' ||
        plan.allocated_quantity::text,
      '|' order by plan.product_id, plan.received_at, plan.source_lot_id$old$,
  $new$plan.product_id::text || ':' || plan.warehouse_id::text || ':' ||
        plan.source_lot_id::text || ':' || plan.allocated_quantity::text,
      '|' order by plan.product_id, plan.warehouse_priority,
        plan.received_at, plan.source_lot_id$new$,
  1
);
select pg_temp.replace_production_function_text(
  'public.get_work_order_pdf_snapshot(uuid,timestamp with time zone,text)',
  $old$order by material.serial_number nulls first, material.product_id nulls first,
          material.received_at nulls first, material.source_lot_id nulls first$old$,
  $new$order by material.serial_number nulls first, material.product_id nulls first,
          material.warehouse_priority nulls first, material.received_at nulls first,
          material.source_lot_id nulls first$new$,
  1
);
select pg_temp.replace_production_function_text(
  'public.get_work_order_pdf_snapshot(uuid,timestamp with time zone,text)',
  $old$order by material.serial_number nulls first, material.product_id nulls first,
    material.received_at nulls first, material.source_lot_id nulls first$old$,
  $new$order by material.serial_number nulls first, material.product_id nulls first,
    material.warehouse_priority nulls first, material.received_at nulls first,
    material.source_lot_id nulls first$new$,
  1
);


select pg_temp.replace_production_function_text(
  'public.preflight_finish_pcb_production_work_order(uuid,timestamp with time zone,text)',
  $old$  if exists (
    select 1
    from public.inventory_balances as balance
    where balance.product_id = card_record.output_product_id
      and balance.warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
      and balance.quantity::numeric
        - coalesce((
          select pg_catalog.sum(item.quantity::numeric)
          from public.work_order_items as item
          where item.work_order_id = current_work_order.id
            and item.product_id = card_record.output_product_id
        ), 0::numeric)
        + actual_good_value::numeric
        > 9223372036854775807::numeric
  ) then$old$,
  $new$  if exists (
    select 1
    from public.inventory_balances as balance
    where balance.product_id = card_record.output_product_id
      and balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid
      and balance.quantity::numeric
        - coalesce((
          select pg_catalog.sum(plan.allocated_quantity::numeric)
          from public.get_work_order_warehouse_source_allocation_plan(
            current_work_order.id
          ) as plan
          where plan.product_id = card_record.output_product_id
            and plan.warehouse_id = balance.warehouse_id
        ), 0::numeric)
        + actual_good_value::numeric
        > 9223372036854775807::numeric
  ) then$new$,
  1
);

select pg_temp.replace_production_function_text(
  'public.preflight_finish_pcb_production_work_order(uuid,timestamp with time zone,text)',
  $old$    input_balance.quantity,
    case
      when combined.product_id is null then null
      else greatest(
        combined.required_quantity::numeric - input_balance.quantity::numeric,
        0::numeric
      )::bigint
    end
  from public.products as output_product
  left join combined_materials as combined on true
  left join public.products as input_product
    on input_product.id = combined.product_id
  left join public.inventory_balances as input_balance
    on input_balance.product_id = combined.product_id
    and input_balance.warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
  where output_product.id = card_record.output_product_id$old$,
  $new$    case when combined.product_id is null then null
      else public.get_production_eligible_quantity(combined.product_id) end,
    case
      when combined.product_id is null then null
      else greatest(
        combined.required_quantity::numeric
          - public.get_production_eligible_quantity(combined.product_id)::numeric,
        0::numeric
      )::bigint
    end
  from public.products as output_product
  left join combined_materials as combined on true
  left join public.products as input_product
    on input_product.id = combined.product_id
  where output_product.id = card_record.output_product_id$new$,
  1
);
