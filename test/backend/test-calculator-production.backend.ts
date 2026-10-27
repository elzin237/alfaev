import { randomUUID } from "node:crypto";
import { testCalculatorBatchSteps, testCalculatorBatchPostamble } from "../../scripts/deployment/test-calculator-atomic-batch";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { LOCAL_RESERVATION, ReservationLocalTarget, reservationSnapshot,
  rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const enabled = process.env.TEST_CALCULATOR_PRODUCTION_LOCAL === "1";
const finalSchema = process.env.TEST_CALCULATOR_FINAL_SCHEMA === "158";
const foundation = readFileSync("supabase/migrations/20261027100000_add_test_calculator_foundation.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261027110000_add_test_calculator_search_and_preview.sql", "utf8");
const raw = "10000000-0000-4000-8000-000000000001", fg = "10000000-0000-4000-8000-000000000002", customs = "10000000-0000-4000-8000-000000000003";
const saveMigration=readFileSync("supabase/migrations/20261027120000_add_atomic_test_calculator_save.sql","utf8");
const protectionMigration=readFileSync("supabase/migrations/20261027130000_protect_test_calculator_warehouse_holds.sql","utf8");
const productionMigration=readFileSync("supabase/migrations/20261027140000_protect_test_holds_in_production_plans.sql","utf8");
const saveSql="select public.save_test_calculation($1,$2,$3::jsonb,$4::date) receipt";

describe.skipIf(!enabled)("Test-aware production — owned local clone only", () => {
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
    if (process.env.TEST_CALCULATOR_PRODUCTION_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw new Error("Owned-clone peer scope required");
    source = target.pool(); await target.acquire(source); sourceBaseline = await snapshot(source);
    await target.createTemporary(source,name); created=true;
    // Non-secret positive ownership evidence remains visible if setup/teardown fails.
    console.info(`TC-06 newly owned local clone: ${name}`);
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
        if(finalSchema){const steps=testCalculatorBatchSteps();for(const step of steps.slice(5))await setup.query(step.sql);for(const step of steps)await setup.query(step.ledger);await setup.query(testCalculatorBatchPostamble);}
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

  type Job={id:string;updated:string;production:boolean;output?:string;card?:string};
  async function general(input:string,quantity:string):Promise<Job>{
    const project=randomUUID(),id=randomUUID();
    await db.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,$2,'Local',current_date,current_date+1,$3,$3)",[project,`TC production ${project}`,admin.id]);
    const number=(await db.query(`select 'RN-8994-'||lpad(s::text,4,'0') number from generate_series(1,9999) s where not exists(select 1 from public.work_orders where work_order_number='RN-8994-'||lpad(s::text,4,'0')) order by s limit 1`)).rows[0].number;
    await db.query("insert into public.work_orders(id,work_order_number,project_id,customer_name_snapshot,description,created_by_user_id,updated_by_user_id) values($1,$2,$3,'Local','TC owned manufacturing',$4,$4)",[id,number,project,admin.id]);
    await db.query("insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id) values($1,$2,$3::bigint,$4)",[id,input,quantity,admin.id]);
    return {id,updated:(await db.query("select updated_at::text v from public.work_orders where id=$1",[id])).rows[0].v,production:false};
  }
  async function production(input:string,perCard="4",planned="2"):Promise<Job>{
    const output=await product(true,["0","0","0"]),card=(await db.query("select id from public.pcb_cards where output_product_id=$1",[output.id])).rows[0].id;
    const version=(await db.query("insert into public.pcb_bom_versions(pcb_card_id,version_number,created_by_user_id) values($1,1,$2) returning id",[card,admin.id])).rows[0].id;
    await db.query("insert into public.pcb_bom_items(bom_version_id,component_product_id,quantity_per_card) values($1,$2,$3::bigint)",[version,input,perCard]);
    const row=(await call("select * from public.create_pcb_production_work_order($1,$2,null,$3)",[card,planned,randomUUID()]))[0];
    return {id:row.work_order_id,updated:(await db.query("select updated_at::text v from public.work_orders where id=$1",[row.work_order_id])).rows[0].v,production:true,output:output.id,card};
  }
  const preflight=(job:Job,actual="1")=>job.production?
    call("select * from public.preflight_finish_pcb_production_work_order($1,$2::timestamptz,$3)",[job.id,job.updated,actual]):
    call("select * from public.preflight_finish_work_order($1,$2::timestamptz)",[job.id,job.updated]);
  async function pdf(job:Job,actual="1"){
    const fingerprint=(await db.query("select public.get_work_order_source_allocation_fingerprint($1) value",[job.id])).rows[0].value;
    const rows=job.production?await call("select * from public.get_work_order_pdf_snapshot($1,$2::timestamptz,$3)",[job.id,job.updated,actual]):
      await call("select * from public.get_work_order_pdf_snapshot($1,$2::timestamptz)",[job.id,job.updated]);
    expect(new Set(rows.map(row=>row.allocation_fingerprint))).toEqual(new Set([fingerprint]));
    const storage=`final/${job.id}/${randomUUID()}.pdf`;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('work-order-pdfs',$1,'{\"mimetype\":\"application/pdf\"}')",[storage]);
    return {fingerprint,storage,rows};
  }
  const finish=(job:Job,file:{storage:string;fingerprint:string},actual="1")=>job.production?
    call("select * from public.finish_work_order($1,$2::timestamptz,$3,$4,$5,$6)",[job.id,job.updated,file.storage,"a".repeat(64),file.fingerprint,actual]):
    call("select * from public.finish_work_order($1,$2::timestamptz,$3,$4,$5)",[job.id,job.updated,file.storage,"a".repeat(64),file.fingerprint]);
  async function plan(job:Job){
    await db.query("savepoint private_plan");
    try{
      const rows=(await db.query("select warehouse_code,allocated_quantity::text quantity,source_lot_id from public.get_work_order_warehouse_source_allocation_plan($1)",[job.id])).rows;
      await db.query("release savepoint private_plan");return rows;
    }catch(error){await db.query("rollback to savepoint private_plan;release savepoint private_plan");throw error;}
  }
  it("aligns precheck, allocation, PDF and Finish with holds in all warehouses",async()=>{
    const input=await product(false,["5","4","3"]);
    await hold(input.id,raw,"2");await hold(input.id,customs,"1");await hold(input.id,fg,"1");
    const job=await production(input.id);
    const check=await call("select * from public.get_pcb_production_precheck($1)",[job.card]);
    expect(check[0].available_quantity).toBe("8");
    const rows=await preflight(job);expect(rows[0]).toMatchObject({available_quantity:"8",required_quantity:"8",missing_quantity:"0"});
    expect((await plan(job)).map(r=>[r.warehouse_code,r.quantity])).toEqual([["raw_materials","3"],["customs","3"],["finished_goods","2"]]);
    const file=await pdf(job);expect(file.rows.map(row=>row.quantity)).toEqual(["3","3","2"]);
    await finish(job,file);
    expect((await consistency(input.id)).map(r=>r.physical)).toEqual(["2","1","1"]);
    expect((await db.query("select quantity::text from public.inventory_balances where product_id=$1 and warehouse_id=$2",[job.output,fg])).rows[0].quantity).toBe("1");
    const before=await reservationSnapshot(db);await expect(finish(job,file)).rejects.toMatchObject({code:"WOR02"});
    expect(await reservationSnapshot(db)).toEqual(before);
    expect((await db.query("select count(*)::int n from public.pcb_production_runs where work_order_id=$1",[job.id])).rows[0].n).toBe(1);
    await consistency(job.output!);
  });
  it("uses FG only for a linked input and never recursively consumes its BOM",async()=>{
    const original=await product(false,["50","0","0"]),input=await product(true,["100","100","6"]);
    const inputCard=(await db.query("select id from public.pcb_cards where output_product_id=$1",[input.id])).rows[0].id;
    const version=(await db.query("insert into public.pcb_bom_versions(pcb_card_id,version_number,created_by_user_id) values($1,1,$2) returning id",[inputCard,admin.id])).rows[0].id;
    await db.query("insert into public.pcb_bom_items(bom_version_id,component_product_id,quantity_per_card) values($1,$2,2)",[version,original.id]);
    const project=await demand(input.id,"2");
    await call("select * from public.reserve_finished_goods_for_project($1,$2,2,0,$3)",[project,input.id,randomUUID()]);
    await hold(input.id,fg,"2");const job=await production(input.id,"1","2");
    await preflight(job);expect((await plan(job)).map(r=>[r.warehouse_code,r.quantity])).toEqual([["finished_goods","2"]]);
    const file=await pdf(job);await finish(job,file);
    expect((await consistency(input.id)).map(r=>r.physical)).toEqual(["100","4","100"]);
    expect((await db.query("select quantity::text from public.inventory_balances where product_id=$1 and warehouse_id=$2",[original.id,raw])).rows[0].quantity).toBe("50");
    const next=await general(input.id,"1");expect((await preflight(next))[0].missing_quantity).toBe("1");
    await expect(plan(next)).rejects.toMatchObject({code:"IVB02"});
  });
  it("expired holds stop reducing production eligibility without deleting history",async()=>{
    const p=await product(false,["5","0","0"]);await hold(p.id,raw,"5",true);
    const job=await general(p.id,"5");expect((await preflight(job))[0].available_quantity).toBe("5");
    const file=await pdf(job);await finish(job,file);await consistency(p.id);
    expect((await db.query("select quantity::text from public.test_calculation_holds where product_id=$1",[p.id])).rows).toEqual([{quantity:"5"}]);
  });
  it.each([raw,customs,fg])("reports held-only warehouse stock as unavailable: %s",async warehouse=>{
    const p=await product(false,[raw,customs,fg].map(w=>w===warehouse?"5":"0"));await hold(p.id,warehouse,"5");
    const job=await general(p.id,"1"),before=await reservationSnapshot(db);
    expect((await preflight(job))[0]).toMatchObject({available_quantity:"0",missing_quantity:"1",inventory_sufficient:false});
    await expect(plan(job)).rejects.toMatchObject({code:"IVB02"});
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("keeps ordinary soft Project demand out of production capacity and preserves FIFO",async()=>{
    const p=await product(false,["5","0","0"]);await demand(p.id,"100");
    await call("select * from public.adjust_inventory_warehouse($1,$2,'add',5,'Second owned lot',$3)",[p.id,raw,p.productSupplierId]);
    await hold(p.id,raw,"3");const job=await general(p.id,"7");expect((await preflight(job))[0].available_quantity).toBe("7");
    expect((await plan(job)).map(row=>row.quantity)).toEqual(["5","2"]);
    const file=await pdf(job);await finish(job,file);await consistency(p.id);
    expect((await db.query("select remaining_quantity::text q from public.inventory_source_lots where product_id=$1 order by received_at,id",[p.id])).rows.map(row=>row.q)).toEqual(["0","3"]);
  });
  it("rejects stale source fingerprints after a new Test Save and leaves no partial debit",async()=>{
    const p=await product(false,["5","5","0"]),job=await general(p.id,"4");
    await preflight(job);const file=await pdf(job);await save(p.id,"4");
    const before=await reservationSnapshot(db);
    await expect(finish(job,file)).rejects.toMatchObject({code:"WOR11"});expect(await reservationSnapshot(db)).toEqual(before);
    const refreshed=await pdf(job);expect(refreshed.fingerprint).not.toBe(file.fingerprint);await finish(job,refreshed);await consistency(p.id);
  });
  it("does not elevate helper permissions or mutate historical production objects",async()=>{
    const fn="public.get_production_free_warehouse_quantity(uuid,uuid)";
    for(const role of ["anon","authenticated","service_role"])expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,fn])).rows[0].allowed).toBe(false);
    expect((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and prosecdef")).rows[0].n).toBe(finalSchema?197:194);
    const p=await product(),job=await general(p.id,"1");await grant([]);
    await expect(preflight(job)).resolves.toHaveLength(1);
    await expect(call("select * from public.preflight_finish_work_order($1,$2::timestamptz)",[job.id,job.updated],member)).rejects.toMatchObject({code:"42501"});
  });
  it.each(["save-first","finish-first"])("serializes committed Save versus Finish: %s",async order=>{
    const p=await product(false,["5","0","0"]),job=await production(p.id,"4","1");
    await preflight(job);const file=await pdf(job);await db.query("commit");baseline=await snapshot(pool!);
    async function client(){
      const rawClient=await pool!.connect(),guard=guardRollbackQueries(rawClient,testSignal);branches.push(guard);
      await guard.client.query("begin;set local statement_timeout='12s';set local lock_timeout='5s'");
      await guard.client.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.auth_user_id]);
      const pid=(await guard.client.query("select pg_backend_pid() pid")).rows[0].pid;
      await guard.client.query("set local role authenticated");return {guard,pid};
    }
    const first=await client(),second=await client();
    const finishSql="select * from public.finish_work_order($1,$2::timestamptz,$3,$4,$5,$6)",finishArgs=[job.id,job.updated,file.storage,"a".repeat(64),file.fingerprint,"1"];
    const saveArgs=[randomUUID(),"Concurrent manufacturing Test",JSON.stringify([{product_id:p.id,quantity:"4"}]),"2030-01-01"];
    if(order==="save-first")await first.guard.client.query(saveSql,saveArgs);else await first.guard.client.query(finishSql,finishArgs);
    const waiting=second.guard.client.query(order==="save-first"?finishSql:saveSql,order==="save-first"?finishArgs:saveArgs)
      .then(result=>({result,error:undefined}),error=>({result:undefined,error}));
    let blocked=false;
    for(let i=0;i<100;i++){
      blocked=(await db.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[second.pid])).rows[0]?.blocked===true;
      if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));
    }
    if(!blocked)throw new Error("Expected controlled manufacturing lock wait");
    await first.guard.client.query("commit");const outcome=await waiting;
    if(order==="save-first"){
      expect(outcome.error).toMatchObject({code:"IVB02"});await second.guard.client.query("rollback");
      expect((await db.query("select status from public.work_orders where id=$1",[job.id])).rows[0].status).toBe("draft");
    }else{
      if(outcome.error)throw outcome.error;
      expect(outcome.result!.rows[0].receipt.items[0].held_quantity).toBe("1");await second.guard.client.query("commit");
      expect((await db.query("select status from public.work_orders where id=$1",[job.id])).rows[0].status).toBe("finished");
    }
    await rollbackReservationTransactions(branches.splice(0));
    expect((await db.query("select quantity::text physical,public.active_test_warehouse_hold_quantity(product_id,warehouse_id)::text held from public.inventory_balances where product_id=$1 and warehouse_id=$2",[p.id,raw])).rows[0])
      .toEqual(order==="save-first"?{physical:"5",held:"4"}:{physical:"1",held:"1"});
    expect((await db.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[job.output,fg])).rows[0].q).toBe(order==="save-first"?"0":"1");
    await consistency(p.id);await consistency(job.output!);baseline=await snapshot(pool!);
  });
});
