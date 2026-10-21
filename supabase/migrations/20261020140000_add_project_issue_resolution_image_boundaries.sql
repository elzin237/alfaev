create table public.project_issue_resolution_attachments (
  id uuid primary key default gen_random_uuid(),
  project_issue_resolution_id uuid not null,
  storage_path text not null,
  mime_type text not null,
  byte_size bigint not null,
  content_hash text not null,
  alt_text text,
  created_at timestamptz not null default now(),

  constraint project_issue_resolution_attachments_resolution_id_fkey
    foreign key (project_issue_resolution_id)
    references public.project_issue_resolutions(id)
    on delete restrict,
  constraint project_issue_resolution_attachments_resolution_id_key
    unique (project_issue_resolution_id),
  constraint project_issue_resolution_attachments_storage_path_key
    unique (storage_path),
  constraint project_issue_resolution_attachments_storage_path_normalized
    check (storage_path = btrim(storage_path) and char_length(storage_path) > 0),
  constraint project_issue_resolution_attachments_mime_type_allowed
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint project_issue_resolution_attachments_byte_size_valid
    check (byte_size > 0 and byte_size <= 5242880),
  constraint project_issue_resolution_attachments_content_hash_normalized
    check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint project_issue_resolution_attachments_alt_text_normalized
    check (
      alt_text is null
      or (
        alt_text = btrim(alt_text)
        and char_length(alt_text) between 1 and 500
      )
    )
);

create trigger project_issue_resolution_attachments_reject_update_delete
before update or delete on public.project_issue_resolution_attachments
for each row
execute function public.prevent_project_activity_history_mutation();

alter table public.project_issue_resolution_attachments enable row level security;

revoke all privileges
  on table public.project_issue_resolution_attachments
  from public, anon, authenticated;

