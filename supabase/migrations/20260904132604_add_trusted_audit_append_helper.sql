create function public.append_audit_log(
  p_action_type text,
  p_entity_type text,
  p_summary text,
  p_entity_id uuid default null,
  p_before_data jsonb default null,
  p_after_data jsonb default null,
  p_metadata jsonb default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  audit_log_id uuid;
  normalized_action_type text;
  normalized_entity_type text;
  normalized_summary text;
begin
  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    raise exception 'An active authenticated user is required'
      using errcode = '42501';
  end if;

  normalized_action_type := pg_catalog.btrim(p_action_type);
  normalized_entity_type := pg_catalog.btrim(p_entity_type);
  normalized_summary := pg_catalog.btrim(p_summary);

  if normalized_action_type is null
    or pg_catalog.length(normalized_action_type) = 0
  then
    raise exception 'Audit action type is required'
      using errcode = '22023';
  end if;

  if normalized_entity_type is null
    or pg_catalog.length(normalized_entity_type) = 0
  then
    raise exception 'Audit entity type is required'
      using errcode = '22023';
  end if;

  if normalized_summary is null
    or pg_catalog.length(normalized_summary) = 0
  then
    raise exception 'Audit summary is required'
      using errcode = '22023';
  end if;

  insert into public.audit_logs as inserted (
    actor_user_id,
    action_type,
    entity_type,
    entity_id,
    summary,
    before_data,
    after_data,
    metadata
  )
  values (
    actor_profile_id,
    normalized_action_type,
    normalized_entity_type,
    p_entity_id,
    normalized_summary,
    p_before_data,
    p_after_data,
    p_metadata
  )
  returning inserted.id into audit_log_id;

  return audit_log_id;
end;
$function$;

revoke all privileges
  on function public.append_audit_log(text, text, text, uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
