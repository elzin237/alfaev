create function public.mark_project_alert_read(
  p_notification_id uuid
)
returns table (
  notification_id uuid,
  read_at timestamptz
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
    recipient.alert_id,
    recipient.recipient_user_id,
    recipient.created_at,
    recipient.read_at
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

  if current_notification.read_at is null then
    update public.project_activity_alert_recipients as recipient
    set read_at = greatest(
      pg_catalog.clock_timestamp(),
      current_notification.created_at
    )
    where recipient.id = current_notification.id
      and recipient.read_at is null
    returning recipient.read_at
    into current_notification.read_at;
  end if;

  return query
  select
    current_notification.id::uuid,
    current_notification.read_at::timestamptz;
end;
$function$;

revoke all privileges
  on function public.mark_project_alert_read(uuid)
  from public, anon, authenticated;

grant execute
  on function public.mark_project_alert_read(uuid)
  to authenticated;
