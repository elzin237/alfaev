create function public.get_dashboard_read_model()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor_is_admin boolean;
  can_view_projects boolean;
  can_view_work_orders boolean;
  can_view_procurement boolean;
  can_view_inventory boolean;
  can_view_activity boolean;
  can_view_suppliers boolean;
  can_view_pcb boolean;
  dashboard_date date := current_date;
  projects_section jsonb := null;
  work_orders_section jsonb := null;
  procurement_section jsonb := null;
  inventory_section jsonb := null;
  activity_section jsonb := null;
  calendar_section jsonb;
begin
  if auth.uid() is null
    or public.current_active_user_profile_id() is null
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  actor_is_admin := public.current_user_is_admin();

  if not actor_is_admin
    and not public.has_permission('dashboard.view')
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  can_view_projects := actor_is_admin
    or public.has_permission('projects.view');
  can_view_work_orders := actor_is_admin
    or public.has_permission('work_orders.view');
  can_view_procurement := actor_is_admin
    or public.has_permission('procurement.view');
  can_view_inventory := actor_is_admin
    or public.has_permission('inventory.view');
  can_view_activity := actor_is_admin
    or public.has_permission('archive.view');
  can_view_suppliers := actor_is_admin
    or public.has_permission('suppliers.view');
  can_view_pcb := actor_is_admin
    or public.has_permission('pcb.view');

  if can_view_projects then
    select pg_catalog.jsonb_build_object(
      'status_counts', pg_catalog.jsonb_build_object(
        'planned', pg_catalog.count(*) filter (
          where project.status = 'planned'
        ),
        'in_progress', pg_catalog.count(*) filter (
          where project.status = 'in_progress'
        ),
        'on_hold', pg_catalog.count(*) filter (
          where project.status = 'on_hold'
        ),
        'completed', pg_catalog.count(*) filter (
          where project.status = 'completed'
        ),
        'cancelled', pg_catalog.count(*) filter (
          where project.status = 'cancelled'
        )
      ),
      'recent', (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', recent_project.id,
              'name', recent_project.name,
              'customer_name', recent_project.customer_name,
              'status', recent_project.status,
              'delivery_date', recent_project.delivery_date,
              'updated_at', recent_project.updated_at
            )
            order by recent_project.updated_at desc, recent_project.id desc
          ),
          '[]'::jsonb
        )
        from (
          select
            project_list.id,
            project_list.name,
            project_list.customer_name,
            project_list.status,
            project_list.delivery_date,
            project_list.updated_at
          from public.projects as project_list
          order by project_list.updated_at desc, project_list.id desc
          limit 5
        ) as recent_project
      )
    )
    into projects_section
    from public.projects as project;
  end if;

  if can_view_work_orders then
    select pg_catalog.jsonb_build_object(
      'recent', coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', recent_work_order.id,
            'work_order_number', recent_work_order.work_order_number,
            'status', recent_work_order.status,
            'project_id', recent_work_order.project_id,
            'customer_name_snapshot',
              recent_work_order.customer_name_snapshot,
            'created_at', recent_work_order.created_at,
            'updated_at', recent_work_order.updated_at,
            'finished_at', recent_work_order.finished_at
          )
          order by recent_work_order.updated_at desc,
            recent_work_order.id desc
        ),
        '[]'::jsonb
      )
    )
    into work_orders_section
    from (
      select
        work_order.id,
        work_order.work_order_number,
        work_order.status,
        work_order.project_id,
        work_order.customer_name_snapshot,
        work_order.created_at,
        work_order.updated_at,
        work_order.finished_at
      from public.work_orders as work_order
      order by work_order.updated_at desc, work_order.id desc
      limit 5
    ) as recent_work_order;
  end if;

  if can_view_procurement then
    select pg_catalog.jsonb_build_object(
      'unresolved_count', pg_catalog.count(*),
      'unresolved', (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', unresolved_request.id,
              'requested_name', unresolved_request.requested_name,
              'status', unresolved_request.status,
              'requested_quantity',
                unresolved_request.requested_quantity::text,
              'delivered_quantity',
                unresolved_request.delivered_quantity::text,
              'remaining_quantity',
                (
                  unresolved_request.requested_quantity
                  - unresolved_request.delivered_quantity
                )::text,
              'product_serial_number',
                unresolved_request.product_serial_number,
              'created_at', unresolved_request.created_at,
              'updated_at', unresolved_request.updated_at
            )
            order by unresolved_request.updated_at desc,
              unresolved_request.id desc
          ),
          '[]'::jsonb
        )
        from (
          select
            request_list.id,
            request_list.requested_name,
            request_list.status,
            request_list.requested_quantity,
            request_list.delivered_quantity,
            product.serial_number as product_serial_number,
            request_list.created_at,
            request_list.updated_at
          from public.procurement_requests as request_list
          left join public.products as product
            on product.id = request_list.product_id
          where request_list.status in ('active', 'partly_delivered')
          order by request_list.updated_at desc, request_list.id desc
          limit 5
        ) as unresolved_request
      )
    )
    into procurement_section
    from public.procurement_requests as request
    where request.status in ('active', 'partly_delivered');
  end if;

  if can_view_inventory then
    select pg_catalog.jsonb_build_object(
      'active_product_count', pg_catalog.count(*) filter (
        where product.is_active
      ),
      'recent', (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'product_id', recent_product.product_id,
              'serial_number', recent_product.serial_number,
              'name', recent_product.name,
              'category', recent_product.category,
              'quantity', recent_product.quantity::text,
              'updated_at', recent_product.updated_at
            )
            order by recent_product.updated_at desc,
              recent_product.product_id desc
          ),
          '[]'::jsonb
        )
        from (
          select
            product_list.id as product_id,
            product_list.serial_number,
            product_list.name,
            product_list.category,
            balance.quantity,
            product_list.updated_at
          from public.products as product_list
          join public.inventory_balances as balance
            on balance.product_id = product_list.id
          where product_list.is_active
          order by product_list.updated_at desc, product_list.id desc
          limit 5
        ) as recent_product
      )
    )
    into inventory_section
    from public.products as product;
  end if;

  if can_view_activity then
    select pg_catalog.jsonb_build_object(
      'recent', coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'audit_log_id', recent_activity.audit_log_id,
            'actor_user_id', recent_activity.actor_user_id,
            'actor_full_name', recent_activity.actor_full_name,
            'action_type', recent_activity.action_type,
            'entity_type', recent_activity.entity_type,
            'entity_id', recent_activity.entity_id,
            'summary', recent_activity.summary,
            'created_at', recent_activity.created_at
          )
          order by recent_activity.created_at desc,
            recent_activity.audit_log_id desc
        ),
        '[]'::jsonb
      )
    )
    into activity_section
    from (
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
      where actor_is_admin
        or case audit.entity_type
          when 'project' then can_view_projects
          when 'project_product' then can_view_projects
          when 'project_product_component' then can_view_projects
          when 'procurement_request' then can_view_procurement
          when 'product' then can_view_inventory
          when 'brand' then can_view_inventory
          when 'product_inventory' then can_view_inventory
          when 'product_supplier' then (
            can_view_inventory or can_view_suppliers
          )
          when 'pcb_card' then can_view_pcb
          when 'pcb_bom_version' then can_view_pcb
          when 'pcb_production_run' then can_view_pcb
          when 'work_order' then can_view_work_orders
          when 'calendar_entry' then true
          when 'supplier' then can_view_suppliers
          else false
        end
      order by audit.created_at desc, audit.id desc
      limit 5
    ) as recent_activity;
  end if;

  with calendar_candidates as (
    select
      entry.entry_type as kind,
      entry.id,
      entry.title,
      entry.start_date,
      entry.end_date,
      entry.related_user_id,
      greatest(entry.start_date, dashboard_date) as effective_date
    from public.calendar_entries as entry
    where entry.end_date >= dashboard_date

    union all

    select
      'birthday'::text as kind,
      birthday.id,
      birthday.full_name as title,
      occurrence.occurrence_date as start_date,
      occurrence.occurrence_date as end_date,
      birthday.id as related_user_id,
      occurrence.occurrence_date as effective_date
    from public.user_profiles as birthday
    cross join lateral (
      select candidate.occurrence_date
      from (
        select case
          when pg_catalog.date_part('month', birthday.birthday) = 2
            and pg_catalog.date_part('day', birthday.birthday) = 29
            and not (
              year_value.year_number % 4 = 0
              and (
                year_value.year_number % 100 <> 0
                or year_value.year_number % 400 = 0
              )
            )
          then null
          else pg_catalog.make_date(
            year_value.year_number,
            pg_catalog.date_part('month', birthday.birthday)::integer,
            pg_catalog.date_part('day', birthday.birthday)::integer
          )
        end as occurrence_date
        from pg_catalog.generate_series(
          pg_catalog.date_part('year', dashboard_date)::integer,
          pg_catalog.date_part('year', dashboard_date)::integer + 8
        ) as year_value(year_number)
      ) as candidate
      where candidate.occurrence_date >= dashboard_date
      order by candidate.occurrence_date
      limit 1
    ) as occurrence
    where birthday.is_active
      and birthday.birthday is not null
  ), upcoming_calendar as (
    select
      candidate.kind,
      candidate.id,
      candidate.title,
      candidate.start_date,
      candidate.end_date,
      candidate.related_user_id,
      candidate.effective_date
    from calendar_candidates as candidate
    order by
      candidate.effective_date,
      candidate.start_date,
      candidate.kind,
      candidate.id
    limit 5
  )
  select pg_catalog.jsonb_build_object(
    'upcoming', coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'kind', upcoming.kind,
          'id', upcoming.id,
          'title', upcoming.title,
          'start_date', upcoming.start_date,
          'end_date', upcoming.end_date,
          'related_user_id', upcoming.related_user_id
        )
        order by
          upcoming.effective_date,
          upcoming.start_date,
          upcoming.kind,
          upcoming.id
      ),
      '[]'::jsonb
    )
  )
  into calendar_section
  from upcoming_calendar as upcoming;

  return pg_catalog.jsonb_build_object(
    'projects', projects_section,
    'work_orders', work_orders_section,
    'procurement', procurement_section,
    'inventory', inventory_section,
    'activity', activity_section,
    'calendar', calendar_section
  );
end;
$function$;

revoke all privileges
  on function public.get_dashboard_read_model()
  from public, anon, authenticated;

grant execute
  on function public.get_dashboard_read_model()
  to authenticated;
