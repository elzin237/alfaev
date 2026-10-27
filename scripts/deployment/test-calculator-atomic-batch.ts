import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

// Pure preparation module: no connection, command execution or automatic deployment.
// Execute the generated BODY only with psql -X -v ON_ERROR_STOP=1
// --single-transaction --file=<reviewed-batch-file> in a separately verified DEV context.
export const TEST_CALCULATOR_MIGRATIONS = [
  ["20261027100000_add_test_calculator_foundation.sql", "e8d7b802a4b828cc685ddaaafc33371fa6d8c79ca76cf454fdcc80c6fb603684"],
  ["20261027110000_add_test_calculator_search_and_preview.sql", "1a11b4e6a66c860be33f4fbc526fc38c488b0adc46d94359d0bf98ea00e990d7"],
  ["20261027120000_add_atomic_test_calculator_save.sql", "f1edf06661223a294e5a25002320000a7d065fca3ba19c463ee130b9f8dcc18d"],
  ["20261027130000_protect_test_calculator_warehouse_holds.sql", "2372dbf1bcf5956eb7c5a38fb1f74425af4a7a3339287be0581ef4549f10efd3"],
  ["20261027140000_protect_test_holds_in_production_plans.sql", "85ec4decbd570a7e5784617caec96a341ee94a230d1b13044007d8ae77b679c7"],
  ["20261027150000_protect_test_holds_in_project_reservation_admission.sql", "0b689ad1c11fb93f4e79861d240beb4df0a44406f86b52deab2fe74e2597fe05"],
  ["20261027160000_add_expiry_aware_inventory_test_commitments.sql", "c6562a7c14d48c7752709c8c0e3a748dd1c064721c20c31f3f538ebbe1bf80fc"],
  ["20261027170000_add_test_calculation_history_reads.sql", "a901832f3f1424b3aad3a19f232c5fb836e453028e924585a29fe0f68dfb4533"],
] as const;
// DEV has this pre-existing Supabase event-trigger helper; source-only local clones
// may not. Exclude only its exact, validated identity, never a name pattern or all
// event_trigger functions. It is not one of the application RPCs counted below.
function securityInventoryGuard(expected: 190 | 197) {
  return `
do $inventory$ declare platform oid := pg_catalog.to_regprocedure('public.rls_auto_enable()'); begin
  if platform is not null then
    if not exists (
      select 1 from pg_catalog.pg_proc p join pg_catalog.pg_language l on l.oid=p.prolang
      where p.oid=platform and p.pronamespace='public'::regnamespace
        and p.proowner='postgres'::regrole and p.prorettype='pg_catalog.event_trigger'::regtype
        and p.prokind='f' and p.pronargs=0 and p.prosecdef and l.lanname='plpgsql'
        and p.proconfig=array['search_path=pg_catalog']::text[] and p.proacl is null
    ) or (select count(*) from pg_catalog.pg_event_trigger where evtfoid=platform) <> 1
      or not exists (select 1 from pg_catalog.pg_event_trigger
        where evtname='ensure_rls' and evtfoid=platform and evtowner='postgres'::regrole
          and evtevent='ddl_command_end' and evtenabled='O'
          and evttags @> array['CREATE TABLE','CREATE TABLE AS','SELECT INTO']::text[]
          and cardinality(evttags)=3)
      then raise exception 'Unverified platform event-trigger identity'; end if;
  elsif exists(select 1 from pg_catalog.pg_event_trigger where evtname='ensure_rls') then
    raise exception 'Unexpected platform event-trigger wiring';
  end if;
  if (select count(*) from pg_catalog.pg_proc
      where pronamespace='public'::regnamespace and prosecdef
        and (platform is null or oid <> platform)) <> ${expected}
    then raise exception 'Unexpected application SECURITY DEFINER inventory (expected ${expected})'; end if;
end $inventory$;
`;
}
export const testCalculatorBatchPreamble = `
set local statement_timeout='60s'; set local lock_timeout='5s'; set local idle_in_transaction_session_timeout='15s';
set local standard_conforming_strings=on;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('alfaev-test-calculator-151-158',0));
do $guard$ begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 150
    or (select max(version) from supabase_migrations.schema_migrations) <> '20261026120000'
    or pg_catalog.to_regprocedure('public.save_test_calculation(uuid,text,jsonb,date)') is not null
    then raise exception 'Atomic Test batch requires exact clean migration 150'; end if;
end $guard$;
${securityInventoryGuard(190)}
`;
export const testCalculatorBatchPostamble = `
${securityInventoryGuard(197)}
do $guard$ begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 158
    or (select max(version) from supabase_migrations.schema_migrations) <> '20261027170000'
    or not pg_catalog.has_function_privilege('authenticated','public.save_test_calculation(uuid,text,jsonb,date)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','public.save_test_calculation(uuid,text,jsonb,date)','EXECUTE')
    or pg_catalog.has_function_privilege('service_role','public.save_test_calculation(uuid,text,jsonb,date)','EXECUTE')
    or (select count(*) from public.test_calculations) <> 0
    then raise exception 'Atomic Test batch final verification failed'; end if;
end $guard$;
`;
export function testCalculatorBatchSteps() {
  const files = readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort();
  if (JSON.stringify(files.slice(150)) !== JSON.stringify(TEST_CALCULATOR_MIGRATIONS.map(([f]) => f))) throw new Error("Unexpected migration scope");
  return TEST_CALCULATOR_MIGRATIONS.map(([file, hash]) => {
    const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
    if (createHash("sha256").update(sql).digest("hex") !== hash) throw new Error(`Frozen migration mismatch: ${file}`);
    if (/^\s*(?:commit|rollback|vacuum|create database|alter system)\b/im.test(sql) || /\bconcurrently\b/i.test(sql) || /^\s*\\/m.test(sql)) throw new Error("Non-atomic migration statement");
    const version = file.slice(0, 14), name = file.slice(15, -4);
    // Store the original approved SQL as one ledger statement element, not a rewritten migration.
    const literal = `'${sql.replace(/'/g, "''")}'`;
    return { file, sql, ledger: `insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${literal}]::text[]);` };
  });
}
export function buildTestCalculatorAtomicBatch() {
  return [testCalculatorBatchPreamble, ...testCalculatorBatchSteps().flatMap(step => [step.sql, step.ledger]), testCalculatorBatchPostamble].join("\n");
}
