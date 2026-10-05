-- Replace immediate browser production with an idempotent Work Order creation
-- boundary. The old function remains as historical SQL but is no longer
-- executable by normal application roles.
revoke execute
  on function public.produce_pcb(uuid, text, uuid)
  from authenticated;

create function public.create_pcb_production_work_order(
  p_pcb_card_id uuid,
  p_planned_quantity text,
  p_project_id uuid,
  p_creation_request_id uuid
)
returns table (
  work_order_id uuid,
  work_order_number text
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_is_admin boolean;
  actor_profile_id uuid;
  active_version_id uuid;
  active_version_number bigint;
  allocated_number text;
  card_record record;
  changed_at timestamptz;
  created_work_order_id uuid;
  existing_record record;
  planned_quantity_value bigint;
  planned_quantity_text text;
  product_record record;
  required_numeric numeric;
begin
  if auth.uid() is null or not (
    public.current_user_is_admin()
    or public.has_permission('pcb.produce')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if p_pcb_card_id is null or p_creation_request_id is null then
    raise exception 'PCB Card and creation request are required'
      using errcode = '22023';
  end if;

  if p_planned_quantity is null
    or p_planned_quantity !~ '^[0-9]+$'
  then
    raise exception 'Invalid planned production quantity'
      using errcode = '22023';
  end if;

  planned_quantity_text := pg_catalog.ltrim(p_planned_quantity, '0');
  if planned_quantity_text = ''
    or pg_catalog.length(planned_quantity_text) > 19
    or (
      pg_catalog.length(planned_quantity_text) = 19
      and planned_quantity_text > '9223372036854775807'
    )
  then
    raise exception 'Invalid planned production quantity'
      using errcode = '22023';
  end if;
  planned_quantity_value := planned_quantity_text::bigint;

  -- Serialize every replay of one client-generated request key before checking
  -- its durable row. A failed transaction releases the lock without poisoning
  -- the key; a committed replay returns the original Work Order.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_creation_request_id::text, 0)
  );

  if auth.uid() is null or not (
    public.current_user_is_admin()
    or public.has_permission('pcb.produce')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select
    production.work_order_id,
    production.pcb_card_id,
    production.planned_quantity,
    work_order.project_id,
    work_order.work_order_number
  into existing_record
  from public.pcb_production_work_orders as production
  join public.work_orders as work_order
    on work_order.id = production.work_order_id
  where production.creation_request_id = p_creation_request_id;

  if found then
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

  select card.id, card.name, card.output_product_id, card.is_active
  into card_record
  from public.pcb_cards as card
  where card.id = p_pcb_card_id
  for update;

  if not found then
    raise exception 'PCB Card not found' using errcode = 'P0002';
  end if;
  if not card_record.is_active then
    raise exception 'PCB Card is archived' using errcode = 'PCB07';
  end if;

  -- Lock and re-check the active actor authority after every potentially
  -- blocking request/card lock.
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
      and definition.key = 'pcb.produce'
      and definition.is_delegable
    for share of permission;

    if not found then
      raise exception 'Access denied' using errcode = '42501';
    end if;
  end if;

  select version.id, version.version_number
  into active_version_id, active_version_number
  from public.pcb_bom_versions as version
  where version.pcb_card_id = card_record.id
    and version.is_active
  for update;

  if not found or exists (
    select 1
    from public.pcb_bom_versions as version
    where version.pcb_card_id = card_record.id
      and version.version_number > active_version_number
  ) then
    raise exception 'Active PCB BOM is unavailable' using errcode = 'PCB06';
  end if;

  if p_project_id is not null then
    perform 1
    from public.projects as project
    where project.id = p_project_id
      and project.status in ('planned', 'in_progress', 'on_hold')
    for share;

    if not found then
      raise exception 'Project is unavailable for PCB production'
        using errcode = 'PCB10';
    end if;
  end if;

  -- Freeze Product eligibility against concurrent archival. No balance is read,
  -- reserved, or changed while the production Work Order is created.
  for product_record in
    select product.id, product.is_active, product.product_kind
    from public.products as product
    where product.id = card_record.output_product_id
       or product.id in (
         select item.component_product_id
         from public.pcb_bom_items as item
         where item.bom_version_id = active_version_id
       )
    order by product.id
    for share
  loop
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
      raise exception 'PCB BOM input Product is unavailable'
        using errcode = 'PCB04';
    end if;
  end loop;

  if not exists (
    select 1
    from public.products as product
    where product.id = card_record.output_product_id
  ) or exists (
    select 1
    from public.pcb_bom_items as item
    left join public.products as product
      on product.id = item.component_product_id
    where item.bom_version_id = active_version_id
      and product.id is null
  ) then
    raise exception 'PCB BOM Product is unavailable' using errcode = 'PCB04';
  end if;

  for product_record in
    select item.component_product_id, item.quantity_per_card
    from public.pcb_bom_items as item
    where item.bom_version_id = active_version_id
    order by item.component_product_id
  loop
    required_numeric :=
      product_record.quantity_per_card::numeric
      * planned_quantity_value::numeric;
    if required_numeric > 9223372036854775807::numeric then
      raise exception 'PCB input requirement exceeds supported quantity'
        using errcode = '22023';
    end if;
  end loop;

  allocated_number := public.allocate_work_order_number();

  if auth.uid() is null or not (
    public.current_user_is_admin()
    or public.has_permission('pcb.produce')
  ) or public.current_active_user_profile_id() is distinct from actor_profile_id then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  insert into public.work_orders as inserted (
    work_order_number,
    project_id,
    customer_name_snapshot,
    description,
    status,
    created_at,
    created_by_user_id,
    updated_at,
    updated_by_user_id,
    finished_at,
    finished_by_user_id
  ) values (
    allocated_number,
    p_project_id,
    null,
    'PCB production — ' || card_record.name,
    'draft',
    changed_at,
    actor_profile_id,
    changed_at,
    actor_profile_id,
    null,
    null
  ) returning inserted.id into created_work_order_id;

  -- Insert the generated items before the context marker. Once the marker is
  -- present, the production-material trigger makes the complete set immutable.
  insert into public.work_order_items (
    work_order_id,
    product_id,
    quantity,
    added_at,
    added_by_user_id
  )
  select
    created_work_order_id,
    item.component_product_id,
    (
      item.quantity_per_card::numeric * planned_quantity_value::numeric
    )::bigint,
    changed_at,
    actor_profile_id
  from public.pcb_bom_items as item
  where item.bom_version_id = active_version_id
  order by item.component_product_id;

  insert into public.pcb_production_work_orders (
    work_order_id,
    pcb_card_id,
    bom_version_id,
    planned_quantity,
    creation_request_id,
    created_at,
    created_by_user_id
  ) values (
    created_work_order_id,
    card_record.id,
    active_version_id,
    planned_quantity_value,
    p_creation_request_id,
    changed_at,
    actor_profile_id
  );

  perform public.append_audit_log(
    p_action_type => 'work_order.created',
    p_entity_type => 'work_order',
    p_summary => 'Created Work Order ' || allocated_number,
    p_entity_id => created_work_order_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'work_order_id', created_work_order_id,
      'work_order_number', allocated_number,
      'status', 'draft'
    )
  );

  perform public.append_audit_log(
    p_action_type => 'pcb_production.work_order_created',
    p_entity_type => 'work_order',
    p_summary => 'Created PCB production Work Order ' || allocated_number,
    p_entity_id => created_work_order_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'work_order_id', created_work_order_id,
      'pcb_card_id', card_record.id,
      'planned_quantity', planned_quantity_value,
      'project_id', p_project_id
    )
  );

  return query
  select created_work_order_id, allocated_number;