create function public.prepare_project_issue_resolution_image_upload(
  p_project_id uuid,
  p_activity_id uuid,
  p_resolution_id uuid,
  p_request_id uuid,
  p_actor_auth_user_id uuid,
  p_mime_type text,
  p_byte_size bigint,
  p_content_hash text,
  p_alt_text text
)
returns table (
  attachment_exists boolean,
  attachment_id uuid,
  storage_path text,
  mime_type text,
  byte_size bigint,
  alt_text text
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile record;
  current_attachment record;
  current_resolution record;
begin
  if p_project_id is null or p_activity_id is null or p_resolution_id is null
    or p_request_id is null or p_actor_auth_user_id is null
  then
    raise exception 'Project Issue resolution image upload identity is required'
      using errcode = '22023';
  end if;

  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_byte_size is null or p_byte_size < 1 or p_byte_size > 5242880
    or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$'
    or (
      p_alt_text is not null
      and (
        p_alt_text is distinct from pg_catalog.btrim(p_alt_text)
        or pg_catalog.length(p_alt_text) < 1
        or pg_catalog.length(p_alt_text) > 500
      )
    )
  then
    raise exception 'Project Issue resolution image metadata is invalid'
      using errcode = '22023';
  end if;

  perform 1 from public.projects as project
  where project.id = p_project_id for share;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  perform 1 from public.project_activity_updates as activity
  where activity.id = p_activity_id
    and activity.project_id = p_project_id
    and activity.activity_kind = 'issue'
  for share;
  if not found then
    raise exception 'Project Issue not found' using errcode = 'P0002';
  end if;

  select resolution.id, resolution.request_id, resolution.resolved_by_user_id
  into current_resolution
  from public.project_issue_resolutions as resolution
  where resolution.id = p_resolution_id
    and resolution.project_activity_id = p_activity_id
  for update;
  if not found then
    raise exception 'Project Issue resolution not found' using errcode = 'P0002';
  end if;

  select profile.id, profile.is_admin into actor_profile
  from public.user_profiles as profile
  where profile.auth_user_id = p_actor_auth_user_id and profile.is_active
  for share;

  if not found
    or actor_profile.id is distinct from current_resolution.resolved_by_user_id
    or (
      not actor_profile.is_admin
      and not exists (
        select 1
        from public.user_permissions as permission
        join public.permission_definitions as definition
          on definition.id = permission.permission_definition_id
        where permission.user_id = actor_profile.id
          and definition.key = 'projects.edit'
          and definition.is_delegable
      )
    )
  then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if current_resolution.request_id is distinct from p_request_id then
    raise exception 'Project Issue resolution attachment request conflicts with the original resolution'
      using errcode = 'PIR04';
  end if;

  select attachment.* into current_attachment
  from public.project_issue_resolution_attachments as attachment
  where attachment.project_issue_resolution_id = p_resolution_id;

  if found then
    if current_attachment.mime_type is distinct from p_mime_type
      or current_attachment.byte_size is distinct from p_byte_size
      or current_attachment.content_hash is distinct from p_content_hash
      or current_attachment.alt_text is distinct from p_alt_text
    then
      raise exception 'Project Issue resolution already has a different attachment'
        using errcode = 'PIR04';
    end if;
    return query select true, current_attachment.id,
      current_attachment.storage_path, current_attachment.mime_type,
      current_attachment.byte_size, current_attachment.alt_text;
    return;
  end if;

  return query
  select false, null::uuid, null::text, null::text, null::bigint, null::text;
end;
$function$;

drop function public.list_project_activity_with_issue_resolution(
  uuid, integer, timestamptz, uuid
);

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
  resolution_attachment_id uuid,
  resolution_attachment_mime_type text,
  resolution_attachment_byte_size bigint,
  resolution_attachment_alt_text text,
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
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_project_id is null then
    raise exception 'Project is required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Page size must be between 1 and 50' using errcode = '22023';
  end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Project Activity cursor must include both created_at and id'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found' using errcode = 'P0002';
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
      resolution.resolved_at,
      resolution_attachment.id as resolution_attachment_id,
      resolution_attachment.mime_type as resolution_attachment_mime_type,
      resolution_attachment.byte_size as resolution_attachment_byte_size,
      resolution_attachment.alt_text as resolution_attachment_alt_text
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
    left join public.project_issue_resolution_attachments as resolution_attachment
      on resolution_attachment.project_issue_resolution_id = resolution.id
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
    candidate.resolution_attachment_id,
    candidate.resolution_attachment_mime_type,
    candidate.resolution_attachment_byte_size,
    candidate.resolution_attachment_alt_text,
    (select pg_catalog.count(*) > p_limit from candidates) as has_more
  from candidates as candidate
  order by candidate.created_at desc, candidate.activity_id desc
  limit p_limit;
end;
$function$;

drop function public.get_project_activity_with_issue_resolution(uuid, uuid);

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
  resolved_at timestamptz,
  resolution_attachment_id uuid,
  resolution_attachment_mime_type text,
  resolution_attachment_byte_size bigint,
  resolution_attachment_alt_text text
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
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_project_id is null or p_activity_id is null then
    raise exception 'Project and Project Activity are required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.project_activity_updates as activity
    where activity.id = p_activity_id and activity.project_id = p_project_id
  ) then
    raise exception 'Project Activity not found' using errcode = 'P0002';
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
    resolution.resolved_at,
    resolution_attachment.id,
    resolution_attachment.mime_type,
    resolution_attachment.byte_size,
    resolution_attachment.alt_text
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
  left join public.project_issue_resolution_attachments as resolution_attachment
    on resolution_attachment.project_issue_resolution_id = resolution.id
  where activity.id = p_activity_id and activity.project_id = p_project_id;
end;
$function$;

