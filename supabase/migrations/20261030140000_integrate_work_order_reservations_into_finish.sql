-- 174: owner-aware Finish only. Automatic Draft reservation creation stays OFF.
create function public.get_work_order_reserved_eligible_quantity(p_work_order_id uuid,p_product_id uuid)
returns bigint language sql volatile security invoker set search_path='' as $f$
  select coalesce(sum(public.get_work_order_production_capacity_at(p_work_order_id,p_product_id,b.warehouse_id,clock_timestamp())),0)::bigint
  from public.inventory_balances b where b.product_id=p_product_id;
$f$;
create function public.bind_work_order_reservation_fingerprint(p_work_order_id uuid,p_source_fingerprint text)
returns text language sql stable security invoker set search_path='' as $f$
  with ownership as (select string_agg(s.id::text||':'||s.product_id::text||':'||s.version::text||':'||s.required_quantity::text||':'||
    coalesce(a.warehouse_id::text,'')||':'||coalesce(a.held_quantity::text,'0'),'|' order by s.product_id,a.warehouse_id) value
    from public.work_order_material_reservation_states s left join public.work_order_material_reservation_allocations a on a.state_id=s.id
    join public.work_orders w on w.id=s.live_work_order_id and w.status='draft'
    where s.work_order_id=p_work_order_id and s.status='active')
  select case when value is null then p_source_fingerprint else md5(p_source_fingerprint||':'||value) end from ownership;
$f$;

-- Only trusted Finish input loops call this helper, after fingerprint validation.
-- Remove precisely the owned portion immediately before its ordinary guarded
-- physical debit. No session flags, broad exemptions or standalone release RPC.
create function public.consume_work_order_owned_allocation(p_work_order_id uuid,p_product_id uuid,p_warehouse_id uuid,p_quantity bigint)
returns void language plpgsql volatile security invoker set search_path='' as $f$
declare s public.work_order_material_reservation_states%rowtype; r public.work_order_material_reservation_receipts%rowtype;
  held bigint; consumed bigint;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null
    or not(public.current_user_is_admin() or public.has_permission('work_orders.finish')) then raise exception 'Access denied' using errcode='42501'; end if;
  select * into s from public.work_order_material_reservation_states where live_work_order_id=p_work_order_id and product_id=p_product_id and status='active' for update;
  if not found then return; end if;
  select * into r from public.work_order_material_reservation_receipts where work_order_id=p_work_order_id and operation='finish'
    and transaction_id=txid_current() and actor_user_id=public.current_active_user_profile_id() and auth_user_id=auth.uid()
    and submitted_payload->>'phase'='begin' order by created_at desc limit 1;
  if r.request_id is null or p_quantity is null or p_quantity<=0 or not exists(select 1 from public.work_orders w
    where w.id=p_work_order_id and w.status='draft' and w.updated_at=r.expected_updated_at) then
    raise exception 'Trusted Finish transaction required' using errcode='55000'; end if;
  select held_quantity into held from public.work_order_material_reservation_allocations where state_id=s.id and warehouse_id=p_warehouse_id for update;
  consumed:=least(coalesce(held,0),p_quantity);if consumed=0 then return;end if;
  if s.last_request_id<>r.request_id then
    update public.work_order_material_reservation_states set version=version+1,last_request_id=r.request_id where id=s.id returning * into s;
  end if;
  if consumed=held then delete from public.work_order_material_reservation_allocations where state_id=s.id and warehouse_id=p_warehouse_id;
  else update public.work_order_material_reservation_allocations set held_quantity=held-consumed,state_version=s.version where state_id=s.id and warehouse_id=p_warehouse_id;end if;
  insert into public.work_order_material_reservation_events(state_id,work_order_id,product_id,warehouse_id,state_version,request_id,actor_user_id,event_type,quantity,quantity_before,quantity_after)
    values(s.id,p_work_order_id,p_product_id,p_warehouse_id,s.version,r.request_id,r.actor_user_id,'consumed',consumed,held,held-consumed);
end;
$f$;

