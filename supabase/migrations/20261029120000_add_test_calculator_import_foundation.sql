-- Import from Test, Phase 1: private inert provenance only. No import/release RPC
-- and no change to effective holds, production, Inventory or existing history.
create table public.test_calculation_imports (
  id uuid primary key default gen_random_uuid(),
  calculation_id uuid not null unique references public.test_calculations(id) on delete restrict,
  pcb_card_id uuid not null unique references public.pcb_cards(id) on delete restrict,
  output_product_id uuid not null unique references public.products(id) on delete restrict,
  initial_bom_version_id uuid not null unique references public.pcb_bom_versions(id) on delete restrict,
  imported_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  imported_at timestamptz not null default pg_catalog.clock_timestamp()
    check (pg_catalog.isfinite(imported_at)),
  request_id uuid not null unique,
  output_serial_number text not null check (output_serial_number ~ '^[0-9]{3}$'),
  submitted_payload jsonb not null check (pg_catalog.jsonb_typeof(submitted_payload) = 'object'),
  import_receipt jsonb not null check (pg_catalog.jsonb_typeof(import_receipt) = 'object'),
  unique (id, calculation_id)
);
create index test_calculation_imports_actor_idx
  on public.test_calculation_imports(imported_by_user_id, imported_at, id);

create table public.test_calculation_import_releases (
  import_id uuid not null,
  calculation_id uuid not null,
  item_id uuid not null,
  product_id uuid not null,
  warehouse_id uuid not null,
  quantity bigint not null check (quantity > 0),
  primary key (item_id, warehouse_id),
  foreign key (import_id, calculation_id)
    references public.test_calculation_imports(id, calculation_id) on delete restrict,
  foreign key (item_id, calculation_id, product_id)
    references public.test_calculation_items(id, calculation_id, product_id) on delete restrict,
  foreign key (item_id, warehouse_id)
    references public.test_calculation_holds(item_id, warehouse_id) on delete restrict
);
create index test_calculation_import_releases_import_idx
  on public.test_calculation_import_releases(import_id);
create index test_calculation_import_releases_stock_idx
  on public.test_calculation_import_releases(product_id, warehouse_id);

alter table public.test_calculation_imports enable row level security;
alter table public.test_calculation_import_releases enable row level security;
revoke all on public.test_calculation_imports, public.test_calculation_import_releases
  from public, anon, authenticated, service_role;

create function public.reject_test_calculation_import_history_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  raise exception 'Test import provenance is immutable' using errcode = '55000';
end;
$function$;
create trigger test_calculation_imports_immutable
before update or delete on public.test_calculation_imports
for each row execute function public.reject_test_calculation_import_history_mutation();
create trigger test_calculation_imports_no_truncate
before truncate on public.test_calculation_imports
for each statement execute function public.reject_test_calculation_import_history_mutation();
create trigger test_calculation_import_releases_immutable
before update or delete on public.test_calculation_import_releases
for each row execute function public.reject_test_calculation_import_history_mutation();
create trigger test_calculation_import_releases_no_truncate
before truncate on public.test_calculation_import_releases
for each statement execute function public.reject_test_calculation_import_history_mutation();

-- Check the completed INSERT set, not a partially populated import transaction.
-- These checks run on INSERT only: normal subsequent BOM version/edit rules remain.
create function public.check_test_calculation_import_consistency()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare conversion public.test_calculation_imports%rowtype; source public.test_calculations%rowtype;
  import_key uuid; expected jsonb; actual jsonb;
begin
  if tg_table_name = 'test_calculation_imports' then import_key := new.id;
  else import_key := new.import_id; end if;
  select imported.* into strict conversion from public.test_calculation_imports imported where imported.id = import_key;
  select calculation.* into strict source from public.test_calculations calculation where calculation.id = conversion.calculation_id;
  if conversion.imported_at < source.created_at
    or not exists (select 1 from public.user_profiles profile where profile.id = conversion.imported_by_user_id
      and profile.auth_user_id = conversion.auth_user_id)
    or not exists (select 1 from public.pcb_cards card join public.products product on product.id = card.output_product_id
      join public.pcb_bom_versions version on version.pcb_card_id = card.id
      where card.id = conversion.pcb_card_id and product.id = conversion.output_product_id
        and product.serial_number = conversion.output_serial_number and product.product_kind = 'pcb_finished_good'
        and card.name = source.name and product.name = source.name
        and version.id = conversion.initial_bom_version_id and version.version_number = 1)
    or conversion.submitted_payload is distinct from pg_catalog.jsonb_build_object(
      'auth_user_id', conversion.auth_user_id, 'calculation_id', conversion.calculation_id,
      'serial_number', conversion.output_serial_number, 'confirmed', true)
    or not (conversion.import_receipt @> pg_catalog.jsonb_build_object(
      'import_id', conversion.id, 'calculation_id', conversion.calculation_id,
      'pcb_card_id', conversion.pcb_card_id, 'output_product_id', conversion.output_product_id,
      'initial_bom_version_id', conversion.initial_bom_version_id, 'serial_number', conversion.output_serial_number))
  then raise exception 'Inconsistent Test import provenance' using errcode = '23514'; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(item.product_id, item.required_quantity::text)
    order by item.product_id), '[]'::jsonb) into expected
    from public.test_calculation_items item where item.calculation_id = source.id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(item.component_product_id, item.quantity_per_card::text)
    order by item.component_product_id), '[]'::jsonb) into actual
    from public.pcb_bom_items item where item.bom_version_id = conversion.initial_bom_version_id;
  if expected = '[]'::jsonb or expected is distinct from actual then
    raise exception 'Imported BOM must match saved Test requirements' using errcode = '23514'; end if;
  -- No prior release mechanism exists. Each selected active hold is released in
  -- full once; never use required_quantity, held totals or another Test's hold.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(hold.item_id, hold.product_id, hold.warehouse_id, hold.quantity::text)
    order by hold.item_id, hold.warehouse_id), '[]'::jsonb) into expected
    from public.test_calculation_holds hold where hold.calculation_id = source.id
      and source.expires_at > conversion.imported_at and hold.quantity > 0;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(released.item_id, released.product_id, released.warehouse_id, released.quantity::text)
    order by released.item_id, released.warehouse_id), '[]'::jsonb) into actual
    from public.test_calculation_import_releases released where released.import_id = conversion.id;
  if expected is distinct from actual then
    raise exception 'Import release allocations must match this Test active holds' using errcode = '23514'; end if;
  return null;
end;
$function$;
create constraint trigger test_calculation_imports_consistent
after insert on public.test_calculation_imports deferrable initially deferred
for each row execute function public.check_test_calculation_import_consistency();
create constraint trigger test_calculation_import_releases_consistent
after insert on public.test_calculation_import_releases deferrable initially deferred
for each row execute function public.check_test_calculation_import_consistency();
revoke all on function public.reject_test_calculation_import_history_mutation(),
  public.check_test_calculation_import_consistency() from public, anon, authenticated, service_role;

comment on table public.test_calculation_import_releases is
  'Private immutable release intent/provenance foundation only; no effective hold consumer recognizes these rows until a separately reviewed forward migration.';
