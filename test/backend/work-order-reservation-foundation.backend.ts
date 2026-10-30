import {randomUUID,createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import type {PoolClient} from "pg";
import {beforeAll,beforeEach,afterEach,afterAll,describe,it,expect} from "vitest";
import {ReservationLocalTarget,reservationSnapshot,type LocalReservationPool} from "./helpers/reservation-local-target";
import {createSupplierSourceFixture} from "./helpers/inventory-provenance";
const file="20261030110000_add_work_order_reservation_foundation.sql";
const files=readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort();
const hashes=files.slice(0,170).map(f=>createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"));
const tables=["work_order_material_reservation_states","work_order_material_reservation_allocations","work_order_material_reservation_events","work_order_material_reservation_receipts","work_order_project_requirement_coverage"];
const raw="10000000-0000-4000-8000-000000000001";
describe.skipIf(process.env.WO_RESERVATION_FOUNDATION_LOCAL!=="1")("WO reservation foundation — owned disposable local clone",()=>{
  const target=new ReservationLocalTarget(),name=`alfaev_fg_3b1_${randomUUID().replace(/-/g,"")}`;
  let source:LocalReservationPool,pool:LocalReservationPool,created=false,sourceBefore:unknown,baseline:unknown,db:PoolClient;
  let actor:{id:string;auth_user_id:string},product:string;
  async function snapshot(p:LocalReservationPool){const c=await p.connect();try{return await reservationSnapshot(c);}finally{c.release(true);}}
  beforeAll(async()=>{
    if(process.env.WO_RESERVATION_FOUNDATION_APPROVAL!=="owned-clone-only"||process.env.LOCAL_SUPABASE_DB_PASSWORD)throw Error("Owned local peer scope required");
    expect(files[170]).toBe(file);source=target.pool();await target.acquire(source);sourceBefore=await snapshot(source);
    await target.createTemporary(source,name);created=true;target.copyIntoTemporary(name);pool=target.pool(name);const setup=await pool.connect();
    try{
      await setup.query("begin");for(let i=142;i<150;i++){const f=files[i]!;await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8"));
        await setup.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)",[f.slice(0,14),f.slice(15,-4)]);
        if(i>=145){await setup.query("commit");await target.acceptClonePhase(setup,name,(i+1) as 146|147|148|149|150);if(i<149)await setup.query("begin");}}
      await setup.query("begin");for(const f of files.slice(150,170))await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8"));await setup.query("commit");
      actor=(await setup.query("select id,auth_user_id from public.user_profiles where is_active and is_admin order by id limit 1")).rows[0];
      if(!actor)throw Error("Existing local Admin fixture required");baseline=await reservationSnapshot(setup);process.stdout.write(`Owned WO foundation clone: ${name}\n`);
    }catch(e){await setup.query("rollback");throw e;}finally{setup.release(true);}
  });
  beforeEach(async()=>{await target.assertQuiet();db=await pool.connect();await db.query("begin;set local statement_timeout='15s';set local lock_timeout='3s'");
    const prior=await reservationSnapshot(db);
    const functions=(await db.query("select oid::text id,md5(to_jsonb(p)::text) hash from pg_proc p where pronamespace='public'::regnamespace order by oid")).rows;
    await db.query(readFileSync(`supabase/migrations/${file}`,"utf8"));
    const installed=await reservationSnapshot(db);for(const [key,value] of Object.entries(prior))if(key!=="security")expect(installed[key]).toEqual(value);
    expect((await db.query("select oid::text id,md5(to_jsonb(p)::text) hash from pg_proc p where oid=any($1::oid[]) order by oid",[functions.map(f=>f.id)])).rows).toEqual(functions);
    product=randomUUID();const serial=(await db.query("select n::text serial from generate_series(8000000,8999999) n where not exists(select 1 from public.products where serial_number=n::text) order by n limit 1")).rows[0].serial;
    await db.query("insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id) values($1,$2,'Owned WO fixture','Fixture','component',$3,$3)",[product,serial,actor.id]);
    const supplier=await createSupplierSourceFixture(db,{profileId:actor.id,authUserId:actor.auth_user_id},product);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);
    await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add','20','Owned fixture',$3)",[product,raw,supplier.productSupplierId]);
  });
  afterEach(async()=>{if(db){await db.query("rollback");db.release(true);}if(pool&&baseline)expect(await snapshot(pool)).toEqual(baseline);});
  afterAll(async()=>{try{if(pool)await pool.end();if(source){expect(await snapshot(source)).toEqual(sourceBefore);if(created){await target.dropTemporary(source,name);expect((await source.query("select exists(select 1 from pg_database where datname=$1) present",[name])).rows[0].present).toBe(false);process.stdout.write("Owned WO clone removed; source data/security/sequences unchanged\n");}}expect(files.slice(0,170).map(f=>createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"))).toEqual(hashes);}finally{await target.release();if(source)await source.end();}});
  async function attempt(sql:string,args:unknown[]=[]){await db.query("savepoint attempt");try{const result=await db.query(sql,args);await db.query("release savepoint attempt");return result;}catch(e){await db.query("rollback to savepoint attempt;release savepoint attempt");throw e;}}
  async function check(){await db.query("set constraints all immediate;set constraints all deferred");}
  async function fixture(required="5",held="3"){
    const wo=(await db.query("select * from public.create_draft_work_order()")).rows[0].work_order_id as string;
    await db.query("select * from public.save_draft_work_order($1,null,'Owned fixture',$2,(select updated_at from public.work_orders where id=$1))",[wo,JSON.stringify([{product_id:product,quantity:required}])]);
    const w=(await db.query("select work_order_number,updated_at::text updated_at from public.work_orders where id=$1",[wo])).rows[0],request=randomUUID(),state=randomUUID();
    await db.query("insert into public.work_order_material_reservation_receipts(request_id,work_order_id,work_order_number,actor_user_id,auth_user_id,operation,submitted_payload,receipt) values($1,$2,$3,$4,$5,'create',$6,$7)",
      [request,wo,w.work_order_number,actor.id,actor.auth_user_id,{work_order_id:wo,auth_user_id:actor.auth_user_id,operation:"create"},{request_id:request,work_order_id:wo,operation:"create"}]);
    await db.query("insert into public.work_order_material_reservation_states(id,work_order_id,live_work_order_id,product_id,required_quantity,version,draft_updated_at,last_request_id) values($1,$2,$2,$3,$4,1,$5,$6)",[state,wo,product,required,w.updated_at,request]);
    await event(state,wo,request,"requirement_changed",null,required,"0",required);
    if(held!=="0"){
      await db.query("insert into public.work_order_material_reservation_allocations values($1,$2,$3,1)",[state,raw,held]);
      await event(state,wo,request,"allocated",raw,held,"0",held);
    }
    return{state,wo,request,w};
  }
  async function event(state:string,wo:string,request:string,kind:string,warehouse:string|null,quantity:string,before:string,after:string,version=1){return db.query("insert into public.work_order_material_reservation_events(state_id,work_order_id,product_id,warehouse_id,state_version,request_id,actor_user_id,event_type,quantity,quantity_before,quantity_after) values($1,$2,$3,$4,$11,$5,$6,$7,$8,$9,$10)",[state,wo,product,warehouse,request,actor.id,kind,quantity,before,after,version]);}
  it("derives exact Required/Held/Uncovered including bigint boundaries and zero allocations",async()=>{
    const f=await fixture("9223372036854775807","3");await check();
    expect((await db.query("select required_quantity::text r,held_quantity::text h,uncovered_quantity::text u from public.work_order_material_reservation_totals where id=$1",[f.state])).rows[0]).toEqual({r:"9223372036854775807",h:"3",u:"9223372036854775804"});
    const unheld=await fixture("5","0");await check();expect((await db.query("select held_quantity::text h,uncovered_quantity::text u from public.work_order_material_reservation_totals where id=$1",[unheld.state])).rows[0]).toEqual({h:"0",u:"5"});
  });
  it("rejects excess requirement, physical overbooking and missing allocation events",async()=>{
    await expect(attempt("insert into public.work_order_material_reservation_allocations values($1,$2,0,1)",[randomUUID(),raw])).rejects.toMatchObject({code:"23514"});
    await db.query("savepoint overbook");await expect(fixture("25","21")).rejects.toMatchObject({code:"23514"});await db.query("rollback to savepoint overbook");
    await db.query("savepoint overrequire");await expect(fixture("2","3")).rejects.toMatchObject({code:"23514"});await db.query("rollback to savepoint overrequire");
    const f=await fixture();await check();await db.query("update public.work_order_material_reservation_allocations set held_quantity=4 where state_id=$1",[f.state]);await expect(check()).rejects.toMatchObject({code:"23514"});
  });
  it("prevents duplicate identities, invalid warehouses and stale state versions",async()=>{
    const f=await fixture();await check();
    await expect(attempt("insert into public.work_order_material_reservation_allocations values($1,$2,1,1)",[f.state,raw])).rejects.toMatchObject({code:"23505"});
    await expect(attempt("insert into public.work_order_material_reservation_allocations values($1,$2,1,1)",[f.state,randomUUID()])).rejects.toMatchObject({code:"23503"});
    await expect(attempt("insert into public.work_order_material_reservation_states select gen_random_uuid(),work_order_id,live_work_order_id,$2,required_quantity,version,draft_updated_at,status,last_request_id,created_at from public.work_order_material_reservation_states where id=$1",[f.state,randomUUID()])).rejects.toMatchObject({code:"23503"});
    await expect(attempt("update public.work_order_material_reservation_states set version=3 where id=$1",[f.state])).rejects.toMatchObject({code:"23514"});
    await expect(attempt("insert into public.work_order_material_reservation_states select gen_random_uuid(),work_order_id,live_work_order_id,product_id,required_quantity,version,draft_updated_at,status,last_request_id,created_at from public.work_order_material_reservation_states where id=$1",[f.state])).rejects.toMatchObject({code:"23505"});
  });
  it("rejects over-release and double consumption and retains immutable history",async()=>{
    const f=await fixture();await check();
    await expect(attempt("update public.work_order_material_reservation_events set quantity=1 where state_id=$1",[f.state])).rejects.toMatchObject({code:"55000"});
    await expect(attempt("delete from public.work_order_material_reservation_receipts where request_id=$1",[f.request])).rejects.toMatchObject({code:"55000"});
    await expect(attempt("truncate public.work_order_material_reservation_events")).rejects.toMatchObject({code:"55000"});
    await expect(attempt("insert into public.work_order_material_reservation_events(state_id,work_order_id,product_id,warehouse_id,state_version,request_id,actor_user_id,event_type,quantity,quantity_before,quantity_after) values($1,$2,$3,$4,1,$5,$6,'released',4,3,0)",[f.state,f.wo,product,raw,f.request,actor.id])).rejects.toMatchObject({code:"23514"});
    await expect(attempt("insert into public.work_order_material_reservation_events(state_id,work_order_id,product_id,warehouse_id,state_version,request_id,actor_user_id,event_type,quantity,quantity_before,quantity_after) values($1,$2,$3,$4,1,$5,$6,'consumed',3,3,0)",[f.state,f.wo,product,raw,f.request,actor.id])).rejects.toMatchObject({code:"23514"});
    const finishRequest=randomUUID();await db.query("insert into public.work_order_material_reservation_receipts(request_id,work_order_id,work_order_number,actor_user_id,auth_user_id,operation,expected_updated_at,submitted_payload,receipt) values($1,$2,$3,$4,$5,'finish',$6,$7,$8)",[finishRequest,f.wo,f.w.work_order_number,actor.id,actor.auth_user_id,f.w.updated_at,{work_order_id:f.wo,auth_user_id:actor.auth_user_id,operation:"finish"},{request_id:finishRequest,work_order_id:f.wo,operation:"finish"}]);
    await db.query("update public.work_order_material_reservation_states set version=2,last_request_id=$2 where id=$1",[f.state,finishRequest]);
    await event(f.state,f.wo,finishRequest,"consumed",raw,"3","3","0",2);await db.query("delete from public.work_order_material_reservation_allocations where state_id=$1",[f.state]);await check();
    await expect(attempt("insert into public.work_order_material_reservation_events(state_id,work_order_id,product_id,warehouse_id,state_version,request_id,actor_user_id,event_type,quantity,quantity_before,quantity_after) values($1,$2,$3,$4,2,$5,$6,'consumed',3,3,0)",[f.state,f.wo,product,raw,finishRequest,actor.id])).rejects.toMatchObject({code:"23514"});
  });
  it("binds receipts to the original actor, payload and Work Order",async()=>{
    const f=await fixture();await check();
    await expect(attempt("update public.work_order_material_reservation_receipts set receipt='{}' where request_id=$1",[f.request])).rejects.toMatchObject({code:"55000"});
    await expect(attempt("insert into public.work_order_material_reservation_receipts select gen_random_uuid(),work_order_id,work_order_number,actor_user_id,gen_random_uuid(),operation,expected_updated_at,submitted_payload,receipt,created_at,transaction_id from public.work_order_material_reservation_receipts where request_id=$1",[f.request])).rejects.toMatchObject({code:"23514"});
  });
  it("requires exact coverage ancestry/revision and keeps effective coverage zero",async()=>{
    const f=await fixture();await check();
    // No inferred ownership from a matching Project ID: incomplete/random ancestry fails.
    await expect(attempt("insert into public.work_order_project_requirement_coverage(state_id,warehouse_id,requirement_id,project_product_id,project_id,product_id,requirement_updated_at,requirement_quantity,proposed_quantity,proof,request_id) values($1,$2,$3,$4,$5,$6,now(),5,1,'{}',$7)",[f.state,raw,randomUUID(),randomUUID(),randomUUID(),product,f.request])).rejects.toMatchObject({code:"23514"});
    const projectId=randomUUID();await db.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,'Owned proof Project','Fixture','2026-01-01','2090-01-01',$2,$2)",[projectId,actor.id]);
    const parent=(await db.query("select public.create_project_product($1,'Owned requirement') id",[projectId])).rows[0].id;
    const requirement=(await db.query("select public.create_project_product_component($1,$2,5) id",[parent,product])).rows[0].id;
    const revision=(await db.query("select updated_at::text revision from public.project_product_components where id=$1",[requirement])).rows[0].revision;
    await db.query("insert into public.work_order_project_requirement_coverage(state_id,warehouse_id,requirement_id,project_product_id,project_id,product_id,requirement_updated_at,requirement_quantity,proposed_quantity,proof,request_id) values($1,$2,$3,$4,$5,$6,$7,5,1,$8,$9)",[f.state,raw,requirement,parent,projectId,product,revision,{kind:"candidate_only",requirement_id:requirement},f.request]);
    await expect(attempt("insert into public.work_order_project_requirement_coverage(id,state_id,warehouse_id,requirement_id,project_product_id,project_id,product_id,requirement_updated_at,requirement_quantity,proposed_quantity,proof,request_id) select gen_random_uuid(),state_id,warehouse_id,requirement_id,project_product_id,$1,product_id,requirement_updated_at,requirement_quantity,proposed_quantity,proof,request_id from public.work_order_project_requirement_coverage",[randomUUID()])).rejects.toMatchObject({code:"23514"});
    expect((await db.query("select effective_quantity::text quantity from public.work_order_project_requirement_coverage")).rows).toEqual([{quantity:"0"}]);
  });
  it("preserves actual trusted Draft deletion and detaches live ownership without deleting history",async()=>{
    const f=await fixture();await check();await db.query("set local role authenticated");await db.query("select * from public.delete_draft_work_order($1,$2)",[f.wo,f.w.updated_at]);await check();await db.query("reset role");
    expect((await db.query("select live_work_order_id from public.work_order_material_reservation_states where id=$1",[f.state])).rows[0].live_work_order_id).toBeNull();
    expect((await db.query("select held_quantity::text h,uncovered_quantity::text u from public.work_order_material_reservation_totals where id=$1",[f.state])).rows[0]).toEqual({h:"0",u:"0"});
    expect((await db.query("select count(*)::int n from public.work_order_material_reservation_events where state_id=$1",[f.state])).rows[0].n).toBe(2);
  });
  it("denies real application roles and leaves physical accounting and existing functions unchanged",async()=>{
    const before=(await db.query("select md5(coalesce(jsonb_agg(to_jsonb(b) order by b.product_id,b.warehouse_id)::text,'')) hash from public.inventory_balances b")).rows;
    const f=await fixture();await check();
    expect((await db.query("select md5(coalesce(jsonb_agg(to_jsonb(b) order by b.product_id,b.warehouse_id)::text,'')) hash from public.inventory_balances b")).rows).toEqual(before);
    for(const table of tables){expect((await db.query("select relrowsecurity rls from pg_class where oid=$1::regclass",[`public.${table}`])).rows[0].rls).toBe(true);
      for(const role of ["anon","authenticated","service_role"]){expect((await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed",[role,`public.${table}`])).rows[0].allowed).toBe(false);await expect(attempt(`set local role ${role};select * from public.${table}`)).rejects.toMatchObject({code:"42501"});}}
    for(const role of ["anon","authenticated","service_role"]){
      expect((await db.query("select has_table_privilege($1,'public.work_order_material_reservation_totals','SELECT') allowed",[role])).rows[0].allowed).toBe(false);
      for(const helper of ["guard_work_order_reservation_foundation","check_work_order_reservation_foundation","reject_work_order_reservation_truncate"])
        expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,`public.${helper}()`])).rows[0].allowed).toBe(false);
    }
    expect((await db.query("select count(*)::int n from public.work_order_material_reservation_receipts where request_id=$1",[f.request])).rows[0].n).toBe(1);
  });
});
