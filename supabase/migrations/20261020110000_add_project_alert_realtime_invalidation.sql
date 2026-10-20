do $block$
declare
  send_argument_names text[];
  messages_rls_enabled boolean;
  unexpected_policy_names text;
begin
  if pg_catalog.to_regprocedure(
    'realtime.send(jsonb,text,text,boolean)'
  ) is null then
    raise exception 'Required Realtime send function is unavailable'
      using errcode = '55000';
  end if;

  select routine.proargnames
  into send_argument_names
  from pg_catalog.pg_proc as routine
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = routine.pronamespace
  where namespace.nspname = 'realtime'
    and routine.oid = 'realtime.send(jsonb,text,text,boolean)'::pg_catalog.regprocedure;

  if send_argument_names is distinct from
    array['payload', 'event', 'topic', 'private']::text[]
  then
    raise exception 'Required Realtime send named-parameter contract is unavailable'
      using errcode = '55000';
  end if;

  select relation.relrowsecurity
  into messages_rls_enabled
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'realtime'
    and relation.relname = 'messages'
    and relation.relkind in ('r', 'p');

  if messages_rls_enabled is distinct from true then
    raise exception 'Realtime messages RLS must already be enabled'
      using errcode = '55000';
  end if;

  select pg_catalog.string_agg(policy.policyname, ', ' order by policy.policyname)
  into unexpected_policy_names
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'realtime'
    and policy.tablename = 'messages';

  if unexpected_policy_names is not null then
    raise exception 'Unexpected Realtime messages policies: %', unexpected_policy_names
      using errcode = '55000';
  end if;
end;
$block$;

create function public.broadcast_project_alert_notification_invalidation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT'
    or (
      tg_op = 'UPDATE'
      and (
        (old.read_at is null and new.read_at is not null)
        or (
          old.dismissed_at is null
          and new.dismissed_at is not null
        )
      )
    )
  then
    perform realtime.send(
      payload := '{}'::jsonb,
      event := 'invalidate',
      topic := 'project-alert-notifications:'
        || new.recipient_user_id::text,
      private := true
    );
  end if;

  return new;
end;
$function$;

revoke all privileges
  on function public.broadcast_project_alert_notification_invalidation()
  from public, anon, authenticated, service_role;

create trigger broadcast_project_alert_notification_invalidation
after insert or update of read_at, dismissed_at
on public.project_activity_alert_recipients
for each row
execute function public.broadcast_project_alert_notification_invalidation();

create policy project_alert_notification_invalidation_select_own
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) =
    'project-alert-notifications:'
      || public.current_active_user_profile_id()::text
  and public.current_active_user_profile_id() is not null
  and (
    public.current_user_is_admin()
    or (
      public.has_permission('dashboard.view')
      and public.has_permission('projects.view')
    )
  )
);
