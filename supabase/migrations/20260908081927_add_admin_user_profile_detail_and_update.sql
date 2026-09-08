create function public.get_user_admin(p_user_id uuid)
returns table (
  id uuid,
  full_name text,
  email text,
  birthday date,
  is_active boolean,
  is_admin boolean,
  created_at timestamptz,
  last_login_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'User is required'
      using errcode = '22023';
  end if;

  return query
  select
    public.user_profiles.id,
    public.user_profiles.full_name,
    public.user_profiles.email,
    public.user_profiles.birthday,
    public.user_profiles.is_active,
    public.user_profiles.is_admin,
    public.user_profiles.created_at,
    public.user_profiles.last_login_at
  from public.user_profiles
  where public.user_profiles.id = p_user_id;

  if not found then
    raise exception 'User not found'
      using errcode = 'P0002';
  end if;
end;
$function$;

create function public.resolve_user_auth_identity_admin(p_user_id uuid)
returns table (
  auth_user_id uuid,
  email text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'User is required'
      using errcode = '22023';
  end if;

  return query
  select
    public.user_profiles.auth_user_id,
    public.user_profiles.email
  from public.user_profiles
  where public.user_profiles.id = p_user_id;

  if not found then
    raise exception 'User not found'
      using errcode = 'P0002';
  end if;
end;
$function$;

create function public.update_user_profile_admin(
  p_user_id uuid,
  p_full_name text,
  p_email text,
  p_birthday date
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  target_profile public.user_profiles%rowtype;
  normalized_full_name text;
  normalized_email text;
  auth_email text;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  normalized_full_name := pg_catalog.regexp_replace(
    pg_catalog.btrim(p_full_name),
    '[[:space:]]+',
    ' ',
    'g'
  );
  normalized_email := pg_catalog.lower(pg_catalog.btrim(p_email));

  if p_user_id is null then
    raise exception 'User is required'
      using errcode = '22023';
  end if;

  if normalized_full_name is null
    or pg_catalog.length(normalized_full_name) = 0
    or pg_catalog.length(normalized_full_name) > 200
  then
    raise exception 'Full name is required and must not exceed 200 characters'
      using errcode = '22023';
  end if;

  if normalized_email is null
    or pg_catalog.length(normalized_email) = 0
    or pg_catalog.length(normalized_email) > 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'A valid email is required'
      using errcode = '22023';
  end if;

  if p_birthday is null then
    raise exception 'Birthday is required'
      using errcode = '22023';
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

  select pg_catalog.lower(pg_catalog.btrim(auth.users.email))
  into auth_email
  from auth.users
  where auth.users.id = target_profile.auth_user_id;

  if auth_email is null or auth_email <> normalized_email then
    raise exception 'Auth identity does not match the requested profile email'
      using errcode = '22023';
  end if;

  if target_profile.full_name = normalized_full_name
    and target_profile.email = normalized_email
    and target_profile.birthday = p_birthday
  then
    return target_profile.id;
  end if;

  update public.user_profiles
  set
    full_name = normalized_full_name,
    email = normalized_email,
    birthday = p_birthday
  where public.user_profiles.id = target_profile.id;

  perform public.append_audit_log(
    p_action_type => 'user.updated',
    p_entity_type => 'user_profile',
    p_summary => 'Updated AlfaEV user profile for ' || normalized_full_name,
    p_entity_id => target_profile.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'full_name', target_profile.full_name,
      'email', target_profile.email,
      'birthday', target_profile.birthday
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'full_name', normalized_full_name,
      'email', normalized_email,
      'birthday', p_birthday
    ),
    p_metadata => pg_catalog.jsonb_build_object(
      'source', 'admin_user_profile_update'
    )
  );

  return target_profile.id;
exception
  when unique_violation then
    raise exception 'An AlfaEV user with this email already exists'
      using errcode = '23505';
end;
$function$;

revoke all privileges
  on function public.get_user_admin(uuid)
  from public, anon, authenticated;
revoke all privileges
  on function public.resolve_user_auth_identity_admin(uuid)
  from public, anon, authenticated;
revoke all privileges
  on function public.update_user_profile_admin(uuid, text, text, date)
  from public, anon, authenticated;

grant execute
  on function public.get_user_admin(uuid)
  to authenticated;
grant execute
  on function public.resolve_user_auth_identity_admin(uuid)
  to authenticated;
grant execute
  on function public.update_user_profile_admin(uuid, text, text, date)
  to authenticated;
