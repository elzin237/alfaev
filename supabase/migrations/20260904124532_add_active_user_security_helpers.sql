create function public.current_active_user_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select public.user_profiles.id
  from public.user_profiles
  where public.user_profiles.auth_user_id = auth.uid()
    and public.user_profiles.is_active;
$function$;

create function public.is_active_user()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select public.current_active_user_profile_id() is not null;
$function$;

revoke all privileges
  on function public.current_active_user_profile_id()
  from public, anon, authenticated;
revoke all privileges
  on function public.is_active_user()
  from public, anon, authenticated;

grant execute
  on function public.current_active_user_profile_id()
  to authenticated;
grant execute
  on function public.is_active_user()
  to authenticated;
