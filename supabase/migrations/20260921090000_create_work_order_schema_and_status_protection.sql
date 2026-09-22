create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  work_order_number text not null,
  project_id uuid not null,
  customer_name_snapshot text not null,
  description text not null,
  status text not null default 'draft',
  created_at timestamptz not null default pg_catalog.now(),
  created_by_user_id uuid not null,
  updated_at timestamptz not null default pg_catalog.now(),
  updated_by_user_id uuid not null,
  finished_at timestamptz,
  finished_by_user_id uuid,
  constraint work_orders_work_order_number_key
    unique (work_order_number),
  constraint work_orders_project_id_fkey
    foreign key (project_id)
    references public.projects(id)
    on delete restrict,
  constraint work_orders_created_by_user_id_fkey
    foreign key (created_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint work_orders_updated_by_user_id_fkey
    foreign key (updated_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint work_orders_finished_by_user_id_fkey
    foreign key (finished_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint work_orders_number_format
    check (
      pg_catalog.length(work_order_number) = 12
      and work_order_number ~ '^RN-[0-9]{4}-[0-9]{4}$'
    ),
  constraint work_orders_customer_snapshot_trimmed_nonblank
    check (
      customer_name_snapshot = pg_catalog.btrim(customer_name_snapshot)
      and pg_catalog.length(customer_name_snapshot) > 0
    ),
  constraint work_orders_description_trimmed_nonblank
    check (
      description = pg_catalog.btrim(description)
      and pg_catalog.length(description) > 0
    ),
  constraint work_orders_status_valid
    check (status in ('draft', 'finished')),
  constraint work_orders_finish_state_consistent
    check (
      (
        status = 'draft'
        and finished_at is null
        and finished_by_user_id is null
      )
      or (
        status = 'finished'
        and finished_at is not null
        and finished_by_user_id is not null
      )
    )
);

create index work_orders_project_id_idx
  on public.work_orders (project_id);

create index work_orders_status_idx
  on public.work_orders (status);

create function public.enforce_work_order_lifecycle()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    if old.status = 'finished' then
      raise exception 'Finished Work Orders cannot be deleted'
        using errcode = 'WOR02';
    end if;

    return old;
  end if;

  if old.status = 'finished' then
    raise exception 'Finished Work Orders cannot be modified'
      using errcode = 'WOR02';
  end if;

  if new.work_order_number is distinct from old.work_order_number then
    raise exception 'Work Order number cannot be changed'
      using errcode = 'WOR01';
  end if;

  return new;
end;
$function$;

revoke all privileges
  on function public.enforce_work_order_lifecycle()
  from public, anon, authenticated;

create trigger work_orders_enforce_lifecycle
before update or delete on public.work_orders
for each row
execute function public.enforce_work_order_lifecycle();

alter table public.work_orders enable row level security;

revoke all privileges
  on table public.work_orders
  from public, anon, authenticated;

grant select
  on table public.work_orders
  to authenticated;

create policy work_orders_select_authorized
on public.work_orders
for select
to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('work_orders.view')
);