do $patch$
declare signature text; definition text; needle text; replacement text;
begin
  -- A reservation writer must serialize Project changes without blocking the
  -- FK KEY SHARE taken by Finish's deferred Project-shortage history inserts.
  -- FOR UPDATE here creates Project -> Product / Product -> Project FK cycles.
  definition:=pg_get_functiondef('public.change_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid,boolean)'::regprocedure);
  needle:='where project.id = p_project_id for update;';
  if position(needle in definition)=0 then raise exception 'Unexpected FG Project lock';end if;
  execute replace(definition,needle,'where project.id = p_project_id for no key update;');
  definition:=pg_get_functiondef('public.lock_open_project_for_planning(uuid)'::regprocedure);
  if position('for update' in definition)=0 then raise exception 'Unexpected planning Project lock';end if;
  execute replace(replace(definition,'lock_open_project_for_planning','lock_open_project_for_reservation_planning'),'for update','for no key update');
  definition:=pg_get_functiondef('public.mutate_project_requirement(uuid,text,uuid,uuid,uuid,uuid,bigint,uuid,bigint)'::regprocedure);
  needle:='public.lock_open_project_for_planning(p_project_id)';
  if position(needle in definition)=0 then raise exception 'Unexpected automatic reservation Project lock';end if;
  execute replace(definition,needle,'public.lock_open_project_for_reservation_planning(p_project_id)');
  foreach signature in array array['public.preflight_finish_work_order(uuid,timestamptz)','public.preflight_finish_pcb_production_work_order(uuid,timestamptz,text)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);needle:='public.get_production_eligible_quantity(';
    if position(needle in definition)=0 then raise exception 'Unexpected Finish preflight: %',signature;end if;
    definition:=replace(definition,needle,'public.get_work_order_reserved_eligible_quantity(current_work_order.id,');
    -- The same FK-compatible Project exclusion is needed when a stock debit
    -- already owns balances and Finish is waiting for that Product.
    definition:=regexp_replace(definition,'(where project.id = current_work_order.project_id\s+)for update;',E'\\1for no key update;','g');
    -- Foundation ledger validation requires Product UPDATE locks. Acquire them
    -- before balances rather than upgrading SHARE after another planner waits.
    if signature='public.preflight_finish_work_order(uuid,timestamptz)' then
      if position('for share of product' in definition)=0 then raise exception 'Unexpected ordinary Product lock';end if;
      definition:=replace(definition,'for share of product','for update of product');
    else
      needle:='    order by product.id'||chr(10)||'    for share';
      if position(needle in definition)=0 then raise exception 'Unexpected PCB Product lock';end if;
      definition:=replace(definition,needle,'    order by product.id'||chr(10)||'    for update');
    end if;
    execute definition;
  end loop;
  signature:='public.get_work_order_warehouse_source_allocation_plan(uuid)';definition:=pg_get_functiondef(signature::regprocedure);
  needle:='public.get_production_free_warehouse_quantity(balance.product_id,balance.warehouse_id)';
  if position(needle in definition)=0 then raise exception 'Unexpected source planner';end if;
  definition:=replace(definition,needle,'public.get_work_order_production_capacity_at(p_work_order_id,balance.product_id,balance.warehouse_id,clock_timestamp())');
  needle:='    perform lot.id from public.inventory_source_lots lot';
  if position(needle in definition)=0 then raise exception 'Unexpected FIFO lock boundary';end if;
  execute replace(definition,needle,'    perform s.id from public.work_order_material_reservation_states s where s.live_work_order_id=p_work_order_id and s.product_id=material.product_id order by s.id for update;'||chr(10)||needle);
  foreach signature in array array['public.get_work_order_pdf_snapshot(uuid,timestamptz)','public.get_work_order_pdf_snapshot(uuid,timestamptz,text)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);needle:='    fingerprint.value,';
    if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Unexpected PDF fingerprint';end if;
    execute replace(definition,needle,'    public.bind_work_order_reservation_fingerprint(header.work_order_id,fingerprint.value),');
  end loop;
  definition:=pg_get_functiondef('public.get_work_order_source_allocation_fingerprint(uuid)'::regprocedure);
  if position('return fingerprint;' in definition)=0 then raise exception 'Unexpected source fingerprint';end if;
  execute replace(definition,'return fingerprint;','return public.bind_work_order_reservation_fingerprint(p_work_order_id,fingerprint);');
  foreach signature in array array['public.finish_generic_work_order_internal(uuid,timestamptz,text,text)','public.finish_pcb_work_order_internal(uuid,timestamptz,text,text,text)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    needle:=$n$    select applied.movement_id
    into applied_movement_id
    from public.apply_inventory_delta_in_warehouse(
      p_product_id => material_record.product_id,$n$;
    if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Unexpected Finish debit boundary: %',signature;end if;
    replacement:='    perform public.consume_work_order_owned_allocation(p_work_order_id,material_record.product_id,material_record.warehouse_id,material_record.quantity);'||chr(10)||needle;
    execute replace(definition,needle,replacement);
  end loop;
end;
$patch$;

alter function public.finish_work_order(uuid,timestamptz,text,text,text) rename to finish_work_order_source_checked_internal;
alter function public.finish_work_order(uuid,timestamptz,text,text,text,text) rename to finish_work_order_source_checked_internal;
revoke all on function public.finish_work_order_source_checked_internal(uuid,timestamptz,text,text,text),
  public.finish_work_order_source_checked_internal(uuid,timestamptz,text,text,text,text) from public,anon,authenticated,service_role;

create function public.finish_reserved_work_order_transaction(p_work_order_id uuid,p_expected_updated_at timestamptz,p_pdf_storage_reference text,
  p_pdf_content_hash text,p_allocation_fingerprint text,p_is_pcb boolean,p_actual_good_quantity text)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare actor uuid:=public.current_active_user_profile_id(); w public.work_orders%rowtype;
  payload jsonb; request uuid; result_request uuid; result jsonb; prior public.work_order_material_reservation_receipts%rowtype;
  s public.work_order_material_reservation_states%rowtype; a record;
begin
  if auth.uid() is null or actor is null or not(public.current_user_is_admin() or public.has_permission('work_orders.finish')) then raise exception 'Access denied' using errcode='42501';end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'READ COMMITTED required' using errcode='25000';end if;
  payload:=jsonb_build_object('operation','finish','work_order_id',p_work_order_id,'auth_user_id',auth.uid(),'actor_user_id',actor,
    'expected_updated_at',to_char(p_expected_updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'pdf',p_pdf_storage_reference,'hash',p_pdf_content_hash,'fingerprint',p_allocation_fingerprint,'pcb',p_is_pcb,'actual',p_actual_good_quantity);
  request:=md5('wo-finish:'||payload::text)::uuid;result_request:=md5('wo-finish-result:'||request::text)::uuid;
  perform pg_advisory_xact_lock(hashtextextended('wo-finish:'||p_work_order_id::text,0));
  select * into w from public.work_orders where id=p_work_order_id for update;
  if not found then raise exception 'Work Order not found' using errcode='P0002';end if;
  perform 1 from public.user_profiles where id=actor and auth_user_id=auth.uid() and is_active for share;
  if not public.current_user_is_admin() then perform g.user_id from public.user_permissions g join public.permission_definitions d on d.id=g.permission_definition_id
    where g.user_id=actor and d.key='work_orders.finish' for share of g,d;end if;
  if public.current_active_user_profile_id() is distinct from actor or not(public.current_user_is_admin() or public.has_permission('work_orders.finish')) then raise exception 'Access denied' using errcode='42501';end if;
  select * into prior from public.work_order_material_reservation_receipts where request_id=result_request;
  if found then
    if prior.actor_user_id<>actor or prior.auth_user_id<>auth.uid() or prior.submitted_payload is distinct from payload||jsonb_build_object('phase','result') then raise exception 'Finish receipt mismatch' using errcode='42501';end if;
    return prior.receipt->'result';
  end if;
  if p_is_pcb then perform 1 from public.preflight_finish_pcb_production_work_order(p_work_order_id,p_expected_updated_at,p_actual_good_quantity);
  else perform 1 from public.preflight_finish_work_order(p_work_order_id,p_expected_updated_at);end if;
  if public.get_work_order_source_allocation_fingerprint(p_work_order_id) is distinct from p_allocation_fingerprint then raise exception 'Inventory sources changed. Reload and try again.' using errcode='WOR11';end if;
  insert into public.work_order_material_reservation_receipts(request_id,work_order_id,work_order_number,actor_user_id,auth_user_id,operation,expected_updated_at,submitted_payload,receipt)
    values(request,p_work_order_id,w.work_order_number,actor,auth.uid(),'finish',p_expected_updated_at,payload||jsonb_build_object('phase','begin'),jsonb_build_object('request_id',request,'work_order_id',p_work_order_id,'operation','finish'));
  if p_is_pcb then select to_jsonb(f) into result from public.finish_work_order_source_checked_internal(p_work_order_id,p_expected_updated_at,p_pdf_storage_reference,p_pdf_content_hash,p_allocation_fingerprint,p_actual_good_quantity) f;
  else select to_jsonb(f) into result from public.finish_work_order_source_checked_internal(p_work_order_id,p_expected_updated_at,p_pdf_storage_reference,p_pdf_content_hash,p_allocation_fingerprint) f;end if;
  if result is null or not exists(select 1 from public.work_orders where id=p_work_order_id and status='finished') then raise exception 'Finish result unavailable' using errcode='55000';end if;
  insert into public.work_order_material_reservation_receipts(request_id,work_order_id,work_order_number,actor_user_id,auth_user_id,operation,expected_updated_at,submitted_payload,receipt)
    values(result_request,p_work_order_id,w.work_order_number,actor,auth.uid(),'finish',p_expected_updated_at,payload||jsonb_build_object('phase','result'),jsonb_build_object('request_id',result_request,'work_order_id',p_work_order_id,'operation','finish','result',result));
  for s in select * from public.work_order_material_reservation_states where live_work_order_id=p_work_order_id and status='active' order by product_id for update loop
    update public.work_order_material_reservation_states set status='consumed',version=version+1,last_request_id=result_request where id=s.id returning * into s;
    for a in select * from public.work_order_material_reservation_allocations where state_id=s.id order by warehouse_id for update loop
      delete from public.work_order_material_reservation_allocations where state_id=s.id and warehouse_id=a.warehouse_id;
      insert into public.work_order_material_reservation_events(state_id,work_order_id,product_id,warehouse_id,state_version,request_id,actor_user_id,event_type,quantity,quantity_before,quantity_after)
        values(s.id,p_work_order_id,s.product_id,a.warehouse_id,s.version,result_request,actor,'released',a.held_quantity,a.held_quantity,0);
    end loop;
  end loop;
  set constraints public.reservation_foundation_consistent immediate;
  set constraints public.reservation_foundation_consistent deferred;
  return result;
end;
$f$;

create function public.finish_work_order(p_work_order_id uuid,p_expected_updated_at timestamptz,p_pdf_storage_reference text,p_pdf_content_hash text,p_allocation_fingerprint text)
returns table(work_order_id uuid,work_order_number text,finished_at timestamptz,project_id uuid,project_completed boolean,work_order_pdf_id uuid)
language sql volatile security definer set search_path='' as $f$
  select r.* from jsonb_to_record(public.finish_reserved_work_order_transaction(p_work_order_id,p_expected_updated_at,p_pdf_storage_reference,p_pdf_content_hash,p_allocation_fingerprint,false,null))
    r(work_order_id uuid,work_order_number text,finished_at timestamptz,project_id uuid,project_completed boolean,work_order_pdf_id uuid);
$f$;
create function public.finish_work_order(p_work_order_id uuid,p_expected_updated_at timestamptz,p_pdf_storage_reference text,p_pdf_content_hash text,p_allocation_fingerprint text,p_actual_good_quantity text)
returns table(work_order_id uuid,work_order_number text,finished_at timestamptz,project_id uuid,project_completed boolean,work_order_pdf_id uuid)
language sql volatile security definer set search_path='' as $f$
  select r.* from jsonb_to_record(public.finish_reserved_work_order_transaction(p_work_order_id,p_expected_updated_at,p_pdf_storage_reference,p_pdf_content_hash,p_allocation_fingerprint,true,p_actual_good_quantity))
    r(work_order_id uuid,work_order_number text,finished_at timestamptz,project_id uuid,project_completed boolean,work_order_pdf_id uuid);
$f$;
revoke all on function public.get_work_order_reserved_eligible_quantity(uuid,uuid),public.bind_work_order_reservation_fingerprint(uuid,text),
  public.lock_open_project_for_reservation_planning(uuid),
  public.consume_work_order_owned_allocation(uuid,uuid,uuid,bigint),public.finish_reserved_work_order_transaction(uuid,timestamptz,text,text,text,boolean,text),
  public.finish_work_order(uuid,timestamptz,text,text,text),public.finish_work_order(uuid,timestamptz,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finish_work_order(uuid,timestamptz,text,text,text),public.finish_work_order(uuid,timestamptz,text,text,text,text) to authenticated;
