-- WO-03: private, transactionally reconciled Draft material shortage history.
-- No deployment-time backfill and no notification delivery in this migration.
create table public.work_order_material_shortage_episodes (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null,
  work_order_number text not null,
  product_id uuid not null,
  product_name_snapshot text not null,
  required_quantity bigint not null check (required_quantity >= 0),
  eligible_quantity bigint not null check (eligible_quantity >= 0),
  missing_quantity bigint not null check (missing_quantity >= 0),
  revision bigint not null default 1 check (revision > 0),
  opened_at timestamptz not null default pg_catalog.clock_timestamp(),
  resolved_at timestamptz,
  constraint work_order_material_shortage_episode_state check (
    (resolved_at is null and missing_quantity > 0)
    or (resolved_at is not null and missing_quantity = 0)
  ),
  constraint work_order_material_shortage_episode_math check (
    missing_quantity::numeric = greatest(
      required_quantity::numeric - eligible_quantity::numeric, 0::numeric)
  ),
  constraint work_order_material_shortage_episode_time check (
    resolved_at is null or resolved_at >= opened_at
  ),
  -- Draft deletion must retain history without adding a restrictive FK.
  unique (id, work_order_id, product_id)
);
create unique index work_order_material_shortage_active_key
  on public.work_order_material_shortage_episodes (work_order_id, product_id)
  where resolved_at is null;
create index work_order_material_shortage_product_active_idx
  on public.work_order_material_shortage_episodes (product_id, work_order_id)
  where resolved_at is null;

