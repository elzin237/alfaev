create function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.user_profiles
    where public.user_profiles.id = public.current_active_user_profile_id()
      and public.user_profiles.is_admin
  );
$function$;

create function public.has_permission(permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when $1 is null or pg_catalog.length(pg_catalog.btrim($1)) = 0 then false
    else exists (
      select 1
      from public.permission_definitions
      where public.permission_definitions.key = $1
        and (
          public.current_user_is_admin()
          or (
            public.permission_definitions.is_delegable
            and exists (
              select 1
              from public.user_permissions
              where public.user_permissions.user_id =
                public.current_active_user_profile_id()
                and public.user_permissions.permission_definition_id =
                  public.permission_definitions.id
            )
          )
        )
    )
  end;
$function$;

revoke all privileges
  on function public.current_user_is_admin()
  from public, anon, authenticated;
revoke all privileges
  on function public.has_permission(text)
  from public, anon, authenticated;

grant execute
  on function public.current_user_is_admin()
  to authenticated;
grant execute
  on function public.has_permission(text)
  to authenticated;