create function public.attach_project_issue_resolution_image(
  p_project_id uuid,
  p_activity_id uuid,
  p_resolution_id uuid,
  p_request_id uuid,
  p_actor_auth_user_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint,
  p_content_hash text,
  p_alt_text text
)
returns table (
  attachment_created boolean,
  attachment_id uuid,
  storage_path text,
  mime_type text,
  byte_size bigint,
  alt_text text
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile record;
  created_attachment_id uuid;
  current_attachment record;
  current_resolution record;
  expected_extension text;
begin
  if p_project_id is null or p_activity_id is null or p_resolution_id is null
    or p_request_id is null or p_actor_auth_user_id is null
  then
    raise exception 'Project Issue resolution image upload identity is required'
      using errcode = '22023';
  end if;

  expected_extension := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    else null
  end;
  if expected_extension is null
    or p_byte_size is null or p_byte_size < 1 or p_byte_size > 5242880
    or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$'
    or p_storage_path is null
    or p_storage_path !~ (
      '^resolution-final/' || p_project_id::text || '/' || p_activity_id::text
      || '/' || p_resolution_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]'
      || expected_extension || '$'
    )
    or (
      p_alt_text is not null
      and (
        p_alt_text is distinct from pg_catalog.btrim(p_alt_text)
        or pg_catalog.length(p_alt_text) < 1
        or pg_catalog.length(p_alt_text) > 500
      )
    )
  then
    raise exception 'Project Issue resolution image metadata is invalid'
      using errcode = '22023';
  end if;

  perform 1 from public.projects as project
  where project.id = p_project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  perform 1 from public.project_activity_updates as activity
  where activity.id = p_activity_id
    and activity.project_id = p_project_id
    and activity.activity_kind = 'issue'
  for share;
  if not found then raise exception 'Project Issue not found' using errcode = 'P0002'; end if;

  select resolution.id, resolution.request_id, resolution.resolved_by_user_id
  into current_resolution
  from public.project_issue_resolutions as resolution
  where resolution.id = p_resolution_id
    and resolution.project_activity_id = p_activity_id
  for update;
  if not found then
    raise exception 'Project Issue resolution not found' using errcode = 'P0002';
  end if;

  select profile.id, profile.is_admin into actor_profile
  from public.user_profiles as profile
  where profile.auth_user_id = p_actor_auth_user_id and profile.is_active
  for share;
  if not found
    or actor_profile.id is distinct from current_resolution.resolved_by_user_id
    or (
      not actor_profile.is_admin
      and not exists (
        select 1
        from public.user_permissions as permission
        join public.permission_definitions as definition
          on definition.id = permission.permission_definition_id
        where permission.user_id = actor_profile.id
          and definition.key = 'projects.edit'
          and definition.is_delegable
      )
    )
  then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if current_resolution.request_id is distinct from p_request_id then
    raise exception 'Project Issue resolution attachment request conflicts with the original resolution'
      using errcode = 'PIR04';
  end if;

  select attachment.* into current_attachment
  from public.project_issue_resolution_attachments as attachment
  where attachment.project_issue_resolution_id = p_resolution_id;
  if found then
    if current_attachment.mime_type is distinct from p_mime_type
      or current_attachment.byte_size is distinct from p_byte_size
      or current_attachment.content_hash is distinct from p_content_hash
      or current_attachment.alt_text is distinct from p_alt_text
    then
      raise exception 'Project Issue resolution already has a different attachment'
        using errcode = 'PIR04';
    end if;
    return query select false, current_attachment.id,
      current_attachment.storage_path, current_attachment.mime_type,
      current_attachment.byte_size, current_attachment.alt_text;
    return;
  end if;

  perform 1 from storage.objects as object
  where object.bucket_id = 'project-activity-images'
    and object.name = p_storage_path
    and object.metadata->>'mimetype' = p_mime_type
  for key share;
  if not found then
    raise exception 'Validated private Project Issue resolution image object is required'
      using errcode = '22023';
  end if;

  insert into public.project_issue_resolution_attachments (
    project_issue_resolution_id, storage_path, mime_type, byte_size,
    content_hash, alt_text
  ) values (
    p_resolution_id, p_storage_path, p_mime_type, p_byte_size,
    p_content_hash, p_alt_text
  ) returning id into created_attachment_id;

  return query select true, created_attachment_id, p_storage_path,
    p_mime_type, p_byte_size, p_alt_text;
end;
$function$;

