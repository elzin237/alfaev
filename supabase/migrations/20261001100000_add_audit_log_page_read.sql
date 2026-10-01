create function public.list_audit_log_page(
  p_limit integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  audit_log_id uuid,
  actor_user_id uuid,
  actor_full_name text,
  action_type text,
  entity_type text,
  entity_id uuid,
  summary text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('archive.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Page size must be between 1 and 100'
      using errcode = '22023';
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Archive cursor must include both created_at and id'
      using errcode = '22023';
  end if;

  return query
  select
    audit.id as audit_log_id,
    audit.actor_user_id,
    actor.full_name as actor_full_name,
    audit.action_type,
    audit.entity_type,
    audit.entity_id,
    audit.summary,
    audit.created_at
  from public.audit_logs as audit
  join public.user_profiles as actor
    on actor.id = audit.actor_user_id
  where p_before_created_at is null
    or (audit.created_at, audit.id) < (p_before_created_at, p_before_id)
  order by audit.created_at desc, audit.id desc
  limit p_limit;
end;
$function$;

revoke all privileges
  on function public.list_audit_log_page(integer, timestamptz, uuid)
  from public, anon, authenticated;

grant execute
  on function public.list_audit_log_page(integer, timestamptz, uuid)
  to authenticated;
