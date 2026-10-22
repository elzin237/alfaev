-- Three-warehouse foundation. All pre-001C/001F operations remain explicitly
-- bound to Raw Materials; this migration does not enable multi-warehouse writes.

create temporary table inventory_warehouse_balance_snapshot on commit drop as
select product_id, quantity, updated_at from public.inventory_balances;

create temporary table inventory_warehouse_movement_snapshot on commit drop as
select id, product_id, movement_type, quantity_delta, quantity_before,
  quantity_after, reason, source_type, source_id, project_id, actor_user_id,
  created_at, reversal_of_movement_id
from public.inventory_movements;

create temporary table inventory_warehouse_lot_snapshot on commit drop as
select id, product_id, source_kind, product_supplier_id, supplier_id,
  supplier_name_snapshot, catalog_number_snapshot,
  supplier_description_snapshot, received_quantity, remaining_quantity,
  originating_inventory_movement_id, received_at, actor_user_id
from public.inventory_source_lots;

create temporary table inventory_warehouse_allocation_snapshot on commit drop as
select id, outbound_inventory_movement_id, source_lot_id, product_id,
  allocated_quantity, created_at
from public.inventory_source_allocations;

create table public.inventory_warehouses (
  id uuid primary key,
  code text not null unique,
  display_name text not null unique,
  bosnian_name text not null unique,
  sort_order smallint not null unique,
  constraint inventory_warehouses_canonical_identity
    check (
      (id = '10000000-0000-4000-8000-000000000001'::uuid
        and code = 'raw_materials'
        and display_name = 'Raw Materials'
        and bosnian_name = 'Skladište repromaterijala'
        and sort_order = 1)
      or
      (id = '10000000-0000-4000-8000-000000000002'::uuid
        and code = 'finished_goods'
        and display_name = 'Finished Goods'
        and bosnian_name = 'Skladište gotovih proizvoda'
        and sort_order = 2)
      or
      (id = '10000000-0000-4000-8000-000000000003'::uuid
        and code = 'customs'
        and display_name = 'Customs Warehouse'
        and bosnian_name = 'Carinsko skladište'
        and sort_order = 3)
    ),
  constraint inventory_warehouses_text_normalized
    check (
      code = pg_catalog.btrim(code)
      and display_name = pg_catalog.btrim(display_name)
      and bosnian_name = pg_catalog.btrim(bosnian_name)
      and pg_catalog.length(code) > 0
      and pg_catalog.length(display_name) > 0
      and pg_catalog.length(bosnian_name) > 0
    )
);

insert into public.inventory_warehouses (
  id, code, display_name, bosnian_name, sort_order
) values
  ('10000000-0000-4000-8000-000000000001', 'raw_materials',
    'Raw Materials', 'Skladište repromaterijala', 1),
  ('10000000-0000-4000-8000-000000000002', 'finished_goods',
    'Finished Goods', 'Skladište gotovih proizvoda', 2),
  ('10000000-0000-4000-8000-000000000003', 'customs',
    'Customs Warehouse', 'Carinsko skladište', 3);

create function public.prevent_inventory_warehouse_mutation()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  raise exception 'Canonical Inventory warehouses are immutable'
    using errcode = '55000';
  return old;
end;
$function$;

revoke all privileges on function public.prevent_inventory_warehouse_mutation()
  from public, anon, authenticated, service_role;

create trigger inventory_warehouses_reject_update_delete
before update or delete on public.inventory_warehouses
for each row execute function public.prevent_inventory_warehouse_mutation();

alter table public.inventory_warehouses enable row level security;
revoke all privileges on table public.inventory_warehouses
  from public, anon, authenticated;

-- Warehouse backfill and zero-balance creation are structural compatibility
-- work, not business Inventory changes, and must not create shortage history.
alter table public.inventory_balances
  disable trigger inventory_balances_queue_shortage_reconciliation;

alter table public.inventory_balances
  add column warehouse_id uuid not null
    default '10000000-0000-4000-8000-000000000001'::uuid,
  add constraint inventory_balances_warehouse_id_fkey
    foreign key (warehouse_id) references public.inventory_warehouses(id)
    on delete restrict;

alter table public.inventory_balances
  drop constraint inventory_balances_pkey,
  add constraint inventory_balances_pkey primary key (product_id, warehouse_id);

create index inventory_balances_warehouse_product_idx
  on public.inventory_balances (warehouse_id, product_id);

