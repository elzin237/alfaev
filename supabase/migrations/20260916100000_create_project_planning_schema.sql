create table public.project_products (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  name text not null,
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid not null,
  constraint project_products_project_id_fkey
    foreign key (project_id)
    references public.projects(id)
    on delete restrict,
  constraint project_products_created_by_user_id_fkey
    foreign key (created_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint project_products_updated_by_user_id_fkey
    foreign key (updated_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint project_products_name_trimmed_nonblank
    check (
      name = pg_catalog.btrim(name)
      and pg_catalog.length(name) > 0
    )
);

create index project_products_project_id_idx
  on public.project_products (project_id);

create table public.project_product_components (
  id uuid primary key default gen_random_uuid(),
  project_product_id uuid not null,
  product_id uuid not null,
  required_quantity bigint not null,
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid not null,
  constraint project_product_components_project_product_id_fkey
    foreign key (project_product_id)
    references public.project_products(id)
    on delete restrict,
  constraint project_product_components_product_id_fkey
    foreign key (product_id)
    references public.products(id)
    on delete restrict,
  constraint project_product_components_created_by_user_id_fkey
    foreign key (created_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint project_product_components_updated_by_user_id_fkey
    foreign key (updated_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint project_product_components_project_product_product_key
    unique (project_product_id, product_id),
  constraint project_product_components_required_quantity_positive
    check (required_quantity > 0)
);

create index project_product_components_product_id_idx
  on public.project_product_components (product_id);

alter table public.project_products enable row level security;
alter table public.project_product_components enable row level security;

revoke all privileges
  on table public.project_products
  from public, anon, authenticated;

revoke all privileges
  on table public.project_product_components
  from public, anon, authenticated;

grant select
  on table public.project_products
  to authenticated;

grant select
  on table public.project_product_components
  to authenticated;

create policy project_products_select_authorized
on public.project_products
for select
to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('projects.view')
);

create policy project_product_components_select_authorized
on public.project_product_components
for select
to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('projects.view')
);
