import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { LOCAL_RESERVATION, ReservationLocalTarget, reservationSnapshot,
  rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const enabled = process.env.TEST_CALCULATOR_PROTECTION_LOCAL === "1";
const foundation = readFileSync("supabase/migrations/20261027100000_add_test_calculator_foundation.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261027110000_add_test_calculator_search_and_preview.sql", "utf8");
const raw = "10000000-0000-4000-8000-000000000001", fg = "10000000-0000-4000-8000-000000000002", customs = "10000000-0000-4000-8000-000000000003";
const saveMigration=readFileSync("supabase/migrations/20261027120000_add_atomic_test_calculator_save.sql","utf8");
const protectionMigration=readFileSync("supabase/migrations/20261027130000_protect_test_calculator_warehouse_holds.sql","utf8");
const saveSql="select public.save_test_calculation($1,$2,$3::jsonb,$4::date) receipt";

describe.skipIf(!enabled)("Test Calculator warehouse protection — owned local clone only", () => {
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
    if (process.env.TEST_CALCULATOR_PROTECTION_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw new Error("Owned-clone peer scope required");
    source = target.pool(); await target.acquire(source); sourceBaseline = await snapshot(source);
    await target.createTemporary(source,name); created=true;
    // Non-secret positive ownership evidence remains visible if setup/teardown fails.
    console.info(`TC-05 newly owned local clone: ${name}`);
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
      try { await setup.query(foundation);await setup.query(migration);await setup.query(saveMigration);await setup.query(protectionMigration);await setup.query("commit"); }
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
  it.each([[raw,["10","0","0"]],[customs,["0","10","0"]],[fg,["0","0","10"]]] as const)
    ("protects Remove/Correction in warehouse %s, including Admin",async(warehouse,quantities)=>{
      const p=await product(false,[...quantities]);await hold(p.id,warehouse,"7");
      const before=await reservationSnapshot(db);
      await expect(adjust(p.id,warehouse,"remove","4")).rejects.toMatchObject({code:"IVB02"});
      await expect(adjust(p.id,warehouse,"correction","6")).rejects.toMatchObject({code:"IVB02"});
      expect(await reservationSnapshot(db)).toEqual(before);
      expect((await adjust(p.id,warehouse,"remove","3"))[0].quantity_after).toBe("7");
      const immutable=(await db.query("select quantity::text from public.test_calculation_holds where product_id=$1",[p.id])).rows;
      expect(immutable).toEqual([{quantity:"7"}]);await consistency(p.id);
    });
  it("enforces combined Test and hard Project FG protection",async()=>{
    const p=await product(true,["0","0","10"]),project=await demand(p.id,"3");
    await call("select * from public.reserve_finished_goods_for_project($1,$2,3,0,$3)",[project,p.id,randomUUID()]);
    const receipt=await save(p.id,"4");expect(receipt.items[0].held_quantity).toBe("4");
    await expect(adjust(p.id,fg,"remove","4")).rejects.toMatchObject({code:"IVB02"});
    expect((await adjust(p.id,fg,"correction","7"))[0].quantity_after).toBe("7");
    expect((await db.query("select reserved_quantity::text from public.finished_goods_project_reservations where project_id=$1",[project])).rows[0].reserved_quantity).toBe("3");
    await consistency(p.id);
  });
  it.each([[raw,customs],[customs,fg],[fg,raw]])
    ("blocks held-stock transfer %s -> %s but transfers genuine free stock",async(from,to)=>{
      const quantities=[raw,customs,fg].map(w=>w===from?"10":"0"),p=await product(false,quantities);
      await hold(p.id,from,"7");const before=await reservationSnapshot(db);
      await expect(transfer(p.id,from,to,"4")).rejects.toMatchObject({code:"IVB02"});
      expect(await reservationSnapshot(db)).toEqual(before);
      const moved=(await transfer(p.id,from,to,"3"))[0];
      expect(moved.source_quantity_after).toBe("7");expect(moved.destination_quantity_after).toBe("3");
      expect((await db.query("select warehouse_id,quantity::text from public.test_calculation_holds where product_id=$1",[p.id])).rows)
        .toEqual([{warehouse_id:from,quantity:"7"}]);await consistency(p.id);
    });
  it("ignores expired holds without changing immutable history",async()=>{
    const p=await product(false,["10","0","0"]);await hold(p.id,raw,"7",true);
    const history=(await db.query("select to_jsonb(h) data from public.test_calculation_holds h where product_id=$1",[p.id])).rows;
    expect((await adjust(p.id,raw,"remove","10"))[0].quantity_after).toBe("0");
    expect((await db.query("select to_jsonb(h) data from public.test_calculation_holds h where product_id=$1",[p.id])).rows).toEqual(history);
    await consistency(p.id);
  });
  it("retains ordinary warehouse behavior, FIFO provenance and precision",async()=>{
    const p=await product(false,["9007199254740993","0","0"]);
    await hold(p.id,raw,"9007199254740992");
    expect((await adjust(p.id,raw,"remove","1"))[0].quantity_after).toBe("9007199254740992");
    await expect(adjust(p.id,raw,"remove","1")).rejects.toMatchObject({code:"IVB02"});await consistency(p.id);
    const free=await product(false,["5","0","0"]);
    await transfer(free.id,raw,customs,"2");await adjust(free.id,customs,"correction","1");await adjust(free.id,raw,"remove","3");
    await consistency(free.id);
    const lots=(await db.query("select l.id,l.remaining_quantity::text quantity from public.inventory_source_lots l where l.product_id=$1 order by l.received_at,l.id",[free.id])).rows;
    expect(lots.map(l=>l.quantity)).toEqual(["0","1"]);
  });
  it("keeps permission, RLS, private helper and existing FG guard boundaries",async()=>{
    const p=await product();await grant(["test_calculator.view","test_calculator.manage"]);
    const before=await reservationSnapshot(db);
    await expect(adjust(p.id,raw,"remove","1",member)).rejects.toMatchObject({code:"42501"});
    await expect(call("update public.inventory_balances set quantity=0 where product_id=$1",[p.id],member)).rejects.toMatchObject({code:"42501"});
    for(const fn of ["public.active_test_warehouse_hold_quantity(uuid,uuid)","public.protect_test_calculator_warehouse_holds()"])
      for(const role of ["anon","authenticated","service_role"])
        expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,fn])).rows[0].allowed).toBe(false);
    expect((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and prosecdef")).rows[0].n).toBe(194);
    expect((await db.query("select tgenabled from pg_trigger where tgname='inventory_balances_protect_finished_goods_reservations'")).rows[0].tgenabled).toBe("O");
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("preserves FIFO across multiple source lots without assigning lots to Test holds",async()=>{
    const p=await product(false,["5","0","0"]);
    await call("select * from public.adjust_inventory_warehouse($1,$2,'add',5,'Second owned FIFO batch',$3)",[p.id,raw,p.productSupplierId]);
    await hold(p.id,raw,"7");await adjust(p.id,raw,"remove","3");
    const lots=(await db.query("select remaining_quantity::text quantity from public.inventory_source_lots where product_id=$1 and warehouse_id=$2 order by received_at,id",[p.id,raw])).rows;
    expect(lots.map(l=>l.quantity)).toEqual(["2","5"]);await consistency(p.id);
  });
  it.each(["save-first","debit-first","direct-debit-waits"])
    ("serializes Save versus debit: %s",async order=>{
      const p=await product(false,["5","0","0"]);await db.query("commit");baseline=await snapshot(pool!);
      async function client(){
        const rawClient=await pool!.connect();
        const guard=guardRollbackQueries(rawClient,testSignal);branches.push(guard);
        await guard.client.query("begin");
        await guard.client.query("set local statement_timeout='12s';set local lock_timeout='5s'");
        await guard.client.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.auth_user_id]);
        return guard;
      }
      const first=await client(),second=await client();
      const pid=(await second.client.query("select pg_backend_pid() pid")).rows[0].pid;
      await first.client.query("set local role authenticated");
      const saveArgs=[randomUUID(),"Owned concurrent protection",JSON.stringify([{product_id:p.id,quantity:"4"}]),"2030-01-01"];
      const debitSql="select * from public.adjust_inventory_warehouse($1,$2,'remove',3,'Owned concurrent protection')";
      let waiting:Promise<{value?:unknown;error?:{code?:string}}>;
      if(order==="debit-first"){
        await first.client.query(debitSql,[p.id,raw]);await second.client.query("set local role authenticated");
        waiting=second.client.query(saveSql,saveArgs).then(r=>({value:r.rows[0].receipt}),error=>({error}));
      }else{
        await first.client.query(saveSql,saveArgs);
        if(order==="direct-debit-waits")waiting=second.client.query("update public.inventory_balances set quantity=0 where product_id=$1 and warehouse_id=$2",[p.id,raw]).then(r=>({value:r.rows}),error=>({error}));
        else {await second.client.query("set local role authenticated");waiting=second.client.query(debitSql,[p.id,raw]).then(r=>({value:r.rows}),error=>({error}));}
      }
      // Prove the losing operation actually reached a lock wait before releasing.
      let blocked=false;
      for(let i=0;i<100;i++){
        blocked=(await db.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[pid])).rows[0]?.blocked===true;
        if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));
      }
      if(!blocked)throw new Error("Expected controlled lock wait not observed");
      await first.client.query("commit");const outcome=await waiting;
      if(order==="debit-first"){
        if(outcome.error)throw outcome.error;
        expect((outcome.value as {items:{held_quantity:string}[]}).items[0]!.held_quantity).toBe("2");
        await second.client.query("commit");
      }else{
        expect(outcome.error).toMatchObject({code:"IVB02"});await second.client.query("rollback");
      }
      await rollbackReservationTransactions(branches.splice(0));
      const row=(await db.query(`select b.quantity::text physical,public.active_test_warehouse_hold_quantity(b.product_id,b.warehouse_id)::text held
        from public.inventory_balances b where product_id=$1 and warehouse_id=$2`,[p.id,raw])).rows[0];
      expect(row).toEqual(order==="debit-first"?{physical:"2",held:"2"}:{physical:"5",held:"4"});
      await consistency(p.id);baseline=await snapshot(pool!);
    });
});
