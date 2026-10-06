-- Work Order material origin is authoritative. Existing ordinary and historical
-- rows remain manual; the previously frozen PCB-production snapshots are
-- backfilled to pcb_bom before the narrower lifecycle trigger is installed.
alter table public.work_order_items
  add column source_type text not null default 'manual';

alter table public.work_order_items
  add constraint work_order_items_source_type_valid
    check (source_type in ('manual', 'pcb_bom'));

drop trigger work_order_items_enforce_pcb_production_snapshot
  on public.work_order_items;

-- The existing parent-Draft trigger correctly protects finished history from
-- runtime UPDATEs. Disable only that exact trigger for this transactional,
-- deterministic origin backfill, then restore it immediately.
alter table public.work_order_items
  disable trigger work_order_items_enforce_parent_draft;

update public.work_order_items as item
set source_type = 'pcb_bom'
where exists (
  select 1
  from public.pcb_production_work_orders as production
  where production.work_order_id = item.work_order_id
);

alter table public.work_order_items
  enable trigger work_order_items_enforce_parent_draft;

alter table public.work_order_items
  drop constraint work_order_items_work_order_product_key,
  add constraint work_order_items_work_order_product_source_key
    unique (work_order_id, product_id, source_type);

comment on column public.work_order_items.source_type is
  'Authoritative material origin: manual or frozen pcb_bom snapshot.';

-- Manual rows on a PCB-production Draft remain editable through the dedicated
-- trusted RPC. Frozen BOM rows never become mutable. The one manual -> pcb_bom
-- transition is allowed only as the nested effect of the context-insert trigger
-- and only when the row exactly matches the frozen BOM calculation.
create or replace function public.enforce_pcb_production_work_order_material_immutability()
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

  if tg_op = 'INSERT' and new.source_type = 'pcb_bom' then
    raise exception 'Frozen PCB BOM materials can be created only by PCB production setup'
      using errcode = 'PCB12';
  end if;

  if tg_op = 'UPDATE' then
    if old.source_type = 'pcb_bom' then
      raise exception 'Frozen PCB BOM materials are immutable'
        using errcode = 'PCB12';
    end if;

    if new.source_type is distinct from old.source_type then
      if old.source_type = 'manual'
        and new.source_type = 'pcb_bom'
        and pg_catalog.pg_trigger_depth() > 1
        and exists (
          select 1
          from public.pcb_production_work_orders as production
          join public.pcb_bom_items as bom_item
            on bom_item.bom_version_id = production.bom_version_id
           and bom_item.component_product_id = new.product_id
          where production.work_order_id = new.work_order_id
            and new.quantity::numeric =
              bom_item.quantity_per_card::numeric
              * production.planned_quantity::numeric
        )
      then
        return new;
      end if;

      raise exception 'Work Order material origin is immutable'
        using errcode = 'PCB12';
    end if;

    if old.work_order_id is distinct from new.work_order_id
      and exists (
        select 1
        from public.pcb_production_work_orders as production
        where production.work_order_id in (
          old.work_order_id,
          new.work_order_id
        )
      )
    then
      raise exception 'PCB production supplemental materials cannot move between Work Orders'
        using errcode = 'PCB12';
    end if;
  end if;

  if tg_op = 'DELETE'
    and old.source_type = 'pcb_bom'
    and exists (
      select 1
      from public.pcb_production_work_orders as production
      where production.work_order_id = old.work_order_id
    )
  then
    raise exception 'Frozen PCB BOM materials are immutable'
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

-- The existing creation RPC inserts the exact BOM items and then the immutable
-- production context. This trigger atomically marks that just-created snapshot
-- as pcb_bom after verifying that every row is exactly BOM-derived.
create function public.mark_pcb_production_work_order_bom_materials()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from public.work_order_items as item
    left join public.pcb_bom_items as bom_item
      on bom_item.bom_version_id = new.bom_version_id
     and bom_item.component_product_id = item.product_id
    where item.work_order_id = new.work_order_id
      and (
        bom_item.id is null
        or item.source_type <> 'manual'
        or item.quantity::numeric <>
          bom_item.quantity_per_card::numeric * new.planned_quantity::numeric
      )
  ) or (
    select pg_catalog.count(*)
    from public.work_order_items as item
    where item.work_order_id = new.work_order_id
  ) <> (
    select pg_catalog.count(*)
    from public.pcb_bom_items as bom_item
    where bom_item.bom_version_id = new.bom_version_id
  ) then
    raise exception 'PCB production BOM material snapshot is invalid'
      using errcode = 'PCB12';
  end if;

  update public.work_order_items as item
  set source_type = 'pcb_bom'
  where item.work_order_id = new.work_order_id;

  return new;
