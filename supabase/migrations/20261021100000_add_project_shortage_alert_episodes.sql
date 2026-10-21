create table public.project_shortage_episodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  product_id uuid not null,
  current_shortage_quantity numeric not null,
  opened_at timestamptz not null default transaction_timestamp(),
  resolved_at timestamptz,
  constraint project_shortage_episodes_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete restrict,
  constraint project_shortage_episodes_product_id_fkey
    foreign key (product_id) references public.products(id) on delete restrict,
  constraint project_shortage_episodes_identity_key
    unique (id, project_id, product_id),
  constraint project_shortage_episodes_quantity_state_valid
    check (
      (resolved_at is null and current_shortage_quantity > 0)
      or (resolved_at is not null and current_shortage_quantity = 0)
    ),
  constraint project_shortage_episodes_resolution_time_valid
    check (resolved_at is null or resolved_at >= opened_at)
);

create unique index project_shortage_episodes_active_key
  on public.project_shortage_episodes (project_id, product_id)
  where resolved_at is null;

create index project_shortage_episodes_product_active_idx
  on public.project_shortage_episodes (product_id, project_id)
  where resolved_at is null;

create table public.project_shortage_events (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null,
  project_id uuid not null,
  product_id uuid not null,
  event_type text not null,
  shortage_quantity numeric not null,
  is_baseline_detection boolean not null default false,
  detection_label text,
  created_at timestamptz not null default transaction_timestamp(),
  constraint project_shortage_events_episode_target_fkey
    foreign key (episode_id, project_id, product_id)
    references public.project_shortage_episodes(id, project_id, product_id)
    on delete restrict,
  constraint project_shortage_events_notification_identity_key
    unique (id, project_id, product_id, event_type, shortage_quantity),
  constraint project_shortage_events_type_allowed
    check (event_type in ('opened', 'increased', 'decreased', 'resolved')),
  constraint project_shortage_events_quantity_valid
    check (
      (event_type in ('opened', 'increased', 'decreased') and shortage_quantity > 0)
      or (event_type = 'resolved' and shortage_quantity = 0)
    ),
  constraint project_shortage_events_baseline_valid
    check (
      (
        is_baseline_detection
        and event_type = 'opened'
        and detection_label = 'existing shortage detected at enablement'
      )
      or (
        not is_baseline_detection
        and detection_label is null
      )
    )
);

create index project_shortage_events_episode_history_idx
  on public.project_shortage_events (episode_id, created_at, id);

create function public.enforce_project_shortage_episode_state()
returns trigger
language plpgsql
volatile
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Project shortage episodes cannot be deleted'
      using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.product_id is distinct from old.product_id
    or new.opened_at is distinct from old.opened_at
    or old.resolved_at is not null
    or (
      new.resolved_at is null
      and new.current_shortage_quantity <= 0
    )
    or (
      new.resolved_at is not null
      and (
        new.resolved_at < old.opened_at
        or new.current_shortage_quantity <> 0
      )
    )
  then
    raise exception 'Invalid Project shortage episode transition'
      using errcode = '55000';
  end if;

  return new;
end;
$function$;

create trigger project_shortage_episodes_protect_state
before update or delete on public.project_shortage_episodes
for each row execute function public.enforce_project_shortage_episode_state();

create trigger project_shortage_events_reject_update_delete
before update or delete on public.project_shortage_events
for each row execute function public.prevent_project_activity_history_mutation();

alter table public.project_shortage_episodes enable row level security;
alter table public.project_shortage_events enable row level security;

revoke all privileges on table public.project_shortage_episodes
  from public, anon, authenticated;
revoke all privileges on table public.project_shortage_events
  from public, anon, authenticated;
revoke all privileges on function public.enforce_project_shortage_episode_state()
  from public, anon, authenticated, service_role;

alter table public.project_activity_alerts
  alter column sent_by_user_id drop not null,
  add column project_shortage_event_id uuid,
  add column product_id uuid,
  add column shortage_event_type text,
  add column shortage_quantity numeric;

alter table public.project_activity_alerts
  drop constraint project_activity_alerts_target_valid,
  add constraint project_activity_alerts_shortage_event_target_fkey
    foreign key (
      project_shortage_event_id,
      project_id,
      product_id,
      shortage_event_type,
      shortage_quantity
    )
    references public.project_shortage_events(
      id,
      project_id,
      product_id,
      event_type,
      shortage_quantity
    )
    on delete restrict,
  add constraint project_activity_alerts_target_valid
    check (
      (
        notification_kind = 'activity'
        and project_activity_id is not null
        and sent_by_user_id is not null
        and project_issue_resolution_id is null
        and project_id is null
        and project_shortage_event_id is null
        and product_id is null
        and shortage_event_type is null
        and shortage_quantity is null
      )
      or (
        notification_kind = 'issue_resolved'
        and project_activity_id is not null
        and sent_by_user_id is not null
        and project_issue_resolution_id is not null
        and project_id is null
        and project_shortage_event_id is null
        and product_id is null
        and shortage_event_type is null
        and shortage_quantity is null
      )
      or (
        notification_kind = 'shortage'
        and project_activity_id is null
        and sent_by_user_id is null
        and project_issue_resolution_id is null
        and project_id is not null
        and project_shortage_event_id is not null
        and product_id is not null
        and shortage_event_type in ('opened', 'resolved')
        and shortage_quantity is not null
        and shortage_quantity >= 0
      )
    );

