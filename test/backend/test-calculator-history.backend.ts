import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { LOCAL_RESERVATION, ReservationLocalTarget, reservationSnapshot,
  rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const enabled = process.env.TEST_CALCULATOR_HISTORY_LOCAL === "1";
const foundation = readFileSync("supabase/migrations/20261027100000_add_test_calculator_foundation.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261027110000_add_test_calculator_search_and_preview.sql", "utf8");
const raw = "10000000-0000-4000-8000-000000000001", fg = "10000000-0000-4000-8000-000000000002", customs = "10000000-0000-4000-8000-000000000003";
const saveMigration=readFileSync("supabase/migrations/20261027120000_add_atomic_test_calculator_save.sql","utf8");
const protectionMigration=readFileSync("supabase/migrations/20261027130000_protect_test_calculator_warehouse_holds.sql","utf8");
const productionMigration=readFileSync("supabase/migrations/20261027140000_protect_test_holds_in_production_plans.sql","utf8");
const coexistenceMigration=readFileSync("supabase/migrations/20261027150000_protect_test_holds_in_project_reservation_admission.sql","utf8");
const inventoryMigration=readFileSync("supabase/migrations/20261027160000_add_expiry_aware_inventory_test_commitments.sql","utf8");
const historyMigration=readFileSync("supabase/migrations/20261027170000_add_test_calculation_history_reads.sql","utf8");
const saveSql="select public.save_test_calculation($1,$2,$3::jsonb,$4::date) receipt";

describe.skipIf(!enabled)("Saved Test Calculation history reads — owned local clone only", () => {
  const target = new ReservationLocalTarget(), name = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  let source: LocalReservationPool | undefined, pool: LocalReservationPool | undefined;
  let sourceBaseline: unknown, baseline: unknown, created = false, db: PoolClient;
  let transaction: ReturnType<typeof guardRollbackQueries> | undefined;
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
  async function grant(keys: string[]) {
    await db.query("delete from public.user_permissions where user_id=$1",[member.id]);
    await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,admin.id,keys]);
  }
  beforeAll(async () => {
    if (process.env.TEST_CALCULATOR_HISTORY_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw new Error("Owned-clone peer scope required");
    source = target.pool(); await target.acquire(source); sourceBaseline = await snapshot(source);
    await target.createTemporary(source,name); created=true;
    // Non-secret positive ownership evidence remains visible if setup/teardown fails.
    console.info(`Task 9 newly owned local clone: ${name}`);
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
        await setup.query(inventoryMigration);await setup.query(historyMigration);await setup.query("commit"); }
      catch(error){await setup.query("rollback");throw error;}
      baseline=await reservationSnapshot(setup);
    } finally {setup.release(true);}
  });
  beforeEach(async context => {
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


  const listSql="select * from public.list_test_calculations($1,$2,$3)";
  const detailSql="select public.get_test_calculation($1) result";
  const list=(limit=50,before:Date|null=null,id:string|null=null,actor=admin)=>call(listSql,[limit,before,id],actor);
  const detail=async(id:string|null,actor=admin)=>(await call(detailSql,[id],actor))[0].result;
  const headerKeys=["calculation_id","name","creator_full_name","created_at","deadline_date","deadline_timezone","expires_at","status","as_of"];
  async function seeded(productId:string,expired=false,actor=admin,required="9",held="5"){
    const id=randomUUID(),item=randomUUID(),request=randomUUID();
    await db.query(`insert into public.test_calculations(id,name,created_by_user_id,created_at,deadline_date,expires_at,request_id,submitted_payload,save_receipt)
      values($1,'Owned history fixture',$2,'2019-01-01',$3::date,($3::date+1)::timestamp at time zone 'Europe/Sarajevo',$4,
      '{"private_marker":"never_expose_payload"}','{"private_marker":"never_expose_receipt"}')`,[id,actor.id,expired?"2020-01-01":"2030-01-01",request]);
    await db.query(`insert into public.test_calculation_items(id,calculation_id,product_id,product_name_snapshot,serial_number_snapshot,product_kind_snapshot,required_quantity,held_quantity,uncovered_quantity)
      select $1,$2,id,'Saved historical name','0000123',product_kind,$4::bigint,$5::bigint,($4::numeric-$5::numeric)::bigint from public.products where id=$3`,[item,id,productId,required,held]);
    if(BigInt(held)>0n)await db.query("insert into public.test_calculation_holds(item_id,calculation_id,product_id,warehouse_id,quantity) values($1,$2,$3,$4,$5::bigint)",[item,id,productId,raw,held]);
    await db.query("set constraints all immediate;set constraints all deferred");
    return {id,item,request};
  }
  it("lists active and expired history and preserves saved quantities after expiry",async()=>{
    const p=await product(),a=await seeded(p.id),e=await seeded(p.id,true);
    const before=await reservationSnapshot(db),rows=await list();
    for(const [id,status] of [[a.id,"active"],[e.id,"expired"]]){
      const row=rows.find(r=>r.calculation_id===id);expect(row.status).toBe(status);
      expect(Object.keys(row).sort()).toEqual([...headerKeys].sort());
      const d=await detail(id!);expect(d.status).toBe(status);
      expect(d.items[0]).toMatchObject({required_quantity:"9",held_quantity:"5",missing_quantity:"4"});
      expect(d.items[0].holds).toEqual([{warehouse_id:raw,warehouse_code:"raw_materials",quantity:"5"}]);
      expect(Date.parse(d.expires_at)>Date.parse(d.as_of)).toBe(status==="active");
    }
    expect(new Set(rows.map(r=>r.as_of.toISOString())).size).toBe(1);
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("projects actual Save allocations and missing quantities without returning its receipt",async()=>{
    const p=await product(),receipt=await save(p.id,"15");
    const id=(await db.query("select id from public.test_calculations where created_by_user_id=$1 order by created_at desc limit 1",[admin.id])).rows[0].id;
    const d=await detail(id),item=d.items[0];
    expect(receipt).toBeDefined();expect(item).toMatchObject({required_quantity:"15",held_quantity:"12",missing_quantity:"3"});
    expect(item.holds.map((h:{quantity:string})=>h.quantity).sort()).toEqual(["3","4","5"]);
    expect(Object.keys(d).sort()).toEqual([...headerKeys,"items"].sort());
    expect(Object.keys(item).sort()).toEqual(["item_id","product_id","product_name_snapshot","serial_number_snapshot","product_kind_snapshot","required_quantity","held_quantity","missing_quantity","holds"].sort());
  });
  it("allows view-only shared history across creators without current warehouse permissions",async()=>{
    const p=await product(),a=await seeded(p.id),m=await seeded(p.id,false,member);
    await grant(["test_calculator.view"]);
    expect((await list(50,null,null,member)).map(r=>r.calculation_id)).toEqual(expect.arrayContaining([a.id,m.id]));
    expect((await detail(a.id,member)).creator_full_name).toBe((await db.query("select full_name from public.user_profiles where id=$1",[admin.id])).rows[0].full_name);
    await db.query("update public.user_profiles set is_active=false where id=$1",[admin.id]);
    expect((await detail(a.id,member)).calculation_id).toBe(a.id);
  });
  it("denies missing view authority, inactive, anonymous and service-role callers before existence disclosure",async()=>{
    const p=await product(),a=await seeded(p.id);
    for(const permissions of [[],["test_calculator.manage"],["inventory.raw_materials.view","inventory.customs.view","inventory.finished_goods.view"]]){
      await grant(permissions);await expect(list(50,null,null,member)).rejects.toMatchObject({code:"42501"});
      await expect(detail(a.id,member)).rejects.toMatchObject({code:"42501"});
      await expect(detail(randomUUID(),member)).rejects.toMatchObject({code:"42501"});
    }
    await grant(["test_calculator.view"]);await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);
    await expect(detail(a.id,member)).rejects.toMatchObject({code:"42501"});
    for(const role of ["anon","service_role"]){
      await expect(call(listSql,[50,null,null],admin,role)).rejects.toMatchObject({code:"42501"});
      await expect(call(detailSql,[a.id],admin,role)).rejects.toMatchObject({code:"42501"});
    }
    await expect(call(listSql,[50,null,null],{id:admin.id,auth_user_id:""})).rejects.toMatchObject({code:"42501"});
  });
  it("retains snapshots for archived/renamed Products and never leaks private identities or payloads",async()=>{
    const p=await product(),a=await seeded(p.id);
    await db.query("update public.products set name='Current renamed Product',is_active=false,archived_at=clock_timestamp(),archived_by_user_id=$2 where id=$1",[p.id,admin.id]);
    const before=await reservationSnapshot(db),d=await detail(a.id);
    expect(d.items[0]).toMatchObject({product_name_snapshot:"Saved historical name",serial_number_snapshot:"0000123",product_id:p.id});
    const encoded=JSON.stringify([d,await list()]);
    for(const secret of [a.request,admin.auth_user_id,"never_expose_payload","never_expose_receipt","submitted_payload","save_receipt","auth_user_id","birthday","email"])expect(encoded).not.toContain(secret);
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("keeps SQL bigint quantities lossless and zero allocations distinct from expired saved holds",async()=>{
    const p=await product(),a=await seeded(p.id,true,admin,"9223372036854775807","9007199254740993");
    const z=await seeded(p.id,false,admin,"9223372036854775807","0"),d=await detail(a.id);
    expect(d.items[0]).toMatchObject({required_quantity:"9223372036854775807",held_quantity:"9007199254740993",missing_quantity:"9214364837600034814"});
    expect(d.items[0].holds[0].quantity).toBe("9007199254740993");
    const zero=(await detail(z.id)).items[0];expect(zero.held_quantity).toBe("0");expect(zero.holds).toEqual([]);
    const inventory=(await call("select * from public.get_inventory_test_commitments($1,$2)",[raw,p.serial]))[0];
    expect(inventory.committed_to_tests).toBe("0");
  });
  it("paginates deterministically across equal timestamps and validates all cursor inputs",async()=>{
    const p=await product(),a=await seeded(p.id),b=await seeded(p.id,true),c=await seeded(p.id);
    const rows=await list(100),expected:string[]=[a.id,b.id,c.id].sort().reverse(),ids:string[]=[];
    let page=await list(1);
    while(page.length){const r=page[0];ids.push(r.calculation_id);page=await list(1,r.created_at,r.calculation_id);}
    expect(ids).toEqual(rows.map(r=>r.calculation_id));expect(ids.filter(id=>expected.includes(id))).toEqual(expected);
    for(const args of [[0,null,null],[101,null,null],[null,null,null],[1,new Date(),null],[1,null,randomUUID()],[1,"infinity",randomUUID()]])
      await expect(call(listSql,args)).rejects.toMatchObject({code:"22023"});
    await expect(detail(null)).rejects.toMatchObject({code:"22023"});
    await expect(detail(randomUUID())).rejects.toMatchObject({code:"P0002"});
  });
  it("preserves RLS, table privacy and narrow trusted read grants without data/security/sequence writes",async()=>{
    const p=await product(),a=await seeded(p.id),before=await reservationSnapshot(db);
    await list();await detail(a.id);expect(await reservationSnapshot(db)).toEqual(before);
    for(const fn of ["public.list_test_calculations(integer,timestamptz,uuid)","public.get_test_calculation(uuid)"]){
      expect((await db.query("select prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure",[fn])).rows[0])
        .toMatchObject({prosecdef:true,provolatile:"s",proconfig:['search_path=""']});
      for(const role of ["anon","service_role"])expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,fn])).rows[0].allowed).toBe(false);
      expect((await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') allowed",[fn])).rows[0].allowed).toBe(true);
    }
    for(const table of ["test_calculations","test_calculation_items","test_calculation_holds"]){
      expect((await db.query("select relrowsecurity from pg_class where oid=$1::regclass",[`public.${table}`])).rows[0].relrowsecurity).toBe(true);
      await expect(call(`select * from public.${table}`,[])).rejects.toMatchObject({code:"42501"});
    }
    expect((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and prosecdef")).rows[0].n).toBe(197);
  });
});
