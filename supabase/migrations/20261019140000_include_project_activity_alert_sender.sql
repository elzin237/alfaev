create or replace function public.post_project_activity(
  p_project_id uuid,
  p_request_id uuid,
  p_title text,
  p_description text,
  p_send_alert boolean
)
returns table (
  activity_id uuid,
  project_id uuid,
  request_id uuid,
  title text,
  description text,
  created_at timestamptz,
  author_user_id uuid,
  alert_sent boolean,
  alert_id uuid,
  recipient_count bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_is_admin boolean;
  actor_profile_id uuid;
  created_activity_id uuid;
  created_alert_id uuid;
  existing_activity record;
  locked_project record;
  normalized_description text;
  normalized_title text;
  recipient_total bigint := 0;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.edit')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_send_alert
    and not (
      public.current_user_is_admin()
      or public.has_permission('projects.alerts.send')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_project_id is null or p_request_id is null or p_send_alert is null then
    raise exception 'Project, request, and alert intent are required'
      using errcode = '22023';
  end if;

  normalized_title := pg_catalog.btrim(p_title);
  normalized_description := pg_catalog.btrim(p_description);

  if normalized_title is null
    or pg_catalog.length(normalized_title) < 1
    or pg_catalog.length(normalized_title) > 120
  then
    raise exception 'Project Activity title must contain between 1 and 120 characters'
      using errcode = '22023';
  end if;

  if normalized_description is null
    or pg_catalog.length(normalized_description) < 1
    or pg_catalog.length(normalized_description) > 5000
  then
    raise exception 'Project Activity description must contain between 1 and 5000 characters'
      using errcode = '22023';
  end if;

  -- Serialize every use of one client request UUID. A failed transaction releases
  -- the key; a committed identical retry returns the original authoritative result.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text, 0)
  );

  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.edit')
    )
    or (
      p_send_alert
      and not (
        public.current_user_is_admin()
        or public.has_permission('projects.alerts.send')
      )
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  select
    activity.id,
    activity.project_id,
    activity.request_id,
    activity.title,
    activity.description,
    activity.created_at,
    activity.author_user_id,
    alert.id as alert_id,
    pg_catalog.count(recipient.id)::bigint as recipient_count
  into existing_activity
  from public.project_activity_updates as activity
  left join public.project_activity_alerts as alert
    on alert.project_activity_id = activity.id
  left join public.project_activity_alert_recipients as recipient
    on recipient.alert_id = alert.id
  where activity.request_id = p_request_id
  group by activity.id, alert.id;

  if found then
    if existing_activity.project_id is distinct from p_project_id
      or existing_activity.title is distinct from normalized_title
      or existing_activity.description is distinct from normalized_description
      or (existing_activity.alert_id is not null) is distinct from p_send_alert
    then
      raise exception 'Project Activity request was already used for different data'
        using errcode = 'PAC01';
    end if;

    return query
    select
      existing_activity.id,
      existing_activity.project_id,
      existing_activity.request_id,
      existing_activity.title,
      existing_activity.description,
      existing_activity.created_at,
      existing_activity.author_user_id,
      existing_activity.alert_id is not null,
      existing_activity.alert_id,
      existing_activity.recipient_count;
    return;
  end if;

  select project.id, project.status
  into locked_project
  from public.projects as project
  where project.id = p_project_id
  for update;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  -- Re-resolve the actor and permissions after every potentially blocking lock.
  select profile.id, profile.is_admin
  into actor_profile_id, actor_is_admin
  from public.user_profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.is_active
  for share;

  if not found then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if not actor_is_admin
    and not exists (
      select 1
      from public.user_permissions as permission
      join public.permission_definitions as definition
        on definition.id = permission.permission_definition_id
      where permission.user_id = actor_profile_id
        and definition.key = 'projects.edit'
        and definition.is_delegable
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_send_alert
    and not actor_is_admin
    and not exists (
      select 1
      from public.user_permissions as permission
      join public.permission_definitions as definition
        on definition.id = permission.permission_definition_id
      where permission.user_id = actor_profile_id
        and definition.key = 'projects.alerts.send'
        and definition.is_delegable
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if locked_project.status not in ('planned', 'in_progress', 'on_hold') then
    raise exception 'Project Activity cannot be posted to this Project'
      using errcode = 'PAC02';
  end if;

  insert into public.project_activity_updates (
    project_id,
    author_user_id,
    request_id,
    title,
    description
  )
  values (
    p_project_id,
    actor_profile_id,
    p_request_id,
    normalized_title,
    normalized_description
  )
  returning id into created_activity_id;

  if p_send_alert then
    insert into public.project_activity_alerts (
      project_activity_id,
      sent_by_user_id
    )
    values (
      created_activity_id,
      actor_profile_id
    )
    returning id into created_alert_id;

    insert into public.project_activity_alert_recipients (
      alert_id,
      recipient_user_id
    )
    select
      created_alert_id,
      eligible_recipient.id
    from (
      select recipient_profile.id
      from public.user_profiles as recipient_profile
      where recipient_profile.is_active
        and exists (
          select 1
          from public.user_permissions as receive_permission
          join public.permission_definitions as receive_definition
            on receive_definition.id = receive_permission.permission_definition_id
          where receive_permission.user_id = recipient_profile.id
            and receive_definition.key = 'projects.alerts.receive'
            and receive_definition.is_delegable
        )
        and (
          recipient_profile.is_admin
          or (
            exists (
              select 1
              from public.user_permissions as dashboard_permission
              join public.permission_definitions as dashboard_definition
                on dashboard_definition.id = dashboard_permission.permission_definition_id
              where dashboard_permission.user_id = recipient_profile.id
                and dashboard_definition.key = 'dashboard.view'
                and dashboard_definition.is_delegable
            )
            and exists (
              select 1
              from public.user_permissions as project_permission
              join public.permission_definitions as project_definition
                on project_definition.id = project_permission.permission_definition_id
              where project_permission.user_id = recipient_profile.id
                and project_definition.key = 'projects.view'
                and project_definition.is_delegable
            )
          )
        )
      order by recipient_profile.id
      for share of recipient_profile
    ) as eligible_recipient;

    get diagnostics recipient_total = row_count;

    if recipient_total = 0 then
      raise exception 'No eligible Project Activity alert recipients'
        using errcode = 'PAC03';
    end if;
  end if;

  perform public.append_audit_log(
    p_action_type => 'project_activity.created',
    p_entity_type => 'project_activity',
    p_summary => 'Posted Project Activity update',
    p_entity_id => created_activity_id,
    p_metadata => pg_catalog.jsonb_build_object(
      'project_id', p_project_id,
      'alert_requested', p_send_alert
    )
  );

  if p_send_alert then
    perform public.append_audit_log(
      p_action_type => 'project_activity.alert_sent',
      p_entity_type => 'project_activity_alert',
      p_summary => 'Sent Project Activity alert',
      p_entity_id => created_alert_id,
      p_metadata => pg_catalog.jsonb_build_object(
        'project_id', p_project_id,
        'activity_id', created_activity_id,
        'recipient_count', recipient_total
      )
    );
  end if;

  return query
  select
    activity.id,
    activity.project_id,
    activity.request_id,
    activity.title,
    activity.description,
    activity.created_at,
    activity.author_user_id,
    created_alert_id is not null,
    created_alert_id,
    recipient_total
  from public.project_activity_updates as activity
  where activity.id = created_activity_id;
end;
$function$;

revoke all privileges
  on function public.post_project_activity(uuid, uuid, text, text, boolean)
  from public, anon, authenticated;

grant execute
  on function public.post_project_activity(uuid, uuid, text, text, boolean)
  to authenticated;