create function public.enforce_inventory_balance_identity_immutability()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if new.product_id is distinct from old.product_id
    or new.warehouse_id is distinct from old.warehouse_id
  then
    raise exception 'Inventory balance identity is immutable'
      using errcode = 'IVW02';
  end if;
  return new;
end;
$function$;

revoke all privileges on function
  public.enforce_inventory_balance_identity_immutability()
  from public, anon, authenticated, service_role;

create trigger inventory_balances_enforce_identity_immutability
before update on public.inventory_balances
for each row execute function
  public.enforce_inventory_balance_identity_immutability();

alter table public.inventory_movements
  add column warehouse_id uuid not null
    default '10000000-0000-4000-8000-000000000001'::uuid,
  add constraint inventory_movements_warehouse_id_fkey
    foreign key (warehouse_id) references public.inventory_warehouses(id)
    on delete restrict,
  add constraint inventory_movements_id_product_warehouse_key
    unique (id, product_id, warehouse_id);

alter table public.inventory_source_lots
  add column warehouse_id uuid not null
    default '10000000-0000-4000-8000-000000000001'::uuid,
  add constraint inventory_source_lots_warehouse_id_fkey
    foreign key (warehouse_id) references public.inventory_warehouses(id)
    on delete restrict,
  add constraint inventory_source_lots_id_product_warehouse_key
    unique (id, product_id, warehouse_id);

alter table public.inventory_source_allocations
  add column warehouse_id uuid not null
    default '10000000-0000-4000-8000-000000000001'::uuid,
  add constraint inventory_source_allocations_warehouse_id_fkey
    foreign key (warehouse_id) references public.inventory_warehouses(id)
    on delete restrict;

alter table public.inventory_source_lots
  drop constraint inventory_source_lots_originating_movement_product_fkey,
  add constraint inventory_source_lots_originating_movement_product_warehouse_fkey
    foreign key (originating_inventory_movement_id, product_id, warehouse_id)
    references public.inventory_movements(id, product_id, warehouse_id)
    on delete restrict;

alter table public.inventory_source_allocations
  drop constraint inventory_source_allocations_outbound_movement_product_fkey,
  drop constraint inventory_source_allocations_source_lot_product_fkey,
  add constraint inventory_source_allocations_outbound_movement_product_warehouse_fkey
    foreign key (outbound_inventory_movement_id, product_id, warehouse_id)
    references public.inventory_movements(id, product_id, warehouse_id)
    on delete restrict,
  add constraint inventory_source_allocations_source_lot_product_warehouse_fkey
    foreign key (source_lot_id, product_id, warehouse_id)
    references public.inventory_source_lots(id, product_id, warehouse_id)
    on delete restrict;

drop index public.inventory_source_lots_fifo_idx;
create index inventory_source_lots_fifo_idx
  on public.inventory_source_lots
    (product_id, warehouse_id, received_at, id)
  where remaining_quantity > 0;

create or replace function public.initialize_product_inventory_balance()
returns trigger
language plpgsql
volatile
set search_path = ''
as $function$
begin
  insert into public.inventory_balances (
    product_id, warehouse_id, quantity, updated_at
  )
  select new.id, warehouse.id, 0, pg_catalog.now()
  from public.inventory_warehouses as warehouse
  order by warehouse.sort_order;
  return new;
end;
$function$;

create or replace function public.check_inventory_source_lot_balance()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  checked_product_id uuid;
  checked_warehouse_id uuid;
  balance_quantity bigint;
  lot_quantity numeric;
begin
  if tg_op = 'DELETE' then
    checked_product_id := old.product_id;
    checked_warehouse_id := old.warehouse_id;
  else
    checked_product_id := new.product_id;
    checked_warehouse_id := new.warehouse_id;
  end if;

  select balance.quantity into balance_quantity
  from public.inventory_balances as balance
  where balance.product_id = checked_product_id
    and balance.warehouse_id = checked_warehouse_id;

  select coalesce(pg_catalog.sum(lot.remaining_quantity::numeric), 0::numeric)
  into lot_quantity
  from public.inventory_source_lots as lot
  where lot.product_id = checked_product_id
    and lot.warehouse_id = checked_warehouse_id;

  if balance_quantity is null or lot_quantity <> balance_quantity::numeric then
    raise exception 'Inventory balance and source lots diverged for Product % in warehouse %',
      checked_product_id, checked_warehouse_id using errcode = 'IVL02';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

