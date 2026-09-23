create function public.get_work_order_detail(p_work_order_id uuid)
returns table (
  work_order_id uuid,
  work_order_number text,
  status text,
  project_id uuid,
  project_name text,
  customer_name_snapshot text,
  description text,
  created_at timestamptz,
  updated_at timestamptz
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
      or public.has_permission('work_orders.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_work_order_id is null then
    raise exception 'Work Order ID is required'
      using errcode = '22023';
  end if;

  return query
  select
    work_order.id,
    work_order.work_order_number,
    work_order.status,
    work_order.project_id,
    project.name,
    work_order.customer_name_snapshot,
    work_order.description,
    work_order.created_at,
    work_order.updated_at
  from public.work_orders as work_order
  left join public.projects as project
    on project.id = work_order.project_id
  where work_order.id = p_work_order_id;
end;
$function$;

revoke all privileges
  on function public.get_work_order_detail(uuid)
  from public, anon, authenticated;

grant execute
  on function public.get_work_order_detail(uuid)
  to authenticated;

create function public.list_work_order_project_choices()
returns table (
  project_id uuid,
  name text,
  customer_name text,
  status text
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
      or public.has_permission('work_orders.edit_draft')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  return query
  select
    project.id,
    project.name,
    project.customer_name,
    project.status
  from public.projects as project
  where project.status in ('planned', 'in_progress', 'on_hold')
  order by pg_catalog.lower(project.name), project.id;
end;
$function$;

revoke all privileges
  on function public.list_work_order_project_choices()
  from public, anon, authenticated;

grant execute
  on function public.list_work_order_project_choices()
  to authenticated;
