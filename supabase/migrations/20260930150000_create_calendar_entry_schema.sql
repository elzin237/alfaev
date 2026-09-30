create table public.calendar_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null,
  title text not null,
  start_date date not null,
  end_date date not null,
  description text,
  related_user_id uuid,
  created_at timestamptz not null default pg_catalog.now(),
  created_by_user_id uuid not null,
  updated_at timestamptz not null default pg_catalog.now(),
  updated_by_user_id uuid not null,
  constraint calendar_entries_entry_type_allowed
    check (entry_type in ('business_trip', 'event', 'vacation')),
  constraint calendar_entries_title_trimmed_nonblank
    check (
      title = pg_catalog.btrim(title)
      and pg_catalog.length(title) > 0
    ),
  constraint calendar_entries_description_trimmed_nonblank
    check (
      description is null
      or (
        description = pg_catalog.btrim(description)
        and pg_catalog.length(description) > 0
      )
    ),
  constraint calendar_entries_date_range_valid
    check (end_date >= start_date),
  constraint calendar_entries_related_user_id_fkey
    foreign key (related_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint calendar_entries_created_by_user_id_fkey
    foreign key (created_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint calendar_entries_updated_by_user_id_fkey
    foreign key (updated_by_user_id)
    references public.user_profiles(id)
    on delete restrict
);

create index calendar_entries_date_range_idx
  on public.calendar_entries (start_date, end_date);

alter table public.calendar_entries enable row level security;

revoke all privileges
  on table public.calendar_entries
  from public, anon, authenticated;

grant select
  on table public.calendar_entries
  to authenticated;

create policy calendar_entries_select_active_users
on public.calendar_entries
for select
to authenticated
using (public.is_active_user());
