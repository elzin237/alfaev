-- Supplier catalog provenance is authoritative only when it is explicitly
-- present. Refuse deployment while an active legacy relationship is missing it.
do $block$
begin
  if exists (
    select 1
    from public.product_suppliers as relationship
    where relationship.is_active
      and relationship.catalog_number is null
  ) then
    raise exception 'Active ProductSupplier Catalog Numbers must be resolved before provenance migration'
      using errcode = 'PSR05';
  end if;
end;
$block$;

alter table public.product_suppliers
  add column description text;

alter table public.product_suppliers
  add constraint product_suppliers_description_normalized
    check (
      description is null
      or (
        description = pg_catalog.btrim(description)
        and pg_catalog.length(description) > 0
      )
    ),
  add constraint product_suppliers_active_catalog_required
    check (not is_active or catalog_number is not null),
  add constraint product_suppliers_id_product_key
    unique (id, product_id),
  add constraint product_suppliers_id_supplier_key
    unique (id, supplier_id);

alter table public.inventory_movements
  add constraint inventory_movements_id_product_key
    unique (id, product_id);

create table public.inventory_source_lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  source_kind text not null,
  product_supplier_id uuid,
  supplier_id uuid,
  supplier_name_snapshot text,
  catalog_number_snapshot text,
  supplier_description_snapshot text,
  received_quantity bigint not null,
  remaining_quantity bigint not null,
  originating_inventory_movement_id uuid,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  actor_user_id uuid,
  constraint inventory_source_lots_product_id_fkey
    foreign key (product_id) references public.products(id) on delete restrict,
  constraint inventory_source_lots_product_supplier_id_fkey
    foreign key (product_supplier_id) references public.product_suppliers(id) on delete restrict,
  constraint inventory_source_lots_product_supplier_product_fkey
    foreign key (product_supplier_id, product_id)
    references public.product_suppliers(id, product_id) on delete restrict,
  constraint inventory_source_lots_product_supplier_supplier_fkey
    foreign key (product_supplier_id, supplier_id)
    references public.product_suppliers(id, supplier_id) on delete restrict,
  constraint inventory_source_lots_supplier_id_fkey
    foreign key (supplier_id) references public.suppliers(id) on delete restrict,
  constraint inventory_source_lots_originating_movement_id_fkey
    foreign key (originating_inventory_movement_id)
    references public.inventory_movements(id) on delete restrict,
  constraint inventory_source_lots_originating_movement_product_fkey
    foreign key (originating_inventory_movement_id, product_id)
    references public.inventory_movements(id, product_id) on delete restrict,
  constraint inventory_source_lots_actor_user_id_fkey
    foreign key (actor_user_id) references public.user_profiles(id) on delete restrict,
  constraint inventory_source_lots_source_kind_valid
    check (source_kind in ('supplier', 'legacy_unknown', 'internal_production')),
  constraint inventory_source_lots_quantities_valid
    check (
      received_quantity > 0
      and remaining_quantity >= 0
      and remaining_quantity <= received_quantity
    ),
  constraint inventory_source_lots_supplier_name_normalized
    check (
      supplier_name_snapshot is null
      or (
        supplier_name_snapshot = pg_catalog.btrim(supplier_name_snapshot)
        and pg_catalog.length(supplier_name_snapshot) > 0
      )
    ),
  constraint inventory_source_lots_catalog_number_normalized
    check (
      catalog_number_snapshot is null
      or (
        catalog_number_snapshot = pg_catalog.btrim(catalog_number_snapshot)
        and pg_catalog.length(catalog_number_snapshot) > 0
      )
    ),
  constraint inventory_source_lots_supplier_description_normalized
    check (
      supplier_description_snapshot is null
      or (
        supplier_description_snapshot = pg_catalog.btrim(supplier_description_snapshot)
        and pg_catalog.length(supplier_description_snapshot) > 0
      )
    ),
  constraint inventory_source_lots_source_context_valid
    check (
      (
        source_kind = 'supplier'
        and product_supplier_id is not null
        and supplier_id is not null
        and supplier_name_snapshot is not null
        and catalog_number_snapshot is not null
        and originating_inventory_movement_id is not null
        and actor_user_id is not null
      )
      or (
        source_kind = 'legacy_unknown'
        and product_supplier_id is null
        and supplier_id is null
        and supplier_name_snapshot is null
        and catalog_number_snapshot is null
        and supplier_description_snapshot is null
        and originating_inventory_movement_id is null
        and actor_user_id is null
      )
      or (
        source_kind = 'internal_production'
        and product_supplier_id is null
        and supplier_id is null
        and supplier_name_snapshot is null
        and catalog_number_snapshot is null
        and supplier_description_snapshot is null
        and originating_inventory_movement_id is not null
        and actor_user_id is not null
      )
    ),
  constraint inventory_source_lots_originating_movement_key
    unique (originating_inventory_movement_id),
  constraint inventory_source_lots_id_product_key
    unique (id, product_id)
);

