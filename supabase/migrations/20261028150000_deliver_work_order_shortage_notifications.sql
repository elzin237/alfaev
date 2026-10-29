-- WO-04: recipient-owned delivery; existing Project contracts remain unchanged.
create table public.work_order_shortage_notification_deliveries (
  outbox_id uuid primary key references public.work_order_material_shortage_notification_outbox(id),
  processed_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table public.work_order_shortage_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.work_order_shortage_notification_deliveries(outbox_id),
  recipient_user_id uuid not null references public.user_profiles(id),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  read_at timestamptz,
  dismissed_at timestamptz,
  unique(outbox_id,recipient_user_id)
);
create index work_order_shortage_recipient_inbox on public.work_order_shortage_notification_recipients
  (recipient_user_id,created_at desc,id desc) where dismissed_at is null;
alter table public.work_order_shortage_notification_deliveries enable row level security;
alter table public.work_order_shortage_notification_recipients enable row level security;
revoke all on public.work_order_shortage_notification_deliveries,
  public.work_order_shortage_notification_recipients from public,anon,authenticated,service_role;

create function public.deliver_work_order_shortage_intent(p_outbox_id uuid)
returns void language plpgsql volatile security definer set search_path='' as $fn$
begin
  if not exists(select 1 from public.work_order_material_shortage_notification_outbox o where o.id=p_outbox_id) then
    raise exception 'Unknown shortage intent' using errcode='P0002';
  end if;
  insert into public.work_order_shortage_notification_deliveries(outbox_id) values(p_outbox_id)
    on conflict do nothing;
  if not found then return; end if;
  insert into public.work_order_shortage_notification_recipients(outbox_id,recipient_user_id)
  select p_outbox_id,p.id from public.user_profiles p where p.is_active and
    (p.is_admin or (
      exists(select 1 from public.user_permissions up join public.permission_definitions d on d.id=up.permission_definition_id
        where up.user_id=p.id and d.key='dashboard.view' and d.is_delegable)
      and exists(select 1 from public.user_permissions up join public.permission_definitions d on d.id=up.permission_definition_id
        where up.user_id=p.id and d.key='work_orders.view' and d.is_delegable)))
  order by p.id on conflict do nothing;
end;
$fn$;
create function public.deliver_new_work_order_shortage_intent()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin perform public.deliver_work_order_shortage_intent(new.id); return new; end;
$fn$;
create trigger work_order_shortage_deliver_intent after insert
  on public.work_order_material_shortage_notification_outbox for each row
  execute function public.deliver_new_work_order_shortage_intent();

create function public.require_dashboard_notification_actor()
returns uuid language plpgsql stable security definer set search_path='' as $fn$
declare actor uuid := public.current_active_user_profile_id();
begin
  if auth.uid() is null or actor is null or not(public.current_user_is_admin() or public.has_permission('dashboard.view')) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  return actor;
end;
$fn$;

create function public.list_dashboard_notifications(p_limit integer default 20,
  p_before_created_at timestamptz default null,p_before_recipient_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor uuid := public.require_dashboard_notification_actor(); projects jsonb := '[]'; result jsonb;
begin
  if p_limit is null or p_limit<1 or p_limit>20 or
    ((p_before_created_at is null) <> (p_before_recipient_id is null)) then
    raise exception 'Invalid notification page' using errcode='22023';
  end if;
  if public.current_user_is_admin() or public.has_permission('projects.view') then
    select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('target_type','project')),'[]') into projects
      from public.list_project_notifications(p_limit+1,p_before_created_at,p_before_recipient_id) p;
  end if;
  with candidates as (
    select value row from jsonb_array_elements(projects)
    union all
    select jsonb_build_object('target_type','work_order','notification_id',r.id,'event_id',e.id,
      'notification_kind','work_order_shortage','work_order_id',s.work_order_id,'work_order_number',s.work_order_number,
      'product_id',s.product_id,'product_name',s.product_name_snapshot,'shortage_event_type',e.event_type,
      'shortage_quantity',e.missing_quantity::text,'created_at',r.created_at,'read_at',r.read_at)
    from public.work_order_shortage_notification_recipients r
    join public.work_order_material_shortage_notification_outbox o on o.id=r.outbox_id
    join public.work_order_material_shortage_events e on e.id=o.event_id
    join public.work_order_material_shortage_episodes s on s.id=e.episode_id
    where r.recipient_user_id=actor and r.dismissed_at is null
      and (public.current_user_is_admin() or public.has_permission('work_orders.view'))
      and (p_before_created_at is null or (r.created_at,r.id)<(p_before_created_at,p_before_recipient_id))
  ), bounded as (
    select row from candidates order by (row->>'created_at')::timestamptz desc,(row->>'notification_id')::uuid desc limit p_limit+1
  ), page as (
    select row from bounded order by (row->>'created_at')::timestamptz desc,(row->>'notification_id')::uuid desc limit p_limit
  ) select coalesce(jsonb_agg(row||jsonb_build_object('has_more',(select count(*)>p_limit from bounded))
    order by (row->>'created_at')::timestamptz desc,(row->>'notification_id')::uuid desc),'[]') into result from page;
  return result;
