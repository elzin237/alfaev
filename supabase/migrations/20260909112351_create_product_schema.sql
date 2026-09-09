create table public.products (
  id uuid primary key default gen_random_uuid(),
  serial_number text not null,
  name text not null,
  category text not null,
  brand_id uuid,
  product_kind text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid not null,
  archived_at timestamptz,
  archived_by_user_id uuid,
  constraint products_serial_number_key unique (serial_number),
  constraint products_brand_id_fkey
    foreign key (brand_id)
    references public.brands(id)
    on delete restrict,
  constraint products_created_by_user_id_fkey
    foreign key (created_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint products_updated_by_user_id_fkey
    foreign key (updated_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint products_archived_by_user_id_fkey
    foreign key (archived_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint products_serial_number_format
    check (serial_number ~ '^[0-9]{7}$'),
  constraint products_name_trimmed_nonblank
    check (
      name = pg_catalog.btrim(name)
      and pg_catalog.length(name) > 0
    ),
  constraint products_category_trimmed_nonblank
    check (
      category = pg_catalog.btrim(category)
      and pg_catalog.length(category) > 0
    ),
  constraint products_kind_valid
    check (product_kind in ('component', 'pcb_finished_good')),
  constraint products_archive_state_consistent
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
    )
);

create function public.enforce_product_lifecycle_immutability()
returns trigger
language plpgsql
volatile
set search_path = ''
as $function$
begin
  if not old.is_active then
    raise exception 'Archived Products cannot be modified'
      using errcode = 'PRD01';
  end if;

  if new.product_kind is distinct from old.product_kind then
    raise exception 'Product kind cannot be changed'
      using errcode = 'PRD02';
  end if;

  return new;
end;
$function$;

revoke all privileges
  on function public.enforce_product_lifecycle_immutability()
  from public, anon, authenticated;

create trigger products_enforce_lifecycle_immutability
before update on public.products
for each row
execute function public.enforce_product_lifecycle_immutability();

alter table public.products enable row level security;

revoke all privileges
  on table public.products
  from public, anon, authenticated;

grant select
  on table public.products
  to authenticated;

create policy products_select_inventory_readers
on public.products
for select
to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('inventory.view')
);
