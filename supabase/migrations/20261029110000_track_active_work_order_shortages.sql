-- WO-08: retain immutable messages; project one recipient-owned item per episode.
create table public.work_order_shortage_resolved_dismissals (
  episode_id uuid not null references public.work_order_material_shortage_episodes(id),
  recipient_user_id uuid not null references public.user_profiles(id),
  dismissed_at timestamptz not null default clock_timestamp(),
  primary key(episode_id,recipient_user_id)
);
alter table public.work_order_shortage_resolved_dismissals enable row level security;
revoke all on public.work_order_shortage_resolved_dismissals from public,anon,authenticated,service_role;

create function public.work_order_shortage_tracking_rows(p_actor uuid)
returns table(item jsonb) language sql stable security invoker set search_path='' as $fn$
  with owned as (
    select distinct on (o.episode_id) r.*,o.episode_id,o.event_id
    from public.work_order_shortage_notification_recipients r
    join public.work_order_material_shortage_notification_outbox o on o.id=r.outbox_id
    where r.recipient_user_id=p_actor
    order by o.episode_id,(o.event_type='opened') desc,r.created_at,r.id
  )
  select jsonb_build_object('target_type','work_order','notification_kind','work_order_shortage',
    'notification_id',r.id,'event_id',r.event_id,'episode_id',s.id,
    'work_order_id',s.work_order_id,'work_order_number',s.work_order_number,
    'product_id',s.product_id,'product_name',s.product_name_snapshot,
    'shortage_event_type',case when s.resolved_at is null then 'opened' else 'resolved' end,
    'shortage_quantity',s.missing_quantity::text,'created_at',r.created_at,
    'read_at',coalesce(r.read_at,s.resolved_at),'episode_status',case when s.resolved_at is null then 'active' else 'resolved' end)
  from owned r join public.work_order_material_shortage_episodes s on s.id=r.episode_id
  where s.resolved_at is null or (
    not exists(select 1 from public.work_order_shortage_resolved_dismissals d where d.episode_id=s.id and d.recipient_user_id=p_actor)
    and not exists(select 1 from public.work_order_shortage_notification_recipients old
      join public.work_order_material_shortage_notification_outbox o on o.id=old.outbox_id
      where o.episode_id=s.id and old.recipient_user_id=p_actor and old.dismissed_at>=s.resolved_at)
  );
$fn$;
revoke all on function public.work_order_shortage_tracking_rows(uuid) from public,anon,authenticated,service_role;

create function public.list_dashboard_shortage_tracking(p_limit integer default 20,
  p_before_created_at timestamptz default null,p_before_recipient_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor uuid:=public.require_dashboard_notification_actor(); projects jsonb:='[]'; result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 20 or
    ((p_before_created_at is null)<>(p_before_recipient_id is null)) then raise exception 'Invalid page' using errcode='22023'; end if;
  if public.current_user_is_admin() or public.has_permission('projects.view') then
    select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('target_type','project')),'[]') into projects
      from public.list_project_notifications(p_limit+1,p_before_created_at,p_before_recipient_id) p;
  end if;
  with candidates as (
    select value item from jsonb_array_elements(projects)
    union all
    select t.item from public.work_order_shortage_tracking_rows(actor) t
      where public.current_user_is_admin() or public.has_permission('work_orders.view')
  ), bounded as (
    select item from candidates where p_before_created_at is null or
      ((item->>'created_at')::timestamptz,(item->>'notification_id')::uuid)<(p_before_created_at,p_before_recipient_id)
    order by (item->>'created_at')::timestamptz desc,(item->>'notification_id')::uuid desc limit p_limit+1
  ), page as (
    select item from bounded order by (item->>'created_at')::timestamptz desc,(item->>'notification_id')::uuid desc limit p_limit
  ) select coalesce(jsonb_agg(item||jsonb_build_object('has_more',(select count(*)>p_limit from bounded))
    order by (item->>'created_at')::timestamptz desc,(item->>'notification_id')::uuid desc),'[]') into result from page;
  return result;
end;
$fn$;
create function public.get_dashboard_alert_counts()
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor uuid:=public.require_dashboard_notification_actor(); active_count bigint:=0; project_count text:='0';
begin
  if public.current_user_is_admin() or public.has_permission('work_orders.view') then
    select count(*) into active_count from public.work_order_shortage_tracking_rows(actor) t where t.item->>'episode_status'='active';
  end if;
  if public.current_user_is_admin() or public.has_permission('projects.view') then project_count:=public.get_project_alert_unread_count()::text; end if;
  return jsonb_build_object('active_work_order_shortages',active_count::text,'unread_project_notifications',project_count,'as_of',statement_timestamp());
