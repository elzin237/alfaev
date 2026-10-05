-- Frozen, one-to-one PCB production planning context for a Draft Work Order.
-- Existing historical production runs remain valid with a null work_order_id.
create table public.pcb_production_work_orders (
  work_order_id uuid primary key,
  pcb_card_id uuid not null,
  bom_version_id uuid not null,
  planned_quantity bigint not null,
  creation_request_id uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  created_by_user_id uuid not null,
  constraint pcb_production_work_orders_work_order_id_fkey
    foreign key (work_order_id)
    references public.work_orders(id)
    on delete restrict,
  constraint pcb_production_work_orders_card_bom_version_fkey
    foreign key (pcb_card_id, bom_version_id)
    references public.pcb_bom_versions(pcb_card_id, id)
    on delete restrict,
  constraint pcb_production_work_orders_created_by_user_id_fkey
    foreign key (created_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint pcb_production_work_orders_planned_quantity_positive
    check (planned_quantity > 0),
  constraint pcb_production_work_orders_creation_request_id_key
    unique (creation_request_id)
);

create index pcb_production_work_orders_pcb_card_id_idx
  on public.pcb_production_work_orders (pcb_card_id);

create index pcb_production_work_orders_bom_version_id_idx
  on public.pcb_production_work_orders (bom_version_id);

alter table public.pcb_production_work_orders enable row level security;

revoke all privileges
  on table public.pcb_production_work_orders
  from public, anon, authenticated;

-- A production context is immutable while it exists. Deletion is allowed only
-- while the parent remains a Draft so the canonical Draft deletion transaction
-- can abandon the batch without creating production or Inventory history.
create function public.enforce_pcb_production_work_order_context_lifecycle()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  parent_status text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'PCB production Work Order context is immutable'
      using errcode = 'PCB11';
  end if;

  select work_order.status
  into parent_status
  from public.work_orders as work_order
  where work_order.id = old.work_order_id
  for key share;

  if not found or parent_status <> 'draft' then
    raise exception 'Finished PCB production context cannot be deleted'
      using errcode = 'PCB11';
  end if;

  return old;
end;
$function$;

revoke all privileges
  on function public.enforce_pcb_production_work_order_context_lifecycle()
  from public, anon, authenticated;

create trigger pcb_production_work_orders_enforce_lifecycle
before update or delete on public.pcb_production_work_orders
for each row
execute function public.enforce_pcb_production_work_order_context_lifecycle();

-- Once its production context exists, the derived WorkOrderItem snapshot can
-- neither be edited nor replaced through generic or privileged Draft paths.
create function public.enforce_pcb_production_work_order_material_immutability()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  old_work_order_id uuid;
  new_work_order_id uuid;
begin
  if tg_op <> 'INSERT' then
    old_work_order_id := old.work_order_id;
  end if;
  if tg_op <> 'DELETE' then
    new_work_order_id := new.work_order_id;
  end if;

  if exists (
    select 1
    from public.pcb_production_work_orders as production
    where production.work_order_id in (old_work_order_id, new_work_order_id)
  ) then
    raise exception 'PCB production Work Order materials are immutable'
      using errcode = 'PCB12';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all privileges
  on function public.enforce_pcb_production_work_order_material_immutability()
  from public, anon, authenticated;

create trigger work_order_items_enforce_pcb_production_snapshot
before insert or update or delete on public.work_order_items
for each row
execute function public.enforce_pcb_production_work_order_material_immutability();

-- Project, Customer, Description, PCB Card, BOM version, and planned quantity
-- form one frozen production plan. Finish may change lifecycle metadata only.
create function public.enforce_pcb_production_work_order_header_immutability()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from public.pcb_production_work_orders as production
    where production.work_order_id = old.id
  ) and (
    new.project_id is distinct from old.project_id
    or new.customer_name_snapshot is distinct from old.customer_name_snapshot
    or new.description is distinct from old.description
  ) then
    raise exception 'PCB production Work Order plan is immutable'
      using errcode = 'PCB11';
  end if;

  return new;
end;
$function$;

revoke all privileges
  on function public.enforce_pcb_production_work_order_header_immutability()
  from public, anon, authenticated;

create trigger work_orders_enforce_pcb_production_plan
before update on public.work_orders
for each row
execute function public.enforce_pcb_production_work_order_header_immutability();

