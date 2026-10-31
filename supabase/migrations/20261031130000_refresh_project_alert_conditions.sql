-- 186: content-free condition invalidation on the existing private channel.
-- Queue only already-delivered recipients; never synthesize notification records.
create table public.project_alert_condition_refresh_queue (
  transaction_id bigint not null,
  recipient_user_id uuid not null references public.user_profiles(id),
  primary key(transaction_id,recipient_user_id)
);
alter table public.project_alert_condition_refresh_queue enable row level security;
revoke all on public.project_alert_condition_refresh_queue from public,anon,authenticated,service_role;

create function public.project_alert_refresh_recipient_eligible(p_recipient uuid)
returns boolean language sql stable security definer set search_path='' as $fn$
  select exists(select 1 from public.user_profiles p where p.id=p_recipient and p.is_active and (p.is_admin or (
    exists(select 1 from public.user_permissions u join public.permission_definitions d on d.id=u.permission_definition_id
      where u.user_id=p.id and d.key='dashboard.view' and d.is_delegable)
    and exists(select 1 from public.user_permissions u join public.permission_definitions d on d.id=u.permission_definition_id
      where u.user_id=p.id and d.key='projects.view' and d.is_delegable))));
$fn$;

create function public.queue_project_alert_condition_refresh(p_recipient uuid)
returns void language sql volatile security definer set search_path='' as $fn$
  insert into public.project_alert_condition_refresh_queue(transaction_id,recipient_user_id)
    select txid_current(),p_recipient where public.project_alert_refresh_recipient_eligible(p_recipient)
      and exists(select 1 from public.project_activity_alert_recipients r where r.recipient_user_id=p_recipient)
    on conflict do nothing;
$fn$;

create function public.dispatch_project_alert_condition_refresh()
returns trigger language plpgsql volatile security definer set search_path='' as $fn$
begin
  delete from public.project_alert_condition_refresh_queue q
    where q.transaction_id=new.transaction_id and q.recipient_user_id=new.recipient_user_id;
  if found and public.project_alert_refresh_recipient_eligible(new.recipient_user_id) then
    perform realtime.send(payload:='{}'::jsonb,event:='invalidate',
      topic:='project-alert-notifications:'||new.recipient_user_id::text,private:=true);
  end if;
  return new;
end;
$fn$;
create constraint trigger project_alert_condition_refresh_dispatch
  after insert on public.project_alert_condition_refresh_queue deferrable initially deferred
  for each row execute function public.dispatch_project_alert_condition_refresh();

-- Keep the existing delivery/read/dismiss signal contract. Coalesce a pending
-- batch by transaction/recipient with condition changes, including issue opening
-- and resolution deliveries. A caller forcing deferred constraints may flush a
-- batch early; a subsequent genuine change may enqueue another refresh.
create or replace function public.broadcast_project_alert_notification_invalidation()
returns trigger language plpgsql volatile security definer set search_path='' as $fn$
begin
  if tg_op='INSERT' or (tg_op='UPDATE' and (
    (old.read_at is null and new.read_at is not null) or
    (old.dismissed_at is null and new.dismissed_at is not null))) then
    perform public.queue_project_alert_condition_refresh(new.recipient_user_id);
  end if;
  return new;
end;
$fn$;

create function public.queue_project_condition_change_refresh()
returns trigger language plpgsql volatile security definer set search_path='' as $fn$
declare recipient uuid;
begin
  if tg_table_name='project_shortage_episodes' then
    for recipient in select distinct r.recipient_user_id
      from public.project_shortage_events e
      join public.project_activity_alerts n on n.project_shortage_event_id=e.id and n.notification_kind='shortage'
      join public.project_activity_alert_recipients r on r.alert_id=n.id
      where e.episode_id=new.id order by r.recipient_user_id
    loop perform public.queue_project_alert_condition_refresh(recipient); end loop;
  elsif tg_table_name='project_issue_resolutions' then
    for recipient in select distinct r.recipient_user_id
      from public.project_activity_alerts n
      join public.project_activity_updates a on a.id=n.project_activity_id and a.activity_kind='issue'
      join public.project_activity_alert_recipients r on r.alert_id=n.id
      where n.notification_kind='activity' and a.id=new.project_activity_id order by r.recipient_user_id
    loop perform public.queue_project_alert_condition_refresh(recipient); end loop;
  elsif tg_table_name='project_condition_acknowledgments' then
    -- The trusted acknowledgment writer already validates source/owner/state.
    -- Recheck an actual owned delivery; do not signal an inferred/new audience.
    if exists(select 1 from public.project_activity_alert_recipients r
      join public.project_activity_alerts n on n.id=r.alert_id
      left join public.project_shortage_events e on e.id=n.project_shortage_event_id
      where r.recipient_user_id=new.recipient_user_id and (
        (new.condition_kind='project_shortage' and n.notification_kind='shortage' and e.episode_id=new.condition_id)
        or (new.condition_kind='project_issue' and n.notification_kind in ('activity','issue_resolved') and n.project_activity_id=new.condition_id))) then
      perform public.queue_project_alert_condition_refresh(new.recipient_user_id);
    end if;
  end if;
  return new;
end;
$fn$;

create trigger project_shortage_condition_change_refresh
  after update of current_shortage_quantity,resolved_at on public.project_shortage_episodes
  for each row when (old.current_shortage_quantity is distinct from new.current_shortage_quantity or old.resolved_at is distinct from new.resolved_at)
  execute function public.queue_project_condition_change_refresh();
create trigger project_issue_resolution_condition_refresh after insert on public.project_issue_resolutions
  for each row execute function public.queue_project_condition_change_refresh();
create trigger project_condition_acknowledgment_refresh after insert on public.project_condition_acknowledgments
  for each row execute function public.queue_project_condition_change_refresh();

revoke all on function public.project_alert_refresh_recipient_eligible(uuid),public.queue_project_alert_condition_refresh(uuid),
  public.dispatch_project_alert_condition_refresh(),public.queue_project_condition_change_refresh(),
  public.broadcast_project_alert_notification_invalidation() from public,anon,authenticated,service_role;
-- No new channel/policy/public RPC, frontend wiring, activation or historical scan.
