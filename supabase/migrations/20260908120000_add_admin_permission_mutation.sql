create function public.set_user_permission_admin(
  p_user_id uuid,
  p_permission_key text,
  p_granted boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  target_profile public.user_profiles%rowtype;
  permission_definition public.permission_definitions%rowtype;
  normalized_permission_key text;
  changed_rows integer;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_user_id is null or p_permission_key is null or p_granted is null then
    raise exception 'User, permission key, and granted state are required'
      using errcode = '22023';
  end if;

  normalized_permission_key := pg_catalog.btrim(p_permission_key);

  if pg_catalog.length(normalized_permission_key) = 0 then
    raise exception 'Permission key is required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('alfaev.active_admin_continuity', 0)
  );

  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  select public.user_profiles.*
  into target_profile
  from public.user_profiles
  where public.user_profiles.id = p_user_id
  for update;

  if not found then
    raise exception 'User not found'
      using errcode = 'P0002';
  end if;

  if target_profile.id = actor_profile_id then
    raise exception 'Administrators cannot change their own permissions'
      using errcode = 'PRM01';
  end if;

  if target_profile.is_admin then
    raise exception 'Admin permissions cannot be changed'
      using errcode = 'PRM02';
  end if;

  select public.permission_definitions.*
  into permission_definition
  from public.permission_definitions
  where public.permission_definitions.key = normalized_permission_key
    and public.permission_definitions.is_delegable;

  if not found then
    raise exception 'Permission is unknown or not delegable'
      using errcode = 'PRM03';
  end if;

  if p_granted then
    insert into public.user_permissions (
      user_id,
      permission_definition_id,
      granted_by_user_id
    )
    values (
      target_profile.id,
      permission_definition.id,
      actor_profile_id
    )
    on conflict (user_id, permission_definition_id) do nothing;
  else
    delete from public.user_permissions
    where public.user_permissions.user_id = target_profile.id
      and public.user_permissions.permission_definition_id =
        permission_definition.id;
  end if;

  get diagnostics changed_rows = row_count;

  if changed_rows = 0 then
    return p_granted;
  end if;

  perform public.append_audit_log(
    p_action_type => case
      when p_granted then 'permission.granted'
      else 'permission.revoked'
    end,
    p_entity_type => 'user_profile',
    p_summary => case
      when p_granted
        then 'Granted ' || normalized_permission_key || ' to ' ||
          target_profile.full_name
      else 'Revoked ' || normalized_permission_key || ' from ' ||
        target_profile.full_name
    end,
    p_entity_id => target_profile.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'permission_key', normalized_permission_key,
      'granted', not p_granted
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'permission_key', normalized_permission_key,
      'granted', p_granted
    ),
    p_metadata => pg_catalog.jsonb_build_object(
      'source', 'admin_user_permission_change',
      'permission_definition_id', permission_definition.id
    )
  );

  return p_granted;
end;
$function$;

revoke all privileges
  on function public.set_user_permission_admin(uuid, text, boolean)
  from public, anon, authenticated;

grant execute
  on function public.set_user_permission_admin(uuid, text, boolean)
  to authenticated;
