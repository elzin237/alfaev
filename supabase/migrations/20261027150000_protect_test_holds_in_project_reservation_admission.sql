-- TC-07: retain complete reviewed actor/replay/lock/accounting implementations.
-- Fail closed on source drift; change only the two post-lock admission checks.
do $migration$
declare change record; definition text;
begin
  for change in select * from (values
    ('public.change_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid,boolean)',
      $old$    if total_reserved + p_quantity::numeric > physical_quantity::numeric then$old$,
      $new$    -- Fixed snapshots could miss a Test Save committed during a lock wait.
    if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
      raise exception 'Reservation admission requires READ COMMITTED isolation' using errcode = '25000'; end if;
    if p_quantity::numeric > greatest(physical_quantity::numeric - total_reserved
      - public.active_test_warehouse_hold_quantity(p_product_id,'10000000-0000-4000-8000-000000000002'::uuid),0::numeric) then$new$),
    ('public.mutate_project_requirement(uuid,text,uuid,uuid,uuid,uuid,bigint,uuid,bigint)',
      $old$      extra:=least(greatest(demand-reserved,0),greatest(physical::numeric-global_reserved,0));$old$,
      $new$      if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'Reservation admission requires READ COMMITTED isolation' using errcode = '25000'; end if;
      extra:=least(greatest(demand-reserved,0),greatest(physical::numeric-global_reserved
        -public.active_test_warehouse_hold_quantity(key,'10000000-0000-4000-8000-000000000002'::uuid),0));$new$)
  ) changes(signature,needle,replacement)
  loop
    definition := pg_catalog.pg_get_functiondef(change.signature::regprocedure);
    if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,change.needle,'')))
      <> pg_catalog.length(change.needle) then
      raise exception 'Unexpected reservation admission definition: %',change.signature using errcode='55000';
    end if;
    execute pg_catalog.replace(definition,change.needle,change.replacement);
  end loop;
end;
$migration$;
-- CREATE OR REPLACE preserves owners/ACLs. No grants, RLS, physical balances,
-- receipts, events, demand formulas, lifecycle policies or historical rows change.
-- Existing Product -> FG balance -> state locks serialize Test/Project admission.
-- Expiry/release/stock arrival never automatically tops up an existing reservation.
