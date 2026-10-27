-- TC-05: one shared physical-debit boundary; no sourcing/admission changes.
-- VOLATILE + wall-clock time is essential after a blocked balance UPDATE.
create function public.active_test_warehouse_hold_quantity(p_product_id uuid, p_warehouse_id uuid)
returns numeric language sql volatile security invoker set search_path = '' as $function$
  with observed as materialized (select pg_catalog.clock_timestamp() at_time)
  select coalesce(pg_catalog.sum(hold.quantity::numeric),0::numeric)
  from public.test_calculation_holds hold
  join public.test_calculations calculation on calculation.id = hold.calculation_id
  cross join observed
  where hold.product_id = p_product_id and hold.warehouse_id = p_warehouse_id
    and calculation.expires_at > observed.at_time;
$function$;
revoke all on function public.active_test_warehouse_hold_quantity(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.protect_test_calculator_warehouse_holds()
returns trigger language plpgsql volatile security definer set search_path = '' as $function$
declare tests numeric; projects numeric := 0::numeric;
begin
  -- Fixed snapshots can miss a Save committed during a row-lock wait. Fail closed.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Warehouse debit requires READ COMMITTED isolation' using errcode = '25000';
  end if;
  -- The UPDATE already owns this balance row lock. Never acquire a Product or
  -- Project lock here (which would invert existing Product -> balance ordering).
  tests := public.active_test_warehouse_hold_quantity(new.product_id,new.warehouse_id);
  if new.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid then
    select coalesce(pg_catalog.sum(state.reserved_quantity::numeric),0::numeric)
      into projects from public.finished_goods_project_reservations state
      where state.product_id = new.product_id;
  end if;
  if new.quantity::numeric < tests + projects then
    raise exception 'Insufficient unreserved warehouse stock' using errcode = 'IVB02';
  end if;
  return new;
end;
$function$;
revoke all on function public.protect_test_calculator_warehouse_holds()
  from public, anon, authenticated, service_role;

-- Existing FG guard, permissions, RLS and provenance triggers remain untouched.
-- Covers all existing debits routed through inventory_balances.quantity, including
-- low-level trusted deltas; there is no Admin, transfer or fulfillment bypass.
create trigger inventory_balances_protect_test_calculator_holds
before update of quantity on public.inventory_balances
for each row when (new.quantity < old.quantity)
execute function public.protect_test_calculator_warehouse_holds();
