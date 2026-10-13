create function public.get_work_order_source_allocation_plan(p_work_order_id uuid)
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
declare
  material record;
  planned_quantity numeric;
begin
  if p_work_order_id is null then
    raise exception 'Work Order ID is required' using errcode = '22023';
  end if;

  -- Product order matches Finish. Balance rows are already locked by preflight;
  -- source lots use the stable FIFO order required by every consuming path.
  for material in
    select item.product_id, pg_catalog.sum(item.quantity::numeric)::bigint as quantity
    from public.work_order_items as item
    where item.work_order_id = p_work_order_id
    group by item.product_id
    order by item.product_id
  loop
    perform 1
    from public.inventory_source_lots as lot
    where lot.product_id = material.product_id
      and lot.remaining_quantity > 0
    order by lot.received_at, lot.id
    for update;

    select coalesce(pg_catalog.sum(lot.remaining_quantity::numeric), 0::numeric)
    into planned_quantity
    from public.inventory_source_lots as lot
    where lot.product_id = material.product_id
      and lot.remaining_quantity > 0;

    if planned_quantity < material.quantity::numeric then
      raise exception 'Insufficient physical Inventory' using errcode = 'IVB02';
    end if;

    return query
    with fifo as (
      select
        lot.*,
        coalesce(
          pg_catalog.sum(lot.remaining_quantity::numeric) over (
            order by lot.received_at, lot.id
            rows between unbounded preceding and 1 preceding
          ),
          0::numeric
        ) as quantity_before_lot
      from public.inventory_source_lots as lot
      where lot.product_id = material.product_id
        and lot.remaining_quantity > 0
    )
    select
      fifo.product_id,
      fifo.id,
      fifo.source_kind,
      fifo.supplier_name_snapshot,
      fifo.catalog_number_snapshot,
      fifo.supplier_description_snapshot,
      least(
        fifo.remaining_quantity::numeric,
        material.quantity::numeric - fifo.quantity_before_lot
      )::bigint,
      fifo.received_at
    from fifo
    where fifo.quantity_before_lot < material.quantity::numeric
    order by fifo.received_at, fifo.id;
  end loop;
end;
$function$;

create function public.get_work_order_source_allocation_fingerprint(p_work_order_id uuid)
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
    plan.product_id::text || ':' || plan.source_lot_id::text || ':' ||
      plan.allocated_quantity::text,
    '|' order by plan.product_id, plan.received_at, plan.source_lot_id
  ), ''))
  into fingerprint
  from public.get_work_order_source_allocation_plan(p_work_order_id) as plan;
  return fingerprint;
end;
$function$;

revoke all privileges on function public.get_work_order_source_allocation_plan(uuid)
  from public, anon, authenticated;
revoke all privileges on function public.get_work_order_source_allocation_fingerprint(uuid)
  from public, anon, authenticated;

drop function public.get_work_order_pdf_snapshot(uuid, timestamptz);

create function public.get_work_order_pdf_snapshot(
  p_work_order_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  work_order_id uuid,
  work_order_number text,
  project_name text,
  customer_name_snapshot text,
  description text,
  work_order_created_at timestamptz,
  snapshot_updated_at timestamptz,
  allocation_fingerprint text,
  material_position text,
  product_id uuid,
  catalog_number text,
  product_name text,
  quantity text
)
language plpgsql volatile security definer set search_path = ''
as $function$
begin
  return query
  with trusted_preflight as materialized (
    select preflight.*
    from public.preflight_finish_work_order(
      p_work_order_id, p_expected_updated_at
    ) as preflight
  ),
  trusted_header as materialized (
    select preflight.work_order_id, preflight.work_order_number,
      preflight.project_name, preflight.customer_name_snapshot,
      preflight.description, preflight.updated_at
    from trusted_preflight as preflight
    order by preflight.product_id
    limit 1
  ),
  allocation_plan as materialized (
    select plan.*
    from trusted_header as header
    cross join lateral public.get_work_order_source_allocation_plan(
      header.work_order_id
    ) as plan
  ),
  fingerprint as materialized (
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      plan.product_id::text || ':' || plan.source_lot_id::text || ':' ||
        plan.allocated_quantity::text,
      '|' order by plan.product_id, plan.received_at, plan.source_lot_id
    ), '')) as value
    from allocation_plan as plan
  )
  select
    header.work_order_id,
    header.work_order_number,
    header.project_name,
    header.customer_name_snapshot,
    header.description,
    work_order.created_at,
    header.updated_at,
    fingerprint.value,
    pg_catalog.row_number() over (
      order by product.serial_number, plan.product_id, plan.received_at, plan.source_lot_id
    )::text,
    plan.product_id,
    coalesce(plan.catalog_number_snapshot, '—'),
    product.name,
    plan.allocated_quantity::text
  from trusted_header as header
  join public.work_orders as work_order on work_order.id = header.work_order_id
  cross join fingerprint
  join allocation_plan as plan on true
  join public.products as product on product.id = plan.product_id
  order by product.serial_number, plan.product_id, plan.received_at, plan.source_lot_id;
