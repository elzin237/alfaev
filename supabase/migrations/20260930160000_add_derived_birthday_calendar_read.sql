create function public.list_calendar_birthdays()
returns table (
  user_id uuid,
  full_name text,
  birthday date
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or public.current_active_user_profile_id() is null
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  return query
  select
    profile.id,
    profile.full_name,
    profile.birthday
  from public.user_profiles as profile
  where profile.is_active
    and profile.birthday is not null
  order by
    pg_catalog.date_part('month', profile.birthday),
    pg_catalog.date_part('day', profile.birthday),
    profile.full_name,
    profile.id;
end;
$function$;

revoke all privileges
  on function public.list_calendar_birthdays()
  from public, anon, authenticated;

grant execute
  on function public.list_calendar_birthdays()
  to authenticated;
