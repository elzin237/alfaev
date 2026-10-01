create function public.list_calendar_employee_choices()
returns table (
  user_id uuid,
  full_name text
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
    profile.id,
    profile.full_name
  from public.user_profiles as profile
  order by profile.full_name, profile.id;
end;
$function$;

create function public.create_calendar_entry(
  p_entry_type text,
  p_title text,
  p_start_date date,
  p_end_date date,
  p_description text,
  p_related_user_id uuid
)
returns table (
  calendar_entry_id uuid,
  calendar_entry_updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  changed_at timestamptz;
  created_entry_id uuid;
  normalized_description text;
  normalized_title text;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  normalized_title := pg_catalog.btrim(p_title);
  normalized_description := nullif(pg_catalog.btrim(p_description), '');

  if p_entry_type is null
    or p_entry_type not in ('business_trip', 'event', 'vacation')
    or normalized_title is null
    or pg_catalog.length(normalized_title) = 0
    or p_start_date is null
    or p_end_date is null
    or p_end_date < p_start_date
  then
    raise exception 'Invalid Calendar entry data'
      using errcode = '22023';
  end if;

  if p_related_user_id is not null
    and not exists (
      select 1
      from public.user_profiles as related_profile
      where related_profile.id = p_related_user_id
    )
  then
    raise exception 'Related user not found'
      using errcode = 'P0002';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  insert into public.calendar_entries (
    entry_type,
    title,
    start_date,
    end_date,
    description,
    related_user_id,
    created_at,
    created_by_user_id,
    updated_at,
    updated_by_user_id
  )
  values (
    p_entry_type,
    normalized_title,
    p_start_date,
    p_end_date,
    normalized_description,
    p_related_user_id,
    changed_at,
    actor_profile_id,
    changed_at,
    actor_profile_id
  )
  returning id into created_entry_id;

  perform public.append_audit_log(
    p_action_type => 'calendar.created',
    p_entity_type => 'calendar_entry',
    p_summary => 'Created Calendar entry ' || normalized_title,
    p_entity_id => created_entry_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'entry_type', p_entry_type,
      'title', normalized_title,
      'start_date', p_start_date,
      'end_date', p_end_date,
      'description', normalized_description,
      'related_user_id', p_related_user_id
    )
  );

  return query select created_entry_id, changed_at;
end;
$function$;

create function public.update_calendar_entry(
  p_calendar_entry_id uuid,
  p_entry_type text,
  p_title text,
  p_start_date date,
  p_end_date date,
  p_description text,
  p_related_user_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  calendar_entry_id uuid,
  calendar_entry_updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  changed_at timestamptz;
  current_entry public.calendar_entries%rowtype;
  normalized_description text;
  normalized_title text;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_calendar_entry_id is null or p_expected_updated_at is null then
    raise exception 'Calendar entry and expected version are required'
      using errcode = '22023';
  end if;

  normalized_title := pg_catalog.btrim(p_title);
  normalized_description := nullif(pg_catalog.btrim(p_description), '');

  if p_entry_type is null
    or p_entry_type not in ('business_trip', 'event', 'vacation')
    or normalized_title is null
    or pg_catalog.length(normalized_title) = 0
    or p_start_date is null
    or p_end_date is null
    or p_end_date < p_start_date
  then
    raise exception 'Invalid Calendar entry data'
      using errcode = '22023';
  end if;

  if p_related_user_id is not null
    and not exists (
      select 1
      from public.user_profiles as related_profile
      where related_profile.id = p_related_user_id
    )
  then
    raise exception 'Related user not found'
      using errcode = 'P0002';
  end if;

  select entry.*
  into current_entry
  from public.calendar_entries as entry
  where entry.id = p_calendar_entry_id
  for update;

  if not found then
    raise exception 'Calendar entry not found'
      using errcode = 'P0002';
  end if;

  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if current_entry.updated_at is distinct from p_expected_updated_at then
    raise exception 'Calendar entry changed; reload and review it'
      using errcode = 'CAL01';
  end if;

  if current_entry.entry_type = p_entry_type
    and current_entry.title = normalized_title
    and current_entry.start_date = p_start_date
    and current_entry.end_date = p_end_date
    and current_entry.description is not distinct from normalized_description
    and current_entry.related_user_id is not distinct from p_related_user_id
  then
    return query select current_entry.id, current_entry.updated_at;
    return;
  end if;

  changed_at := pg_catalog.clock_timestamp();

  update public.calendar_entries as entry
  set entry_type = p_entry_type,
      title = normalized_title,
      start_date = p_start_date,
      end_date = p_end_date,
      description = normalized_description,
      related_user_id = p_related_user_id,
      updated_at = changed_at,
      updated_by_user_id = actor_profile_id
  where entry.id = current_entry.id;

  perform public.append_audit_log(
    p_action_type => 'calendar.updated',
    p_entity_type => 'calendar_entry',
    p_summary => 'Updated Calendar entry ' || normalized_title,
    p_entity_id => current_entry.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'entry_type', current_entry.entry_type,
      'title', current_entry.title,
      'start_date', current_entry.start_date,
      'end_date', current_entry.end_date,
      'description', current_entry.description,
      'related_user_id', current_entry.related_user_id
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'entry_type', p_entry_type,
      'title', normalized_title,
      'start_date', p_start_date,
      'end_date', p_end_date,
      'description', normalized_description,
      'related_user_id', p_related_user_id
    )
  );

  return query select current_entry.id, changed_at;
end;
$function$;

create function public.delete_calendar_entry(
  p_calendar_entry_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  calendar_entry_id uuid,
  calendar_entry_updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  current_entry public.calendar_entries%rowtype;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_calendar_entry_id is null or p_expected_updated_at is null then
    raise exception 'Calendar entry and expected version are required'
      using errcode = '22023';
  end if;

  select entry.*
  into current_entry
  from public.calendar_entries as entry
  where entry.id = p_calendar_entry_id
  for update;

  if not found then
    raise exception 'Calendar entry not found'
      using errcode = 'P0002';
  end if;

  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if public.current_active_user_profile_id() is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if current_entry.updated_at is distinct from p_expected_updated_at then
    raise exception 'Calendar entry changed; reload and review it'
      using errcode = 'CAL01';
  end if;

  delete from public.calendar_entries as entry
  where entry.id = current_entry.id;

  perform public.append_audit_log(
    p_action_type => 'calendar.deleted',
    p_entity_type => 'calendar_entry',
    p_summary => 'Deleted Calendar entry ' || current_entry.title,
    p_entity_id => current_entry.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'entry_type', current_entry.entry_type,
      'title', current_entry.title,
      'start_date', current_entry.start_date,
      'end_date', current_entry.end_date,
      'description', current_entry.description,
      'related_user_id', current_entry.related_user_id
    ),
    p_after_data => null
  );

  return query select current_entry.id, current_entry.updated_at;
end;
$function$;

revoke all privileges
  on function public.list_calendar_employee_choices()
  from public, anon, authenticated;
revoke all privileges
  on function public.create_calendar_entry(text, text, date, date, text, uuid)
  from public, anon, authenticated;
revoke all privileges
  on function public.update_calendar_entry(uuid, text, text, date, date, text, uuid, timestamptz)
  from public, anon, authenticated;
revoke all privileges
  on function public.delete_calendar_entry(uuid, timestamptz)
  from public, anon, authenticated;

grant execute
  on function public.list_calendar_employee_choices()
  to authenticated;
grant execute
  on function public.create_calendar_entry(text, text, date, date, text, uuid)
  to authenticated;
grant execute
  on function public.update_calendar_entry(uuid, text, text, date, date, text, uuid, timestamptz)
  to authenticated;
grant execute
  on function public.delete_calendar_entry(uuid, timestamptz)
  to authenticated;
