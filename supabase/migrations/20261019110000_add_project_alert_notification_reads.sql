create function public.list_project_alert_notifications(
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

create function public.get_project_alert_unread_count()
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
    and recipient.read_at is null;

  return unread_count;
end;
$function$;

revoke all privileges
  on function public.list_project_alert_notifications(integer, timestamptz, uuid)
  from public, anon, authenticated;
revoke all privileges
  on function public.get_project_alert_unread_count()
  from public, anon, authenticated;

grant execute
  on function public.list_project_alert_notifications(integer, timestamptz, uuid)
  to authenticated;
grant execute
  on function public.get_project_alert_unread_count()
  to authenticated;
