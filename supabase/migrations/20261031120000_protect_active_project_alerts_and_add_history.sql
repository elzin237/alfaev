-- 185: local, forward-only condition dismissal protection and retained History.
create table public.project_condition_acknowledgments (
  recipient_user_id uuid not null references public.user_profiles(id),
  condition_kind text not null check(condition_kind in ('project_shortage','project_issue')),
  condition_id uuid not null,
  shortage_episode_id uuid references public.project_shortage_episodes(id),
  issue_activity_id uuid references public.project_activity_updates(id),
  acknowledged_at timestamptz not null default clock_timestamp(),
  primary key(recipient_user_id,condition_kind,condition_id),
  check((condition_kind='project_shortage' and shortage_episode_id=condition_id and issue_activity_id is null and shortage_episode_id is not null)
    or (condition_kind='project_issue' and issue_activity_id=condition_id and shortage_episode_id is null and issue_activity_id is not null))
);
alter table public.project_condition_acknowledgments enable row level security;
revoke all on public.project_condition_acknowledgments from public,anon,authenticated,service_role;
create trigger project_condition_acknowledgments_immutable before update or delete
  on public.project_condition_acknowledgments for each row execute function public.prevent_project_activity_history_mutation();
create trigger project_condition_acknowledgments_no_truncate before truncate
  on public.project_condition_acknowledgments for each statement execute function public.reject_work_order_material_shortage_history_mutation();

create function public.project_condition_acknowledged_at(p_kind text,p_condition uuid,p_recipient uuid,p_resolved timestamptz)
returns timestamptz language plpgsql stable security definer set search_path='' as $fn$
declare actor uuid:=public.require_dashboard_notification_actor(); stamp timestamptz;
begin
  if p_recipient is distinct from actor or not(public.current_user_is_admin() or public.has_permission('projects.view')) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  if p_resolved is null then return null; end if;
  select min(t.stamp) into stamp from (
    select a.acknowledged_at stamp from public.project_condition_acknowledgments a
      where a.recipient_user_id=actor and a.condition_kind=p_kind and a.condition_id=p_condition
    union all
    select r.dismissed_at from public.project_activity_alert_recipients r
      join public.project_activity_alerts n on n.id=r.alert_id
      left join public.project_shortage_events e on e.id=n.project_shortage_event_id
      where r.recipient_user_id=actor and r.dismissed_at>=p_resolved and (
        (p_kind='project_shortage' and n.notification_kind='shortage' and e.event_type='resolved' and e.episode_id=p_condition)
        or (p_kind='project_issue' and n.notification_kind='issue_resolved' and n.project_activity_id=p_condition))
  ) t;
  return stamp;
end;
$fn$;
-- An old opening-message dismissal is retained as receipt metadata, not inferred
-- to be a condition acknowledgment from timestamps alone (resolution may use
-- transaction time). A delivered resolution-message dismissal is positive proof.

create or replace function public.dismiss_project_alert_notification(p_notification_id uuid)
returns table(notification_id uuid,dismissed_at timestamptz)
language plpgsql volatile security definer set search_path='' as $fn$
declare actor uuid:=public.require_dashboard_notification_actor(); source record; receipt record;
  kind text; identity uuid; resolved timestamptz; stamp timestamptz;