-- The former CHECK could not express the narrow cross-table exception. Keep
-- ordinary Finished completeness and allow only linked PCB production rows to
-- Finish without Project/Customer or material rows.
alter table public.work_orders
  drop constraint work_orders_finished_content_complete;

create function public.enforce_work_order_finished_content()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if new.status = 'finished'
    and not exists (
      select 1
      from public.pcb_production_work_orders as production
      where production.work_order_id = new.id
    )
    and (
      new.project_id is null
      or new.customer_name_snapshot is null
      or new.description is null
    )
  then
    raise exception 'Finished Work Order content is incomplete'
      using errcode = 'WOR07';
  end if;

  if new.status = 'finished'
    and new.description is null
  then
    raise exception 'Finished Work Order content is incomplete'
      using errcode = 'WOR07';
  end if;

  return new;
end;
$function$;

revoke all privileges
  on function public.enforce_work_order_finished_content()
  from public, anon, authenticated;

create trigger work_orders_enforce_finished_content
before insert or update on public.work_orders
for each row
execute function public.enforce_work_order_finished_content();

alter table public.pcb_production_runs
  add column work_order_id uuid,
  add constraint pcb_production_runs_work_order_id_fkey
    foreign key (work_order_id)
    references public.work_orders(id)
    on delete restrict,
  drop constraint pcb_production_runs_quantity_positive,
  add constraint pcb_production_runs_quantity_nonnegative
    check (quantity_produced >= 0);

create unique index pcb_production_runs_work_order_id_key
  on public.pcb_production_runs (work_order_id)
  where work_order_id is not null;

-- Each completed production run can post at most one positive PCB output row.
-- Input rows remain unrestricted across distinct Products.
create unique index inventory_movements_pcb_production_output_run_key
  on public.inventory_movements (source_id)
  where movement_type = 'pcb_production_output'
    and source_type = 'pcb_production_output'
    and source_id is not null;

-- Draft deletion explicitly removes the production context before the generated
-- item snapshot, then preserves the established Work Order deletion behavior.
create or replace function public.delete_draft_work_order(
  p_work_order_id uuid,
  p_expected_updated_at timestamptz
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
  actor_profile_id uuid;
  before_materials jsonb;
  current_work_order public.work_orders%rowtype;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.delete_draft')
    )
  then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if p_work_order_id is null then
    raise exception 'Work Order ID is required' using errcode = '22023';
  end if;
  if p_expected_updated_at is null then
    raise exception 'Expected Work Order update timestamp is required'
      using errcode = '22023';
  end if;

  actor_profile_id := public.current_active_user_profile_id();
  if actor_profile_id is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select work_order.*
  into current_work_order
  from public.work_orders as work_order
  where work_order.id = p_work_order_id
  for update;

  if not found then
    raise exception 'Work Order not found' using errcode = 'P0002';
  end if;

  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.delete_draft')
    )
    or public.current_active_user_profile_id() is distinct from actor_profile_id
  then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if current_work_order.status <> 'draft' then
    raise exception 'Finished Work Orders cannot be deleted'
      using errcode = 'WOR02';
  end if;
  if current_work_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'Work Order Draft has changed. Reload and try again.'
      using errcode = 'WOR05';
  end if;

  if current_work_order.project_id is not null then
    perform project.id
    from public.projects as project
    where project.id = current_work_order.project_id
    for update;
    if not found then
      raise exception 'Project not found' using errcode = 'P0002';
    end if;

    if auth.uid() is null
      or not (
        public.current_user_is_admin()
        or public.has_permission('work_orders.delete_draft')
      )
      or public.current_active_user_profile_id() is distinct from actor_profile_id
    then
      raise exception 'Access denied' using errcode = '42501';
    end if;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'product_id', item.product_id,
        'quantity', item.quantity
      ) order by item.product_id
    ),
    '[]'::jsonb
  )
  into before_materials
  from public.work_order_items as item
  where item.work_order_id = current_work_order.id;

  delete from public.pcb_production_work_orders as production
  where production.work_order_id = current_work_order.id;

  delete from public.work_order_items as item
  where item.work_order_id = current_work_order.id;

  delete from public.work_orders as work_order
  where work_order.id = current_work_order.id;

  perform public.append_audit_log(
    p_action_type => 'work_order.deleted',
    p_entity_type => 'work_order',
    p_summary => 'Deleted Work Order ' || current_work_order.work_order_number,
    p_entity_id => current_work_order.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'work_order_id', current_work_order.id,
      'work_order_number', current_work_order.work_order_number,
      'status', current_work_order.status,
      'project_id', current_work_order.project_id,
      'customer_name_snapshot', current_work_order.customer_name_snapshot,
      'description', current_work_order.description,
      'materials', before_materials
    ),
    p_after_data => null
  );

  return query
  select current_work_order.id, current_work_order.work_order_number;
