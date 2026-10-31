-- 183: inert Active Alerts foundation. No callers, public RPC changes or backfill.
-- Preserve event/delivery history; project one condition per owned episode.
create function public.project_shortage_condition_rows(p_recipient_id uuid)
returns table (
  condition_kind text,
  condition_id uuid,
  condition_status text,
  project_id uuid,
  project_name text,
  product_id uuid,
  product_name text,
  product_serial_number text,
  current_shortage_quantity text,
  opened_at timestamptz,
  resolved_at timestamptz,
  notification_id uuid,
  event_id uuid,
  delivery_created_at timestamptz,
  read_at timestamptz,
  dismissed_at timestamptz,
  has_opening_delivery boolean,
  has_resolution_delivery boolean,
  as_of timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor uuid := public.current_active_user_profile_id();
begin
  -- Private EXECUTE alone is not authority. Future trusted wrappers must retain
  -- the authenticated identity; even an Admin cannot select another recipient.
  if auth.uid() is null or actor is null or p_recipient_id is distinct from actor
    or not (public.current_user_is_admin() or public.has_permission('dashboard.view'))
    or not (public.current_user_is_admin() or public.has_permission('projects.view'))
  then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  return query
  with owned_deliveries as (
    select episode.id as episode_id, recipient.id as notification_id,
      shortage_event.id as event_id, shortage_event.event_type,
      recipient.created_at, recipient.read_at, recipient.dismissed_at
    from public.project_activity_alert_recipients as recipient
    join public.project_activity_alerts as notification
      on notification.id = recipient.alert_id
      and notification.notification_kind = 'shortage'
    join public.project_shortage_events as shortage_event
      on shortage_event.id = notification.project_shortage_event_id
      and shortage_event.project_id = notification.project_id
      and shortage_event.product_id = notification.product_id
      and shortage_event.event_type = notification.shortage_event_type
      and shortage_event.shortage_quantity = notification.shortage_quantity
    join public.project_shortage_episodes as episode
      on episode.id = shortage_event.episode_id
      and episode.project_id = shortage_event.project_id
      and episode.product_id = shortage_event.product_id
    where recipient.recipient_user_id = actor
      and shortage_event.event_type in ('opened', 'resolved')
  ), canonical as (
    select distinct on (owned.episode_id) owned.*
    from owned_deliveries as owned
    order by owned.episode_id, (owned.event_type = 'opened') desc,
      owned.created_at, owned.notification_id
  ), delivery_presence as (
    select owned.episode_id,
      bool_or(owned.event_type = 'opened') as has_opening_delivery,
      bool_or(owned.event_type = 'resolved') as has_resolution_delivery
    from owned_deliveries as owned
    group by owned.episode_id
  )
  select 'project_shortage'::text, episode.id,
    case when episode.resolved_at is null then 'active'::text else 'resolved'::text end,
    episode.project_id, project.name, episode.product_id, product.name,
    product.serial_number, episode.current_shortage_quantity::text,
    episode.opened_at, episode.resolved_at, canonical.notification_id,
    canonical.event_id, canonical.created_at, canonical.read_at,
    canonical.dismissed_at, presence.has_opening_delivery,
    presence.has_resolution_delivery, statement_timestamp()
  from canonical
  join delivery_presence as presence on presence.episode_id = canonical.episode_id
  join public.project_shortage_episodes as episode on episode.id = canonical.episode_id
  join public.projects as project on project.id = episode.project_id
  join public.products as product on product.id = episode.product_id
  order by canonical.created_at desc, canonical.notification_id desc;
end;
$function$;

-- No browser/service-role endpoint. A later separately reviewed versioned read
-- may delegate here; all current count/inbox/read/dismiss contracts stay intact.
revoke all privileges on function public.project_shortage_condition_rows(uuid)
  from public, anon, authenticated, service_role;
