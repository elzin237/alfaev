-- Project commitments remain a shared Product-level planning model. Physical
-- availability for that model is Raw Materials plus Customs Warehouse; Finished
-- Goods remains valid production input but is not Project-availability stock.

create or replace function public.calculate_open_project_commitments(
  p_product_id uuid default null
)
returns table (
  project_id uuid,
  project_name text,
  product_id uuid,
  planned_requirement numeric,
  actual_project_consumption numeric,
  outstanding_commitment numeric
)
language sql
stable
set search_path = ''
as $function$
  with planned as (
    select
      project.id as project_id,
      project.name as project_name,
      component.product_id,
      pg_catalog.sum(component.required_quantity::numeric) as planned_requirement
    from public.projects as project
    join public.project_products as project_product
      on project_product.project_id = project.id
    join public.project_product_components as component
      on component.project_product_id = project_product.id
    where project.status in ('planned', 'in_progress', 'on_hold')
      and (p_product_id is null or component.product_id = p_product_id)
    group by project.id, project.name, component.product_id
  ),
  consumed as (
    select
      movement.project_id,
      movement.product_id,
      pg_catalog.sum(-movement.quantity_delta::numeric) as consumed_quantity
    from public.inventory_movements as movement
    where movement.project_id is not null
      and movement.quantity_delta < 0
      and movement.source_type in ('work_order', 'pcb_production_input')
      and (p_product_id is null or movement.product_id = p_product_id)
    group by movement.project_id, movement.product_id
  )
  select
    planned.project_id,
    planned.project_name,
    planned.product_id,
    planned.planned_requirement,
    coalesce(consumed.consumed_quantity, 0::numeric),
    greatest(
      planned.planned_requirement -
        coalesce(consumed.consumed_quantity, 0::numeric),
      0::numeric
    )
  from planned
  left join consumed
    on consumed.project_id = planned.project_id
    and consumed.product_id = planned.product_id;
$function$;

