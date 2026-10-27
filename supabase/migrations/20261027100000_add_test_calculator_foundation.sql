-- TC-02: private, non-operational foundation only. No Save/Preview RPC, stock
-- protection, physical mutation, expiry job or permission assignment is added.
insert into public.permission_definitions (key, module, label, description, is_delegable)
values
  ('test_calculator.view', 'test_calculator', 'View Test Calculator',
   'View shared Test Calculator history through future authorized reads.', true),
  ('test_calculator.manage', 'test_calculator', 'Manage Test Calculator',
   'Save Test Calculations through a future trusted operation; not stock adjustment authority.', true);

create table public.test_calculations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = pg_catalog.btrim(name) and pg_catalog.length(name) > 0),
  created_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  deadline_date date not null check (pg_catalog.isfinite(deadline_date)),
  deadline_timezone text not null default 'Europe/Sarajevo'
    check (deadline_timezone = 'Europe/Sarajevo'),
  expires_at timestamptz not null,
  request_id uuid not null unique,
  submitted_payload jsonb not null check (pg_catalog.jsonb_typeof(submitted_payload) = 'object'),
  save_receipt jsonb not null check (pg_catalog.jsonb_typeof(save_receipt) = 'object'),
  constraint test_calculations_expiry_valid check (
    pg_catalog.isfinite(created_at) and pg_catalog.isfinite(expires_at)
    and expires_at > created_at
    and expires_at = ((deadline_date + 1)::timestamp at time zone 'Europe/Sarajevo')
  )
);
create index test_calculations_history_idx on public.test_calculations (created_at desc, id desc);
create index test_calculations_expiry_idx on public.test_calculations (expires_at, id);
create index test_calculations_creator_idx on public.test_calculations (created_by_user_id, id);

create table public.test_calculation_items (
  id uuid primary key default gen_random_uuid(),
  calculation_id uuid not null references public.test_calculations(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name_snapshot text not null check (
    product_name_snapshot = pg_catalog.btrim(product_name_snapshot)
    and pg_catalog.length(product_name_snapshot) > 0),
  serial_number_snapshot text not null check (serial_number_snapshot ~ '^([0-9]{3}|[0-9]{7})$'),
  product_kind_snapshot text not null check (product_kind_snapshot in ('component', 'pcb_finished_good')),
  required_quantity bigint not null check (required_quantity > 0),
  held_quantity bigint not null check (held_quantity >= 0),
  uncovered_quantity bigint not null check (uncovered_quantity >= 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (calculation_id, product_id),
  unique (id, calculation_id, product_id),
  constraint test_calculation_items_quantities_match check (
    required_quantity::numeric = held_quantity::numeric + uncovered_quantity::numeric
  )
);
create index test_calculation_items_product_idx on public.test_calculation_items (product_id, calculation_id);

create table public.test_calculation_holds (
  item_id uuid not null,
  calculation_id uuid not null,
  product_id uuid not null,
  warehouse_id uuid not null references public.inventory_warehouses(id) on delete restrict,
  quantity bigint not null check (quantity >= 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (item_id, warehouse_id),
  foreign key (item_id, calculation_id, product_id)
    references public.test_calculation_items(id, calculation_id, product_id) on delete restrict
);
create index test_calculation_holds_stock_idx
  on public.test_calculation_holds (product_id, warehouse_id, calculation_id) where quantity > 0;
create index test_calculation_holds_calculation_idx on public.test_calculation_holds (calculation_id);

alter table public.test_calculations enable row level security;
alter table public.test_calculation_items enable row level security;
alter table public.test_calculation_holds enable row level security;
-- No SELECT policies or grants yet: even an Admin JWT cannot read private receipts.
revoke all on public.test_calculations, public.test_calculation_items,
  public.test_calculation_holds from public, anon, authenticated, service_role;

create function public.reject_test_calculator_history_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  raise exception 'Saved Test Calculator history is immutable' using errcode = '55000';
end;
$function$;
create trigger test_calculations_immutable before update or delete on public.test_calculations
  for each row execute function public.reject_test_calculator_history_mutation();
create trigger test_calculation_items_immutable before update or delete on public.test_calculation_items
  for each row execute function public.reject_test_calculator_history_mutation();
create trigger test_calculation_holds_immutable before update or delete on public.test_calculation_holds
  for each row execute function public.reject_test_calculator_history_mutation();
create trigger test_calculations_no_truncate before truncate on public.test_calculations
  for each statement execute function public.reject_test_calculator_history_mutation();
create trigger test_calculation_items_no_truncate before truncate on public.test_calculation_items
  for each statement execute function public.reject_test_calculator_history_mutation();
create trigger test_calculation_holds_no_truncate before truncate on public.test_calculation_holds
  for each statement execute function public.reject_test_calculator_history_mutation();
revoke all on function public.reject_test_calculator_history_mutation()
  from public, anon, authenticated, service_role;

-- Row checks alone cannot verify a sum across warehouses. Defer this private,
-- invoker-only consistency check until all item/hold inserts in one Save exist.
create function public.check_test_calculator_hold_total()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare item_key uuid; expected bigint; actual numeric;
begin
  if tg_table_name = 'test_calculation_items' then item_key := new.id;
  else item_key := new.item_id; end if;
  select item.held_quantity into expected from public.test_calculation_items item where item.id = item_key;
  select coalesce(pg_catalog.sum(hold.quantity::numeric), 0::numeric) into actual
    from public.test_calculation_holds hold where hold.item_id = item_key;
  if expected is null or expected::numeric <> actual then
    raise exception 'Test hold quantities do not match saved item' using errcode = '23514';
  end if;
  return null;
end;
$function$;
create constraint trigger test_calculation_items_hold_total
  after insert on public.test_calculation_items deferrable initially deferred
  for each row execute function public.check_test_calculator_hold_total();
create constraint trigger test_calculation_holds_item_total
  after insert on public.test_calculation_holds deferrable initially deferred
  for each row execute function public.check_test_calculator_hold_total();
revoke all on function public.check_test_calculator_hold_total()
  from public, anon, authenticated, service_role;

comment on table public.test_calculations is
  'Immutable Test Save identity/receipt foundation. No application read or mutation activation.';
comment on table public.test_calculation_holds is
  'Retained warehouse quantities; future reads use parent expires_at > database time. No stock protection is enabled by this migration.';