begin
  if p_notification_id is null then raise exception 'Notification is required' using errcode='22023'; end if;
  if not(public.current_user_is_admin() or public.has_permission('projects.view')) then raise exception 'Access denied' using errcode='42501'; end if;
  select n.notification_kind,n.project_activity_id,a.activity_kind,e.episode_id into source
    from public.project_activity_alert_recipients r join public.project_activity_alerts n on n.id=r.alert_id
    left join public.project_activity_updates a on a.id=n.project_activity_id
    left join public.project_shortage_events e on e.id=n.project_shortage_event_id
    where r.id=p_notification_id and r.recipient_user_id=actor;
  if not found then raise exception 'Notification not found' using errcode='P0002'; end if;
  -- Source-first ordering matches reconciliation and issue resolution. Never take
  -- a Product lock after the episode, or an Activity lock after its recipient.
  if source.notification_kind='shortage' then
    kind:='project_shortage'; identity:=source.episode_id;
    select s.resolved_at into resolved from public.project_shortage_episodes s where s.id=identity for update;
    if not found then raise exception 'Condition not found' using errcode='P0002'; end if;
  elsif source.activity_kind='issue' then
    kind:='project_issue'; identity:=source.project_activity_id;
    perform 1 from public.project_activity_updates a where a.id=identity for update;
    select r.resolved_at into resolved from public.project_issue_resolutions r where r.project_activity_id=identity;
  end if;
  perform 1 from public.user_profiles p where p.id=actor and p.auth_user_id=auth.uid() and p.is_active for share;
  select r.* into receipt from public.project_activity_alert_recipients r
    where r.id=p_notification_id and r.recipient_user_id=actor for update;
  if not found or public.current_active_user_profile_id() is distinct from actor
    or not(public.current_user_is_admin() or (public.has_permission('dashboard.view') and public.has_permission('projects.view'))) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  if kind is not null and resolved is null then raise exception 'Active conditions cannot be dismissed' using errcode='55000'; end if;
  if kind is not null then
    stamp:=coalesce(public.project_condition_acknowledged_at(kind,identity,actor,resolved),clock_timestamp());
    insert into public.project_condition_acknowledgments(recipient_user_id,condition_kind,condition_id,shortage_episode_id,issue_activity_id,acknowledged_at)
      values(actor,kind,identity,case when kind='project_shortage' then identity end,case when kind='project_issue' then identity end,stamp)
      on conflict do nothing;
  end if;
  -- Preserve legacy response and one-way message receipts, including old active
  -- dismissals. Condition acknowledgment never overwrites the old timestamp.
  update public.project_activity_alert_recipients r set dismissed_at=greatest(clock_timestamp(),r.created_at)
    where r.id=p_notification_id and r.recipient_user_id=actor and r.dismissed_at is null
    returning r.* into receipt;
  if not found then select r.* into receipt from public.project_activity_alert_recipients r where r.id=p_notification_id and r.recipient_user_id=actor; end if;
  return query select receipt.id::uuid,receipt.dismissed_at::timestamptz;
end;
$fn$;

create function public.dashboard_alert_history_rows_v2(p_recipient uuid)
returns table(item jsonb) language plpgsql stable security definer set search_path='' as $fn$
declare actor uuid:=public.require_dashboard_notification_actor();
begin
  if p_recipient is distinct from actor then raise exception 'Access denied' using errcode='42501'; end if;
  if public.current_user_is_admin() or public.has_permission('projects.view') then
    return query select jsonb_build_object('condition_kind',s.condition_kind,'condition_id',s.condition_id,'condition_status','resolved',
      'target_type','project','project_id',s.project_id,'project_name',s.project_name,'product_id',s.product_id,'product_name',s.product_name,
      'product_serial_number',s.product_serial_number,'shortage_quantity',s.current_shortage_quantity,
      'opened_at',s.opened_at,'resolved_at',s.resolved_at,'notification_id',s.notification_id,'delivery_created_at',s.delivery_created_at,
      'read_at',s.read_at,'dismissed_at',s.dismissed_at,'navigation_allowed',true,
      'acknowledged_at',public.project_condition_acknowledged_at(s.condition_kind,s.condition_id,actor,s.resolved_at))
      from public.project_shortage_condition_rows(actor) s where s.condition_status='resolved';
    -- Resolution-only recipients retain their own historical delivery, but never
    -- become eligible for an active Issue through this History-only projection.
    return query with owned as (
      select distinct on (a.id) a.*,r.id notification_id,r.created_at delivery_created_at,r.read_at,r.dismissed_at
      from public.project_activity_alert_recipients r join public.project_activity_alerts n on n.id=r.alert_id
      join public.project_activity_updates a on a.id=n.project_activity_id and a.activity_kind='issue'
      join public.project_issue_resolutions resolution on resolution.project_activity_id=a.id
      where r.recipient_user_id=actor and (n.notification_kind='activity' or
        (n.notification_kind='issue_resolved' and n.project_issue_resolution_id=resolution.id))
      order by a.id,(n.notification_kind='activity') desc,r.created_at,r.id
    ) select jsonb_build_object('condition_kind','project_issue','condition_id',a.id,'condition_status','resolved','target_type','project',
      'project_id',a.project_id,'project_name',p.name,'activity_id',a.id,'title',a.title,'description',a.description,
      'author_user_id',a.author_user_id,'author_full_name',author.full_name,'opened_at',a.created_at,'resolved_at',resolution.resolved_at,
      'resolution_description',resolution.description,'resolved_by_user_id',resolution.resolved_by_user_id,'resolver_full_name',resolver.full_name,
      'notification_id',a.notification_id,'delivery_created_at',a.delivery_created_at,'read_at',a.read_at,'dismissed_at',a.dismissed_at,
      'navigation_allowed',true,'acknowledged_at',public.project_condition_acknowledged_at('project_issue',a.id,actor,resolution.resolved_at))
      from owned a join public.projects p on p.id=a.project_id join public.user_profiles author on author.id=a.author_user_id
      join public.project_issue_resolutions resolution on resolution.project_activity_id=a.id
      join public.user_profiles resolver on resolver.id=resolution.resolved_by_user_id;
  end if;
  if public.current_user_is_admin() or public.has_permission('work_orders.view') then
    return query with owned as (
      select distinct on (o.episode_id) r.*,o.episode_id from public.work_order_shortage_notification_recipients r
      join public.work_order_material_shortage_notification_outbox o on o.id=r.outbox_id where r.recipient_user_id=actor
      order by o.episode_id,(o.event_type='opened') desc,r.created_at,r.id
    ) select jsonb_build_object('condition_kind','work_order_shortage','condition_id',s.id,'condition_status','resolved','target_type','work_order',
      'work_order_id',s.work_order_id,'work_order_number',s.work_order_number,'product_id',s.product_id,'product_name',s.product_name_snapshot,
      'shortage_quantity',s.missing_quantity::text,'opened_at',s.opened_at,'resolved_at',s.resolved_at,'notification_id',r.id,
      'delivery_created_at',r.created_at,'read_at',coalesce(r.read_at,s.resolved_at),'navigation_allowed',true,
      'acknowledged_at',(select min(t.stamp) from (
        select d.dismissed_at stamp from public.work_order_shortage_resolved_dismissals d where d.episode_id=s.id and d.recipient_user_id=actor
        union all select old.dismissed_at from public.work_order_shortage_notification_recipients old
          join public.work_order_material_shortage_notification_outbox o on o.id=old.outbox_id
          where o.episode_id=s.id and old.recipient_user_id=actor and old.dismissed_at>=s.resolved_at) t))
      from owned r join public.work_order_material_shortage_episodes s on s.id=r.episode_id where s.resolved_at is not null;
  end if;
