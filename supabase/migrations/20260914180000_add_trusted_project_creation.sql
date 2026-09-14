create function public.create_project(
  p_name text,
  p_customer_name text,
  p_start_date date,
  p_delivery_date date
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  changed_at timestamptz;
  created_project_id uuid;
  normalized_customer_name text;
  normalized_name text;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.create')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  normalized_name := pg_catalog.btrim(p_name);
  normalized_customer_name := pg_catalog.btrim(p_customer_name);

  if normalized_name is null or pg_catalog.length(normalized_name) = 0 then
    raise exception 'Project name is required'
      using errcode = '22023';
  end if;

  if normalized_customer_name is null
    or pg_catalog.length(normalized_customer_name) = 0
  then
    raise exception 'Project customer is required'
      using errcode = '22023';
  end if;

  if p_start_date is null or p_delivery_date is null then
    raise exception 'Project dates are required'
      using errcode = '22023';
  end if;

  if p_delivery_date < p_start_date then
    raise exception 'Project delivery date cannot precede its start date'
      using errcode = '22023';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  insert into public.projects as inserted (
    name,
    customer_name,
    status,
    start_date,
    delivery_date,
    created_at,
    created_by_user_id,
    updated_at,
    updated_by_user_id,
    completed_at,
    cancelled_at
  )
  values (
    normalized_name,
    normalized_customer_name,
    'planned',
    p_start_date,
    p_delivery_date,
    changed_at,
    actor_profile_id,
    changed_at,
    actor_profile_id,
    null,
    null
  )
  returning inserted.id into created_project_id;

  perform public.append_audit_log(
    p_action_type => 'project.created',
    p_entity_type => 'project',
    p_summary => 'Created Project ' || normalized_name,
    p_entity_id => created_project_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'name', normalized_name,
      'customer_name', normalized_customer_name,
      'status', 'planned',
      'start_date', p_start_date,
      'delivery_date', p_delivery_date,
      'completed_at', null,
      'cancelled_at', null
    )
  );

  return created_project_id;
end;
$function$;

revoke all privileges
  on function public.create_project(text, text, date, date)
  from public, anon, authenticated;

grant execute
  on function public.create_project(text, text, date, date)
  to authenticated;