end;
$function$;

revoke all privileges on function public.get_work_order_pdf_snapshot(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_work_order_pdf_snapshot(uuid, timestamptz)
  to authenticated;

drop function public.get_work_order_pdf_snapshot(uuid, timestamptz, text);

create function public.get_work_order_pdf_snapshot(
  p_work_order_id uuid,
  p_expected_updated_at timestamptz,
  p_actual_good_quantity text
)
returns table (
  work_order_id uuid,
  work_order_number text,
  project_name text,
  customer_name_snapshot text,
  description text,
  work_order_created_at timestamptz,
  snapshot_updated_at timestamptz,
  allocation_fingerprint text,
  material_position text,
  product_id uuid,
  catalog_number text,
  product_name text,
  quantity text,
  production_pcb_card_id uuid,
  production_pcb_card_name text,
  production_bom_version_number text,
  production_planned_quantity text,
  production_actual_good_quantity text,
  production_output_product_id uuid,
  production_output_serial_number text,
  production_output_product_name text
)
language plpgsql volatile security definer set search_path = ''
as $function$
begin
  return query
  with trusted_preflight as materialized (
    select preflight.*
    from public.preflight_finish_pcb_production_work_order(
      p_work_order_id, p_expected_updated_at, p_actual_good_quantity
    ) as preflight
  ),
  trusted_header as materialized (
    select preflight.*
    from trusted_preflight as preflight
    order by preflight.product_id nulls first
    limit 1
  ),
  allocation_plan as materialized (
    select plan.*
    from trusted_header as header
    cross join lateral public.get_work_order_source_allocation_plan(
      header.work_order_id
    ) as plan
  ),
  fingerprint as materialized (
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      plan.product_id::text || ':' || plan.source_lot_id::text || ':' ||
        plan.allocated_quantity::text,
      '|' order by plan.product_id, plan.received_at, plan.source_lot_id
    ), '')) as value
    from allocation_plan as plan
  ),
  material_rows as materialized (
    select
      plan.*,
      product.serial_number,
      product.name as product_name
    from allocation_plan as plan
    join public.products as product on product.id = plan.product_id
  )
  select
    header.work_order_id,
    header.work_order_number,
    header.project_name,
    header.customer_name_snapshot,
    header.description,
    work_order.created_at,
    header.updated_at,
    fingerprint.value,
    case when material.product_id is null then null else
      pg_catalog.row_number() over (
        order by material.serial_number nulls first, material.product_id nulls first,
          material.received_at nulls first, material.source_lot_id nulls first
      )::text
    end,
    material.product_id,
    case when material.product_id is null then null
      else coalesce(material.catalog_number_snapshot, '—') end,
    material.product_name,
    material.allocated_quantity::text,
    header.pcb_card_id,
    header.pcb_card_name,
    header.bom_version_number,
    header.planned_quantity::text,
    header.actual_good_quantity::text,
    header.output_product_id,
    header.output_serial_number,
    header.output_product_name
  from trusted_header as header
  join public.work_orders as work_order on work_order.id = header.work_order_id
  cross join fingerprint
  left join material_rows as material on true
  order by material.serial_number nulls first, material.product_id nulls first,
    material.received_at nulls first, material.source_lot_id nulls first;
end;
$function$;

