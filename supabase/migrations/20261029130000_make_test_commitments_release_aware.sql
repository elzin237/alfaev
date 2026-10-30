-- Phase 2: one effective-hold boundary. No import RPC, release endpoint or data writes.
create function public.effective_test_hold_quantity(
  p_original bigint, p_released bigint, p_expires_at timestamptz, p_as_of timestamptz
) returns numeric language sql immutable security invoker set search_path = '' as $function$
  select case when p_expires_at > p_as_of
    then greatest(p_original::numeric - coalesce(p_released,0)::numeric,0::numeric)
    else 0::numeric end;
$function$;
revoke all on function public.effective_test_hold_quantity(bigint,bigint,timestamptz,timestamptz)
  from public, anon, authenticated, service_role;

create function public.active_test_holds_at(p_as_of timestamptz,p_product_ids uuid[] default null)
returns table(item_id uuid, calculation_id uuid, product_id uuid, warehouse_id uuid,
  quantity numeric, expires_at timestamptz)
language sql stable security invoker set search_path = '' as $function$
  select hold.item_id,hold.calculation_id,hold.product_id,hold.warehouse_id,
    effective.quantity,calculation.expires_at
  from public.test_calculation_holds hold
  join public.test_calculations calculation on calculation.id=hold.calculation_id
  left join public.test_calculation_import_releases released on released.item_id=hold.item_id
    and released.warehouse_id=hold.warehouse_id and released.calculation_id=hold.calculation_id
    and released.product_id=hold.product_id
  left join public.test_calculation_imports imported on imported.id=released.import_id
    and imported.calculation_id=hold.calculation_id
  cross join lateral (select public.effective_test_hold_quantity(hold.quantity,
    case when imported.imported_at <= p_as_of then released.quantity else 0::bigint end,
    calculation.expires_at,p_as_of) quantity) effective
  where effective.quantity > 0
    and (p_product_ids is null or hold.product_id=any(p_product_ids));
$function$;
revoke all on function public.active_test_holds_at(timestamptz,uuid[])
  from public, anon, authenticated, service_role;

-- Existing post-lock VOLATILE guard/admission callers retain their time boundary.
create or replace function public.active_test_warehouse_hold_quantity(p_product_id uuid,p_warehouse_id uuid)
returns numeric language sql volatile security invoker set search_path = '' as $function$
  with observed as materialized (select pg_catalog.clock_timestamp() at_time)
  select coalesce(pg_catalog.sum(hold.quantity),0::numeric)
  from observed cross join lateral public.active_test_holds_at(observed.at_time,array[p_product_id]) hold
  where hold.product_id=p_product_id and hold.warehouse_id=p_warehouse_id;
$function$;
revoke all on function public.active_test_warehouse_hold_quantity(uuid,uuid)
  from public, anon, authenticated, service_role;

-- WO reads/reconciliation use a single snapshot and explicit authoritative as_of;
-- production's existing VOLATILE wrapper supplies fresh post-lock database time.
create or replace function public.get_production_free_warehouse_quantity_at(
  p_product_id uuid,p_warehouse_id uuid,p_as_of timestamptz
) returns numeric language sql stable security invoker set search_path = '' as $function$
  select coalesce((select greatest(balance.quantity::numeric
    - coalesce((select pg_catalog.sum(hold.quantity) from public.active_test_holds_at(p_as_of,array[p_product_id]) hold
      where hold.product_id=balance.product_id and hold.warehouse_id=balance.warehouse_id),0::numeric)
    - case when balance.warehouse_id='10000000-0000-4000-8000-000000000002'::uuid
      then coalesce((select pg_catalog.sum(state.reserved_quantity::numeric)
        from public.finished_goods_project_reservations state where state.product_id=balance.product_id),0::numeric)
      else 0::numeric end,0::numeric)
    from public.inventory_balances balance where balance.product_id=p_product_id
      and balance.warehouse_id=p_warehouse_id),0::numeric);
$function$;
revoke all on function public.get_production_free_warehouse_quantity_at(uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;

-- Patch ONLY direct hold aggregation fragments; preserve complete original
-- authorization, receipts, lock ordering, volatility, signatures and existing ACLs.
do $migration$
declare patch record; definition text;
begin
  for patch in select * from (values
    ('public.preview_test_calculation(jsonb)',
      $old$from public.test_calculation_holds hold join public.test_calculations calculation on calculation.id = hold.calculation_id
    where hold.product_id = any(ids) and calculation.expires_at > read_at$old$,
      $new$from public.active_test_holds_at(read_at,ids) hold
    where hold.product_id = any(ids)$new$),
    ('public.save_test_calculation(uuid,text,jsonb,date)',
      $old$from public.test_calculation_holds hold join public.test_calculations calculation on calculation.id = hold.calculation_id
    where hold.product_id = any(ids) and calculation.expires_at > saved_at$old$,
      $new$from public.active_test_holds_at(saved_at,ids) hold
    where hold.product_id = any(ids)$new$),
    ('public.get_inventory_test_commitments(uuid,text)',
      $old$pg_catalog.min(calculation.expires_at) expires_at
    from public.test_calculation_holds hold join public.test_calculations calculation on calculation.id=hold.calculation_id
    join listed on listed.id=hold.product_id
    where hold.quantity>0 and calculation.expires_at > read_at and ($old$,
      $new$pg_catalog.min(hold.expires_at) expires_at
    from public.active_test_holds_at(read_at,coalesce((select pg_catalog.array_agg(listed.id) from listed),'{}'::uuid[])) hold
    join listed on listed.id=hold.product_id
    where hold.quantity>0 and ($new$)
  ) as fragments(identity,old_fragment,new_fragment)
  loop
    definition := pg_catalog.pg_get_functiondef(patch.identity::regprocedure);
    if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,patch.old_fragment,'')))
      <> pg_catalog.length(patch.old_fragment) then
      raise exception 'Unexpected Test hold consumer definition: %',patch.identity;
    end if;
    execute pg_catalog.replace(definition,patch.old_fragment,patch.new_fragment);
  end loop;
end;
$migration$;

-- Existing queue coalesces by transaction/Product and takes no reverse stock locks.
-- The eventual trusted importer must validate/drain deferred work before returning.
create trigger test_import_releases_queue_work_order_material_shortage
after insert on public.test_calculation_import_releases
for each row execute function public.queue_work_order_material_shortage_reconciliation();

comment on function public.active_test_holds_at(timestamptz,uuid[]) is
  'Private canonical positive effective holds at a caller-owned database snapshot/time; original allocations remain historical. No client-controlled clock or release API.';