create table public.work_order_material_shortage_events (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null,
  work_order_id uuid not null,
  product_id uuid not null,
  revision bigint not null check (revision > 0),
  event_type text not null check (event_type in ('opened','increased','decreased','changed','resolved')),
  required_quantity bigint not null check (required_quantity >= 0),
  eligible_quantity bigint not null check (eligible_quantity >= 0),
  missing_quantity bigint not null check (missing_quantity >= 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (episode_id, work_order_id, product_id)
    references public.work_order_material_shortage_episodes(id, work_order_id, product_id)
    on delete restrict,
  unique (id, episode_id, event_type),
  unique (episode_id, revision),
  check (missing_quantity::numeric = greatest(
    required_quantity::numeric - eligible_quantity::numeric, 0::numeric)),
  check ((event_type = 'resolved' and missing_quantity = 0)
    or (event_type <> 'resolved' and missing_quantity > 0))
);
create index work_order_material_shortage_events_history_idx
  on public.work_order_material_shortage_events (work_order_id, product_id, created_at, id);

-- WO-04 may deliver these once, with recipient rules applied then. Quantity
-- changes remain in events but never create notification intents.
create table public.work_order_material_shortage_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  episode_id uuid not null references public.work_order_material_shortage_episodes(id) on delete restrict,
  event_type text not null check (event_type in ('opened','resolved')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (event_id, episode_id, event_type)
    references public.work_order_material_shortage_events(id, episode_id, event_type)
    on delete restrict,
  unique (episode_id, event_type)
);

create table public.work_order_material_shortage_reconciliation_queue (
  transaction_id bigint not null,
  product_id uuid not null,
  primary key (transaction_id, product_id)
);

alter table public.work_order_material_shortage_episodes enable row level security;
alter table public.work_order_material_shortage_events enable row level security;
alter table public.work_order_material_shortage_notification_outbox enable row level security;
alter table public.work_order_material_shortage_reconciliation_queue enable row level security;
revoke all on public.work_order_material_shortage_episodes,
  public.work_order_material_shortage_events,
  public.work_order_material_shortage_notification_outbox,
  public.work_order_material_shortage_reconciliation_queue
  from public, anon, authenticated, service_role;

create function public.protect_work_order_material_shortage_episode()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Work Order shortage episodes are retained' using errcode = '55000';
  end if;
  if old.resolved_at is not null
    or new.id is distinct from old.id
    or new.work_order_id is distinct from old.work_order_id
    or new.work_order_number is distinct from old.work_order_number
    or new.product_id is distinct from old.product_id
    or new.product_name_snapshot is distinct from old.product_name_snapshot
    or new.opened_at is distinct from old.opened_at
    or new.revision <> old.revision + 1
  then
    raise exception 'Invalid Work Order shortage transition' using errcode = '55000';
  end if;
  return new;
end;
$function$;
create trigger work_order_material_shortage_episodes_protect
before update or delete on public.work_order_material_shortage_episodes
for each row execute function public.protect_work_order_material_shortage_episode();

create function public.reject_work_order_material_shortage_history_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  raise exception 'Work Order shortage history is immutable' using errcode = '55000';
end;
$function$;
create trigger work_order_material_shortage_events_immutable
before update or delete on public.work_order_material_shortage_events
for each row execute function public.reject_work_order_material_shortage_history_mutation();
create trigger work_order_material_shortage_outbox_immutable
before update or delete on public.work_order_material_shortage_notification_outbox
for each row execute function public.reject_work_order_material_shortage_history_mutation();
create trigger work_order_material_shortage_episodes_no_truncate
before truncate on public.work_order_material_shortage_episodes
for each statement execute function public.reject_work_order_material_shortage_history_mutation();
create trigger work_order_material_shortage_events_no_truncate
before truncate on public.work_order_material_shortage_events
for each statement execute function public.reject_work_order_material_shortage_history_mutation();
create trigger work_order_material_shortage_outbox_no_truncate
before truncate on public.work_order_material_shortage_notification_outbox
for each statement execute function public.reject_work_order_material_shortage_history_mutation();

-- A queued transaction is coalesced by Product. No Work Order row lock is taken
-- after a stock writer has locked balances; this avoids reversing lock order.
create function public.reconcile_work_order_material_shortages_for_product(p_product_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $function$
declare
  target record;
  active_episode public.work_order_material_shortage_episodes%rowtype;
  required_now bigint;
  eligible_now bigint;
  missing_now bigint;
  observed_at timestamptz;
  event_kind text;
  event_id uuid;
  current_status text;
  current_number text;
  current_product_name text;
begin
  if p_product_id is null then
    raise exception 'Product ID is required' using errcode = '22023';
  end if;
  -- A fixed caller snapshot could miss stock or item changes committed while
  -- waiting for the WO/Product advisory lock.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Read committed isolation is required for shortage reconciliation'
      using errcode = '25001';
  end if;
  for target in
    select candidate.work_order_id
    from (
      select item.work_order_id from public.work_order_items item
        join public.work_orders work_order on work_order.id = item.work_order_id
          and work_order.status = 'draft'
        where item.product_id = p_product_id
      union
      select episode.work_order_id from public.work_order_material_shortage_episodes episode
        where episode.product_id = p_product_id and episode.resolved_at is null
    ) candidate
    order by candidate.work_order_id
  loop
    -- Lock only this WO/Product episode identity. The Project shortage queue
    -- uses separate locks and tables; neither pipeline waits on the other's
    -- advisory locks. Product then WO ordering is stable across transactions.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'work-order-material-shortage:' || p_product_id::text || ':'
      || target.work_order_id::text, 0));
    select work_order.status, work_order.work_order_number
      into current_status, current_number
      from public.work_orders work_order where work_order.id = target.work_order_id;
    select product.name into current_product_name
      from public.products product where product.id = p_product_id;
    select episode.* into active_episode
      from public.work_order_material_shortage_episodes episode
      where episode.work_order_id = target.work_order_id
        and episode.product_id = p_product_id and episode.resolved_at is null
      for update;
    -- Sample expiry after both the Product advisory and episode row lock.
    observed_at := pg_catalog.clock_timestamp();

    if current_status = 'draft' then
      select pg_catalog.sum(item.quantity::numeric)::bigint into required_now
        from public.work_order_items item
        where item.work_order_id = target.work_order_id and item.product_id = p_product_id;
    else
      required_now := null;
    end if;

    if required_now is not null then
      if exists (
        select 1 from (values
          ('10000000-0000-4000-8000-000000000001'::uuid),
          ('10000000-0000-4000-8000-000000000002'::uuid),
          ('10000000-0000-4000-8000-000000000003'::uuid)
        ) warehouse(id)
        left join public.inventory_balances balance
          on balance.warehouse_id = warehouse.id and balance.product_id = p_product_id
        where balance.product_id is null
      ) then
        raise exception 'Inventory balance not found' using errcode = 'IVB01';
      end if;
      select pg_catalog.sum(public.get_production_free_warehouse_quantity_at(
        p_product_id, warehouse.id, observed_at))::bigint into eligible_now
      from (values
        ('10000000-0000-4000-8000-000000000001'::uuid),
        ('10000000-0000-4000-8000-000000000002'::uuid),
        ('10000000-0000-4000-8000-000000000003'::uuid)
      ) warehouse(id)
      where not public.is_calculator_finished_product(p_product_id)
        or warehouse.id = '10000000-0000-4000-8000-000000000002'::uuid;
      missing_now := greatest(required_now::numeric - eligible_now::numeric, 0)::bigint;
    else
      required_now := 0;
      eligible_now := 0;
      missing_now := 0;
    end if;

    if active_episode.id is null and missing_now > 0 then
      insert into public.work_order_material_shortage_episodes (
        work_order_id, work_order_number, product_id, product_name_snapshot,
        required_quantity, eligible_quantity, missing_quantity, opened_at
      ) values (
        target.work_order_id, current_number, p_product_id, current_product_name,
        required_now, eligible_now, missing_now, observed_at
      ) returning * into active_episode;
      insert into public.work_order_material_shortage_events (
        episode_id, work_order_id, product_id, revision, event_type,
        required_quantity, eligible_quantity, missing_quantity, created_at
      ) values (active_episode.id, target.work_order_id, p_product_id, 1,
        'opened', required_now, eligible_now, missing_now, observed_at)
      returning id into event_id;
      insert into public.work_order_material_shortage_notification_outbox (
        event_id, episode_id, event_type, created_at
      ) values (event_id, active_episode.id, 'opened', observed_at);
    elsif active_episode.id is not null then
      if missing_now = 0 then
        event_kind := 'resolved';
      elsif missing_now > active_episode.missing_quantity then
        event_kind := 'increased';
      elsif missing_now < active_episode.missing_quantity then
        event_kind := 'decreased';
      elsif required_now is distinct from active_episode.required_quantity
        or eligible_now is distinct from active_episode.eligible_quantity then
        event_kind := 'changed';
      else
        continue;
      end if;
      update public.work_order_material_shortage_episodes episode
      set required_quantity = required_now, eligible_quantity = eligible_now,
        missing_quantity = missing_now, revision = episode.revision + 1,
        resolved_at = case when missing_now = 0 then observed_at else null end
      where episode.id = active_episode.id;
      insert into public.work_order_material_shortage_events (
        episode_id, work_order_id, product_id, revision, event_type,
        required_quantity, eligible_quantity, missing_quantity, created_at
      ) values (active_episode.id, target.work_order_id, p_product_id,
        active_episode.revision + 1, event_kind,
        required_now, eligible_now, missing_now, observed_at)
      returning id into event_id;
      if event_kind = 'resolved' then
        insert into public.work_order_material_shortage_notification_outbox (
          event_id, episode_id, event_type, created_at
        ) values (event_id, active_episode.id, 'resolved', observed_at);
      end if;
    end if;
  end loop;
