-- Phase 3B1: protect stock and demand, without activating reservation mutations.
-- No backfill, physical fulfillment, or historical rewrite is performed.
do $preflight$
begin
  if exists (
    select 1 from public.finished_goods_project_reservations state
    left join public.inventory_balances balance on balance.product_id = state.product_id
      and balance.warehouse_id = state.warehouse_id
    where state.reserved_quantity > 0 and (balance.product_id is null or
      (select pg_catalog.sum(other.reserved_quantity::numeric)
       from public.finished_goods_project_reservations other where other.product_id = state.product_id)
        > balance.quantity::numeric or state.reserved_quantity::numeric > coalesce((
          select demand.outstanding_commitment from public.calculate_open_project_commitments(state.product_id) demand
          where demand.project_id = state.project_id), 0::numeric))
  ) then
    raise exception 'Existing Finished Goods reservations violate stock or demand bounds' using errcode = 'FGR06';
  end if;
end;
$preflight$;

-- Every physical debit ultimately updates this row, while holding its row lock.
-- A VOLATILE trigger query rechecks committed reservations after any lock wait.
create function public.protect_finished_goods_reserved_stock()
returns trigger language plpgsql volatile security definer set search_path = '' as $function$
declare reserved numeric;
begin
  select coalesce(pg_catalog.sum(state.reserved_quantity::numeric), 0::numeric)
    into reserved from public.finished_goods_project_reservations state
    where state.product_id = new.product_id;
  if new.quantity::numeric < reserved then
    raise exception 'Insufficient unreserved Finished Goods stock' using errcode = 'IVB02';
  end if;
  return new;
end;
$function$;
create trigger inventory_balances_protect_finished_goods_reservations
before update of quantity on public.inventory_balances
for each row when (new.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid
  and new.quantity < old.quantity)
execute function public.protect_finished_goods_reserved_stock();
revoke all on function public.protect_finished_goods_reserved_stock()
  from public, anon, authenticated, service_role;

-- Existing trusted prechecks keep their signatures and authorization. The
-- aggregate reveals no Project attribution and excludes all hard-reserved FG.
create or replace function public.get_production_eligible_quantity(p_product_id uuid)
returns bigint language sql stable security invoker set search_path = '' as $function$
  select coalesce(pg_catalog.sum(case when balance.warehouse_id =
    '10000000-0000-4000-8000-000000000002'::uuid then greatest(balance.quantity::numeric - coalesce((
      select pg_catalog.sum(state.reserved_quantity::numeric)
      from public.finished_goods_project_reservations state where state.product_id = p_product_id
    ), 0::numeric), 0::numeric) else balance.quantity::numeric end), 0::numeric)::bigint
  from public.inventory_balances balance where balance.product_id = p_product_id
    and balance.warehouse_id in ('10000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000003'::uuid, '10000000-0000-4000-8000-000000000002'::uuid);
$function$;
revoke all on function public.get_production_eligible_quantity(uuid)
  from public, anon, authenticated, service_role;

-- Keep the existing projection, FIFO order, warehouse priority and fingerprints.
-- Product -> balances -> lots is compatible with the existing production paths.
create or replace function public.get_work_order_warehouse_source_allocation_plan(p_work_order_id uuid)
returns table (product_id uuid, warehouse_id uuid, warehouse_code text, warehouse_name text,
  warehouse_priority smallint, source_lot_id uuid, source_kind text,
  supplier_name_snapshot text, catalog_number_snapshot text,
  supplier_description_snapshot text, allocated_quantity bigint, received_at timestamptz)
