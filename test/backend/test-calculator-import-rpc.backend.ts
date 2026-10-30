import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { ReservationLocalTarget, reservationSnapshot, rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const file = "20261029140000_add_atomic_test_calculator_import.sql";
const files = readdirSync("supabase/migrations").filter(f => /^\d{14}_.+\.sql$/.test(f)).sort();
const historicalHashes = files.slice(0, 168).map(f => createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"));
const raw = "10000000-0000-4000-8000-000000000001";
const tables = ["test_calculation_imports", "test_calculation_import_releases"];

describe.skipIf(process.env.TEST_IMPORT_RPC_LOCAL !== "1")("Atomic Test import — positively owned disposable clone only", () => {
  const target = new ReservationLocalTarget(), name = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  let source: LocalReservationPool | undefined, pool: LocalReservationPool | undefined, created = false;
  let sourceBaseline: unknown, baseline: unknown, db: PoolClient;
  let priorSecurity: unknown;
  let priorContracts: unknown;
  let transaction: ReturnType<typeof guardRollbackQueries> | undefined;
  const branches: ReturnType<typeof guardRollbackQueries>[] = [];
  let member: { id: string; auth_user_id: string };
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
  async function fixture(held = "3", expired = false, warehouse = raw, required = "5", suppliedName?: string, allocations?: {warehouse:string;quantity:string}[]) {
    const calc = randomUUID(), item = randomUUID();
    const label = suppliedName ?? `Atomic Test import ${calc}`;
    const serial = (await db.query("select lpad(n::text,3,'0') serial from generate_series(0,999) n where not exists(select 1 from public.products where serial_number=lpad(n::text,3,'0')) order by n limit 1")).rows[0].serial;
    await db.query(`insert into public.test_calculations(id,name,created_by_user_id,created_at,deadline_date,expires_at,request_id,submitted_payload,save_receipt)
      values($1,$2,$3,'2020-01-01','${expired ? "2020-01-02" : "2090-01-02"}',
        ('${expired ? "2020-01-03" : "2090-01-03"}'::timestamp at time zone 'Europe/Sarajevo'),$4,'{}','{}')`, [calc,label,actor.id,randomUUID()]);
    await db.query(`insert into public.test_calculation_items(id,calculation_id,product_id,product_name_snapshot,serial_number_snapshot,product_kind_snapshot,required_quantity,held_quantity,uncovered_quantity)
      values($1,$2,$3,$4,$5,$6,$7::bigint,$8::bigint,($7::bigint::numeric-$8::bigint::numeric)::bigint)`, [item,calc,component.id,component.name,component.serial_number,component.product_kind,required,held]);
    for(const allocation of allocations ?? (held === "0" ? [] : [{warehouse,quantity:held}]))
      await db.query("insert into public.test_calculation_holds(item_id,calculation_id,product_id,warehouse_id,quantity) values($1,$2,$3,$4,$5)", [item,calc,component.id,allocation.warehouse,allocation.quantity]);
    await db.query("set constraints test_calculation_items_hold_total, test_calculation_holds_item_total immediate; set constraints test_calculation_items_hold_total, test_calculation_holds_item_total deferred");
    return { calc,item,serial,held,expired,warehouse,required,name:label };
  }
  beforeAll(async () => {
    if (process.env.TEST_IMPORT_RPC_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw Error("Owned-clone peer scope required");
    expect(files[168]).toBe(file);
    source = target.pool(); await target.acquire(source); sourceBaseline = await snapshot(source);
    await target.createTemporary(source,name); created = true; console.info(`Atomic Test import owned clone: ${name}`);
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
      try { for (const f of files.slice(150,169)) await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8")); await setup.query("commit"); }
      catch(e) { await setup.query("rollback"); throw e; }
      actor = (await setup.query("select id,auth_user_id from public.user_profiles where is_active and is_admin order by id limit 1")).rows[0];
      member = (await setup.query("select id,auth_user_id from public.user_profiles where is_active and not is_admin order by id limit 1")).rows[0];
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
      expect(files.slice(0,168).map(f => createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"))).toEqual(historicalHashes);
    } finally { await target.release(); if(source) await source.end(); }
  });

  const fg="10000000-0000-4000-8000-000000000002", customs="10000000-0000-4000-8000-000000000003";
  async function stock(quantity: string | number=40, warehouses=[raw,customs,fg]) {
    const supplier=await createSupplierSourceFixture(db,{profileId:actor.id,authUserId:actor.auth_user_id},component.id);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);
    for(const warehouse of warehouses) await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add',$3,'Owned release fixture',$4)",[component.id,warehouse,quantity,supplier.productSupplierId]);
  }
  const total=async(warehouse=raw)=>(await db.query("select public.active_test_warehouse_hold_quantity($1,$2)::text n",[component.id,warehouse])).rows[0].n;
  async function inventory(warehouse=raw) {return (await db.query("select * from public.get_inventory_test_commitments($1,null) where product_id=$2",[warehouse,component.id])).rows[0];}
  async function accounting() {return (await db.query(`select jsonb_build_object(
    'balances',(select jsonb_agg(to_jsonb(b) order by b.warehouse_id) from public.inventory_balances b where b.product_id=$1),
    'lots',(select jsonb_agg(to_jsonb(l) order by l.id) from public.inventory_source_lots l where l.product_id=$1),
    'movements',(select jsonb_agg(to_jsonb(m) order by m.id) from public.inventory_movements m where m.product_id=$1),
    'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from public.inventory_source_allocations a
      join public.inventory_source_lots l on l.id=a.source_lot_id where l.product_id=$1)) value`,[component.id])).rows;}
  async function call(f:Awaited<ReturnType<typeof fixture>>,request=randomUUID(),serial=f.serial,who=actor,role="authenticated") {
    if(!["authenticated","anon","service_role"].includes(role))throw Error("Unsafe role");
    await db.query("savepoint caller");
    try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[who.auth_user_id]);await db.query(`set local role ${role}`);
      const value=(await db.query("select public.import_test_calculation($1,$2,$3) value",[request,f.calc,serial])).rows[0].value;
      await db.query("reset role; release savepoint caller");return value;
    }catch(e){await db.query("rollback to savepoint caller; release savepoint caller");throw e;}
  }
  async function grant(keys:string[]) {
    await db.query("delete from public.user_permissions where user_id=$1",[member.id]);
    await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,actor.id,keys]);
  }
  const permissions=["test_calculator.view","test_calculator.manage","pcb.view","pcb.create","pcb.edit","inventory.raw_materials.view","inventory.customs.view","inventory.finished_goods.view"];
  async function sourceHistory(f:Awaited<ReturnType<typeof fixture>>) {return (await db.query(`select jsonb_build_object(
    'header',(select to_jsonb(c) from public.test_calculations c where c.id=$1),
    'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.test_calculation_items i where i.calculation_id=$1),
    'holds',(select jsonb_agg(to_jsonb(h) order by h.item_id,h.warehouse_id) from public.test_calculation_holds h where h.calculation_id=$1)) value`,[f.calc])).rows;}
  it("atomically maps the exact name, leading-zero serial, Product and BOM without physical effects",async()=>{
    await stock();const f=await fixture(),before=await accounting(),history=await sourceHistory(f),r=await call(f);
    expect(r).toMatchObject({calculation_id:f.calc,name:f.name,serial_number:f.serial,initial_bom_version_number:"1",release_totals:[{product_id:component.id,quantity:"3"}]});
    expect((await db.query("select name,category,product_kind,brand_id from public.products where id=$1",[r.output_product_id])).rows[0]).toEqual({name:f.name,category:"PCB",product_kind:"pcb_finished_good",brand_id:null});
    expect((await db.query("select quantity_per_card::text quantity,component_product_id from public.pcb_bom_items where bom_version_id=$1",[r.initial_bom_version_id])).rows).toEqual([{quantity:"5",component_product_id:component.id}]);
    expect((await db.query("select count(*)::int n,sum(quantity)::text total from public.inventory_balances where product_id=$1",[r.output_product_id])).rows[0]).toEqual({n:3,total:"0"});
    expect(await accounting()).toEqual(before);expect(await sourceHistory(f)).toEqual(history);expect(await total()).toBe("0");
    await db.query("set local role authenticated; set constraints all immediate; reset role; set constraints all deferred");
  });
  it("supports full, partial, zero and expired holds plus exact bigint BOM requirements",async()=>{
    await stock();
    for(const [held,expired,required] of [["5",false,"5"],["3",false,"5"],["0",false,"5"],["3",true,"5"],["3",false,"9223372036854775807"]] as const){
      const f=await fixture(held,expired,raw,required),r=await call(f);
      expect(r.release_totals).toEqual(held==="0"||expired?[]:[{product_id:component.id,quantity:held}]);
      expect((await db.query("select quantity_per_card::text n from public.pcb_bom_items where bom_version_id=$1",[r.initial_bom_version_id])).rows[0].n).toBe(required);
    }
  });
  it("releases only the selected Test and preserves other Tests and warehouse allocation identity",async()=>{
    await stock();const a=await fixture("3"),b=await fixture("4");await call(a);expect(await total()).toBe("4");
    const custom=await fixture("2",false,customs),r=await call(custom);
    expect(r.release_allocations).toEqual([{item_id:custom.item,product_id:component.id,warehouse_id:customs,quantity:"2"}]);
    expect((await db.query("select quantity::text n from public.test_calculation_holds where item_id=$1",[b.item])).rows[0].n).toBe("4");
  });
  it("returns the immutable original receipt on exact replay and rejects request/source reuse",async()=>{
    await stock();const f=await fixture(),request=randomUUID(),r=await call(f,request),before=await reservationSnapshot(db);
    expect(await call(f,request)).toEqual(r);expect(await reservationSnapshot(db)).toEqual(before);
    await expect(call(f,request,"999")).rejects.toMatchObject({code:"TCI01"});
    await expect(call(f)).rejects.toMatchObject({code:"TCI02"});
    const other=await fixture("0");await expect(call(other,request)).rejects.toMatchObject({code:"TCI01"});
    await db.query("update public.products set is_active=false,archived_at=clock_timestamp(),archived_by_user_id=$2 where id=$1",[component.id,actor.id]);
    expect(await call(f,request)).toEqual(r);
  });
  it("preserves mixed direct finished inputs and multi-warehouse allocations without expanding their BOM",async()=>{
    await stock();const ordinary=component;
    const f=await fixture("5",false,raw,"5",undefined,[{warehouse:raw,quantity:"3"},{warehouse:customs,quantity:"2"}]);
    const input=(await db.query("select * from public.create_pcb_card($1,$2)",[`Direct input ${randomUUID()}`,f.serial])).rows[0];
    await db.query("select * from public.save_initial_pcb_bom($1,$2)",[input.pcb_card_id,JSON.stringify([{product_id:ordinary.id,quantity_per_card:"999"}])]);
    component=(await db.query("select id,name,serial_number,product_kind from public.products where id=$1",[input.product_id])).rows[0];await stock(40,[fg]);
    const item=randomUUID();await db.query(`insert into public.test_calculation_items(id,calculation_id,product_id,product_name_snapshot,serial_number_snapshot,product_kind_snapshot,required_quantity,held_quantity,uncovered_quantity)
      values($1,$2,$3,$4,$5,'pcb_finished_good',7,2,5)`,[item,f.calc,component.id,component.name,component.serial_number]);
    await db.query("insert into public.test_calculation_holds values($1,$2,$3,$4,2,clock_timestamp())",[item,f.calc,component.id,fg]);
    await db.query("set constraints test_calculation_items_hold_total,test_calculation_holds_item_total immediate; set constraints test_calculation_items_hold_total,test_calculation_holds_item_total deferred");
    const serial=(await db.query("select lpad(n::text,3,'0') serial from generate_series(0,999) n where not exists(select 1 from public.products where serial_number=lpad(n::text,3,'0')) order by n limit 1")).rows[0].serial;
    const before=await accounting(),r=await call(f,randomUUID(),serial);
    expect(r.release_allocations).toHaveLength(3);expect(r.release_totals).toEqual(expect.arrayContaining([{product_id:ordinary.id,quantity:"5"},{product_id:component.id,quantity:"2"}]));
    expect((await db.query("select component_product_id,quantity_per_card::text quantity from public.pcb_bom_items where bom_version_id=$1",[r.initial_bom_version_id])).rows)
      .toEqual(expect.arrayContaining([{component_product_id:ordinary.id,quantity:"5"},{component_product_id:component.id,quantity:"7"}]));
    expect(await accounting()).toEqual(before);
    const fgOnly=await fixture("3",false,fg,"5");await grant(permissions.filter(p=>p!=="inventory.raw_materials.view"&&p!=="inventory.customs.view"));
    expect((await call(fgOnly,randomUUID(),fgOnly.serial,member)).release_totals).toEqual([{product_id:component.id,quantity:"3"}]);
  });
  it("rejects serial/name collisions atomically and preserves ordinary Calculator creation",async()=>{
    const f=await fixture("0"),r=await call(f),other=await fixture("0"),before=await reservationSnapshot(db);
    await expect(call(other,randomUUID(),r.serial_number)).rejects.toMatchObject({code:"PRD06"});expect(await reservationSnapshot(db)).toEqual(before);
    const sameName=await fixture("0",false,raw,"5",f.name),snapshotBefore=await reservationSnapshot(db);
    await expect(call(sameName)).rejects.toMatchObject({code:"PCB14"});expect(await reservationSnapshot(db)).toEqual(snapshotBefore);
    const created=(await db.query("select * from public.create_pcb_card($1,$2)",[`Ordinary ${randomUUID()}`,other.serial])).rows[0];expect(created.product_id).toBeTruthy();
  });
  it("requires every delegated grant, denies anonymous/inactive actors and binds replay to importing actor",async()=>{
    await stock();const f=await fixture();
    await expect(call(f,randomUUID(),f.serial,actor,"anon")).rejects.toMatchObject({code:"42501"});
    await expect(call(f,randomUUID(),f.serial,actor,"service_role")).rejects.toMatchObject({code:"42501"});
    for(const permission of permissions){await grant(permissions.filter(p=>p!==permission));await expect(call(f,randomUUID(),f.serial,member)).rejects.toMatchObject({code:"42501"});}
    await grant(permissions);const request=randomUUID(),r=await call(f,request,f.serial,member);expect(r.calculation_id).toBe(f.calc);
    await expect(call(f,request)).rejects.toMatchObject({code:"42501"});
    const other=await fixture("0");await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);
    await expect(call(other,randomUUID(),other.serial,member)).rejects.toMatchObject({code:"42501"});
  });
  it("rejects archived/missing source and malformed inputs with no partial destination",async()=>{
    const f=await fixture("0");for(const serial of ["6","0006"," 006","abc","6.0"])
      await expect(call(f,randomUUID(),serial)).rejects.toMatchObject({code:"22023"});
    await expect(call({...f,calc:randomUUID()})).rejects.toMatchObject({code:"P0002"});
    await db.query("update public.products set is_active=false,archived_at=clock_timestamp(),archived_by_user_id=$2 where id=$1",[component.id,actor.id]);
    const before=await reservationSnapshot(db);await expect(call(f)).rejects.toMatchObject({code:"TCI03"});expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("rolls back destination, audits, releases and provenance when final validation fails",async()=>{
    await stock();const f=await fixture();
    await db.query(`create function public.fail_import_fixture() returns trigger language plpgsql as $$begin raise exception 'Owned injected failure' using errcode='23514';end;$$;
      create trigger fail_import_fixture after insert on public.test_calculation_import_releases for each row execute function public.fail_import_fixture()`);
    const before=await reservationSnapshot(db);await expect(call(f)).rejects.toMatchObject({code:"23514"});expect(await reservationSnapshot(db)).toEqual(before);expect(await total()).toBe("3");
  });
  it("keeps private tables private and grants only the narrow authenticated RPC",async()=>{
    for(const role of ["anon","service_role"])expect((await db.query("select has_function_privilege($1,'public.import_test_calculation(uuid,uuid,text)','EXECUTE') allowed",[role])).rows[0].allowed).toBe(false);
    expect((await db.query("select has_function_privilege('authenticated','public.import_test_calculation(uuid,uuid,text)','EXECUTE') allowed")).rows[0].allowed).toBe(true);
    for(const table of tables)await expect(attempt(`set local role authenticated; select * from public.${table}`)).rejects.toMatchObject({code:"42501"});
    expect((await db.query("select proconfig from pg_proc where oid='public.import_test_calculation(uuid,uuid,text)'::regprocedure")).rows[0].proconfig).toContain('search_path=""');
  });
  it("serializes import against real Test Save, debit, FG reserve and Work Order Finish",async()=>{
    for(const scenario of ["save","debit","reserve","finish"]){
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);
      if(scenario==="reserve"){
        const serial=(await db.query("select lpad(n::text,3,'0') serial from generate_series(0,999) n where not exists(select 1 from public.products where serial_number=lpad(n::text,3,'0')) order by n limit 1")).rows[0].serial;
        const card=(await db.query("select * from public.create_pcb_card($1,$2)",[`Race input ${randomUUID()}`,serial])).rows[0];
        component=(await db.query("select id,name,serial_number,product_kind from public.products where id=$1",[card.product_id])).rows[0];await stock(40,[fg]);
      }else{
        const id=randomUUID(),serial=(await db.query("select n::text serial from generate_series(8000000,8999999) n where not exists(select 1 from public.products where serial_number=n::text) order by n limit 1")).rows[0].serial;
        component=(await db.query("insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id) values($1,$2,$3,'Race','component',$4,$4) returning id,name,serial_number,product_kind",[id,serial,`Race ${id}`,actor.id])).rows[0];await stock();
      }
      const f=await fixture("30",false,scenario==="reserve"?fg:raw,"40");
      let sql="",args:unknown[]=[];let workOrder:string|undefined;
      if(scenario==="save"){sql="select public.save_test_calculation($1,'Concurrent Save',$2,'2090-01-01') value";args=[randomUUID(),JSON.stringify([{product_id:component.id,quantity:"120"}])];}
      if(scenario==="debit"){sql="select * from public.adjust_inventory_warehouse($1,$2,'remove',20,'Owned import/debit race',null)";args=[component.id,raw];}
      if(scenario==="reserve"||scenario==="finish"){
        const project=randomUUID();await db.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,$2,'Local',current_date,current_date+1,$3,$3)",[project,`Race ${project}`,actor.id]);
        if(scenario==="reserve"){
          const group=randomUUID();await db.query("insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id) values($1,$2,'Race group',$3,$3)",[group,project,actor.id]);
          await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,40,$3,$3)",[group,component.id,actor.id]);
          sql="select * from public.reserve_finished_goods_for_project($1,$2,20,0,$3)";args=[project,component.id,randomUUID()];
        }else{
          workOrder=randomUUID();const number=(await db.query("select 'RN-8995-'||lpad(n::text,4,'0') number from generate_series(1,9999) n where not exists(select 1 from public.work_orders where work_order_number='RN-8995-'||lpad(n::text,4,'0')) order by n limit 1")).rows[0].number;
          await db.query("insert into public.work_orders(id,work_order_number,project_id,customer_name_snapshot,description,created_by_user_id,updated_by_user_id) values($1,$2,$3,'Local','Owned import/Finish race',$4,$4)",[workOrder,number,project,actor.id]);
          await db.query("insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id) values($1,$2,5,$3)",[workOrder,component.id,actor.id]);
          const updated=(await db.query("select updated_at::text value from public.work_orders where id=$1",[workOrder])).rows[0].value;
          const fingerprint=(await db.query("select public.get_work_order_source_allocation_fingerprint($1) value",[workOrder])).rows[0].value;
          await db.query("select * from public.get_work_order_pdf_snapshot($1,$2::timestamptz)",[workOrder,updated]);
          const storage=`final/${workOrder}/${randomUUID()}.pdf`;await db.query("insert into storage.objects(bucket_id,name,metadata) values('work-order-pdfs',$1,'{\"mimetype\":\"application/pdf\"}')",[storage]);
          sql="select * from public.finish_work_order($1,$2::timestamptz,$3,$4,$5)";args=[workOrder,updated,storage,"a".repeat(64),fingerprint];
        }
      }
      await db.query("commit");baseline=await reservationSnapshot(db);await db.query("begin");const imported=await call(f);expect(imported.release_totals[0].quantity).toBe("30");
      const branch=guardRollbackQueries(await pool!.connect());branches.push(branch);await branch.client.query("begin; set local lock_timeout='5s'");
      await branch.client.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);const pid=(await branch.client.query("select pg_backend_pid() pid")).rows[0].pid;
      await branch.client.query("set local role authenticated");const competing=branch.client.query(sql,args).then(r=>({r}),e=>({e}));
      let waiting=false;for(let i=0;i<40;i++){waiting=(await db.query("select pg_backend_pid()=any(pg_blocking_pids($1)) waiting",[pid])).rows[0].waiting;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
      expect(waiting).toBe(true);await db.query("commit");const result=await competing;if("e" in result)throw result.e;
      await branch.client.query("reset role");
      if(scenario==="save")expect(result.r.rows[0].value.items[0].held_quantity).toBe("120");
      const physical=(await branch.client.query("select sum(quantity)::text n from public.inventory_balances where product_id=$1",[component.id])).rows[0].n;
      expect(physical).toBe(scenario==="debit"?"100":scenario==="finish"?"115":scenario==="reserve"?"40":"120");
      if(workOrder)expect((await branch.client.query("select status from public.work_orders where id=$1",[workOrder])).rows[0].status).toBe("finished");
      await rollbackReservationTransactions(branches.splice(0));baseline=await reservationSnapshot(db);await db.query("begin");
    }
  });
  // Committed fixtures/races are confined to this owned clone; source remains unchanged.
  it("serializes concurrent exact retries, duplicate conversions and competing serial/name imports",async()=>{
    for(const scenario of ["retry","duplicate","serial","name"]){
      const f=await fixture("0"),other=scenario==="serial"||scenario==="name"?await fixture("0",false,raw,"5",scenario==="name"?f.name:undefined):f;
      const firstRequest=randomUUID(),secondRequest=scenario==="retry"?firstRequest:randomUUID();
      await db.query("commit");baseline=await reservationSnapshot(db);await db.query("begin");
      const first=await call(f,firstRequest);
      const branch=guardRollbackQueries(await pool!.connect());branches.push(branch);
      await branch.client.query("begin; set local lock_timeout='5s'");await branch.client.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);
      const pid=(await branch.client.query("select pg_backend_pid() pid")).rows[0].pid;await branch.client.query("set local role authenticated");
      const second=branch.client.query("select public.import_test_calculation($1,$2,$3) value",[secondRequest,other.calc,scenario==="name"?other.serial===f.serial?String(Number(f.serial)+1).padStart(3,"0"):other.serial:f.serial]).then(r=>({r}),e=>({e}));
      let waiting=false;for(let i=0;i<40;i++){waiting=(await db.query("select pg_backend_pid()=any(pg_blocking_pids($1)) waiting",[pid])).rows[0].waiting;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
      expect(waiting).toBe(true);await db.query("commit");const result=await second;
      if(scenario==="retry"){if("e" in result)throw result.e;expect(result.r.rows[0].value).toEqual(first);}
      else expect("e" in result?result.e:null).toMatchObject({code:scenario==="duplicate"?"TCI02":scenario==="serial"?"PRD06":"PCB14"});
      await rollbackReservationTransactions(branches.splice(0));baseline=await reservationSnapshot(db);await db.query("begin");
    }
  });
});
