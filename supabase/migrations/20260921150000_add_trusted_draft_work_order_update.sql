create function public.update_draft_work_order(
  p_work_order_id uuid,
  p_project_id uuid,
  p_description text,
  p_expected_updated_at timestamptz
)
returns table (
  work_order_id uuid,
  updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  changed_at timestamptz;
  current_work_order public.work_orders%rowtype;
  normalized_description text;
  selected_project public.projects%rowtype;
  trusted_customer_name text;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.edit_draft')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_work_order_id is null then
    raise exception 'Work Order ID is required'
      using errcode = '22023';
  end if;

  if p_expected_updated_at is null then
    raise exception 'Expected Work Order update timestamp is required'
      using errcode = '22023';
  end if;

  actor_profile_id := public.current_active_user_profile_id();
  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  normalized_description := nullif(
    pg_catalog.btrim(p_description),
    ''
  );

  select work_order.*
  into current_work_order
  from public.work_orders as work_order
  where work_order.id = p_work_order_id
  for update;

  if not found then
    raise exception 'Work Order not found'
      using errcode = 'P0002';
  end if;

  -- Authorization may change while this operation waits for the Work Order lock.
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.edit_draft')
    )
    or public.current_active_user_profile_id() is distinct from actor_profile_id
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if current_work_order.status <> 'draft' then
    raise exception 'Finished Work Orders cannot be modified'
      using errcode = 'WOR02';
  end if;

  if current_work_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'Work Order Draft has changed. Reload and try again.'
      using errcode = 'WOR05';
  end if;

  if p_project_id is null then
    trusted_customer_name := null;
  else
    select project.*
    into selected_project
    from public.projects as project
    where project.id = p_project_id
    for share;

    if not found then
      raise exception 'Project not found'
        using errcode = 'P0002';
    end if;

    -- Authorization may also change while this operation waits for the Project lock.
    if auth.uid() is null
      or not (
        public.current_user_is_admin()
        or public.has_permission('work_orders.edit_draft')
      )
      or public.current_active_user_profile_id() is distinct from actor_profile_id
    then
      raise exception 'Access denied'
        using errcode = '42501';
    end if;

    if p_project_id is distinct from current_work_order.project_id
      and selected_project.status not in ('planned', 'in_progress', 'on_hold')
    then
      raise exception 'Selected Project is unavailable for Work Order Draft'
        using errcode = '22023';
    end if;

    trusted_customer_name := selected_project.customer_name;
  end if;

  if current_work_order.project_id is not distinct from p_project_id
    and current_work_order.customer_name_snapshot
      is not distinct from trusted_customer_name
    and current_work_order.description is not distinct from normalized_description
  then
    return query
    select current_work_order.id, current_work_order.updated_at;
    return;
  end if;

  changed_at := pg_catalog.clock_timestamp();

  update public.work_orders as work_order
  set project_id = p_project_id,
      customer_name_snapshot = trusted_customer_name,
      description = normalized_description,
      updated_at = changed_at,
      updated_by_user_id = actor_profile_id
  where work_order.id = current_work_order.id;

  perform public.append_audit_log(
    p_action_type => 'work_order.updated',
    p_entity_type => 'work_order',
    p_summary => 'Updated Work Order ' || current_work_order.work_order_number,
    p_entity_id => current_work_order.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'project_id', current_work_order.project_id,
      'customer_name_snapshot', current_work_order.customer_name_snapshot,
      'description', current_work_order.description
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'project_id', p_project_id,
      'customer_name_snapshot', trusted_customer_name,
      'description', normalized_description
    )
  );

  return query
  select current_work_order.id, changed_at;
end;
$function$;

revoke all privileges
  on function public.update_draft_work_order(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;

grant execute
  on function public.update_draft_work_order(uuid, uuid, text, timestamptz)
  to authenticated;
