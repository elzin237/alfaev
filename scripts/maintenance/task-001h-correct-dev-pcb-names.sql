begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create temporary table task_001h_pcb_name_map (
  pcb_card_id uuid primary key,
  product_id uuid not null unique,
  serial_number text not null unique,
  expected_card_name text not null,
  expected_product_name text not null,
  new_name text not null
) on commit drop;

insert into task_001h_pcb_name_map (
  pcb_card_id,
  product_id,
  serial_number,
  expected_card_name,
  expected_product_name,
  new_name
) values
  (
    'a5eea566-7363-4cd8-a39e-3226d152d460',
    '54b4255b-f182-4536-9d73-f53591cb0107',
    '4181345',
    'Concurrent BOM Card',
    'Concurrent BOM Product',
    'Concurrent BOM Card - Test 2'
  ),
  (
    '7f9b04c9-226e-45b0-ab2b-bfcca3aa77f5',
    '7cc24553-4200-4bae-83cb-076808012d83',
    '1450331',
    'History-lock Card',
    'History-lock Product',
    'History-lock Card - Test 2'
  ),
  (
    'c9b01975-7af5-4a47-b452-6a721f26a575',
    '7a4c80fa-dec2-4567-a023-27bfe5f6b17f',
    '7117065',
    'Save-race Card',
    'Save-race Product',
    'Save-race Card - Test 2'
  ),
  (
    '17d0fc01-89f5-4815-8832-4e3d2fe7f50f',
    'c8672aab-a7f2-45c0-a11d-ca875ccadedb',
    '0346915',
    'Version-lock Card',
    'Version-lock output',
    'Version-lock Card - Test 2'
  ),
  (
    '9581157e-ac14-4a8b-afe4-5259d7091d58',
    '82427337-6a73-465b-93bd-124234f2bac4',
    '0028803',
    'EK-503',
    'EK-503',
    'EK-503 (0028803)'
  );

do $task_001h$
declare
  approved_actor_profile_id constant uuid :=
    'edef95b5-7307-4bcf-aa3e-a85a074e1df7';
  approved_actor_auth_user_id constant uuid :=
    '25b6ab42-94ad-4a0e-9016-d9506986686d';
  preserved_ek_card_id constant uuid :=
    'c7fd4f63-64df-47df-a631-dc316d86fde8';
  preserved_ek_product_id constant uuid :=
    'b5cd48d1-fc6a-4759-b115-50713a793381';
  changed_at timestamptz := pg_catalog.clock_timestamp();
  maintenance_batch_id uuid := gen_random_uuid();
  history_before jsonb;
  history_after jsonb;
  existing_audit_count bigint;
  locked_count integer;
  updated_count integer;