end;
$fn$;

create function public.acknowledge_dashboard_problem_v2(p_condition_kind text,p_condition_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $fn$
declare actor uuid:=public.require_dashboard_notification_actor(); receipt uuid; stamp timestamptz;
begin
  if p_condition_id is null or p_condition_kind is null or p_condition_kind not in ('project_shortage','project_issue','work_order_shortage') then
    raise exception 'Invalid condition' using errcode='22023'; end if;
  select (c.item->>'notification_id')::uuid into receipt from (
    select i.item from public.dashboard_problem_condition_rows_v2(actor) i
    union all select h.item from public.dashboard_alert_history_rows_v2(actor) h
  ) c where c.item->>'condition_kind'=p_condition_kind and (c.item->>'condition_id')::uuid=p_condition_id limit 1;
  if receipt is null then raise exception 'Condition not found' using errcode='P0002'; end if;
  select d.dismissed_at into stamp from public.dismiss_dashboard_notification(receipt) d;
  if p_condition_kind<>'work_order_shortage' then
    select a.acknowledged_at into stamp from public.project_condition_acknowledgments a
      where a.recipient_user_id=actor and a.condition_kind=p_condition_kind and a.condition_id=p_condition_id;
  end if;
  return jsonb_build_object('condition_kind',p_condition_kind,'condition_id',p_condition_id,'acknowledged_at',stamp);
end;
$fn$;

create function public.list_dashboard_alert_history_v2(p_limit integer default 20,p_before_resolved_at timestamptz default null,
  p_before_kind text default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor uuid:=public.require_dashboard_notification_actor(); result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 or num_nonnulls(p_before_resolved_at,p_before_kind,p_before_id) not in (0,3)
    or (p_before_kind is not null and p_before_kind not in ('project_shortage','project_issue','work_order_shortage')) then
    raise exception 'Invalid page' using errcode='22023'; end if;
  with bounded as materialized (
    select h.item from public.dashboard_alert_history_rows_v2(actor) h where p_before_resolved_at is null
      or ((h.item->>'resolved_at')::timestamptz,h.item->>'condition_kind',(h.item->>'condition_id')::uuid)<(p_before_resolved_at,p_before_kind,p_before_id)
    order by (h.item->>'resolved_at')::timestamptz desc,h.item->>'condition_kind' desc,(h.item->>'condition_id')::uuid desc limit p_limit+1
  ), page as materialized (
    select b.item from bounded b order by (b.item->>'resolved_at')::timestamptz desc,b.item->>'condition_kind' desc,(b.item->>'condition_id')::uuid desc limit p_limit
  ) select jsonb_build_object('contract_version',2,'as_of',statement_timestamp(),
    'items',coalesce((select jsonb_agg(p.item order by (p.item->>'resolved_at')::timestamptz desc,p.item->>'condition_kind' desc,(p.item->>'condition_id')::uuid desc) from page p),'[]'::jsonb),
    'has_more',(select count(*)>p_limit from bounded),
    'next_cursor',case when (select count(*)>p_limit from bounded) then
      (select jsonb_build_object('before_resolved_at',p.item->'resolved_at','before_kind',p.item->'condition_kind','before_id',p.item->'condition_id')
      from page p order by (p.item->>'resolved_at')::timestamptz,p.item->>'condition_kind',(p.item->>'condition_id')::uuid limit 1) else null end) into result;
  return result;
end;
$fn$;

revoke all on function public.project_condition_acknowledged_at(text,uuid,uuid,timestamptz),public.dashboard_alert_history_rows_v2(uuid),
  public.acknowledge_dashboard_problem_v2(text,uuid),public.list_dashboard_alert_history_v2(integer,timestamptz,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.acknowledge_dashboard_problem_v2(text,uuid),public.list_dashboard_alert_history_v2(integer,timestamptz,text,uuid) to authenticated;

-- Preserve the v2 public response shape; acknowledged resolved Project conditions
-- leave the ordinary inbox, but remain in the separate retained History read.
create or replace function public.dashboard_alert_page_v2(p_updates boolean,p_limit integer,p_before_created_at timestamptz,
  p_before_kind text,p_before_id uuid,p_status text)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor uuid:=public.require_dashboard_notification_actor(); result jsonb;
begin
  if p_updates is null or p_limit is null or p_limit not between 1 and 50 or p_status is null or p_status not in ('all','active','resolved')
    or (num_nonnulls(p_before_created_at,p_before_kind,p_before_id) not in (0,3))
    or (p_before_kind is not null and p_before_kind not in ('project_shortage','project_issue','work_order_shortage','informational_update')) then
    raise exception 'Invalid page' using errcode='22023';
  end if;
  with candidates as materialized (
    select c.item from public.dashboard_problem_condition_rows_v2(actor) c where not p_updates
      and case when c.item->>'condition_status'='resolved' and c.item->>'condition_kind' in ('project_shortage','project_issue')
        then public.project_condition_acknowledged_at(c.item->>'condition_kind',(c.item->>'condition_id')::uuid,actor,(c.item->>'resolved_at')::timestamptz) is null else true end
    union all
    select u.item from public.dashboard_informational_update_rows_v2(actor) u where p_updates
  ), bounded as materialized (
    select c.item from candidates c
    where (p_updates or p_status='all' or c.item->>'condition_status'=p_status)
      and (p_before_created_at is null or ((c.item->>'delivery_created_at')::timestamptz,c.item->>'condition_kind',(c.item->>'condition_id')::uuid)
        < (p_before_created_at,p_before_kind,p_before_id))
    order by (c.item->>'delivery_created_at')::timestamptz desc,c.item->>'condition_kind' desc,(c.item->>'condition_id')::uuid desc limit p_limit+1
  ), page as materialized (
    select b.item from bounded b order by (b.item->>'delivery_created_at')::timestamptz desc,b.item->>'condition_kind' desc,(b.item->>'condition_id')::uuid desc limit p_limit
  ) select jsonb_build_object('contract_version',2,'as_of',statement_timestamp(),
    'items',coalesce((select jsonb_agg(p.item order by (p.item->>'delivery_created_at')::timestamptz desc,p.item->>'condition_kind' desc,(p.item->>'condition_id')::uuid desc) from page p),'[]'::jsonb),
    'has_more',(select count(*)>p_limit from bounded),
    'next_cursor',case when (select count(*)>p_limit from bounded) then
      (select jsonb_build_object('before_created_at',p.item->'delivery_created_at','before_kind',p.item->'condition_kind','before_id',p.item->'condition_id')
        from page p order by (p.item->>'delivery_created_at')::timestamptz,p.item->>'condition_kind',(p.item->>'condition_id')::uuid limit 1) else null end)
    into result;
  return result;
end;
$fn$;