create function public.reconcile_project_issue_resolution_image_upload(
  p_project_id uuid,
  p_activity_id uuid,
  p_resolution_id uuid,
  p_request_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint,
  p_content_hash text,
  p_alt_text text
)
returns table (
  metadata_matches boolean,
  candidate_referenced boolean,
  attachment_id uuid,
  storage_path text,
  mime_type text,
  byte_size bigint,
  alt_text text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    attachment.mime_type = p_mime_type
      and attachment.byte_size = p_byte_size
      and attachment.content_hash = p_content_hash
      and attachment.alt_text is not distinct from p_alt_text,
    attachment.storage_path = p_storage_path,
    attachment.id,
    attachment.storage_path,
    attachment.mime_type,
    attachment.byte_size,
    attachment.alt_text
  from public.project_activity_updates as activity
  join public.project_issue_resolutions as resolution
    on resolution.project_activity_id = activity.id
  join public.project_issue_resolution_attachments as attachment
    on attachment.project_issue_resolution_id = resolution.id
  where activity.id = p_activity_id
    and activity.project_id = p_project_id
    and resolution.id = p_resolution_id
    and resolution.request_id = p_request_id;
$function$;

create function public.get_project_issue_resolution_image_access_context(
  p_project_id uuid,
  p_activity_id uuid,
  p_resolution_id uuid,
  p_actor_auth_user_id uuid
)
returns table (
  attachment_id uuid,
  storage_path text,
  mime_type text,
  byte_size bigint,
  alt_text text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor_profile record;
begin
  if p_project_id is null or p_activity_id is null or p_resolution_id is null
    or p_actor_auth_user_id is null
  then
    raise exception 'Project, Issue, and resolution are required'
      using errcode = '22023';
  end if;

  select profile.id, profile.is_admin into actor_profile
  from public.user_profiles as profile
  where profile.auth_user_id = p_actor_auth_user_id and profile.is_active;
  if not found
    or (
      not actor_profile.is_admin
      and not exists (
        select 1
        from public.user_permissions as permission
        join public.permission_definitions as definition
          on definition.id = permission.permission_definition_id
        where permission.user_id = actor_profile.id
          and definition.key = 'projects.view'
          and definition.is_delegable
      )
    )
  then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.project_activity_updates as activity
    join public.project_issue_resolutions as resolution
      on resolution.project_activity_id = activity.id
    where activity.id = p_activity_id
      and activity.project_id = p_project_id
      and activity.activity_kind = 'issue'
      and resolution.id = p_resolution_id
  ) then
    raise exception 'Project Issue resolution not found' using errcode = 'P0002';
  end if;

  return query
  select attachment.id, attachment.storage_path, attachment.mime_type,
    attachment.byte_size, attachment.alt_text
  from public.project_issue_resolution_attachments as attachment
  where attachment.project_issue_resolution_id = p_resolution_id;
  if not found then
    raise exception 'Project Issue resolution attachment not found'
      using errcode = 'P0002';
  end if;
end;
$function$;

revoke all privileges
  on function public.prepare_project_issue_resolution_image_upload(uuid, uuid, uuid, uuid, uuid, text, bigint, text, text)
  from public, anon, authenticated, service_role;
revoke all privileges
  on function public.attach_project_issue_resolution_image(uuid, uuid, uuid, uuid, uuid, text, text, bigint, text, text)
  from public, anon, authenticated, service_role;
revoke all privileges
  on function public.reconcile_project_issue_resolution_image_upload(uuid, uuid, uuid, uuid, text, text, bigint, text, text)
  from public, anon, authenticated, service_role;
revoke all privileges
  on function public.get_project_issue_resolution_image_access_context(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all privileges
  on function public.list_project_activity_with_issue_resolution(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated;
revoke all privileges
  on function public.get_project_activity_with_issue_resolution(uuid, uuid)
  from public, anon, authenticated;

grant execute
  on function public.prepare_project_issue_resolution_image_upload(uuid, uuid, uuid, uuid, uuid, text, bigint, text, text)
  to service_role;
grant execute
  on function public.attach_project_issue_resolution_image(uuid, uuid, uuid, uuid, uuid, text, text, bigint, text, text)
  to service_role;
grant execute
  on function public.reconcile_project_issue_resolution_image_upload(uuid, uuid, uuid, uuid, text, text, bigint, text, text)
  to service_role;
grant execute
  on function public.get_project_issue_resolution_image_access_context(uuid, uuid, uuid, uuid)
  to service_role;
grant execute
  on function public.list_project_activity_with_issue_resolution(uuid, integer, timestamptz, uuid)
  to authenticated;
grant execute
  on function public.get_project_activity_with_issue_resolution(uuid, uuid)
  to authenticated;