end;
$function$;

revoke all privileges
  on function public.mark_pcb_production_work_order_bom_materials()
  from public, anon, authenticated;

create trigger pcb_production_work_orders_mark_bom_materials
after insert on public.pcb_production_work_orders
for each row
execute function public.mark_pcb_production_work_order_bom_materials();

-- Narrow complete-set replacement for only the manual supplemental rows of one
-- PCB-production Draft. Header fields and frozen pcb_bom rows are never inputs.
create function public.save_pcb_production_supplemental_materials(
  p_work_order_id uuid,
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
  item_key_count bigint;
  product_record public.products%rowtype;
  quantity_text text;
begin
  if auth.uid() is null or not (
    public.current_user_is_admin()
    or public.has_permission('work_orders.edit_draft')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if p_work_order_id is null then
    raise exception 'Work Order ID is required' using errcode = '22023';
  end if;
  if p_expected_updated_at is null then
    raise exception 'Expected Work Order update timestamp is required'
      using errcode = '22023';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'Supplemental materials must be a JSON array'
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

  if auth.uid() is null or not (
    public.current_user_is_admin()
    or public.has_permission('work_orders.edit_draft')
  ) or public.current_active_user_profile_id() is distinct from actor_profile_id then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if current_work_order.status <> 'draft' then
    raise exception 'Finished Work Orders cannot be modified'
      using errcode = 'WOR02';
  end if;
  if current_work_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'Work Order Draft has changed. Reload and try again.'
      using errcode = 'WOR05';
  end if;
  if not exists (
    select 1
    from public.pcb_production_work_orders as production
    where production.work_order_id = current_work_order.id
  ) then
    raise exception 'PCB production Work Order context not found'
      using errcode = 'PCB11';
  end if;

  for desired_item in
    select item.value
    from pg_catalog.jsonb_array_elements(p_items) as item(value)
  loop
    if pg_catalog.jsonb_typeof(desired_item) <> 'object' then
      raise exception 'Each supplemental material must be an object'
        using errcode = '22023';
    end if;

    select pg_catalog.count(*)
    into item_key_count
    from pg_catalog.jsonb_object_keys(desired_item) as item_key(key);
    if item_key_count <> 2
      or not (desired_item ? 'product_id')
      or not (desired_item ? 'quantity')
    then
      raise exception 'Each supplemental material must contain only product_id and quantity'
        using errcode = '22023';
    end if;

    begin
      perform (desired_item->>'product_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Supplemental material Product ID is invalid'
          using errcode = '22023';
    end;

    if pg_catalog.jsonb_typeof(desired_item->'quantity') <> 'string' then
      raise exception 'Supplemental material Quantity must be a decimal string'
        using errcode = '22023';
    end if;
    quantity_text := desired_item->>'quantity';
    if quantity_text !~ '^[0-9]+$'
      or quantity_text ~ '^0+$'
      or pg_catalog.length(pg_catalog.ltrim(quantity_text, '0')) > 19
      or (
        pg_catalog.length(pg_catalog.ltrim(quantity_text, '0')) = 19
        and pg_catalog.ltrim(quantity_text, '0') > '9223372036854775807'
      )
    then
      raise exception 'Supplemental material Quantity is invalid'
        using errcode = '22023';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) as item(value)
    group by item.value->>'product_id'
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'Duplicate supplemental material Product IDs are not allowed'
      using errcode = '22023';
  end if;

  -- Product locks are stable and remain held through the complete replacement,
  -- preventing a submitted supplemental Product from being archived mid-save.
  for product_record in
    select product.*
    from public.products as product
    where product.id in (
      select (item.value->>'product_id')::uuid
      from pg_catalog.jsonb_array_elements(p_items) as item(value)
    )
    order by product.id
    for share
  loop
    if not product_record.is_active
      or product_record.product_kind not in ('component', 'pcb_finished_good')
    then
      raise exception 'Product is unavailable for Work Order'
        using errcode = 'PRD05';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) as item(value)
    left join public.products as product
      on product.id = (item.value->>'product_id')::uuid
    where product.id is null
  ) then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  if auth.uid() is null or not (
    public.current_user_is_admin()
    or public.has_permission('work_orders.edit_draft')
  ) or public.current_active_user_profile_id() is distinct from actor_profile_id then
    raise exception 'Access denied' using errcode = '42501';
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
  where item.work_order_id = current_work_order.id
    and item.source_type = 'manual';

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'product_id', (item.value->>'product_id')::uuid,
        'quantity', (pg_catalog.ltrim(item.value->>'quantity', '0'))::bigint
      ) order by (item.value->>'product_id')::uuid
    ),
    '[]'::jsonb
  )
  into after_materials
  from pg_catalog.jsonb_array_elements(p_items) as item(value);

  if before_materials = after_materials then
    return query
    select current_work_order.id, current_work_order.updated_at;
    return;
  end if;

  delete from public.work_order_items as existing
  where existing.work_order_id = current_work_order.id
    and existing.source_type = 'manual'
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_items) as desired(value)
      where (desired.value->>'product_id')::uuid = existing.product_id
    );

  update public.work_order_items as existing
  set quantity = (pg_catalog.ltrim(desired.value->>'quantity', '0'))::bigint
  from pg_catalog.jsonb_array_elements(p_items) as desired(value)
  where existing.work_order_id = current_work_order.id
    and existing.source_type = 'manual'
    and existing.product_id = (desired.value->>'product_id')::uuid
    and existing.quantity is distinct from
      (pg_catalog.ltrim(desired.value->>'quantity', '0'))::bigint;

  insert into public.work_order_items (
    work_order_id,
    product_id,
    quantity,
    source_type,
    added_by_user_id
  )
  select
    current_work_order.id,
    (desired.value->>'product_id')::uuid,
    (pg_catalog.ltrim(desired.value->>'quantity', '0'))::bigint,
    'manual',
    actor_profile_id
  from pg_catalog.jsonb_array_elements(p_items) as desired(value)
  left join public.work_order_items as existing
    on existing.work_order_id = current_work_order.id
   and existing.product_id = (desired.value->>'product_id')::uuid
   and existing.source_type = 'manual'
  where existing.id is null;

  changed_at := pg_catalog.clock_timestamp();
  update public.work_orders as work_order
  set updated_at = changed_at,
      updated_by_user_id = actor_profile_id
  where work_order.id = current_work_order.id;

  perform public.append_audit_log(
    p_action_type => 'work_order.updated',
    p_entity_type => 'work_order',
    p_summary => 'Updated supplemental materials for Work Order '
      || current_work_order.work_order_number,
    p_entity_id => current_work_order.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'supplemental_materials', before_materials,
      'updated_at', current_work_order.updated_at
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'supplemental_materials', after_materials,
      'updated_at', changed_at
    )
  );

  return query
  select current_work_order.id, changed_at;