end;
$function$;

create function public.queue_work_order_material_shortage_reconciliation()
returns trigger language plpgsql volatile security definer set search_path = '' as $function$
declare affected_product_id uuid;
begin
  if tg_table_name = 'work_orders' then
    if tg_op = 'UPDATE' then
      if new.status is not distinct from old.status
        and new.updated_at is not distinct from old.updated_at then return new; end if;
    end if;
    for affected_product_id in
      select item.product_id from public.work_order_items item
        where item.work_order_id = old.id
      union
      select episode.product_id from public.work_order_material_shortage_episodes episode
        where episode.work_order_id = old.id and episode.resolved_at is null
      order by 1
    loop
      insert into public.work_order_material_shortage_reconciliation_queue
        (transaction_id, product_id)
      values (pg_catalog.txid_current(), affected_product_id) on conflict do nothing;
    end loop;
  else
    if tg_op <> 'DELETE' then
      if tg_table_name = 'pcb_cards' then affected_product_id := new.output_product_id;
      else affected_product_id := new.product_id; end if;
      if affected_product_id is not null then
        insert into public.work_order_material_shortage_reconciliation_queue
          (transaction_id, product_id)
        values (pg_catalog.txid_current(), affected_product_id) on conflict do nothing;
      end if;
    end if;
    if tg_op <> 'INSERT' then
      if tg_table_name = 'pcb_cards' then affected_product_id := old.output_product_id;
      else affected_product_id := old.product_id; end if;
      if affected_product_id is not null then
        insert into public.work_order_material_shortage_reconciliation_queue
          (transaction_id, product_id)
        values (pg_catalog.txid_current(), affected_product_id) on conflict do nothing;
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

