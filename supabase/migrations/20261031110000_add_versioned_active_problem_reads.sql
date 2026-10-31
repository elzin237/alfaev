-- 184: additive, inert reads. Existing counters, mutations and activation stay unchanged.
create function public.project_issue_condition_rows(p_recipient_id uuid)
returns table(item jsonb) language plpgsql stable security definer set search_path='' as $fn$
declare actor uuid:=public.require_dashboard_notification_actor();
begin
  if p_recipient_id is distinct from actor or not(public.current_user_is_admin() or public.has_permission('projects.view')) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  return query
  select jsonb_build_object(
    'condition_kind','project_issue','condition_id',a.id,'target_type','project',
    'condition_status',case when resolution.id is null then 'active' else 'resolved' end,
    'project_id',a.project_id,'project_name',p.name,'activity_id',a.id,
    'title',a.title,'description',a.description,'author_user_id',a.author_user_id,'author_full_name',author.full_name,
    'opened_at',a.created_at,'resolved_at',resolution.resolved_at,
    'resolution_description',resolution.description,'resolved_by_user_id',resolution.resolved_by_user_id,'resolver_full_name',resolver.full_name,
    'notification_id',r.id,'delivery_created_at',r.created_at,'read_at',r.read_at,
    'dismissed_at',r.dismissed_at,'navigation_allowed',true)
  from public.project_activity_alert_recipients r
  join public.project_activity_alerts n on n.id=r.alert_id and n.notification_kind='activity'
  join public.project_activity_updates a on a.id=n.project_activity_id and a.activity_kind='issue'
  join public.projects p on p.id=a.project_id
  join public.user_profiles author on author.id=a.author_user_id
  left join public.project_issue_resolutions resolution on resolution.project_activity_id=a.id
  left join public.user_profiles resolver on resolver.id=resolution.resolved_by_user_id
  where r.recipient_user_id=actor;
  -- Unique manual alert per Activity and unique recipient per alert enforce one
  -- row per original issue. Resolution-only recipients never enter this projection.
end;
$fn$;

create function public.dashboard_problem_condition_rows_v2(p_recipient_id uuid)
returns table(item jsonb) language plpgsql stable security definer set search_path='' as $fn$
declare actor uuid:=public.require_dashboard_notification_actor();
begin
  if p_recipient_id is distinct from actor then raise exception 'Access denied' using errcode='42501'; end if;
  if public.current_user_is_admin() or public.has_permission('projects.view') then
    return query select jsonb_build_object(
      'condition_kind',s.condition_kind,'condition_id',s.condition_id,'condition_status',s.condition_status,'target_type','project',
      'project_id',s.project_id,'project_name',s.project_name,'product_id',s.product_id,
      'product_name',s.product_name,'product_serial_number',s.product_serial_number,
      'shortage_quantity',s.current_shortage_quantity,'opened_at',s.opened_at,'resolved_at',s.resolved_at,
      'notification_id',s.notification_id,'delivery_created_at',s.delivery_created_at,
      'read_at',s.read_at,'dismissed_at',s.dismissed_at,'navigation_allowed',true)
      from public.project_shortage_condition_rows(actor) s;
    return query select i.item from public.project_issue_condition_rows(actor) i;
  end if;
  if public.current_user_is_admin() or public.has_permission('work_orders.view') then
    return query select t.item || jsonb_build_object(
      'condition_kind','work_order_shortage','condition_id',s.id,'condition_status',t.item->>'episode_status',
      'opened_at',s.opened_at,'resolved_at',s.resolved_at,
      'delivery_created_at',t.item->'created_at','navigation_allowed',true)
      from public.work_order_shortage_tracking_rows(actor) t
      join public.work_order_material_shortage_episodes s on s.id=(t.item->>'episode_id')::uuid;
  end if;
  -- Resolved WO dismissals retain migration 166's inbox semantics. Full retained
  -- Alerts History and new condition-dismissal operations are a separate task.
