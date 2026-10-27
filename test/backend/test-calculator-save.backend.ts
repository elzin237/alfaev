import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { LOCAL_RESERVATION, ReservationLocalTarget, reservationSnapshot,
  rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const enabled = process.env.TEST_CALCULATOR_SAVE_LOCAL === "1";
const foundation = readFileSync("supabase/migrations/20261027100000_add_test_calculator_foundation.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261027110000_add_test_calculator_search_and_preview.sql", "utf8");
const raw = "10000000-0000-4000-8000-000000000001", fg = "10000000-0000-4000-8000-000000000002", customs = "10000000-0000-4000-8000-000000000003";
const saveMigration=readFileSync("supabase/migrations/20261027120000_add_atomic_test_calculator_save.sql","utf8");
const saveSql="select public.save_test_calculation($1,$2,$3::jsonb,$4::date) receipt";

describe.skipIf(!enabled)("Test Calculator atomic Save — owned local clone only", () => {
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
  async function grant(keys: string[]) {
    await db.query("delete from public.user_permissions where user_id=$1",[member.id]);
    await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,admin.id,keys]);
  }
  beforeAll(async () => {
    if (process.env.TEST_CALCULATOR_SAVE_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw new Error("Owned-clone peer scope required");
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
      if(!admin||!member)throw new Error("Existing local identities required"); await setup.query("begin");
      try { await setup.query(foundation);await setup.query(migration);await setup.query(saveMigration);await setup.query("commit"); }
      catch(error){await setup.query("rollback");throw error;}
      baseline=await reservationSnapshot(setup);
    } finally {setup.release(true);}
  });
  beforeEach(async context => {
    await target.assertQuiet();const client=await pool!.connect();await client.query("begin");transaction=guardRollbackQueries(client,context.signal);db=transaction.client;
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
  it.each([["0","0","0","4","0","4"],["2","0","0","4","2","2"],["5","4","3","12","12","0"]])
  ("atomically saves zero/partial/full allocation %s/%s/%s",async(r,c,f,q,held,missing)=>{
    const p=await product(false,[r,c,f]);
    // Drain fixture-only deferred reconciliation before measuring Save's effects.
    await db.query("set constraints all immediate;set constraints all deferred");
    const before=await reservationSnapshot(db),receipt=await save(p.id,q);
    expect(receipt.items[0]).toMatchObject({required_quantity:q,held_quantity:held,uncovered_quantity:missing});
    if(q==="12")expect(receipt.items[0].warehouses.map((w:{quantity:string})=>w.quantity)).toEqual(["5","4","3"]);
    await db.query("set constraints all immediate");
    const after=await reservationSnapshot(db);
    for(const [key,value] of Object.entries(before))if(!/test_calculation|audit_logs/.test(key))expect(after[key]).toEqual(value);
    expect((await db.query("select count(*)::int n from public.audit_logs where entity_id=$1 and action_type='test_calculator.saved'",[receipt.calculation_id])).rows[0].n).toBe(1);
  });
  it("respects ordinary Project priority and active Test holds, not expired holds",async()=>{
    const p=await product();await demand(p.id,"3");await hold(p.id,raw,"2");await hold(p.id,customs,"1",true);
    const receipt=await save(p.id);
    expect(receipt.items[0]).toMatchObject({held_quantity:"7",uncovered_quantity:"1"});
    expect(receipt.items[0].warehouses.map((w:{quantity:string})=>w.quantity)).toEqual(["3","4","0"]);
  });
  it("sources linked outputs only from unreserved FG",async()=>{
    const p=await product(true,["100","100","10"]),project=await demand(p.id,"100");
    await call("select * from public.reserve_finished_goods_for_project($1,$2,3,0,$3)",[project,p.id,randomUUID()]);
    await hold(p.id,fg,"2");
    const receipt=await save(p.id);
    expect(receipt.items[0]).toMatchObject({held_quantity:"5",uncovered_quantity:"3"});
    expect(receipt.items[0].warehouses).toEqual([{warehouse_id:fg,quantity:"5"}]);
  });
  it("replays an immutable receipt and rejects changed payload and foreign ownership",async()=>{
    const p=await product(),request=randomUUID(),receipt=await save(p.id,"8",request);
    expect(await save(p.id,"8",request)).toEqual(receipt);
    await expect(save(p.id,"9",request)).rejects.toMatchObject({code:"TCS01"});
    await grant(["test_calculator.view","test_calculator.manage","inventory.finished_goods.view","inventory.raw_materials.view","inventory.customs.view"]);
    await expect(save(p.id,"9",request,member)).rejects.toMatchObject({code:"42501"});
    expect((await db.query("select count(*)::int n from public.test_calculations where request_id=$1",[request])).rows[0].n).toBe(1);
  });
  it("preserves SQL bigint quantities losslessly",async()=>{
    const p=await product(false,["9007199254740993","0","0"]),receipt=await save(p.id,"9007199254740994");
    expect(receipt.items[0]).toMatchObject({required_quantity:"9007199254740994",held_quantity:"9007199254740993",uncovered_quantity:"1"});
  });
  it("rejects expired/invalid deadlines and unauthorized callers without writes",async()=>{
    const p=await product();
    await expect(save(p.id,"1",randomUUID(),admin,"2020-01-01")).rejects.toMatchObject({code:"TCS02"});
    await expect(save(p.id,"1",randomUUID(),admin,"infinity")).rejects.toMatchObject({code:"22023"});
    await grant(["pcb.edit","inventory.finished_goods.view"]);
    await expect(save(p.id,"1",randomUUID(),member)).rejects.toMatchObject({code:"42501"});
    for(const role of ["anon","service_role"])await expect(call(saveSql,[randomUUID(),"Denied",JSON.stringify([{product_id:p.id,quantity:"1"}]),"2030-01-01"],admin,role)).rejects.toMatchObject({code:"42501"});
    expect((await db.query("select count(*)::int n from public.test_calculations where name='Owned Save'")).rows[0].n).toBe(0);
  });
  it("rolls back header/items/holds if immutable audit insertion fails",async()=>{
    const p=await product(),request=randomUUID();
    await db.query(`create function pg_temp.reject_save_audit() returns trigger language plpgsql as $$begin
      if new.action_type='test_calculator.saved' then raise exception 'Injected audit failure' using errcode='23514';end if;return new;end$$;
      create trigger test_reject_save before insert on public.audit_logs for each row execute function pg_temp.reject_save_audit()`);
    const before=await reservationSnapshot(db);
    await expect(save(p.id,"8",request)).rejects.toMatchObject({code:"23514"});
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("returns an expired original receipt without recreating holds",async()=>{
    const p=await product(),request=randomUUID(),id=randomUUID(),receipt={calculation_id:id,original:true};
    const payload={auth_user_id:admin.auth_user_id,name:"Owned Save",items:[{product_id:p.id,quantity:"8"}],deadline_date:"2020-01-01",deadline_timezone:"Europe/Sarajevo"};
    await db.query(`insert into public.test_calculations(id,name,created_by_user_id,created_at,deadline_date,expires_at,request_id,submitted_payload,save_receipt)
      values($1,'Owned Save',$2,'2019-01-01','2020-01-01','2020-01-01T23:00:00Z',$3,$4,$5)`,[id,admin.id,request,payload,receipt]);
    const before=await reservationSnapshot(db);
    expect(await save(p.id,"8",request,admin,"2020-01-01")).toEqual(receipt);
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("validates complete payloads and current authority including warehouse permissions",async()=>{
    const p=await product(),finished=await product(true);
    for(const input of [null,[],[{product_id:p.id,quantity:1}],[{product_id:p.id,quantity:"0"}],
      [{product_id:p.id,quantity:"9223372036854775808"}],[{product_id:p.id,quantity:"1",extra:true}],
      [{product_id:p.id,quantity:"1"},{product_id:p.id.toUpperCase(),quantity:"2"}]])
      await expect(call(saveSql,[randomUUID(),"Bad",JSON.stringify(input),"2030-01-01"])).rejects.toMatchObject({code:"22023"});
    await grant(["test_calculator.view","test_calculator.manage","inventory.finished_goods.view"]);
    await expect(save(p.id,"1",randomUUID(),member)).rejects.toMatchObject({code:"42501"});
    const request=randomUUID();expect((await save(finished.id,"1",request,member)).items[0].held_quantity).toBe("1");
    await grant(["test_calculator.view","inventory.finished_goods.view"]);
    await expect(save(finished.id,"1",request,member)).rejects.toMatchObject({code:"42501"});
    await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);
    await expect(save(finished.id,"1",randomUUID(),member)).rejects.toMatchObject({code:"42501"});
    const fn="public.save_test_calculation(uuid,text,jsonb,date)";
    expect((await db.query("select prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure",[fn])).rows[0])
      .toMatchObject({prosecdef:true,provolatile:"v",proconfig:['search_path=""']});
    expect((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and prosecdef")).rows[0].n).toBe(193);
    for(const role of ["anon","service_role"])expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,fn])).rows[0].allowed).toBe(false);
    await expect(call("select * from public.test_calculations",[],admin)).rejects.toMatchObject({code:"42501"});
  });
  it("canonicalizes multi-Product payloads and uses Sarajevo next midnight across DST",async()=>{
    const a=await product(),b=await product(),request=randomUUID();
    const items=[{product_id:a.id.toUpperCase(),quantity:"1"},{product_id:b.id,quantity:"2"}];
    const receipt=(await call(saveSql,[request,"  Owned Save  ",JSON.stringify(items),"2030-03-31"]))[0].receipt;
    expect(new Date(receipt.expires_at).toISOString()).toBe("2030-03-31T22:00:00.000Z");
    expect(receipt.items.map((item:{product_id:string})=>item.product_id)).toEqual([a.id,b.id].sort());
    expect((await call(saveSql,[request,"Owned Save",JSON.stringify([...items].reverse()),"2030-03-31"]))[0].receipt).toEqual(receipt);
    await expect(call(saveSql,[request,"Owned Save",JSON.stringify(items),"2030-04-01"])).rejects.toMatchObject({code:"TCS01"});
    const bad=randomUUID();
    await expect(call(saveSql,[bad,"No partial Save",JSON.stringify([...items,{product_id:randomUUID(),quantity:"1"}]),"2030-03-31"])).rejects.toMatchObject({code:"42501"});
    expect((await db.query("select count(*)::int n from public.test_calculations where request_id=$1",[bad])).rows[0].n).toBe(0);
  });
  it("serializes committed duplicate and competing Saves without over-allocation",async context=>{
    const p=await product(false,["5","0","0"]),request=randomUUID();
    // Fixtures and receipts commit only in this newly owned clone, never the source.
    await db.query("commit");baseline=await snapshot(pool!);
    const before=baseline as Record<string,unknown>;
    async function concurrent(requestId:string){
      const client=await pool!.connect();await client.query("begin");
      const guard=guardRollbackQueries(client,context.signal);branches.push(guard);
      await guard.client.query("set local statement_timeout='15s';set local lock_timeout='5s'");
      await guard.client.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.auth_user_id]);
      await guard.client.query("set local role authenticated");
      const receipt=(await guard.client.query(saveSql,[requestId,"Owned Save",JSON.stringify([{product_id:p.id,quantity:"4"}]),"2030-01-01"])).rows[0].receipt;
      await guard.client.query("commit");return receipt;
    }
    const duplicate=await Promise.allSettled([concurrent(request),concurrent(request)]);
    for(const result of duplicate)if(result.status==="rejected")throw result.reason;
    expect((duplicate[0] as PromiseFulfilledResult<unknown>).value).toEqual((duplicate[1] as PromiseFulfilledResult<unknown>).value);
    await rollbackReservationTransactions(branches.splice(0));
    const competitors=await Promise.allSettled([concurrent(randomUUID()),concurrent(randomUUID())]);
    for(const result of competitors)if(result.status==="rejected")throw result.reason;
    await rollbackReservationTransactions(branches.splice(0));
    const quantities=competitors.map(result=>(result as PromiseFulfilledResult<{items:{held_quantity:string}[]}>).value.items[0]!.held_quantity).sort();
    expect(quantities).toEqual(["0","1"]);
    expect((await db.query("select sum(h.quantity)::text held from public.test_calculation_holds h where h.product_id=$1",[p.id])).rows[0].held).toBe("5");
    expect((await db.query("select count(*)::int n from public.test_calculations where request_id=$1",[request])).rows[0].n).toBe(1);
    expect((await db.query("select quantity::text from public.inventory_balances where product_id=$1 and warehouse_id=$2",[p.id,raw])).rows[0].quantity).toBe("5");
    const fixed=await pool!.connect();await fixed.query("begin isolation level repeatable read");
    const guarded=guardRollbackQueries(fixed,context.signal);branches.push(guarded);
    await guarded.client.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.auth_user_id]);
    await guarded.client.query("set local role authenticated");
    await expect(guarded.client.query(saveSql,[randomUUID(),"Unsafe snapshot",JSON.stringify([{product_id:p.id,quantity:"1"}]),"2030-01-01"]))
      .rejects.toMatchObject({code:"25000"});
    await rollbackReservationTransactions(branches.splice(0));
    const after=await snapshot(pool!);
    for(const [key,value] of Object.entries(before))if(!/test_calculation|audit_logs/.test(key))expect(after[key]).toEqual(value);
    expect((await db.query("select count(*)::int n from public.test_calculation_items where product_id=$1",[p.id])).rows[0].n).toBe(3);
    expect((await db.query("select count(*)::int n from public.audit_logs a join public.test_calculations c on a.entity_id=c.id where c.id in (select calculation_id from public.test_calculation_items where product_id=$1) and a.action_type='test_calculator.saved'",[p.id])).rows[0].n).toBe(3);
    baseline=after;
  });
});