end;
$function$;

revoke all privileges
  on function public.delete_draft_work_order(uuid, timestamptz)
  from public, anon, authenticated;

grant execute
  on function public.delete_draft_work_order(uuid, timestamptz)
  to authenticated;

-- Generic Draft persistence may neither edit a frozen PCB production plan nor
-- count its traceability-only material snapshot as Project commitment.
create or replace function public.save_draft_work_order(
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
  allocation_record record;
  before_materials jsonb;
  changed_at timestamptz;
  current_work_order public.work_orders%rowtype;
  desired_item jsonb;
  desired_product_id uuid;
  header_changed boolean;
  item_key_count bigint;
  locked_project_id uuid;
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

  if exists (
    select 1
    from public.pcb_production_work_orders as production
    where production.work_order_id = current_work_order.id
  ) then
    raise exception 'PCB production Work Order plan is immutable'
      using errcode = 'PCB11';
  end if;

  -- Every allocation change for a Project synchronizes on that Project row.
  -- A Project switch locks both the old and new Projects in UUID order so the
  -- release from the old Project and acquisition against the new Project cannot
  -- race another Draft save or invert lock order.
  for locked_project_id in
    select project.id
    from public.projects as project
    where project.id in (current_work_order.project_id, p_project_id)
    order by project.id
    for update
  loop
    null;
  end loop;

  -- Authorization can also change while the caller waits for Project locks.
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

  if p_project_id is null then
    trusted_customer_name := null;
  else
    select project.*
    into selected_project
    from public.projects as project
    where project.id = p_project_id;

    if not found then
      raise exception 'Project not found'
        using errcode = 'P0002';
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

  -- A retained historical Project remains valid for unchanged material history
  -- and header/customer refreshes, but it has no open planned requirement against
  -- which a changed material allocation can be made.
  if p_project_id is not null
    and selected_project.status not in ('planned', 'in_progress', 'on_hold')
    and materials_changed
  then
    raise exception 'Draft materials exceed the remaining Project requirement'
      using errcode = 'WOR06';
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

  -- Draft allocation is planning-only. The current Draft is excluded because its
  -- complete desired state replaces its own existing rows. Finished Work Orders
  -- and Work Orders belonging to another Project are excluded from the derived
  -- other-Draft allocation. All arithmetic remains exact numeric/bigint SQL.
  if p_project_id is not null
    and selected_project.status in ('planned', 'in_progress', 'on_hold')
  then
    for allocation_record in
      with desired as (
        select
          (item.value ->> 'product_id')::uuid as product_id,
          (item.value ->> 'quantity')::bigint as quantity
        from pg_catalog.jsonb_array_elements(p_items) as item(value)
      )
      select
        desired.product_id,
        desired.quantity,
        coalesce(commitment.outstanding_commitment, 0::numeric)
          as outstanding_commitment,
        coalesce((
          select pg_catalog.sum(other_item.quantity::numeric)
          from public.work_orders as other_work_order
          join public.work_order_items as other_item
            on other_item.work_order_id = other_work_order.id
          where other_work_order.project_id = p_project_id
            and other_work_order.status = 'draft'
            and other_work_order.id <> current_work_order.id
            and other_item.product_id = desired.product_id
            and not exists (
              select 1
              from public.pcb_production_work_orders as production
              where production.work_order_id = other_work_order.id
            )
        ), 0::numeric) as other_draft_allocation
      from desired
      left join public.calculate_open_project_commitments(desired.product_id)
        as commitment
        on commitment.project_id = p_project_id
       and commitment.product_id = desired.product_id
      order by desired.product_id
    loop
      if allocation_record.quantity::numeric > greatest(
        allocation_record.outstanding_commitment
          - allocation_record.other_draft_allocation,
        0::numeric
      ) then
        raise exception 'Draft materials exceed the remaining Project requirement'
          using errcode = 'WOR06';
      end if;
    end loop;
  end if;

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
