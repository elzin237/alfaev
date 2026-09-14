create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  customer_name text not null,
  status text not null default 'planned',
  start_date date not null,
  delivery_date date not null,
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid not null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  constraint projects_created_by_user_id_fkey
    foreign key (created_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint projects_updated_by_user_id_fkey
    foreign key (updated_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint projects_name_trimmed_nonblank
    check (
      name = pg_catalog.btrim(name)
      and pg_catalog.length(name) > 0
    ),
  constraint projects_customer_name_trimmed_nonblank
    check (
      customer_name = pg_catalog.btrim(customer_name)
      and pg_catalog.length(customer_name) > 0
    ),
  constraint projects_status_valid
    check (
      status in (
        'planned',
        'in_progress',
        'on_hold',
        'completed',
        'cancelled'
      )
    ),
  constraint projects_delivery_not_before_start
    check (delivery_date >= start_date),
  constraint projects_completed_at_status_consistent
    check (completed_at is null or status = 'completed'),
  constraint projects_cancelled_at_status_consistent
    check (cancelled_at is null or status = 'cancelled')
);

alter table public.projects enable row level security;

revoke all privileges
  on table public.projects
  from public, anon, authenticated;

grant select
  on table public.projects
  to authenticated;

create policy projects_select_authorized
on public.projects
for select
to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('projects.view')
);