create unique index project_activity_alerts_shortage_event_notification_key
  on public.project_activity_alerts (project_shortage_event_id)
  where notification_kind = 'shortage';

drop function public.list_project_notifications(integer, timestamptz, uuid);

create function public.list_project_notifications(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_recipient_id uuid default null
)
returns table (
  notification_id uuid,
  event_id uuid,
  notification_kind text,
  project_id uuid,
  project_name text,
  activity_id uuid,
  activity_title text,
  activity_author_full_name text,
  resolution_id uuid,
  resolver_full_name text,
  resolved_at timestamptz,
  created_at timestamptz,
  read_at timestamptz,
  has_more boolean,
  product_id uuid,
  product_serial_number text,
  product_name text,
  shortage_event_type text,
  shortage_quantity text,
  is_baseline_detection boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
begin
  actor_profile_id := public.current_active_user_profile_id();

  if auth.uid() is null
    or actor_profile_id is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('dashboard.view')
    )
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Page size must be between 1 and 50'
      using errcode = '22023';
  end if;

  if (p_before_created_at is null) <> (p_before_recipient_id is null) then
    raise exception 'Notification cursor must include both created_at and recipient ID'
      using errcode = '22023';
  end if;

  return query
  with candidates as (
    select
      recipient.id as notification_id,
      notification.id as event_id,
      notification.notification_kind,
      coalesce(activity.project_id, notification.project_id) as project_id,
      project.name as project_name,
      activity.id as activity_id,
      activity.title as activity_title,
      author.full_name as activity_author_full_name,
      resolution.id as resolution_id,
      resolver.full_name as resolver_full_name,
      resolution.resolved_at,
      recipient.created_at,
      recipient.read_at,
      product.id as product_id,
      product.serial_number as product_serial_number,
      product.name as product_name,
      shortage_event.event_type as shortage_event_type,
      shortage_event.shortage_quantity::text as shortage_quantity,
      shortage_event.is_baseline_detection
    from public.project_activity_alert_recipients as recipient
    join public.project_activity_alerts as notification
      on notification.id = recipient.alert_id
    left join public.project_activity_updates as activity
      on activity.id = notification.project_activity_id
    join public.projects as project
      on project.id = coalesce(activity.project_id, notification.project_id)
    left join public.user_profiles as author
      on author.id = activity.author_user_id
    left join public.project_issue_resolutions as resolution
      on resolution.id = notification.project_issue_resolution_id
    left join public.user_profiles as resolver
      on resolver.id = resolution.resolved_by_user_id
    left join public.project_shortage_events as shortage_event
      on shortage_event.id = notification.project_shortage_event_id
      and shortage_event.project_id = notification.project_id
      and shortage_event.product_id = notification.product_id
      and shortage_event.event_type = notification.shortage_event_type
      and shortage_event.shortage_quantity = notification.shortage_quantity
    left join public.project_shortage_episodes as shortage_episode
      on shortage_episode.id = shortage_event.episode_id
      and shortage_episode.project_id = shortage_event.project_id
      and shortage_episode.product_id = shortage_event.product_id
    left join public.products as product
      on product.id = shortage_episode.product_id
    where recipient.recipient_user_id = actor_profile_id
      and recipient.dismissed_at is null
      and (
        p_before_created_at is null
        or (recipient.created_at, recipient.id) <
          (p_before_created_at, p_before_recipient_id)
      )
    order by recipient.created_at desc, recipient.id desc
    limit p_limit + 1
  )
  select
    candidate.notification_id,
    candidate.event_id,
    candidate.notification_kind,
    candidate.project_id,
    candidate.project_name,
    candidate.activity_id,
    candidate.activity_title,
    candidate.activity_author_full_name,
    candidate.resolution_id,
    candidate.resolver_full_name,
    candidate.resolved_at,
    candidate.created_at,
    candidate.read_at,
    (select pg_catalog.count(*) > p_limit from candidates) as has_more,
    candidate.product_id,
    candidate.product_serial_number,
    candidate.product_name,
    candidate.shortage_event_type,
    candidate.shortage_quantity,
    candidate.is_baseline_detection
  from candidates as candidate
  order by candidate.created_at desc, candidate.notification_id desc
  limit p_limit;
