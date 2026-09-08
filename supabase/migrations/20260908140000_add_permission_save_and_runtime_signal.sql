create function public.save_user_permissions_admin(
  p_user_id uuid,
  p_expected_permission_keys text[],
  p_desired_permission_keys text[]
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
  normalized_expected_permission_keys text[];
  normalized_desired_permission_keys text[];
  current_permission_keys text[];
  changed_permission_key text;
  permissions_changed boolean := false;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_user_id is null
    or p_expected_permission_keys is null
    or p_desired_permission_keys is null
  then
    raise exception 'User, expected permissions, and desired permissions are required'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(
      p_expected_permission_keys || p_desired_permission_keys
    ) as supplied_permission(permission_key)
    where supplied_permission.permission_key is null
      or pg_catalog.length(
        pg_catalog.btrim(supplied_permission.permission_key)
      ) = 0
  ) then
    raise exception 'Permission keys must be nonblank'
      using errcode = '22023';
  end if;

  select pg_catalog.coalesce(
    pg_catalog.array_agg(
      normalized_permission.permission_key
      order by normalized_permission.permission_key
    ),
    '{}'::text[]
  )
  into normalized_expected_permission_keys
  from (
    select pg_catalog.btrim(supplied_permission.permission_key)
      as permission_key
    from pg_catalog.unnest(p_expected_permission_keys)
      as supplied_permission(permission_key)
  ) as normalized_permission;

  select pg_catalog.coalesce(
    pg_catalog.array_agg(
      normalized_permission.permission_key
      order by normalized_permission.permission_key
    ),
    '{}'::text[]
  )
  into normalized_desired_permission_keys
  from (
    select pg_catalog.btrim(supplied_permission.permission_key)
      as permission_key
    from pg_catalog.unnest(p_desired_permission_keys)
      as supplied_permission(permission_key)
  ) as normalized_permission;

  if pg_catalog.cardinality(normalized_expected_permission_keys) <>
      (
        select pg_catalog.count(distinct permission_key)
        from pg_catalog.unnest(normalized_expected_permission_keys)
          as expected_permission(permission_key)
      )
    or pg_catalog.cardinality(normalized_desired_permission_keys) <>
      (
        select pg_catalog.count(distinct permission_key)
        from pg_catalog.unnest(normalized_desired_permission_keys)
          as desired_permission(permission_key)
      )
  then
    raise exception 'Duplicate permission keys are not allowed'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(
      normalized_expected_permission_keys ||
      normalized_desired_permission_keys
    ) as supplied_permission(permission_key)
    left join public.permission_definitions as permission_definition
      on permission_definition.key = supplied_permission.permission_key
      and permission_definition.is_delegable
    where permission_definition.id is null
  ) then
    raise exception 'Permission is unknown or not delegable'
      using errcode = 'PRM03';
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

  select pg_catalog.coalesce(
    pg_catalog.array_agg(
      permission_definition.key
      order by permission_definition.key
    ),
    '{}'::text[]
  )
  into current_permission_keys
  from public.user_permissions as user_permission
  join public.permission_definitions as permission_definition
    on permission_definition.id = user_permission.permission_definition_id
  where user_permission.user_id = target_profile.id
    and permission_definition.is_delegable;

  if current_permission_keys <> normalized_expected_permission_keys then
    raise exception 'Permissions changed since they were loaded'
      using errcode = 'PRM04';
  end if;

  for changed_permission_key in
    select current_permission.permission_key
    from pg_catalog.unnest(current_permission_keys)
      as current_permission(permission_key)
    where not (
      current_permission.permission_key = any (
        normalized_desired_permission_keys
      )
    )
    order by current_permission.permission_key
  loop
    perform public.set_user_permission_admin(
      target_profile.id,
      changed_permission_key,
      false
    );
    permissions_changed := true;
  end loop;

  for changed_permission_key in
    select desired_permission.permission_key
    from pg_catalog.unnest(normalized_desired_permission_keys)
      as desired_permission(permission_key)
    where not (
      desired_permission.permission_key = any (current_permission_keys)
    )
    order by desired_permission.permission_key
  loop
    perform public.set_user_permission_admin(
      target_profile.id,
      changed_permission_key,
      true
    );
    permissions_changed := true;
  end loop;

  return permissions_changed;
end;
$function$;

revoke all privileges
  on function public.save_user_permissions_admin(uuid, text[], text[])
  from public, anon, authenticated;

grant execute
  on function public.save_user_permissions_admin(uuid, text[], text[])
  to authenticated;

grant select
  on table public.user_permissions
  to authenticated;

create policy user_permissions_select_own_active
on public.user_permissions
for select
to authenticated
using (
  user_id = public.current_active_user_profile_id()
);

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication
    where pg_catalog.pg_publication.pubname = 'supabase_realtime'
  ) then
    raise exception 'Supabase Realtime publication is unavailable';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pg_catalog.pg_publication_tables.pubname = 'supabase_realtime'
      and pg_catalog.pg_publication_tables.schemaname = 'public'
      and pg_catalog.pg_publication_tables.tablename = 'user_permissions'
  ) then
    alter publication supabase_realtime
      add table public.user_permissions;
  end if;
end;
$migration$;
