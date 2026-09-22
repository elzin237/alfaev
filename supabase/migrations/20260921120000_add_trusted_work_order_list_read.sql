create function public.list_work_orders()
returns table (
  work_order_id uuid,
  work_order_number text,
  status text,
  project_id uuid,
  project_name text,
  customer_name_snapshot text,
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
      or public.has_permission('work_orders.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  return query
  select
    work_order.id,
    work_order.work_order_number,
    work_order.status,
    work_order.project_id,
    project.name,
    work_order.customer_name_snapshot,
    work_order.created_at
  from public.work_orders as work_order
  left join public.projects as project
    on project.id = work_order.project_id
  order by work_order.created_at desc, work_order.id desc;
end;
$function$;

revoke all privileges
  on function public.list_work_orders()
  from public, anon, authenticated;

grant execute
  on function public.list_work_orders()
  to authenticated;