end;
$function$;

revoke all privileges
  on function public.list_project_notifications(integer, timestamptz, uuid)
  from public, anon, authenticated;

grant execute
  on function public.list_project_notifications(integer, timestamptz, uuid)
  to authenticated;

create or replace function public.get_project_alert_unread_count()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  unread_count bigint;
begin
  actor_profile_id := public.current_active_user_profile_id();

  if auth.uid() is null
    or actor_profile_id is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('dashboard.view')
    )
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  select pg_catalog.count(*)
  into unread_count
  from public.project_activity_alert_recipients as recipient
  join public.project_activity_alerts as alert
    on alert.id = recipient.alert_id
  left join public.project_activity_updates as activity
    on activity.id = alert.project_activity_id
  join public.projects as project
    on project.id = coalesce(activity.project_id, alert.project_id)
  where recipient.recipient_user_id = actor_profile_id
    and recipient.read_at is null
    and recipient.dismissed_at is null;

  return unread_count;
end;
$function$;

revoke all privileges
  on function public.get_project_alert_unread_count()
  from public, anon, authenticated;

grant execute
  on function public.get_project_alert_unread_count()
  to authenticated;

create table public.project_shortage_reconciliation_queue (
  transaction_id bigint not null,
  product_id uuid not null,
  constraint project_shortage_reconciliation_queue_pkey
    primary key (transaction_id, product_id),
  constraint project_shortage_reconciliation_queue_product_id_fkey
    foreign key (product_id) references public.products(id) on delete cascade
);

alter table public.project_shortage_reconciliation_queue enable row level security;
revoke all privileges on table public.project_shortage_reconciliation_queue
  from public, anon, authenticated, service_role;

create function public.reconcile_project_shortages_for_products(
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
  global_shortage numeric;
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
    perform 1
    from public.products as product
    where product.id = current_product_id
    for update;

    if not found then
      continue;
    end if;

    select greatest(
      -(balance.quantity::numeric - coalesce(
        pg_catalog.sum(commitment.outstanding_commitment), 0::numeric
      )),
      0::numeric
    )
    into global_shortage
    from public.inventory_balances as balance
    left join public.calculate_open_project_commitments(current_product_id)
      as commitment on true
    where balance.product_id = current_product_id
    group by balance.quantity;

    global_shortage := coalesce(global_shortage, 0::numeric);

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

create function public.queue_project_shortage_reconciliation()
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

create function public.process_project_shortage_reconciliation_queue()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  affected_products uuid[];
begin
  select pg_catalog.array_agg(queue.product_id order by queue.product_id)
  into affected_products
  from public.project_shortage_reconciliation_queue as queue
  where queue.transaction_id = new.transaction_id;

  if affected_products is null then
    return new;
  end if;

  perform public.reconcile_project_shortages_for_products(
    affected_products,
    false
  );

  delete from public.project_shortage_reconciliation_queue as queue
  where queue.transaction_id = new.transaction_id;

  return new;
end;
$function$;

create trigger inventory_balances_queue_shortage_reconciliation
after insert or update of quantity or delete on public.inventory_balances
for each row execute function public.queue_project_shortage_reconciliation();

create trigger project_components_queue_shortage_reconciliation
after insert or update of project_product_id, product_id, required_quantity or delete
on public.project_product_components
for each row execute function public.queue_project_shortage_reconciliation();

create trigger projects_queue_shortage_reconciliation
after update of status on public.projects
for each row execute function public.queue_project_shortage_reconciliation();

create constraint trigger project_shortage_reconciliation_queue_process
after insert on public.project_shortage_reconciliation_queue
deferrable initially deferred
for each row execute function public.process_project_shortage_reconciliation_queue();

create function public.initialize_project_shortage_alerts()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  product_ids uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('project-shortage-baseline-v1', 0)
  );

  select pg_catalog.array_agg(product.id order by product.id)
  into product_ids
  from public.products as product;

  if product_ids is not null then
    perform public.reconcile_project_shortages_for_products(product_ids, true);
  end if;
end;
$function$;

revoke all privileges
  on function public.reconcile_project_shortages_for_products(uuid[], boolean)
  from public, anon, authenticated, service_role;
revoke all privileges
  on function public.queue_project_shortage_reconciliation()
  from public, anon, authenticated, service_role;
revoke all privileges
  on function public.process_project_shortage_reconciliation_queue()
  from public, anon, authenticated, service_role;
revoke all privileges
  on function public.initialize_project_shortage_alerts()
  from public, anon, authenticated, service_role;

select public.initialize_project_shortage_alerts();