end;
$fn$;
revoke all on function public.list_dashboard_shortage_tracking(integer,timestamptz,uuid),public.get_dashboard_alert_counts() from public,anon,authenticated,service_role;
grant execute on function public.list_dashboard_shortage_tracking(integer,timestamptz,uuid),public.get_dashboard_alert_counts() to authenticated;

create or replace function public.update_dashboard_notification(p_notification_id uuid,p_dismiss boolean)
returns timestamptz language plpgsql volatile security definer set search_path='' as $fn$
declare actor uuid:=public.require_dashboard_notification_actor(); episode uuid; resolved timestamptz; stamp timestamptz;
begin
  if p_notification_id is null or p_dismiss is null then raise exception 'Invalid notification' using errcode='22023'; end if;
  select o.episode_id into episode from public.work_order_shortage_notification_recipients r
    join public.work_order_material_shortage_notification_outbox o on o.id=r.outbox_id where r.id=p_notification_id and r.recipient_user_id=actor;
  if episode is null then
    if p_dismiss then select r.dismissed_at into stamp from public.dismiss_project_alert_notification(p_notification_id) r;
    else select r.read_at into stamp from public.mark_project_alert_read(p_notification_id) r; end if;
    return stamp;
  end if;
  -- Same episode-first order as reconciliation; no recipient/episode lock inversion.
  select s.resolved_at into resolved from public.work_order_material_shortage_episodes s where s.id=episode for update;
  perform 1 from public.work_order_shortage_notification_recipients r where r.id=p_notification_id and r.recipient_user_id=actor for update;
  if public.current_active_user_profile_id() is distinct from actor or not(public.current_user_is_admin() or
    (public.has_permission('dashboard.view') and public.has_permission('work_orders.view'))) then raise exception 'Access denied' using errcode='42501'; end if;
  if p_dismiss then
    if resolved is null then raise exception 'Active shortages cannot be dismissed' using errcode='55000'; end if;
    insert into public.work_order_shortage_resolved_dismissals(episode_id,recipient_user_id) values(episode,actor)
      on conflict do nothing;
    update public.work_order_shortage_notification_recipients r set dismissed_at=coalesce(r.dismissed_at,clock_timestamp())
      where r.id=p_notification_id and r.recipient_user_id=actor;
    select d.dismissed_at into stamp from public.work_order_shortage_resolved_dismissals d where d.episode_id=episode and d.recipient_user_id=actor;
  else
    update public.work_order_shortage_notification_recipients r set read_at=coalesce(r.read_at,resolved,clock_timestamp())
      where r.id=p_notification_id and r.recipient_user_id=actor returning r.read_at into stamp;
  end if;
  return stamp;
end;
$fn$;

-- Payload-free recipient-scoped invalidation, including silent quantity changes.
create function public.broadcast_work_order_shortage_tracking()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare recipient uuid;
begin
  if tg_table_name='work_order_material_shortage_episodes' then
    for recipient in select distinct r.recipient_user_id from public.work_order_shortage_notification_recipients r
      join public.work_order_material_shortage_notification_outbox o on o.id=r.outbox_id where o.episode_id=new.id loop
      perform realtime.send('{}'::jsonb,'invalidate','work-order-shortages:'||recipient::text,true);
    end loop;
  else perform realtime.send('{}'::jsonb,'invalidate','work-order-shortages:'||new.recipient_user_id::text,true); end if;
  return new;
end;
$fn$;
revoke all on function public.broadcast_work_order_shortage_tracking() from public,anon,authenticated,service_role;
create trigger work_order_shortage_tracking_episode after update on public.work_order_material_shortage_episodes
  for each row execute function public.broadcast_work_order_shortage_tracking();
create trigger work_order_shortage_tracking_recipient after insert or update on public.work_order_shortage_notification_recipients
  for each row execute function public.broadcast_work_order_shortage_tracking();
create trigger work_order_shortage_tracking_dismissal after insert on public.work_order_shortage_resolved_dismissals
  for each row execute function public.broadcast_work_order_shortage_tracking();
create policy work_order_shortage_tracking_select_own on realtime.messages for select to authenticated using (
  realtime.messages.extension='broadcast' and (select realtime.topic())='work-order-shortages:'||public.current_active_user_profile_id()::text
  and public.current_active_user_profile_id() is not null and (public.current_user_is_admin() or
    (public.has_permission('dashboard.view') and public.has_permission('work_orders.view')))
);
