create or replace function public.preflight_user_active_state_admin(
  p_user_id uuid,
  p_is_active boolean
)
returns table (
  target_auth_user_id uuid,
  current_is_active boolean,
  current_is_admin boolean
)
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

  if p_user_id is null or p_is_active is null then
    raise exception 'User and requested active state are required'
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
  where public.user_profiles.id = p_user_id;

  if not found then
    raise exception 'User not found'
      using errcode = 'P0002';
  end if;

  if target_profile.is_active = p_is_active then
    return query
    select
      target_profile.auth_user_id,
      target_profile.is_active,
      target_profile.is_admin;
    return;
  end if;

  if not p_is_active and target_profile.is_admin then
    select pg_catalog.count(*)
    into active_admin_count
    from public.user_profiles
    where public.user_profiles.is_admin
      and public.user_profiles.is_active;

    if active_admin_count <= 1 then
      raise exception 'The last active Admin cannot be deactivated'
        using errcode = 'AUE02';
    end if;
  end if;

  if not p_is_active and target_profile.id = actor_profile_id then
    raise exception 'Administrators cannot deactivate their own account'
      using errcode = 'AUE01';
  end if;

  return query
  select
    target_profile.auth_user_id,
    target_profile.is_active,
    target_profile.is_admin;
end;
$function$;

create or replace function public.set_user_active_state_admin(
  p_user_id uuid,
  p_is_active boolean
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
  changed_at timestamptz;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_user_id is null or p_is_active is null then
    raise exception 'User and requested active state are required'
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

  if target_profile.is_active = p_is_active then
    return target_profile.id;
  end if;

  if not p_is_active and target_profile.is_admin then
    select pg_catalog.count(*)
    into active_admin_count
    from public.user_profiles
    where public.user_profiles.is_admin
      and public.user_profiles.is_active;

    if active_admin_count <= 1 then
      raise exception 'The last active Admin cannot be deactivated'
        using errcode = 'AUE02';
    end if;
  end if;

  if not p_is_active and target_profile.id = actor_profile_id then
    raise exception 'Administrators cannot deactivate their own account'
      using errcode = 'AUE01';
  end if;

  changed_at := pg_catalog.statement_timestamp();

  update public.user_profiles
  set
    is_active = p_is_active,
    deactivated_at = case when p_is_active then null else changed_at end,
    deactivated_by_user_id = case
      when p_is_active then null
      else actor_profile_id
    end
  where public.user_profiles.id = target_profile.id;

  perform public.append_audit_log(
    p_action_type => case
      when p_is_active then 'user.reactivated'
      else 'user.deactivated'
    end,
    p_entity_type => 'user_profile',
    p_summary => case
      when p_is_active
        then 'Reactivated AlfaEV user ' || target_profile.full_name
      else 'Deactivated AlfaEV user ' || target_profile.full_name
    end,
    p_entity_id => target_profile.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'is_active', target_profile.is_active,
      'deactivated_at', target_profile.deactivated_at,
      'deactivated_by_user_id', target_profile.deactivated_by_user_id
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'is_active', p_is_active,
      'deactivated_at', case when p_is_active then null else changed_at end,
      'deactivated_by_user_id', case
        when p_is_active then null
        else actor_profile_id
      end
    ),
    p_metadata => pg_catalog.jsonb_build_object(
      'source', 'admin_user_active_state'
    )
  );

  return target_profile.id;
end;
$function$;
