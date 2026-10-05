-- Specialized Finish preflight. Ordinary Work Orders continue to use the
-- existing two-argument preflight unchanged.
create function public.preflight_finish_pcb_production_work_order(
  p_work_order_id uuid,
  p_expected_updated_at timestamptz,
  p_actual_good_quantity text
)
returns table (
  work_order_id uuid,
  work_order_number text,
  project_id uuid,
  project_name text,
  customer_name_snapshot text,
  description text,
  updated_at timestamptz,
  pcb_card_id uuid,
  pcb_card_name text,
  bom_version_id uuid,
  bom_version_number text,
  planned_quantity bigint,
  actual_good_quantity bigint,
  output_product_id uuid,
  output_serial_number text,
  output_product_name text,
  item_count bigint,
  inventory_sufficient boolean,
  product_id uuid,
  serial_number text,
  product_name text,
  required_quantity bigint,
  available_quantity bigint,
  missing_quantity bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_is_admin boolean;
  actor_profile_id uuid;
  actual_good_text text;
  actual_good_value bigint;
  balance_count bigint := 0;
  card_record record;
  context_record public.pcb_production_work_orders%rowtype;
  current_work_order public.work_orders%rowtype;
  inventory_sufficient_value boolean;
  item_count_value bigint;
  product_count bigint := 0;
  product_record record;
  selected_project public.projects%rowtype;
begin
  if auth.uid() is null or not (
    public.current_user_is_admin()
    or public.has_permission('work_orders.finish')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if p_work_order_id is null or p_expected_updated_at is null then
    raise exception 'Work Order ID and expected timestamp are required'
      using errcode = '22023';
  end if;

  if p_actual_good_quantity is null
    or p_actual_good_quantity !~ '^[0-9]+$'
  then
    raise exception 'Actual completed quantity is invalid'
      using errcode = '22023';
  end if;
  actual_good_text := pg_catalog.ltrim(p_actual_good_quantity, '0');
  if actual_good_text = '' then
    actual_good_text := '0';
  end if;
  if pg_catalog.length(actual_good_text) > 19
    or (
      pg_catalog.length(actual_good_text) = 19
      and actual_good_text > '9223372036854775807'
    )
  then
    raise exception 'Actual completed quantity is invalid'
      using errcode = '22023';
  end if;
  actual_good_value := actual_good_text::bigint;

  -- Work Order remains the first domain lock for Save/Delete/Finish ordering.
  select work_order.*
  into current_work_order
  from public.work_orders as work_order
  where work_order.id = p_work_order_id
  for update;

  if not found then
    raise exception 'Work Order not found' using errcode = 'P0002';
  end if;

  select profile.id, profile.is_admin
  into actor_profile_id, actor_is_admin
  from public.user_profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.is_active
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
      and definition.key = 'work_orders.finish'
      and definition.is_delegable
    for share of permission;
    if not found then
      raise exception 'Access denied' using errcode = '42501';
    end if;
  end if;

  if current_work_order.status <> 'draft' then
    raise exception 'Finished Work Orders cannot be modified'
      using errcode = 'WOR02';
  end if;
  if current_work_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'Work Order Draft has changed. Reload and try again.'
      using errcode = 'WOR05';
  end if;

  select production.*
  into context_record
  from public.pcb_production_work_orders as production
  where production.work_order_id = current_work_order.id
  for share;
  if not found then
    raise exception 'PCB production Work Order context not found'
      using errcode = 'P0002';
  end if;

  if actual_good_value > context_record.planned_quantity then
    raise exception 'Actual completed quantity exceeds planned quantity'
      using errcode = '22023';
  end if;

  if current_work_order.description is null
    or pg_catalog.length(pg_catalog.btrim(current_work_order.description)) = 0
  then
    raise exception 'Work Order is incomplete for Finish'
      using errcode = 'WOR07';
  end if;

  if current_work_order.project_id is not null then
    select project.*
    into selected_project
    from public.projects as project
    where project.id = current_work_order.project_id
    for update;
    if not found then
      raise exception 'Project not found' using errcode = 'P0002';
    end if;
    if selected_project.status not in ('planned', 'in_progress', 'on_hold') then
      raise exception 'Project is unavailable for Work Order Finish'
        using errcode = 'WOR08';
    end if;
  end if;

  select
    card.id,
    card.name,
    card.output_product_id,
    version.version_number
  into card_record
  from public.pcb_cards as card
  join public.pcb_bom_versions as version
    on version.id = context_record.bom_version_id
   and version.pcb_card_id = card.id
  where card.id = context_record.pcb_card_id;
  if not found then
    raise exception 'PCB production identity is unavailable'
      using errcode = 'PCB06';
  end if;

  select pg_catalog.count(*)
  into item_count_value
  from public.work_order_items as item
  where item.work_order_id = current_work_order.id;

  -- Stable Product locks prevent archival from crossing validation/commit.
  for product_record in
    select product.id, product.is_active, product.product_kind
    from public.products as product
    where product.id = card_record.output_product_id
       or product.id in (
         select item.product_id
         from public.work_order_items as item
         where item.work_order_id = current_work_order.id
       )
    order by product.id
    for share
  loop
    product_count := product_count + 1;
    if product_record.id = card_record.output_product_id then
      if not product_record.is_active
        or product_record.product_kind <> 'pcb_finished_good'
      then
        raise exception 'PCB output Product is unavailable'
          using errcode = 'PRD01';
      end if;
    elsif not product_record.is_active
      or product_record.product_kind not in ('component', 'pcb_finished_good')
    then
      raise exception 'Product is unavailable for Work Order'
        using errcode = 'PRD05';
    end if;
  end loop;

  if product_count <> item_count_value + 1 then
    raise exception 'Product is unavailable for Work Order'
      using errcode = 'PRD05';
  end if;

  -- Lock all input and output balances in one deterministic Product-ID order.
  select pg_catalog.count(*)
  into balance_count
  from (
    select balance.product_id
    from public.inventory_balances as balance
    where balance.product_id = card_record.output_product_id
       or balance.product_id in (
         select item.product_id
         from public.work_order_items as item
         where item.work_order_id = current_work_order.id
       )
    order by balance.product_id
    for update
  ) as locked_balance;

  if balance_count <> item_count_value + 1 then
    raise exception 'Inventory balance not found' using errcode = 'IVB01';
  end if;

  select coalesce(pg_catalog.bool_and(balance.quantity >= item.quantity), true)
  into inventory_sufficient_value
  from public.work_order_items as item
  join public.inventory_balances as balance
    on balance.product_id = item.product_id
  where item.work_order_id = current_work_order.id;

  if exists (
    select 1
    from public.inventory_balances as balance
    where balance.product_id = card_record.output_product_id
      and balance.quantity::numeric + actual_good_value::numeric
        > 9223372036854775807::numeric
  ) then
    raise exception 'PCB output quantity exceeds Inventory capacity'
      using errcode = '22023';
  end if;

  return query
  select
    current_work_order.id,
    current_work_order.work_order_number,
    current_work_order.project_id,
    selected_project.name,
    current_work_order.customer_name_snapshot,
    current_work_order.description,
    current_work_order.updated_at,
    context_record.pcb_card_id,
    card_record.name,
    context_record.bom_version_id,
    card_record.version_number::text,
    context_record.planned_quantity,
    actual_good_value,
    card_record.output_product_id,
    output_product.serial_number,
    output_product.name,
    item_count_value,
    inventory_sufficient_value,
    item.product_id,
    input_product.serial_number,
    input_product.name,
    item.quantity,
    input_balance.quantity,
    case
      when item.product_id is null then null
      else greatest(
        item.quantity::numeric - input_balance.quantity::numeric,
        0::numeric
      )::bigint
    end
  from public.products as output_product
  left join public.work_order_items as item
    on item.work_order_id = current_work_order.id
  left join public.products as input_product
    on input_product.id = item.product_id
  left join public.inventory_balances as input_balance
    on input_balance.product_id = item.product_id
  where output_product.id = card_record.output_product_id
  order by input_product.serial_number nulls first, item.id;
end;
$function$;

revoke all privileges
  on function public.preflight_finish_pcb_production_work_order(uuid, timestamptz, text)
  from public, anon, authenticated;

grant execute
  on function public.preflight_finish_pcb_production_work_order(uuid, timestamptz, text)
  to authenticated;

-- Three-argument overload used only when the Edge boundary receives an explicit
-- actual-good value. The ordinary two-argument PDF snapshot remains unchanged.
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
  material_position text,
  product_id uuid,
  serial_number text,
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
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  return query
  with trusted_preflight as materialized (
    select preflight.*
    from public.preflight_finish_pcb_production_work_order(
      p_work_order_id,
      p_expected_updated_at,
      p_actual_good_quantity
    ) as preflight
  )
  select
    preflight.work_order_id,
    preflight.work_order_number,
    preflight.project_name,
    preflight.customer_name_snapshot,
    preflight.description,
    work_order.created_at,
    preflight.updated_at,
    case
      when preflight.product_id is null then null
      else pg_catalog.row_number() over (
        order by item.added_at, item.id
      )::text
    end,
    preflight.product_id,
    preflight.serial_number,
    preflight.product_name,
    preflight.required_quantity::text,
    preflight.pcb_card_id,
    preflight.pcb_card_name,
    preflight.bom_version_number,
    preflight.planned_quantity::text,
    preflight.actual_good_quantity::text,
    preflight.output_product_id,
    preflight.output_serial_number,
    preflight.output_product_name
  from trusted_preflight as preflight
  join public.work_orders as work_order
    on work_order.id = preflight.work_order_id
  left join public.work_order_items as item
    on item.work_order_id = preflight.work_order_id
   and item.product_id = preflight.product_id
  order by item.added_at nulls first, item.id nulls first;
end;
$function$;

revoke all privileges
  on function public.get_work_order_pdf_snapshot(uuid, timestamptz, text)
  from public, anon, authenticated;

grant execute
  on function public.get_work_order_pdf_snapshot(uuid, timestamptz, text)
  to authenticated;

-- Five-argument overload for PCB production. The ordinary four-argument Finish
-- function and all of its Project-completion semantics remain unchanged.
create function public.finish_work_order(
  p_work_order_id uuid,
  p_expected_updated_at timestamptz,
  p_pdf_storage_reference text,
  p_pdf_content_hash text,
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
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  actual_good_value bigint;
  applied_movement_id uuid;
  created_pdf_id uuid;
  created_run_id uuid;
  finish_timestamp timestamptz;
  inventory_sufficient_value boolean := true;
  material_record record;
  movement_ids uuid[] := '{}'::uuid[];
  trusted_bom_version_id uuid;
  trusted_card_id uuid;
  trusted_output_product_id uuid;
  trusted_planned_quantity bigint;
  trusted_project_id uuid;
  trusted_work_order_number text;
  validation_record record;
begin
  if auth.uid() is null or not (
    public.current_user_is_admin()
    or public.has_permission('work_orders.finish')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if p_pdf_storage_reference is null or not (
    p_pdf_storage_reference ~ (
      '^final/' || p_work_order_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]pdf$'
    )
  ) then
    raise exception 'Valid final Work Order PDF reference is required'
      using errcode = '22023';
  end if;
  if p_pdf_content_hash is not null
    and p_pdf_content_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Work Order PDF content hash is invalid'
      using errcode = '22023';
  end if;

  for validation_record in
    select preflight.*
    from public.preflight_finish_pcb_production_work_order(
      p_work_order_id,
      p_expected_updated_at,
      p_actual_good_quantity
    ) as preflight
  loop
    trusted_work_order_number := validation_record.work_order_number;
    trusted_project_id := validation_record.project_id;
    trusted_card_id := validation_record.pcb_card_id;
    trusted_bom_version_id := validation_record.bom_version_id;
    trusted_planned_quantity := validation_record.planned_quantity;
    trusted_output_product_id := validation_record.output_product_id;
    actual_good_value := validation_record.actual_good_quantity;
    inventory_sufficient_value := inventory_sufficient_value
      and validation_record.inventory_sufficient;
  end loop;

  if trusted_work_order_number is null then
    raise exception 'PCB production Work Order is incomplete for Finish'
      using errcode = 'WOR07';
  end if;
  if not inventory_sufficient_value then
    raise exception 'Insufficient physical Inventory' using errcode = 'IVB02';
  end if;

  actor_profile_id := public.current_active_user_profile_id();
  if actor_profile_id is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  perform 1
  from storage.objects as object
  where object.bucket_id = 'work-order-pdfs'
    and object.name = p_pdf_storage_reference
    and object.metadata->>'mimetype' = 'application/pdf'
  for key share;
  if not found then
    raise exception 'Valid final Work Order PDF object is required'
      using errcode = '22023';
  end if;

  perform 1
  from public.work_order_pdfs as pdf
  where pdf.work_order_id = p_work_order_id
     or pdf.storage_reference = p_pdf_storage_reference
  for key share;
  if found then
    raise exception 'Work Order PDF is already linked'
      using errcode = '22023';
  end if;

  finish_timestamp := pg_catalog.clock_timestamp();

  insert into public.pcb_production_runs as run (
    pcb_card_id,
    bom_version_id,
    project_id,
    quantity_produced,
    status,
    produced_by_user_id,
    completed_at,
    work_order_id
  ) values (
    trusted_card_id,
    trusted_bom_version_id,
    trusted_project_id,
    actual_good_value,
    'completed',
    actor_profile_id,
    finish_timestamp,
    p_work_order_id
  ) returning run.id into created_run_id;

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
    movement_ids := pg_catalog.array_append(movement_ids, applied_movement_id);
  end loop;

  -- Zero successful output is a valid completed batch. It records history but
  -- creates no misleading zero-delta ledger row and leaves output stock intact.
  if actual_good_value > 0 then
    select applied.movement_id
    into applied_movement_id
    from public.apply_inventory_delta(
      p_product_id => trusted_output_product_id,
      p_quantity_delta => actual_good_value,
      p_movement_type => 'pcb_production_output',
      p_reason => null,
      p_source_type => 'pcb_production_output',
      p_source_id => created_run_id,
      p_project_id => trusted_project_id,
      p_reversal_of_movement_id => null
    ) as applied;
    if applied_movement_id is null then
      raise exception 'PCB output movement was not created'
        using errcode = 'IVB01';
    end if;
    movement_ids := pg_catalog.array_append(movement_ids, applied_movement_id);
  end if;

  update public.work_orders as work_order
  set status = 'finished',
      finished_at = finish_timestamp,
      finished_by_user_id = actor_profile_id,
      updated_at = finish_timestamp,
      updated_by_user_id = actor_profile_id
  where work_order.id = p_work_order_id;

  insert into public.work_order_pdfs as inserted (
    work_order_id,
    storage_reference,
    generated_at,
    generated_by_user_id,
    document_version,
    content_hash
  ) values (
    p_work_order_id,
    p_pdf_storage_reference,
    finish_timestamp,
    actor_profile_id,
    1,
    p_pdf_content_hash
  ) returning inserted.id into created_pdf_id;

  perform public.append_audit_log(
    p_action_type => 'work_order.finished',
    p_entity_type => 'work_order',
    p_summary => 'Finished Work Order ' || trusted_work_order_number,
    p_entity_id => p_work_order_id,
    p_before_data => pg_catalog.jsonb_build_object(
      'status', 'draft',
      'project_id', trusted_project_id,
      'updated_at', p_expected_updated_at
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'status', 'finished',
      'project_id', trusted_project_id,
      'finished_at', finish_timestamp,
      'finished_by_user_id', actor_profile_id,
      'work_order_pdf_id', created_pdf_id,
      'inventory_movement_ids', pg_catalog.to_jsonb(movement_ids)
    )
  );

  perform public.append_audit_log(
    p_action_type => 'pcb_production.completed',
    p_entity_type => 'pcb_production_run',
    p_summary => 'Completed PCB production Work Order ' || trusted_work_order_number,
    p_entity_id => created_run_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'work_order_id', p_work_order_id,
      'pcb_card_id', trusted_card_id,
      'planned_quantity', trusted_planned_quantity,
      'actual_good_quantity', actual_good_value,
      'project_id', trusted_project_id
    )
  );

  return query
  select
    p_work_order_id,
    trusted_work_order_number,
    finish_timestamp,
    trusted_project_id,
    false,
    created_pdf_id;
end;
$function$;

revoke all privileges
  on function public.finish_work_order(uuid, timestamptz, text, text, text)
  from public, anon, authenticated;

grant execute
  on function public.finish_work_order(uuid, timestamptz, text, text, text)
  to authenticated;

-- Finished PCB production may legitimately have no Project or Customer.
create or replace function public.get_finished_work_order_detail(
  p_work_order_id uuid
)
returns table (
  work_order_id uuid,
  work_order_number text,
  project_id uuid,
  project_name text,
  customer_name_snapshot text,
  description text,
  created_at timestamptz,
  finished_at timestamptz,
  finished_by_user_id uuid,
  finished_by_full_name text,
  pdf_id uuid,
  document_version integer,
  generated_at timestamptz
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
    public.current_user_is_admin()
    or public.has_permission('work_orders.view')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_work_order_id is null then
    raise exception 'Work Order ID is required' using errcode = '22023';
  end if;

  select work_order.status
  into work_order_status
  from public.work_orders as work_order
  where work_order.id = p_work_order_id;
  if not found then
    raise exception 'Work Order not found' using errcode = 'P0002';
  end if;
  if work_order_status <> 'finished' then
    raise exception 'Finished Work Order is required' using errcode = 'WOR10';
  end if;

  return query
  select
    work_order.id,
    work_order.work_order_number,
    work_order.project_id,
    project.name,
    work_order.customer_name_snapshot,
    work_order.description,
    work_order.created_at,
    work_order.finished_at,
    work_order.finished_by_user_id,
    finisher.full_name,
    pdf.id,
    pdf.document_version,
    pdf.generated_at
  from public.work_orders as work_order
  left join public.projects as project
    on project.id = work_order.project_id
  join public.user_profiles as finisher
    on finisher.id = work_order.finished_by_user_id
  left join public.work_order_pdfs as pdf
    on pdf.work_order_id = work_order.id
  where work_order.id = p_work_order_id;
end;
$function$;

revoke all privileges
  on function public.get_finished_work_order_detail(uuid)
  from public, anon, authenticated;
grant execute
  on function public.get_finished_work_order_detail(uuid)
  to authenticated;

-- Include both generic Work Order movements and PCB-production movements whose
-- immutable production run points back to this Work Order.
create or replace function public.list_finished_work_order_movements(
  p_work_order_id uuid
)
returns table (
  movement_id uuid,
  product_id uuid,
  serial_number text,
  product_name text,
  quantity_delta text,
  quantity_before text,
  quantity_after text,
  created_at timestamptz
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
    public.current_user_is_admin()
    or public.has_permission('work_orders.view')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_work_order_id is null then
    raise exception 'Work Order ID is required' using errcode = '22023';
  end if;

  select work_order.status
  into work_order_status
  from public.work_orders as work_order
  where work_order.id = p_work_order_id;
  if not found then
    raise exception 'Work Order not found' using errcode = 'P0002';
  end if;
  if work_order_status <> 'finished' then
    raise exception 'Finished Work Order is required' using errcode = 'WOR10';
  end if;

  return query
  select
    movement.id,
    movement.product_id,
    product.serial_number,
    product.name,
    movement.quantity_delta::text,
    movement.quantity_before::text,
    movement.quantity_after::text,
    movement.created_at
  from public.inventory_movements as movement
  join public.products as product
    on product.id = movement.product_id
  where (
    movement.source_type = 'work_order'
    and movement.source_id = p_work_order_id
  ) or (
    movement.source_type in ('pcb_production_input', 'pcb_production_output')
    and exists (
      select 1
      from public.pcb_production_runs as run
      where run.id = movement.source_id
        and run.work_order_id = p_work_order_id
    )
  )
  order by movement.created_at desc, movement.id desc;
end;
$function$;

revoke all privileges
  on function public.list_finished_work_order_movements(uuid)
  from public, anon, authenticated;
grant execute
  on function public.list_finished_work_order_movements(uuid)
  to authenticated;