create function public.process_work_order_material_shortage_reconciliation_queue()
returns trigger language plpgsql volatile security definer set search_path = '' as $function$
declare affected_product_id uuid;
begin
  for affected_product_id in
    select queue.product_id from public.work_order_material_shortage_reconciliation_queue queue
    where queue.transaction_id = new.transaction_id order by queue.product_id
  loop
    perform public.reconcile_work_order_material_shortages_for_product(affected_product_id);
  end loop;
  delete from public.work_order_material_shortage_reconciliation_queue queue
    where queue.transaction_id = new.transaction_id;
  return new;
end;
$function$;

create trigger work_order_items_queue_material_shortage
after insert or update of work_order_id, product_id, quantity or delete on public.work_order_items
for each row execute function public.queue_work_order_material_shortage_reconciliation();
create trigger work_orders_queue_material_shortage
after update of status, updated_at or delete on public.work_orders
for each row execute function public.queue_work_order_material_shortage_reconciliation();
create trigger inventory_balances_queue_work_order_material_shortage
after insert or update of quantity or delete on public.inventory_balances
for each row execute function public.queue_work_order_material_shortage_reconciliation();
create trigger test_holds_queue_work_order_material_shortage
after insert on public.test_calculation_holds
for each row execute function public.queue_work_order_material_shortage_reconciliation();
create trigger fg_project_reservations_queue_work_order_material_shortage
after insert or update of reserved_quantity or delete on public.finished_goods_project_reservations
for each row execute function public.queue_work_order_material_shortage_reconciliation();
create trigger pcb_output_queue_work_order_material_shortage
after insert or update of output_product_id or delete on public.pcb_cards
for each row execute function public.queue_work_order_material_shortage_reconciliation();
create constraint trigger work_order_material_shortage_queue_process
after insert on public.work_order_material_shortage_reconciliation_queue
deferrable initially deferred
for each row execute function public.process_work_order_material_shortage_reconciliation_queue();

revoke all on function public.protect_work_order_material_shortage_episode(),
  public.reject_work_order_material_shortage_history_mutation(),
  public.reconcile_work_order_material_shortages_for_product(uuid),
  public.queue_work_order_material_shortage_reconciliation(),
  public.process_work_order_material_shortage_reconciliation_queue()
  from public, anon, authenticated, service_role;