-- Fail the migration if a compatibility rewrite no longer matches the reviewed
-- migration-135 function body exactly.
create function pg_temp.replace_inventory_function_text(
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
    raise exception 'Required compatibility function is missing: %', p_signature;
  end if;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  actual_count := (
    pg_catalog.length(definition) -
    pg_catalog.length(pg_catalog.replace(definition, p_old, ''))
  ) / pg_catalog.length(p_old);
  if actual_count <> p_expected_count then
    raise exception 'Unexpected compatibility definition for %: expected % replacements, found %',
      p_signature, p_expected_count, actual_count;
  end if;
  execute pg_catalog.replace(definition, p_old, p_new);
end;
$function$;

select pg_temp.replace_inventory_function_text(
  'public.apply_inventory_delta(uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text)',
  'where balance.product_id = p_product_id',
  'where balance.product_id = p_product_id
    and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid',
  2
);

select pg_temp.replace_inventory_function_text(
  'public.manual_adjust_inventory(uuid,text,bigint,text,uuid)',
  'where balance.product_id = p_product_id',
  'where balance.product_id = p_product_id
    and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid',
  1
);

select pg_temp.replace_inventory_function_text(
  'public.consume_inventory_source_lots(uuid,bigint,uuid)',
  'and movement.quantity_delta < 0;',
  'and movement.quantity_delta < 0
    and movement.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid;',
  1
);
select pg_temp.replace_inventory_function_text(
  'public.consume_inventory_source_lots(uuid,bigint,uuid)',
  'where lot.product_id = p_product_id and lot.remaining_quantity > 0',
  'where lot.product_id = p_product_id
      and lot.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid
      and lot.remaining_quantity > 0',
  1
);
select pg_temp.replace_inventory_function_text(
  'public.consume_inventory_source_lots(uuid,bigint,uuid)',
  'outbound_inventory_movement_id, source_lot_id, product_id, allocated_quantity',
  'outbound_inventory_movement_id, source_lot_id, product_id, warehouse_id, allocated_quantity',
  1
);
select pg_temp.replace_inventory_function_text(
  'public.consume_inventory_source_lots(uuid,bigint,uuid)',
  'p_outbound_inventory_movement_id, lot_record.id, p_product_id, taken_quantity',
  'p_outbound_inventory_movement_id, lot_record.id, p_product_id,
      ''10000000-0000-4000-8000-000000000001''::uuid, taken_quantity',
  1
);

select pg_temp.replace_inventory_function_text(
  'public.list_inventory_source_lots(uuid)',
  'where lot.product_id = p_product_id',
  'where lot.product_id = p_product_id
    and lot.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid',
  1
);

select pg_temp.replace_inventory_function_text(
  'public.get_work_order_source_allocation_plan(uuid)',
  'where lot.product_id = material.product_id',
  'where lot.product_id = material.product_id
      and lot.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid',
  3
);

select pg_temp.replace_inventory_function_text(
  'public.produce_pcb(uuid,text,uuid)',
  'where balance.product_id = any(involved_product_ids)',
  'where balance.product_id = any(involved_product_ids)
      and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid',
  1
);

select pg_temp.replace_inventory_function_text(
  'public.get_work_order_material_inventory(uuid,uuid)',
  'where balance.product_id = p_product_id;',
  'where balance.product_id = p_product_id
    and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid;',
  1
);

-- Product-only legacy read projections retain their exact return contracts while
-- reading only the Raw Materials balance.
select pg_temp.replace_inventory_function_text(
  'public.search_inventory_products(text)',
  'on balance.product_id = product.id',
  'on balance.product_id = product.id
    and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 1);
select pg_temp.replace_inventory_function_text(
  'public.get_inventory_project_commitments()',
  'on balance.product_id = product.id',
  'on balance.product_id = product.id
    and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 1);
select pg_temp.replace_inventory_function_text(
  'public.list_pcb_cards()',
  'on balance.product_id = product.id',
  'on balance.product_id = product.id
    and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 1);
select pg_temp.replace_inventory_function_text(
  'public.search_pcb_bom_product_choices(uuid,text)',
  'on balance.product_id = product.id',
  'on balance.product_id = product.id
    and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 1);
select pg_temp.replace_inventory_function_text(
  'public.get_pcb_bom_editor(uuid)',
  'on output_balance.product_id = output_product.id',
  'on output_balance.product_id = output_product.id
    and output_balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 1);
select pg_temp.replace_inventory_function_text(
  'public.get_pcb_bom_editor(uuid)',
  'on input_balance.product_id = input_product.id',
  'on input_balance.product_id = input_product.id
    and input_balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 1);
select pg_temp.replace_inventory_function_text(
  'public.get_pcb_production_precheck(uuid)',
  'on input_balance.product_id = input_product.id',
  'on input_balance.product_id = input_product.id
    and input_balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 1);
select pg_temp.replace_inventory_function_text(
  'public.get_dashboard_read_model()',
  'on balance.product_id = product_list.id',
  'on balance.product_id = product_list.id
            and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 1);
select pg_temp.replace_inventory_function_text(
  'public.get_project_planning(uuid)',
  'on balance.product_id = product.id',
  'on balance.product_id = product.id
    and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 1);
select pg_temp.replace_inventory_function_text(
  'public.reconcile_project_shortages_for_products(uuid[],boolean)',
  'where balance.product_id = current_product_id',
  'where balance.product_id = current_product_id
      and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 1);

select pg_temp.replace_inventory_function_text(
  'public.list_draft_work_order_materials(uuid)',
  'on balance.product_id = item.product_id',
  'on balance.product_id = item.product_id
      and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 2);
select pg_temp.replace_inventory_function_text(
  'public.list_draft_work_order_materials_with_origin(uuid)',
  'on balance.product_id = item.product_id',
  'on balance.product_id = item.product_id
      and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 2);
select pg_temp.replace_inventory_function_text(
  'public.preflight_finish_work_order(uuid,timestamp with time zone)',
  'on balance.product_id = item.product_id',
  'on balance.product_id = item.product_id
      and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 3);

select pg_temp.replace_inventory_function_text(
  'public.preflight_finish_pcb_production_work_order(uuid,timestamp with time zone,text)',
  'where balance.product_id = card_record.output_product_id
       or balance.product_id in (
         select item.product_id
         from public.work_order_items as item
         where item.work_order_id = current_work_order.id
       )
    order by balance.product_id',
  'where balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid
      and (balance.product_id = card_record.output_product_id
       or balance.product_id in (
         select item.product_id
         from public.work_order_items as item
         where item.work_order_id = current_work_order.id
       ))
    order by balance.product_id', 1);
select pg_temp.replace_inventory_function_text(
  'public.preflight_finish_pcb_production_work_order(uuid,timestamp with time zone,text)',
  'on balance.product_id = combined.product_id;',
  'on balance.product_id = combined.product_id
    and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid;', 1);
select pg_temp.replace_inventory_function_text(
  'public.preflight_finish_pcb_production_work_order(uuid,timestamp with time zone,text)',
  'where balance.product_id = card_record.output_product_id
      and balance.quantity::numeric',
  'where balance.product_id = card_record.output_product_id
      and balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid
      and balance.quantity::numeric', 1);
select pg_temp.replace_inventory_function_text(
  'public.preflight_finish_pcb_production_work_order(uuid,timestamp with time zone,text)',
  'on input_balance.product_id = combined.product_id',
  'on input_balance.product_id = combined.product_id
    and input_balance.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 1);

-- Warehouse identity is part of immutable lot and reversal context.
select pg_temp.replace_inventory_function_text(
  'public.enforce_inventory_source_lot_immutability()',
  'or new.product_id is distinct from old.product_id',
  'or new.product_id is distinct from old.product_id
    or new.warehouse_id is distinct from old.warehouse_id', 1);
select pg_temp.replace_inventory_function_text(
  'public.validate_inventory_movement_reversal_product()',
  'original_product_id uuid;',
  'original_product_id uuid;
  original_warehouse_id uuid;', 1);
select pg_temp.replace_inventory_function_text(
  'public.validate_inventory_movement_reversal_product()',
  'select original.product_id
  into original_product_id',
  'select original.product_id, original.warehouse_id
  into original_product_id, original_warehouse_id', 1);
select pg_temp.replace_inventory_function_text(
  'public.validate_inventory_movement_reversal_product()',
  'if found and original_product_id is distinct from new.product_id then',
  'if found and (
    original_product_id is distinct from new.product_id
    or original_warehouse_id is distinct from new.warehouse_id
  ) then', 1);

-- Historical/legacy readers keep their pre-warehouse projection and expose
-- only Raw Materials through the existing permissions.
select pg_temp.replace_inventory_function_text(
  'public.calculate_open_project_commitments(uuid)',
  'where movement.project_id is not null',
  'where movement.project_id is not null
      and movement.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 1);
select pg_temp.replace_inventory_function_text(
  'public.get_inventory_movements_for_product(uuid)',
  'where movement.product_id = p_product_id',
  'where movement.product_id = p_product_id
    and movement.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid', 1);
select pg_temp.replace_inventory_function_text(
  'public.list_finished_work_order_materials(uuid)',
  'where (
        movement.source_type = ''work_order''',
  'where allocation.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid
      and (
        movement.source_type = ''work_order''', 1);
select pg_temp.replace_inventory_function_text(
  'public.list_finished_work_order_movements(uuid)',
  'where (
    movement.source_type = ''work_order''
    and movement.source_id = p_work_order_id
  ) or (
    movement.source_type in (''pcb_production_input'', ''pcb_production_output'')
    and exists (
      select 1
      from public.pcb_production_runs as run
      where run.id = movement.source_id
        and run.work_order_id = p_work_order_id
    )
  )',
  'where movement.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid
    and ((
      movement.source_type = ''work_order''
      and movement.source_id = p_work_order_id
    ) or (
      movement.source_type in (''pcb_production_input'', ''pcb_production_output'')
      and exists (
        select 1
        from public.pcb_production_runs as run
        where run.id = movement.source_id
          and run.work_order_id = p_work_order_id
      )
    ))', 1);
select pg_temp.replace_inventory_function_text(
  'public.list_project_material_usage(uuid)',
  'where movement.movement_type = ''work_order''',
  'where movement.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid
      and movement.movement_type = ''work_order''', 1);
select pg_temp.replace_inventory_function_text(
  'public.list_project_material_usage(uuid)',
  'where movement.movement_type = ''pcb_production_input''',
  'where movement.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid
      and movement.movement_type = ''pcb_production_input''', 1);
select pg_temp.replace_inventory_function_text(
  'public.list_project_work_order_material_usage(uuid)',
  'where movement.movement_type = ''work_order''',
  'where movement.warehouse_id = ''10000000-0000-4000-8000-000000000001''::uuid
    and movement.movement_type = ''work_order''', 1);
create or replace function public.queue_project_shortage_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  affected_product_id uuid;
begin
  if tg_table_name = 'inventory_balances' then
    if tg_op <> 'DELETE'
      and new.warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
    then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), new.product_id)
      on conflict do nothing;
    end if;
    if tg_op <> 'INSERT'
      and old.warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
    then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), old.product_id)
      on conflict do nothing;
    end if;
  elsif tg_table_name = 'project_product_components' then
    if tg_op <> 'DELETE' then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), new.product_id)
      on conflict do nothing;
    end if;
    if tg_op <> 'INSERT' then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), old.product_id)
      on conflict do nothing;
    end if;
  elsif tg_table_name = 'projects'
    and new.status is distinct from old.status
  then
    for affected_product_id in
      select distinct component.product_id
      from public.project_products as project_product
      join public.project_product_components as component
        on component.project_product_id = project_product.id
      where project_product.project_id = new.id
      order by component.product_id
    loop
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), affected_product_id)
      on conflict do nothing;
    end loop;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

drop policy inventory_balances_select_inventory_readers
  on public.inventory_balances;
create policy inventory_balances_select_inventory_readers
on public.inventory_balances
for select to authenticated
using (
  warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
  and (
    public.current_user_is_admin()
    or public.has_permission('inventory.view')
  )
);

drop policy inventory_movements_select_inventory_readers
  on public.inventory_movements;
create policy inventory_movements_select_inventory_readers
on public.inventory_movements
for select to authenticated
using (
  warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
  and (
    public.current_user_is_admin()
    or public.has_permission('inventory.view')
  )
);

insert into public.inventory_balances (
  product_id, warehouse_id, quantity, updated_at
)
select product.id, warehouse.id, 0, pg_catalog.now()
from public.products as product
cross join public.inventory_warehouses as warehouse
where warehouse.code in ('finished_goods', 'customs')
order by product.id, warehouse.sort_order;

-- Drain deferred integrity checks before changing trigger enablement state.
set constraints all immediate;

alter table public.inventory_balances
  enable trigger inventory_balances_queue_shortage_reconciliation;

-- Migration-time preservation proofs. Any mismatch aborts the full migration.
do $block$
begin
  if exists (
    select 1
    from inventory_warehouse_balance_snapshot as old_balance
    left join public.inventory_balances as new_balance
      on new_balance.product_id = old_balance.product_id
      and new_balance.warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
    where new_balance.product_id is null
      or new_balance.quantity is distinct from old_balance.quantity
      or new_balance.updated_at is distinct from old_balance.updated_at
  ) then
    raise exception 'Raw Materials stock parity failed' using errcode = 'IVW01';
  end if;

  if exists (
    select 1 from public.inventory_balances
    where warehouse_id in (
      '10000000-0000-4000-8000-000000000002'::uuid,
      '10000000-0000-4000-8000-000000000003'::uuid
    ) and quantity <> 0
  ) then
    raise exception 'Future warehouse stock must start at zero' using errcode = 'IVW01';
  end if;

  if exists (
    select product_id from public.inventory_balances
    group by product_id having pg_catalog.count(*) <> 3
  ) then
    raise exception 'Every Product must have exactly three warehouse balances'
      using errcode = 'IVW01';
  end if;

  if exists (
    (select id, product_id, movement_type, quantity_delta, quantity_before,
      quantity_after, reason, source_type, source_id, project_id, actor_user_id,
      created_at, reversal_of_movement_id from public.inventory_movements
     except table inventory_warehouse_movement_snapshot)
    union all
    (table inventory_warehouse_movement_snapshot except
     select id, product_id, movement_type, quantity_delta, quantity_before,
      quantity_after, reason, source_type, source_id, project_id, actor_user_id,
      created_at, reversal_of_movement_id from public.inventory_movements)
  ) then
    raise exception 'Historical InventoryMovement parity failed' using errcode = 'IVW01';
  end if;

  if exists (
    (select id, product_id, source_kind, product_supplier_id, supplier_id,
      supplier_name_snapshot, catalog_number_snapshot,
      supplier_description_snapshot, received_quantity, remaining_quantity,
      originating_inventory_movement_id, received_at, actor_user_id
     from public.inventory_source_lots
     except table inventory_warehouse_lot_snapshot)
    union all
    (table inventory_warehouse_lot_snapshot except
     select id, product_id, source_kind, product_supplier_id, supplier_id,
      supplier_name_snapshot, catalog_number_snapshot,
      supplier_description_snapshot, received_quantity, remaining_quantity,
      originating_inventory_movement_id, received_at, actor_user_id
     from public.inventory_source_lots)
  ) then
    raise exception 'Historical source-lot parity failed' using errcode = 'IVW01';
  end if;

  if exists (
    (select id, outbound_inventory_movement_id, source_lot_id, product_id,
      allocated_quantity, created_at from public.inventory_source_allocations
     except table inventory_warehouse_allocation_snapshot)
    union all
    (table inventory_warehouse_allocation_snapshot except
     select id, outbound_inventory_movement_id, source_lot_id, product_id,
      allocated_quantity, created_at from public.inventory_source_allocations)
  ) then
    raise exception 'Historical source-allocation parity failed' using errcode = 'IVW01';
  end if;

  if exists (
    select 1 from public.inventory_movements
    where warehouse_id <> '10000000-0000-4000-8000-000000000001'::uuid
  ) or exists (
    select 1 from public.inventory_source_lots
    where warehouse_id <> '10000000-0000-4000-8000-000000000001'::uuid
  ) or exists (
    select 1 from public.inventory_source_allocations
    where warehouse_id <> '10000000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception 'Historical Inventory history must map to Raw Materials'
      using errcode = 'IVW01';
  end if;
end;
$block$;

comment on table public.inventory_warehouses is
  'Immutable canonical warehouse identities. No browser role may create or mutate warehouses.';
comment on column public.inventory_balances.warehouse_id is
  'Warehouse-scoped balance identity; legacy operations target Raw Materials until Task 001C/001F.';
comment on column public.inventory_movements.warehouse_id is
  'Immutable warehouse whose before/after quantity the movement records.';
comment on column public.inventory_source_lots.warehouse_id is
  'Immutable warehouse containing the remaining source-lot quantity.';
comment on column public.inventory_source_allocations.warehouse_id is
  'Warehouse shared by the outbound movement and allocated source lot.';