revoke all privileges
  on function public.calculate_open_project_commitments(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.get_inventory_project_commitments()
returns table (
  product_id uuid,
  physical_quantity bigint,
  committed_to_projects numeric,
  available_after_commitments numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not (
    public.current_user_is_admin()
    or (
      public.has_permission('inventory.raw_materials.view')
      and public.has_permission('inventory.customs.view')
    )
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  return query
  with eligible_balances as (
    select
      balance.product_id,
      pg_catalog.sum(balance.quantity::numeric) as eligible_quantity
    from public.inventory_balances as balance
    where balance.warehouse_id in (
      '10000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000003'::uuid
    )
    group by balance.product_id
  )
  select
    product.id,
    coalesce(balance.eligible_quantity, 0::numeric)::bigint,
    coalesce(pg_catalog.sum(commitment.outstanding_commitment), 0::numeric),
    coalesce(balance.eligible_quantity, 0::numeric) -
      coalesce(pg_catalog.sum(commitment.outstanding_commitment), 0::numeric)
  from public.products as product
  left join eligible_balances as balance
    on balance.product_id = product.id
  left join public.calculate_open_project_commitments() as commitment
    on commitment.product_id = product.id
  group by product.id, product.serial_number, balance.eligible_quantity
  order by product.serial_number, product.id;
end;
$function$;

create or replace function public.get_product_project_commitments(p_product_id uuid)
returns table (
  project_id uuid,
  project_name text,
  planned_requirement numeric,
  actual_project_consumption numeric,
  outstanding_commitment numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not (
    public.current_user_is_admin()
    or (
      public.has_permission('inventory.raw_materials.view')
      and public.has_permission('inventory.customs.view')
    )
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_product_id is null then
    raise exception 'Product is required' using errcode = '22023';
  end if;

  return query
  select
    commitment.project_id,
    commitment.project_name,
    commitment.planned_requirement,
    commitment.actual_project_consumption,
    commitment.outstanding_commitment
  from public.calculate_open_project_commitments(p_product_id) as commitment
  where commitment.outstanding_commitment > 0
  order by pg_catalog.lower(commitment.project_name),
    commitment.project_name, commitment.project_id;
end;
$function$;

revoke all privileges
  on function public.get_inventory_project_commitments()
  from public, anon, authenticated, service_role;
revoke all privileges
  on function public.get_product_project_commitments(uuid)
  from public, anon, authenticated, service_role;
grant execute
  on function public.get_inventory_project_commitments()
  to authenticated;
grant execute
  on function public.get_product_project_commitments(uuid)
  to authenticated;

create or replace function public.get_project_planning(p_project_id uuid)
returns table (
  project_product_id uuid,
  project_product_name text,
  component_id uuid,
  product_id uuid,
  serial_number text,
  product_name text,
  product_kind text,
  required_quantity text,
  category text,
  brand_name text,
  physical_quantity text,
  committed_to_projects text,
  available_after_commitments text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  can_view_inventory boolean;
begin
  if not (
    public.current_user_is_admin()
    or public.has_permission('projects.view')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_project_id is null then
    raise exception 'Project is required' using errcode = '22023';
  end if;

  can_view_inventory := public.current_user_is_admin()
    or (
      public.has_permission('inventory.raw_materials.view')
      and public.has_permission('inventory.customs.view')
    );

  return query
  with product_commitments as (
    select
      commitment.product_id,
      pg_catalog.sum(commitment.outstanding_commitment) as committed_quantity
    from public.calculate_open_project_commitments() as commitment
    group by commitment.product_id
  ),
  eligible_balances as (
    select
      balance.product_id,
      pg_catalog.sum(balance.quantity::numeric) as eligible_quantity
    from public.inventory_balances as balance
    where balance.warehouse_id in (
      '10000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000003'::uuid
    )
    group by balance.product_id
  )
  select
    project_product.id,
    project_product.name,
    component.id,
    product.id,
    product.serial_number,
    product.name,
    product.product_kind,
    component.required_quantity::text,
    case when can_view_inventory then product.category else null::text end,
    case when can_view_inventory then brand.name else null::text end,
    case when can_view_inventory then balance.eligible_quantity::text else null::text end,
    case when can_view_inventory and product.id is not null then
      coalesce(commitment.committed_quantity, 0::numeric)::text
    else null::text end,
    case when can_view_inventory and product.id is not null then
      (coalesce(balance.eligible_quantity, 0::numeric) -
        coalesce(commitment.committed_quantity, 0::numeric))::text
    else null::text end
  from public.project_products as project_product
  left join public.project_product_components as component
    on component.project_product_id = project_product.id
  left join public.products as product
    on product.id = component.product_id
  left join public.brands as brand
    on brand.id = product.brand_id
  left join eligible_balances as balance
    on balance.product_id = product.id
  left join product_commitments as commitment
    on commitment.product_id = product.id
  where project_product.project_id = p_project_id
  order by
    pg_catalog.lower(project_product.name),
    project_product.name,
    project_product.id,
    product.serial_number nulls first,
    component.id;
end;
$function$;

revoke all privileges
  on function public.get_project_planning(uuid)
  from public, anon, authenticated, service_role;
grant execute
  on function public.get_project_planning(uuid)
  to authenticated;

create or replace function public.reconcile_project_shortages_for_products(
  p_product_ids uuid[],
  p_baseline_detection boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  active_episode record;
  affected_project record;
  created_event_id uuid;
  created_episode_id uuid;
  created_notification_id uuid;
  current_episode record;
  current_product_id uuid;
  eligible_physical_stock numeric;
  global_shortage numeric;
  outstanding_commitments numeric;
begin
  if p_product_ids is null or p_baseline_detection is null then
    raise exception 'Shortage reconciliation inputs are required'
      using errcode = '22023';
  end if;

  for current_product_id in
    select distinct candidate.product_id
    from pg_catalog.unnest(p_product_ids) as candidate(product_id)
    where candidate.product_id is not null
    order by candidate.product_id
  loop
    -- Reconciliation runs from a deferred trigger after the mutating operation
    -- has already locked its warehouse balances. Use a Product-scoped advisory
    -- lock so concurrent warehouse transactions serialize reconciliation
    -- without inverting the Product -> balance lock order used by trusted
    -- Inventory and Work Order operations.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'project-shortage-reconciliation:' || current_product_id::text,
        0
      )
    );

    perform 1
    from public.products as product
    where product.id = current_product_id;

    if not found then
      continue;
    end if;

    select coalesce(pg_catalog.sum(balance.quantity::numeric), 0::numeric)
    into eligible_physical_stock
    from public.inventory_balances as balance
    where balance.product_id = current_product_id
      and balance.warehouse_id in (
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000003'::uuid
      );

    select coalesce(
      pg_catalog.sum(commitment.outstanding_commitment), 0::numeric
    )
    into outstanding_commitments
    from public.calculate_open_project_commitments(current_product_id)
      as commitment;

    global_shortage := greatest(
      -(eligible_physical_stock - outstanding_commitments),
      0::numeric
    );

    for active_episode in
      select episode.*
      from public.project_shortage_episodes as episode
      where episode.product_id = current_product_id
        and episode.resolved_at is null
        and (
          global_shortage = 0
          or not exists (
            select 1
            from public.calculate_open_project_commitments(current_product_id)
              as commitment
            where commitment.project_id = episode.project_id
              and commitment.outstanding_commitment > 0
          )
        )
      order by episode.project_id
      for update
    loop
      update public.project_shortage_episodes as episode
      set current_shortage_quantity = 0,
          resolved_at = transaction_timestamp()
      where episode.id = active_episode.id;

      insert into public.project_shortage_events (
        episode_id, project_id, product_id, event_type, shortage_quantity
      ) values (
        active_episode.id, active_episode.project_id, current_product_id,
        'resolved', 0
      ) returning id into created_event_id;

      insert into public.project_activity_alerts (
        project_activity_id, sent_by_user_id, notification_kind,
        project_id, project_issue_resolution_id,
        project_shortage_event_id, product_id,
        shortage_event_type, shortage_quantity
      ) values (
        null, null, 'shortage', active_episode.project_id, null,
        created_event_id, current_product_id, 'resolved', 0
      ) returning id into created_notification_id;

      insert into public.project_activity_alert_recipients (
        alert_id, recipient_user_id
      )
      select created_notification_id, eligible.id
      from (
        select profile.id
        from public.user_profiles as profile
        where profile.is_active
          and (
            profile.is_admin
            or (
              not profile.is_admin
              and exists (
                select 1 from public.user_permissions as permission
                join public.permission_definitions as definition
                  on definition.id = permission.permission_definition_id
                where permission.user_id = profile.id
                  and definition.key = 'dashboard.view'
                  and definition.is_delegable
              )
              and exists (
                select 1 from public.user_permissions as permission
                join public.permission_definitions as definition
                  on definition.id = permission.permission_definition_id
                where permission.user_id = profile.id
                  and definition.key = 'projects.view'
                  and definition.is_delegable
              )
            )
          )
        order by profile.id
        for share of profile
      ) as eligible;
    end loop;

    if global_shortage = 0 then
      continue;
    end if;

    for affected_project in
      select commitment.project_id
      from public.calculate_open_project_commitments(current_product_id)
        as commitment
      where commitment.outstanding_commitment > 0
      order by commitment.project_id
    loop
      select episode.* into current_episode
      from public.project_shortage_episodes as episode
      where episode.project_id = affected_project.project_id
        and episode.product_id = current_product_id
        and episode.resolved_at is null
      for update;

      if not found then
        insert into public.project_shortage_episodes (
          project_id, product_id, current_shortage_quantity
        ) values (
          affected_project.project_id, current_product_id, global_shortage
        ) returning id into created_episode_id;

        insert into public.project_shortage_events (
          episode_id, project_id, product_id, event_type,
          shortage_quantity, is_baseline_detection, detection_label
        ) values (
          created_episode_id, affected_project.project_id, current_product_id,
          'opened', global_shortage, p_baseline_detection,
          case when p_baseline_detection
            then 'existing shortage detected at enablement'
            else null
          end
        ) returning id into created_event_id;

        insert into public.project_activity_alerts (
          project_activity_id, sent_by_user_id, notification_kind,
          project_id, project_issue_resolution_id,
          project_shortage_event_id, product_id,
          shortage_event_type, shortage_quantity
        ) values (
          null, null, 'shortage', affected_project.project_id, null,
          created_event_id, current_product_id, 'opened', global_shortage
        ) returning id into created_notification_id;

        insert into public.project_activity_alert_recipients (
          alert_id, recipient_user_id
        )
        select created_notification_id, eligible.id
        from (
          select profile.id
          from public.user_profiles as profile
          where profile.is_active
            and (
              profile.is_admin
              or (
                not profile.is_admin
                and exists (
                  select 1 from public.user_permissions as permission
                  join public.permission_definitions as definition
                    on definition.id = permission.permission_definition_id
                  where permission.user_id = profile.id
                    and definition.key = 'dashboard.view'
                    and definition.is_delegable
                )
                and exists (
                  select 1 from public.user_permissions as permission
                  join public.permission_definitions as definition
                    on definition.id = permission.permission_definition_id
                  where permission.user_id = profile.id
                    and definition.key = 'projects.view'
                    and definition.is_delegable
                )
              )
            )
          order by profile.id
          for share of profile
        ) as eligible;
      elsif current_episode.current_shortage_quantity is distinct from global_shortage then
        update public.project_shortage_episodes as episode
        set current_shortage_quantity = global_shortage
        where episode.id = current_episode.id;

        insert into public.project_shortage_events (
          episode_id, project_id, product_id, event_type, shortage_quantity
        ) values (
          current_episode.id, affected_project.project_id, current_product_id,
          case
            when global_shortage > current_episode.current_shortage_quantity
              then 'increased'
            else 'decreased'
          end,
          global_shortage
        );
      end if;
    end loop;
  end loop;
end;
$function$;

revoke all privileges
  on function public.reconcile_project_shortages_for_products(uuid[], boolean)
  from public, anon, authenticated, service_role;

create or replace function public.queue_project_shortage_reconciliation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  affected_product_id uuid;
begin
  if tg_table_name = 'inventory_balances' then
    if tg_op <> 'DELETE'
      and new.warehouse_id in (
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000003'::uuid
      )
    then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), new.product_id)
      on conflict do nothing;
    end if;
    if tg_op <> 'INSERT'
      and old.warehouse_id in (
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000003'::uuid
      )
    then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), old.product_id)
      on conflict do nothing;
    end if;
  elsif tg_table_name = 'project_product_components' then
    if tg_op <> 'DELETE' then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), new.product_id)
      on conflict do nothing;
    end if;
    if tg_op <> 'INSERT' then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), old.product_id)
      on conflict do nothing;
    end if;
  elsif tg_table_name = 'projects'
    and new.status is distinct from old.status
  then
    for affected_product_id in
      select distinct component.product_id
      from public.project_products as project_product
      join public.project_product_components as component
        on component.project_product_id = project_product.id
      where project_product.project_id = new.id
      order by component.product_id
    loop
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), affected_product_id)
      on conflict do nothing;
    end loop;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all privileges
  on function public.queue_project_shortage_reconciliation()
  from public, anon, authenticated, service_role;

-- Migration 140 intentionally does not run the baseline initializer or mutate
-- existing episodes/events. Existing history is retained; the next qualifying
-- transaction is reconciled once against its final warehouse-aware state.
