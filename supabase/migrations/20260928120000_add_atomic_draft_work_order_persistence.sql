create function public.save_draft_work_order(
  p_work_order_id uuid,
  p_project_id uuid,
  p_description text,
  p_items jsonb,
  p_expected_updated_at timestamptz
)
returns table (
  work_order_id uuid,
  updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  after_materials jsonb;
  before_materials jsonb;
  changed_at timestamptz;
  current_work_order public.work_orders%rowtype;
  desired_item jsonb;
  desired_product_id uuid;
  header_changed boolean;
  item_key_count bigint;
  materials_changed boolean;
  normalized_description text;
  product_record public.products%rowtype;
  quantity_text text;
  selected_project public.projects%rowtype;
  trusted_customer_name text;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.edit_draft')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_work_order_id is null then
    raise exception 'Work Order ID is required'
      using errcode = '22023';
  end if;

  if p_expected_updated_at is null then
    raise exception 'Expected Work Order update timestamp is required'
      using errcode = '22023';
  end if;

  actor_profile_id := public.current_active_user_profile_id();
  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  normalized_description := nullif(pg_catalog.btrim(p_description), '');

  select work_order.*
  into current_work_order
  from public.work_orders as work_order
  where work_order.id = p_work_order_id
  for update;

  if not found then
    raise exception 'Work Order not found'
      using errcode = 'P0002';
  end if;

  -- Authorization can change while the caller waits for the Draft lock.
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.edit_draft')
    )
    or public.current_active_user_profile_id() is distinct from actor_profile_id
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if current_work_order.status <> 'draft' then
    raise exception 'Finished Work Orders cannot be modified'
      using errcode = 'WOR02';
  end if;

  if current_work_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'Work Order Draft has changed. Reload and try again.'
      using errcode = 'WOR05';
  end if;

  if p_project_id is null then
    trusted_customer_name := null;
  else
    select project.*
    into selected_project
    from public.projects as project
    where project.id = p_project_id
    for share;

    if not found then
      raise exception 'Project not found'
        using errcode = 'P0002';
    end if;

    -- Preserve the Task 108 authorization re-check after a blocking Project lock.
    if auth.uid() is null
      or not (
        public.current_user_is_admin()
        or public.has_permission('work_orders.edit_draft')
      )
      or public.current_active_user_profile_id() is distinct from actor_profile_id
    then
      raise exception 'Access denied'
        using errcode = '42501';
    end if;

    if p_project_id is distinct from current_work_order.project_id
      and selected_project.status not in ('planned', 'in_progress', 'on_hold')
    then
      raise exception 'Selected Project is unavailable for Work Order Draft'
        using errcode = '22023';
    end if;

    trusted_customer_name := selected_project.customer_name;
  end if;

  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'Draft materials must be a JSON array'
      using errcode = '22023';
  end if;

  for desired_item in
    select item.value
    from pg_catalog.jsonb_array_elements(p_items) as item(value)
  loop
    if pg_catalog.jsonb_typeof(desired_item) <> 'object' then
      raise exception 'Each Draft material must be an object'
        using errcode = '22023';
    end if;

    select pg_catalog.count(*)
    into item_key_count
    from pg_catalog.jsonb_object_keys(desired_item) as item_key(key_name);

    if item_key_count <> 2
      or not (desired_item ? 'product_id')
      or not (desired_item ? 'quantity')
    then
      raise exception 'Each Draft material must contain only product_id and quantity'
        using errcode = '22023';
    end if;

    if pg_catalog.jsonb_typeof(desired_item -> 'product_id') <> 'string'
      or not (
        (desired_item ->> 'product_id') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
    then
      raise exception 'Draft material Product ID is invalid'
        using errcode = '22023';
    end if;

    if pg_catalog.jsonb_typeof(desired_item -> 'quantity') <> 'string' then
      raise exception 'Draft material Quantity must be a decimal string'
        using errcode = '22023';
    end if;

    quantity_text := desired_item ->> 'quantity';
    if not (quantity_text ~ '^[1-9][0-9]*$')
      or pg_catalog.length(quantity_text) > 19
      or (
        pg_catalog.length(quantity_text) = 19
        and quantity_text > '9223372036854775807'
      )
    then
      raise exception 'Draft material Quantity is invalid'
        using errcode = '22023';
    end if;
  end loop;

  if (
    select pg_catalog.count(*) <> pg_catalog.count(
      distinct (item.value ->> 'product_id')::uuid
    )
    from pg_catalog.jsonb_array_elements(p_items) as item(value)
  ) then
    raise exception 'Duplicate Draft material Product IDs are not allowed'
      using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'product_id', item.product_id,
        'quantity', item.quantity
      )
      order by item.product_id
    ),
    '[]'::jsonb
  )
  into before_materials
  from public.work_order_items as item
  where item.work_order_id = current_work_order.id;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'product_id', desired.product_id,
        'quantity', desired.quantity
      )
      order by desired.product_id
    ),
    '[]'::jsonb
  )
  into after_materials
  from (
    select
      (item.value ->> 'product_id')::uuid as product_id,
      (item.value ->> 'quantity')::bigint as quantity
    from pg_catalog.jsonb_array_elements(p_items) as item(value)
  ) as desired;

  header_changed :=
    current_work_order.project_id is distinct from p_project_id
    or current_work_order.customer_name_snapshot
      is distinct from trusted_customer_name
    or current_work_order.description is distinct from normalized_description;

  materials_changed := before_materials is distinct from after_materials;

  if not header_changed and not materials_changed then
    return query
    select current_work_order.id, current_work_order.updated_at;
    return;
  end if;

  -- Only references newly introduced to this Work Order must be active. Existing
  -- persisted references remain historical if their Product is archived later.
  -- Shared locks are acquired in UUID order so Product archival cannot race a new
  -- reference between eligibility validation and commit.
  for desired_product_id in
    select desired.product_id
    from (
      select (item.value ->> 'product_id')::uuid as product_id
      from pg_catalog.jsonb_array_elements(p_items) as item(value)
    ) as desired
    left join public.work_order_items as existing
      on existing.work_order_id = current_work_order.id
     and existing.product_id = desired.product_id
    where existing.id is null
    order by desired.product_id
  loop
    select product.*
    into product_record
    from public.products as product
    where product.id = desired_product_id
    for share;

    if not found
      or not product_record.is_active
      or product_record.product_kind not in ('component', 'pcb_finished_good')
    then
      raise exception 'Product is unavailable for Work Order'
        using errcode = 'PRD05';
    end if;

    if auth.uid() is null
      or not (
        public.current_user_is_admin()
        or public.has_permission('work_orders.edit_draft')
      )
      or public.current_active_user_profile_id() is distinct from actor_profile_id
    then
      raise exception 'Access denied'
        using errcode = '42501';
    end if;
  end loop;

  delete from public.work_order_items as existing
  where existing.work_order_id = current_work_order.id
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_items) as item(value)
      where (item.value ->> 'product_id')::uuid = existing.product_id
    );

  update public.work_order_items as existing
  set quantity = desired.quantity
  from (
    select
      (item.value ->> 'product_id')::uuid as product_id,
      (item.value ->> 'quantity')::bigint as quantity
    from pg_catalog.jsonb_array_elements(p_items) as item(value)
  ) as desired
  where existing.work_order_id = current_work_order.id
    and existing.product_id = desired.product_id
    and existing.quantity is distinct from desired.quantity;

  insert into public.work_order_items (
    work_order_id,
    product_id,
    quantity,
    added_by_user_id
  )
  select
    current_work_order.id,
    desired.product_id,
    desired.quantity,
    actor_profile_id
  from (
    select
      (item.value ->> 'product_id')::uuid as product_id,
      (item.value ->> 'quantity')::bigint as quantity
    from pg_catalog.jsonb_array_elements(p_items) as item(value)
  ) as desired
  left join public.work_order_items as existing
    on existing.work_order_id = current_work_order.id
   and existing.product_id = desired.product_id
  where existing.id is null
  order by desired.product_id;

  changed_at := pg_catalog.clock_timestamp();

  update public.work_orders as work_order
  set project_id = p_project_id,
      customer_name_snapshot = trusted_customer_name,
      description = normalized_description,
      updated_at = changed_at,
      updated_by_user_id = actor_profile_id
  where work_order.id = current_work_order.id;

  perform public.append_audit_log(
    p_action_type => 'work_order.updated',
    p_entity_type => 'work_order',
    p_summary => 'Updated Work Order ' || current_work_order.work_order_number,
    p_entity_id => current_work_order.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'project_id', current_work_order.project_id,
      'customer_name_snapshot', current_work_order.customer_name_snapshot,
      'description', current_work_order.description,
      'materials', before_materials
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'project_id', p_project_id,
      'customer_name_snapshot', trusted_customer_name,
      'description', normalized_description,
      'materials', after_materials
    )
  );

  return query
  select current_work_order.id, changed_at;
