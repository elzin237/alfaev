-- 172: owner-private staging contract only. No existing RPC delegates here, no
-- application EXECUTE, no triggers, no activation/backfill/stock consumption.
create function public.stage_draft_work_order_reservations(
  p_request_id uuid,p_action text,p_work_order_id uuid default null,
  p_expected_updated_at timestamptz default null,p_input jsonb default '{}'::jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare
  actor uuid:=public.current_active_user_profile_id(); permission_key text; operation_key text;
  original public.work_order_material_reservation_receipts%rowtype;
  current_order public.work_orders%rowtype; previous_order public.work_orders%rowtype;
  state_row public.work_order_material_reservation_states%rowtype;
  old_materials jsonb:='{}'; canonical jsonb; plans jsonb:='[]'; result_items jsonb:='[]'; result jsonb;
  product_ids uuid[]; product_key uuid; warehouse_key uuid; project_key uuid; card_key uuid; version_key uuid;
  record_row record; plan jsonb; old_targets jsonb; targets jsonb; state_key uuid;
  required_now bigint; required_before bigint; state_required_before bigint; next_version bigint;
  old_held numeric; remaining numeric; old_amount numeric; new_amount numeric; available numeric; competing numeric;
  current_total numeric; change_state boolean;
begin
  permission_key:=case p_action when 'create' then 'work_orders.create' when 'create_pcb' then 'pcb.produce'
    when 'edit' then 'work_orders.edit_draft' when 'supplemental' then 'work_orders.edit_draft'
    when 'delete' then 'work_orders.delete_draft' end;
  operation_key:=case when p_action in ('create','create_pcb') then 'create' when p_action='delete' then 'delete' else 'edit' end;
  if auth.uid() is null or actor is null or permission_key is null or not(public.current_user_is_admin() or public.has_permission(permission_key)) then
    raise exception 'Access denied' using errcode='42501'; end if;
  if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object'
    or current_setting('transaction_isolation')<>'read committed'
    or (operation_key<>'create' and (p_work_order_id is null or p_expected_updated_at is null))
    or (operation_key='create' and (p_work_order_id is not null or p_expected_updated_at is not null)) then
    raise exception 'Invalid lifecycle request' using errcode='22023'; end if;
  canonical:=jsonb_build_object('auth_user_id',auth.uid(),'operation',operation_key,'action',p_action,
    'target_work_order_id',p_work_order_id,'expected_updated_at',to_char(p_expected_updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'input',p_input);
  perform pg_advisory_xact_lock(hashtextextended('wo-reservation-lifecycle:'||p_request_id::text,0));
  if public.current_active_user_profile_id() is distinct from actor or not(public.current_user_is_admin() or public.has_permission(permission_key)) then
    raise exception 'Access denied' using errcode='42501'; end if;
  select * into original from public.work_order_material_reservation_receipts where request_id=p_request_id;
  if found then
    if original.actor_user_id<>actor or original.auth_user_id<>auth.uid() then raise exception 'Access denied' using errcode='42501'; end if;
    if original.submitted_payload is distinct from canonical||jsonb_build_object('work_order_id',original.work_order_id) then
      raise exception 'Request payload differs' using errcode='WRC01'; end if;
    return original.receipt;
  end if;
  if operation_key<>'create' then
    select * into current_order from public.work_orders where id=p_work_order_id for update;
    if not found then raise exception 'Work Order not found' using errcode='P0002'; end if;
    if current_order.status<>'draft' then raise exception 'Draft required' using errcode='WOR02'; end if;
    if current_order.updated_at is distinct from p_expected_updated_at then raise exception 'Draft changed' using errcode='WOR05'; end if;
    previous_order:=current_order;
    select coalesce(jsonb_object_agg(material.product_id::text,material.quantity::text),'{}') into old_materials
      from(select i.product_id,sum(i.quantity::numeric)::bigint quantity from public.work_order_items i where i.work_order_id=current_order.id group by i.product_id) material;
    -- Preserve parent -> Projects -> all affected Products before nested writers.
    for project_key in select distinct id from public.projects where id=current_order.project_id
      or (p_action='edit' and id=(p_input->>'project_id')::uuid) order by id loop
      perform 1 from public.projects where id=project_key for update;
    end loop;
  elsif p_action='create_pcb' then
    if (select array_agg(key order by key) from jsonb_object_keys(p_input) key) is distinct from array['pcb_card_id','planned_quantity'] then
      raise exception 'Invalid PCB creation payload' using errcode='22023'; end if;
    card_key:=(p_input->>'pcb_card_id')::uuid;
    if exists(select 1 from public.pcb_production_work_orders where creation_request_id=p_request_id) then
      raise exception 'Existing Draft initialization is not permitted' using errcode='WRC02'; end if;
    perform 1 from public.pcb_cards where id=card_key for update;
    select id into version_key from public.pcb_bom_versions where pcb_card_id=card_key and is_active for update;
  end if;
  if p_action in ('edit','supplemental') and jsonb_typeof(p_input->'items') is distinct from 'array' then
    raise exception 'Material array required' using errcode='22023'; end if;
  select array_agg(candidate.id order by candidate.id) into product_ids from(
    select key::uuid id from jsonb_object_keys(old_materials) key
    union select (item->>'product_id')::uuid from jsonb_array_elements(case when p_action in ('edit','supplemental') then p_input->'items' else '[]' end) item
    union select i.component_product_id from public.pcb_bom_items i where i.bom_version_id=version_key
    union select c.output_product_id from public.pcb_cards c where c.id=card_key
    union select s.product_id from public.work_order_material_reservation_states s where s.live_work_order_id=p_work_order_id and s.status='active'
  ) candidate;
  perform product.id from public.products product where product.id=any(product_ids) order by product.id for update;
  perform balance.product_id from public.inventory_balances balance where balance.product_id=any(product_ids)
    order by balance.product_id,balance.warehouse_id for update;
  perform profile.id from public.user_profiles profile where profile.id=actor and profile.auth_user_id=auth.uid() and profile.is_active for share;
  if not public.current_user_is_admin() then
    perform grant_row.user_id from public.user_permissions grant_row join public.permission_definitions definition on definition.id=grant_row.permission_definition_id
      where grant_row.user_id=actor and definition.key=permission_key for share of grant_row,definition;
  end if;
  if public.current_active_user_profile_id() is distinct from actor or not(public.current_user_is_admin() or public.has_permission(permission_key)) then
    raise exception 'Access denied' using errcode='42501'; end if;
  if p_action='create' then
    if p_input<>'{}' then raise exception 'Empty creation payload required' using errcode='22023'; end if;
    select * into record_row from public.create_draft_work_order();
    select * into current_order from public.work_orders where id=record_row.work_order_id;
  elsif p_action='create_pcb' then
    select * into record_row from public.create_pcb_production_work_order(card_key,p_input->>'planned_quantity',null,p_request_id);
    select * into current_order from public.work_orders where id=record_row.work_order_id;
  elsif p_action='edit' then
    if (select array_agg(key order by key) from jsonb_object_keys(p_input) key) is distinct from array['description','items','project_id'] then raise exception 'Invalid Draft payload' using errcode='22023'; end if;
    perform public.save_draft_work_order(current_order.id,(p_input->>'project_id')::uuid,p_input->>'description',p_input->'items',p_expected_updated_at);
    select * into current_order from public.work_orders where id=current_order.id;
  elsif p_action='supplemental' then
    if (select array_agg(key order by key) from jsonb_object_keys(p_input) key) is distinct from array['items'] then raise exception 'Invalid supplemental payload' using errcode='22023'; end if;
    perform public.save_pcb_production_supplemental_materials(current_order.id,p_input->'items',p_expected_updated_at);
    select * into current_order from public.work_orders where id=current_order.id;
  elsif p_input<>'{}' then raise exception 'Empty deletion payload required' using errcode='22023'; end if;
  if current_order.id is null then raise exception 'Draft identity unavailable' using errcode='55000'; end if;
  -- Saved material rows already include planned BOM multiplication. Never multiply
  -- them again, replace frozen rows or expand a finished input's own BOM.
  for product_key in select id from(
    select i.product_id id from public.work_order_items i where i.work_order_id=current_order.id
    union select key::uuid from jsonb_object_keys(old_materials) key
    union select s.product_id from public.work_order_material_reservation_states s where s.live_work_order_id=current_order.id and s.status='active'
  ) products order by id loop
    select * into state_row from public.work_order_material_reservation_states where work_order_id=current_order.id and product_id=product_key for update;
    if p_action='delete' and state_row.id is null then continue; end if;
    select coalesce(sum(i.quantity::numeric),0)::bigint into required_now from public.work_order_items i where i.work_order_id=current_order.id and i.product_id=product_key;
    required_before:=coalesce((old_materials->>product_key::text)::bigint,0);
    if state_row.id is not null and (state_row.status<>'active' or state_row.required_quantity<>required_before) then raise exception 'Reservation/Draft version mismatch' using errcode='WRC03'; end if;
    select coalesce(jsonb_object_agg(a.warehouse_id::text,a.held_quantity::text),'{}'),coalesce(sum(a.held_quantity::numeric),0)
      into old_targets,old_held from public.work_order_material_reservation_allocations a where a.state_id=state_row.id;
    targets:=old_targets; remaining:=case when p_action='delete' then old_held else greatest(old_held-required_now::numeric,0) end;
    for warehouse_key in select id from public.inventory_warehouses order by public.production_warehouse_priority(id) desc loop
      old_amount:=coalesce((targets->>warehouse_key::text)::numeric,0);new_amount:=old_amount-least(old_amount,remaining);remaining:=remaining-(old_amount-new_amount);
      targets:=targets||jsonb_build_object(warehouse_key::text,new_amount::text);
    end loop;
    remaining:=case when p_action='delete' then 0 else greatest(required_now::numeric-required_before::numeric,0) end;
    for warehouse_key in select id from public.inventory_warehouses where not public.is_calculator_finished_product(product_key)
      or id='10000000-0000-4000-8000-000000000002'::uuid order by public.production_warehouse_priority(id) loop
      if remaining<=0 then exit; end if;
      select coalesce(sum(a.held_quantity::numeric),0) into competing from public.work_order_material_reservation_allocations a
        join public.work_order_material_reservation_states owner_state on owner_state.id=a.state_id
        join public.work_orders w on w.id=owner_state.live_work_order_id and w.status='draft'
        where owner_state.status='active' and owner_state.product_id=product_key and a.warehouse_id=warehouse_key and owner_state.id is distinct from state_row.id;
      old_amount:=coalesce((targets->>warehouse_key::text)::numeric,0);
      available:=greatest(public.get_production_free_warehouse_quantity(product_key,warehouse_key)-competing-old_amount,0);
      new_amount:=least(remaining,available);remaining:=remaining-new_amount;
      targets:=targets||jsonb_build_object(warehouse_key::text,(old_amount+new_amount)::text);
    end loop;
    select coalesce(sum(value::numeric),0) into current_total from jsonb_each_text(targets);
    change_state:=state_row.id is null or required_now<>state_row.required_quantity or targets is distinct from
      old_targets||jsonb_build_object('10000000-0000-4000-8000-000000000001',coalesce(old_targets->>'10000000-0000-4000-8000-000000000001','0'),
        '10000000-0000-4000-8000-000000000002',coalesce(old_targets->>'10000000-0000-4000-8000-000000000002','0'),
        '10000000-0000-4000-8000-000000000003',coalesce(old_targets->>'10000000-0000-4000-8000-000000000003','0'))
      or current_order.updated_at is distinct from state_row.draft_updated_at or p_action='delete';
    plans:=plans||jsonb_build_array(jsonb_build_object('state_id',coalesce(state_row.id,gen_random_uuid()),'product_id',product_key,
      'required',required_now::text,'old_required',coalesce(state_row.required_quantity,0)::text,'version',coalesce(state_row.version+1,1),
      'existing',state_row.id is not null,'change',change_state,'old',old_targets,'targets',targets));
    result_items:=result_items||jsonb_build_array(jsonb_build_object('product_id',product_key,'required',required_now::text,
      'held',current_total::text,'uncovered',case when p_action='delete' then '0' else (required_now::numeric-current_total)::text end));
  end loop;
  result:=jsonb_build_object('request_id',p_request_id,'work_order_id',current_order.id,'operation',operation_key,
    'updated_at',current_order.updated_at,'materials',result_items);
  insert into public.work_order_material_reservation_receipts(request_id,work_order_id,work_order_number,actor_user_id,auth_user_id,operation,
    expected_updated_at,submitted_payload,receipt) values(p_request_id,current_order.id,current_order.work_order_number,actor,auth.uid(),operation_key,
      p_expected_updated_at,canonical||jsonb_build_object('work_order_id',current_order.id),result);
  for plan in select value from jsonb_array_elements(plans) loop
    if not (plan->>'change')::boolean then continue; end if;
    state_key:=(plan->>'state_id')::uuid;product_key:=(plan->>'product_id')::uuid;next_version:=(plan->>'version')::bigint;
    required_now:=(plan->>'required')::bigint;state_required_before:=(plan->>'old_required')::bigint;
    if (plan->>'existing')::boolean then
      update public.work_order_material_reservation_states set required_quantity=required_now,version=next_version,draft_updated_at=current_order.updated_at,
        status=case when p_action='delete' then 'released' else 'active' end,last_request_id=p_request_id where id=state_key;
    else
      insert into public.work_order_material_reservation_states(id,work_order_id,live_work_order_id,product_id,required_quantity,version,draft_updated_at,last_request_id)
        values(state_key,current_order.id,current_order.id,product_key,required_now,1,current_order.updated_at,p_request_id);
    end if;
    if required_now<>state_required_before then
      insert into public.work_order_material_reservation_events(state_id,work_order_id,product_id,state_version,request_id,actor_user_id,event_type,quantity,quantity_before,quantity_after)
        values(state_key,current_order.id,product_key,next_version,p_request_id,actor,'requirement_changed',abs(required_now::numeric-state_required_before)::bigint,state_required_before,required_now);
    end if;
    for record_row in select id from public.inventory_warehouses order by id loop
      warehouse_key:=record_row.id;old_amount:=coalesce((plan->'old'->>warehouse_key::text)::numeric,0);new_amount:=(plan->'targets'->>warehouse_key::text)::numeric;
      if old_amount=new_amount then continue; end if;
      if new_amount=0 then delete from public.work_order_material_reservation_allocations where state_id=state_key and warehouse_id=warehouse_key;
      else insert into public.work_order_material_reservation_allocations values(state_key,warehouse_key,new_amount::bigint,next_version)
        on conflict(state_id,warehouse_id) do update set held_quantity=excluded.held_quantity,state_version=excluded.state_version; end if;
      insert into public.work_order_material_reservation_events(state_id,work_order_id,product_id,warehouse_id,state_version,request_id,actor_user_id,event_type,quantity,quantity_before,quantity_after)
        values(state_key,current_order.id,product_key,warehouse_key,next_version,p_request_id,actor,case when new_amount>old_amount then 'allocated' else 'released' end,
          abs(new_amount-old_amount)::bigint,old_amount::bigint,new_amount::bigint);
    end loop;
  end loop;
  if p_action='delete' then perform public.delete_draft_work_order(current_order.id,p_expected_updated_at); end if;
  -- Drain new private invoker/deferred work under the trusted identity. No
  -- caller can commit a partially reconciled state after this returns.
  set constraints public.reservation_foundation_consistent immediate;
  set constraints public.reservation_foundation_consistent deferred;
  return result;
end;
$f$;
revoke all on function public.stage_draft_work_order_reservations(uuid,text,uuid,timestamptz,jsonb) from public,anon,authenticated,service_role;
