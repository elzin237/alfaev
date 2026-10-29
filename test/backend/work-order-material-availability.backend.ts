import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { LOCAL_RESERVATION, ReservationLocalTarget, reservationSnapshot,
  rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const enabled = process.env.WORK_ORDER_AVAILABILITY_LOCAL === "1";
const foundation = readFileSync("supabase/migrations/20261027100000_add_test_calculator_foundation.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261027110000_add_test_calculator_search_and_preview.sql", "utf8");
const raw = "10000000-0000-4000-8000-000000000001", fg = "10000000-0000-4000-8000-000000000002", customs = "10000000-0000-4000-8000-000000000003";
const saveMigration=readFileSync("supabase/migrations/20261027120000_add_atomic_test_calculator_save.sql","utf8");
const protectionMigration=readFileSync("supabase/migrations/20261027130000_protect_test_calculator_warehouse_holds.sql","utf8");
const productionMigration=readFileSync("supabase/migrations/20261027140000_protect_test_holds_in_production_plans.sql","utf8");
const saveSql="select public.save_test_calculation($1,$2,$3::jsonb,$4::date) receipt";

describe.skipIf(!enabled)("WO-01 availability and WO-03 shortage events — owned local clone only", () => {
  const target = new ReservationLocalTarget(), name = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  let source: LocalReservationPool | undefined, pool: LocalReservationPool | undefined;
  let sourceBaseline: unknown, baseline: unknown, created = false, db: PoolClient;
  let transaction: ReturnType<typeof guardRollbackQueries> | undefined;
  let testSignal: AbortSignal | undefined;
  const branches: ReturnType<typeof guardRollbackQueries>[] = [];
  let admin: { id: string; auth_user_id: string }, member: typeof admin;
  let concurrentFixture: { productId: string; workOrderId: string };
  const historicalProduct=randomUUID(),historicalWorkOrder=randomUUID();
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
    return calc;
  }
  async function grant(keys: string[]) {
    await db.query("delete from public.user_permissions where user_id=$1",[member.id]);
    await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,admin.id,keys]);
  }
  beforeAll(async () => {
    if (process.env.WORK_ORDER_AVAILABILITY_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw new Error("Owned-clone peer scope required");
    source = target.pool(); await target.acquire(source); sourceBaseline = await snapshot(source);
    await target.createTemporary(source,name); created=true;
    // Non-secret positive ownership evidence remains visible if setup/teardown fails.
    console.info(`WO-01 newly owned local clone: ${name}`);
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
        for(const file of files.slice(155)) {
          if(file.startsWith("20261028140000_")) {
            // Genuine pre-163 Draft: no trigger disabling or history deletion.
            const serial=(await setup.query(`select s::text serial from generate_series(8100000,8199999) s
              where not exists(select 1 from public.products where serial_number=s::text) order by s limit 1`)).rows[0].serial;
            await setup.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
              values($1,$2,'WO-07 pre-migration material','Local','component',$3,$3)`,[historicalProduct,serial,admin.id]);
            const number=(await setup.query(`select 'RN-8994-'||lpad(s::text,4,'0') number from generate_series(1,9999) s
              where not exists(select 1 from public.work_orders where work_order_number='RN-8994-'||lpad(s::text,4,'0')) order by s limit 1`)).rows[0].number;
            await setup.query(`insert into public.work_orders(id,work_order_number,customer_name_snapshot,description,created_by_user_id,updated_by_user_id)
              values($1,$2,'Local','WO-07 historical Draft',$3,$3)`,[historicalWorkOrder,number,admin.id]);
            await setup.query(`insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id)
              values($1,$2,9007199254740993,$3)`,[historicalWorkOrder,historicalProduct,admin.id]);
          }
          await setup.query(readFileSync(`supabase/migrations/${file}`,"utf8"));
        }
        await setup.query("commit"); }
      catch(error){await setup.query("rollback");throw error;}
      // A committed fixture inside this newly owned clone is visible to two
      // independent rollback-only clients; the clone is removed after the suite.
      const productId=randomUUID(),workOrderId=randomUUID(),projectId=randomUUID();
      await setup.query("begin");
      try {
        const serial=(await setup.query(`select s::text serial from generate_series(8000000,8999999) s
          where not exists(select 1 from public.products where serial_number=s::text) order by s limit 1`)).rows[0].serial;
        const number=(await setup.query(`select 'RN-8993-'||lpad(s::text,4,'0') number from generate_series(1,9999) s
          where not exists(select 1 from public.work_orders where work_order_number='RN-8993-'||lpad(s::text,4,'0'))
          order by s limit 1`)).rows[0].number;
        await setup.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
          values($1,$2,'WO-03 concurrency fixture','Local Test Preview','component',$3,$3)`,[productId,serial,admin.id]);
        await setup.query(`insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id)
          values($1,'WO-03 concurrency fixture','Local',current_date,current_date+1,$2,$2)`,[projectId,admin.id]);
        await setup.query(`insert into public.work_orders(id,work_order_number,project_id,customer_name_snapshot,description,created_by_user_id,updated_by_user_id)
          values($1,$2,$3,'Local','WO-03 concurrency fixture',$4,$4)`,[workOrderId,number,projectId,admin.id]);
        await setup.query(`insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id)
          values($1,$2,1,$3)`,[workOrderId,productId,admin.id]);
        await setup.query("commit");
      } catch(error) {await setup.query("rollback");throw error;}
      concurrentFixture={productId,workOrderId};
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

  type Availability = {work_order_id:string;status:string;as_of:string;materials:{
    product_id:string;required_quantity:string;eligible_quantity:string;missing_quantity:string;has_shortage:boolean
  }[]};
  const read = async (id:string,actor=admin,role="authenticated"):Promise<Availability> =>
    (await call("select public.get_work_order_material_availability($1) result",[id],actor,role))[0].result;

  it("reports exact current shortage without blocking Draft creation",async()=>{
    const p=await product(false,["55","0","0"]),job=await general(p.id,"60");
    const before=await reservationSnapshot(db),result=await read(job.id);
    expect(result).toMatchObject({work_order_id:job.id,status:"draft",materials:[{
      product_id:p.id,required_quantity:"60",eligible_quantity:"55",missing_quantity:"5",has_shortage:true
    }]});
    expect(Number.isFinite(Date.parse(result.as_of))).toBe(true);
    expect(await reservationSnapshot(db)).toEqual(before);
    expect((await preflight(job))[0]).toMatchObject({inventory_sufficient:false,missing_quantity:"5"});
  });
  it("reads incomplete Drafts, including an empty material set",async()=>{
    const p=await product(),job=await general(p.id,"1");
    await db.query("delete from public.work_order_items where work_order_id=$1",[job.id]);
    await db.query("update public.work_orders set description=null where id=$1",[job.id]);
    expect(await read(job.id)).toMatchObject({status:"draft",materials:[]});
  });
  it("aggregates frozen BOM plus supplemental rows before shortage calculation",async()=>{
    const p=await product(false,["8","0","0"]),job=await production(p.id,"4","2");
    await call("select * from public.save_pcb_production_supplemental_materials($1,$2::jsonb,$3::timestamptz)",
      [job.id,JSON.stringify([{product_id:p.id,quantity:"3"}]),job.updated]);
    expect((await read(job.id)).materials).toEqual([expect.objectContaining({
      product_id:p.id,required_quantity:"11",eligible_quantity:"8",missing_quantity:"3"
    })]);
  });
  it("uses ordinary Raw/Customs/FG capacity, excluding holds but not soft Project demand",async()=>{
    const p=await product(false,["5","4","3"]);await demand(p.id,"100");
    await hold(p.id,raw,"2");await hold(p.id,customs,"1");await hold(p.id,fg,"1");
    const job=await general(p.id,"9");
    expect((await read(job.id)).materials[0]).toMatchObject({eligible_quantity:"8",missing_quantity:"1"});
    expect((await db.query("select public.get_production_eligible_quantity($1)::text quantity",[p.id])).rows[0].quantity).toBe("8");
  });
  it("uses only linked FG and protects both Project reservations and Test holds",async()=>{
    const p=await product(true,["100","100","10"]),project=await demand(p.id,"3");
    await call("select * from public.reserve_finished_goods_for_project($1,$2,3,0,$3)",[project,p.id,randomUUID()]);
    await hold(p.id,fg,"2");const job=await general(p.id,"6");
    expect((await read(job.id)).materials[0]).toMatchObject({eligible_quantity:"5",missing_quantity:"1"});
  });
  it("ignores expired holds without deleting history or changing stock",async()=>{
    const p=await product(false,["5","0","0"]);await hold(p.id,raw,"5",true);
    const job=await general(p.id,"5"),before=await reservationSnapshot(db);
    expect((await read(job.id)).materials[0]).toMatchObject({eligible_quantity:"5",missing_quantity:"0",has_shortage:false});
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("keeps one statement snapshot even when its caller changes a balance in the same command",async()=>{
    const p=await product(false,["55","0","0"]),job=await general(p.id,"60");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.auth_user_id]);
    const row=(await db.query(`with changed as (
      update public.inventory_balances set quantity=54 where product_id=$1 and warehouse_id=$2 returning quantity
    ) select public.get_work_order_material_availability($3) result,
      changed.quantity::text changed_quantity,statement_timestamp() as_of from changed`,[p.id,raw,job.id])).rows[0];
    expect(row.changed_quantity).toBe("54");
    expect(row.result.materials[0]).toMatchObject({eligible_quantity:"55",missing_quantity:"5"});
    expect(Date.parse(row.result.as_of)).toBe(row.as_of.getTime());
    // A subsequent statement sees the newly committed-to-this-transaction value.
    expect((await read(job.id)).materials[0]).toMatchObject({eligible_quantity:"54",missing_quantity:"6"});
  });
  it("preserves archived material identity without claiming that stock authorizes Finish",async()=>{
    const p=await product(false,["5","0","0"]),job=await general(p.id,"1");
    await db.query("update public.products set is_active=false,archived_at=clock_timestamp(),archived_by_user_id=$2 where id=$1",[p.id,admin.id]);
    expect((await read(job.id)).materials[0]).toMatchObject({product_id:p.id,product_is_active:false,eligible_quantity:"5"});
    await expect(preflight(job)).rejects.toMatchObject({code:"PRD05"});
  });
  it("transports SQL bigint boundaries as exact decimal strings",async()=>{
    const p=await product(false,["9007199254740993","0","0"]),job=await general(p.id,"9223372036854775807");
    expect((await read(job.id)).materials[0]).toMatchObject({
      required_quantity:"9223372036854775807",eligible_quantity:"9007199254740993",missing_quantity:"9214364837600034814"
    });
  });
  it("fails closed for missing identity, unknown Work Order and unavailable balances",async()=>{
    await expect(read(randomUUID())).rejects.toMatchObject({code:"P0002"});
    await expect(read(null as unknown as string)).rejects.toMatchObject({code:"22023"});
    const p=await product(false,["0","0","0"]),job=await general(p.id,"1");
    await db.query("delete from public.inventory_balances where product_id=$1 and warehouse_id=$2",[p.id,raw]);
    await expect(read(job.id)).rejects.toMatchObject({code:"IVB01"});
  });
  it("uses the Work Order detail permission, not Inventory or Finish permissions",async()=>{
    const p=await product(),job=await general(p.id,"1");
    await grant(["work_orders.view"]);expect((await read(job.id,member)).materials).toHaveLength(1);
    expect((await call("select * from public.get_work_order_detail($1)",[job.id],member))[0].work_order_id).toBe(job.id);
    await expect(call("select * from public.preflight_finish_work_order($1,$2::timestamptz)",[job.id,job.updated],member))
      .rejects.toMatchObject({code:"42501"});
    for(const keys of [[],["work_orders.edit_draft"],["work_orders.finish"],["inventory.raw_materials.view"]]){
      await grant(keys);await expect(read(job.id,member)).rejects.toMatchObject({code:"42501"});
      await expect(call("select * from public.get_work_order_detail($1)",[job.id],member)).rejects.toMatchObject({code:"42501"});
    }
  });
  it("denies anonymous, service role and inactive profiles; private helpers remain private",async()=>{
    const p=await product(),job=await general(p.id,"1");
    for(const role of ["anon","service_role"])await expect(read(job.id,admin,role)).rejects.toMatchObject({code:"42501"});
    await grant(["work_orders.view"]);await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);
    await expect(read(job.id,member)).rejects.toMatchObject({code:"42501"});
    await expect(call("select public.get_production_free_warehouse_quantity_at($1,$2,statement_timestamp())",[p.id,raw]))
      .rejects.toMatchObject({code:"42501"});
  });
  it("does not weaken FIFO, PDF, physical deductions or finished-state rejection",async()=>{
    const p=await product(false,["5","4","3"]);
    await hold(p.id,raw,"2");await hold(p.id,customs,"1");await hold(p.id,fg,"1");
    const job=await production(p.id);
    expect((await read(job.id)).materials[0]).toMatchObject({eligible_quantity:"8",missing_quantity:"0"});
    expect((await plan(job)).map(r=>[r.warehouse_code,r.quantity])).toEqual([
      ["raw_materials","3"],["customs","3"],["finished_goods","2"]
    ]);
    const file=await pdf(job);await finish(job,file);
    await expect(read(job.id)).rejects.toMatchObject({code:"WOR02"});
    expect((await consistency(p.id)).map(r=>r.physical)).toEqual(["2","1","1"]);
    expect((await db.query("select quantity::text quantity from public.inventory_balances where product_id=$1 and warehouse_id=$2",[job.output,fg])).rows[0].quantity).toBe("1");
  });

  async function flushShortages() {
    await db.query("set constraints all immediate; set constraints all deferred");
  }
  async function episodes(workOrderId:string, productId:string) {
    return (await db.query(`select id,revision,required_quantity::text required,
      eligible_quantity::text eligible,missing_quantity::text missing,
      resolved_at is not null resolved
      from public.work_order_material_shortage_episodes
      where work_order_id=$1 and product_id=$2 order by opened_at,id`,[workOrderId,productId])).rows;
  }
  async function eventTypes(workOrderId:string,productId:string) {
    return (await db.query(`select event.event_type from public.work_order_material_shortage_events event
      join public.work_order_material_shortage_episodes episode on episode.id=event.episode_id
      where event.work_order_id=$1 and event.product_id=$2
      order by episode.opened_at,episode.id,event.revision`,[workOrderId,productId])).rows.map(r=>r.event_type);
  }
  async function intents(workOrderId:string) {
    return (await db.query(`select outbox.event_type from public.work_order_material_shortage_notification_outbox outbox
      join public.work_order_material_shortage_episodes episode on episode.id=outbox.episode_id
      where episode.work_order_id=$1 order by outbox.created_at,outbox.id`,[workOrderId])).rows.map(r=>r.event_type);
  }

  it("WO-03 opens one episode for creation shortage, with a single opening intent",async()=>{
    const p=await product(false,["55","0","0"]),job=await general(p.id,"60");
    await flushShortages();
    expect(await episodes(job.id,p.id)).toMatchObject([{required:"60",eligible:"55",missing:"5",resolved:false,revision:"1"}]);
    expect(await eventTypes(job.id,p.id)).toEqual(["opened"]);
    expect(await intents(job.id)).toEqual(["opened"]);
    await db.query("update public.inventory_balances set quantity=quantity where product_id=$1 and warehouse_id=$2",[p.id,raw]);
    await db.query("update public.work_orders set updated_at=clock_timestamp() where id=$1",[job.id]);
    await flushShortages();
    expect(await eventTypes(job.id,p.id)).toEqual(["opened"]);
    expect(await intents(job.id)).toEqual(["opened"]);
  });
  it("WO-03 leaves sufficient Drafts without episodes",async()=>{
    const p=await product(false,["5","0","0"]),job=await general(p.id,"4");
    await flushShortages();
    expect(await episodes(job.id,p.id)).toEqual([]);
    expect(await intents(job.id)).toEqual([]);
  });
  it("WO-03 reconciles trusted Work Order creation and authenticated Draft saves",async()=>{
    const input=await product(false,["0","0","0"]),productionJob=await production(input.id,"2","1");
    await flushShortages();
    expect((await episodes(productionJob.id,input.id))[0].missing).toBe("2");
    expect(await intents(productionJob.id)).toEqual(["opened"]);

    const p=await product(false,["1","0","0"]),job=await general(p.id,"1");
    await flushShortages();expect(await episodes(job.id,p.id)).toEqual([]);
    const projectId=(await db.query("select project_id from public.work_orders where id=$1",[job.id])).rows[0].project_id;
    const items=JSON.stringify([{product_id:p.id,quantity:"3"}]);
    const saved=(await call("select result.work_order_id,result.updated_at::text updated_at from public.save_draft_work_order($1,$2,$3,$4::jsonb,$5::timestamptz) result",
      [job.id,projectId,"Local",items,job.updated]))[0];
    await flushShortages();
    expect((await episodes(job.id,p.id))[0].missing).toBe("2");
    expect(await intents(job.id)).toEqual(["opened"]);
    const currentUpdated=(await db.query("select updated_at::text updated_at from public.work_orders where id=$1",[job.id])).rows[0].updated_at;
    expect(saved.updated_at).toEqual(currentUpdated);
    await call("select * from public.save_draft_work_order($1,$2,$3,$4::jsonb,$5::timestamptz)",
      [job.id,projectId,"Local",items,saved.updated_at]);
    await flushShortages();
    expect(await eventTypes(job.id,p.id)).toEqual(["opened"]);
    expect(await intents(job.id)).toEqual(["opened"]);
  });
  it("WO-03 records increases, decreases, resolution and a new recurrence without fanout",async()=>{
    const p=await product(false,["5","0","0"]),job=await general(p.id,"6");
    await flushShortages();
    const item=(await db.query("select id from public.work_order_items where work_order_id=$1 and product_id=$2",[job.id,p.id])).rows[0].id;
    for(const quantity of ["8","7","5","6"]) {
      await db.query("update public.work_order_items set quantity=$2::bigint where id=$1",[item,quantity]);
      await flushShortages();
    }
    expect(await eventTypes(job.id,p.id)).toEqual(["opened","increased","decreased","resolved","opened"]);
    expect((await episodes(job.id,p.id)).map(r=>[r.missing,r.resolved])).toEqual([["0",true],["1",false]]);
    expect(await intents(job.id)).toEqual(["opened","resolved","opened"]);
  });
  it("WO-03 isolates Products and Work Orders; stock changes resolve and reopen",async()=>{
    const a=await product(false,["1","0","0"]),b=await product(false,["2","0","0"]);
    const first=await general(a.id,"3"),second=await general(a.id,"4"),third=await general(b.id,"5");
    await flushShortages();
    expect((await episodes(first.id,a.id))[0].missing).toBe("2");
    expect((await episodes(second.id,a.id))[0].missing).toBe("3");
    expect((await episodes(third.id,b.id))[0].missing).toBe("3");
    await call("select * from public.adjust_inventory_warehouse($1,$2,'add',4::bigint,'WO-03 owned arrival',$3)",[a.id,raw,a.productSupplierId]);
    await flushShortages();
    expect((await episodes(first.id,a.id))[0].resolved).toBe(true);
    expect((await episodes(second.id,a.id))[0].resolved).toBe(true);
    expect((await episodes(third.id,b.id))[0].resolved).toBe(false);
    await adjust(a.id,raw,"remove","4");await flushShortages();
    expect(await episodes(first.id,a.id)).toHaveLength(2);
    expect(await intents(first.id)).toEqual(["opened","resolved","opened"]);
  });
  it("WO-03 applies Test holds and FG Project reservations without changing physical stock",async()=>{
    const a=await product(false,["5","0","0"]),first=await general(a.id,"5");
    await flushShortages();expect(await episodes(first.id,a.id)).toEqual([]);
    await hold(a.id,raw,"2");await flushShortages();
    expect((await episodes(first.id,a.id))[0].missing).toBe("2");
    const b=await product(false,["5","0","0"]);await hold(b.id,raw,"3",true);
    const expired=await general(b.id,"5");await flushShortages();
    expect(await episodes(expired.id,b.id)).toEqual([]);
    const f=await product(true,["0","0","10"]),project=await demand(f.id,"3"),fgJob=await general(f.id,"8");
    await flushShortages();expect(await episodes(fgJob.id,f.id)).toEqual([]);
    await call("select * from public.reserve_finished_goods_for_project($1,$2,3,0,$3)",[project,f.id,randomUUID()]);
    await flushShortages();expect((await episodes(fgJob.id,f.id))[0].missing).toBe("1");
    expect((await db.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[f.id,fg])).rows[0].q).toBe("10");
  });
  it("WO-03 Draft deletion closes active warnings while retaining immutable history",async()=>{
    const p=await product(false,["0","0","0"]),job=await general(p.id,"2");
    await flushShortages();
    await call("select * from public.delete_draft_work_order($1,$2::timestamptz)",[job.id,job.updated]);
    await flushShortages();
    expect((await episodes(job.id,p.id))[0].resolved).toBe(true);
    expect(await eventTypes(job.id,p.id)).toEqual(["opened","resolved"]);
    expect(await intents(job.id)).toEqual(["opened","resolved"]);
    expect((await db.query("select count(*)::int n from public.work_orders where id=$1",[job.id])).rows[0].n).toBe(0);
    const retained=(await db.query(`select o.event_type,count(r.id)::int recipients
      from public.work_order_material_shortage_notification_outbox o
      join public.work_order_material_shortage_events e on e.id=o.event_id
      join public.work_order_shortage_notification_recipients r on r.outbox_id=o.id
      where e.work_order_id=$1 group by o.event_type order by o.event_type`,[job.id])).rows;
    expect(retained.map(r=>r.event_type)).toEqual(["opened","resolved"]);
    expect(retained.every(r=>r.recipients>0)).toBe(true);
  });
  it("WO-03 Finish closes a prior shortage without changing FIFO accounting",async()=>{
    const p=await product(false,["1","0","0"]),job=await general(p.id,"2");
    await flushShortages();expect((await episodes(job.id,p.id))[0].missing).toBe("1");
    await call("select * from public.adjust_inventory_warehouse($1,$2,'add',1::bigint,'WO-03 owned arrival',$3)",[p.id,raw,p.productSupplierId]);
    await preflight(job);const file=await pdf(job);await finish(job,file);
    await flushShortages();
    expect((await episodes(job.id,p.id))[0].resolved).toBe(true);
    expect(await eventTypes(job.id,p.id)).toEqual(["opened","resolved"]);
    expect(await intents(job.id)).toEqual(["opened","resolved"]);
    expect((await db.query("select status from public.work_orders where id=$1",[job.id])).rows[0].status).toBe("finished");
    expect((await consistency(p.id)).map(r=>r.physical)).toEqual(["0","0","0"]);
  });
  it("WO-03 keeps shortage tables private and leaves Project alert state independent",async()=>{
    const p=await product(false,["0","0","0"]),job=await general(p.id,"1");
    const before=(await db.query("select count(*)::int n from public.project_shortage_events")).rows[0].n;
    await flushShortages();
    expect((await db.query("select count(*)::int n from public.project_shortage_events")).rows[0].n).toBe(before);
    await expect(call("select count(*) from public.work_order_material_shortage_episodes",[])).rejects.toMatchObject({code:"42501"});
    await expect(call("select public.reconcile_work_order_material_shortages_for_product($1)",[p.id])).rejects.toMatchObject({code:"42501"});
    expect((await episodes(job.id,p.id))[0].missing).toBe("1");
    await db.query("savepoint immutable_history");
    await expect(db.query("delete from public.work_order_material_shortage_events where work_order_id=$1",[job.id]))
      .rejects.toMatchObject({code:"55000"});
    await db.query("rollback to savepoint immutable_history; release savepoint immutable_history");
  });
  it("WO-03 serializes concurrent reconciliation and an exact retry without duplicate events",async()=>{
    const {productId,workOrderId}=concurrentFixture;
    const open=(await db.query(`select count(*)::int n from public.work_order_material_shortage_episodes
      where work_order_id=$1 and product_id=$2 and resolved_at is null`,[workOrderId,productId])).rows[0].n;
    expect(open).toBe(1);
    const before=(await db.query(`select count(*)::int n from public.work_order_material_shortage_events
      where work_order_id=$1 and product_id=$2`,[workOrderId,productId])).rows[0].n;
    expect(before).toBe(1);
    const first=guardRollbackQueries(await pool!.connect(),testSignal),second=guardRollbackQueries(await pool!.connect(),testSignal);
    branches.push(first,second);
    await first.client.query("begin;set local statement_timeout='12s';set local lock_timeout='5s'");
    await second.client.query("begin;set local statement_timeout='12s';set local lock_timeout='5s'");
    await first.client.query("update public.work_order_items set quantity=2 where work_order_id=$1 and product_id=$2",[workOrderId,productId]);
    await first.client.query("set constraints all immediate;set constraints all deferred");
    expect((await first.client.query(`select missing_quantity::text missing from public.work_order_material_shortage_episodes
      where work_order_id=$1 and product_id=$2 and resolved_at is null`,[workOrderId,productId])).rows[0].missing).toBe("2");
    const lock=(await second.client.query(`select pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'work-order-material-shortage:'||$1::text||':'||$2::text,0)) acquired`,[productId,workOrderId])).rows[0];
    expect(lock.acquired).toBe(false);
    await rollbackReservationTransactions([first]);
    branches.splice(branches.indexOf(first),1);
    await second.client.query("select public.reconcile_work_order_material_shortages_for_product($1)",[productId]);
    await second.client.query("select public.reconcile_work_order_material_shortages_for_product($1)",[productId]);
    expect((await second.client.query(`select count(*)::int n from public.work_order_material_shortage_events
      where work_order_id=$1 and product_id=$2`,[workOrderId,productId])).rows[0].n).toBe(before);
    expect((await second.client.query(`select count(*)::int n from public.work_order_material_shortage_episodes
      where work_order_id=$1 and product_id=$2 and resolved_at is null`,[workOrderId,productId])).rows[0].n).toBe(1);
  });
  it("WO-04 delivers once to active Admins and Dashboard plus Work Order viewers",async()=>{
    await grant(["dashboard.view","work_orders.view"]);
    const p=await product(false,["0","0","0"]),job=await general(p.id,"9007199254740993");
    const before=await reservationSnapshot(db);await flushShortages();
    const list=(await call("select public.list_dashboard_notifications() result",[],member))[0].result;
    const alert=list.find((r:{work_order_id?:string})=>r.work_order_id===job.id);
    expect(alert).toMatchObject({target_type:"work_order",shortage_quantity:"9007199254740993",shortage_event_type:"opened"});
    expect((await call("select public.list_dashboard_notifications() result",[]))[0].result)
      .toEqual(expect.arrayContaining([expect.objectContaining({work_order_id:job.id})]));
    for(const permissions of [["dashboard.view"],["work_orders.view"],[]]){
      await grant(permissions);
      const other=await general(p.id,"2");await flushShortages();
      expect((await db.query(`select count(*)::int n from public.work_order_shortage_notification_recipients r
        join public.work_order_material_shortage_notification_outbox o on o.id=r.outbox_id
        join public.work_order_material_shortage_events e on e.id=o.event_id
        where e.work_order_id=$1 and r.recipient_user_id=$2`,[other.id,member.id])).rows[0].n).toBe(0);
    }
    await grant(["dashboard.view","work_orders.view"]);
    await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);
    const inactiveJob=await general(p.id,"2");await flushShortages();
    expect((await db.query(`select count(*)::int n from public.work_order_shortage_notification_recipients r
      join public.work_order_material_shortage_notification_outbox o on o.id=r.outbox_id
      join public.work_order_material_shortage_events e on e.id=o.event_id
      where e.work_order_id=$1 and r.recipient_user_id=$2`,[inactiveJob.id,member.id])).rows[0].n).toBe(0);
    const after=await reservationSnapshot(db);
    for(const [table,state] of Object.entries(before)) {
      if(table.startsWith("public.inventory_") || table.startsWith("public.finished_goods_") || table.startsWith("public.test_calculation"))
        expect(after[table]).toEqual(state);
    }
    await consistency(p.id);
  });
  it("WO-04 owns read/dismiss receipts and preserves event-time opening and resolution",async()=>{
    await grant(["dashboard.view","work_orders.view"]);
    const p=await product(false,["1","0","0"]),job=await general(p.id,"3");await flushShortages();
    const get=async(actor=member)=>(await call("select public.list_dashboard_notifications() result",[],actor))[0].result;
    const alert=(await get()).find((r:{work_order_id?:string})=>r.work_order_id===job.id);
    await expect(call("select * from public.mark_dashboard_notification_read($1)",[alert.notification_id],admin))
      .rejects.toMatchObject({code:"P0002"});
    await expect(call("select * from public.dismiss_dashboard_notification($1)",[alert.notification_id],admin))
      .rejects.toMatchObject({code:"P0002"});
    const receipt=(await call("select * from public.mark_dashboard_notification_read($1)",[alert.notification_id],member))[0];
    expect((await call("select * from public.mark_dashboard_notification_read($1)",[alert.notification_id],member))[0]).toEqual(receipt);
    await db.query("update public.work_order_items set quantity=4 where work_order_id=$1",[job.id]);await flushShortages();
    expect((await get()).filter((r:{work_order_id?:string})=>r.work_order_id===job.id)).toHaveLength(1);
    expect((await get()).find((r:{work_order_id?:string})=>r.work_order_id===job.id).shortage_quantity).toBe("2");
    await db.query("update public.work_order_items set quantity=1 where work_order_id=$1",[job.id]);await flushShortages();
    expect((await get()).filter((r:{work_order_id?:string})=>r.work_order_id===job.id)).toHaveLength(2);
    expect((await get()).find((r:{shortage_event_type?:string})=>r.shortage_event_type==="resolved").shortage_quantity).toBe("0");
    await call("select * from public.dismiss_dashboard_notification($1)",[alert.notification_id],member);
    await call("select * from public.dismiss_dashboard_notification($1)",[alert.notification_id],member);
    expect((await get()).some((r:{notification_id:string})=>r.notification_id===alert.notification_id)).toBe(false);
    await grant(["dashboard.view"]);
    await expect(call("select * from public.dismiss_dashboard_notification($1)",[alert.notification_id],member)).rejects.toMatchObject({code:"42501"});
    await expect(call("select * from public.work_order_shortage_notification_recipients",[])).rejects.toMatchObject({code:"42501"});
    await expect(call("select public.deliver_work_order_shortage_intent($1)",[randomUUID()])).rejects.toMatchObject({code:"42501"});
    await expect(call("select public.list_dashboard_notifications()",[],admin,"anon")).rejects.toMatchObject({code:"42501"});
    await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);
    await expect(get()).rejects.toMatchObject({code:"42501"});
  });
  it("WO-04 concurrent delivery retries preserve unique recipient intents",async()=>{
    const outbox=(await db.query(`select o.id from public.work_order_material_shortage_notification_outbox o
      join public.work_order_material_shortage_events e on e.id=o.event_id where e.work_order_id=$1`,[concurrentFixture.workOrderId])).rows[0].id;
    const before=(await db.query("select count(*)::int n from public.work_order_shortage_notification_recipients where outbox_id=$1",[outbox])).rows[0].n;
    expect(before).toBeGreaterThan(0);
    const clients=[guardRollbackQueries(await pool!.connect(),testSignal),guardRollbackQueries(await pool!.connect(),testSignal)];
    branches.push(...clients);
    for(const c of clients)await c.client.query("begin;set local statement_timeout='5s'");
    await Promise.all(clients.map(c=>c.client.query("select public.deliver_work_order_shortage_intent($1)",[outbox])));
    expect((await db.query("select count(*)::int n from public.work_order_shortage_notification_recipients where outbox_id=$1",[outbox])).rows[0].n).toBe(before);
  });
  it("WO-04 merges Project targets without changing their existing read/dismiss contract",async()=>{
    const p=await product(false,["0","0","0"]),job=await general(p.id,"1");await flushShortages();
    const projectId=(await db.query("select project_id from public.work_orders where id=$1",[job.id])).rows[0].project_id;
    const activity=(await call("select * from public.post_project_activity($1,$2,'WO-04 compatibility','Owned local compatibility fixture',true)",
      [projectId,randomUUID()]))[0];
    const legacy=(await call("select * from public.list_project_notifications()",[])).find(r=>r.activity_id===activity.activity_id);
    expect(legacy).toBeDefined();
    const combined=(await call("select public.list_dashboard_notifications() result",[]))[0].result;
    expect(combined).toEqual(expect.arrayContaining([expect.objectContaining({target_type:"project",notification_id:legacy.notification_id,
      project_id:projectId,activity_id:activity.activity_id}),expect.objectContaining({target_type:"work_order",work_order_id:job.id})]));
    const first=(await call("select public.list_dashboard_notifications(1) result",[]))[0].result;
    expect(first).toHaveLength(1);expect(first[0].has_more).toBe(true);
    const next=(await call("select public.list_dashboard_notifications(1,$1,$2) result",[first[0].created_at,first[0].notification_id]))[0].result;
    expect(next).toHaveLength(1);expect(next[0].notification_id).not.toBe(first[0].notification_id);
    await call("select * from public.mark_dashboard_notification_read($1)",[legacy.notification_id]);
    expect((await call("select * from public.list_project_notifications()",[])).find(r=>r.notification_id===legacy.notification_id).read_at).not.toBeNull();
    await call("select * from public.dismiss_dashboard_notification($1)",[legacy.notification_id]);
    expect((await call("select * from public.list_project_notifications()",[])).some(r=>r.notification_id===legacy.notification_id)).toBe(false);
  });
  it("WO-05 delivers the complete creation/edit/arrival/recurrence lifecycle without duplicate fanout",async()=>{
    await grant(["dashboard.view","work_orders.view"]);
    const p=await product(false,["55","0","0"]),job=await production(p.id,"60","1");
    await flushShortages();
    expect((await read(job.id)).materials[0]).toMatchObject({required_quantity:"60",eligible_quantity:"55",missing_quantity:"5"});
    for(const quantity of ["2","1"]){
      const version=(await db.query("select updated_at::text v from public.work_orders where id=$1",[job.id])).rows[0].v;
      await call("select * from public.save_pcb_production_supplemental_materials($1,$2::jsonb,$3::timestamptz)",
        [job.id,JSON.stringify([{product_id:p.id,quantity}]),version]);
      await flushShortages();
    }
    expect(await eventTypes(job.id,p.id)).toEqual(["opened","increased","decreased"]);
    expect(await intents(job.id)).toEqual(["opened"]);
    await call("select * from public.adjust_inventory_warehouse($1,$2,'add',6::bigint,'WO-05 arrival',$3)",[p.id,raw,p.productSupplierId]);
    await flushShortages();expect((await episodes(job.id,p.id))[0].resolved).toBe(true);
    await adjust(p.id,raw,"remove","1");await flushShortages();
    expect(await eventTypes(job.id,p.id)).toEqual(["opened","increased","decreased","resolved","opened"]);
    expect(await episodes(job.id,p.id)).toHaveLength(2);
    for(const actor of [admin,member]){
      const delivered=(await call("select public.list_dashboard_notifications() result",[],actor))[0].result
        .filter((r:{work_order_id?:string})=>r.work_order_id===job.id);
      expect(delivered).toHaveLength(3);
      expect(delivered.filter((r:{shortage_event_type:string})=>r.shortage_event_type==="opened")).toHaveLength(2);
      expect(new Set(delivered.map((r:{event_id:string})=>r.event_id)).size).toBe(3);
    }
    expect((await consistency(p.id)).map(r=>r.physical)).toEqual(["60","0","0"]);
    expect((await db.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[job.output,fg])).rows[0].q).toBe("0");
  });
  it("WO-07 initializes pre-migration Drafts once with exact quantities and eligible recipients",async()=>{
    await grant(["dashboard.view","work_orders.view"]);
    expect(await episodes(historicalWorkOrder,historicalProduct)).toHaveLength(0);
    const before=await reservationSnapshot(db);
    for(let retry=0;retry<2;retry++) await db.query("select public.initialize_work_order_material_shortages($1,1)",[[historicalProduct]]);
    expect(await eventTypes(historicalWorkOrder,historicalProduct)).toEqual(["opened"]);
    expect(await intents(historicalWorkOrder)).toEqual(["opened"]);
    for(const actor of [admin,member]) {
      const inbox=(await call("select public.list_dashboard_notifications() result",[],actor))[0].result;
      expect(inbox.filter((r:{work_order_id:string})=>r.work_order_id===historicalWorkOrder)).toEqual([
        expect.objectContaining({target_type:"work_order",work_order_id:historicalWorkOrder,shortage_quantity:"9007199254740993"})]);
    }
    const after=await reservationSnapshot(db);
    for(const [table,state] of Object.entries(before)) if(!table.startsWith("public.work_order_material_shortage_")
      && !table.startsWith("public.work_order_shortage_notification_")) expect(after[table]).toEqual(state);
  });
  it("WO-07 skips sufficient Drafts and preserves existing episode and notification identities",async()=>{
    const p=await product(false,["5","0","0"]),sufficient=await general(p.id,"2");await flushShortages();
    const before=await reservationSnapshot(db);
    await db.query("select public.initialize_work_order_material_shortages($1,10)",[[p.id,concurrentFixture.productId]]);
    expect(await episodes(sufficient.id,p.id)).toHaveLength(0);
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("WO-07 rejects browser execution and invalid/beyond-bound scopes before creating history",async()=>{
    for(const role of ["authenticated","anon","service_role"]) await expect(call(
      "select public.initialize_work_order_material_shortages($1,1)",[[historicalProduct]],admin,role)).rejects.toMatchObject({code:"42501"});
    for(const ids of [[],[historicalProduct,historicalProduct],[randomUUID()]]) {
      await db.query("savepoint invalid_scope");
      await expect(db.query("select public.initialize_work_order_material_shortages($1,1)",[ids])).rejects.toMatchObject({code:"22023"});
      await db.query("rollback to savepoint invalid_scope; release savepoint invalid_scope");
    }
    await db.query("savepoint bounded_scope");
    await expect(db.query("select public.initialize_work_order_material_shortages($1,1)",[[historicalProduct,concurrentFixture.productId]]))
      .rejects.toMatchObject({code:"54000"});
    await db.query("rollback to savepoint bounded_scope; release savepoint bounded_scope");
    expect(await episodes(historicalWorkOrder,historicalProduct)).toHaveLength(0);
    await grant(["dashboard.view"]);
    await db.query("select public.initialize_work_order_material_shortages($1,1)",[[historicalProduct]]);
    expect((await call("select public.list_dashboard_notifications() result",[],member))[0].result).toEqual([]);
  });
  const tracking=async(actor=admin)=>(await call("select public.list_dashboard_shortage_tracking() result",[],actor))[0].result;
  const activeCount=async(actor=admin)=>BigInt((await call("select public.get_dashboard_alert_counts() result",[],actor))[0].result.active_work_order_shortages);
  it("WO-08 keeps active shortages counted after read, resolves one logical item, dismisses and recurs",async()=>{
    const before=await activeCount(),p=await product(false,["1","0","0"]),job=await general(p.id,"3");await flushShortages();
    const item=(await tracking()).find((r:{work_order_id:string})=>r.work_order_id===job.id);
    expect(item).toMatchObject({episode_status:"active",shortage_quantity:"2"});
    expect(await activeCount()).toBe(before+1n);
    await call("select * from public.mark_dashboard_notification_read($1)",[item.notification_id]);
    expect(await activeCount()).toBe(before+1n);
    await expect(call("select * from public.dismiss_dashboard_notification($1)",[item.notification_id])).rejects.toMatchObject({code:"55000"});
    await db.query("update public.work_order_shortage_notification_recipients set read_at=null where id=$1",[item.notification_id]);
    await db.query("update public.work_order_items set quantity=1 where work_order_id=$1",[job.id]);await flushShortages();
    const resolved=(await tracking()).filter((r:{work_order_id:string})=>r.work_order_id===job.id);
    expect(resolved).toHaveLength(1);expect(resolved[0]).toMatchObject({notification_id:item.notification_id,episode_status:"resolved",shortage_quantity:"0"});
    expect(resolved[0].read_at).not.toBeNull();expect(await activeCount()).toBe(before);
    await call("select * from public.dismiss_dashboard_notification($1)",[item.notification_id]);
    await call("select * from public.dismiss_dashboard_notification($1)",[item.notification_id]);
    expect((await tracking()).some((r:{work_order_id:string})=>r.work_order_id===job.id)).toBe(false);
    await db.query("update public.work_order_items set quantity=4 where work_order_id=$1",[job.id]);await flushShortages();
    const recurrence=(await tracking()).filter((r:{work_order_id:string})=>r.work_order_id===job.id);
    expect(recurrence).toHaveLength(1);expect(recurrence[0].notification_id).not.toBe(item.notification_id);
    expect(await activeCount()).toBe(before+1n);await consistency(p.id);
  });
  it("WO-08 restores visibility of previously dismissed active episodes without erasing history",async()=>{
    const p=await product(false,["5","0","0"]),job=await general(p.id,"9007199254740993");await flushShortages();
    const item=(await tracking()).find((r:{work_order_id:string})=>r.work_order_id===job.id);
    const old=(await db.query("update public.work_order_shortage_notification_recipients set dismissed_at=clock_timestamp() where id=$1 returning dismissed_at::text stamp",[item.notification_id])).rows[0].stamp;
    expect((await tracking()).find((r:{notification_id:string})=>r.notification_id===item.notification_id).shortage_quantity).toBe("9007199254740988");
    await call("select * from public.mark_dashboard_notification_read($1)",[item.notification_id]);
    await db.query("update public.work_order_items set quantity=1 where work_order_id=$1",[job.id]);await flushShortages();
    expect((await tracking()).find((r:{notification_id:string})=>r.notification_id===item.notification_id).episode_status).toBe("resolved");
    await call("select * from public.dismiss_dashboard_notification($1)",[item.notification_id]);
    expect((await db.query("select dismissed_at::text stamp from public.work_order_shortage_notification_recipients where id=$1",[item.notification_id])).rows[0].stamp).toBe(old);
    expect((await tracking()).some((r:{notification_id:string})=>r.notification_id===item.notification_id)).toBe(false);
    expect(await eventTypes(job.id,p.id)).toEqual(["opened","resolved"]);
  });
  it("WO-08 counts Products and Work Orders uniquely and enforces current owner permissions",async()=>{
    await grant(["dashboard.view","work_orders.view"]);
    const before=await activeCount(member),p=await product(false,["0","0","0"]),a=await general(p.id,"2"),b=await general(p.id,"3");await flushShortages();
    expect(await activeCount(member)).toBe(before+2n);
    const other=await product(false,["0","0","0"]);
    await db.query("insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id) values($1,$2,1,$3)",[a.id,other.id,admin.id]);
    await flushShortages();expect(await activeCount(member)).toBe(before+3n);
    const alert=(await tracking(member)).find((r:{work_order_id:string})=>r.work_order_id===a.id);
    await expect(call("select * from public.dismiss_dashboard_notification($1)",[alert.notification_id],admin)).rejects.toMatchObject({code:"P0002"});
    await expect(call("select * from public.work_order_shortage_resolved_dismissals",[],member)).rejects.toMatchObject({code:"42501"});
    await expect(call("select * from public.work_order_shortage_tracking_rows($1)",[admin.id],member)).rejects.toMatchObject({code:"42501"});
    await expect(call("select public.get_dashboard_alert_counts()",[],admin,"anon")).rejects.toMatchObject({code:"42501"});
    await grant(["dashboard.view"]);expect(await activeCount(member)).toBe(0n);
    expect((await tracking(member)).filter((r:{target_type:string})=>r.target_type==="work_order")).toEqual([]);
    await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);
    await expect(tracking(member)).rejects.toMatchObject({code:"42501"});
    expect((await episodes(b.id,p.id))).toHaveLength(1);
  });
  it("WO-08 serializes dismissal with the authoritative episode lock and rechecks active state",async()=>{
    const alert=(await db.query(`select r.id from public.work_order_shortage_notification_recipients r
      join public.work_order_material_shortage_notification_outbox o on o.id=r.outbox_id
      join public.work_order_material_shortage_episodes e on e.id=o.episode_id
      where e.work_order_id=$1 and r.recipient_user_id=$2`,[concurrentFixture.workOrderId,admin.id])).rows[0].id;
    const first=guardRollbackQueries(await pool!.connect(),testSignal),second=guardRollbackQueries(await pool!.connect(),testSignal);
    branches.push(first,second);
    await first.client.query("begin;set local statement_timeout='8s'");
    await second.client.query("begin;set local statement_timeout='8s';set local lock_timeout='5s'");
    await first.client.query("select id from public.work_order_material_shortage_episodes where work_order_id=$1 for update",[concurrentFixture.workOrderId]);
    const pid=(await second.client.query("select pg_backend_pid() pid")).rows[0].pid;
    await second.client.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.auth_user_id]);
    await second.client.query("set local role authenticated");
    const pending=second.client.query("select * from public.dismiss_dashboard_notification($1)",[alert])
      .then(()=>({code:"unexpected-success"}),error=>({code:error.code as string}));
    let blocked=false;
    for(let i=0;i<30&&!blocked;i++)blocked=(await db.query("select cardinality(pg_blocking_pids($1))>0 blocked",[pid])).rows[0].blocked;
    expect(blocked).toBe(true);
    await rollbackReservationTransactions([first]);branches.splice(branches.indexOf(first),1);
    expect(await pending).toEqual({code:"55000"});
  });
  it("WO-08 keeps Project unread counts and navigation independent of active shortage counts",async()=>{
    const p=await product(false,["0","0","0"]),job=await general(p.id,"2");await flushShortages();
    const counts=async()=>(await call("select public.get_dashboard_alert_counts() result",[]))[0].result;
    const before=await counts(),projectId=(await db.query("select project_id from public.work_orders where id=$1",[job.id])).rows[0].project_id;
    const activity=(await call("select * from public.post_project_activity($1,$2,'WO-08 Project compatibility','Owned local fixture',true)",[projectId,randomUUID()]))[0];
    const notification=(await tracking()).find((r:{activity_id?:string})=>r.activity_id===activity.activity_id);
    expect(notification).toMatchObject({target_type:"project",project_id:projectId});
    const after=await counts();expect(after.active_work_order_shortages).toBe(before.active_work_order_shortages);
    expect(BigInt(after.unread_project_notifications)).toBe(BigInt(before.unread_project_notifications)+1n);
    await call("select * from public.mark_dashboard_notification_read($1)",[notification.notification_id]);
    expect((await counts()).unread_project_notifications).toBe(before.unread_project_notifications);
    expect(await activeCount()).toBe(BigInt(before.active_work_order_shortages));
  });
  it("WO-05 reads expired holds immediately and reconciles stale historical episodes only on the next trigger",async()=>{
    const p=await product(false,["5","0","0"]),calc=await hold(p.id,raw,"2",true),job=await general(p.id,"5");
    await flushShortages();
    const boundary=(await db.query(`select public.get_production_free_warehouse_quantity_at($1,$2,expires_at-interval '1 microsecond')::text before,
      public.get_production_free_warehouse_quantity_at($1,$2,expires_at)::text at_expiry from public.test_calculations where id=$3`,[p.id,raw,calc])).rows[0];
    expect(boundary).toEqual({before:"3",at_expiry:"5"});
    // Valid expired hold plus a historical pre-expiry observation models lazy catch-up,
    // without changing database time, schema constraints, or immutable saved holds.
    const episode=(await db.query(`insert into public.work_order_material_shortage_episodes
      (work_order_id,work_order_number,product_id,product_name_snapshot,required_quantity,eligible_quantity,missing_quantity)
      select $1,work_order_number,$2,'Historical held material',5,3,2 from public.work_orders where id=$1 returning id`,[job.id,p.id])).rows[0].id;
    const event=(await db.query(`insert into public.work_order_material_shortage_events
      (episode_id,work_order_id,product_id,revision,event_type,required_quantity,eligible_quantity,missing_quantity)
      values($1,$2,$3,1,'opened',5,3,2) returning id`,[episode,job.id,p.id])).rows[0].id;
    await db.query("insert into public.work_order_material_shortage_notification_outbox(event_id,episode_id,event_type) values($1,$2,'opened')",[event,episode]);
    const before=await reservationSnapshot(db);
    expect((await read(job.id)).materials[0]).toMatchObject({eligible_quantity:"5",missing_quantity:"0",has_shortage:false});
    expect(await reservationSnapshot(db)).toEqual(before);
    expect((await episodes(job.id,p.id))[0].resolved).toBe(false);
    await db.query("update public.work_orders set updated_at=clock_timestamp() where id=$1",[job.id]);await flushShortages();
    expect((await episodes(job.id,p.id))[0].resolved).toBe(true);
    expect(await intents(job.id)).toEqual(["opened","resolved"]);
    expect((await db.query("select quantity::text q from public.test_calculation_holds where calculation_id=$1",[calc])).rows[0].q).toBe("2");
    expect((await consistency(p.id)).map(r=>r.physical)).toEqual(["5","0","0"]);
  });
});