end;
$fn$;

create function public.get_dashboard_notification_unread_count()
returns text language plpgsql stable security definer set search_path='' as $fn$
declare actor uuid := public.require_dashboard_notification_actor(); total numeric := 0;
begin
  if public.current_user_is_admin() or public.has_permission('projects.view') then
    total := public.get_project_alert_unread_count();
  end if;
  if public.current_user_is_admin() or public.has_permission('work_orders.view') then
    select total+count(*) into total from public.work_order_shortage_notification_recipients r
      where r.recipient_user_id=actor and r.read_at is null and r.dismissed_at is null;
  end if;
  return total::text;
end;
$fn$;

create function public.update_dashboard_notification(p_notification_id uuid,p_dismiss boolean)
returns timestamptz language plpgsql volatile security definer set search_path='' as $fn$
declare actor uuid := public.require_dashboard_notification_actor(); owned public.work_order_shortage_notification_recipients%rowtype; stamp timestamptz;
begin
  if p_notification_id is null or p_dismiss is null then raise exception 'Invalid notification' using errcode='22023'; end if;
  select * into owned from public.work_order_shortage_notification_recipients r
    where r.id=p_notification_id and r.recipient_user_id=actor for update;
  if not found then
    if p_dismiss then select r.dismissed_at into stamp from public.dismiss_project_alert_notification(p_notification_id) r;
    else select r.read_at into stamp from public.mark_project_alert_read(p_notification_id) r; end if;
    return stamp;
  end if;
  if public.current_active_user_profile_id() is distinct from actor or
    not(public.current_user_is_admin() or (public.has_permission('dashboard.view') and public.has_permission('work_orders.view'))) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  if p_dismiss then
    update public.work_order_shortage_notification_recipients r set dismissed_at=coalesce(r.dismissed_at,pg_catalog.clock_timestamp())
      where r.id=owned.id returning r.dismissed_at into stamp;
  else
    update public.work_order_shortage_notification_recipients r set read_at=coalesce(r.read_at,pg_catalog.clock_timestamp())
      where r.id=owned.id and r.dismissed_at is null returning r.read_at into stamp;
    if not found then raise exception 'Notification unavailable' using errcode='P0002'; end if;
  end if;
  return stamp;
end;
$fn$;
create function public.mark_dashboard_notification_read(p_notification_id uuid)
returns table(notification_id uuid,read_at timestamptz) language sql volatile security definer set search_path='' as $fn$
  select p_notification_id,public.update_dashboard_notification(p_notification_id,false);
$fn$;
create function public.dismiss_dashboard_notification(p_notification_id uuid)
returns table(notification_id uuid,dismissed_at timestamptz) language sql volatile security definer set search_path='' as $fn$
  select p_notification_id,public.update_dashboard_notification(p_notification_id,true);
$fn$;
revoke all on function public.deliver_work_order_shortage_intent(uuid),public.deliver_new_work_order_shortage_intent(),
  public.require_dashboard_notification_actor(),public.update_dashboard_notification(uuid,boolean),
  public.list_dashboard_notifications(integer,timestamptz,uuid),public.get_dashboard_notification_unread_count(),
  public.mark_dashboard_notification_read(uuid),public.dismiss_dashboard_notification(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.list_dashboard_notifications(integer,timestamptz,uuid),
  public.get_dashboard_notification_unread_count(),public.mark_dashboard_notification_read(uuid),public.dismiss_dashboard_notification(uuid)
  to authenticated;
-- Deliberately no historical outbox backfill or deployment-time delivery.
