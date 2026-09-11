create table public.product_suppliers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  supplier_id uuid not null,
  catalog_number text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid not null,
  archived_at timestamptz,
  archived_by_user_id uuid,
  constraint product_suppliers_product_id_fkey
    foreign key (product_id)
    references public.products(id)
    on delete restrict,
  constraint product_suppliers_supplier_id_fkey
    foreign key (supplier_id)
    references public.suppliers(id)
    on delete restrict,
  constraint product_suppliers_created_by_user_id_fkey
    foreign key (created_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint product_suppliers_updated_by_user_id_fkey
    foreign key (updated_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint product_suppliers_archived_by_user_id_fkey
    foreign key (archived_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint product_suppliers_catalog_number_normalized
    check (
      catalog_number is null
      or (
        catalog_number = pg_catalog.btrim(catalog_number)
        and pg_catalog.length(catalog_number) > 0
      )
    ),
  constraint product_suppliers_archive_state_consistent
    check (
      (
        is_active
        and archived_at is null
        and archived_by_user_id is null
      )
      or (
        not is_active
        and archived_at is not null
        and archived_by_user_id is not null
      )
    ),
  constraint product_suppliers_product_supplier_catalog_key
    unique nulls not distinct (product_id, supplier_id, catalog_number)
);

create index product_suppliers_supplier_id_idx
  on public.product_suppliers (supplier_id);

create function public.enforce_product_supplier_lifecycle_immutability()
returns trigger
language plpgsql
volatile
set search_path = ''
as $function$
begin
  if not old.is_active then
    raise exception 'Archived ProductSupplier relationships cannot be modified'
      using errcode = 'PSR01';
  end if;

  return new;
end;
$function$;

revoke all privileges
  on function public.enforce_product_supplier_lifecycle_immutability()
  from public, anon, authenticated;

create trigger product_suppliers_enforce_lifecycle_immutability
before update on public.product_suppliers
for each row
execute function public.enforce_product_supplier_lifecycle_immutability();

alter table public.product_suppliers enable row level security;

revoke all privileges
  on table public.product_suppliers
  from public, anon, authenticated;

grant select
  on table public.product_suppliers
  to authenticated;

create policy product_suppliers_select_authorized
on public.product_suppliers
for select
to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('inventory.view')
  or public.has_permission('suppliers.view')
);
