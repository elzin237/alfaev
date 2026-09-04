create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  action_type text not null,
  entity_type text not null,
  entity_id uuid,
  summary text not null,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb,
  created_at timestamptz not null default now(),

  constraint audit_logs_actor_user_id_fkey
    foreign key (actor_user_id)
    references public.user_profiles (id)
    on delete restrict,
  constraint audit_logs_action_type_not_blank
    check (length(btrim(action_type)) > 0),
  constraint audit_logs_entity_type_not_blank
    check (length(btrim(entity_type)) > 0),
  constraint audit_logs_summary_not_blank
    check (length(btrim(summary)) > 0)
);

create index audit_logs_created_at_id_idx
  on public.audit_logs (created_at desc, id desc);
create index audit_logs_actor_user_id_created_at_id_idx
  on public.audit_logs (actor_user_id, created_at desc, id desc);
create index audit_logs_entity_type_created_at_id_idx
  on public.audit_logs (entity_type, created_at desc, id desc);
create index audit_logs_action_type_created_at_id_idx
  on public.audit_logs (action_type, created_at desc, id desc);

create function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception 'Audit logs are immutable'
    using errcode = '55000';

  return old;
end;
$function$;

create trigger audit_logs_reject_update_delete
before update or delete
on public.audit_logs
for each row
execute function public.prevent_audit_log_mutation();

alter table public.audit_logs enable row level security;

revoke all privileges
  on table public.audit_logs
  from public, anon, authenticated;
revoke all privileges
  on function public.prevent_audit_log_mutation()
  from public, anon, authenticated;
