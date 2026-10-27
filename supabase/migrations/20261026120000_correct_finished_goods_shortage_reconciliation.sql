-- Task 1/4: correct FG shortage stock basis without backfill or accounting writes.
-- Shared deficit = all open demand - physical stock. Reservations change only
-- which Projects are uncovered, not the shared deficit itself. Existing history,
-- recipient snapshots, fanout rules, advisory lock and deferred queue are retained.
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
  finished_product boolean;
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

    finished_product := public.is_calculator_finished_product(current_product_id);

    select coalesce(pg_catalog.sum(balance.quantity::numeric), 0::numeric)
    into eligible_physical_stock
    from public.inventory_balances as balance
    where balance.product_id = current_product_id
      and balance.warehouse_id = any(case when finished_product then
        array['10000000-0000-4000-8000-000000000002'::uuid]
      else array['10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000003'::uuid] end);

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
              and (
                not finished_product
                or commitment.outstanding_commitment > coalesce((
                  select reservation.reserved_quantity::numeric
                  from public.finished_goods_project_reservations as reservation
                  where reservation.project_id = commitment.project_id
                    and reservation.product_id = current_product_id
                ), 0::numeric)
              )
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
        and (
          not finished_product
          or commitment.outstanding_commitment > coalesce((
            select reservation.reserved_quantity::numeric
            from public.finished_goods_project_reservations as reservation
            where reservation.project_id = commitment.project_id
              and reservation.product_id = current_product_id
          ), 0::numeric)
        )
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
      and (new.warehouse_id in (
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000003'::uuid
      ) or (new.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid
        and public.is_calculator_finished_product(new.product_id)))
    then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), new.product_id)
      on conflict do nothing;
    end if;
    if tg_op <> 'INSERT'
      and (old.warehouse_id in (
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000003'::uuid
      ) or (old.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid
        and public.is_calculator_finished_product(old.product_id)))
    then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), old.product_id)
      on conflict do nothing;
    end if;
  elsif tg_table_name = 'inventory_movements' then
    if tg_op = 'INSERT'
      and new.project_id is not null
      and new.quantity_delta < 0
      and new.source_type in ('work_order', 'pcb_production_input', 'finished_goods_reservation_fulfillment')
    then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), new.product_id)
      on conflict do nothing;
    end if;
  elsif tg_table_name = 'finished_goods_project_reservations' then
    -- Changes affect Project eligibility, never the shared physical deficit.
    insert into public.project_shortage_reconciliation_queue (
      transaction_id, product_id
    ) values (pg_catalog.txid_current(), new.product_id)
    on conflict do nothing;
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


revoke all on function public.queue_project_shortage_reconciliation()
  from public, anon, authenticated, service_role;

create trigger finished_goods_reservations_queue_shortage_reconciliation
  after insert or update of reserved_quantity
  on public.finished_goods_project_reservations
  for each row execute function public.queue_project_shortage_reconciliation();

-- Intentionally no initialize/reconcile call or deployment-time notification.

