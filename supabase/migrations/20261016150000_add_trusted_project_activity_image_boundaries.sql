create function public.prepare_project_activity_image_upload(
  p_project_id uuid,
  p_activity_id uuid,
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
  current_activity record;
  current_attachment record;
  current_project record;
begin
  if p_project_id is null
    or p_activity_id is null
    or p_request_id is null
    or p_actor_auth_user_id is null
  then
    raise exception 'Project Activity image upload identity is required'
      using errcode = '22023';
  end if;

  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_byte_size is null
    or p_byte_size < 1
    or p_byte_size > 5242880
    or p_content_hash is null
    or p_content_hash !~ '^[0-9a-f]{64}$'
    or (
      p_alt_text is not null
      and (
        p_alt_text is distinct from pg_catalog.btrim(p_alt_text)
        or pg_catalog.length(p_alt_text) < 1
        or pg_catalog.length(p_alt_text) > 500
      )
    )
  then
    raise exception 'Project Activity image metadata is invalid'
      using errcode = '22023';
  end if;

  select project.id, project.status
  into current_project
  from public.projects as project
  where project.id = p_project_id
  for update;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  select
    activity.id,
    activity.project_id,
    activity.author_user_id,
    activity.request_id
  into current_activity
  from public.project_activity_updates as activity
  where activity.id = p_activity_id
    and activity.project_id = p_project_id
  for update;

  if not found then
    raise exception 'Project Activity not found'
      using errcode = 'P0002';
  end if;

  select profile.id, profile.is_admin
  into actor_profile
  from public.user_profiles as profile
  where profile.auth_user_id = p_actor_auth_user_id
    and profile.is_active
  for share;

  if not found
    or actor_profile.id is distinct from current_activity.author_user_id
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
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if current_activity.request_id is distinct from p_request_id then
    raise exception 'Project Activity attachment request conflicts with the original submission'
      using errcode = 'PAC04';
  end if;

  select attachment.*
  into current_attachment
  from public.project_activity_attachments as attachment
  where attachment.project_activity_id = p_activity_id;

  if found then
    if current_attachment.mime_type is distinct from p_mime_type
      or current_attachment.byte_size is distinct from p_byte_size
      or current_attachment.content_hash is distinct from p_content_hash
      or current_attachment.alt_text is distinct from p_alt_text
    then
      raise exception 'Project Activity already has a different attachment'
        using errcode = 'PAC04';
    end if;

    return query
    select
      true,
      current_attachment.id,
      current_attachment.storage_path,
      current_attachment.mime_type,
      current_attachment.byte_size,
      current_attachment.alt_text;
    return;
  end if;

  if current_project.status not in ('planned', 'in_progress', 'on_hold') then
    raise exception 'Project Activity image cannot be attached to this Project'
      using errcode = 'PAC02';
  end if;

  return query
  select false, null::uuid, null::text, null::text, null::bigint, null::text;
end;
$function$;

create function public.attach_project_activity_image(
  p_project_id uuid,
  p_activity_id uuid,
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
  current_activity record;
  current_attachment record;
  current_project record;
  expected_extension text;
begin
  if p_project_id is null
    or p_activity_id is null
    or p_request_id is null
    or p_actor_auth_user_id is null
  then
    raise exception 'Project Activity image upload identity is required'
      using errcode = '22023';
  end if;

  expected_extension := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    else null
  end;

  if expected_extension is null
    or p_byte_size is null
    or p_byte_size < 1
    or p_byte_size > 5242880
    or p_content_hash is null
    or p_content_hash !~ '^[0-9a-f]{64}$'
    or p_storage_path is null
    or p_storage_path !~ (
      '^final/'
      || p_project_id::text
      || '/'
      || p_activity_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]'
      || expected_extension
      || '$'
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
    raise exception 'Project Activity image metadata is invalid'
      using errcode = '22023';
  end if;

  select project.id, project.status
  into current_project
  from public.projects as project
  where project.id = p_project_id
  for update;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  select
    activity.id,
    activity.project_id,
    activity.author_user_id,
    activity.request_id
  into current_activity
  from public.project_activity_updates as activity
  where activity.id = p_activity_id
    and activity.project_id = p_project_id
  for update;

  if not found then
    raise exception 'Project Activity not found'
      using errcode = 'P0002';
  end if;

  -- Re-resolve active state, author identity, and current permission after every
  -- potentially blocking Project/Activity lock.
  select profile.id, profile.is_admin
  into actor_profile
  from public.user_profiles as profile
  where profile.auth_user_id = p_actor_auth_user_id
    and profile.is_active
  for share;

  if not found
    or actor_profile.id is distinct from current_activity.author_user_id
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
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if current_activity.request_id is distinct from p_request_id then
    raise exception 'Project Activity attachment request conflicts with the original submission'
      using errcode = 'PAC04';
  end if;

  select attachment.*
  into current_attachment
  from public.project_activity_attachments as attachment
  where attachment.project_activity_id = p_activity_id;

  if found then
    if current_attachment.mime_type is distinct from p_mime_type
      or current_attachment.byte_size is distinct from p_byte_size
      or current_attachment.content_hash is distinct from p_content_hash
      or current_attachment.alt_text is distinct from p_alt_text
    then
      raise exception 'Project Activity already has a different attachment'
        using errcode = 'PAC04';
    end if;

    return query
    select
      false,
      current_attachment.id,
      current_attachment.storage_path,
      current_attachment.mime_type,
      current_attachment.byte_size,
      current_attachment.alt_text;
    return;
  end if;

  if current_project.status not in ('planned', 'in_progress', 'on_hold') then
    raise exception 'Project Activity image cannot be attached to this Project'
      using errcode = 'PAC02';
  end if;

  perform 1
  from storage.objects as object
  where object.bucket_id = 'project-activity-images'
    and object.name = p_storage_path
    and object.metadata->>'mimetype' = p_mime_type
  for key share;

  if not found then
    raise exception 'Validated private Project Activity image object is required'
      using errcode = '22023';
  end if;

  insert into public.project_activity_attachments (
    project_activity_id,
    storage_path,
    mime_type,
    byte_size,
    content_hash,
    alt_text
  )
  values (
    p_activity_id,
    p_storage_path,
    p_mime_type,
    p_byte_size,
    p_content_hash,
    p_alt_text
  )
  returning id into created_attachment_id;

  return query
  select
    true,
    created_attachment_id,
    p_storage_path,
    p_mime_type,
    p_byte_size,
    p_alt_text;
end;
$function$;

create function public.reconcile_project_activity_image_upload(
  p_project_id uuid,
  p_activity_id uuid,
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
  join public.project_activity_attachments as attachment
    on attachment.project_activity_id = activity.id
  where activity.id = p_activity_id
    and activity.project_id = p_project_id
    and activity.request_id = p_request_id;
$function$;

create function public.get_project_activity_image_access_context(
  p_project_id uuid,
  p_activity_id uuid,
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
  if p_project_id is null
    or p_activity_id is null
    or p_actor_auth_user_id is null
  then
    raise exception 'Project and Project Activity are required'
      using errcode = '22023';
  end if;

  select profile.id, profile.is_admin
  into actor_profile
  from public.user_profiles as profile
  where profile.auth_user_id = p_actor_auth_user_id
    and profile.is_active;

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
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.projects as project
    where project.id = p_project_id
  ) then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.project_activity_updates as activity
    where activity.id = p_activity_id
      and activity.project_id = p_project_id
  ) then
    raise exception 'Project Activity not found'
      using errcode = 'P0002';
  end if;

  return query
  select
    attachment.id,
    attachment.storage_path,
    attachment.mime_type,
    attachment.byte_size,
    attachment.alt_text
  from public.project_activity_attachments as attachment
  where attachment.project_activity_id = p_activity_id;

  if not found then
    raise exception 'Project Activity attachment not found'
      using errcode = 'P0002';
  end if;
end;
$function$;

revoke all privileges
  on function public.prepare_project_activity_image_upload(uuid, uuid, uuid, uuid, text, bigint, text, text)
  from public, anon, authenticated, service_role;
revoke all privileges
  on function public.attach_project_activity_image(uuid, uuid, uuid, uuid, text, text, bigint, text, text)
  from public, anon, authenticated, service_role;
revoke all privileges
  on function public.reconcile_project_activity_image_upload(uuid, uuid, uuid, text, text, bigint, text, text)
  from public, anon, authenticated, service_role;
revoke all privileges
  on function public.get_project_activity_image_access_context(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute
  on function public.prepare_project_activity_image_upload(uuid, uuid, uuid, uuid, text, bigint, text, text)
  to service_role;
grant execute
  on function public.attach_project_activity_image(uuid, uuid, uuid, uuid, text, text, bigint, text, text)
  to service_role;
grant execute
  on function public.reconcile_project_activity_image_upload(uuid, uuid, uuid, text, text, bigint, text, text)
  to service_role;
grant execute
  on function public.get_project_activity_image_access_context(uuid, uuid, uuid)
  to service_role;
