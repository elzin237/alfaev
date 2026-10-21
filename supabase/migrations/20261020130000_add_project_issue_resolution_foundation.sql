alter table public.project_activity_updates
  add column activity_kind text not null default 'general';

alter table public.project_activity_updates
  add constraint project_activity_updates_activity_kind_allowed
  check (activity_kind in ('general', 'issue'));

create table public.project_issue_resolutions (
  id uuid primary key default gen_random_uuid(),
  project_activity_id uuid not null,
  request_id uuid not null,
  resolved_by_user_id uuid not null,
  description text not null,
  resolved_at timestamptz not null default now(),

  constraint project_issue_resolutions_activity_id_fkey
    foreign key (project_activity_id)
    references public.project_activity_updates(id)
    on delete restrict,
  constraint project_issue_resolutions_request_id_key
    unique (request_id),
  constraint project_issue_resolutions_activity_id_key
    unique (project_activity_id),
  constraint project_issue_resolutions_id_activity_key
    unique (id, project_activity_id),
  constraint project_issue_resolutions_resolver_id_fkey
    foreign key (resolved_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint project_issue_resolutions_description_normalized
    check (
      description = btrim(description)
      and char_length(description) between 1 and 5000
    )
);

create trigger project_issue_resolutions_reject_update_delete
before update or delete on public.project_issue_resolutions
for each row
execute function public.prevent_project_activity_history_mutation();

alter table public.project_issue_resolutions enable row level security;

revoke all privileges
  on table public.project_issue_resolutions
  from public, anon, authenticated;

alter table public.project_activity_alerts
  add column notification_kind text not null default 'activity',
  add column project_id uuid,
  add column project_issue_resolution_id uuid;

alter table public.project_activity_alerts
  alter column project_activity_id drop not null,
  drop constraint project_activity_alerts_activity_id_key,
  add constraint project_activity_alerts_project_id_fkey
    foreign key (project_id)
    references public.projects(id)
    on delete restrict,
  add constraint project_activity_alerts_resolution_target_fkey
    foreign key (project_issue_resolution_id, project_activity_id)
    references public.project_issue_resolutions(id, project_activity_id)
    on delete restrict,
  add constraint project_activity_alerts_notification_kind_allowed
    check (notification_kind in ('activity', 'issue_resolved', 'shortage')),
  add constraint project_activity_alerts_target_valid
    check (
      (
        notification_kind = 'activity'
        and project_activity_id is not null
        and project_issue_resolution_id is null
        and project_id is null
      )
      or (
        notification_kind = 'issue_resolved'
        and project_activity_id is not null
        and project_issue_resolution_id is not null
        and project_id is null
      )
      or (
        notification_kind = 'shortage'
        and project_activity_id is null
        and project_issue_resolution_id is null
        and project_id is not null
      )
    );

create unique index project_activity_alerts_activity_notification_key
  on public.project_activity_alerts (project_activity_id)
  where notification_kind = 'activity';

create unique index project_activity_alerts_resolution_notification_key
  on public.project_activity_alerts (project_issue_resolution_id)
  where notification_kind = 'issue_resolved';

create function public.post_project_activity(
  p_project_id uuid,
  p_request_id uuid,
  p_title text,
  p_description text,
  p_send_alert boolean,
  p_activity_kind text
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
  normalized_activity_kind text;
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

  if p_project_id is null
    or p_request_id is null
    or p_send_alert is null
    or p_activity_kind is null
  then
    raise exception 'Project, request, Activity kind, and alert intent are required'
      using errcode = '22023';
  end if;

  normalized_activity_kind := pg_catalog.lower(pg_catalog.btrim(p_activity_kind));
  normalized_title := pg_catalog.btrim(p_title);
  normalized_description := pg_catalog.btrim(p_description);

  if normalized_activity_kind not in ('general', 'issue') then
    raise exception 'Project Activity kind must be general or issue'
      using errcode = '22023';
  end if;

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
    activity.activity_kind,
    alert.id as alert_id,
    pg_catalog.count(recipient.id)::bigint as recipient_count
  into existing_activity
  from public.project_activity_updates as activity
  left join public.project_activity_alerts as alert
    on alert.project_activity_id = activity.id
    and alert.notification_kind = 'activity'
  left join public.project_activity_alert_recipients as recipient
    on recipient.alert_id = alert.id
  where activity.request_id = p_request_id
  group by activity.id, alert.id;

  if found then
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

    if existing_activity.author_user_id is distinct from actor_profile_id then
      raise exception 'Access denied'
        using errcode = '42501';
    end if;

    if existing_activity.project_id is distinct from p_project_id
      or existing_activity.title is distinct from normalized_title
      or existing_activity.description is distinct from normalized_description
      or existing_activity.activity_kind is distinct from normalized_activity_kind
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
    description,
    activity_kind
  )
  values (
    p_project_id,
    actor_profile_id,
    p_request_id,
    normalized_title,
    normalized_description,
    normalized_activity_kind
  )
  returning id into created_activity_id;

  if p_send_alert then
    insert into public.project_activity_alerts (
      project_activity_id,
      sent_by_user_id,
      notification_kind
    )
    values (
      created_activity_id,
      actor_profile_id,
      'activity'
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
        and (
          recipient_profile.is_admin
          or (
            exists (
              select 1
              from public.user_permissions as receive_permission
              join public.permission_definitions as receive_definition
                on receive_definition.id = receive_permission.permission_definition_id
              where receive_permission.user_id = recipient_profile.id
                and receive_definition.key = 'projects.alerts.receive'
                and receive_definition.is_delegable
            )
            and exists (
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
language sql
volatile
security definer
set search_path = ''
as $function$
  select *
  from public.post_project_activity(
    p_project_id,
    p_request_id,
    p_title,
    p_description,
    p_send_alert,
    'general'
  );
$function$;

create function public.resolve_project_issue(
  p_project_activity_id uuid,
  p_request_id uuid,
  p_description text
)
returns table (
  resolution_id uuid,
  project_activity_id uuid,
  project_id uuid,
  request_id uuid,
  resolved_by_user_id uuid,
  resolver_full_name text,
  description text,
  resolved_at timestamptz,
  notification_id uuid,
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
  created_notification_id uuid;
  created_resolution_id uuid;
  existing_resolution record;
  locked_activity record;
  locked_project record;
  normalized_description text;
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

  if p_project_activity_id is null or p_request_id is null then
    raise exception 'Issue and resolution request are required'
      using errcode = '22023';
  end if;

  normalized_description := pg_catalog.btrim(p_description);
  if normalized_description is null
    or pg_catalog.length(normalized_description) < 1
    or pg_catalog.length(normalized_description) > 5000
  then
    raise exception 'Issue resolution description must contain between 1 and 5000 characters'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text, 0)
  );

  select profile.id, profile.is_admin
  into actor_profile_id, actor_is_admin
  from public.user_profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.is_active
  for share;

  if not found
    or (
      not actor_is_admin
      and not exists (
        select 1
        from public.user_permissions as permission
        join public.permission_definitions as definition
          on definition.id = permission.permission_definition_id
        where permission.user_id = actor_profile_id
          and definition.key = 'projects.edit'
          and definition.is_delegable
      )
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  select
    resolution.id,
    resolution.project_activity_id,
    activity.project_id,
    resolution.request_id,
    resolution.resolved_by_user_id,
    resolver.full_name as resolver_full_name,
    resolution.description,
    resolution.resolved_at,
    notification.id as notification_id,
    pg_catalog.count(recipient.id)::bigint as recipient_count
  into existing_resolution
  from public.project_issue_resolutions as resolution
  join public.project_activity_updates as activity
    on activity.id = resolution.project_activity_id
  join public.user_profiles as resolver
    on resolver.id = resolution.resolved_by_user_id
  left join public.project_activity_alerts as notification
    on notification.project_issue_resolution_id = resolution.id
    and notification.notification_kind = 'issue_resolved'
  left join public.project_activity_alert_recipients as recipient
    on recipient.alert_id = notification.id
  where resolution.request_id = p_request_id
  group by resolution.id, activity.project_id, resolver.full_name, notification.id;

  if found then
    if existing_resolution.resolved_by_user_id is distinct from actor_profile_id then
      raise exception 'Access denied'
        using errcode = '42501';
    end if;

    if existing_resolution.project_activity_id is distinct from p_project_activity_id
      or existing_resolution.description is distinct from normalized_description
    then
      raise exception 'Issue resolution request was already used for different data'
        using errcode = 'PIR01';
    end if;

    return query
    select
      existing_resolution.id,
      existing_resolution.project_activity_id,
      existing_resolution.project_id,
      existing_resolution.request_id,
      existing_resolution.resolved_by_user_id,
      existing_resolution.resolver_full_name,
      existing_resolution.description,
      existing_resolution.resolved_at,
      existing_resolution.notification_id,
      existing_resolution.recipient_count;
    return;
  end if;

  select activity.id, activity.project_id, activity.activity_kind
  into locked_activity
  from public.project_activity_updates as activity
  where activity.id = p_project_activity_id
  for update;

  if not found then
    raise exception 'Project Issue not found'
      using errcode = 'P0002';
  end if;

  select project.id, project.status
  into locked_project
  from public.projects as project
  where project.id = locked_activity.project_id
  for share;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  select profile.id, profile.is_admin
  into actor_profile_id, actor_is_admin
  from public.user_profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.is_active
  for share;

  if not found
    or (
      not actor_is_admin
      and not exists (
        select 1
        from public.user_permissions as permission
        join public.permission_definitions as definition
          on definition.id = permission.permission_definition_id
        where permission.user_id = actor_profile_id
          and definition.key = 'projects.edit'
          and definition.is_delegable
      )
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if locked_activity.activity_kind <> 'issue' then
    raise exception 'Only a Project Issue can be resolved'
      using errcode = 'PIR02';
  end if;

  if exists (
    select 1
    from public.project_issue_resolutions as resolution
    where resolution.project_activity_id = p_project_activity_id
  ) then
    raise exception 'Project Issue is already resolved'
      using errcode = 'PIR03';
  end if;

  insert into public.project_issue_resolutions (
    project_activity_id,
    request_id,
    resolved_by_user_id,
    description
  )
  values (
    p_project_activity_id,
    p_request_id,
    actor_profile_id,
    normalized_description
  )
  returning id into created_resolution_id;

  insert into public.project_activity_alerts (
    project_activity_id,
    sent_by_user_id,
    notification_kind,
    project_issue_resolution_id
  )
  values (
    p_project_activity_id,
    actor_profile_id,
    'issue_resolved',
    created_resolution_id
  )
  returning id into created_notification_id;

  insert into public.project_activity_alert_recipients (
    alert_id,
    recipient_user_id
  )
  select
    created_notification_id,
    eligible_recipient.id
  from (
    select recipient_profile.id
    from public.user_profiles as recipient_profile
    where recipient_profile.is_active
      and (
        recipient_profile.is_admin
        or (
          not recipient_profile.is_admin
          and exists (
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

  perform public.append_audit_log(
    p_action_type => 'project_activity.issue_resolved',
    p_entity_type => 'project_issue_resolution',
    p_summary => 'Resolved Project Issue',
    p_entity_id => created_resolution_id,
    p_metadata => pg_catalog.jsonb_build_object(
      'project_id', locked_project.id,
      'activity_id', p_project_activity_id,
      'notification_id', created_notification_id,
      'recipient_count', recipient_total
    )
  );

  return query
  select
    resolution.id,
    resolution.project_activity_id,
    locked_project.id,
    resolution.request_id,
    resolution.resolved_by_user_id,
    resolver.full_name,
    resolution.description,
    resolution.resolved_at,
    created_notification_id,
    recipient_total
  from public.project_issue_resolutions as resolution
  join public.user_profiles as resolver
    on resolver.id = resolution.resolved_by_user_id
  where resolution.id = created_resolution_id;
end;
$function$;

create or replace function public.list_project_activity(
  p_project_id uuid,
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  activity_id uuid,
  project_id uuid,
  author_user_id uuid,
  author_full_name text,
  title text,
  description text,
  created_at timestamptz,
  alert_sent boolean,
  attachment_id uuid,
  attachment_mime_type text,
  attachment_byte_size bigint,
  attachment_alt_text text,
  has_more boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or public.current_active_user_profile_id() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_project_id is null then
    raise exception 'Project is required'
      using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Page size must be between 1 and 50'
      using errcode = '22023';
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Project Activity cursor must include both created_at and id'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.projects as project where project.id = p_project_id
  ) then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  return query
  with candidates as (
    select
      activity.id as activity_id,
      activity.project_id,
      activity.author_user_id,
      author.full_name as author_full_name,
      activity.title,
      activity.description,
      activity.created_at,
      alert.id is not null as alert_sent,
      attachment.id as attachment_id,
      attachment.mime_type as attachment_mime_type,
      attachment.byte_size as attachment_byte_size,
      attachment.alt_text as attachment_alt_text
    from public.project_activity_updates as activity
    join public.user_profiles as author on author.id = activity.author_user_id
    left join public.project_activity_alerts as alert
      on alert.project_activity_id = activity.id
      and alert.notification_kind = 'activity'
    left join public.project_activity_attachments as attachment
      on attachment.project_activity_id = activity.id
    where activity.project_id = p_project_id
      and (
        p_before_created_at is null
        or (activity.created_at, activity.id) < (p_before_created_at, p_before_id)
      )
    order by activity.created_at desc, activity.id desc
    limit p_limit + 1
  )
  select
    candidate.activity_id,
    candidate.project_id,
    candidate.author_user_id,
    candidate.author_full_name,
    candidate.title,
    candidate.description,
    candidate.created_at,
    candidate.alert_sent,
    candidate.attachment_id,
    candidate.attachment_mime_type,
    candidate.attachment_byte_size,
    candidate.attachment_alt_text,
    (select pg_catalog.count(*) > p_limit from candidates) as has_more
  from candidates as candidate
  order by candidate.created_at desc, candidate.activity_id desc
  limit p_limit;
end;
$function$;

create or replace function public.get_project_activity(
  p_project_id uuid,
  p_activity_id uuid
)
returns table (
  activity_id uuid,
  project_id uuid,
  author_user_id uuid,
  author_full_name text,
  title text,
  description text,
  created_at timestamptz,
  alert_sent boolean,
  attachment_id uuid,
  attachment_mime_type text,
  attachment_byte_size bigint,
  attachment_alt_text text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or public.current_active_user_profile_id() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_project_id is null or p_activity_id is null then
    raise exception 'Project and Project Activity are required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.projects as project where project.id = p_project_id
  ) then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.project_activity_updates as activity
    where activity.id = p_activity_id and activity.project_id = p_project_id
  ) then
    raise exception 'Project Activity not found'
      using errcode = 'P0002';
  end if;

  return query
  select
    activity.id,
    activity.project_id,
    activity.author_user_id,
    author.full_name,
    activity.title,
    activity.description,
    activity.created_at,
    alert.id is not null,
    attachment.id,
    attachment.mime_type,
    attachment.byte_size,
    attachment.alt_text
  from public.project_activity_updates as activity
  join public.user_profiles as author on author.id = activity.author_user_id
  left join public.project_activity_alerts as alert
    on alert.project_activity_id = activity.id
    and alert.notification_kind = 'activity'
  left join public.project_activity_attachments as attachment
    on attachment.project_activity_id = activity.id
  where activity.id = p_activity_id and activity.project_id = p_project_id;
end;
$function$;

create function public.list_project_activity_with_issue_resolution(
  p_project_id uuid,
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  activity_id uuid,
  project_id uuid,
  author_user_id uuid,
  author_full_name text,
  title text,
  description text,
  activity_kind text,
  created_at timestamptz,
  alert_sent boolean,
  attachment_id uuid,
  attachment_mime_type text,
  attachment_byte_size bigint,
  attachment_alt_text text,
  issue_resolved boolean,
  resolution_id uuid,
  resolved_by_user_id uuid,
  resolver_full_name text,
  resolution_description text,
  resolved_at timestamptz,
  has_more boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or public.current_active_user_profile_id() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_project_id is null then
    raise exception 'Project is required'
      using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Page size must be between 1 and 50'
      using errcode = '22023';
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Project Activity cursor must include both created_at and id'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.projects as project where project.id = p_project_id
  ) then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  return query
  with candidates as (
    select
      activity.id as activity_id,
      activity.project_id,
      activity.author_user_id,
      author.full_name as author_full_name,
      activity.title,
      activity.description,
      activity.activity_kind,
      activity.created_at,
      alert.id is not null as alert_sent,
      attachment.id as attachment_id,
      attachment.mime_type as attachment_mime_type,
      attachment.byte_size as attachment_byte_size,
      attachment.alt_text as attachment_alt_text,
      resolution.id is not null as issue_resolved,
      resolution.id as resolution_id,
      resolution.resolved_by_user_id,
      resolver.full_name as resolver_full_name,
      resolution.description as resolution_description,
      resolution.resolved_at
    from public.project_activity_updates as activity
    join public.user_profiles as author on author.id = activity.author_user_id
    left join public.project_activity_alerts as alert
      on alert.project_activity_id = activity.id
      and alert.notification_kind = 'activity'
    left join public.project_activity_attachments as attachment
      on attachment.project_activity_id = activity.id
    left join public.project_issue_resolutions as resolution
      on resolution.project_activity_id = activity.id
    left join public.user_profiles as resolver
      on resolver.id = resolution.resolved_by_user_id
    where activity.project_id = p_project_id
      and (
        p_before_created_at is null
        or (activity.created_at, activity.id) < (p_before_created_at, p_before_id)
      )
    order by activity.created_at desc, activity.id desc
    limit p_limit + 1
  )
  select
    candidate.activity_id,
    candidate.project_id,
    candidate.author_user_id,
    candidate.author_full_name,
    candidate.title,
    candidate.description,
    candidate.activity_kind,
    candidate.created_at,
    candidate.alert_sent,
    candidate.attachment_id,
    candidate.attachment_mime_type,
    candidate.attachment_byte_size,
    candidate.attachment_alt_text,
    candidate.issue_resolved,
    candidate.resolution_id,
    candidate.resolved_by_user_id,
    candidate.resolver_full_name,
    candidate.resolution_description,
    candidate.resolved_at,
    (select pg_catalog.count(*) > p_limit from candidates) as has_more
  from candidates as candidate
  order by candidate.created_at desc, candidate.activity_id desc
  limit p_limit;
end;
$function$;

create function public.get_project_activity_with_issue_resolution(
  p_project_id uuid,
  p_activity_id uuid
)
returns table (
  activity_id uuid,
  project_id uuid,
  author_user_id uuid,
  author_full_name text,
  title text,
  description text,
  activity_kind text,
  created_at timestamptz,
  alert_sent boolean,
  attachment_id uuid,
  attachment_mime_type text,
  attachment_byte_size bigint,
  attachment_alt_text text,
  issue_resolved boolean,
  resolution_id uuid,
  resolved_by_user_id uuid,
  resolver_full_name text,
  resolution_description text,
  resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or public.current_active_user_profile_id() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_project_id is null or p_activity_id is null then
    raise exception 'Project and Project Activity are required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.projects as project where project.id = p_project_id
  ) then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.project_activity_updates as activity
    where activity.id = p_activity_id and activity.project_id = p_project_id
  ) then
    raise exception 'Project Activity not found'
      using errcode = 'P0002';
  end if;

  return query
  select
    activity.id,
    activity.project_id,
    activity.author_user_id,
    author.full_name,
    activity.title,
    activity.description,
    activity.activity_kind,
    activity.created_at,
    alert.id is not null,
    attachment.id,
    attachment.mime_type,
    attachment.byte_size,
    attachment.alt_text,
    resolution.id is not null,
    resolution.id,
    resolution.resolved_by_user_id,
    resolver.full_name,
    resolution.description,
    resolution.resolved_at
  from public.project_activity_updates as activity
  join public.user_profiles as author on author.id = activity.author_user_id
  left join public.project_activity_alerts as alert
    on alert.project_activity_id = activity.id
    and alert.notification_kind = 'activity'
  left join public.project_activity_attachments as attachment
    on attachment.project_activity_id = activity.id
  left join public.project_issue_resolutions as resolution
    on resolution.project_activity_id = activity.id
  left join public.user_profiles as resolver
    on resolver.id = resolution.resolved_by_user_id
  where activity.id = p_activity_id and activity.project_id = p_project_id;
end;
$function$;

create function public.list_project_notifications(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_recipient_id uuid default null
)
returns table (
  notification_id uuid,
  event_id uuid,
  notification_kind text,
  project_id uuid,
  project_name text,
  activity_id uuid,
  activity_title text,
  activity_author_full_name text,
  resolution_id uuid,
  resolver_full_name text,
  resolved_at timestamptz,
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
      notification.id as event_id,
      notification.notification_kind,
      coalesce(activity.project_id, notification.project_id) as project_id,
      project.name as project_name,
      activity.id as activity_id,
      activity.title as activity_title,
      author.full_name as activity_author_full_name,
      resolution.id as resolution_id,
      resolver.full_name as resolver_full_name,
      resolution.resolved_at,
      recipient.created_at,
      recipient.read_at
    from public.project_activity_alert_recipients as recipient
    join public.project_activity_alerts as notification
      on notification.id = recipient.alert_id
    left join public.project_activity_updates as activity
      on activity.id = notification.project_activity_id
    join public.projects as project
      on project.id = coalesce(activity.project_id, notification.project_id)
    left join public.user_profiles as author
      on author.id = activity.author_user_id
    left join public.project_issue_resolutions as resolution
      on resolution.id = notification.project_issue_resolution_id
    left join public.user_profiles as resolver
      on resolver.id = resolution.resolved_by_user_id
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
    candidate.event_id,
    candidate.notification_kind,
    candidate.project_id,
    candidate.project_name,
    candidate.activity_id,
    candidate.activity_title,
    candidate.activity_author_full_name,
    candidate.resolution_id,
    candidate.resolver_full_name,
    candidate.resolved_at,
    candidate.created_at,
    candidate.read_at,
    (select pg_catalog.count(*) > p_limit from candidates) as has_more
  from candidates as candidate
  order by candidate.created_at desc, candidate.notification_id desc
  limit p_limit;
end;
$function$;

revoke all privileges
  on function public.post_project_activity(uuid, uuid, text, text, boolean)
  from public, anon, authenticated;
revoke all privileges
  on function public.post_project_activity(uuid, uuid, text, text, boolean, text)
  from public, anon, authenticated;
revoke all privileges
  on function public.resolve_project_issue(uuid, uuid, text)
  from public, anon, authenticated;
revoke all privileges
  on function public.list_project_activity_with_issue_resolution(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated;
revoke all privileges
  on function public.get_project_activity_with_issue_resolution(uuid, uuid)
  from public, anon, authenticated;
revoke all privileges
  on function public.list_project_notifications(integer, timestamptz, uuid)
  from public, anon, authenticated;

grant execute
  on function public.post_project_activity(uuid, uuid, text, text, boolean)
  to authenticated;
grant execute
  on function public.post_project_activity(uuid, uuid, text, text, boolean, text)
  to authenticated;
grant execute
  on function public.resolve_project_issue(uuid, uuid, text)
  to authenticated;
grant execute
  on function public.list_project_activity_with_issue_resolution(uuid, integer, timestamptz, uuid)
  to authenticated;
grant execute
  on function public.get_project_activity_with_issue_resolution(uuid, uuid)
  to authenticated;
grant execute
  on function public.list_project_notifications(integer, timestamptz, uuid)
  to authenticated;