language plpgsql volatile security invoker set search_path = '' as $function$
declare material record; available_fg numeric; planned_quantity numeric;
begin
  if p_work_order_id is null then raise exception 'Work Order ID is required' using errcode = '22023'; end if;
  for material in
    select item.product_id, pg_catalog.sum(item.quantity::numeric)::bigint quantity
    from public.work_order_items item where item.work_order_id = p_work_order_id
    group by item.product_id order by item.product_id
  loop
    perform product.id from public.products product where product.id = material.product_id for share;
    perform balance.product_id from public.inventory_balances balance
      where balance.product_id = material.product_id
      order by public.production_warehouse_priority(balance.warehouse_id) for update;
    select greatest(balance.quantity::numeric - coalesce((
      select pg_catalog.sum(state.reserved_quantity::numeric)
      from public.finished_goods_project_reservations state where state.product_id = material.product_id
    ), 0::numeric), 0::numeric) into available_fg
      from public.inventory_balances balance where balance.product_id = material.product_id
        and balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid;
    perform lot.id from public.inventory_source_lots lot
      where lot.product_id = material.product_id and lot.remaining_quantity > 0
      order by public.production_warehouse_priority(lot.warehouse_id), lot.received_at, lot.id for update;
    select coalesce(pg_catalog.sum(case when lot.warehouse_id <>
      '10000000-0000-4000-8000-000000000002'::uuid then lot.remaining_quantity::numeric else 0::numeric end),0::numeric)
      + least(coalesce(available_fg,0::numeric),coalesce(pg_catalog.sum(case when lot.warehouse_id =
      '10000000-0000-4000-8000-000000000002'::uuid then lot.remaining_quantity::numeric else 0::numeric end),0::numeric))
      into planned_quantity from public.inventory_source_lots lot
      where lot.product_id = material.product_id and lot.remaining_quantity > 0;
    if planned_quantity < material.quantity::numeric then
      raise exception 'Insufficient physical Inventory' using errcode = 'IVB02';
    end if;
    return query
    with lot_prefix as (
      select lot.*, public.production_warehouse_priority(lot.warehouse_id) priority,
        coalesce(pg_catalog.sum(lot.remaining_quantity::numeric) over (
          partition by lot.warehouse_id order by lot.received_at, lot.id
          rows between unbounded preceding and 1 preceding),0::numeric) before_in_warehouse
      from public.inventory_source_lots lot where lot.product_id = material.product_id and lot.remaining_quantity > 0
    ), eligible as (
      select prefix.*, case when prefix.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid
        then least(prefix.remaining_quantity::numeric,
          greatest(coalesce(available_fg,0::numeric) - prefix.before_in_warehouse,0::numeric))
        else prefix.remaining_quantity::numeric end usable
      from lot_prefix prefix
    ), fifo as (
      select eligible.*, coalesce(pg_catalog.sum(eligible.usable) over (
        order by eligible.priority, eligible.received_at, eligible.id
        rows between unbounded preceding and 1 preceding),0::numeric) before_in_plan
      from eligible where eligible.usable > 0
    )
    select fifo.product_id, fifo.warehouse_id, warehouse.code, warehouse.display_name,
      fifo.priority, fifo.id, fifo.source_kind, fifo.supplier_name_snapshot,
      fifo.catalog_number_snapshot, fifo.supplier_description_snapshot,
      least(fifo.usable,material.quantity::numeric - fifo.before_in_plan)::bigint, fifo.received_at
    from fifo join public.inventory_warehouses warehouse on warehouse.id = fifo.warehouse_id
    where fifo.before_in_plan < material.quantity::numeric
    order by fifo.priority, fifo.received_at, fifo.id;
  end loop;
end;
$function$;
revoke all on function public.get_work_order_warehouse_source_allocation_plan(uuid)
  from public, anon, authenticated, service_role;

-- Requirement RPCs already lock the Project. The trigger also takes that lock
-- for trusted internal callers, then checks the same explicit Product demand.
-- No stock/lot locks are needed: all reservation changes serialize on Project.
create function public.protect_finished_goods_reservation_demand()
returns trigger language plpgsql volatile security definer set search_path = '' as $function$
declare affected uuid[]; old_project uuid; new_project uuid; project_key uuid;
begin
  if tg_table_name = 'project_product_components' then
    if tg_op <> 'INSERT' then select parent.project_id into old_project
      from public.project_products parent where parent.id = old.project_product_id; end if;
    if tg_op <> 'DELETE' then select parent.project_id into new_project
      from public.project_products parent where parent.id = new.project_product_id; end if;
  elsif tg_table_name = 'project_products' then
    if tg_op <> 'INSERT' then old_project := old.project_id; end if;
    if tg_op <> 'DELETE' then new_project := new.project_id; end if;
  elsif tg_table_name = 'inventory_movements' then
    new_project := new.project_id;
  end if;
  affected := array[old_project,new_project];
  for project_key in select project.id from public.projects project
    where project.id = any(affected) order by project.id for update
  loop
    if exists (
      select 1 from public.finished_goods_project_reservations state
      where state.project_id = project_key and state.reserved_quantity > 0
        and state.reserved_quantity::numeric > coalesce((
          select demand.outstanding_commitment from public.calculate_open_project_commitments(state.product_id) demand
          where demand.project_id = project_key),0::numeric)
    ) then
      raise exception 'Project change would invalidate Finished Goods reservations' using errcode = 'FGR06';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