create index inventory_source_lots_fifo_idx
  on public.inventory_source_lots (product_id, received_at, id)
  where remaining_quantity > 0;

create index inventory_source_lots_product_supplier_idx
  on public.inventory_source_lots (product_supplier_id)
  where product_supplier_id is not null;

create table public.inventory_source_allocations (
  id uuid primary key default gen_random_uuid(),
  outbound_inventory_movement_id uuid not null,
  source_lot_id uuid not null,
  product_id uuid not null,
  allocated_quantity bigint not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint inventory_source_allocations_outbound_movement_id_fkey
    foreign key (outbound_inventory_movement_id)
    references public.inventory_movements(id) on delete restrict,
  constraint inventory_source_allocations_outbound_movement_product_fkey
    foreign key (outbound_inventory_movement_id, product_id)
    references public.inventory_movements(id, product_id) on delete restrict,
  constraint inventory_source_allocations_source_lot_id_fkey
    foreign key (source_lot_id)
    references public.inventory_source_lots(id) on delete restrict,
  constraint inventory_source_allocations_source_lot_product_fkey
    foreign key (source_lot_id, product_id)
    references public.inventory_source_lots(id, product_id) on delete restrict,
  constraint inventory_source_allocations_product_id_fkey
    foreign key (product_id) references public.products(id) on delete restrict,
  constraint inventory_source_allocations_quantity_positive
    check (allocated_quantity > 0),
  constraint inventory_source_allocations_movement_lot_key
    unique (outbound_inventory_movement_id, source_lot_id)
);

create index inventory_source_allocations_source_lot_idx
  on public.inventory_source_allocations (source_lot_id, created_at, id);

create index inventory_source_allocations_product_idx
  on public.inventory_source_allocations (product_id, created_at desc, id desc);

comment on table public.inventory_source_lots is
  'Immutable stock receipt provenance. Only remaining_quantity may decrease through trusted FIFO consumption.';
comment on column public.inventory_source_lots.received_at is
  'Receipt timestamp; legacy_unknown backfill rows use this migration timestamp and do not claim a historical receipt date.';
comment on table public.inventory_source_allocations is
  'Immutable attribution of an outbound InventoryMovement to exact inbound source lots.';

create function public.enforce_inventory_source_lot_immutability()
returns trigger
language plpgsql
volatile
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Inventory source lots cannot be deleted'
      using errcode = 'IVL01';
  end if;

  if new.id is distinct from old.id
    or new.product_id is distinct from old.product_id
    or new.source_kind is distinct from old.source_kind
    or new.product_supplier_id is distinct from old.product_supplier_id
    or new.supplier_id is distinct from old.supplier_id
    or new.supplier_name_snapshot is distinct from old.supplier_name_snapshot
    or new.catalog_number_snapshot is distinct from old.catalog_number_snapshot
    or new.supplier_description_snapshot is distinct from old.supplier_description_snapshot
    or new.received_quantity is distinct from old.received_quantity
    or new.originating_inventory_movement_id is distinct from old.originating_inventory_movement_id
    or new.received_at is distinct from old.received_at
    or new.actor_user_id is distinct from old.actor_user_id
    or new.remaining_quantity > old.remaining_quantity
  then
    raise exception 'Inventory source lot history is immutable'
      using errcode = 'IVL01';
  end if;

  return new;
end;
$function$;

create trigger inventory_source_lots_enforce_immutability
before update or delete on public.inventory_source_lots
for each row execute function public.enforce_inventory_source_lot_immutability();

create function public.prevent_inventory_source_allocation_mutation()
returns trigger
language plpgsql
volatile
set search_path = ''
as $function$
begin
  raise exception 'Inventory source allocations are immutable'
    using errcode = 'IVL01';
  return old;