end;
$function$;

revoke all privileges
  on function public.save_draft_work_order(uuid, uuid, text, jsonb, timestamptz)
  from public, anon, authenticated;

grant execute
  on function public.save_draft_work_order(uuid, uuid, text, jsonb, timestamptz)
  to authenticated;

create function public.list_draft_work_order_materials(
  p_work_order_id uuid
)
returns table (
  product_id uuid,
  serial_number text,
  product_name text,
  quantity bigint,
  current_inventory bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_work_order_status text;
begin
  if auth.uid() is null
    or public.current_active_user_profile_id() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.view')
      or public.has_permission('work_orders.edit_draft')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_work_order_id is null then
    raise exception 'Work Order ID is required'
      using errcode = '22023';
  end if;

  select work_order.status
  into current_work_order_status
  from public.work_orders as work_order
  where work_order.id = p_work_order_id;

  if not found then
    raise exception 'Work Order not found'
      using errcode = 'P0002';
  end if;

  if current_work_order_status <> 'draft' then
    raise exception 'Finished Work Orders cannot be modified'
      using errcode = 'WOR02';
  end if;

  if exists (
    select 1
    from public.work_order_items as item
    left join public.inventory_balances as balance
      on balance.product_id = item.product_id
    where item.work_order_id = p_work_order_id
      and balance.product_id is null
  ) then
    raise exception 'Inventory balance not found'
      using errcode = 'IVB01';
  end if;

  return query
  select
    product.id,
    product.serial_number,
    product.name,
    item.quantity,
    balance.quantity
  from public.work_order_items as item
  join public.products as product
    on product.id = item.product_id
  join public.inventory_balances as balance
    on balance.product_id = item.product_id
  where item.work_order_id = p_work_order_id
  order by item.added_at, item.id;
end;
$function$;

revoke all privileges
  on function public.list_draft_work_order_materials(uuid)
  from public, anon, authenticated;

grant execute
  on function public.list_draft_work_order_materials(uuid)
  to authenticated;