create trigger project_requirements_protect_finished_goods_reservations
after insert or update or delete on public.project_product_components
for each row execute function public.protect_finished_goods_reservation_demand();
create trigger project_groups_protect_finished_goods_reservations
after update or delete on public.project_products
for each row execute function public.protect_finished_goods_reservation_demand();
create trigger project_consumption_protect_finished_goods_reservations
after insert on public.inventory_movements
for each row when (new.project_id is not null and new.quantity_delta < 0
  and new.source_type in ('work_order','pcb_production_input'))
execute function public.protect_finished_goods_reservation_demand();
revoke all on function public.protect_finished_goods_reservation_demand()
  from public, anon, authenticated, service_role;

create function public.protect_finished_goods_reservation_project_lifecycle()
returns trigger language plpgsql volatile security definer set search_path = '' as $function$
declare state public.finished_goods_project_reservations%rowtype; actor_id uuid; released_at timestamptz;
begin
  if new.status = old.status then return new; end if;
  if new.status = 'completed' and exists (select 1 from public.finished_goods_project_reservations r
    where r.project_id = new.id and r.reserved_quantity > 0) then
    raise exception 'Resolve Finished Goods reservations before Project completion' using errcode = 'FGR08';
  end if;
  if new.status <> 'cancelled' then return new; end if;
  if not exists (select 1 from public.finished_goods_project_reservations r
    where r.project_id = new.id and r.reserved_quantity > 0) then return new; end if;
  actor_id := public.current_active_user_profile_id();
  if actor_id is null or actor_id is distinct from new.updated_by_user_id or not (
    public.current_user_is_admin() or public.has_permission('projects.archive')) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  -- Project is already locked; Product UUID order precedes the FG balance/state.
  for state in select r.* from public.finished_goods_project_reservations r
    where r.project_id = new.id and r.reserved_quantity > 0 order by r.product_id
  loop
    perform p.id from public.products p where p.id = state.product_id for share;
    perform b.product_id from public.inventory_balances b
      where b.product_id = state.product_id and b.warehouse_id = state.warehouse_id for update;
    perform r.id from public.finished_goods_project_reservations r where r.id = state.id for update;
    -- Cancellation authority can change while waiting for stock/state locks.
    if public.current_active_user_profile_id() is distinct from actor_id or not (
      public.current_user_is_admin() or public.has_permission('projects.archive')) then
      raise exception 'Access denied' using errcode = '42501';
    end if;
    released_at := pg_catalog.clock_timestamp();
    update public.finished_goods_project_reservations r set reserved_quantity = 0,
      version = state.version + 1, updated_at = released_at, updated_by_user_id = actor_id where r.id = state.id;
    insert into public.finished_goods_project_reservation_events (
      reservation_id,project_id,product_id,event_type,quantity_before,quantity_after,reservation_version,
      request_id,actor_user_id,requested_quantity,expected_version,created_at
    ) values (state.id,state.project_id,state.product_id,'released',state.reserved_quantity,0,state.version+1,
      gen_random_uuid(),actor_id,state.reserved_quantity,state.version,released_at);
    perform public.append_audit_log(
      p_action_type => 'finished_goods_reservation.released', p_entity_type => 'finished_goods_reservation',
      p_entity_id => state.id, p_summary => 'Released Finished Goods reservation on Project cancellation',
      p_before_data => pg_catalog.jsonb_build_object('reserved_quantity',state.reserved_quantity),
      p_after_data => pg_catalog.jsonb_build_object('project_id',state.project_id,'product_id',state.product_id,
        'reserved_quantity',0,'version',state.version+1,'release_reason','project_cancelled'));
  end loop;
  return new;
end;
$function$;
create trigger projects_protect_finished_goods_reservation_lifecycle
before update of status on public.projects
for each row execute function public.protect_finished_goods_reservation_project_lifecycle();
revoke all on function public.protect_finished_goods_reservation_project_lifecycle()
  from public, anon, authenticated, service_role;

-- Reassert the non-executable foundation. This migration grants no new access.
revoke all on function public.change_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid,boolean),
  public.reserve_finished_goods_for_project(uuid,uuid,bigint,bigint,uuid),
  public.release_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid)
  from public, anon, authenticated, service_role;