end;
$function$;

create trigger inventory_source_allocations_reject_update_delete
before update or delete on public.inventory_source_allocations
for each row execute function public.prevent_inventory_source_allocation_mutation();

revoke all privileges
  on function public.enforce_inventory_source_lot_immutability()
  from public, anon, authenticated;
revoke all privileges
  on function public.prevent_inventory_source_allocation_mutation()
  from public, anon, authenticated;

alter table public.inventory_source_lots enable row level security;
alter table public.inventory_source_allocations enable row level security;
revoke all privileges on table public.inventory_source_lots from public, anon, authenticated;
revoke all privileges on table public.inventory_source_allocations from public, anon, authenticated;

-- Existing positive balances predate source provenance. Represent only the
-- currently remaining quantity and make no claim about Supplier or receipt history.
insert into public.inventory_source_lots (
  product_id,
  source_kind,
  received_quantity,
  remaining_quantity,
  received_at
)
select
  balance.product_id,
  'legacy_unknown',
  balance.quantity,
  balance.quantity,
  pg_catalog.transaction_timestamp()
from public.inventory_balances as balance
where balance.quantity > 0
order by balance.product_id;

create function public.check_inventory_source_lot_balance()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  checked_product_id uuid;
  balance_quantity bigint;
  lot_quantity numeric;
begin
  if tg_op = 'DELETE' then
    checked_product_id := old.product_id;
  else
    checked_product_id := new.product_id;
  end if;

  select balance.quantity
  into balance_quantity
  from public.inventory_balances as balance
  where balance.product_id = checked_product_id;

  select coalesce(pg_catalog.sum(lot.remaining_quantity::numeric), 0::numeric)
  into lot_quantity
  from public.inventory_source_lots as lot
  where lot.product_id = checked_product_id;

  if balance_quantity is null or lot_quantity <> balance_quantity::numeric then
    raise exception 'Inventory balance and source lots diverged for Product %', checked_product_id
      using errcode = 'IVL02';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all privileges
  on function public.check_inventory_source_lot_balance()
  from public, anon, authenticated;

create constraint trigger inventory_balances_check_source_lot_balance
after insert or update or delete on public.inventory_balances
deferrable initially deferred
for each row execute function public.check_inventory_source_lot_balance();

create constraint trigger inventory_source_lots_check_balance
after insert or update or delete on public.inventory_source_lots
deferrable initially deferred
for each row execute function public.check_inventory_source_lot_balance();

create function public.check_inventory_source_lot_allocation_accounting()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  checked_source_lot_id uuid;
  received_quantity bigint;
  remaining_quantity bigint;
  allocated_quantity numeric;
begin
  if tg_table_name = 'inventory_source_allocations' then
    if tg_op = 'DELETE' then
      checked_source_lot_id := old.source_lot_id;
    else
      checked_source_lot_id := new.source_lot_id;
    end if;
  else
    if tg_op = 'DELETE' then
      checked_source_lot_id := old.id;
    else
      checked_source_lot_id := new.id;
    end if;
  end if;

  select lot.received_quantity, lot.remaining_quantity
  into received_quantity, remaining_quantity
  from public.inventory_source_lots as lot
  where lot.id = checked_source_lot_id;

  if not found then
    raise exception 'Inventory source lot accounting target is missing'
      using errcode = 'IVL02';
  end if;

  select coalesce(pg_catalog.sum(allocation.allocated_quantity::numeric), 0::numeric)
  into allocated_quantity
  from public.inventory_source_allocations as allocation
  where allocation.source_lot_id = checked_source_lot_id;

  if allocated_quantity <> (received_quantity - remaining_quantity)::numeric then
    raise exception 'Inventory source lot allocation accounting diverged for lot %',
      checked_source_lot_id using errcode = 'IVL02';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all privileges
  on function public.check_inventory_source_lot_allocation_accounting()
  from public, anon, authenticated;

create constraint trigger inventory_source_lots_check_allocation_accounting
after insert or update or delete on public.inventory_source_lots
deferrable initially deferred
for each row execute function public.check_inventory_source_lot_allocation_accounting();

create constraint trigger inventory_source_allocations_check_accounting
after insert or update or delete on public.inventory_source_allocations
deferrable initially deferred
for each row execute function public.check_inventory_source_lot_allocation_accounting();
