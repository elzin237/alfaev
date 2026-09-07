create function public.create_user_profile_admin(
  p_auth_user_id uuid,
  p_full_name text,
  p_email text,
  p_birthday date,
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
  auth_email text;
  normalized_full_name text;
  normalized_email text;
  new_profile_id uuid;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  actor_profile_id := public.current_active_user_profile_id();
  normalized_full_name := pg_catalog.regexp_replace(
    pg_catalog.btrim(p_full_name),
    '[[:space:]]+',
    ' ',
    'g'
  );
  normalized_email := pg_catalog.lower(pg_catalog.btrim(p_email));

  if p_auth_user_id is null then
    raise exception 'Auth user is required'
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

  if p_is_admin is null then
    raise exception 'Admin status is required'
      using errcode = '22023';
  end if;

  select pg_catalog.lower(pg_catalog.btrim(auth.users.email))
  into auth_email
  from auth.users
  where auth.users.id = p_auth_user_id;

  if auth_email is null or auth_email <> normalized_email then
    raise exception 'Auth user does not match the requested profile'
      using errcode = '22023';
  end if;

  insert into public.user_profiles as created_profile (
    auth_user_id,
    full_name,
    email,
    birthday,
    is_admin,
    is_active,
    created_by_user_id
  )
  values (
    p_auth_user_id,
    normalized_full_name,
    normalized_email,
    p_birthday,
    p_is_admin,
    true,
    actor_profile_id
  )
  returning created_profile.id into new_profile_id;

  perform public.append_audit_log(
    p_action_type => 'user.created',
    p_entity_type => 'user_profile',
    p_summary => 'Created AlfaEV user profile for ' || normalized_full_name,
    p_entity_id => new_profile_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'id', new_profile_id,
      'auth_user_id', p_auth_user_id,
      'full_name', normalized_full_name,
      'email', normalized_email,
      'birthday', p_birthday,
      'is_admin', p_is_admin,
      'is_active', true
    ),
    p_metadata => pg_catalog.jsonb_build_object(
      'source', 'admin_invite'
    )
  );

  return new_profile_id;
exception
  when unique_violation then
    raise exception 'An AlfaEV user profile with this identity already exists'
      using errcode = '23505';
end;
$function$;

revoke all privileges
  on function public.create_user_profile_admin(uuid, text, text, date, boolean)
  from public, anon, authenticated;

grant execute
  on function public.create_user_profile_admin(uuid, text, text, date, boolean)
  to authenticated;
