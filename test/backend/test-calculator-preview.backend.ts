import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { LOCAL_RESERVATION, ReservationLocalTarget, reservationSnapshot,
  rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const enabled = process.env.TEST_CALCULATOR_PREVIEW_LOCAL === "1";
const foundation = readFileSync("supabase/migrations/20261027100000_add_test_calculator_foundation.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261027110000_add_test_calculator_search_and_preview.sql", "utf8");
const raw = "10000000-0000-4000-8000-000000000001", fg = "10000000-0000-4000-8000-000000000002", customs = "10000000-0000-4000-8000-000000000003";
const previewSql = "select * from public.preview_test_calculation($1::jsonb)";
const searchSql = "select * from public.search_test_calculator_products($1,100)";

describe.skipIf(!enabled)("Test Calculator read contracts — owned local clone only", () => {
  const target = new ReservationLocalTarget(), name = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  let source: LocalReservationPool | undefined, pool: LocalReservationPool | undefined;
  let sourceBaseline: unknown, baseline: unknown, created = false, db: PoolClient;
  let transaction: ReturnType<typeof guardRollbackQueries> | undefined;
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
    return {id,serial};
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
  const preview = (id: string, quantity = "8", actor = admin) => call(previewSql,[JSON.stringify([{product_id:id,quantity}])],actor);
  async function grant(keys: string[]) {
    await db.query("delete from public.user_permissions where user_id=$1",[member.id]);
    await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,admin.id,keys]);
  }
  beforeAll(async () => {
    if (process.env.TEST_CALCULATOR_PREVIEW_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw new Error("Owned-clone peer scope required");
    source = target.pool(); await target.acquire(source); sourceBaseline = await snapshot(source);
    await target.createTemporary(source,name); created=true; target.copyIntoTemporary(name); pool=target.pool(name);
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
      if(!admin||!member)throw new Error("Existing local identities required"); baseline=await reservationSnapshot(setup);
    } finally {setup.release(true);}
  });
  beforeEach(async context => {
    await target.assertQuiet();const client=await pool!.connect();await client.query("begin");transaction=guardRollbackQueries(client,context.signal);db=transaction.client;
    await db.query("set local statement_timeout='15s'; set local lock_timeout='3s'");await db.query(foundation);await db.query(migration);
  });
  afterEach(async () => {
    let failure:unknown;
    if(transaction){const current=transaction;transaction=undefined;try{await rollbackReservationTransactions([current]);}catch(error){failure=error;}}
    try{if(pool&&baseline)expect(await snapshot(pool)).toEqual(baseline);}finally{if(failure)throw failure;}
  });
  afterAll(async () => {
    try {if(pool)await pool.end();if(source&&sourceBaseline)expect(await snapshot(source)).toEqual(sourceBaseline);
      if(created&&source){await target.dropTemporary(source,name);expect((await source.query("select exists(select 1 from pg_database where datname=$1) present",[name])).rows[0].present).toBe(false);}
      if(source&&sourceBaseline)expect(await snapshot(source)).toEqual(sourceBaseline);
    } finally {await target.release();if(source)await source.end();}
  });

  it("reads ordinary demand once and excludes active but not expired Test holds",async()=>{
    const p=await product();await demand(p.id,"3");await hold(p.id,raw,"2");await hold(p.id,customs,"1",true);
    const before=await reservationSnapshot(db),rows=await preview(p.id);
    expect(rows[0]).toMatchObject({required_quantity:"8",eligible_free_quantity:"10",project_priority_quantity:"3",eligible_availability:"7",reservable_quantity:"7",missing_quantity:"1",save_will_recalculate:true});
    expect(rows[0].provisional_warehouse_quantities.map((w:{quantity:string})=>w.quantity)).toEqual(["3","4","0"]);
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it.each([["0","0","0","4","0","4"],["2","0","0","4","2","2"],["5","4","3","12","12","0"]])
    ("previews zero/partial/full stock %s/%s/%s",async(r,c,f,q,reserved,missing)=>{
      const p=await product(false,[r,c,f]);const rows=await preview(p.id,q);
      expect(rows[0]).toMatchObject({reservable_quantity:reserved,missing_quantity:missing});
      if(q==="12")expect(rows[0].provisional_warehouse_quantities.map((w:{quantity:string})=>w.quantity)).toEqual(["5","4","3"]);
    });
  it("uses FG only, subtracts hard Project reservations and never double-subtracts FG demand",async()=>{
    const p=await product(true,["100","100","10"]),project=await demand(p.id,"100");
    await call("select * from public.reserve_finished_goods_for_project($1,$2,3,0,$3)",[project,p.id,randomUUID()]);
    await hold(p.id,fg,"2");await hold(p.id,fg,"4",true);
    const rows=await preview(p.id);
    expect(rows[0]).toMatchObject({eligible_free_quantity:"5",project_priority_quantity:"0",eligible_availability:"5",reservable_quantity:"5",missing_quantity:"3"});
    expect(rows[0].provisional_warehouse_quantities).toEqual([{warehouse_id:fg,warehouse_code:"finished_goods",quantity:"5"}]);
  });
  it("preserves bigint precision in every quantity and provisional allocation",async()=>{
    const p=await product(false,["9007199254740993","0","0"]),rows=await preview(p.id,"9007199254740994");
    expect(rows[0]).toMatchObject({required_quantity:"9007199254740994",eligible_free_quantity:"9007199254740993",reservable_quantity:"9007199254740993",missing_quantity:"1"});
    expect(rows[0].provisional_warehouse_quantities[0].quantity).toBe("9007199254740993");
  });
  it("enforces Test and warehouse authority without leaking ordinary candidates to FG-only users",async()=>{
    const ordinary=await product(),finished=await product(true);
    await grant(["pcb.edit","inventory.finished_goods.view"]);
    await expect(preview(finished.id,"1",member)).rejects.toMatchObject({code:"42501"});
    await grant(["test_calculator.view","inventory.finished_goods.view"]);
    await expect(preview(finished.id,"1",member)).rejects.toMatchObject({code:"42501"});
    await grant(["test_calculator.view","test_calculator.manage","inventory.finished_goods.view"]);
    expect(await call(searchSql,[finished.serial],member)).toHaveLength(1);
    expect(await call(searchSql,[ordinary.serial],member)).toEqual([]);
    await expect(preview(ordinary.id,"1",member)).rejects.toMatchObject({code:"42501"});
    expect(await preview(finished.id,"1",member)).toHaveLength(1);
    for(const role of ["anon","service_role"])await expect(call(searchSql,[null],admin,role)).rejects.toMatchObject({code:"42501"});
    await expect(call("select * from public.test_calculations",[],member)).rejects.toMatchObject({code:"42501"});
    await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);
    await expect(preview(finished.id,"1",member)).rejects.toMatchObject({code:"42501"});
    await expect(call(searchSql,[finished.serial],member)).rejects.toMatchObject({code:"42501"});
  });
  it("rejects invalid/duplicate/unknown/archived/unlinked selections without writes",async()=>{
    const p=await product();
    for(const input of [null,{},[],[{product_id:p.id,quantity:1}],[{product_id:p.id,quantity:"0"}],
      [{product_id:p.id,quantity:"9223372036854775808"}],[{product_id:p.id,quantity:"1",extra:true}],
      [{product_id:p.id,quantity:"1"},{product_id:p.id.toUpperCase(),quantity:"2"}]])
      await expect(call(previewSql,[JSON.stringify(input)])).rejects.toMatchObject({code:"22023"});
    await expect(preview(randomUUID())).rejects.toMatchObject({code:"42501"});
    const orphan=await product(true,["0","0","0"],false);await expect(preview(orphan.id)).rejects.toMatchObject({code:"42501"});
    await db.query("update public.products set is_active=false,archived_at=clock_timestamp(),archived_by_user_id=$2 where id=$1",[p.id,admin.id]);
    const before=await reservationSnapshot(db);await expect(preview(p.id)).rejects.toMatchObject({code:"42501"});
    expect(await call(searchSql,[p.serial])).toEqual([]);expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("keeps search literal, validates limits and exposes only explicit read grants",async()=>{
    await product();const before=await reservationSnapshot(db);
    expect(await call(searchSql,["%"])) .toEqual([]);
    await expect(call("select * from public.search_test_calculator_products(null,101)",[])).rejects.toMatchObject({code:"22023"});
    for(const fn of ["public.search_test_calculator_products(text,integer)","public.preview_test_calculation(jsonb)"]){
      const row=(await db.query("select prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure",[fn])).rows[0];
      expect(row).toMatchObject({prosecdef:true,provolatile:"s",proconfig:['search_path=""']});
      for(const role of ["anon","service_role"])expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,fn])).rows[0].allowed).toBe(false);
    }
    expect((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and prosecdef")).rows[0].n).toBe(192);
    expect(await reservationSnapshot(db)).toEqual(before);
  });
});
