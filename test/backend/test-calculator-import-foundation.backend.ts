import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { ReservationLocalTarget, reservationSnapshot, rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const file = "20261029120000_add_test_calculator_import_foundation.sql";
const files = readdirSync("supabase/migrations").filter(f => /^\d{14}_.+\.sql$/.test(f)).sort();
const historicalHashes = files.slice(0, 166).map(f => createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"));
const raw = "10000000-0000-4000-8000-000000000001";
const tables = ["test_calculation_imports", "test_calculation_import_releases"];

describe.skipIf(process.env.TEST_IMPORT_FOUNDATION_LOCAL !== "1")("Import foundation — positively owned disposable clone only", () => {
  const target = new ReservationLocalTarget(), name = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  let source: LocalReservationPool | undefined, pool: LocalReservationPool | undefined, created = false;
  let sourceBaseline: unknown, baseline: unknown, db: PoolClient;
  let priorSecurity: unknown;
  let transaction: ReturnType<typeof guardRollbackQueries> | undefined;
  let actor: { id: string; auth_user_id: string }, component: { id: string; name: string; serial_number: string; product_kind: string };
  async function snapshot(p: LocalReservationPool) { const c = await p.connect(); try { return await reservationSnapshot(c); } finally { c.release(true); } }
  async function existingSecurity() {
    return (await db.query(`select md5(jsonb_build_object(
      'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p where p.pronamespace='public'::regnamespace
        and p.proname not in ('reject_test_calculation_import_history_mutation','check_test_calculation_import_consistency')),
      'tables',(select jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) order by c.oid)
        from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')
        and c.relname not in ('test_calculation_imports','test_calculation_import_releases')),
      'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
      'roles',(select jsonb_agg(to_jsonb(r) order by r.oid) from pg_roles r),
      'memberships',(select jsonb_agg(to_jsonb(m) order by m.oid) from pg_auth_members m),
      'defaults',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d)
    )::text) digest`)).rows;
  }
  async function attempt(sql: string, args: unknown[] = []) {
    await db.query("savepoint attempt");
    try { const result = await db.query(sql, args); await db.query("release savepoint attempt"); return result; }
    catch (error) { await db.query("rollback to savepoint attempt; release savepoint attempt"); throw error; }
  }
  async function check() { await db.query("set constraints test_calculation_imports_consistent, test_calculation_import_releases_consistent immediate"); }
  async function fixture(held = "3", expired = false) {
    const calc = randomUUID(), item = randomUUID(), card = randomUUID(), output = randomUUID(), version = randomUUID();
    const label = `Import foundation ${calc}`;
    const serial = (await db.query("select lpad(n::text,3,'0') serial from generate_series(0,999) n where not exists(select 1 from public.products where serial_number=lpad(n::text,3,'0')) order by n limit 1")).rows[0].serial;
    await db.query(`insert into public.test_calculations(id,name,created_by_user_id,created_at,deadline_date,expires_at,request_id,submitted_payload,save_receipt)
      values($1,$2,$3,'2020-01-01','${expired ? "2020-01-02" : "2090-01-02"}',
        ('${expired ? "2020-01-03" : "2090-01-03"}'::timestamp at time zone 'Europe/Sarajevo'),$4,'{}','{}')`, [calc,label,actor.id,randomUUID()]);
    await db.query(`insert into public.test_calculation_items(id,calculation_id,product_id,product_name_snapshot,serial_number_snapshot,product_kind_snapshot,required_quantity,held_quantity,uncovered_quantity)
      values($1,$2,$3,$4,$5,$6,$7::bigint,$8::bigint,($7::bigint::numeric-$8::bigint::numeric)::bigint)`, [item,calc,component.id,component.name,component.serial_number,component.product_kind,"9223372036854775807",held]);
    if (held !== "0") await db.query("insert into public.test_calculation_holds(item_id,calculation_id,product_id,warehouse_id,quantity) values($1,$2,$3,$4,$5)", [item,calc,component.id,raw,held]);
    await db.query("set constraints test_calculation_items_hold_total, test_calculation_holds_item_total immediate; set constraints test_calculation_items_hold_total, test_calculation_holds_item_total deferred");
    await db.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,'PCB','pcb_finished_good',$4,$4)`, [output,serial,label,actor.id]);
    await db.query("insert into public.pcb_cards(id,name,output_product_id,created_by_user_id,updated_by_user_id) values($1,$2,$3,$4,$4)", [card,label,output,actor.id]);
    await db.query("insert into public.pcb_bom_versions(id,pcb_card_id,version_number,created_by_user_id) values($1,$2,1,$3)", [version,card,actor.id]);
    await db.query("insert into public.pcb_bom_items(bom_version_id,component_product_id,quantity_per_card) values($1,$2,9223372036854775807)", [version,component.id]);
    return { calc,item,card,output,version,serial,held,expired };
  }
  async function provenance(f: Awaited<ReturnType<typeof fixture>>, options: { request?: string; payload?: object; receipt?: object; auth?: string } = {}) {
    const id = randomUUID(), request = options.request ?? randomUUID();
    await attempt(`insert into public.test_calculation_imports(id,calculation_id,pcb_card_id,output_product_id,initial_bom_version_id,
      imported_by_user_id,auth_user_id,request_id,output_serial_number,submitted_payload,import_receipt)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id,f.calc,f.card,f.output,f.version,actor.id,options.auth ?? actor.auth_user_id,request,f.serial,
      options.payload ?? { auth_user_id:actor.auth_user_id,calculation_id:f.calc,serial_number:f.serial,confirmed:true },
      options.receipt ?? { import_id:id,calculation_id:f.calc,pcb_card_id:f.card,output_product_id:f.output,initial_bom_version_id:f.version,serial_number:f.serial }]);
    return { id,request };
  }
  async function release(f: Awaited<ReturnType<typeof fixture>>, id: string, quantity = f.held) {
    await db.query("insert into public.test_calculation_import_releases(import_id,calculation_id,item_id,product_id,warehouse_id,quantity) values($1,$2,$3,$4,$5,$6)", [id,f.calc,f.item,component.id,raw,quantity]);
  }
  beforeAll(async () => {
    if (process.env.TEST_IMPORT_FOUNDATION_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw Error("Owned-clone peer scope required");
    expect(files[166]).toBe(file);
    source = target.pool(); await target.acquire(source); sourceBaseline = await snapshot(source);
    await target.createTemporary(source,name); created = true; console.info(`Import foundation owned clone: ${name}`);
    target.copyIntoTemporary(name); pool = target.pool(name); const setup = await pool.connect();
    try {
      await setup.query("begin");
      try { for (let i=142;i<150;i++) { const f=files[i]!; await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8"));
        await setup.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)",[f.slice(0,14),f.slice(15,-4)]);
        if(i>=145) { await setup.query("commit"); await target.acceptClonePhase(setup,name,(i+1) as 146|147|148|149|150); if(i<149) await setup.query("begin"); }
      } } catch(e) { await setup.query("rollback"); throw e; }
      // Existing harness convention: SQL through 166, phase-150 ledger retained
      // for the pinned session guard. Never migrate/reset source postgres.
      await setup.query("begin");
      try { for (const f of files.slice(150,166)) await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8")); await setup.query("commit"); }
      catch(e) { await setup.query("rollback"); throw e; }
      actor = (await setup.query("select id,auth_user_id from public.user_profiles where is_active and is_admin order by id limit 1")).rows[0];
      component = (await setup.query("select id,name,serial_number,product_kind from public.products where is_active and product_kind='component' order by id limit 1")).rows[0];
      if(!actor || !component) throw Error("Existing local identity/component fixture required");
      baseline = await reservationSnapshot(setup);
    } finally { setup.release(true); }
  });
  beforeEach(async context => {
    await target.assertQuiet(); transaction = guardRollbackQueries(await pool!.connect(),context.signal); db = transaction.client;
    await db.query("begin; set local statement_timeout='15s'; set local lock_timeout='3s'");
    priorSecurity = await existingSecurity();
    await db.query(readFileSync(`supabase/migrations/${file}`,"utf8"));
  });
  afterEach(async () => {
    if(transaction) { const t=transaction; transaction=undefined; await rollbackReservationTransactions([t]); }
    if(pool && baseline) expect(await snapshot(pool)).toEqual(baseline);
  });
  afterAll(async () => {
    try {
      if(pool) await pool.end();
      if(source && sourceBaseline) expect(await snapshot(source)).toEqual(sourceBaseline);
      if(created && source) { await target.dropTemporary(source,name); expect((await source.query("select exists(select 1 from pg_database where datname=$1) present",[name])).rows[0].present).toBe(false); console.info("Owned import clone removed; source data/security/sequence manifest unchanged"); }
      expect(files.slice(0,166).map(f => createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"))).toEqual(historicalHashes);
    } finally { await target.release(); if(source) await source.end(); }
  });

  it("denies real application-role table access and private helper execution, including Admin JWT", async () => {
    for(const table of tables) {
      expect((await db.query("select relrowsecurity rls from pg_class where oid=$1::regclass",[`public.${table}`])).rows[0].rls).toBe(true);
      for(const role of ["anon","authenticated","service_role"]) {
        expect((await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed",[role,`public.${table}`])).rows[0].allowed).toBe(false);
        for(const sql of [`select * from public.${table}`,`insert into public.${table} default values`,`delete from public.${table}`])
          await expect(attempt(`select set_config('request.jwt.claim.sub','${actor.auth_user_id}',true); set local role ${role}; ${sql}`)).rejects.toMatchObject({code:"42501"});
        for(const fn of ["reject_test_calculation_import_history_mutation","check_test_calculation_import_consistency"])
          expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,`public.${fn}()`])).rows[0].allowed).toBe(false);
      }
    }
    expect((await db.query("select count(*)::int n from pg_policy where polrelid in ('public.test_calculation_imports'::regclass,'public.test_calculation_import_releases'::regclass)")).rows[0].n).toBe(0);
  });
  it("validates exact bigint BOM and full/partial/zero saved allocations without activating releases", async () => {
    for(const held of ["9223372036854775807","9007199254740993","0"]) {
      const f=await fixture(held), before=(await db.query("select public.active_test_warehouse_hold_quantity($1,$2)::text n",[component.id,raw])).rows;
      const p=await provenance(f); if(held!=="0") await release(f,p.id); await check();
      expect((await db.query("select public.active_test_warehouse_hold_quantity($1,$2)::text n",[component.id,raw])).rows).toEqual(before);
      expect((await db.query("select quantity::text n from public.test_calculation_import_releases where import_id=$1",[p.id])).rows).toEqual(held==="0"?[]:[{n:held}]);
      await db.query("set constraints test_calculation_imports_consistent, test_calculation_import_releases_consistent deferred");
    }
  });
  it("permits expired provenance with zero release records but rejects expired release allocation", async () => {
    const f=await fixture("3",true),p=await provenance(f); await check();
    await expect(attempt("insert into public.test_calculation_import_releases values($1,$2,$3,$4,$5,3)",[p.id,f.calc,f.item,component.id,raw])).rejects.toMatchObject({code:"23514"});
  });
  it("enforces source/request/destination uniqueness and exact hold uniqueness", async () => {
    const f=await fixture(),p=await provenance(f); await release(f,p.id); await check();
    await expect(provenance(f)).rejects.toMatchObject({code:"23505",constraint:"test_calculation_imports_calculation_id_key"});
    const other=await fixture();
    await expect(provenance(other,{request:p.request})).rejects.toMatchObject({code:"23505",constraint:"test_calculation_imports_request_id_key"});
    await expect(attempt("insert into public.test_calculation_import_releases values($1,$2,$3,$4,$5,3)",[p.id,f.calc,f.item,component.id,raw])).rejects.toMatchObject({code:"23505"});
  });
  it("rejects nonpositive/overflow quantities and cross-Test allocation ownership", async () => {
    const f=await fixture(),other=await fixture(),p=await provenance(f);
    for(const q of ["0","-1","9223372036854775808"])
      await expect(attempt("insert into public.test_calculation_import_releases values($1,$2,$3,$4,$5,$6)",[p.id,f.calc,f.item,component.id,raw,q])).rejects.toMatchObject({code:q.length>19||q==="9223372036854775808"?"22003":"23514"});
    await expect(attempt("insert into public.test_calculation_import_releases values($1,$2,$3,$4,$5,3)",[p.id,other.calc,other.item,component.id,raw])).rejects.toMatchObject({code:"23503"});
    await release(f,p.id,"2"); await expect(check()).rejects.toMatchObject({code:"23514"});
  });
  it("rejects an unconfirmed canonical payload", async () => {
    const f=await fixture(); await provenance(f,{payload:{confirmed:false},receipt:{}});
    await expect(check()).rejects.toMatchObject({code:"23514"});
  });
  it("rejects missing active release allocations with otherwise valid provenance", async () => {
    const f=await fixture(); await provenance(f); await expect(check()).rejects.toMatchObject({code:"23514"});
  });
  it("rejects a mismatched receipt independently of payload and release state", async () => {
    const f=await fixture("0"); await provenance(f,{receipt:{}}); await expect(check()).rejects.toMatchObject({code:"23514"});
  });
  it("rejects a missing Auth identity and a mismatched profile/Auth pair", async () => {
    const f=await fixture("0"); await expect(provenance(f,{auth:randomUUID()})).rejects.toMatchObject({code:"23503"});
    const other=(await db.query("select auth_user_id from public.user_profiles where id<>$1 order by id limit 1",[actor.id])).rows[0];
    if(!other) throw Error("Second local identity required");
    await provenance(f,{auth:other.auth_user_id}); await expect(check()).rejects.toMatchObject({code:"23514"});
  });
  it("rejects wrong destination linkage even when all destination FKs independently exist", async () => {
    const f=await fixture("0"), other=await fixture("0");
    await provenance({...f,output:other.output}); await expect(check()).rejects.toMatchObject({code:"23514"});
  });
  it("rejects BOM mismatch", async () => {
    const f=await fixture("0"); await db.query("update public.pcb_bom_items set quantity_per_card=1 where bom_version_id=$1",[f.version]);
    await provenance(f); await expect(check()).rejects.toMatchObject({code:"23514"});
  });
  it("keeps both new provenance tables and original Test history immutable", async () => {
    const f=await fixture(),p=await provenance(f); await release(f,p.id); await check();
    for(const table of tables) for(const sql of [`update public.${table} set ${table===tables[0]?"request_id=request_id":"quantity=quantity"}`,`delete from public.${table}`,`truncate public.${table}`])
      await expect(attempt(sql)).rejects.toMatchObject({code:sql.startsWith("truncate")&&table===tables[0]?"0A000":"55000"});
    await expect(attempt("update public.test_calculations set name=name where id=$1",[f.calc])).rejects.toMatchObject({code:"55000"});
    await expect(attempt("delete from public.test_calculation_holds where item_id=$1",[f.item])).rejects.toMatchObject({code:"55000"});
  });
  it("preserves existing permissions/security and creates no operational RPC or accounting writes", async () => {
    const current = await reservationSnapshot(db), old = baseline as Record<string,unknown>;
    for(const [table,value] of Object.entries(old)) if(table!=="security") expect((current as Record<string,unknown>)[table]).toEqual(value);
    expect(await existingSecurity()).toEqual(priorSecurity);
    expect((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and proname like '%test_calculation_import%' and prosecdef")).rows[0].n).toBe(0);
    expect((await db.query("select count(*)::int n from public.permission_definitions")).rows[0].n).toBe(41);
  });
});
