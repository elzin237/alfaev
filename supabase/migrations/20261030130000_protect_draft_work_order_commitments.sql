-- 173: protect private Draft allocations; no reservation creation activation.
-- Counters are backed by 171's immutable, deferred-validated event ledger.
create function public.active_draft_warehouse_hold_quantity(p_product_id uuid,p_warehouse_id uuid)
returns numeric language sql stable security invoker set search_path='' as $f$
  select coalesce(sum(a.held_quantity::numeric),0::numeric)
  from public.work_order_material_reservation_allocations a
  join public.work_order_material_reservation_states s on s.id=a.state_id
  join public.work_orders w on w.id=s.live_work_order_id and w.id=s.work_order_id
  where s.status='active' and w.status='draft' and s.product_id=p_product_id and a.warehouse_id=p_warehouse_id;
$f$;

-- Retain the reviewed Test/FG-only capacity for allocation admission/validation.
do $copy$ declare definition text; begin
  definition:=pg_get_functiondef('public.get_production_free_warehouse_quantity_at(uuid,uuid,timestamptz)'::regprocedure);
  if position('active_test_holds_at' in definition)=0 or position('active_draft_' in definition)>0 then
    raise exception 'Unexpected production capacity baseline' using errcode='55000'; end if;
  execute replace(definition,'get_production_free_warehouse_quantity_at','get_production_capacity_without_draft_holds_at');
end; $copy$;
create function public.get_production_capacity_without_draft_holds(p_product_id uuid,p_warehouse_id uuid)
returns numeric language sql volatile security invoker set search_path='' as $f$
  select public.get_production_capacity_without_draft_holds_at(p_product_id,p_warehouse_id,clock_timestamp());
$f$;
create or replace function public.get_production_free_warehouse_quantity_at(p_product_id uuid,p_warehouse_id uuid,p_as_of timestamptz)
returns numeric language sql stable security invoker set search_path='' as $f$
  select greatest(public.get_production_capacity_without_draft_holds_at(p_product_id,p_warehouse_id,p_as_of)
    -public.active_draft_warehouse_hold_quantity(p_product_id,p_warehouse_id),0::numeric);
$f$;

-- Advisory owner credit is derived from the actual live Draft/material identity.
-- This is private and never a debit-guard bypass. Finish is NOT integrated here.
create function public.get_work_order_production_capacity_at(p_work_order_id uuid,p_product_id uuid,p_warehouse_id uuid,p_as_of timestamptz)
returns numeric language sql stable security invoker set search_path='' as $f$
  select case when exists(select 1 from public.work_orders w join public.work_order_items i on i.work_order_id=w.id
      where w.id=p_work_order_id and w.status='draft' and i.product_id=p_product_id)
    and p_warehouse_id in ('10000000-0000-4000-8000-000000000001'::uuid,'10000000-0000-4000-8000-000000000002'::uuid,'10000000-0000-4000-8000-000000000003'::uuid)
    and (not public.is_calculator_finished_product(p_product_id) or p_warehouse_id='10000000-0000-4000-8000-000000000002'::uuid)
  then greatest(public.get_production_capacity_without_draft_holds_at(p_product_id,p_warehouse_id,p_as_of)
    -public.active_draft_warehouse_hold_quantity(p_product_id,p_warehouse_id)
    +coalesce((select sum(a.held_quantity::numeric) from public.work_order_material_reservation_allocations a
      join public.work_order_material_reservation_states s on s.id=a.state_id
      where s.live_work_order_id=p_work_order_id and s.work_order_id=p_work_order_id and s.status='active'
        and s.product_id=p_product_id and a.warehouse_id=p_warehouse_id),0::numeric),0::numeric)
  else 0::numeric end;
$f$;
create function public.get_locked_work_order_production_capacity(p_work_order_id uuid,p_product_id uuid,p_warehouse_id uuid)
returns numeric language plpgsql volatile security invoker set search_path='' as $f$
begin
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'READ COMMITTED required' using errcode='25000'; end if;
  perform 1 from public.work_orders where id=p_work_order_id and status='draft' for update;
  if not found then raise exception 'Draft Work Order required' using errcode='WOR02'; end if;
  perform 1 from public.products where id=p_product_id for update;
  perform 1 from public.inventory_balances where product_id=p_product_id and warehouse_id=p_warehouse_id for update;
  return public.get_work_order_production_capacity_at(p_work_order_id,p_product_id,p_warehouse_id,clock_timestamp());
