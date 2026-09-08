create function public.set_user_admin_status_admin(
  p_user_id uuid,
  p_is_admin boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  target_profile public.user_profiles%rowtype;
  active_admin_count bigint;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_user_id is null or p_is_admin is null then
    raise exception 'User and requested Admin status are required'
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

  if not p_is_admin and target_profile.is_admin and target_profile.is_active then
    select pg_catalog.count(*)
    into active_admin_count
    from public.user_profiles
    where public.user_profiles.is_admin
      and public.user_profiles.is_active;

    if active_admin_count <= 1 then
      raise exception 'The last active Admin cannot be demoted'
        using errcode = 'AUS02';
    end if;
  end if;

  if target_profile.id = actor_profile_id then
    raise exception 'Administrators cannot change their own Admin status'
      using errcode = 'AUS01';
  end if;

  if target_profile.is_admin = p_is_admin then
    return target_profile.id;
  end if;

  update public.user_profiles
  set is_admin = p_is_admin
  where public.user_profiles.id = target_profile.id;

  perform public.append_audit_log(
    p_action_type => case
      when p_is_admin then 'user.promoted_to_admin'
      else 'user.demoted_from_admin'
    end,
    p_entity_type => 'user_profile',
    p_summary => case
      when p_is_admin
        then 'Promoted AlfaEV user ' || target_profile.full_name || ' to Admin'
      else 'Demoted AlfaEV user ' || target_profile.full_name || ' from Admin'
    end,
    p_entity_id => target_profile.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'is_admin', target_profile.is_admin
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'is_admin', p_is_admin
    ),
    p_metadata => pg_catalog.jsonb_build_object(
      'source', 'admin_user_status_change'
    )
  );

  return target_profile.id;
end;
$function$;

revoke all privileges
  on function public.set_user_admin_status_admin(uuid, boolean)
  from public, anon, authenticated;

grant execute
  on function public.set_user_admin_status_admin(uuid, boolean)
  to authenticated;