end;
$fn$;

create function public.dashboard_informational_update_rows_v2(p_recipient_id uuid)
returns table(item jsonb) language plpgsql stable security definer set search_path='' as $fn$
declare actor uuid:=public.require_dashboard_notification_actor();
begin
  if p_recipient_id is distinct from actor then raise exception 'Access denied' using errcode='42501'; end if;
  if not(public.current_user_is_admin() or public.has_permission('projects.view')) then return; end if;
  return query select jsonb_build_object(
    'condition_kind','informational_update','condition_id',a.id,'target_type','project',
    'project_id',a.project_id,'project_name',p.name,'activity_id',a.id,
    'title',a.title,'description',a.description,'author_user_id',a.author_user_id,
    'created_at',a.created_at,'notification_id',r.id,'delivery_created_at',r.created_at,
    'read_at',r.read_at,'navigation_allowed',true)
    from public.project_activity_alert_recipients r
    join public.project_activity_alerts n on n.id=r.alert_id and n.notification_kind='activity'
    join public.project_activity_updates a on a.id=n.project_activity_id and a.activity_kind='general'
    join public.projects p on p.id=a.project_id
    where r.recipient_user_id=actor and r.dismissed_at is null;
end;
$fn$;

create function public.get_dashboard_active_problem_counts_v2()
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor uuid:=public.require_dashboard_notification_actor(); counts jsonb; updates text;
begin
  select jsonb_build_object('active_problems',count(*)::text,
    'active_work_order_shortages',(count(*) filter(where c.item->>'condition_kind'='work_order_shortage'))::text,
    'active_project_shortages',(count(*) filter(where c.item->>'condition_kind'='project_shortage'))::text,
    'unresolved_project_issues',(count(*) filter(where c.item->>'condition_kind'='project_issue'))::text)
    into counts from public.dashboard_problem_condition_rows_v2(actor) c where c.item->>'condition_status'='active';
  select count(*)::text into updates from public.dashboard_informational_update_rows_v2(actor) u where u.item->>'read_at' is null;
  return counts || jsonb_build_object('unread_updates',updates,'as_of',statement_timestamp(),'contract_version',2);
end;
$fn$;

-- One pagination implementation for both new public reads. Immutable delivery
-- time plus category/identity gives a deterministic keyset across condition kinds.
-- Each page is a fresh DB observation, not a promise of a multi-request snapshot.
create function public.dashboard_alert_page_v2(p_updates boolean,p_limit integer,p_before_created_at timestamptz,
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

create function public.list_dashboard_problem_conditions_v2(p_limit integer default 20,
  p_before_created_at timestamptz default null,p_before_kind text default null,p_before_id uuid default null,p_status text default 'all')
returns jsonb language sql stable security definer set search_path='' as $fn$
  select public.dashboard_alert_page_v2(false,p_limit,p_before_created_at,p_before_kind,p_before_id,p_status);
$fn$;
create function public.list_dashboard_informational_updates_v2(p_limit integer default 20,
  p_before_created_at timestamptz default null,p_before_kind text default null,p_before_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $fn$
  select public.dashboard_alert_page_v2(true,p_limit,p_before_created_at,p_before_kind,p_before_id,'all');
$fn$;

revoke all on function public.project_issue_condition_rows(uuid),public.dashboard_problem_condition_rows_v2(uuid),
  public.dashboard_informational_update_rows_v2(uuid),public.dashboard_alert_page_v2(boolean,integer,timestamptz,text,uuid,text),
  public.get_dashboard_active_problem_counts_v2(),public.list_dashboard_problem_conditions_v2(integer,timestamptz,text,uuid,text),
  public.list_dashboard_informational_updates_v2(integer,timestamptz,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_dashboard_active_problem_counts_v2(),
  public.list_dashboard_problem_conditions_v2(integer,timestamptz,text,uuid,text),
  public.list_dashboard_informational_updates_v2(integer,timestamptz,text,uuid) to authenticated;