end;
$function$;

revoke all privileges
  on function public.create_pcb_production_work_order(uuid, text, uuid, uuid)
  from public, anon, authenticated;

grant execute
  on function public.create_pcb_production_work_order(uuid, text, uuid, uuid)
  to authenticated;

-- Narrow context projection for an already-authorized Work Order viewer.
create function public.get_pcb_production_work_order_context(
  p_work_order_id uuid
)
returns table (
  work_order_id uuid,
  pcb_card_id uuid,
  pcb_card_name text,
  bom_version_id uuid,
  bom_version_number text,
  planned_quantity text,
  output_product_id uuid,
  output_serial_number text,
  output_product_name text,
  actual_good_quantity text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
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

  perform 1
  from public.work_orders as work_order
  where work_order.id = p_work_order_id;
  if not found then
    raise exception 'Work Order not found' using errcode = 'P0002';
  end if;

  return query
  select
    production.work_order_id,
    production.pcb_card_id,
    card.name,
    production.bom_version_id,
    version.version_number::text,
    production.planned_quantity::text,
    card.output_product_id,
    output_product.serial_number,
    output_product.name,
    run.quantity_produced::text
  from public.pcb_production_work_orders as production
  join public.pcb_cards as card
    on card.id = production.pcb_card_id
  join public.pcb_bom_versions as version
    on version.id = production.bom_version_id
  join public.products as output_product
    on output_product.id = card.output_product_id
  left join public.pcb_production_runs as run
    on run.work_order_id = production.work_order_id
  where production.work_order_id = p_work_order_id;
end;
$function$;

revoke all privileges
  on function public.get_pcb_production_work_order_context(uuid)
  from public, anon, authenticated;

grant execute
  on function public.get_pcb_production_work_order_context(uuid)
  to authenticated;
