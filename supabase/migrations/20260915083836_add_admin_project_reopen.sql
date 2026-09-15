create function public.reopen_project(p_project_id uuid)
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
  if auth.uid() is null or not public.current_user_is_admin() then
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

  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if current_project.status <> 'completed' then
    raise exception 'Only Completed Projects can be reopened'
      using errcode = 'PRJ04';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  update public.projects
  set status = 'in_progress',
      completed_at = null,
      cancelled_at = null,
      updated_at = changed_at,
      updated_by_user_id = actor_profile_id
  where public.projects.id = current_project.id;

  perform public.append_audit_log(
    p_action_type => 'project.reopened',
    p_entity_type => 'project',
    p_summary => 'Reopened Project ' || current_project.name,
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
      'status', 'in_progress',
      'start_date', current_project.start_date,
      'delivery_date', current_project.delivery_date,
      'completed_at', null,
      'cancelled_at', null
    )
  );

  return current_project.id;
end;
$function$;

revoke all privileges
  on function public.reopen_project(uuid)
  from public, anon, authenticated;

grant execute
  on function public.reopen_project(uuid)
  to authenticated;
