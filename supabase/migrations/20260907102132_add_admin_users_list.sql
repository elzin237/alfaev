create function public.list_users_admin()
returns table (
  id uuid,
  full_name text,
  email text,
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

  return query
  select
    public.user_profiles.id,
    public.user_profiles.full_name,
    public.user_profiles.email,
    public.user_profiles.is_active,
    public.user_profiles.is_admin,
    public.user_profiles.created_at,
    public.user_profiles.last_login_at
  from public.user_profiles
  order by
    public.user_profiles.created_at desc,
    public.user_profiles.id asc;
end;
$function$;

revoke all privileges
  on function public.list_users_admin()
  from public, anon, authenticated;

grant execute
  on function public.list_users_admin()
  to authenticated;
