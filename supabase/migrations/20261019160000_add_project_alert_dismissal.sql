alter table public.project_activity_alert_recipients
  add column dismissed_at timestamptz;

alter table public.project_activity_alert_recipients
  add constraint project_activity_alert_recipients_dismissed_at_valid
  check (dismissed_at is null or dismissed_at >= created_at);

create or replace function public.enforce_project_activity_alert_recipient_history()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  read_transition boolean;
  dismissal_transition boolean;
begin
  if tg_op = 'INSERT' then
    if new.read_at is not null or new.dismissed_at is not null then
      raise exception 'Project Activity alert recipient must start unread and not dismissed'
        using errcode = '55000';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Project Activity alert recipient history is immutable'
      using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.alert_id is distinct from old.alert_id
    or new.recipient_user_id is distinct from old.recipient_user_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Project Activity alert recipient history is immutable'
      using errcode = '55000';
  end if;

  read_transition := old.read_at is null and new.read_at is not null;
  dismissal_transition := old.dismissed_at is null and new.dismissed_at is not null;

  if (
      new.read_at is distinct from old.read_at
      and not read_transition
    )
    or (
      new.dismissed_at is distinct from old.dismissed_at
      and not dismissal_transition
    )
    or not (read_transition or dismissal_transition)
  then
    raise exception 'Only initial Project Activity alert read or dismissal transitions are allowed'
      using errcode = '55000';
  end if;

  return new;
end;
$function$;

revoke all privileges
  on function public.enforce_project_activity_alert_recipient_history()
  from public, anon, authenticated;

drop index public.project_activity_alert_recipients_inbox_idx;
drop index public.project_activity_alert_recipients_unread_inbox_idx;

create index project_activity_alert_recipients_inbox_idx
  on public.project_activity_alert_recipients (
    recipient_user_id,
    created_at desc,
    id desc
  )
  where dismissed_at is null;

create index project_activity_alert_recipients_unread_inbox_idx
  on public.project_activity_alert_recipients (
    recipient_user_id,
    created_at desc,
    id desc
  )
  where read_at is null
    and dismissed_at is null;

create or replace function public.list_project_alert_notifications(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_recipient_id uuid default null
)
returns table (
  notification_id uuid,
  alert_id uuid,
  project_id uuid,
  project_name text,
  activity_id uuid,
  activity_title text,
  activity_author_full_name text,
  created_at timestamptz,
  read_at timestamptz,
  has_more boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
begin
  actor_profile_id := public.current_active_user_profile_id();

  if auth.uid() is null
    or actor_profile_id is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('dashboard.view')
    )
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Page size must be between 1 and 50'
      using errcode = '22023';
  end if;

  if (p_before_created_at is null) <> (p_before_recipient_id is null) then
    raise exception 'Notification cursor must include both created_at and recipient ID'
      using errcode = '22023';
  end if;

  return query
  with candidates as (
    select
      recipient.id as notification_id,
      recipient.alert_id,
      activity.project_id,
      project.name as project_name,
      activity.id as activity_id,
      activity.title as activity_title,
      author.full_name as activity_author_full_name,
      recipient.created_at,
      recipient.read_at
    from public.project_activity_alert_recipients as recipient
    join public.project_activity_alerts as alert
      on alert.id = recipient.alert_id
    join public.project_activity_updates as activity
      on activity.id = alert.project_activity_id
    join public.projects as project
      on project.id = activity.project_id
    join public.user_profiles as author
      on author.id = activity.author_user_id
    where recipient.recipient_user_id = actor_profile_id
      and recipient.dismissed_at is null
      and (
        p_before_created_at is null
        or (recipient.created_at, recipient.id) <
          (p_before_created_at, p_before_recipient_id)
      )
    order by recipient.created_at desc, recipient.id desc
    limit p_limit + 1
  )
  select
    candidate.notification_id,
    candidate.alert_id,
    candidate.project_id,
    candidate.project_name,
    candidate.activity_id,
    candidate.activity_title,
    candidate.activity_author_full_name,
    candidate.created_at,
    candidate.read_at,
    (select pg_catalog.count(*) > p_limit from candidates) as has_more
  from candidates as candidate
  order by candidate.created_at desc, candidate.notification_id desc
  limit p_limit;
end;
$function$;

create or replace function public.get_project_alert_unread_count()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  unread_count bigint;
begin
  actor_profile_id := public.current_active_user_profile_id();

  if auth.uid() is null
    or actor_profile_id is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('dashboard.view')
    )
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  select pg_catalog.count(*)
  into unread_count
  from public.project_activity_alert_recipients as recipient
  join public.project_activity_alerts as alert
    on alert.id = recipient.alert_id
  join public.project_activity_updates as activity
    on activity.id = alert.project_activity_id
  join public.projects as project
    on project.id = activity.project_id
  join public.user_profiles as author
    on author.id = activity.author_user_id
  where recipient.recipient_user_id = actor_profile_id
    and recipient.read_at is null
    and recipient.dismissed_at is null;

  return unread_count;
end;
$function$;

create function public.dismiss_project_alert_notification(
  p_notification_id uuid
)
returns table (
  notification_id uuid,
  dismissed_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_is_admin boolean;
  actor_profile_id uuid;
  current_notification record;
begin
  if p_notification_id is null then
    raise exception 'Notification is required'
      using errcode = '22023';
  end if;

  if auth.uid() is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  select profile.is_admin
  into actor_is_admin
  from public.user_profiles as profile
  where profile.id = actor_profile_id
    and profile.auth_user_id = auth.uid()
    and profile.is_active
  for share;

  if not found
    or not (
      actor_is_admin
      or public.has_permission('dashboard.view')
    )
    or not (
      actor_is_admin
      or public.has_permission('projects.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  select
    recipient.id,
    recipient.recipient_user_id,
    recipient.created_at,
    recipient.read_at,
    recipient.dismissed_at
  into current_notification
  from public.project_activity_alert_recipients as recipient
  where recipient.id = p_notification_id
    and recipient.recipient_user_id = actor_profile_id
  for update;

  if not found then
    raise exception 'Notification not found'
      using errcode = 'P0002';
  end if;

  if public.current_active_user_profile_id() is distinct from actor_profile_id
    or current_notification.recipient_user_id is distinct from actor_profile_id
    or not (
      public.current_user_is_admin()
      or public.has_permission('dashboard.view')
    )
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if current_notification.dismissed_at is null then
    update public.project_activity_alert_recipients as recipient
    set dismissed_at = greatest(
      pg_catalog.clock_timestamp(),
      current_notification.created_at
    )
    where recipient.id = current_notification.id
      and recipient.dismissed_at is null
    returning recipient.dismissed_at
    into current_notification.dismissed_at;
  end if;

  return query
  select
    current_notification.id::uuid,
    current_notification.dismissed_at::timestamptz;
end;
$function$;

revoke all privileges
  on function public.list_project_alert_notifications(integer, timestamptz, uuid)
  from public, anon, authenticated;
revoke all privileges
  on function public.get_project_alert_unread_count()
  from public, anon, authenticated;
revoke all privileges
  on function public.dismiss_project_alert_notification(uuid)
  from public, anon, authenticated;

grant execute
  on function public.list_project_alert_notifications(integer, timestamptz, uuid)
  to authenticated;
grant execute
  on function public.get_project_alert_unread_count()
  to authenticated;
grant execute
  on function public.dismiss_project_alert_notification(uuid)
  to authenticated;