begin
  if pg_catalog.to_regclass('public.pcb_cards_name_ci_key') is not null then
    raise exception 'Task 001H correction must run before migration 138'
      using errcode = '55000';
  end if;

  if (select pg_catalog.count(*) from task_001h_pcb_name_map) <> 5
    or exists (
      select 1
      from task_001h_pcb_name_map as mapping
      where mapping.new_name <> pg_catalog.btrim(mapping.new_name)
        or pg_catalog.length(mapping.new_name) = 0
    )
    or exists (
      select 1
      from task_001h_pcb_name_map as mapping
      group by pg_catalog.lower(mapping.new_name)
      having pg_catalog.count(*) > 1
    )
  then
    raise exception 'Task 001H mapping is invalid'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.user_profiles as profile
    join auth.users as auth_user
      on auth_user.id = profile.auth_user_id
    where profile.id = approved_actor_profile_id
      and profile.auth_user_id = approved_actor_auth_user_id
      and profile.is_active
      and profile.is_admin
  ) then
    raise exception 'Approved DEV Admin attribution is unavailable'
      using errcode = '42501';
  end if;

  -- Stable cross-table lock order: Products first, then PCB Cards; UUID order
  -- is stable inside each relation.
  perform product.id
  from public.products as product
  join task_001h_pcb_name_map as mapping
    on mapping.product_id = product.id
  order by product.id
  for update of product;
  get diagnostics locked_count = row_count;
  if locked_count <> 5 then
    raise exception 'Task 001H expected exactly five output Products'
      using errcode = 'P0002';
  end if;

  perform card.id
  from public.pcb_cards as card
  join task_001h_pcb_name_map as mapping
    on mapping.pcb_card_id = card.id
  order by card.id
  for update of card;
  get diagnostics locked_count = row_count;
  if locked_count <> 5 then
    raise exception 'Task 001H expected exactly five PCB Cards'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from task_001h_pcb_name_map as mapping
    left join public.pcb_cards as card
      on card.id = mapping.pcb_card_id
    left join public.products as product
      on product.id = mapping.product_id
    where card.id is null
      or product.id is null
      or card.output_product_id <> mapping.product_id
      or card.name <> mapping.expected_card_name
      or product.name <> mapping.expected_product_name
      or product.serial_number <> mapping.serial_number
      or product.product_kind <> 'pcb_finished_good'
      or product.category <> 'PCB'
      or not card.is_active
      or card.archived_at is not null
      or card.archived_by_user_id is not null
      or not product.is_active
      or product.archived_at is not null
      or product.archived_by_user_id is not null
  ) then
    raise exception 'Task 001H current identity or lifecycle assertion failed'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from task_001h_pcb_name_map as mapping
    join public.pcb_cards as other_card
      on pg_catalog.lower(other_card.name) = pg_catalog.lower(mapping.new_name)
     and other_card.id <> mapping.pcb_card_id
  ) or exists (
    select 1
    from task_001h_pcb_name_map as mapping
    join public.products as other_product
      on pg_catalog.lower(other_product.name) = pg_catalog.lower(mapping.new_name)
     and other_product.id <> mapping.product_id
  ) then
    raise exception 'Task 001H proposed name is already in use'
      using errcode = '23505';
  end if;

  if not exists (
    select 1
    from public.pcb_cards as card
    join public.products as product on product.id = card.output_product_id
    where card.id = preserved_ek_card_id
      and card.name = 'EK-503'
      and card.is_active
      and card.archived_at is null
      and product.id = preserved_ek_product_id
      and product.serial_number = '0027068'
      and product.name = 'EK-503'
      and product.is_active
      and product.archived_at is null
  ) then
    raise exception 'Task 001H preserved EK-503 assertion failed'
      using errcode = '55000';
  end if;

  select pg_catalog.jsonb_build_object(
    'bom_versions', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(version) order by version.id)
      from public.pcb_bom_versions as version
      join task_001h_pcb_name_map as mapping
        on mapping.pcb_card_id = version.pcb_card_id
    ), '[]'::jsonb),
    'bom_items', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(item) order by item.id)
      from public.pcb_bom_items as item
      join public.pcb_bom_versions as version
        on version.id = item.bom_version_id
      join task_001h_pcb_name_map as mapping
        on mapping.pcb_card_id = version.pcb_card_id
    ), '[]'::jsonb),
    'production_runs', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(run) order by run.id)
      from public.pcb_production_runs as run
      join task_001h_pcb_name_map as mapping
        on mapping.pcb_card_id = run.pcb_card_id
    ), '[]'::jsonb),
    'production_work_orders', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(context) order by context.work_order_id)
      from public.pcb_production_work_orders as context
      join task_001h_pcb_name_map as mapping
        on mapping.pcb_card_id = context.pcb_card_id
    ), '[]'::jsonb),
    'work_order_items', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(item) order by item.id)
      from public.work_order_items as item
      join task_001h_pcb_name_map as mapping
        on mapping.product_id = item.product_id
    ), '[]'::jsonb),
    'inventory_balances', coalesce((
      select pg_catalog.jsonb_agg(
        to_jsonb(balance)
        order by balance.product_id, to_jsonb(balance) ->> 'warehouse_id'
      )
      from public.inventory_balances as balance
      join task_001h_pcb_name_map as mapping
        on mapping.product_id = balance.product_id
    ), '[]'::jsonb),
    'inventory_movements', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(movement) order by movement.id)
      from public.inventory_movements as movement
      join task_001h_pcb_name_map as mapping
        on mapping.product_id = movement.product_id
    ), '[]'::jsonb),
    'source_lots', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(lot) order by lot.id)
      from public.inventory_source_lots as lot
      join task_001h_pcb_name_map as mapping
        on mapping.product_id = lot.product_id
    ), '[]'::jsonb),
    'allocations', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(allocation) order by allocation.id)
      from public.inventory_source_allocations as allocation
      join task_001h_pcb_name_map as mapping
        on mapping.product_id = allocation.product_id
    ), '[]'::jsonb)
  ) into history_before;

  create temporary table task_001h_existing_audits on commit drop as
  select audit.*
  from public.audit_logs as audit
  where audit.entity_id in (
    select mapping.product_id from task_001h_pcb_name_map as mapping
    union all
    select mapping.pcb_card_id from task_001h_pcb_name_map as mapping
  );

  select pg_catalog.count(*)
  into existing_audit_count
  from task_001h_existing_audits;

  update public.products as product
  set name = mapping.new_name,
      updated_at = changed_at,
      updated_by_user_id = approved_actor_profile_id
  from task_001h_pcb_name_map as mapping
  where product.id = mapping.product_id;
  get diagnostics updated_count = row_count;
  if updated_count <> 5 then
    raise exception 'Task 001H did not update exactly five Products'
      using errcode = '55000';
  end if;

  update public.pcb_cards as card
  set name = mapping.new_name,
      updated_at = changed_at,
      updated_by_user_id = approved_actor_profile_id
  from task_001h_pcb_name_map as mapping
  where card.id = mapping.pcb_card_id;
  get diagnostics updated_count = row_count;
  if updated_count <> 5 then
    raise exception 'Task 001H did not update exactly five PCB Cards'
      using errcode = '55000';
  end if;

  insert into public.audit_logs (
    actor_user_id,
    action_type,
    entity_type,
    entity_id,
    summary,
    before_data,
    after_data,
    metadata,
    created_at
  )
  select
    approved_actor_profile_id,
    'product.updated',
    'product',
    mapping.product_id,
    'Authorized DEV data maintenance: corrected Product ' ||
      mapping.serial_number || ' name from ' || mapping.expected_product_name ||
      ' to ' || mapping.new_name,
    pg_catalog.jsonb_build_object(
      'serial_number', mapping.serial_number,
      'name', mapping.expected_product_name,
      'product_kind', 'pcb_finished_good',
      'is_active', true
    ),
    pg_catalog.jsonb_build_object(
      'serial_number', mapping.serial_number,
      'name', mapping.new_name,
      'product_kind', 'pcb_finished_good',
      'is_active', true
    ),
    pg_catalog.jsonb_build_object(
      'maintenance_task', 'TASK 001H',
      'maintenance_batch_id', maintenance_batch_id,
      'pcb_card_id', mapping.pcb_card_id
    ),
    changed_at
  from task_001h_pcb_name_map as mapping
  order by mapping.product_id;
  get diagnostics updated_count = row_count;
  if updated_count <> 5 then
    raise exception 'Task 001H did not append exactly five Product audits'
      using errcode = '55000';
  end if;

  insert into public.audit_logs (
    actor_user_id,
    action_type,
    entity_type,
    entity_id,
    summary,
    before_data,
    after_data,
    metadata,
    created_at
  )
  select
    approved_actor_profile_id,
    'pcb_card.updated',
    'pcb_card',
    mapping.pcb_card_id,
    'Authorized DEV data maintenance: corrected Finished Product Calculator ' ||
      'name from ' || mapping.expected_card_name || ' to ' || mapping.new_name,
    pg_catalog.jsonb_build_object(
      'pcb_card_id', mapping.pcb_card_id,
      'name', mapping.expected_card_name,
      'output_product_id', mapping.product_id,
      'serial_number', mapping.serial_number,
      'is_active', true
    ),
    pg_catalog.jsonb_build_object(
      'pcb_card_id', mapping.pcb_card_id,
      'name', mapping.new_name,
      'output_product_id', mapping.product_id,
      'serial_number', mapping.serial_number,
      'is_active', true
    ),
    pg_catalog.jsonb_build_object(
      'maintenance_task', 'TASK 001H',
      'maintenance_batch_id', maintenance_batch_id,
      'output_product_id', mapping.product_id
    ),
    changed_at
  from task_001h_pcb_name_map as mapping
  order by mapping.pcb_card_id;
  get diagnostics updated_count = row_count;
  if updated_count <> 5 then
    raise exception 'Task 001H did not append exactly five PCB Card audits'
      using errcode = '55000';
  end if;

  select pg_catalog.jsonb_build_object(
    'bom_versions', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(version) order by version.id)
      from public.pcb_bom_versions as version
      join task_001h_pcb_name_map as mapping
        on mapping.pcb_card_id = version.pcb_card_id
    ), '[]'::jsonb),
    'bom_items', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(item) order by item.id)
      from public.pcb_bom_items as item
      join public.pcb_bom_versions as version
        on version.id = item.bom_version_id
      join task_001h_pcb_name_map as mapping
        on mapping.pcb_card_id = version.pcb_card_id
    ), '[]'::jsonb),
    'production_runs', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(run) order by run.id)
      from public.pcb_production_runs as run
      join task_001h_pcb_name_map as mapping
        on mapping.pcb_card_id = run.pcb_card_id
    ), '[]'::jsonb),
    'production_work_orders', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(context) order by context.work_order_id)
      from public.pcb_production_work_orders as context
      join task_001h_pcb_name_map as mapping
        on mapping.pcb_card_id = context.pcb_card_id
    ), '[]'::jsonb),
    'work_order_items', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(item) order by item.id)
      from public.work_order_items as item
      join task_001h_pcb_name_map as mapping
        on mapping.product_id = item.product_id
    ), '[]'::jsonb),
    'inventory_balances', coalesce((
      select pg_catalog.jsonb_agg(
        to_jsonb(balance)
        order by balance.product_id, to_jsonb(balance) ->> 'warehouse_id'
      )
      from public.inventory_balances as balance
      join task_001h_pcb_name_map as mapping
        on mapping.product_id = balance.product_id
    ), '[]'::jsonb),
    'inventory_movements', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(movement) order by movement.id)
      from public.inventory_movements as movement
      join task_001h_pcb_name_map as mapping
        on mapping.product_id = movement.product_id
    ), '[]'::jsonb),
    'source_lots', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(lot) order by lot.id)
      from public.inventory_source_lots as lot
      join task_001h_pcb_name_map as mapping
        on mapping.product_id = lot.product_id
    ), '[]'::jsonb),
    'allocations', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(allocation) order by allocation.id)
      from public.inventory_source_allocations as allocation
      join task_001h_pcb_name_map as mapping
        on mapping.product_id = allocation.product_id
    ), '[]'::jsonb)
  ) into history_after;

  if history_after is distinct from history_before then
    raise exception 'Task 001H changed protected historical relationships'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from task_001h_existing_audits as existing
    left join public.audit_logs as current_audit on current_audit.id = existing.id
    where current_audit.id is null
      or to_jsonb(current_audit) is distinct from to_jsonb(existing)
  ) then
    raise exception 'Task 001H changed an existing AuditLog row'
      using errcode = '55000';
  end if;

  if (
    select pg_catalog.count(*)
    from public.audit_logs as audit
    where audit.entity_id in (
      select mapping.product_id from task_001h_pcb_name_map as mapping
      union all
      select mapping.pcb_card_id from task_001h_pcb_name_map as mapping
    )
  ) <> existing_audit_count + 10
  or (
    select pg_catalog.count(*)
    from public.audit_logs as audit
    where audit.metadata ->> 'maintenance_batch_id' = maintenance_batch_id::text
  ) <> 10
  then
    raise exception 'Task 001H audit count assertion failed'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from task_001h_pcb_name_map as mapping
    join public.products as product on product.id = mapping.product_id
    join public.pcb_cards as card on card.id = mapping.pcb_card_id
    where product.name <> mapping.new_name
      or card.name <> mapping.new_name
      or card.output_product_id <> product.id
      or product.serial_number <> mapping.serial_number
      or product.updated_at <> changed_at
      or product.updated_by_user_id <> approved_actor_profile_id
      or card.updated_at <> changed_at
      or card.updated_by_user_id <> approved_actor_profile_id
  ) then
    raise exception 'Task 001H final synchronized state assertion failed'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.pcb_cards as card
    group by pg_catalog.lower(card.name)
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'Task 001H left normalized PCB Card name duplicates'
      using errcode = '23505';
  end if;

  if not exists (
    select 1
    from public.pcb_cards as card
    join public.products as product on product.id = card.output_product_id
    where card.id = preserved_ek_card_id
      and card.name = 'EK-503'
      and product.id = preserved_ek_product_id
      and product.serial_number = '0027068'
      and product.name = 'EK-503'
  ) then
    raise exception 'Task 001H changed the preserved EK-503'
      using errcode = '55000';
  end if;
end;
$task_001h$;

commit;
