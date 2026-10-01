create function public.can_view_audit_target(p_entity_type text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if public.current_user_is_admin() then
    return true;
  end if;

  return case p_entity_type
    when 'project' then public.has_permission('projects.view')
    when 'project_product' then public.has_permission('projects.view')
    when 'project_product_component' then public.has_permission('projects.view')
    when 'procurement_request' then public.has_permission('procurement.view')
    when 'supplier' then public.has_permission('suppliers.view')
    when 'brand' then public.has_permission('inventory.view')
    when 'product' then public.has_permission('inventory.view')
    when 'product_supplier' then (
      public.has_permission('inventory.view')
      or public.has_permission('suppliers.view')
    )
    when 'product_inventory' then public.has_permission('inventory.view')
    when 'pcb_card' then public.has_permission('pcb.view')
    when 'pcb_bom_version' then public.has_permission('pcb.view')
    when 'pcb_production_run' then public.has_permission('pcb.view')
    when 'work_order' then public.has_permission('work_orders.view')
    when 'calendar_entry' then public.current_active_user_profile_id() is not null
    else false
  end;
end;
$function$;

revoke all privileges
  on function public.can_view_audit_target(text)
  from public, anon, authenticated;

create function public.get_audit_log_detail(p_audit_log_id uuid)
returns table (
  audit_log_id uuid,
  actor_user_id uuid,
  actor_full_name text,
  action_type text,
  entity_type text,
  entity_id uuid,
  summary text,
  created_at timestamptz,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb,
  detail_authorized boolean,
  target_view_authorized boolean,
  context_kind text,
  context_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  audit_record record;
  can_view_detail boolean;
  safe_context_kind text := null;
  safe_context_id uuid := null;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('archive.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_audit_log_id is null then
    raise exception 'Audit Log ID is required'
      using errcode = '22023';
  end if;

  select
    audit.id,
    audit.actor_user_id,
    actor.full_name as actor_full_name,
    audit.action_type,
    audit.entity_type,
    audit.entity_id,
    audit.summary,
    audit.created_at,
    audit.before_data,
    audit.after_data,
    audit.metadata
  into audit_record
  from public.audit_logs as audit
  join public.user_profiles as actor
    on actor.id = audit.actor_user_id
  where audit.id = p_audit_log_id;

  if not found then
    raise exception 'Audit Log record not found'
      using errcode = 'P0002';
  end if;

  can_view_detail := public.can_view_audit_target(audit_record.entity_type);

  if can_view_detail and audit_record.entity_id is not null then
    case audit_record.entity_type
      when 'project' then
        if exists (
          select 1 from public.projects as target
          where target.id = audit_record.entity_id
        ) then
          safe_context_kind := 'project';
          safe_context_id := audit_record.entity_id;
        end if;
      when 'supplier' then
        if exists (
          select 1 from public.suppliers as target
          where target.id = audit_record.entity_id
        ) then
          safe_context_kind := 'supplier';
          safe_context_id := audit_record.entity_id;
        end if;
      when 'product' then
        if exists (
          select 1 from public.products as target
          where target.id = audit_record.entity_id
        ) then
          safe_context_kind := 'product';
          safe_context_id := audit_record.entity_id;
        end if;
      when 'product_inventory' then
        if exists (
          select 1 from public.products as target
          where target.id = audit_record.entity_id
        ) then
          safe_context_kind := 'product';
          safe_context_id := audit_record.entity_id;
        end if;
      when 'pcb_card' then
        if exists (
          select 1 from public.pcb_cards as target
          where target.id = audit_record.entity_id
        ) then
          safe_context_kind := 'pcb_card';
          safe_context_id := audit_record.entity_id;
        end if;
      when 'work_order' then
        if exists (
          select 1 from public.work_orders as target
          where target.id = audit_record.entity_id
        ) then
          safe_context_kind := 'work_order';
          safe_context_id := audit_record.entity_id;
        end if;
      when 'user_profile' then
        if exists (
          select 1 from public.user_profiles as target
          where target.id = audit_record.entity_id
        ) then
          safe_context_kind := 'user_profile';
          safe_context_id := audit_record.entity_id;
        end if;
      else
        null;
    end case;
  end if;

  return query
  select
    audit_record.id::uuid,
    audit_record.actor_user_id::uuid,
    audit_record.actor_full_name::text,
    audit_record.action_type::text,
    audit_record.entity_type::text,
    audit_record.entity_id::uuid,
    audit_record.summary::text,
    audit_record.created_at::timestamptz,
    case when can_view_detail then audit_record.before_data::jsonb else null end,
    case when can_view_detail then audit_record.after_data::jsonb else null end,
    case when can_view_detail then audit_record.metadata::jsonb else null end,
    can_view_detail,
    safe_context_kind is not null,
    safe_context_kind,
    safe_context_id;
end;
$function$;

revoke all privileges
  on function public.get_audit_log_detail(uuid)
  from public, anon, authenticated;

grant execute
  on function public.get_audit_log_detail(uuid)
  to authenticated;