revoke all privileges on function public.get_work_order_pdf_snapshot(uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.get_work_order_pdf_snapshot(uuid, timestamptz, text)
  to authenticated;

-- Keep the reviewed atomic Finish implementations as internal primitives. The
-- browser-facing overloads below establish the normal Finish lock order first,
-- lock and fingerprint the FIFO plan, and then invoke those primitives in the
-- same transaction. A changed plan can never commit behind an already-rendered PDF.
alter function public.finish_work_order(uuid, timestamptz, text, text)
  rename to finish_generic_work_order_internal;
alter function public.finish_work_order(uuid, timestamptz, text, text, text)
  rename to finish_pcb_work_order_internal;

revoke all privileges
  on function public.finish_generic_work_order_internal(uuid, timestamptz, text, text)
  from public, anon, authenticated;
revoke all privileges
  on function public.finish_pcb_work_order_internal(uuid, timestamptz, text, text, text)
  from public, anon, authenticated;

create function public.finish_work_order(
  p_work_order_id uuid,
  p_expected_updated_at timestamptz,
  p_pdf_storage_reference text,
  p_pdf_content_hash text,
  p_allocation_fingerprint text
)
returns table (
  work_order_id uuid,
  work_order_number text,
  finished_at timestamptz,
  project_id uuid,
  project_completed boolean,
  work_order_pdf_id uuid
)
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  current_fingerprint text;
begin
  if p_allocation_fingerprint is null
    or p_allocation_fingerprint !~ '^[0-9a-f]{32}$'
  then
    raise exception 'Valid Inventory source allocation fingerprint is required'
      using errcode = '22023';
  end if;

  -- Establish Work Order -> Project -> Product -> InventoryBalance locks.
  perform 1
  from public.preflight_finish_work_order(
    p_work_order_id, p_expected_updated_at
  );

  -- Continue with InventoryBalance -> source-lot FIFO locks.
  current_fingerprint := public.get_work_order_source_allocation_fingerprint(
    p_work_order_id
  );
  if current_fingerprint is distinct from p_allocation_fingerprint then
    raise exception 'Inventory sources changed. Reload and try again.'
      using errcode = 'WOR11';
  end if;

  return query
  select finished.*
  from public.finish_generic_work_order_internal(
    p_work_order_id,
    p_expected_updated_at,
    p_pdf_storage_reference,
    p_pdf_content_hash
  ) as finished;
end;
$function$;

create function public.finish_work_order(
  p_work_order_id uuid,
  p_expected_updated_at timestamptz,
  p_pdf_storage_reference text,
  p_pdf_content_hash text,
  p_allocation_fingerprint text,
  p_actual_good_quantity text
)
returns table (
  work_order_id uuid,
  work_order_number text,
  finished_at timestamptz,
  project_id uuid,
  project_completed boolean,
  work_order_pdf_id uuid
)
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  current_fingerprint text;
begin
  if p_allocation_fingerprint is null
    or p_allocation_fingerprint !~ '^[0-9a-f]{32}$'
  then
    raise exception 'Valid Inventory source allocation fingerprint is required'
      using errcode = '22023';
  end if;

  perform 1
  from public.preflight_finish_pcb_production_work_order(
    p_work_order_id, p_expected_updated_at, p_actual_good_quantity
  );
  current_fingerprint := public.get_work_order_source_allocation_fingerprint(
    p_work_order_id
  );
  if current_fingerprint is distinct from p_allocation_fingerprint then
    raise exception 'Inventory sources changed. Reload and try again.'
      using errcode = 'WOR11';
  end if;

  return query
  select finished.*
  from public.finish_pcb_work_order_internal(
    p_work_order_id,
    p_expected_updated_at,
    p_pdf_storage_reference,
    p_pdf_content_hash,
    p_actual_good_quantity
  ) as finished;
end;
$function$;

revoke all privileges on function public.finish_work_order(uuid, timestamptz, text, text, text)
  from public, anon, authenticated;
revoke all privileges on function public.finish_work_order(uuid, timestamptz, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_work_order(uuid, timestamptz, text, text, text)
  to authenticated;
grant execute on function public.finish_work_order(uuid, timestamptz, text, text, text, text)
  to authenticated;

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
  supplier_description text
)
language plpgsql stable security definer set search_path = ''
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
    select
      allocation.product_id,
      product.serial_number,
      product.name as product_name,
      allocation.allocated_quantity,
      lot.source_kind,
      lot.supplier_name_snapshot,
      coalesce(lot.catalog_number_snapshot, '—') as catalog_number,
      lot.supplier_description_snapshot,
      lot.received_at,
      lot.id as source_lot_id,
      allocation.id as allocation_id
    from public.inventory_source_allocations as allocation
    join public.inventory_source_lots as lot on lot.id = allocation.source_lot_id
    join public.inventory_movements as movement
      on movement.id = allocation.outbound_inventory_movement_id
    join public.products as product on product.id = allocation.product_id
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
    select
      item.product_id,
      product.serial_number,
      product.name as product_name,
      item.quantity as allocated_quantity,
      'legacy_unknown'::text as source_kind,
      null::text as supplier_name_snapshot,
      '—'::text as catalog_number,
      null::text as supplier_description_snapshot,
      item.added_at as received_at,
      item.id as source_lot_id,
      item.id as allocation_id
    from public.work_order_items as item
    join public.products as product on product.id = item.product_id
    where item.work_order_id = p_work_order_id
      and not exists (
        select 1
        from allocated_rows as allocated
        where allocated.product_id = item.product_id
      )
  ),
  result_rows as (
    select * from allocated_rows
    union all
    select * from historical_unattributed_rows
  )
  select
    result.product_id,
    result.serial_number,
    result.product_name,
    result.allocated_quantity::text,
    result.source_kind,
    result.supplier_name_snapshot,
    result.catalog_number,
    result.supplier_description_snapshot
  from result_rows as result
  order by result.serial_number, result.product_id,
    result.received_at, result.source_lot_id, result.allocation_id;
end;
$function$;

revoke all privileges on function public.list_finished_work_order_materials(uuid)
  from public, anon, authenticated;
grant execute on function public.list_finished_work_order_materials(uuid)
  to authenticated;
