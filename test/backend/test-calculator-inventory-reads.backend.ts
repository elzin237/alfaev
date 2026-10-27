import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { LOCAL_RESERVATION, ReservationLocalTarget, reservationSnapshot,
  rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const enabled = process.env.TEST_CALCULATOR_INVENTORY_LOCAL === "1";
const foundation = readFileSync("supabase/migrations/20261027100000_add_test_calculator_foundation.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261027110000_add_test_calculator_search_and_preview.sql", "utf8");
const raw = "10000000-0000-4000-8000-000000000001", fg = "10000000-0000-4000-8000-000000000002", customs = "10000000-0000-4000-8000-000000000003";
const saveMigration=readFileSync("supabase/migrations/20261027120000_add_atomic_test_calculator_save.sql","utf8");
const protectionMigration=readFileSync("supabase/migrations/20261027130000_protect_test_calculator_warehouse_holds.sql","utf8");
const productionMigration=readFileSync("supabase/migrations/20261027140000_protect_test_holds_in_production_plans.sql","utf8");
const coexistenceMigration=readFileSync("supabase/migrations/20261027150000_protect_test_holds_in_project_reservation_admission.sql","utf8");
const inventoryMigration=readFileSync("supabase/migrations/20261027160000_add_expiry_aware_inventory_test_commitments.sql","utf8");
const saveSql="select public.save_test_calculation($1,$2,$3::jsonb,$4::date) receipt";

describe.skipIf(!enabled)("Expiry-aware Inventory Test reads — owned local clone only", () => {
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
    if (process.env.TEST_CALCULATOR_INVENTORY_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw new Error("Owned-clone peer scope required");
    source = target.pool(); await target.acquire(source); sourceBaseline = await snapshot(source);
    await target.createTemporary(source,name); created=true;
    // Non-secret positive ownership evidence remains visible if setup/teardown fails.
    console.info(`TC-08 newly owned local clone: ${name}`);
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
        await setup.query(inventoryMigration);await setup.query("commit"); }
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



  const readSql="select * from public.get_inventory_test_commitments($1,$2)";
  const read=(warehouse:string,search:string|null=null,actor=admin)=>call(readSql,[warehouse,search],actor);
  const one=async(warehouse:string,id:string,actor=admin)=>(await read(warehouse,null,actor)).find(r=>r.product_id===id);
  async function holdAt(productId:string,warehouse:string,quantity:string,date:string){
    const calc=randomUUID(),item=randomUUID();
    await db.query(`insert into public.test_calculations(id,name,created_by_user_id,created_at,deadline_date,expires_at,request_id,submitted_payload,save_receipt)
      values($1,'Owned expiry fixture',$2,'2019-01-01',$3::date,($3::date+1)::timestamp at time zone 'Europe/Sarajevo',$4,'{}','{}')`,[calc,admin.id,date,randomUUID()]);
    await db.query(`insert into public.test_calculation_items(id,calculation_id,product_id,product_name_snapshot,serial_number_snapshot,product_kind_snapshot,required_quantity,held_quantity,uncovered_quantity)
      select $1,$2,id,name,serial_number,product_kind,$4::bigint,$4::bigint,0 from public.products where id=$3`,[item,calc,productId,quantity]);
    await db.query("insert into public.test_calculation_holds(item_id,calculation_id,product_id,warehouse_id,quantity) values($1,$2,$3,$4,$5::bigint)",[item,calc,productId,warehouse,quantity]);
    await db.query("set constraints all immediate;set constraints all deferred");
    return calc;
  }
  it("aggregates overlapping mixed holds with signed Raw planning and independent Customs",async()=>{
    const p=await product(false,["10","7","6"]);await demand(p.id,"20");
    await hold(p.id,raw,"2");await hold(p.id,raw,"3");await hold(p.id,customs,"2");await hold(p.id,fg,"1");await hold(p.id,raw,"8",true);
    const before=await reservationSnapshot(db),r=await one(raw,p.id),c=await one(customs,p.id);
    expect(r).toMatchObject({quantity_scope:"raw_customs_planning",physical_quantity:"10",project_commitment_quantity:"20",available_after_projects:"-3",committed_to_tests:"7",available_after_projects_and_tests:"-10"});
    expect(c).toMatchObject({quantity_scope:"customs_physical",physical_quantity:"7",project_commitment_quantity:"0",available_after_projects:"7",committed_to_tests:"2",available_after_projects_and_tests:"5"});
    expect(r.next_expiry.toISOString()).toBe("2030-01-01T23:00:00.000Z");expect(c.next_expiry).toEqual(r.next_expiry);
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("reads FG physical, Project hard reservations and Tests without Raw/Customs leakage",async()=>{
    const p=await product(true,["100","100","10"]),project=await demand(p.id,"8");
    await call("select * from public.reserve_finished_goods_for_project($1,$2,3,0,$3)",[project,p.id,randomUUID()]);
    await save(p.id,"4");await hold(p.id,raw,"20");await hold(p.id,customs,"20");
    const before=await reservationSnapshot(db),row=await one(fg,p.id);
    expect(row).toMatchObject({quantity_scope:"finished_goods_reservations",physical_quantity:"10",project_commitment_quantity:"3",available_after_projects:"7",committed_to_tests:"4",available_after_projects_and_tests:"3"});
    expect(Object.keys(row).sort()).toEqual(["product_id","warehouse_id","quantity_scope","physical_quantity","project_commitment_quantity","available_after_projects","committed_to_tests","available_after_projects_and_tests","as_of","next_expiry"].sort());
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("returns zero for missing/expired holds with null next expiry and preserves history",async()=>{
    const p=await product(false,["5","0","0"]);await hold(p.id,raw,"5",true);
    const before=await reservationSnapshot(db),row=await one(raw,p.id);
    expect(row).toMatchObject({physical_quantity:"5",committed_to_tests:"0",available_after_projects_and_tests:"5",next_expiry:null});
    expect(await reservationSnapshot(db)).toEqual(before);
    expect((await db.query("select count(*)::int n from public.test_calculation_holds where product_id=$1",[p.id])).rows[0].n).toBe(1);
    const other=await product(false,["1","0","0"]),otherBaseline=await reservationSnapshot(db);
    expect(await one(raw,other.id)).toMatchObject({committed_to_tests:"0",next_expiry:null});
    expect(await reservationSnapshot(db)).toEqual(otherBaseline);
  });
  it("uses a common as-of snapshot and the next relevant positive authorized expiry",async()=>{
    const p=await product(false,["10","10","0"]);
    await holdAt(p.id,raw,"2","2030-01-03");await holdAt(p.id,customs,"3","2030-01-02");
    await holdAt(p.id,fg,"1","2030-01-01");await holdAt(p.id,raw,"4","2020-01-01");
    const before=await reservationSnapshot(db),rows=await read(raw),row=rows.find(r=>r.product_id===p.id);
    expect(new Set(rows.map(r=>r.as_of.toISOString())).size).toBe(1);
    expect(row).toMatchObject({committed_to_tests:"5",available_after_projects_and_tests:"15"});
    expect(row.next_expiry.toISOString()).toBe("2030-01-02T23:00:00.000Z");
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("validates exclusive Sarajevo midnight and 23/25-hour DST days in PostgreSQL",async()=>{
    const rows=(await db.query(`with deadlines(d) as (values('2030-03-30'::date),('2030-03-31'::date),('2030-10-26'::date),('2030-10-27'::date)),
      boundaries as(select d,(d+1)::timestamp at time zone 'Europe/Sarajevo' expires_at,d::timestamp at time zone 'Europe/Sarajevo' starts_at from deadlines)
      select d::text,expires_at,expires_at>expires_at-interval '1 microsecond' active_before,
      expires_at>expires_at active_at,extract(epoch from expires_at-starts_at)/3600 hours from boundaries order by d`)).rows;
    expect(rows.map(r=>Number(r.hours))).toEqual([24,23,24,25]);
    for(const row of rows){expect(row.active_before).toBe(true);expect(row.active_at).toBe(false);}
    expect(rows[1].expires_at.toISOString()).toBe("2030-03-31T22:00:00.000Z");
    expect(rows[3].expires_at.toISOString()).toBe("2030-10-27T23:00:00.000Z");
  });
  it("enforces warehouse permissions without requiring Test authority or leaking other warehouses",async()=>{
    const ordinary=await product(),finished=await product(true);
    await grant(["inventory.finished_goods.view"]);expect(await one(fg,finished.id,member)).toBeDefined();
    await expect(read(raw,null,member)).rejects.toMatchObject({code:"42501"});await expect(read(customs,null,member)).rejects.toMatchObject({code:"42501"});
    await grant(["inventory.raw_materials.view"]);await expect(read(raw,null,member)).rejects.toMatchObject({code:"42501"});
    await grant(["inventory.customs.view"]);expect(await one(customs,ordinary.id,member)).toBeDefined();
    await expect(read(raw,null,member)).rejects.toMatchObject({code:"42501"});
    await grant(["inventory.raw_materials.view","inventory.customs.view"]);expect(await one(raw,ordinary.id,member)).toBeDefined();
    await expect(read(fg,null,member)).rejects.toMatchObject({code:"42501"});
    await grant(["test_calculator.view","test_calculator.manage"]);await expect(read(fg,null,member)).rejects.toMatchObject({code:"42501"});
    await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);
    await expect(read(raw,null,member)).rejects.toMatchObject({code:"42501"});
    for(const role of ["anon","service_role"])await expect(call(readSql,[raw,null],admin,role)).rejects.toMatchObject({code:"42501"});
    await expect(call("select * from public.test_calculations",[],admin)).rejects.toMatchObject({code:"42501"});
  });
  it("preserves warehouse membership, archived rows, literal search and ordering",async()=>{
    const p=await product(false,["5","0","0"]),output=await product(true,["0","0","0"]);
    expect(await one(fg,p.id)).toBeUndefined();expect(await one(fg,output.id)).toBeDefined();expect(await one(customs,p.id)).toBeUndefined();
    await transfer(p.id,raw,customs,"2");await adjust(p.id,customs,"remove","2");expect(await one(customs,p.id)).toBeDefined();
    await db.query("update public.products set is_active=false,archived_at=clock_timestamp(),archived_by_user_id=$2 where id=$1",[output.id,admin.id]);
    expect(await one(fg,output.id)).toBeDefined();expect(await read(raw,"%")).toEqual([]);
    const a=await read(raw,p.serial);expect(a.map(row=>row.product_id)).toEqual([p.id]);
    const ids=(await db.query("select id from public.search_inventory_products_by_warehouse($1,null)",[raw])).rows.map(r=>r.id);
    expect((await read(raw)).map(r=>r.product_id)).toEqual(ids);
  });
  it("keeps quantities beyond JavaScript and aggregate bigint limits exact",async()=>{
    const p=await product(false,["9223372036854775807","9223372036854775807","0"]);
    await hold(p.id,raw,"9007199254740993");await hold(p.id,customs,"9007199254740993");
    const before=await reservationSnapshot(db),row=await one(raw,p.id);
    expect(row).toMatchObject({physical_quantity:"9223372036854775807",available_after_projects:"18446744073709551614",committed_to_tests:"18014398509481986",available_after_projects_and_tests:String(18446744073709551614n-18014398509481986n)});
    for(const key of ["physical_quantity","project_commitment_quantity","available_after_projects","committed_to_tests","available_after_projects_and_tests"])expect(typeof row[key]).toBe("string");
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("preserves existing planning fields including legacy linked-output Raw scope",async()=>{
    const p=await product(true,["10","5","6"]);await demand(p.id,"8");
    const old=(await call("select * from public.get_inventory_project_commitments()",[])).find(r=>r.product_id===p.id),row=await one(raw,p.id);
    expect(row.available_after_projects).toBe(old.available_after_commitments);
    expect(row.project_commitment_quantity).toBe(old.committed_to_projects);
    expect(row).toMatchObject({physical_quantity:"10",available_after_projects:"7",available_after_projects_and_tests:"7"});
  });
  it("exposes exactly one trusted read with private tables and no read mutations",async()=>{
    const before=await reservationSnapshot(db);for(const warehouse of [raw,customs,fg])await read(warehouse);
    expect(await reservationSnapshot(db)).toEqual(before);
    const fn="public.get_inventory_test_commitments(uuid,text)";
    expect((await db.query("select prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure",[fn])).rows[0])
      .toMatchObject({prosecdef:true,provolatile:"s",proconfig:['search_path=""']});
    for(const role of ["anon","service_role"])expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,fn])).rows[0].allowed).toBe(false);
    expect((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and prosecdef")).rows[0].n).toBe(195);
  });
});
