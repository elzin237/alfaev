alter table public.work_orders
  alter column project_id drop not null,
  alter column customer_name_snapshot drop not null,
  alter column description drop not null;

alter table public.work_orders
  add constraint work_orders_finished_content_complete
  check (
    status <> 'finished'
    or (
      project_id is not null
      and customer_name_snapshot is not null
      and description is not null
    )
  );

create function public.create_draft_work_order()
returns table (
  work_order_id uuid,
  work_order_number text
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  allocated_work_order_number text;
  changed_at timestamptz;
  created_work_order_id uuid;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.create')
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

  allocated_work_order_number := public.allocate_work_order_number();

  -- Authorization may change while this operation waits for the number allocator.
  if not (
    public.current_user_is_admin()
    or public.has_permission('work_orders.create')
  )
    or public.current_active_user_profile_id() is distinct from actor_profile_id
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;
  changed_at := pg_catalog.clock_timestamp();

  insert into public.work_orders as inserted (
    work_order_number,
    project_id,
    customer_name_snapshot,
    description,
    status,
    created_at,
    created_by_user_id,
    updated_at,
    updated_by_user_id,
    finished_at,
    finished_by_user_id
  )
  values (
    allocated_work_order_number,
    null,
    null,
    null,
    'draft',
    changed_at,
    actor_profile_id,
    changed_at,
    actor_profile_id,
    null,
    null
  )
  returning inserted.id into created_work_order_id;

  perform public.append_audit_log(
    p_action_type => 'work_order.created',
    p_entity_type => 'work_order',
    p_summary => 'Created Work Order ' || allocated_work_order_number,
    p_entity_id => created_work_order_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'work_order_id', created_work_order_id,
      'work_order_number', allocated_work_order_number,
      'status', 'draft'
    )
  );

  return query
  select created_work_order_id, allocated_work_order_number;
end;
$function$;

revoke all privileges
  on function public.create_draft_work_order()
  from public, anon, authenticated;

grant execute
  on function public.create_draft_work_order()
  to authenticated;