end;
$function$;

revoke all privileges
  on function public.save_pcb_production_supplemental_materials(uuid, jsonb, timestamptz)
  from public, anon, authenticated;

grant execute
  on function public.save_pcb_production_supplemental_materials(uuid, jsonb, timestamptz)
  to authenticated;

-- Origin-aware Draft projection used by the editor. The legacy read remains
-- available for compatibility, while new clients can distinguish frozen and
-- supplemental rows without broader Product or Inventory access.
create function public.list_draft_work_order_materials_with_origin(
  p_work_order_id uuid
)
returns table (
  product_id uuid,
  serial_number text,
  product_name text,
  quantity bigint,
  source_type text,
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
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if p_work_order_id is null then
    raise exception 'Work Order ID is required' using errcode = '22023';
  end if;

  select work_order.status
  into current_work_order_status
  from public.work_orders as work_order
  where work_order.id = p_work_order_id;

  if not found then
    raise exception 'Work Order not found' using errcode = 'P0002';
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
    raise exception 'Inventory balance not found' using errcode = 'IVB01';
  end if;

  return query
  select
    product.id,
    product.serial_number,
    product.name,
    item.quantity,
    item.source_type,
    balance.quantity
  from public.work_order_items as item
  join public.products as product
    on product.id = item.product_id
  join public.inventory_balances as balance
    on balance.product_id = item.product_id
  where item.work_order_id = p_work_order_id
  order by
    case item.source_type when 'pcb_bom' then 0 else 1 end,
    item.added_at,
    item.id;
end;
$function$;

revoke all privileges
  on function public.list_draft_work_order_materials_with_origin(uuid)
  from public, anon, authenticated;

grant execute
  on function public.list_draft_work_order_materials_with_origin(uuid)
  to authenticated;

-- Finish validates physical stock against the combined quantity for each input
-- Product. Frozen and supplemental rows remain separate history, but a shared
-- Product is locked and checked once using their exact sum.
create or replace function public.preflight_finish_pcb_production_work_order(
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
  product_record record;
  required_balance_count bigint;
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

  if exists (
    select 1
    from (
      select item.product_id, pg_catalog.sum(item.quantity::numeric) as required
      from public.work_order_items as item
      where item.work_order_id = current_work_order.id
      group by item.product_id
    ) as combined
    where combined.required > 9223372036854775807::numeric
  ) then
    raise exception 'Combined Work Order material quantity is invalid'
      using errcode = '22023';
  end if;

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

  if not exists (
    select 1
    from public.products as product
    where product.id = card_record.output_product_id
  ) or exists (
    select 1
    from public.work_order_items as item
    left join public.products as product
      on product.id = item.product_id
    where item.work_order_id = current_work_order.id
      and product.id is null
  ) then
    raise exception 'Product is unavailable for Work Order'
      using errcode = 'PRD05';
  end if;

  select pg_catalog.count(*)
  into required_balance_count
  from (
    select card_record.output_product_id as product_id
    union
    select item.product_id
    from public.work_order_items as item
    where item.work_order_id = current_work_order.id
  ) as required_product;

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
    on balance.product_id = combined.product_id;

  if exists (
    select 1
    from public.inventory_balances as balance
    where balance.product_id = card_record.output_product_id
      and balance.quantity::numeric
        - coalesce((
          select pg_catalog.sum(item.quantity::numeric)
          from public.work_order_items as item
          where item.work_order_id = current_work_order.id
            and item.product_id = card_record.output_product_id
        ), 0::numeric)
        + actual_good_value::numeric
        > 9223372036854775807::numeric
  ) then
    raise exception 'PCB output quantity exceeds Inventory capacity'
      using errcode = '22023';
  end if;

  return query
  with combined_materials as (
    select
      item.product_id,
      pg_catalog.sum(item.quantity::numeric)::bigint as required_quantity
    from public.work_order_items as item
    where item.work_order_id = current_work_order.id
    group by item.product_id
  )
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
    combined.product_id,
    input_product.serial_number,
    input_product.name,
    combined.required_quantity,
    input_balance.quantity,
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
  where output_product.id = card_record.output_product_id
  order by input_product.serial_number nulls first, combined.product_id;
end;
$function$;

revoke all privileges
  on function public.preflight_finish_pcb_production_work_order(uuid, timestamptz, text)
  from public, anon, authenticated;

grant execute
  on function public.preflight_finish_pcb_production_work_order(uuid, timestamptz, text)
  to authenticated;

-- The canonical PDF receives one deterministic line per consumed Product. When
-- both origins use the same Product, its exact combined quantity appears once.
create or replace function public.get_work_order_pdf_snapshot(
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
        order by preflight.serial_number, preflight.product_id
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
  order by preflight.serial_number nulls first, preflight.product_id nulls first;
end;
$function$;

revoke all privileges
  on function public.get_work_order_pdf_snapshot(uuid, timestamptz, text)
  from public, anon, authenticated;

grant execute
  on function public.get_work_order_pdf_snapshot(uuid, timestamptz, text)
  to authenticated;

-- PCB Finish consumes every persisted input row. Rows sharing a Product are
-- aggregated into one canonical ledger movement so physical sufficiency and
-- deduction use the same exact combined quantity.
create or replace function public.finish_work_order(
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
  expected_input_movement_count bigint := 0;
  finish_timestamp timestamptz;
  input_movement_count bigint := 0;
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
    if validation_record.product_id is not null then
      expected_input_movement_count := expected_input_movement_count + 1;
    end if;
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
  end if;

  -- Zero successful output still consumes every frozen and supplemental input,
  -- records completed history, and creates no misleading zero-delta output row.
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
