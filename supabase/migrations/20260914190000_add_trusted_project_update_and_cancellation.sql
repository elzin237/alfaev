create function public.update_project(
  p_project_id uuid,
  p_name text,
  p_customer_name text,
  p_start_date date,
  p_delivery_date date,
  p_status text
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
  current_project public.projects%rowtype;
  normalized_customer_name text;
  normalized_name text;
  next_completed_at timestamptz;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.edit')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_project_id is null then
    raise exception 'Project is required'
      using errcode = '22023';
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

  if p_status is null
    or p_status <> all (
      array['planned', 'in_progress', 'on_hold', 'completed']::text[]
    )
  then
    raise exception 'Project status is invalid for normal editing'
      using errcode = '22023';
  end if;

  select project.*
  into current_project
  from public.projects as project
  where project.id = p_project_id
  for update;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.edit')
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

  if current_project.status = 'cancelled' then
    raise exception 'Cancelled Projects cannot be edited'
      using errcode = 'PRJ01';
  end if;

  if current_project.status = 'completed' and p_status <> 'completed' then
    raise exception 'Completed Projects cannot be reopened by normal editing'
      using errcode = 'PRJ02';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  if p_status = 'completed' and current_project.status = 'completed' then
    next_completed_at := current_project.completed_at;
  elsif p_status = 'completed' then
    next_completed_at := changed_at;
  else
    next_completed_at := null;
  end if;

  if current_project.name = normalized_name
    and current_project.customer_name = normalized_customer_name
    and current_project.start_date = p_start_date
    and current_project.delivery_date = p_delivery_date
    and current_project.status = p_status
    and current_project.completed_at is not distinct from next_completed_at
    and current_project.cancelled_at is null
  then
    return current_project.id;
  end if;

  update public.projects
  set name = normalized_name,
      customer_name = normalized_customer_name,
      start_date = p_start_date,
      delivery_date = p_delivery_date,
      status = p_status,
      completed_at = next_completed_at,
      cancelled_at = null,
      updated_at = changed_at,
      updated_by_user_id = actor_profile_id
  where public.projects.id = current_project.id;

  perform public.append_audit_log(
    p_action_type => 'project.updated',
    p_entity_type => 'project',
    p_summary => 'Updated Project ' || normalized_name,
    p_entity_id => current_project.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'name', current_project.name,
      'customer_name', current_project.customer_name,
      'status', current_project.status,
      'start_date', current_project.start_date,
      'delivery_date', current_project.delivery_date,
      'completed_at', current_project.completed_at,
      'cancelled_at', current_project.cancelled_at
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'name', normalized_name,
      'customer_name', normalized_customer_name,
      'status', p_status,
      'start_date', p_start_date,
      'delivery_date', p_delivery_date,
      'completed_at', next_completed_at,
      'cancelled_at', null
    )
  );

  return current_project.id;
end;
$function$;

create function public.cancel_project(p_project_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  changed_at timestamptz;
  current_project public.projects%rowtype;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.archive')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_project_id is null then
    raise exception 'Project is required'
      using errcode = '22023';
  end if;

  select project.*
  into current_project
  from public.projects as project
  where project.id = p_project_id
  for update;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.archive')
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

  if current_project.status <> all (
    array['planned', 'in_progress', 'on_hold']::text[]
  ) then
    raise exception 'Project cannot be cancelled from its current status'
      using errcode = 'PRJ03';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  update public.projects
  set status = 'cancelled',
      completed_at = null,
      cancelled_at = changed_at,
      updated_at = changed_at,
      updated_by_user_id = actor_profile_id
  where public.projects.id = current_project.id;

  perform public.append_audit_log(
    p_action_type => 'project.cancelled',
    p_entity_type => 'project',
    p_summary => 'Cancelled Project ' || current_project.name,
    p_entity_id => current_project.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'name', current_project.name,
      'customer_name', current_project.customer_name,
      'status', current_project.status,
      'start_date', current_project.start_date,
      'delivery_date', current_project.delivery_date,
      'completed_at', current_project.completed_at,
      'cancelled_at', current_project.cancelled_at
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'name', current_project.name,
      'customer_name', current_project.customer_name,
      'status', 'cancelled',
      'start_date', current_project.start_date,
      'delivery_date', current_project.delivery_date,
      'completed_at', null,
      'cancelled_at', changed_at
    )
  );

  return current_project.id;
end;
$function$;

revoke all privileges
  on function public.update_project(uuid, text, text, date, date, text)
  from public, anon, authenticated;

grant execute
  on function public.update_project(uuid, text, text, date, date, text)
  to authenticated;

revoke all privileges
  on function public.cancel_project(uuid)
  from public, anon, authenticated;

grant execute
  on function public.cancel_project(uuid)
  to authenticated;