end;
$f$;

-- Fail-closed exact-fragment patches preserve signatures, roles, ACLs, receipts,
-- lock order and FIFO. Existing producer helpers must not deduct Drafts twice.
do $patch$
declare change record; definition text;
begin
  for change in select * from (values
    ('public.protect_test_calculator_warehouse_holds()',
      $old$new.quantity::numeric < tests + projects$old$,
      $new$new.quantity::numeric < tests + projects + public.active_draft_warehouse_hold_quantity(new.product_id,new.warehouse_id)$new$),
    ('public.preview_test_calculation(jsonb)',
      $old$greatest(balance.quantity::numeric - coalesce(active_tests.quantity,0::numeric) -$old$,
      $new$greatest(balance.quantity::numeric - public.active_draft_warehouse_hold_quantity(balance.product_id,balance.warehouse_id) - coalesce(active_tests.quantity,0::numeric) -$new$),
    ('public.save_test_calculation(uuid,text,jsonb,date)',
      $old$greatest(balance.quantity::numeric - coalesce(active_tests.quantity,0::numeric) -$old$,
      $new$greatest(balance.quantity::numeric - public.active_draft_warehouse_hold_quantity(balance.product_id,balance.warehouse_id) - coalesce(active_tests.quantity,0::numeric) -$new$),
    ('public.change_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid,boolean)',
      $old$- public.active_test_warehouse_hold_quantity(p_product_id,'10000000-0000-4000-8000-000000000002'::uuid)$old$,
      $new$- public.active_test_warehouse_hold_quantity(p_product_id,'10000000-0000-4000-8000-000000000002'::uuid)
      - public.active_draft_warehouse_hold_quantity(p_product_id,'10000000-0000-4000-8000-000000000002'::uuid)$new$),
    ('public.mutate_project_requirement(uuid,text,uuid,uuid,uuid,uuid,bigint,uuid,bigint)',
      $old$-public.active_test_warehouse_hold_quantity(key,'10000000-0000-4000-8000-000000000002'::uuid)$old$,
      $new$-public.active_test_warehouse_hold_quantity(key,'10000000-0000-4000-8000-000000000002'::uuid)
        -public.active_draft_warehouse_hold_quantity(key,'10000000-0000-4000-8000-000000000002'::uuid)$new$),
    ('public.get_work_order_material_availability(uuid)',
      $old$public.get_production_free_warehouse_quantity_at(
        balance.product_id,balance.warehouse_id,observed_at)$old$,
      $new$public.get_work_order_production_capacity_at(p_work_order_id,
        balance.product_id,balance.warehouse_id,observed_at)$new$),
    ('public.reconcile_work_order_material_shortages_for_product(uuid)',
      $old$public.get_production_free_warehouse_quantity_at(
        p_product_id, warehouse.id, observed_at)$old$,
      $new$public.get_work_order_production_capacity_at(target.work_order_id,
        p_product_id, warehouse.id, observed_at)$new$),
    ('public.guard_work_order_reservation_foundation()',
      $old$public.get_production_free_warehouse_quantity($old$,
      $new$public.get_production_capacity_without_draft_holds($new$),
    ('public.check_work_order_reservation_foundation()',
      $old$public.get_production_free_warehouse_quantity($old$,
      $new$public.get_production_capacity_without_draft_holds($new$),
    ('public.stage_draft_work_order_reservations(uuid,text,uuid,timestamptz,jsonb)',
      $old$public.get_production_free_warehouse_quantity($old$,
      $new$public.get_production_capacity_without_draft_holds($new$)
  ) changes(signature,needle,replacement) loop
    definition:=pg_get_functiondef(change.signature::regprocedure);
    if (length(definition)-length(replace(definition,change.needle,'')))<>length(change.needle) then
      raise exception 'Unexpected Draft protection consumer: %',change.signature using errcode='55000'; end if;
    execute replace(definition,change.needle,change.replacement);
  end loop;
end;
$patch$;
revoke all on function public.active_draft_warehouse_hold_quantity(uuid,uuid),
  public.get_production_capacity_without_draft_holds_at(uuid,uuid,timestamptz),
  public.get_production_capacity_without_draft_holds(uuid,uuid),
  public.get_work_order_production_capacity_at(uuid,uuid,uuid,timestamptz),
  public.get_locked_work_order_production_capacity(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
