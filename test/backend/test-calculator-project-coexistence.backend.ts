import { randomUUID } from "node:crypto";
import { testCalculatorBatchSteps, testCalculatorBatchPostamble } from "../../scripts/deployment/test-calculator-atomic-batch";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { LOCAL_RESERVATION, ReservationLocalTarget, reservationSnapshot,
  rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const enabled = process.env.TEST_CALCULATOR_COEXISTENCE_LOCAL === "1";
const finalSchema = process.env.TEST_CALCULATOR_FINAL_SCHEMA === "158";
const foundation = readFileSync("supabase/migrations/20261027100000_add_test_calculator_foundation.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261027110000_add_test_calculator_search_and_preview.sql", "utf8");
const raw = "10000000-0000-4000-8000-000000000001", fg = "10000000-0000-4000-8000-000000000002", customs = "10000000-0000-4000-8000-000000000003";
const saveMigration=readFileSync("supabase/migrations/20261027120000_add_atomic_test_calculator_save.sql","utf8");
const protectionMigration=readFileSync("supabase/migrations/20261027130000_protect_test_calculator_warehouse_holds.sql","utf8");
const productionMigration=readFileSync("supabase/migrations/20261027140000_protect_test_holds_in_production_plans.sql","utf8");
const coexistenceMigration=readFileSync("supabase/migrations/20261027150000_protect_test_holds_in_project_reservation_admission.sql","utf8");
const saveSql="select public.save_test_calculation($1,$2,$3::jsonb,$4::date) receipt";

describe.skipIf(!enabled)("Project/Test reservation coexistence — owned local clone only", () => {
  const target = new ReservationLocalTarget(), name = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  let source: LocalReservationPool | undefined, pool: LocalReservationPool | undefined;
  let sourceBaseline: unknown, baseline: unknown, created = false, db: PoolClient;
  let transaction: ReturnType<typeof guardRollbackQueries> | undefined;
  let testSignal: AbortSignal | undefined;
  const branches: ReturnType<typeof guardRollbackQueries>[] = [];
  let admin: { id: string; auth_user_id: string }, member: typeof admin;
  async function snapshot(pool: LocalReservationPool) {
    const c = await pool.connect(); try { return await reservationSnapshot(c); } finally { c.release(true); }
  }
  async function call(sql: string, args: unknown[], actor = admin, role = "authenticated") {
    if (!["anon", "authenticated", "service_role"].includes(role)) throw new Error("Unsafe role");
    await db.query("savepoint caller");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor.auth_user_id]);
      await db.query(`set local role ${role}`); const rows = (await db.query(sql,args)).rows;
      await db.query("reset role; release savepoint caller"); return rows;
    } catch (error) { await db.query("rollback to savepoint caller; release savepoint caller"); throw error; }
  }
  async function product(finished = false, quantities = [5,4,3].map(String), linked = true) {
    const id = randomUUID(), card = randomUUID();
    if (id === LOCAL_RESERVATION.residue) throw new Error("Retained residue forbidden");
    const serial = (await db.query(`select s::text serial from generate_series(8000000,8999999) s
      where not exists(select 1 from public.products where serial_number=s::text) order by s limit 1`)).rows[0].serial;
    await db.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,'Local Test Preview',$4,$5,$5)`, [id,serial,`TC preview ${id}`,finished?"pcb_finished_good":"component",admin.id]);
    if (finished && linked) await db.query("insert into public.pcb_cards(id,name,output_product_id,created_by_user_id,updated_by_user_id) values($1,$2,$3,$4,$4)", [card,`TC ${card}`,id,admin.id]);
    const supplier = await createSupplierSourceFixture(db,{profileId:admin.id,authUserId:admin.auth_user_id},id);
    for (const [index,warehouse] of [raw,customs,fg].entries()) if (BigInt(quantities[index]!) > 0n)
      await call("select * from public.adjust_inventory_warehouse($1,$2,'add',$3::bigint,'Owned Test preview fixture',$4)", [id,warehouse,quantities[index],supplier.productSupplierId]);
    return {id,serial,productSupplierId:supplier.productSupplierId};
  }
  async function demand(productId: string, quantity: string) {
    const project = randomUUID(), group = randomUUID();
    await db.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,$2,'Local','2026-10-27','2026-11-27',$3,$3)",[project,`TC ${project}`,admin.id]);
    await db.query("insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id) values($1,$2,'Local group',$3,$3)",[group,project,admin.id]);
    await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,$3::bigint,$4,$4)",[group,productId,quantity,admin.id]);
    return project;
  }
  async function hold(productId: string, warehouse: string, quantity: string, expired = false) {
    const calc = randomUUID(), item = randomUUID();
    await db.query(`insert into public.test_calculations(id,name,created_by_user_id,created_at,deadline_date,expires_at,request_id,submitted_payload,save_receipt)
      values($1,'Local seeded hold',$2,'2019-01-01T00:00:00Z',$3::date,($3::date+1)::timestamp at time zone 'Europe/Sarajevo',$4,'{}','{}')`,
    [calc,admin.id,expired?"2020-01-01":"2030-01-01",randomUUID()]);
    await db.query(`insert into public.test_calculation_items(id,calculation_id,product_id,product_name_snapshot,serial_number_snapshot,product_kind_snapshot,required_quantity,held_quantity,uncovered_quantity)
      select $1,$2,id,name,serial_number,product_kind,$4::bigint,$4::bigint,0 from public.products where id=$3`,[item,calc,productId,quantity]);
    await db.query("insert into public.test_calculation_holds(item_id,calculation_id,product_id,warehouse_id,quantity) values($1,$2,$3,$4,$5::bigint)",[item,calc,productId,warehouse,quantity]);
    await db.query("set constraints all immediate; set constraints all deferred");
  }
  async function grant(keys: string[]) {
    await db.query("delete from public.user_permissions where user_id=$1",[member.id]);
    await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,admin.id,keys]);
  }
  beforeAll(async () => {
    if (process.env.TEST_CALCULATOR_COEXISTENCE_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw new Error("Owned-clone peer scope required");
    source = target.pool(); await target.acquire(source); sourceBaseline = await snapshot(source);
    await target.createTemporary(source,name); created=true;
    // Non-secret positive ownership evidence remains visible if setup/teardown fails.
    console.info(`TC-07 newly owned local clone: ${name}`);
    target.copyIntoTemporary(name); pool=target.pool(name);
    const setup=await pool.connect();
    try {
      const files=readdirSync("supabase/migrations").filter(p=>/^\d{14}_.+\.sql$/.test(p)).sort();
      expect(files[151]).toBe("20261027110000_add_test_calculator_search_and_preview.sql");
      await setup.query("begin");
      try { for(let i=142;i<150;i++) {
        const file=files[i]!; await setup.query(readFileSync(`supabase/migrations/${file}`,"utf8"));
        await setup.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)",[file.slice(0,14),file.slice(15,-4)]);
        if(i>=145) { await setup.query("commit"); await target.acceptClonePhase(setup,name,(i+1) as 146|147|148|149|150); if(i<149)await setup.query("begin"); }
      }} catch(error) {await setup.query("rollback");throw error;}
      admin=(await setup.query("select id,auth_user_id from public.user_profiles where is_active and is_admin order by id limit 1")).rows[0];
      member=(await setup.query("select id,auth_user_id from public.user_profiles where is_active and not is_admin order by id limit 1")).rows[0];
      if(!admin||!member)throw new Error("Existing local identities required"); await setup.query("begin");
      try { await setup.query(foundation);await setup.query(migration);await setup.query(saveMigration);await setup.query(protectionMigration);await setup.query(productionMigration);
        const metadataSql="select oid,proowner,proacl,prosecdef,proconfig,provolatile from pg_proc where oid=any(array['public.change_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid,boolean)'::regprocedure,'public.mutate_project_requirement(uuid,text,uuid,uuid,uuid,uuid,bigint,uuid,bigint)'::regprocedure]) order by oid";
        const metadata=(await setup.query(metadataSql)).rows;
        await setup.query(coexistenceMigration);expect((await setup.query(metadataSql)).rows).toEqual(metadata);
        if(finalSchema){const steps=testCalculatorBatchSteps();for(const step of steps.slice(6))await setup.query(step.sql);for(const step of steps)await setup.query(step.ledger);await setup.query(testCalculatorBatchPostamble);}
        await setup.query("commit");if(finalSchema)await target.acceptClonePhase(setup,name,158); }
      catch(error){await setup.query("rollback");throw error;}
      baseline=await reservationSnapshot(setup);
    } finally {setup.release(true);}
  });
  beforeEach(async context => {
    testSignal=context.signal;
    await target.assertQuiet();const client=await pool!.connect();transaction=guardRollbackQueries(client,context.signal);db=transaction.client;await db.query("begin");
    await db.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
  });
  afterEach(async () => {
    let failure:unknown;
    if(transaction){const current=transaction;transaction=undefined;try{await rollbackReservationTransactions([current,...branches.splice(0)]);}catch(error){failure=error;}}
    try{if(pool&&baseline)expect(await snapshot(pool)).toEqual(baseline);}finally{if(failure)throw failure;}
  });
  afterAll(async () => {
    try {if(pool)await pool.end();if(source&&sourceBaseline)expect(await snapshot(source)).toEqual(sourceBaseline);
      if(created&&source){await target.dropTemporary(source,name);expect((await source.query("select exists(select 1 from pg_database where datname=$1) present",[name])).rows[0].present).toBe(false);}
      if(source&&sourceBaseline)expect(await snapshot(source)).toEqual(sourceBaseline);
    } finally {await target.release();if(source)await source.end();}
  });


  const save=async(id:string,quantity="8",request=randomUUID(),actor=admin,deadline="2030-01-01",name="Owned Save")=>
    (await call(saveSql,[request,name,JSON.stringify([{product_id:id,quantity}]),deadline],actor))[0].receipt;

  const adjust=(id:string,warehouse:string,type:string,quantity:string,actor=admin)=>
    call("select * from public.adjust_inventory_warehouse($1,$2,$3,$4::bigint,'Owned protection test')",[id,warehouse,type,quantity],actor);
  const transfer=(id:string,from:string,to:string,quantity:string)=>
    call("select * from public.transfer_inventory_between_warehouses($1,$2,$3,$4::bigint,'Owned protection transfer')",[id,from,to,quantity]);
  async function consistency(id:string){
    await db.query("set constraints all immediate;set constraints all deferred");
    const rows=(await db.query(`select b.warehouse_id,b.quantity::text physical,
      coalesce((select sum(l.remaining_quantity::numeric) from public.inventory_source_lots l where l.product_id=b.product_id and l.warehouse_id=b.warehouse_id),0)::text lots,
      coalesce((select sum(m.quantity_delta::numeric) from public.inventory_movements m where m.product_id=b.product_id and m.warehouse_id=b.warehouse_id),0)::text ledger
      from public.inventory_balances b where b.product_id=$1 order by b.warehouse_id`,[id])).rows;
    for(const row of rows){expect(row.lots).toBe(row.physical);expect(row.ledger).toBe(row.physical);}
    return rows;
  }


  const reserveSql="select * from public.reserve_finished_goods_for_project($1,$2,$3::bigint,$4::bigint,$5)";
  const releaseSql="select * from public.release_finished_goods_project_reservation($1,$2,$3::bigint,$4::bigint,$5)";
  const fulfillSql="select * from public.fulfill_finished_goods_project_reservation($1,$2,$3,$4::bigint,$5::bigint,$6)";
  const mutateSql="select public.mutate_project_requirement($1,$2,$3,$4,$5,$6,$7::bigint,$8,$9::bigint) result";
  async function project(productId:string,quantity?:string){
    const project=randomUUID(),group=randomUUID();
    await db.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,$2,'Local',current_date,current_date+1,$3,$3)",[project,`TC coexistence ${project}`,admin.id]);
    await db.query("insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id) values($1,$2,'Owned coexistence',$3,$3)",[group,project,admin.id]);
    if(quantity)await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,$3::bigint,$4,$4)",[group,productId,quantity,admin.id]);
    return {project,group,product:productId};
  }
  type Project=Awaited<ReturnType<typeof project>>;
  const manual=(p:Project,q:string,version="0",request=randomUUID())=>call(reserveSql,[p.project,p.product,q,version,request]).then(r=>r[0]);
  const autoArgs=(p:Project,q:string,request=randomUUID(),component:string|null=null,expected:string|null=null)=>
    [request,component?"update":"create",p.project,p.group,component,p.product,q,component?p.product:null,expected];
  const auto=(p:Project,q:string,request=randomUUID(),component:string|null=null,expected:string|null=null)=>call(mutateSql,autoArgs(p,q,request,component,expected)).then(r=>r[0].result);
  const invariant=async(id:string)=>{
    const row=(await db.query(`select b.quantity::text physical,
      coalesce((select sum(r.reserved_quantity::numeric) from public.finished_goods_project_reservations r where r.product_id=b.product_id),0)::text projects,
      public.active_test_warehouse_hold_quantity(b.product_id,b.warehouse_id)::text tests
      from public.inventory_balances b where b.product_id=$1 and b.warehouse_id=$2`,[id,fg])).rows[0];
    expect(BigInt(row.physical)>=BigInt(row.projects)+BigInt(row.tests)).toBe(true);return row;
  };
  it("protects Test-first manual admission, Release/retry and actor-bound immutable receipts",async()=>{
    const productRow=await product(true,["100","100","10"]),p=await project(productRow.id,"10"),saveRequest=randomUUID();
    const original=await save(p.product,"7",saveRequest),before=await consistency(p.product);
    await expect(manual(p,"4")).rejects.toMatchObject({code:"FGR07"});
    const request=randomUUID(),receipt=await manual(p,"3","0",request);
    expect(await manual(p,"3","0",request)).toEqual(receipt);
    await expect(manual(p,"2","0",request)).rejects.toMatchObject({code:"FGR01"});
    await expect(manual(p,"1","0")).rejects.toMatchObject({code:"FGR04"});
    await call(releaseSql,[p.project,p.product,"1","1",randomUUID()]);
    expect(await save(p.product,"7",saveRequest)).toEqual(original);
    expect(await invariant(p.product)).toEqual({physical:"10",projects:"2",tests:"7"});
    expect(await consistency(p.product)).toEqual(before);
    await grant(["projects.view","projects.edit","inventory.finished_goods.view","inventory.finished_goods.reserve"]);
    await expect(call(reserveSql,[p.project,p.product,"3","0",request],member)).rejects.toMatchObject({code:"42501"});
  });
  it.each([["2","3","3"],["7","6","3"],["10","6","0"]])
    ("automatically allocates only free FG: Test %s, demand %s",async(held,demand,reserved)=>{
      const p=await project((await product(true,["100","100","10"])).id);await save(p.product,held);
      const before=await consistency(p.product),request=randomUUID(),receipt=await auto(p,demand,request);
      expect(receipt.affected_products[0]).toMatchObject({reserved_quantity:reserved,uncovered_demand:String(BigInt(demand)-BigInt(reserved))});
      expect(await auto(p,demand,request)).toEqual(receipt);
      expect(await consistency(p.product)).toEqual(before);await invariant(p.product);
      expect((await db.query("select count(*)::int n from public.project_requirement_mutation_receipts where request_id=$1",[request])).rows[0].n).toBe(1);
    });
  it("respects Project-first stock and reduces excess automatically without topping up freed stock",async()=>{
    const p=await project((await product(true,["0","0","10"])).id),created=await auto(p,"6");
    const testReceipt=await save(p.product,"8");expect(testReceipt.items[0].held_quantity).toBe("4");
    const reduced=await auto(p,"2",randomUUID(),created.component_id,"6");
    expect(reduced.affected_products[0].reserved_quantity).toBe("2");
    expect(await invariant(p.product)).toEqual({physical:"10",projects:"2",tests:"4"});
    await call("select * from public.adjust_inventory_warehouse($1,$2,'remove',4,'Owned free stock debit')",[p.product,fg]);
    expect(await invariant(p.product)).toEqual({physical:"6",projects:"2",tests:"4"});
    await expect(transfer(p.product,fg,raw,"1")).rejects.toMatchObject({code:"IVB02"});await consistency(p.product);
  });
  it("excludes expired Test holds without deleting history",async()=>{
    const p=await project((await product(true,["0","0","10"])).id,"10");await hold(p.product,fg,"10",true);
    await manual(p,"8");expect(await invariant(p.product)).toEqual({physical:"10",projects:"8",tests:"0"});
    expect((await db.query("select quantity::text q from public.test_calculation_holds where product_id=$1",[p.product])).rows[0].q).toBe("10");
  });
  it("fulfills FG only once while retaining Test stock and original BOM components",async()=>{
    const component=await product(false,["50","0","0"]),p=await project((await product(true,["0","0","10"])).id,"8");
    const card=(await db.query("select id from public.pcb_cards where output_product_id=$1",[p.product])).rows[0].id;
    const version=(await db.query("insert into public.pcb_bom_versions(pcb_card_id,version_number,created_by_user_id) values($1,1,$2) returning id",[card,admin.id])).rows[0].id;
    await db.query("insert into public.pcb_bom_items(bom_version_id,component_product_id,quantity_per_card) values($1,$2,2)",[version,component.id]);
    const r=await manual(p,"6");await save(p.product,"8");
    const args=[r.reservation_id,p.project,p.product,"2","1",randomUUID()],receipt=await call(fulfillSql,args);
    expect(await call(fulfillSql,args)).toEqual(receipt);expect(await invariant(p.product)).toEqual({physical:"8",projects:"4",tests:"4"});
    await call(fulfillSql,[r.reservation_id,p.project,p.product,"4","2",randomUUID()]);
    expect(await invariant(p.product)).toEqual({physical:"4",projects:"0",tests:"4"});
    expect((await db.query("select quantity::text from public.inventory_balances where product_id=$1 and warehouse_id=$2",[component.id,raw])).rows[0].quantity).toBe("50");
    expect((await db.query("select count(*)::int n from public.inventory_movements where product_id=$1 and quantity_delta<0",[p.product])).rows[0].n).toBe(2);
    await consistency(p.product);await consistency(component.id);
  });
  it("preserves cancellation and denies reopening Cancelled Projects without reallocating stock",async()=>{
    const p=await project((await product(true,["0","0","10"])).id,"6");await manual(p,"6");await save(p.product,"4");
    await call("select public.cancel_project($1)",[p.project]);
    expect(await invariant(p.product)).toEqual({physical:"10",projects:"0",tests:"4"});
    await expect(call("select public.reopen_project($1)",[p.project])).rejects.toMatchObject({code:"PRJ04"});
    expect(await invariant(p.product)).toEqual({physical:"10",projects:"0",tests:"4"});
    await consistency(p.product);
  });
  it("keeps ordinary Raw/Customs planning soft and warehouse permissions unchanged",async()=>{
    const p=await project((await product(false,["5","4","3"])).id),receipt=await auto(p,"100");
    expect(receipt.affected_products).toEqual([]);
    await hold(p.product,raw,"2");await adjust(p.product,raw,"remove","3");await consistency(p.product);
    await grant(["projects.view","projects.edit","inventory.finished_goods.view"]);
    const other=await project((await product(true,["0","0","10"])).id);
    await expect(call(mutateSql,autoArgs(other,"2"),member)).rejects.toMatchObject({code:"42501"});
    for(const role of ["anon","service_role"])await expect(call(mutateSql,autoArgs(other,"2"),admin,role)).rejects.toMatchObject({code:"42501"});
    await expect(call("select * from public.test_calculation_holds",[],admin)).rejects.toMatchObject({code:"42501"});
    expect((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and prosecdef")).rows[0].n).toBe(finalSchema?197:194);
  });
  it("preserves bigint admission precision",async()=>{
    const p=await project((await product(true,["0","0","9007199254740993"])).id);
    await save(p.product,"9007199254740992");const r=await auto(p,"2");
    expect(r.affected_products[0]).toMatchObject({reserved_quantity:"1",uncovered_demand:"1"});
    expect(await invariant(p.product)).toEqual({physical:"9007199254740993",projects:"1",tests:"9007199254740992"});
  });
  it.each(["manual-test-first","manual-project-first","automatic-test-first","automatic-project-first","fulfill-test-first","fulfill-project-first"])
    ("serializes committed Project/Test operations: %s",async scenario=>{
      const p=await project((await product(true,["0","0","5"])).id,scenario.startsWith("automatic")?undefined:"3");
      const prior=scenario.startsWith("fulfill")?await manual(p,"3"):undefined;
      await db.query("commit");baseline=await snapshot(pool!);
      async function client(){
        const rawClient=await pool!.connect(),guard=guardRollbackQueries(rawClient,testSignal);branches.push(guard);
        await guard.client.query("begin;set local statement_timeout='12s';set local lock_timeout='5s'");
        await guard.client.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.auth_user_id]);
        const pid=(await guard.client.query("select pg_backend_pid() pid")).rows[0].pid;
        await guard.client.query("set local role authenticated");return {guard,pid};
      }
      const first=await client(),second=await client();
      const testFirst=scenario.endsWith("test-first"),args=[randomUUID(),"Owned Test/Project race",JSON.stringify([{product_id:p.product,quantity:"4"}]),"2030-01-01"];
      const otherSql=scenario.startsWith("automatic")?mutateSql:scenario.startsWith("fulfill")?fulfillSql:reserveSql;
      const otherArgs=scenario.startsWith("automatic")?autoArgs(p,"3"):scenario.startsWith("fulfill")?
        [prior.reservation_id,p.project,p.product,"2","1",randomUUID()]:[p.project,p.product,"3","0",randomUUID()];
      const winner=(await first.guard.client.query(testFirst?saveSql:otherSql,testFirst?args:otherArgs)).rows[0];
      const waiting=second.guard.client.query(testFirst?otherSql:saveSql,testFirst?otherArgs:args)
        .then(result=>({result,error:undefined}),error=>({result:undefined,error}));
      let blocked=false;
      for(let i=0;i<100;i++){
        blocked=(await db.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[second.pid])).rows[0]?.blocked===true;
        if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));
      }
      if(!blocked)throw new Error("Expected controlled Project/Test lock wait");
      await first.guard.client.query("commit");const outcome=await waiting;
      if(scenario==="manual-test-first"){
        expect(outcome.error).toMatchObject({code:"FGR07"});await second.guard.client.query("rollback");
      }else{
        if(outcome.error)throw outcome.error;await second.guard.client.query("commit");
      }
      if(testFirst)expect(winner.receipt.items[0].held_quantity).toBe(scenario.startsWith("fulfill")?"2":"4");
      else expect(outcome.result!.rows[0].receipt.items[0].held_quantity).toBe("2");
      if(scenario==="automatic-test-first")expect(outcome.result!.rows[0].result.affected_products[0].reserved_quantity).toBe("1");
      await rollbackReservationTransactions(branches.splice(0));
      const row=await invariant(p.product);
      expect(row).toEqual(scenario.startsWith("fulfill")?{physical:"3",projects:"1",tests:"2"}:
        testFirst?{physical:"5",projects:scenario.startsWith("automatic")?"1":"0",tests:"4"}:{physical:"5",projects:"3",tests:"2"});
      await consistency(p.product);baseline=await snapshot(pool!);
    });
});
