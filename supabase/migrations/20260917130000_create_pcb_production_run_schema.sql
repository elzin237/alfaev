-- The composite key supports a declarative guarantee that a production run's
-- BOM version belongs to the same PCB Card. Its ID is already globally unique.
alter table public.pcb_bom_versions
  add constraint pcb_bom_versions_card_id_id_key unique (pcb_card_id, id);

create table public.pcb_production_runs (
  id uuid primary key default gen_random_uuid(),
  pcb_card_id uuid not null,
  bom_version_id uuid not null,
  project_id uuid,
  quantity_produced bigint not null,
  status text not null default 'completed',
  produced_by_user_id uuid not null,
  completed_at timestamptz not null default pg_catalog.now(),
  constraint pcb_production_runs_pcb_card_id_fkey
    foreign key (pcb_card_id) references public.pcb_cards(id) on delete restrict,
  constraint pcb_production_runs_card_bom_version_fkey
    foreign key (pcb_card_id, bom_version_id)
    references public.pcb_bom_versions(pcb_card_id, id) on delete restrict,
  constraint pcb_production_runs_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete restrict,
  constraint pcb_production_runs_produced_by_user_id_fkey
    foreign key (produced_by_user_id) references public.user_profiles(id) on delete restrict,
  constraint pcb_production_runs_quantity_positive
    check (quantity_produced > 0),
  constraint pcb_production_runs_status_completed
    check (status = 'completed')
);

create index pcb_production_runs_bom_version_id_idx
  on public.pcb_production_runs (bom_version_id);
create index pcb_production_runs_card_history_idx
  on public.pcb_production_runs (pcb_card_id, completed_at desc, id desc);
create index pcb_production_runs_project_id_idx
  on public.pcb_production_runs (project_id)
  where project_id is not null;

create function public.prevent_pcb_production_run_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception 'PCB production runs are immutable'
    using errcode = 'PCB08';
  return old;
end;
$function$;

revoke all privileges on function public.prevent_pcb_production_run_mutation()
  from public, anon, authenticated;

create trigger pcb_production_runs_reject_update_delete
before update or delete on public.pcb_production_runs
for each row
execute function public.prevent_pcb_production_run_mutation();

alter table public.pcb_production_runs enable row level security;

revoke all privileges on table public.pcb_production_runs
  from public, anon, authenticated;
grant select on table public.pcb_production_runs to authenticated;

create policy pcb_production_runs_select_pcb_readers
on public.pcb_production_runs
for select to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('pcb.view')
);
