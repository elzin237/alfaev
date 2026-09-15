create function public.get_procurement_sidebar_badge_count()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  badge_count bigint;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('procurement.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  select pg_catalog.count(*)
  into badge_count
  from public.procurement_requests as request
  where request.status in ('active', 'partly_delivered');

  return badge_count;
end;
$function$;

revoke all privileges
  on function public.get_procurement_sidebar_badge_count()
  from public, anon, authenticated;

grant execute
  on function public.get_procurement_sidebar_badge_count()
  to authenticated;
