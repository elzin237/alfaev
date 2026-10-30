import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { ReservationLocalTarget, reservationSnapshot, rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const file = "20261029130000_make_test_commitments_release_aware.sql";
const files = readdirSync("supabase/migrations").filter(f => /^\d{14}_.+\.sql$/.test(f)).sort();
const historicalHashes = files.slice(0, 167).map(f => createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"));
const raw = "10000000-0000-4000-8000-000000000001";
const tables = ["test_calculation_imports", "test_calculation_import_releases"];

describe.skipIf(process.env.TEST_RELEASE_AWARE_LOCAL !== "1")("Release-aware commitments — positively owned disposable clone only", () => {
  const target = new ReservationLocalTarget(), name = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  let source: LocalReservationPool | undefined, pool: LocalReservationPool | undefined, created = false;
  let sourceBaseline: unknown, baseline: unknown, db: PoolClient;
  let priorSecurity: unknown;
  let priorContracts: unknown;
  let transaction: ReturnType<typeof guardRollbackQueries> | undefined;
  const branches: ReturnType<typeof guardRollbackQueries>[] = [];
  let actor: { id: string; auth_user_id: string }, component: { id: string; name: string; serial_number: string; product_kind: string };
  async function snapshot(p: LocalReservationPool) { const c = await p.connect(); try { return await reservationSnapshot(c); } finally { c.release(true); } }
  async function existingSecurity() {
    return (await db.query(`select md5(jsonb_build_object(
      'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p where p.pronamespace='public'::regnamespace
        and p.proname not in ('effective_test_hold_quantity','active_test_holds_at','active_test_warehouse_hold_quantity','get_production_free_warehouse_quantity_at','preview_test_calculation','save_test_calculation','get_inventory_test_commitments')),
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
  async function fixture(held = "3", expired = false, warehouse = raw) {
    const calc = randomUUID(), item = randomUUID(), card = randomUUID(), output = randomUUID(), version = randomUUID();
    const label = `Release-aware commitments ${calc}`;
    const serial = (await db.query("select lpad(n::text,3,'0') serial from generate_series(0,999) n where not exists(select 1 from public.products where serial_number=lpad(n::text,3,'0')) order by n limit 1")).rows[0].serial;
    await db.query(`insert into public.test_calculations(id,name,created_by_user_id,created_at,deadline_date,expires_at,request_id,submitted_payload,save_receipt)
      values($1,$2,$3,'2020-01-01','${expired ? "2020-01-02" : "2090-01-02"}',
        ('${expired ? "2020-01-03" : "2090-01-03"}'::timestamp at time zone 'Europe/Sarajevo'),$4,'{}','{}')`, [calc,label,actor.id,randomUUID()]);
    await db.query(`insert into public.test_calculation_items(id,calculation_id,product_id,product_name_snapshot,serial_number_snapshot,product_kind_snapshot,required_quantity,held_quantity,uncovered_quantity)
      values($1,$2,$3,$4,$5,$6,$7::bigint,$8::bigint,($7::bigint::numeric-$8::bigint::numeric)::bigint)`, [item,calc,component.id,component.name,component.serial_number,component.product_kind,"9223372036854775807",held]);
    if (held !== "0") await db.query("insert into public.test_calculation_holds(item_id,calculation_id,product_id,warehouse_id,quantity) values($1,$2,$3,$4,$5)", [item,calc,component.id,warehouse,held]);
    await db.query("set constraints test_calculation_items_hold_total, test_calculation_holds_item_total immediate; set constraints test_calculation_items_hold_total, test_calculation_holds_item_total deferred");
    await db.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,'PCB','pcb_finished_good',$4,$4)`, [output,serial,label,actor.id]);
    await db.query("insert into public.pcb_cards(id,name,output_product_id,created_by_user_id,updated_by_user_id) values($1,$2,$3,$4,$4)", [card,label,output,actor.id]);
    await db.query("insert into public.pcb_bom_versions(id,pcb_card_id,version_number,created_by_user_id) values($1,$2,1,$3)", [version,card,actor.id]);
    await db.query("insert into public.pcb_bom_items(bom_version_id,component_product_id,quantity_per_card) values($1,$2,9223372036854775807)", [version,component.id]);
    return { calc,item,card,output,version,serial,held,expired,warehouse };
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
    await db.query("insert into public.test_calculation_import_releases(import_id,calculation_id,item_id,product_id,warehouse_id,quantity) values($1,$2,$3,$4,$5,$6)", [id,f.calc,f.item,component.id,f.warehouse,quantity]);
  }
  beforeAll(async () => {
    if (process.env.TEST_RELEASE_AWARE_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw Error("Owned-clone peer scope required");
    expect(files[167]).toBe(file);
    source = target.pool(); await target.acquire(source); sourceBaseline = await snapshot(source);
    await target.createTemporary(source,name); created = true; console.info(`Release-aware commitments owned clone: ${name}`);
    target.copyIntoTemporary(name); pool = target.pool(name); const setup = await pool.connect();
    try {
      await setup.query("begin");
      try { for (let i=142;i<150;i++) { const f=files[i]!; await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8"));
        await setup.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)",[f.slice(0,14),f.slice(15,-4)]);
        if(i>=145) { await setup.query("commit"); await target.acceptClonePhase(setup,name,(i+1) as 146|147|148|149|150); if(i<149) await setup.query("begin"); }
      } } catch(e) { await setup.query("rollback"); throw e; }
      // Existing harness convention: SQL through 167, phase-150 ledger retained
      // for the pinned session guard. Never migrate/reset source postgres.
      await setup.query("begin");
      try { for (const f of files.slice(150,167)) await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8")); await setup.query("commit"); }
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
    priorContracts=(await db.query("select jsonb_agg(to_jsonb(p)-'prosrc' order by p.oid) contracts from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=any($1::text[])",[["active_test_warehouse_hold_quantity","get_production_free_warehouse_quantity_at","preview_test_calculation","save_test_calculation","get_inventory_test_commitments"]])).rows;
    await db.query(readFileSync(`supabase/migrations/${file}`,"utf8"));
    const id=randomUUID();
    const serial=(await db.query("select n::text serial from generate_series(8000000,8999999) n where not exists(select 1 from public.products where serial_number=n::text) order by n limit 1")).rows[0].serial;
    component=(await db.query("insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id) values($1,$2,$3,'Release test','component',$4,$4) returning id,name,serial_number,product_kind",[id,serial,`Release ${id}`,actor.id])).rows[0];
  });
  afterEach(async () => {
    if(transaction) { const t=transaction; transaction=undefined; await rollbackReservationTransactions([t,...branches.splice(0)]); }
    if(pool && baseline) expect(await snapshot(pool)).toEqual(baseline);
  });
  afterAll(async () => {
    try {
      if(pool) await pool.end();
      if(source && sourceBaseline) expect(await snapshot(source)).toEqual(sourceBaseline);
      if(created && source) { await target.dropTemporary(source,name); expect((await source.query("select exists(select 1 from pg_database where datname=$1) present",[name])).rows[0].present).toBe(false); console.info("Owned import clone removed; source data/security/sequence manifest unchanged"); }
      expect(files.slice(0,167).map(f => createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"))).toEqual(historicalHashes);
    } finally { await target.release(); if(source) await source.end(); }
  });

  const fg="10000000-0000-4000-8000-000000000002", customs="10000000-0000-4000-8000-000000000003";
  async function stock(quantity=40, warehouses=[raw,customs,fg]) {
    const supplier=await createSupplierSourceFixture(db,{profileId:actor.id,authUserId:actor.auth_user_id},component.id);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);
    for(const warehouse of warehouses) await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add',$3,'Owned release fixture',$4)",[component.id,warehouse,quantity,supplier.productSupplierId]);
  }
  const total=async(warehouse=raw)=>(await db.query("select public.active_test_warehouse_hold_quantity($1,$2)::text n",[component.id,warehouse])).rows[0].n;
  async function convert(f:Awaited<ReturnType<typeof fixture>>) {const p=await provenance(f);if(f.held!=="0"&&!f.expired)await release(f,p.id);await check();await db.query("set constraints test_calculation_imports_consistent, test_calculation_import_releases_consistent deferred");return p;}
  async function inventory(warehouse=raw) {return (await db.query("select * from public.get_inventory_test_commitments($1,null) where product_id=$2",[warehouse,component.id])).rows[0];}
  async function accounting() {return (await db.query(`select jsonb_build_object(
    'balances',(select jsonb_agg(to_jsonb(b) order by b.warehouse_id) from public.inventory_balances b where b.product_id=$1),
    'lots',(select jsonb_agg(to_jsonb(l) order by l.id) from public.inventory_source_lots l where l.product_id=$1),
    'movements',(select jsonb_agg(to_jsonb(m) order by m.id) from public.inventory_movements m where m.product_id=$1),
    'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from public.inventory_source_allocations a
      join public.inventory_source_lots l on l.id=a.source_lot_id where l.product_id=$1)) value`,[component.id])).rows;}
  it("uses exact nonnegative partial/full/zero/expired arithmetic without authorizing partial conversions",async()=>{
    const cases=[["20","5","15"],["20","20","0"],["20","30","0"],["0","0","0"],["9223372036854775807","1","9223372036854775806"]];
    for(const [original,released,expected] of cases) expect((await db.query("select public.effective_test_hold_quantity($1,$2,'2090-01-01',clock_timestamp())::text n",[original,released])).rows[0].n).toBe(expected);
    expect((await db.query("select public.effective_test_hold_quantity(20,5,statement_timestamp(),statement_timestamp())::text n")).rows[0].n).toBe("0");
  });
  it("keeps two Tests isolated, original history intact and release effects nonphysical",async()=>{
    await stock();const a=await fixture("20"),b=await fixture("15");expect(await total()).toBe("35");
    const before=await accounting();await convert(a);expect(await total()).toBe("15");expect(await accounting()).toEqual(before);
    expect((await db.query("select quantity::text n from public.test_calculation_holds where item_id=any($1::uuid[]) order by quantity",[[a.item,b.item]])).rows).toEqual([{n:"15"},{n:"20"}]);
    expect((await inventory()).committed_to_tests).toBe("15");
  });
  it("handles three warehouses and excludes fully released holds from next expiry",async()=>{
    await stock();const a=await fixture("3",false,raw),b=await fixture("4",false,customs),c=await fixture("5",false,fg);
    expect((await inventory()).committed_to_tests).toBe("7");expect((await inventory(customs)).committed_to_tests).toBe("4");expect(await total(fg)).toBe("5");
    expect(await inventory(fg)).toBeUndefined(); // Ordinary components are not FG listing members.
    await convert(a);await convert(b);await convert(c);
    for(const warehouse of [raw,customs,fg])expect(await total(warehouse)).toBe("0");
    for(const warehouse of [raw,customs])expect(await inventory(warehouse)).toMatchObject({committed_to_tests:"0",next_expiry:null});
  });
  it("keeps expired/zero Tests nonprotecting and bigint aggregates lossless",async()=>{
    await fixture("9",true);await convert(await fixture("0"));expect(await total()).toBe("0");
    const a=await fixture("9223372036854775807"),b=await fixture("9007199254740993");
    expect(await total()).toBe("9232379236109516800");await convert(a);expect(await total()).toBe("9007199254740993");await convert(b);expect(await total()).toBe("0");
  });
  it("updates real Preview and Save admission without changing physical stock",async()=>{
    await stock();const f=await fixture("30");const items=[{product_id:component.id,quantity:"120"}];
    const preview=async()=>(await db.query("select * from public.preview_test_calculation($1)",[JSON.stringify(items)])).rows[0];
    expect((await preview()).reservable_quantity).toBe("90");await convert(f);expect((await preview()).reservable_quantity).toBe("120");
    const before=await accounting();const saved=(await db.query("select public.save_test_calculation($1,'Release admission',$2,'2090-01-01') value",[randomUUID(),JSON.stringify(items)])).rows[0].value;
    expect(saved.items[0].held_quantity).toBe("120");expect(await accounting()).toEqual(before);
  });
  it("retains debit protection until release and then allows only genuinely free FIFO-backed stock",async()=>{
    await stock();const f=await fixture("30");
    const sql="select * from public.adjust_inventory_warehouse($1,$2,'remove',11,'Owned debit assertion',null)";
    await expect(attempt(sql,[component.id,raw])).rejects.toMatchObject({code:"IVB02"});
    const before=await accounting();await convert(f);expect(await accounting()).toEqual(before);
    await db.query(sql,[component.id,raw]);
    expect((await db.query("select quantity::text n from public.inventory_balances where product_id=$1 and warehouse_id=$2",[component.id,raw])).rows[0].n).toBe("29");
    expect((await db.query("select sum(remaining_quantity)::text n from public.inventory_source_lots where product_id=$1 and warehouse_id=$2",[component.id,raw])).rows[0].n).toBe("29");
  });
  it("updates production capacity and WO shortages through the existing coalesced release queue",async()=>{
    await stock();const f=await fixture("30");
    const wo=(await db.query("select * from public.create_draft_work_order()")).rows[0];
    await db.query("insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id) values($1,$2,110,$3)",[wo.work_order_id,component.id,actor.id]);
    await db.query("set constraints all immediate; set constraints all deferred");
    const availability=async()=>(await db.query("select public.get_work_order_material_availability($1) value",[wo.work_order_id])).rows[0].value.materials[0];
    expect(await availability()).toMatchObject({eligible_quantity:"90",missing_quantity:"20"});
    expect((await db.query("select public.get_production_eligible_quantity($1)::text n",[component.id])).rows[0].n).toBe("90");
    const before=await accounting();await convert(f);await db.query("set constraints all immediate; set constraints all deferred");
    expect(await availability()).toMatchObject({eligible_quantity:"120",missing_quantity:"0"});
    expect((await db.query("select resolved_at is not null resolved from public.work_order_material_shortage_episodes where work_order_id=$1 and product_id=$2",[wo.work_order_id,component.id])).rows[0].resolved).toBe(true);
    expect((await db.query("select count(*)::int n from public.work_order_material_shortage_events e join public.work_order_material_shortage_episodes s on s.id=e.episode_id where s.work_order_id=$1 and e.event_type='resolved'",[wo.work_order_id])).rows[0].n).toBe(1);
    expect((await db.query("select sum(allocated_quantity)::text n from public.get_work_order_warehouse_source_allocation_plan($1)",[wo.work_order_id])).rows[0].n).toBe("110");
    expect(await accounting()).toEqual(before);
  });
  it("preserves private roles/RLS and public consumer signatures/grants",async()=>{
    expect(await existingSecurity()).toEqual(priorSecurity);
    expect((await db.query("select jsonb_agg(to_jsonb(p)-'prosrc' order by p.oid) contracts from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=any($1::text[])",[["active_test_warehouse_hold_quantity","get_production_free_warehouse_quantity_at","preview_test_calculation","save_test_calculation","get_inventory_test_commitments"]])).rows).toEqual(priorContracts);
    for(const role of ["anon","authenticated","service_role"]) {
      for(const fn of ["public.active_test_holds_at(timestamptz,uuid[])","public.effective_test_hold_quantity(bigint,bigint,timestamptz,timestamptz)"])
        expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,fn])).rows[0].allowed).toBe(false);
      for(const table of tables)expect((await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,`public.${table}`])).rows[0].allowed).toBe(false);
    }
    await expect(attempt("set local role authenticated; select * from public.active_test_holds_at(clock_timestamp())")).rejects.toMatchObject({code:"42501"});
    await expect(attempt("set local role anon; select * from public.preview_test_calculation('[]')")).rejects.toMatchObject({code:"42501"});
  });
  it("keeps linked FG Inventory and manual Project admission aligned with effective releases",async()=>{
    const output=(await fixture("0")).output;
    component=(await db.query("select id,name,serial_number,product_kind from public.products where id=$1",[output])).rows[0];
    await stock(40,[fg]);const f=await fixture("30",false,fg);
    expect((await inventory(fg)).committed_to_tests).toBe("30");
    const project=randomUUID(),group=randomUUID();
    await db.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,$2,'Local',current_date,current_date+1,$3,$3)",[project,`Release ${project}`,actor.id]);
    await db.query("insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id) values($1,$2,'Release group',$3,$3)",[group,project,actor.id]);
    await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,40,$3,$3)",[group,component.id,actor.id]);
    const reserve="select * from public.reserve_finished_goods_for_project($1,$2,$3::bigint,0,$4)";
    await expect(attempt(reserve,[project,component.id,"11",randomUUID()])).rejects.toMatchObject({code:"FGR07"});
    const before=await accounting();await convert(f);expect(await inventory(fg)).toMatchObject({committed_to_tests:"0",next_expiry:null});
    await db.query(reserve,[project,component.id,"40",randomUUID()]);expect(await accounting()).toEqual(before);
    expect((await db.query("select public.get_production_eligible_quantity($1)::text n",[component.id])).rows[0].n).toBe("0");
  });
  it("updates automatic FG admission only on an authorized requirement edit, not on release alone",async()=>{
    const output=(await fixture("0")).output;
    component=(await db.query("select id,name,serial_number,product_kind from public.products where id=$1",[output])).rows[0];
    await stock(40,[fg]);const f=await fixture("30",false,fg),project=randomUUID(),group=randomUUID();
    await db.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,$2,'Local',current_date,current_date+1,$3,$3)",[project,`Auto release ${project}`,actor.id]);
    await db.query("insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id) values($1,$2,'Auto release group',$3,$3)",[group,project,actor.id]);
    const mutation="select public.mutate_project_requirement($1,$2,$3,$4,$5,$6,$7::bigint,$8,$9::bigint) value";
    const created=(await db.query(mutation,[randomUUID(),"create",project,group,null,component.id,"40",null,null])).rows[0].value;
    expect(created.affected_products[0]).toMatchObject({reserved_quantity:"10",uncovered_demand:"30"});
    const before=await accounting();await convert(f);
    expect((await db.query("select reserved_quantity::text n from public.finished_goods_project_reservations where project_id=$1 and product_id=$2",[project,component.id])).rows[0].n).toBe("10");
    const updated=(await db.query(mutation,[randomUUID(),"update",project,group,created.component_id,component.id,"41",component.id,"40"])).rows[0].value;
    expect(updated.affected_products[0]).toMatchObject({reserved_quantity:"40",uncovered_demand:"1"});
    expect(await accounting()).toEqual(before);
  });
  // Last case commits fixtures ONLY inside this positively owned disposable clone.
  // The original source is still compared byte-for-byte and the whole clone removed.
  it("serializes a production plan after release commit and keeps concurrent reads snapshot-correct",async()=>{
    await stock();const f=await fixture("30");const wo=(await db.query("select * from public.create_draft_work_order()")).rows[0];
    await db.query("insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id) values($1,$2,110,$3)",[wo.work_order_id,component.id,actor.id]);
    await db.query("commit");baseline=await reservationSnapshot(db);
    const branch=guardRollbackQueries(await pool!.connect());branches.push(branch);
    await branch.client.query("begin; set local lock_timeout='5s'");
    const pid=(await branch.client.query("select pg_backend_pid() pid")).rows[0].pid;
    await db.query("begin");await db.query("select id from public.products where id=$1 for update",[component.id]);
    const before=await accounting();await convert(f);
    expect((await branch.client.query("select public.get_production_eligible_quantity($1)::text n",[component.id])).rows[0].n).toBe("90");
    const plan=branch.client.query("select sum(allocated_quantity)::text n from public.get_work_order_warehouse_source_allocation_plan($1)",[wo.work_order_id]);
    // Attach rejection handling immediately, then inspect the actual backend lock.
    const observedPlan=plan.then(r=>({r}),e=>({e}));let waiting=false;
    for(let i=0;i<30;i++){waiting=(await db.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting===true;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
    expect(waiting).toBe(true);await db.query("commit");const result=await observedPlan;
    if("e" in result)throw result.e;expect(result.r.rows[0].n).toBe("110");expect(await accounting()).toEqual(before);
    baseline=await reservationSnapshot(db);await db.query("begin");
  });
});
