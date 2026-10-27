-- Task 001L. Requirement intent and hard reservations commit together. No backfill,
-- stock mutation, production trigger or alteration of historical migrations.
create table public.project_requirement_mutation_receipts (
  request_id uuid primary key,
  actor_user_id uuid not null references public.user_profiles(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  fg_affecting boolean not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.project_requirement_mutation_receipts enable row level security;
revoke all on public.project_requirement_mutation_receipts from public, anon, authenticated, service_role;

create function public.guard_project_requirement_receipts()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if tg_table_name = 'project_requirement_mutation_receipts' then
    raise exception 'Requirement receipts are immutable' using errcode = '55000';
  end if;
  -- The existing manual RPCs share the request lock namespace. A requirement
  -- request UUID must never become a second, manual reservation operation.
  if exists (select 1 from public.project_requirement_mutation_receipts r where r.request_id = new.request_id) then
    if exists (select 1 from public.project_requirement_mutation_receipts r where r.request_id=new.request_id
      and r.actor_user_id is distinct from public.current_active_user_profile_id()) then
      raise exception 'Access denied' using errcode='42501'; end if;
    raise exception 'Request UUID already belongs to a requirement operation' using errcode = 'FGR01';
  end if;
  return new;
end;
$function$;
create trigger project_requirement_receipts_immutable before update or delete
on public.project_requirement_mutation_receipts for each row execute function public.guard_project_requirement_receipts();
create trigger reservation_events_guard_requirement_request before insert
on public.finished_goods_project_reservation_events for each row execute function public.guard_project_requirement_receipts();
revoke all on function public.guard_project_requirement_receipts() from public, anon, authenticated, service_role;

create function public.is_calculator_finished_product(p_product_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $function$
  select exists (select 1 from public.products p where p.id = p_product_id and p.product_kind = 'pcb_finished_good'
    and exists (select 1 from public.pcb_cards c where c.output_product_id = p.id));
$function$;
revoke all on function public.is_calculator_finished_product(uuid) from public, anon, authenticated, service_role;

-- Preserve the reviewed planning implementation privately. Old clients remain
-- supported for ordinary materials, but cannot bypass atomic FG handling.
alter function public.create_project_product_component(uuid,uuid,bigint) rename to create_project_requirement_private;
alter function public.update_project_product_component(uuid,uuid,bigint) rename to update_project_requirement_private;
alter function public.remove_project_product_component(uuid) rename to remove_project_requirement_private;
revoke all on function public.create_project_requirement_private(uuid,uuid,bigint),
  public.update_project_requirement_private(uuid,uuid,bigint), public.remove_project_requirement_private(uuid)
  from public, anon, authenticated, service_role;

create function public.create_project_product_component(p_project_product_id uuid,p_product_id uuid,p_required_quantity bigint)
returns uuid language plpgsql volatile security definer set search_path = '' as $function$
begin
  if public.current_project_planning_mutation_actor_id() is null then raise exception 'Access denied' using errcode='42501'; end if;
  perform public.lock_open_project_for_planning((select g.project_id from public.project_products g where g.id=p_project_product_id));
  -- Lock classification against concurrent Product changes before dispatch.
  perform p.id from public.products p where p.id=p_product_id for share;
  if public.is_calculator_finished_product(p_product_id) then
    raise exception 'Use the request-aware requirement operation' using errcode='FGA01'; end if;
  return public.create_project_requirement_private(p_project_product_id,p_product_id,p_required_quantity);
end;
$function$;
create function public.update_project_product_component(p_component_id uuid,p_product_id uuid,p_required_quantity bigint)
returns uuid language plpgsql volatile security definer set search_path = '' as $function$
declare project_key uuid; old_product uuid;
begin
  if public.current_project_planning_mutation_actor_id() is null then raise exception 'Access denied' using errcode='42501'; end if;
  select g.project_id into project_key from public.project_product_components c join public.project_products g on g.id=c.project_product_id where c.id=p_component_id;
  if project_key is null then raise exception 'Requirement not found' using errcode='P0002'; end if;
  perform public.lock_open_project_for_planning(project_key);
  select c.product_id into old_product from public.project_product_components c where c.id=p_component_id for update;
  perform p.id from public.products p where p.id in (old_product,p_product_id) order by p.id for share;
  if public.is_calculator_finished_product(old_product) or public.is_calculator_finished_product(p_product_id) then
    raise exception 'Use the request-aware requirement operation' using errcode='FGA01'; end if;
  return public.update_project_requirement_private(p_component_id,p_product_id,p_required_quantity);
end;
$function$;
create function public.remove_project_product_component(p_component_id uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $function$
declare project_key uuid; old_product uuid;
begin
  if public.current_project_planning_mutation_actor_id() is null then raise exception 'Access denied' using errcode='42501'; end if;
  select g.project_id into project_key from public.project_product_components c join public.project_products g on g.id=c.project_product_id where c.id=p_component_id;
  if project_key is null then raise exception 'Requirement not found' using errcode='P0002'; end if;
  perform public.lock_open_project_for_planning(project_key);
  select c.product_id into old_product from public.project_product_components c where c.id=p_component_id for update;
  perform p.id from public.products p where p.id=old_product for share;
  if public.is_calculator_finished_product(old_product) then
    raise exception 'Use the request-aware requirement operation' using errcode='FGA01'; end if;
  return public.remove_project_requirement_private(p_component_id);
end;
$function$;
revoke all on function public.create_project_product_component(uuid,uuid,bigint),
  public.update_project_product_component(uuid,uuid,bigint), public.remove_project_product_component(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_project_product_component(uuid,uuid,bigint),
  public.update_project_product_component(uuid,uuid,bigint), public.remove_project_product_component(uuid) to authenticated;

-- Only called after Project -> affected Products -> FG balances -> states locks.
-- No nested request locks: the parent requirement receipt owns idempotency.
create function public.set_requirement_finished_goods_reservation(
  p_project_id uuid,p_product_id uuid,p_target bigint,p_actor uuid,p_request uuid
)
returns void language plpgsql volatile security invoker set search_path = '' as $function$
declare s public.finished_goods_project_reservations%rowtype; previous bigint; stamp timestamptz; kind text;
begin
  select r.* into s from public.finished_goods_project_reservations r where r.project_id=p_project_id and r.product_id=p_product_id for update;
  previous:=coalesce(s.reserved_quantity,0);
  if p_target=previous then return; end if;
  if p_target<0 then raise exception 'Invalid reservation target' using errcode='22023'; end if;
  kind:=case when p_target>previous then 'reserved' else 'released' end;
  stamp:=clock_timestamp();
  if s.id is null then
    insert into public.finished_goods_project_reservations(project_id,product_id,reserved_quantity,version,created_at,created_by_user_id,updated_at,updated_by_user_id)
    values(p_project_id,p_product_id,p_target,1,stamp,p_actor,stamp,p_actor) returning * into s;
  else
    update public.finished_goods_project_reservations r set reserved_quantity=p_target,version=r.version+1,updated_at=stamp,updated_by_user_id=p_actor
      where r.id=s.id returning * into s;
  end if;
  insert into public.finished_goods_project_reservation_events(reservation_id,project_id,product_id,event_type,quantity_before,quantity_after,
    reservation_version,request_id,actor_user_id,requested_quantity,expected_version,created_at)
  values(s.id,p_project_id,p_product_id,kind,previous,p_target,s.version,gen_random_uuid(),p_actor,abs(p_target-previous),s.version-1,stamp);
  perform public.append_audit_log(p_action_type=>'finished_goods_reservation.'||kind,p_entity_type=>'finished_goods_reservation',p_entity_id=>s.id,
    p_summary=>'Automatically '||kind||' Finished Goods with Project requirement',
    p_before_data=>jsonb_build_object('reserved_quantity',previous),
    p_after_data=>jsonb_build_object('project_id',p_project_id,'product_id',p_product_id,'reserved_quantity',p_target,
      'version',s.version,'requirement_request_id',p_request));
end;
$function$;
revoke all on function public.set_requirement_finished_goods_reservation(uuid,uuid,bigint,uuid,uuid) from public, anon, authenticated, service_role;

create function public.mutate_project_requirement(
  p_request_id uuid,p_operation text,p_project_id uuid,p_project_product_id uuid,
  p_component_id uuid,p_product_id uuid,p_required_quantity bigint,
  p_expected_product_id uuid,p_expected_quantity bigint
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  actor uuid; intent jsonb; receipt public.project_requirement_mutation_receipts%rowtype;
  current_row public.project_product_components%rowtype; key uuid; affected uuid[];
  fg_change boolean; fg_authorized boolean; old_quantity bigint; planned numeric; consumed numeric;
  demand numeric; reserved bigint; physical bigint; global_reserved numeric; extra numeric;
  component_key uuid; allocation boolean; result_value jsonb; context_rows jsonb:='[]'::jsonb;
begin
  actor:=public.current_project_planning_mutation_actor_id();
  if actor is null then raise exception 'Access denied' using errcode='42501'; end if;
  if p_request_id is null or p_project_id is null or p_project_product_id is null
    or p_operation is null or p_operation not in ('create','update','remove')
    or (p_operation='create' and (p_component_id is not null or p_expected_product_id is not null or p_expected_quantity is not null))
    or (p_operation<>'create' and (p_component_id is null or p_expected_product_id is null or p_expected_quantity is null or p_expected_quantity<=0))
    or (p_operation='remove' and (p_product_id is not null or p_required_quantity is not null))
    or (p_operation<>'remove' and (p_product_id is null or p_required_quantity is null or p_required_quantity<=0))
  then raise exception 'Valid requirement request is required' using errcode='22023'; end if;
  intent:=jsonb_build_object('operation',p_operation,'project_id',p_project_id,'group_id',p_project_product_id,
    'component_id',p_component_id,'product_id',p_product_id,'quantity',p_required_quantity,
    'expected_product_id',p_expected_product_id,'expected_quantity',p_expected_quantity);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  if public.current_project_planning_mutation_actor_id() is distinct from actor then raise exception 'Access denied' using errcode='42501'; end if;
  select r.* into receipt from public.project_requirement_mutation_receipts r where r.request_id=p_request_id;
  if found then
    if receipt.actor_user_id<>actor then raise exception 'Access denied' using errcode='42501'; end if;
    if receipt.fg_affecting and not (public.current_user_is_admin() or (public.has_permission('projects.view') and public.has_permission('projects.edit')
      and public.has_permission('inventory.finished_goods.view') and public.has_permission('inventory.finished_goods.reserve'))) then
      raise exception 'Access denied' using errcode='42501'; end if;
    if receipt.payload is distinct from intent then raise exception 'Request payload changed' using errcode='FGR01'; end if;
    return receipt.result;
  end if;
  if exists(select 1 from public.finished_goods_project_reservation_events e where e.request_id=p_request_id) then
    if exists(select 1 from public.finished_goods_project_reservation_events e where e.request_id=p_request_id and e.actor_user_id<>actor) then
      raise exception 'Access denied' using errcode='42501'; end if;
    raise exception 'Request UUID already used' using errcode='FGR01'; end if;
  perform public.lock_open_project_for_planning(p_project_id);
  perform g.id from public.project_products g where g.id=p_project_product_id and g.project_id=p_project_id for update;
  if not found then raise exception 'Project Product not found' using errcode='P0002'; end if;
  if p_operation<>'create' then
    select c.* into current_row from public.project_product_components c where c.id=p_component_id and c.project_product_id=p_project_product_id for update;
    if not found then raise exception 'Requirement not found' using errcode='P0002'; end if;
    if current_row.product_id<>p_expected_product_id or current_row.required_quantity<>p_expected_quantity then
      raise exception 'Requirement changed; refresh before editing' using errcode='FGA02'; end if;
  end if;
  affected:=array[current_row.product_id,p_product_id];
  perform p.id from public.products p where p.id=any(affected) order by p.id for share;
  fg_change:=public.is_calculator_finished_product(current_row.product_id) or public.is_calculator_finished_product(p_product_id);
  fg_authorized:=public.current_user_is_admin() or (public.has_permission('projects.view') and public.has_permission('projects.edit')
    and public.has_permission('inventory.finished_goods.view') and public.has_permission('inventory.finished_goods.reserve'));
  if fg_change and not fg_authorized then raise exception 'Access denied' using errcode='42501'; end if;
  -- Hold current authority through commit, not merely before waiting on stock.
  perform u.id from public.user_profiles u where u.id=actor and u.is_active for share;
  if not public.current_user_is_admin() then
    perform u.user_id from public.user_permissions u join public.permission_definitions d on d.id=u.permission_definition_id
      where u.user_id=actor and d.key=any(case when fg_change then array['projects.view','projects.edit','inventory.finished_goods.view','inventory.finished_goods.reserve'] else array['projects.edit'] end)
      order by d.key for share of u,d;
  end if;
  if public.current_project_planning_mutation_actor_id() is distinct from actor or (fg_change and not
    (public.current_user_is_admin() or (public.has_permission('projects.view') and public.has_permission('projects.edit')
      and public.has_permission('inventory.finished_goods.view') and public.has_permission('inventory.finished_goods.reserve')))) then
    raise exception 'Access denied' using errcode='42501'; end if;
  allocation:=p_operation='create' or (p_operation='update' and (current_row.product_id<>p_product_id or p_required_quantity>current_row.required_quantity));
  if allocation and public.is_calculator_finished_product(p_product_id) and not (select p.is_active from public.products p where p.id=p_product_id) then
    raise exception 'Finished Product is unavailable' using errcode='FGR03'; end if;
  perform b.product_id from public.inventory_balances b where b.product_id=any(affected)
    and b.warehouse_id='10000000-0000-4000-8000-000000000002'::uuid order by b.product_id for update;
  perform r.id from public.finished_goods_project_reservations r where r.project_id=p_project_id and r.product_id=any(affected) order by r.product_id for update;
  -- Trim before the immediate FGR06 trigger observes the edited requirement.
  for key in select distinct x from unnest(affected) x where public.is_calculator_finished_product(x) order by x loop
    select coalesce(sum(c.required_quantity::numeric),0) into planned from public.project_product_components c
      join public.project_products g on g.id=c.project_product_id where g.project_id=p_project_id and c.product_id=key;
    select coalesce(sum(-m.quantity_delta::numeric),0) into consumed from public.inventory_movements m where m.project_id=p_project_id and m.product_id=key
      and m.quantity_delta<0 and m.source_type in ('work_order','pcb_production_input','finished_goods_reservation_fulfillment');
    demand:=greatest(planned-case when current_row.product_id=key then current_row.required_quantity else 0 end
      +case when p_operation<>'remove' and p_product_id=key then p_required_quantity else 0 end-consumed,0);
    select coalesce((select r.reserved_quantity from public.finished_goods_project_reservations r where r.project_id=p_project_id and r.product_id=key),0) into reserved;
    if reserved::numeric>demand then perform public.set_requirement_finished_goods_reservation(p_project_id,key,demand::bigint,actor,p_request_id); end if;
  end loop;
  if p_operation='create' then component_key:=public.create_project_requirement_private(p_project_product_id,p_product_id,p_required_quantity);
  elsif p_operation='update' then component_key:=public.update_project_requirement_private(p_component_id,p_product_id,p_required_quantity);
  else component_key:=public.remove_project_requirement_private(p_component_id); end if;
  for key in select distinct x from unnest(affected) x where public.is_calculator_finished_product(x) order by x loop
    select coalesce((select d.outstanding_commitment from public.calculate_project_product_demand(p_project_id,key) d),0) into demand;
    select coalesce((select r.reserved_quantity from public.finished_goods_project_reservations r where r.project_id=p_project_id and r.product_id=key),0) into reserved;
    if allocation and key=p_product_id then
      select b.quantity into physical from public.inventory_balances b where b.product_id=key and b.warehouse_id='10000000-0000-4000-8000-000000000002'::uuid;
      if not found then raise exception 'Finished Goods balance not found' using errcode='FGR03'; end if;
      select coalesce(sum(r.reserved_quantity::numeric),0) into global_reserved from public.finished_goods_project_reservations r where r.product_id=key;
      extra:=least(greatest(demand-reserved,0),greatest(physical::numeric-global_reserved,0));
      if extra>0 then perform public.set_requirement_finished_goods_reservation(p_project_id,key,(reserved::numeric+extra)::bigint,actor,p_request_id); end if;
    end if;
    select coalesce((select r.reserved_quantity from public.finished_goods_project_reservations r where r.project_id=p_project_id and r.product_id=key),0) into reserved;
    context_rows:=context_rows||jsonb_build_array(jsonb_build_object('product_id',key,'reserved_quantity',reserved::text,
      'outstanding_demand',demand::text,'uncovered_demand',(demand-reserved)::text));
  end loop;
  result_value:=jsonb_build_object('request_id',p_request_id,'component_id',component_key,'operation',p_operation,'affected_products',context_rows);
  insert into public.project_requirement_mutation_receipts(request_id,actor_user_id,project_id,fg_affecting,payload,result)
    values(p_request_id,actor,p_project_id,fg_change,intent,result_value);
  return result_value;
end;
$function$;
revoke all on function public.mutate_project_requirement(uuid,text,uuid,uuid,uuid,uuid,bigint,uuid,bigint) from public, anon, authenticated, service_role;
grant execute on function public.mutate_project_requirement(uuid,text,uuid,uuid,uuid,uuid,bigint,uuid,bigint) to authenticated;
