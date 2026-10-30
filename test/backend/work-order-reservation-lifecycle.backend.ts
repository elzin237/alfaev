import {randomUUID,createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import type {PoolClient} from "pg";
import {beforeAll,beforeEach,afterEach,afterAll,describe,it,expect,vi} from "vitest";
vi.mock("../../lib/supabase/client",()=>({supabase:{}}));
vi.mock("../../lib/config/env",()=>({frontendEnv:{supabaseUrl:"https://yzysgbrpbhiapalgetau.supabase.co",supabasePublishableKey:"local-parser-only"}}));
import {parseInventoryCommitmentBreakdown,type BreakdownRequest} from "../../features/inventory/services/inventoryCommitmentBreakdownService";
import {ReservationLocalTarget,reservationSnapshot,type LocalReservationPool} from "./helpers/reservation-local-target";
import {createSupplierSourceFixture} from "./helpers/inventory-provenance";
const file="20261030120000_add_private_work_order_reservation_lifecycle.sql";
const files=readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort();
const hashes=files.slice(0,171).map(f=>createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"));
const raw="10000000-0000-4000-8000-000000000001",fg="10000000-0000-4000-8000-000000000002",customs="10000000-0000-4000-8000-000000000003";
const signature="public.stage_draft_work_order_reservations(uuid,text,uuid,timestamptz,jsonb)";
const wiring=process.env.WO_RESERVATION_PROTECTION_SCHEMA==="177";
const breakdown=wiring||process.env.WO_RESERVATION_PROTECTION_SCHEMA==="176";
const accounting=breakdown||process.env.WO_RESERVATION_PROTECTION_SCHEMA==="175";
const finishIntegration=accounting||process.env.WO_RESERVATION_PROTECTION_SCHEMA==="174";
const protection=finishIntegration||process.env.WO_RESERVATION_PROTECTION_SCHEMA==="173";
describe.skipIf(process.env.WO_RESERVATION_LIFECYCLE_LOCAL!=="1")("Private Draft lifecycle — owned local clone only",()=>{
  const target=new ReservationLocalTarget(),name=`alfaev_fg_3b1_${randomUUID().replace(/-/g,"")}`;
  let source:LocalReservationPool,pool:LocalReservationPool,created=false,sourceBefore:unknown,baseline:unknown,db:PoolClient,committedFixture=false;
  let actor:{id:string;auth_user_id:string},member:{id:string;auth_user_id:string},product:string,supplier:string;
  async function snapshot(p:LocalReservationPool){const c=await p.connect();try{return await reservationSnapshot(c);}finally{c.release(true);}}
  beforeAll(async()=>{
    if(process.env.WO_RESERVATION_LIFECYCLE_APPROVAL!=="owned-clone-only"||process.env.LOCAL_SUPABASE_DB_PASSWORD)throw Error("Owned local peer scope required");
    expect(files[171]).toBe(file);source=target.pool();await target.acquire(source);sourceBefore=await snapshot(source);
    await target.createTemporary(source,name);created=true;target.copyIntoTemporary(name);pool=target.pool(name);const setup=await pool.connect();
    try{
      await setup.query("begin");for(let i=142;i<150;i++){const f=files[i]!;await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8"));await setup.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)",[f.slice(0,14),f.slice(15,-4)]);
        if(i>=145){await setup.query("commit");await target.acceptClonePhase(setup,name,(i+1) as 146|147|148|149|150);if(i<149)await setup.query("begin");}}
      await setup.query("begin");for(const f of files.slice(150,172))await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8"));await setup.query("commit");
      if(protection){
        expect(files[172]).toBe("20261030130000_protect_draft_work_order_commitments.sql");
        const prior=await reservationSnapshot(setup),contracts=(await setup.query("select oid,to_jsonb(p)-'prosrc' contract from pg_proc p where pronamespace='public'::regnamespace order by oid")).rows;
        await setup.query("begin");await setup.query(readFileSync(`supabase/migrations/${files[172]}`,"utf8"));await setup.query("commit");
        expect((await setup.query("select oid,to_jsonb(p)-'prosrc' contract from pg_proc p where oid=any($1::oid[]) order by oid",[contracts.map(r=>r.oid)])).rows).toEqual(contracts);
        const after=await reservationSnapshot(setup);for(const [key,value] of Object.entries(prior))if(key!=="security")expect(after[key]).toEqual(value);
        if(finishIntegration){
          expect(files[173]).toBe("20261030140000_integrate_work_order_reservations_into_finish.sql");
          const priorFinish=await reservationSnapshot(setup);await setup.query("begin");await setup.query(readFileSync(`supabase/migrations/${files[173]}`,"utf8"));await setup.query("commit");
          const afterFinish=await reservationSnapshot(setup);for(const [key,value] of Object.entries(priorFinish))if(key!=="security")expect(afterFinish[key]).toEqual(value);
          if(accounting){expect(files[174]).toBe("20261030150000_add_inventory_draft_commitment_reads.sql");const priorAccounting=await reservationSnapshot(setup);await setup.query("begin");await setup.query(readFileSync(`supabase/migrations/${files[174]}`,"utf8"));await setup.query("commit");const afterAccounting=await reservationSnapshot(setup);for(const [key,value] of Object.entries(priorAccounting))if(key!=="security")expect(afterAccounting[key]).toEqual(value);}
        }
      }
      if(breakdown){expect(files[175]).toBe("20261030160000_add_inventory_commitment_breakdown.sql");const priorBreakdown=await reservationSnapshot(setup);await setup.query("begin");await setup.query(readFileSync(`supabase/migrations/${files[175]}`,"utf8"));await setup.query("commit");const afterBreakdown=await reservationSnapshot(setup);for(const [key,value] of Object.entries(priorBreakdown))if(key!=="security")expect(afterBreakdown[key]).toEqual(value);}
      if(wiring){expect(files[176]).toBe("20261030170000_wire_draft_work_order_reservation_lifecycle.sql");const priorWiring=await reservationSnapshot(setup);await setup.query("begin");await setup.query(readFileSync(`supabase/migrations/${files[176]}`,"utf8"));await setup.query("commit");const afterWiring=await reservationSnapshot(setup);for(const [key,value] of Object.entries(priorWiring))if(key!=="security")expect(afterWiring[key]).toEqual(value);expect((await setup.query("select enabled from public.work_order_reservation_activation")).rows).toEqual([{enabled:false}]);}
      actor=(await setup.query("select id,auth_user_id from public.user_profiles where is_active and is_admin order by id limit 1")).rows[0];
      member=(await setup.query("select id,auth_user_id from public.user_profiles where is_active and not is_admin order by id limit 1")).rows[0];
      if(!actor||!member)throw Error("Existing local actor fixtures required");baseline=await reservationSnapshot(setup);process.stdout.write(`Owned lifecycle clone: ${name}\n`);
    }catch(e){await setup.query("rollback");throw e;}finally{setup.release(true);}
  });
  beforeEach(async()=>{await target.assertQuiet();committedFixture=false;db=await pool.connect();await db.query("begin;set local statement_timeout='15s';set local lock_timeout='3s'");await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);
    product=randomUUID();const serial=(await db.query("select n::text serial from generate_series(8000000,8999999) n where not exists(select 1 from public.products where serial_number=n::text) order by n limit 1")).rows[0].serial;
    await db.query("insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id) values($1,$2,'Owned lifecycle input','Fixture','component',$3,$3)",[product,serial,actor.id]);
    supplier=(await createSupplierSourceFixture(db,{profileId:actor.id,authUserId:actor.auth_user_id},product)).productSupplierId;
    for(const [warehouse,quantity] of [[raw,"5"],[customs,"4"],[fg,"3"]])await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add',$3,'Owned fixture',$4)",[product,warehouse,quantity,supplier]);
  });
  afterEach(async()=>{if(db){await db.query("rollback");db.release(true);}if(pool&&baseline&&!committedFixture)expect(await snapshot(pool)).toEqual(baseline);});
  afterAll(async()=>{try{if(pool)await pool.end();if(source){expect(await snapshot(source)).toEqual(sourceBefore);if(created){await target.dropTemporary(source,name);expect((await source.query("select exists(select 1 from pg_database where datname=$1) present",[name])).rows[0].present).toBe(false);process.stdout.write("Owned lifecycle clone removed; source data/security/sequences unchanged\n");}}expect(files.slice(0,171).map(f=>createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"))).toEqual(hashes);}finally{await target.release();if(source)await source.end();}});
  async function call(action:string,wo:string|null=null,expected:string|null=null,input:object={},request=randomUUID(),client=db){return(await client.query("select public.stage_draft_work_order_reservations($1,$2,$3,$4,$5) value",[request,action,wo,expected,input])).rows[0].value;}
  async function attempt(action:()=>Promise<unknown>){await db.query("savepoint attempt");try{const r=await action();await db.query("release savepoint attempt");return r;}catch(e){await db.query("rollback to savepoint attempt;release savepoint attempt");throw e;}}
  const items=(quantity:string)=>[{product_id:product,quantity}];
  const input=(quantity:string)=>({project_id:null,description:"Owned lifecycle",items:items(quantity)});
  const version=async(wo:string)=>(await db.query("select updated_at::text value from public.work_orders where id=$1",[wo])).rows[0].value;
  async function stock(){return(await db.query("select md5(jsonb_build_object('balances',(select jsonb_agg(to_jsonb(b) order by product_id,warehouse_id) from public.inventory_balances b),'movements',(select jsonb_agg(to_jsonb(m) order by id) from public.inventory_movements m),'lots',(select jsonb_agg(to_jsonb(l) order by id) from public.inventory_source_lots l),'tests',(select jsonb_agg(to_jsonb(h) order by item_id,warehouse_id) from public.test_calculation_holds h),'fg',(select jsonb_agg(to_jsonb(r) order by id) from public.finished_goods_project_reservations r))::text) hash")).rows;}
  it("reserves ordinary saved requirements in Raw/Customs/FG order with partial and zero stock",async()=>{
    const before=await stock(),created=await call("create"),saved=await call("edit",created.work_order_id,created.updated_at,input("20"));
    expect(saved.materials).toEqual([{product_id:product,required:"20",held:"12",uncovered:"8"}]);
    expect((await db.query("select warehouse_id,held_quantity::text q from public.work_order_material_reservation_allocations a join public.work_order_material_reservation_states s on s.id=a.state_id where s.work_order_id=$1 order by warehouse_id",[created.work_order_id])).rows).toEqual([{warehouse_id:raw,q:"5"},{warehouse_id:fg,q:"3"},{warehouse_id:customs,q:"4"}]);
    const other=await call("create"),empty=await call("edit",other.work_order_id,other.updated_at,input("4"));expect(empty.materials[0]).toMatchObject({held:"0",uncovered:"4"});expect(await stock()).toEqual(before);
  });
  it("does not top up on stock arrival or no-op; increases reserve only new demand and reductions release reverse priority",async()=>{
    const created=await call("create"),first=await call("edit",created.work_order_id,created.updated_at,input("20"));
    await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add','10','Owned arrival',$3)",[product,raw,supplier]);
    const count=(await db.query("select count(*)::int n from public.work_order_material_reservation_events")).rows[0].n;
    expect((await call("edit",created.work_order_id,first.updated_at,input("20"))).materials[0]).toMatchObject({held:"12",uncovered:"8"});
    expect((await db.query("select count(*)::int n from public.work_order_material_reservation_events")).rows[0].n).toBe(count);
    const increased=await call("edit",created.work_order_id,await version(created.work_order_id),input("22"));expect(increased.materials[0]).toMatchObject({held:"14",uncovered:"8"});
    const reduced=await call("edit",created.work_order_id,increased.updated_at,input("6"));expect(reduced.materials[0]).toMatchObject({held:"6",uncovered:"0"});
    expect((await db.query("select a.warehouse_id,a.held_quantity::text q from public.work_order_material_reservation_allocations a join public.work_order_material_reservation_states s on s.id=a.state_id where s.work_order_id=$1",[created.work_order_id])).rows).toEqual([{warehouse_id:raw,q:"6"}]);
  });
  it("replays exact actor-bound requests, rejects changed payload and stale saves atomically",async()=>{
    const request=randomUUID(),created=await call("create",null,null,{},request);expect(await call("create",null,null,{},request)).toEqual(created);
    await expect(attempt(()=>call("create",null,null,{unexpected:true},request))).rejects.toMatchObject({code:"WRC01"});
    const saved=await call("edit",created.work_order_id,created.updated_at,input("2"));
    await expect(attempt(()=>call("edit",created.work_order_id,created.updated_at,input("3")))).rejects.toMatchObject({code:"WOR05"});
    expect((await db.query("select quantity::text q from public.work_order_items where work_order_id=$1",[created.work_order_id])).rows[0].q).toBe("2");
    expect(saved.materials[0].held).toBe("2");
  });
  it("retains historical event/receipt records and releases own holds atomically on Draft deletion",async()=>{
    const created=await call("create"),saved=await call("edit",created.work_order_id,created.updated_at,input("7")),request=randomUUID(),before=await stock();
    const removed=await call("delete",created.work_order_id,saved.updated_at,{},request);expect(removed.materials[0].held).toBe("0");
    expect((await db.query("select count(*)::int n from public.work_orders where id=$1",[created.work_order_id])).rows[0].n).toBe(0);
    expect((await db.query("select coalesce(sum(held_quantity),0)::text q from public.work_order_material_reservation_totals where work_order_id=$1",[created.work_order_id])).rows[0].q).toBe("0");
    expect(await call("delete",created.work_order_id,saved.updated_at,{},request)).toEqual(removed);expect(await stock()).toEqual(before);
  });
  it("keeps activation OFF, refuses application EXECUTE and preserves existing unreserved Draft behavior",async()=>{
    const writers=(await db.query("select proname,prosrc from pg_proc where pronamespace='public'::regnamespace and proname=any($1::text[])",[["create_draft_work_order","save_draft_work_order","save_pcb_production_supplemental_materials","delete_draft_work_order","create_pcb_production_work_order"]])).rows;
    expect(new Set(writers.map(w=>w.proname)).size).toBe(5);for(const writer of writers)if(wiring)expect(writer.prosrc).toContain("stage_draft_work_order_reservations");else expect(writer.prosrc).not.toContain("stage_draft_work_order_reservations");
    expect((await db.query("select exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid where not t.tgisinternal and p.pronamespace='public'::regnamespace and p.prosrc like '%stage_draft_work_order_reservations%') active")).rows[0].active).toBe(false);
    for(const role of ["anon","authenticated","service_role"])expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).rows[0].allowed).toBe(false);
    await expect(attempt(async()=>{await db.query("set local role authenticated");await call("create");})).rejects.toMatchObject({code:"42501"});
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member.auth_user_id]);await db.query("delete from public.user_permissions where user_id=$1",[member.id]);
    await expect(attempt(()=>call("create"))).rejects.toMatchObject({code:"42501"});await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);
    const ordinary=(await db.query("select * from public.create_draft_work_order()")).rows[0].work_order_id;
    await db.query("select * from public.save_draft_work_order($1,null,'Legacy unchanged',$2,(select updated_at from public.work_orders where id=$1))",[ordinary,JSON.stringify(items("10"))]);
    expect((await db.query("select count(*)::int n from public.work_order_material_reservation_states where work_order_id=$1",[ordinary])).rows[0].n).toBe(0);
    const edited=await call("edit",ordinary,await version(ordinary),input("11"));expect(edited.materials[0]).toMatchObject({required:"11",held:"1",uncovered:"10"});
  });
  it("preserves bigint requirements and aggregates frozen PCB BOM plus supplemental occurrences",async()=>{
    const serial=(await db.query("select lpad(n::text,3,'0') serial from generate_series(0,999) n where not exists(select 1 from public.products where serial_number=lpad(n::text,3,'0')) order by n limit 1")).rows[0].serial;
    const card=(await db.query("select * from public.create_pcb_card($1,$2)",[`Owned lifecycle ${randomUUID()}`,serial])).rows[0];
    await db.query("select * from public.save_initial_pcb_bom($1,$2)",[card.pcb_card_id,JSON.stringify([{product_id:product,quantity_per_card:"2"}])]);
    const pcb=await call("create_pcb",null,null,{pcb_card_id:card.pcb_card_id,planned_quantity:"3"});expect(pcb.materials[0]).toMatchObject({required:"6",held:"6"});
    const supplemental=await call("supplemental",pcb.work_order_id,pcb.updated_at,{items:items("3")});expect(supplemental.materials).toEqual([{product_id:product,required:"9",held:"9",uncovered:"0"}]);
    expect((await db.query("select source_type,quantity::text q from public.work_order_items where work_order_id=$1 order by source_type",[pcb.work_order_id])).rows).toEqual([{source_type:"manual",q:"3"},{source_type:"pcb_bom",q:"6"}]);
    const ordinary=await call("create"),large=await call("edit",ordinary.work_order_id,ordinary.updated_at,input("9223372036854775807"));expect(large.materials[0]).toMatchObject({required:"9223372036854775807",held:"3",uncovered:"9223372036854775804"});
    expect((await db.query("select count(*)::int n from public.work_order_project_requirement_coverage where effective_quantity<>0")).rows[0].n).toBe(0);
  });
  it("allocates linked finished inputs only from FG without expanding their own BOM",async()=>{
    const serial=(await db.query("select lpad(n::text,3,'0') serial from generate_series(0,999) n where not exists(select 1 from public.products where serial_number=lpad(n::text,3,'0')) order by n limit 1")).rows[0].serial;
    const card=(await db.query("select * from public.create_pcb_card($1,$2)",[`Owned linked input ${randomUUID()}`,serial])).rows[0];
    const output=(await db.query("select output_product_id from public.pcb_cards where id=$1",[card.pcb_card_id])).rows[0].output_product_id;
    const source=(await createSupplierSourceFixture(db,{profileId:actor.id,authUserId:actor.auth_user_id},output)).productSupplierId;
    await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add','3','Owned finished input',$3)",[output,fg,source]);
    const before=await stock(),created=await call("create"),saved=await call("edit",created.work_order_id,created.updated_at,{project_id:null,description:"Linked input",items:[{product_id:output,quantity:"5"}]});
    expect(saved.materials).toEqual([{product_id:output,required:"5",held:"3",uncovered:"2"}]);
    expect((await db.query("select a.warehouse_id from public.work_order_material_reservation_allocations a join public.work_order_material_reservation_states s on s.id=a.state_id where s.work_order_id=$1",[created.work_order_id])).rows).toEqual([{warehouse_id:fg}]);
    expect(await stock()).toEqual(before);
  });
  it("rolls back the canonical Draft save when receipt persistence fails after saving",async()=>{
    const created=await call("create"),before=await reservationSnapshot(db);
    await db.query("create function public.owned_lifecycle_failure() returns trigger language plpgsql as $$begin raise exception 'Owned forced failure' using errcode='P9999';end$$;create trigger owned_lifecycle_failure before insert on public.work_order_material_reservation_receipts for each row execute function public.owned_lifecycle_failure()");
    await expect(attempt(()=>call("edit",created.work_order_id,created.updated_at,input("8")))).rejects.toMatchObject({code:"P9999"});
    await db.query("drop trigger owned_lifecycle_failure on public.work_order_material_reservation_receipts;drop function public.owned_lifecycle_failure()");
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("preserves authorized non-Admin operations, actor-bound replay and inactive/anonymous denial",async()=>{
    await db.query("delete from public.user_permissions where user_id=$1",[member.id]);
    await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,actor.id,["work_orders.create","work_orders.edit_draft","work_orders.delete_draft"]]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member.auth_user_id]);
    const request=randomUUID(),created=await call("create",null,null,{},request),saved=await call("edit",created.work_order_id,created.updated_at,input("2"));
    expect(saved.materials[0]).toMatchObject({required:"2",held:"2",uncovered:"0"});
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);
    await expect(attempt(()=>call("create",null,null,{},request))).rejects.toMatchObject({code:"42501"});
    await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member.auth_user_id]);
    await expect(attempt(()=>call("delete",created.work_order_id,saved.updated_at))).rejects.toMatchObject({code:"42501"});
    await db.query("select set_config('request.jwt.claim.sub','',true)");
    await expect(attempt(()=>call("create"))).rejects.toMatchObject({code:"42501"});
  });
  if(protection){
    const capacity=async(warehouse:string)=>(await db.query("select public.get_production_free_warehouse_quantity($1,$2)::text q",[product,warehouse])).rows[0].q;
    const preview=async(quantity="20")=>(await db.query("select * from public.preview_test_calculation($1)",[JSON.stringify(items(quantity))])).rows[0];
    async function project(){const id=randomUUID(),group=randomUUID();await db.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,$2,'Owned',current_date,current_date+1,$3,$3)",[id,`Owned protection ${id}`,actor.id]);await db.query("insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id) values($1,$2,'Owned protection',$3,$3)",[group,id,actor.id]);return{id,group};}
    async function finishedInput(){
      const serial=(await db.query("select lpad(n::text,3,'0') serial from generate_series(0,999) n where not exists(select 1 from public.products where serial_number=lpad(n::text,3,'0')) order by n limit 1")).rows[0].serial;
      const card=(await db.query("select * from public.create_pcb_card($1,$2)",[`Owned protected output ${randomUUID()}`,serial])).rows[0];
      product=(await db.query("select output_product_id from public.pcb_cards where id=$1",[card.pcb_card_id])).rows[0].output_product_id;
      supplier=(await createSupplierSourceFixture(db,{profileId:actor.id,authUserId:actor.auth_user_id},product)).productSupplierId;
      await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add','3','Owned finished fixture',$3)",[product,fg,supplier]);
    }
    it("173 preserves empty-hold accounting and private helper grants",async()=>{
      expect((await db.query("select public.get_production_eligible_quantity($1)::text q",[product])).rows[0].q).toBe("12");
      expect(await preview()).toMatchObject({reservable_quantity:"12"});
      for(const role of ["anon","authenticated","service_role"])for(const fn of ["public.active_draft_warehouse_hold_quantity(uuid,uuid)","public.get_work_order_production_capacity_at(uuid,uuid,uuid,timestamptz)","public.get_locked_work_order_production_capacity(uuid,uuid,uuid)"])
        expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,fn])).rows[0].allowed).toBe(false);
      await expect(attempt(async()=>{await db.query("set local role authenticated");await db.query("select public.active_draft_warehouse_hold_quantity($1,$2)",[product,raw]);})).rejects.toMatchObject({code:"42501"});
    });
    it("173 subtracts each warehouse hold once, credits only the owning Draft and excludes uncovered demand",async()=>{
      const created=await call("create"),saved=await call("edit",created.work_order_id,created.updated_at,input("7")),before=await stock();
      expect(await capacity(raw)).toBe("0");expect(await capacity(customs)).toBe("2");expect(await capacity(fg)).toBe("3");
      const own=(await db.query("select public.get_locked_work_order_production_capacity($1,$2,$3)::text q",[created.work_order_id,product,raw])).rows[0].q;expect(own).toBe("5");
      const availability=(await db.query("select public.get_work_order_material_availability($1) value",[created.work_order_id])).rows[0].value;expect(availability.materials[0]).toMatchObject({eligible_quantity:"12",missing_quantity:"0"});
      const other=(await db.query("select * from public.create_draft_work_order()")).rows[0].work_order_id;
      await db.query("select * from public.save_draft_work_order($1,null,'Other Draft',$2,(select updated_at from public.work_orders where id=$1))",[other,JSON.stringify(items("7"))]);
      expect((await db.query("select public.get_work_order_material_availability($1) value",[other])).rows[0].value.materials[0]).toMatchObject({eligible_quantity:"5",missing_quantity:"2"});
      await expect(attempt(()=>db.query("select * from public.get_work_order_warehouse_source_allocation_plan($1)",[other]))).rejects.toMatchObject({code:"IVB02"});
      await db.query("select public.reconcile_work_order_material_shortages_for_product($1)",[product]);
      expect((await db.query("select missing_quantity::text q from public.work_order_material_shortage_episodes where work_order_id=$1 and product_id=$2 and resolved_at is null",[other,product])).rows).toEqual([{q:"2"}]);
      expect((await db.query("select count(*)::int n from public.work_order_material_shortage_episodes where work_order_id=$1 and product_id=$2 and resolved_at is null",[created.work_order_id,product])).rows[0].n).toBe(0);
      await db.query("select * from public.save_draft_work_order($1,null,'Other Draft',$2,(select updated_at from public.work_orders where id=$1))",[other,JSON.stringify(items("3"))]);
      expect((await db.query("select warehouse_id,allocated_quantity::text q from public.get_work_order_warehouse_source_allocation_plan($1)",[other])).rows).toEqual([{warehouse_id:customs,q:"2"},{warehouse_id:fg,q:"1"}]);
      expect(saved.materials[0].held).toBe("7");expect(await stock()).toEqual(before);
    });
    it("173 denies protected physical debits without changing stock or provenance",async()=>{
      const created=await call("create");await call("edit",created.work_order_id,created.updated_at,input("7"));const before=await stock();
      await expect(attempt(()=>db.query("select * from public.adjust_inventory_warehouse($1,$2,'remove','1','Owned denied debit')",[product,raw]))).rejects.toMatchObject({code:"IVB02"});
      await expect(attempt(()=>db.query("select * from public.transfer_inventory_between_warehouses($1,$2,$3,3,'Owned denied transfer')",[product,customs,fg]))).rejects.toMatchObject({code:"IVB02"});expect(await stock()).toEqual(before);
    });
    it("173 Test Preview/Save use remaining stock and preserve Draft holds under real authenticated execution",async()=>{
      const created=await call("create");await call("edit",created.work_order_id,created.updated_at,input("7"));
      expect(await preview("8")).toMatchObject({reservable_quantity:"5"});
      await db.query("set local role authenticated");const saved=(await db.query("select public.save_test_calculation($1,'Owned protection',$2,'2090-01-01') value",[randomUUID(),JSON.stringify(items("8"))])).rows[0].value;await db.query("reset role");
      expect(saved.items[0]).toMatchObject({held_quantity:"5",uncovered_quantity:"3"});expect(await capacity(raw)).toBe("0");expect(await capacity(customs)).toBe("0");expect(await capacity(fg)).toBe("0");
      expect((await db.query("select sum(held_quantity)::text q from public.work_order_material_reservation_totals where work_order_id=$1",[created.work_order_id])).rows[0].q).toBe("7");
    });
    it("173 manual FG admission cannot reserve a Draft's stock",async()=>{
      await finishedInput();const p=await project();await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,3,$3,$3)",[p.group,product,actor.id]);
      const created=await call("create");await call("edit",created.work_order_id,created.updated_at,input("20"));const before=await stock();
      await expect(attempt(()=>db.query("select * from public.reserve_finished_goods_for_project($1,$2,1,0,$3)",[p.id,product,randomUUID()]))).rejects.toMatchObject({code:"FGR07"});expect(await stock()).toEqual(before);
    });
    it("173 automatic FG admission respects Draft-held finished inputs",async()=>{
      await finishedInput();const p=await project();
      const created=await call("create");await call("edit",created.work_order_id,created.updated_at,input("2"));
      const result=(await db.query("select public.mutate_project_requirement($1,'create',$2,$3,null,$4,3,null,null) value",[randomUUID(),p.id,p.group,product])).rows[0].value;
      expect(result.affected_products[0]).toMatchObject({reserved_quantity:"1",uncovered_demand:"2"});expect(await capacity(fg)).toBe("0");
    });
    it("173 release removes protection without top-up or stock mutation",async()=>{
      const first=await call("create"),held=await call("edit",first.work_order_id,first.updated_at,input("9223372036854775807")),other=await call("create"),unheld=await call("edit",other.work_order_id,other.updated_at,input("10"));
      expect(held.materials[0]).toMatchObject({held:"12",uncovered:"9223372036854775795"});expect(unheld.materials[0].held).toBe("0");const before=await stock();
      await call("delete",first.work_order_id,held.updated_at);expect(await capacity(raw)).toBe("5");expect(await preview()).toMatchObject({reservable_quantity:"12"});
      expect((await db.query("select held_quantity::text q from public.work_order_material_reservation_totals where work_order_id=$1",[other.work_order_id])).rows[0].q).toBe("0");expect(await stock()).toEqual(before);
    });
    it("173 respects pre-existing Test commitments before admitting a Draft",async()=>{
      const saved=(await db.query("select public.save_test_calculation($1,'Existing protected Test',$2,'2090-01-01') value",[randomUUID(),JSON.stringify(items("7"))])).rows[0].value;
      const created=await call("create"),held=await call("edit",created.work_order_id,created.updated_at,input("20"));expect(held.materials[0]).toMatchObject({held:"5",uncovered:"15"});
      expect((await db.query("select public.active_test_warehouse_hold_quantity($1,$2)::text q",[product,raw])).rows[0].q).toBe("5");expect(saved.items[0].held_quantity).toBe("7");
      expect(await capacity(raw)).toBe("0");expect(await capacity(customs)).toBe("0");expect(await capacity(fg)).toBe("0");
    });
    it("173 preserves existing FG reservations and exact large physical allocations",async()=>{
      await finishedInput();const p=await project();await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,3,$3,$3)",[p.group,product,actor.id]);
      await db.query("select * from public.reserve_finished_goods_for_project($1,$2,2,0,$3)",[p.id,product,randomUUID()]);
      const created=await call("create"),held=await call("edit",created.work_order_id,created.updated_at,input("20"));expect(held.materials[0]).toMatchObject({held:"1",uncovered:"19"});expect(await capacity(fg)).toBe("0");
      await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add','9007199254740993','Owned bigint fixture',$3)",[product,fg,supplier]);
      const increased=await call("edit",created.work_order_id,held.updated_at,input("9007199254741013"));expect(increased.materials[0]).toMatchObject({held:"9007199254740994",uncovered:"19"});
      expect((await db.query("select public.active_draft_warehouse_hold_quantity($1,$2)::text q",[product,fg])).rows[0].q).toBe("9007199254740994");expect(await capacity(fg)).toBe("0");
      expect((await db.query("select reserved_quantity::text q from public.finished_goods_project_reservations where project_id=$1 and product_id=$2",[p.id,product])).rows[0].q).toBe("2");
    });
    it("173 preserves FG fulfillment FIFO and protects the remaining Draft allocation",async()=>{
      await finishedInput();const p=await project();await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,3,$3,$3)",[p.group,product,actor.id]);
      const reserved=(await db.query("select * from public.reserve_finished_goods_for_project($1,$2,2,0,$3)",[p.id,product,randomUUID()])).rows[0];
      const created=await call("create");await call("edit",created.work_order_id,created.updated_at,input("1"));
      const args=[reserved.reservation_id,p.id,product,randomUUID()],sql="select * from public.fulfill_finished_goods_project_reservation($1,$2,$3,2,1,$4)";
      const completed=(await db.query(sql,args)).rows;expect(completed[0]).toMatchObject({physical_quantity_before:"3",physical_quantity_after:"1"});expect((await db.query(sql,args)).rows).toEqual(completed);
      expect((await db.query("select sum(remaining_quantity)::text q from public.inventory_source_lots where product_id=$1 and warehouse_id=$2",[product,fg])).rows[0].q).toBe("1");
      expect((await db.query("select public.active_draft_warehouse_hold_quantity($1,$2)::text q",[product,fg])).rows[0].q).toBe("1");
      await expect(attempt(()=>db.query("select * from public.adjust_inventory_warehouse($1,$2,'remove',1,'Owned protected remaining stock')",[product,fg]))).rejects.toMatchObject({code:"IVB02"});
    });
    it("173 expired Test history does not reduce capacity or mutate original holds",async()=>{
      const calc=randomUUID(),item=randomUUID();
      await db.query("insert into public.test_calculations(id,name,created_by_user_id,created_at,deadline_date,expires_at,request_id,submitted_payload,save_receipt) values($1,'Owned expired Test',$2,'2019-01-01','2020-01-01',('2020-01-02'::timestamp at time zone 'Europe/Sarajevo'),$3,'{}','{}')",[calc,actor.id,randomUUID()]);
      await db.query("insert into public.test_calculation_items(id,calculation_id,product_id,product_name_snapshot,serial_number_snapshot,product_kind_snapshot,required_quantity,held_quantity,uncovered_quantity) select $1,$2,id,name,serial_number,product_kind,5,5,0 from public.products where id=$3",[item,calc,product]);
      await db.query("insert into public.test_calculation_holds(item_id,calculation_id,product_id,warehouse_id,quantity) values($1,$2,$3,$4,5)",[item,calc,product,raw]);
      await db.query("set constraints public.test_calculation_items_hold_total,public.test_calculation_holds_item_total immediate;set constraints public.test_calculation_items_hold_total,public.test_calculation_holds_item_total deferred");
      const before=await stock(),created=await call("create"),held=await call("edit",created.work_order_id,created.updated_at,input("20"));expect(held.materials[0].held).toBe("12");expect(await stock()).toEqual(before);
    });
    if(finishIntegration){
      type Job={id:string;updated:string;pcb?:boolean;output?:string};
      async function ordinary(quantity:string,reserved=true):Promise<Job>{
        const p=await project(),created=await call("create");
        if(reserved){const saved=await call("edit",created.work_order_id,created.updated_at,{...input(quantity),project_id:p.id});return{id:created.work_order_id,updated:saved.updated_at};}
        await db.query("select * from public.save_draft_work_order($1,$2,'Owned historical Finish',$3,$4)",[created.work_order_id,p.id,JSON.stringify(items(quantity)),created.updated_at]);return{id:created.work_order_id,updated:await version(created.work_order_id)};
      }
      async function pcb():Promise<Job>{
        const serial=(await db.query("select lpad(n::text,3,'0') serial from generate_series(0,999) n where not exists(select 1 from public.products where serial_number=lpad(n::text,3,'0')) order by n limit 1")).rows[0].serial;
        const card=(await db.query("select * from public.create_pcb_card($1,$2)",[`Owned reserved PCB ${randomUUID()}`,serial])).rows[0];
        await db.query("select * from public.save_initial_pcb_bom($1,$2)",[card.pcb_card_id,JSON.stringify([{product_id:product,quantity_per_card:"2"}])]);
        const created=await call("create_pcb",null,null,{pcb_card_id:card.pcb_card_id,planned_quantity:"3"}),saved=await call("supplemental",created.work_order_id,created.updated_at,{items:items("3")});
        return{id:created.work_order_id,updated:saved.updated_at,pcb:true,output:(await db.query("select output_product_id from public.pcb_cards where id=$1",[card.pcb_card_id])).rows[0].output_product_id};
      }
      async function pdf(job:Job,actual="2"){
        const rows=job.pcb?(await db.query("select * from public.get_work_order_pdf_snapshot($1,$2,$3)",[job.id,job.updated,actual])).rows:(await db.query("select * from public.get_work_order_pdf_snapshot($1,$2)",[job.id,job.updated])).rows;
        const fingerprint=(await db.query("select public.get_work_order_source_allocation_fingerprint($1) value",[job.id])).rows[0].value;expect(new Set(rows.map(r=>r.allocation_fingerprint))).toEqual(new Set([fingerprint]));
        const storage=`final/${job.id}/${randomUUID()}.pdf`;await db.query("insert into storage.objects(bucket_id,name,metadata) values('work-order-pdfs',$1,'{\"mimetype\":\"application/pdf\"}')",[storage]);return{fingerprint,storage};
      }
      const finish=async(job:Job,file:{fingerprint:string;storage:string},actual="2",client=db)=>job.pcb?(await client.query("select * from public.finish_work_order($1,$2,$3,$4,$5,$6)",[job.id,job.updated,file.storage,"a".repeat(64),file.fingerprint,actual])).rows:(await client.query("select * from public.finish_work_order($1,$2,$3,$4,$5)",[job.id,job.updated,file.storage,"a".repeat(64),file.fingerprint])).rows;
      const events=async(wo:string)=>(await db.query("select event_type,sum(quantity)::text q from public.work_order_material_reservation_events where work_order_id=$1 and event_type in ('consumed','released') group by event_type order by event_type",[wo])).rows;
      async function conservation(){for(const row of(await db.query("select b.quantity::text physical,coalesce((select sum(l.remaining_quantity) from public.inventory_source_lots l where l.product_id=b.product_id and l.warehouse_id=b.warehouse_id),0)::text lots from public.inventory_balances b where b.product_id=$1",[product])).rows)expect(row.physical).toBe(row.lots);}
      if(wiring){
        const gate=async(enabled:boolean)=>{target.assertOwnedClone(name);await db.query("update public.work_order_reservation_activation set enabled=$1",[enabled]);};
        async function asPublic(sql:string,args:unknown[]=[]){await db.query("savepoint public_call");try{await db.query("set local role authenticated");const r=await db.query(sql,args);await db.query("reset role;release savepoint public_call");return r.rows[0];}catch(error){await db.query("rollback to savepoint public_call;release savepoint public_call");throw error;}}
        const publicCreate=()=>asPublic("select * from public.create_draft_work_order()");
        const publicSave=(id:string,updated:string,q:string)=>asPublic("select * from public.save_draft_work_order($1,null,'Owned public Draft',$2,$3)",[id,JSON.stringify(items(q)),updated]);
        const totals=async(id:string)=>(await db.query("select required_quantity::text required,held_quantity::text held,uncovered_quantity::text uncovered from public.work_order_material_reservation_totals where work_order_id=$1 and product_id=$2",[id,product])).rows[0];
        async function cardFixture(){const serial=(await db.query("select lpad(n::text,3,'0') serial from generate_series(0,999) n where not exists(select 1 from public.products where serial_number=lpad(n::text,3,'0')) order by n limit 1")).rows[0].serial;const card=(await db.query("select * from public.create_pcb_card($1,$2)",[`Owned public PCB ${randomUUID()}`,serial])).rows[0];await db.query("select * from public.save_initial_pcb_bom($1,$2)",[card.pcb_card_id,JSON.stringify([{product_id:product,quantity_per_card:"2"}])]);return card.pcb_card_id;}
        it("177 gate ON public ordinary saves reserve partial stock, preserve exact retries and release on delete",async()=>{
          await gate(true);const before=await stock(),created=await publicCreate(),saved=await publicSave(created.work_order_id,await version(created.work_order_id),"20");expect(await totals(created.work_order_id)).toEqual({required:"20",held:"12",uncovered:"8"});
          expect(await publicSave(created.work_order_id,(await db.query("select expected_updated_at::text value from public.work_order_material_reservation_receipts where work_order_id=$1 and operation='edit'",[created.work_order_id])).rows[0].value,"20")).toEqual(saved);
          const zero=await publicCreate();await publicSave(zero.work_order_id,await version(zero.work_order_id),"3");expect(await totals(zero.work_order_id)).toEqual({required:"3",held:"0",uncovered:"3"});
          const updated=await version(created.work_order_id);await publicSave(created.work_order_id,updated,"6");expect(await totals(created.work_order_id)).toEqual({required:"6",held:"6",uncovered:"0"});await expect(publicSave(created.work_order_id,updated,"7")).rejects.toMatchObject({code:"WOR05"});await publicSave(created.work_order_id,await version(created.work_order_id),"8");expect(await totals(created.work_order_id)).toEqual({required:"8",held:"8",uncovered:"0"});expect((await totals(zero.work_order_id)).held).toBe("0");expect(await stock()).toEqual(before);
          const deleteVersion=await version(created.work_order_id),deleted=await asPublic("select * from public.delete_draft_work_order($1,$2)",[created.work_order_id,deleteVersion]);expect(deleted.work_order_id).toBe(created.work_order_id);expect((await totals(created.work_order_id)).held).toBe("0");expect(await asPublic("select * from public.delete_draft_work_order($1,$2)",[created.work_order_id,deleteVersion])).toEqual(deleted);
        });
        it("177 public PCB creation preserves frozen quantities, Project rejection, normalized replay and supplemental holds",async()=>{
          await gate(true);const card=await cardFixture(),p=await project(),request=randomUUID();await expect(asPublic("select * from public.create_pcb_production_work_order($1,'3',$2,$3)",[card,p.id,request])).rejects.toMatchObject({code:"PCB10"});const created=await asPublic("select * from public.create_pcb_production_work_order($1,'003',null,$2)",[card,request]);expect(await totals(created.work_order_id)).toEqual({required:"6",held:"6",uncovered:"0"});expect((await db.query("select project_id from public.work_orders where id=$1",[created.work_order_id])).rows[0].project_id).toBeNull();
          expect(await asPublic("select * from public.create_pcb_production_work_order($1,'3',null,$2)",[card,request])).toEqual(created);const before=await stock();await asPublic("select * from public.save_pcb_production_supplemental_materials($1,$2,$3)",[created.work_order_id,JSON.stringify(items("3")),await version(created.work_order_id)]);expect(await totals(created.work_order_id)).toEqual({required:"9",held:"9",uncovered:"0"});expect(await stock()).toEqual(before);
          const job:Job={id:created.work_order_id,updated:await version(created.work_order_id),pcb:true};await finish(job,await pdf(job));expect((await totals(job.id)).held).toBe("0");await conservation();
        });
        it("177 OFF preserves legacy PCB replay without backfill and retains tracked deletion safety",async()=>{
          const card=await cardFixture(),request=randomUUID(),created=await asPublic("select * from public.create_pcb_production_work_order($1,'3',null,$2)",[card,request]);expect(await totals(created.work_order_id)).toBeUndefined();await gate(true);expect(await asPublic("select * from public.create_pcb_production_work_order($1,'3',null,$2)",[card,request])).toEqual(created);expect(await totals(created.work_order_id)).toBeUndefined();
          const ordinary=await publicCreate();await publicSave(ordinary.work_order_id,await version(ordinary.work_order_id),"2");await gate(false);await asPublic("select * from public.delete_draft_work_order($1,$2)",[ordinary.work_order_id,await version(ordinary.work_order_id)]);expect((await totals(ordinary.work_order_id)).held).toBe("0");
        });
        it("177 enrollment pause preserves exact actor-bound PCB replay and rejects changed requests",async()=>{
          await gate(true);const card=await cardFixture(),request=randomUUID(),created=await asPublic("select * from public.create_pcb_production_work_order($1,'3',null,$2)",[card,request]);await gate(false);expect(await asPublic("select * from public.create_pcb_production_work_order($1,'003',null,$2)",[card,request])).toEqual(created);
          await expect(asPublic("select * from public.create_pcb_production_work_order($1,'4',null,$2)",[card,request])).rejects.toMatchObject({code:"PCB13"});
          await db.query("delete from public.user_permissions where user_id=$1",[member.id]);await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key='pcb.produce'",[member.id,actor.id]);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member.auth_user_id]);await expect(asPublic("select * from public.create_pcb_production_work_order($1,'3',null,$2)",[card,request])).rejects.toMatchObject({code:"42501"});
        });
        it("177 competing public Drafts protect stock and public ordinary Finish consumes only its owner",async()=>{
          await gate(true);const a=await publicCreate(),b=await publicCreate(),p=await project();await asPublic("select * from public.save_draft_work_order($1,$2,'Owned public Finish',$3,$4)",[a.work_order_id,p.id,JSON.stringify(items("7")),await version(a.work_order_id)]);await publicSave(b.work_order_id,await version(b.work_order_id),"8");expect(await totals(b.work_order_id)).toEqual({required:"8",held:"5",uncovered:"3"});await expect(asPublic("select * from public.adjust_inventory_warehouse($1,$2,'remove',1,'Owned protected public debit')",[product,raw])).rejects.toMatchObject({code:"IVB02"});
          const job:Job={id:a.work_order_id,updated:await version(a.work_order_id)};await finish(job,await pdf(job));expect((await totals(job.id)).held).toBe("0");expect((await totals(b.work_order_id)).held).toBe("5");await expect(publicSave(job.id,await version(job.id),"9")).rejects.toMatchObject({code:"WOR02"});expect((await totals(job.id)).held).toBe("0");await conservation();
        });
        it("177 denies private gate/base access and preserves authorized non-Admin Draft operations",async()=>{
          await gate(true);await expect(asPublic("update public.work_order_reservation_activation set enabled=true")).rejects.toMatchObject({code:"42501"});await expect(asPublic("select * from public.create_draft_work_order_reservation_base()")).rejects.toMatchObject({code:"42501"});await expect(asPublic("select public.draft_work_order_reservations_enabled()")).rejects.toMatchObject({code:"42501"});
          for(const role of ["anon","authenticated","service_role"]){expect((await db.query("select has_table_privilege($1,'public.work_order_reservation_activation','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed).toBe(false);for(const fn of ["public.create_draft_work_order_reservation_base()","public.create_pcb_production_work_order_reservation_base(uuid,text,uuid,uuid)","public.save_draft_work_order_reservation_base(uuid,uuid,text,jsonb,timestamptz)","public.save_pcb_production_supplemental_materials_reservation_base(uuid,jsonb,timestamptz)","public.delete_draft_work_order_reservation_base(uuid,timestamptz)","public.draft_work_order_reservations_enabled()","public.draft_reservation_request_id(text,uuid,timestamptz,jsonb)",signature])expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,fn])).rows[0].allowed).toBe(false);}
          await db.query("delete from public.user_permissions where user_id=$1",[member.id]);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member.auth_user_id]);await expect(publicCreate()).rejects.toMatchObject({code:"42501"});await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,actor.id,["work_orders.create","work_orders.edit_draft","work_orders.delete_draft"]]);const job=await publicCreate();await publicSave(job.work_order_id,await version(job.work_order_id),"2");expect((await totals(job.work_order_id)).held).toBe("2");await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);await expect(publicSave(job.work_order_id,await version(job.work_order_id),"3")).rejects.toMatchObject({code:"42501"});
        });
        it("177 public save rolls back canonical materials and reservations on forced receipt failure",async()=>{
          await gate(true);const created=await publicCreate();await db.query("create function public.owned_public_failure() returns trigger language plpgsql as $$begin raise exception 'Owned forced public failure' using errcode='P9977';end$$;create trigger owned_public_failure before insert on public.work_order_material_reservation_receipts for each row execute function public.owned_public_failure()");const before=await reservationSnapshot(db);await expect(publicSave(created.work_order_id,await version(created.work_order_id),"4")).rejects.toMatchObject({code:"P9977"});expect(await reservationSnapshot(db)).toEqual(before);
        });
        it.each(["draft","debit","test","fg"])("177 public admission serializes competing %s operations",async scenario=>{
          if(scenario==="fg")await finishedInput();await gate(true);const first=await publicCreate(),second=await publicCreate(),firstVersion=await version(first.work_order_id),secondVersion=await version(second.work_order_id),p=scenario==="fg"?await project():null;
          if(p)await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,3,$3,$3)",[p.group,product,actor.id]);target.assertOwnedClone(name);await db.query("commit");committedFixture=true;
          const a=await pool.connect(),b=await pool.connect();try{
            for(const c of [a,b]){await c.query("begin;set local statement_timeout='15s';set local lock_timeout='10s'");await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);await c.query("set local role authenticated");}
            await a.query("select * from public.save_draft_work_order($1,null,'Owned concurrent public',$2,$3)",[first.work_order_id,JSON.stringify(items(scenario==="fg"?"2":"7")),firstVersion]);const pid=(await b.query("select pg_backend_pid() pid")).rows[0].pid;
            const operation=scenario==="draft"?b.query("select * from public.save_draft_work_order($1,null,'Owned competing public',$2,$3)",[second.work_order_id,JSON.stringify(items("8")),secondVersion]):scenario==="debit"?b.query("select * from public.adjust_inventory_warehouse($1,$2,'remove',1,'Owned competing public debit')",[product,raw]):scenario==="test"?b.query("select public.save_test_calculation($1,$2,$3,'2090-01-01') value",[randomUUID(),`Owned public Test race ${randomUUID()}`,JSON.stringify(items("8"))]):b.query("select * from public.reserve_finished_goods_for_project($1,$2,1,0,$3)",[p!.id,product,randomUUID()]);const waiting=operation.then(value=>({value,error:null}),error=>({value:null,error}));
            let blocked=false;for(let i=0;i<100;i++){blocked=(await db.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[pid])).rows[0]?.blocked===true;if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));}expect(blocked).toBe(true);await a.query("commit");const outcome=await waiting;
            if(scenario==="debit"){expect(outcome.error).toMatchObject({code:"IVB02"});await b.query("rollback");}else{expect(outcome.error).toBeNull();await b.query("commit");if(scenario==="draft")expect((await totals(second.work_order_id)).held).toBe("5");if(scenario==="test")expect(outcome.value!.rows[0].value.items[0].held_quantity).toBe("5");}
            expect((await totals(first.work_order_id)).held).toBe(scenario==="fg"?"2":"7");await conservation();
          }finally{await a.query("rollback");await b.query("rollback");a.release(true);b.release(true);await gate(false);baseline=await snapshot(pool);}
        });
      }
      it("174 ordinary Finish consumes owned multi-warehouse holds atomically and replays exactly",async()=>{
        const job=await ordinary("7"),file=await pdf(job);await db.query("set local role authenticated");const result=await finish(job,file);await db.query("reset role");expect(result[0].work_order_id).toBe(job.id);
        expect(await events(job.id)).toEqual([{event_type:"consumed",q:"7"}]);const before=await reservationSnapshot(db);expect(await finish(job,file)).toEqual(result);expect(await reservationSnapshot(db)).toEqual(before);
        expect((await db.query("select status from public.work_order_material_reservation_states where work_order_id=$1",[job.id])).rows).toEqual([{status:"consumed"}]);await conservation();
      });
      it("174 partial holds consume free arrivals and release unused lower-priority allocations",async()=>{
        const job=await ordinary("20");await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add',10,'Owned Finish arrival',$3)",[product,raw,supplier]);const file=await pdf(job);await finish(job,file);
        expect(await events(job.id)).toEqual([{event_type:"consumed",q:"10"},{event_type:"released",q:"2"}]);expect((await db.query("select warehouse_id,quantity::text q from public.inventory_balances where product_id=$1 order by warehouse_id",[product])).rows).toEqual([{warehouse_id:raw,q:"0"},{warehouse_id:fg,q:"2"},{warehouse_id:customs,q:"0"}]);await conservation();
      });
      it("174 historical unreserved Draft Finish stays compatible without reservation backfill",async()=>{
        const job=await ordinary("7",false),file=await pdf(job);await finish(job,file);expect(await events(job.id)).toEqual([]);expect((await db.query("select count(*)::int n from public.work_order_material_reservation_states where work_order_id=$1",[job.id])).rows[0].n).toBe(0);await conservation();
      });
      it("174 zero-held Draft consumes new free stock while protecting another Draft",async()=>{
        const other=await ordinary("20"),job=await ordinary("7");await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add',7,'Owned uncovered arrival',$3)",[product,raw,supplier]);await finish(job,await pdf(job));
        expect((await db.query("select held_quantity::text q from public.work_order_material_reservation_totals where work_order_id=$1",[other.id])).rows[0].q).toBe("12");expect(await events(job.id)).toEqual([]);await conservation();
      });
      it.each(["0","2"])("174 PCB Finish preserves frozen/supplemental inputs and actual output %s",async actual=>{
        const job=await pcb(),file=await pdf(job,actual);await finish(job,file,actual);expect(await events(job.id)).toEqual([{event_type:"consumed",q:"9"}]);
        expect((await db.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[job.output,fg])).rows[0].q).toBe(actual);expect((await db.query("select count(*)::int n from public.work_order_pdfs where work_order_id=$1 and storage_reference=$2",[job.id,file.storage])).rows[0].n).toBe(1);await conservation();
      });
      it("174 consumes exact bigint quantities above JavaScript precision",async()=>{
        await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add','9007199254740993','Owned bigint Finish',$3)",[product,raw,supplier]);
        const job=await ordinary("9007199254740994"),file=await pdf(job);await finish(job,file);expect(await events(job.id)).toEqual([{event_type:"consumed",q:"9007199254740994"}]);
        expect((await db.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[product,raw])).rows[0].q).toBe("4");await conservation();
      });
      it("174 ownership-version changes invalidate an otherwise identical source plan",async()=>{
        const job=await ordinary("7"),file=await pdf(job),request=randomUUID(),number=(await db.query("select work_order_number n from public.work_orders where id=$1",[job.id])).rows[0].n;
        await db.query("insert into public.work_order_material_reservation_receipts(request_id,work_order_id,work_order_number,actor_user_id,auth_user_id,operation,expected_updated_at,submitted_payload,receipt) values($1,$2,$3,$4,$5,'edit',$6,$7,$8)",[request,job.id,number,actor.id,actor.auth_user_id,job.updated,{work_order_id:job.id,auth_user_id:actor.auth_user_id,operation:"edit"},{request_id:request,work_order_id:job.id,operation:"edit"}]);
        await db.query("update public.work_order_material_reservation_states set version=version+1,last_request_id=$2 where work_order_id=$1",[job.id,request]);
        expect((await db.query("select public.get_work_order_source_allocation_fingerprint($1) value",[job.id])).rows[0].value).not.toBe(file.fingerprint);
        await expect(attempt(()=>finish(job,file))).rejects.toMatchObject({code:"WOR11"});
      });
      it("174 rolls back inputs, output, reservations, events and PDF linkage after a forced completion failure",async()=>{
        const job=await pcb(),file=await pdf(job);await db.query("create function public.owned_finish_failure() returns trigger language plpgsql as $$begin raise exception 'Owned forced completion failure' using errcode='P9998';end$$;create trigger owned_finish_failure before update of status on public.work_orders for each row when(new.status='finished') execute function public.owned_finish_failure()");const before=await reservationSnapshot(db);
        await expect(attempt(()=>finish(job,file))).rejects.toMatchObject({code:"P9998"});expect(await reservationSnapshot(db)).toEqual(before);await db.query("drop trigger owned_finish_failure on public.work_orders;drop function public.owned_finish_failure()");
      });
      it("174 rejects insufficient/changed plans and preserves authorization",async()=>{
        const shortage=await ordinary("20");await expect(attempt(()=>pdf(shortage))).rejects.toMatchObject({code:"IVB02"});
        const job=await ordinary("2",false);await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add',5,'Owned planned source',$3)",[product,raw,supplier]);
        const file=await pdf(job);await db.query("delete from public.user_permissions where user_id=$1",[member.id]);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member.auth_user_id]);
        await expect(attempt(()=>finish(job,file))).rejects.toMatchObject({code:"42501"});await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);
        await expect(attempt(()=>finish(job,{...file,fingerprint:"0".repeat(32)}))).rejects.toMatchObject({code:"WOR11"});
      });
      if(accounting){
        const serial=async()=>(await db.query("select serial_number s from public.products where id=$1",[product])).rows[0].s;
        const read=async(warehouse=raw,active:boolean|null=true,limit=100,offset=0)=>(await db.query("select public.get_inventory_reservation_accounting($1,$2,$3,$4,$5) value",[warehouse,await serial(),active,limit,offset])).rows[0].value;
        const status=async(id:string)=>(await db.query("select public.get_work_order_material_commitment_status($1) value",[id])).rows[0].value;
        const drain=async()=>db.query("set constraints public.work_order_material_shortage_queue_process immediate;set constraints public.work_order_material_shortage_queue_process deferred");
        if(breakdown){
          const sources=async(metric="work_order_reservation",warehouse=raw,scope="raw_customs",limit=50,cursor:unknown=null)=>{
            const value=(await db.query("select public.get_inventory_commitment_breakdown($1,$2,$3,$4,$5,$6) value",[product,warehouse,metric,scope,limit,cursor])).rows[0].value;
            expect(parseInventoryCommitmentBreakdown(value,{productId:product,warehouseId:warehouse,metric,scope,limit,cursor} as BreakdownRequest).ok).toBe(true);return value;
          };
          it("176 attributes multiple Drafts by scope, reconciles totals and stable pages without accounting writes",async()=>{
            const first=await ordinary("7"),second=await ordinary("8"),before=await stock(),page=await sources("work_order_reservation",raw,"raw_customs",1);
            expect(page).toMatchObject({metric_total:"9",visible_total:"9",restricted_remainder:"0",visible_before_quantity:"0",has_more:true});expect(page.items).toHaveLength(1);
            const next=await sources("work_order_reservation",raw,"raw_customs",1,page.next_cursor);expect(next.has_more).toBe(false);expect(BigInt(page.page_subtotal)+BigInt(next.page_subtotal)).toBe(9n);expect(new Set([...page.items,...next.items].map(r=>r.source_id))).toEqual(new Set([first.id,second.id]));
            expect((await sources("work_order_reservation",customs,"warehouse")).metric_total).toBe("4");expect((await sources("work_order_reservation",raw,"warehouse")).metric_total).toBe("5");expect(await stock()).toEqual(before);
            await call("delete",first.id,first.updated);await expect(attempt(()=>sources("work_order_reservation",raw,"raw_customs",1,page.next_cursor))).rejects.toMatchObject({code:"ICB01"});
          });
          it("176 separates Project planning, FG reservations and effective Tests",async()=>{
            const job=await ordinary("2");await db.query("select public.save_test_calculation($1,'Owned breakdown Test',$2,'2090-01-01')",[randomUUID(),JSON.stringify(items("2"))]);expect((await sources("test_hold")).metric_total).toBe("2");
            await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) select g.id,$2,10,$3,$3 from public.project_products g join public.work_orders w on w.project_id=g.project_id where w.id=$1",[job.id,product,actor.id]);expect((await sources("project_demand")).metric_total).toBe("10");
            await finishedInput();const p=await project();await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,3,$3,$3)",[p.group,product,actor.id]);await db.query("select * from public.reserve_finished_goods_for_project($1,$2,1,0,$3)",[p.id,product,randomUUID()]);
            expect((await sources("fg_project_reservation",fg,"warehouse"))).toMatchObject({metric_total:"1",items:[{source_id:p.id,quantity:"1",navigation_allowed:true}]});await expect(attempt(()=>sources("test_hold",raw,"warehouse"))).rejects.toMatchObject({code:"P0002"});
          });
          it("176 restricts source identities and global context under real authenticated warehouse/module roles",async()=>{
            await ordinary("7");await db.query("delete from public.user_permissions where user_id=$1",[member.id]);await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key='inventory.customs.view'",[member.id,actor.id]);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member.auth_user_id]);await db.query("set local role authenticated");
            expect(await sources("work_order_reservation",customs,"warehouse")).toMatchObject({metric_total:"2",visible_total:"0",restricted_remainder:"2",restricted_label:"Restricted sources",items:[],next_cursor:null});await expect(attempt(()=>sources())).rejects.toMatchObject({code:"42501"});await db.query("reset role");
            await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key='work_orders.view'",[member.id,actor.id]);await db.query("set local role authenticated");expect((await sources("work_order_reservation",customs,"warehouse")).items[0]).toMatchObject({navigation_allowed:true,quantity:"2",required_quantity:null,held_quantity:null,uncovered_quantity:null});await db.query("reset role;set local role anon");await expect(attempt(()=>sources("work_order_reservation",customs,"warehouse"))).rejects.toMatchObject({code:"42501"});await db.query("reset role");
          });
          it("176 validates bounds, metric scope, cursor isolation and exact bigint quantities",async()=>{
            await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add','9007199254740993','Owned breakdown bigint',$3)",[product,raw,supplier]);await ordinary("9007199254740994");expect((await sources()).metric_total).toBe("9007199254740994");expect((await sources()).items[0]).toMatchObject({required_quantity:"9007199254740994",held_quantity:"9007199254740994",uncovered_quantity:"0"});
            await expect(attempt(()=>sources("project_demand",raw,"warehouse"))).rejects.toMatchObject({code:"22023"});await expect(attempt(()=>sources("work_order_reservation",raw,"raw_customs",101))).rejects.toMatchObject({code:"22023"});await expect(attempt(()=>sources("work_order_reservation",raw,"raw_customs",1,{after_id:randomUUID(),snapshot:"bad"}))).rejects.toMatchObject({code:"ICB01"});
          });
          it("176 reflects source-specific import releases and ignores expired holds without changing physical accounting",async()=>{
            const selected=(await db.query("select public.save_test_calculation($1,$2,$3,'2090-01-01') value",[randomUUID(),`Owned breakdown release ${randomUUID()}`,JSON.stringify(items("7"))])).rows[0].value;
            const other=(await db.query("select public.save_test_calculation($1,$2,$3,'2090-01-01') value",[randomUUID(),`Owned breakdown other ${randomUUID()}`,JSON.stringify(items("2"))])).rows[0].value;
            const expired=randomUUID(),expiredItem=randomUUID();await db.query("insert into public.test_calculations(id,name,created_by_user_id,created_at,deadline_date,expires_at,request_id,submitted_payload,save_receipt) values($1,'Owned expired source',$2,'2020-01-01','2020-01-02',('2020-01-03'::timestamp at time zone 'Europe/Sarajevo'),$3,'{}','{}')",[expired,actor.id,randomUUID()]);
            await db.query("insert into public.test_calculation_items(id,calculation_id,product_id,product_name_snapshot,serial_number_snapshot,product_kind_snapshot,required_quantity,held_quantity,uncovered_quantity) values($1,$2,$3,'Owned expired source',$4,'component',2,2,0)",[expiredItem,expired,product,await serial()]);await db.query("insert into public.test_calculation_holds(item_id,calculation_id,product_id,warehouse_id,quantity) values($1,$2,$3,$4,2)",[expiredItem,expired,product,raw]);
            const before=await sources("test_hold");expect(before.metric_total).toBe("9");expect(before.items.map((r:{source_id:string})=>r.source_id)).not.toContain(expired);
            const physical=async()=>(await db.query("select jsonb_build_object('balances',(select jsonb_agg(to_jsonb(b) order by warehouse_id) from public.inventory_balances b where product_id=$1),'movements',(select count(*) from public.inventory_movements),'lots',(select count(*) from public.inventory_source_lots),'holds',(select jsonb_agg(to_jsonb(h) order by item_id,warehouse_id) from public.test_calculation_holds h)) value",[product])).rows[0].value;
            const preserved=await physical(),outputSerial=(await db.query("select lpad(n::text,3,'0') serial from generate_series(0,999) n where not exists(select 1 from public.products where serial_number=lpad(n::text,3,'0')) order by n limit 1")).rows[0].serial;
            await db.query("select public.import_test_calculation($1,$2,$3)",[randomUUID(),selected.calculation_id,outputSerial]);const after=await sources("test_hold");expect(after).toMatchObject({metric_total:"2",items:[{source_id:other.calculation_id,quantity:"2"}]});expect(await physical()).toEqual(preserved);expect((await sources("test_hold",raw,"warehouse")).metric_total).toBe("0");expect((await sources("test_hold",customs,"warehouse")).metric_total).toBe("2");
          });
          it("176 enforces source-module grants, cursor profile isolation, inactive denial and narrow EXECUTE",async()=>{
            await ordinary("2");await ordinary("2");const page=await sources("work_order_reservation",raw,"raw_customs",1);
            await db.query("select public.save_test_calculation($1,$2,$3,'2090-01-01')",[randomUUID(),`Owned private source ${randomUUID()}`,JSON.stringify(items("2"))]);
            await db.query("delete from public.user_permissions where user_id=$1",[member.id]);await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,actor.id,["inventory.raw_materials.view","inventory.customs.view","inventory.finished_goods.view","work_orders.view"]]);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member.auth_user_id]);await db.query("set local role authenticated");
            await expect(attempt(()=>sources("work_order_reservation",raw,"raw_customs",1,page.next_cursor))).rejects.toMatchObject({code:"ICB01"});expect(await sources("test_hold")).toMatchObject({metric_total:"2",visible_total:"0",restricted_remainder:"2",items:[]});await db.query("reset role");
            await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key='test_calculator.view'",[member.id,actor.id]);await db.query("set local role authenticated");expect((await sources("test_hold")).items[0].navigation_allowed).toBe(true);await expect(attempt(()=>db.query("select * from public.work_order_material_reservation_allocations"))).rejects.toMatchObject({code:"42501"});await db.query("reset role");await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);await db.query("set local role authenticated");await expect(attempt(()=>sources())).rejects.toMatchObject({code:"42501"});await db.query("reset role");
            for(const role of ["anon","service_role"])expect((await db.query("select has_function_privilege($1,'public.get_inventory_commitment_breakdown(uuid,uuid,text,text,integer,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed).toBe(false);
          });
          it("176 excludes finished/deleted owners and preserves authoritative zero/partial quantities",async()=>{
            expect(await sources()).toMatchObject({metric_total:"0",visible_total:"0",restricted_remainder:"0",items:[]});const first=await ordinary("7"),second=await ordinary("8");expect((await sources()).metric_total).toBe("9");await call("delete",second.id,second.updated);await finish(first,await pdf(first));expect((await sources()).metric_total).toBe("0");
          });
          it("Task 9 reconciles every breakdown metric with accounting and existing clickable quantities in one snapshot",async()=>{
            await db.query("select public.save_test_calculation($1,$2,$3,'2090-01-01')",[randomUUID(),`Owned integrated sources ${randomUUID()}`,JSON.stringify(items("2"))]);const job=await ordinary("7");
            await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) select g.id,$2,11,$3,$3 from public.project_products g join public.work_orders w on w.project_id=g.project_id where w.id=$1",[job.id,product,actor.id]);
            async function compare(warehouse:string,scope:string){const search=await serial();const row=(await db.query("select public.get_inventory_reservation_accounting($2,$3,true,100,0) accounting,public.get_inventory_commitment_breakdown($1,$2,'test_hold',$4,25,null) tests,public.get_inventory_commitment_breakdown($1,$2,'work_order_reservation',$4,25,null) work_orders",[product,warehouse,search,scope])).rows[0];const item=row.accounting.items.find((r:{product_id:string})=>r.product_id===product);expect(row.tests.metric_total).toBe(item.test_held_quantity);expect(row.work_orders.metric_total).toBe(item.work_order_held_quantity);const legacy=(await db.query("select * from public.get_inventory_test_commitments($1,$2) where product_id=$3",[warehouse,search,product])).rows[0];expect(legacy.committed_to_tests).toBe(row.tests.metric_total);return item;}
            const before=await stock(),rawRow=await compare(raw,"raw_customs"),customsRow=await compare(customs,"warehouse");expect((await sources("project_demand")).metric_total).toBe(rawRow.project_demand_quantity);expect((await db.query("select committed_to_projects::text q from public.get_inventory_project_commitments() where product_id=$1",[product])).rows[0].q).toBe(rawRow.project_demand_quantity);expect(rawRow.project_coverage_quantity).toBe("0");expect(rawRow.work_order_held_quantity).toBe("7");expect(customsRow.work_order_held_quantity).toBe("4");expect(await stock()).toEqual(before);
            await finishedInput();const p=await project();await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,3,$3,$3)",[p.group,product,actor.id]);await db.query("select * from public.reserve_finished_goods_for_project($1,$2,1,0,$3)",[p.id,product,randomUUID()]);await db.query("select public.save_test_calculation($1,$2,$3,'2090-01-01')",[randomUUID(),`Owned integrated FG ${randomUUID()}`,JSON.stringify(items("1"))]);await ordinary("1");const fgRow=await compare(fg,"warehouse");expect((await sources("fg_project_reservation",fg,"warehouse")).metric_total).toBe(fgRow.fg_reserved_quantity);expect((await db.query("select committed_to_projects::text q from public.get_finished_goods_inventory_commitments() where product_id=$1",[product])).rows[0].q).toBe(fgRow.fg_reserved_quantity);
          });
          it("Task 9 serializes a linked Draft edit against a physical debit with Project shortage history",async()=>{
            const job=await ordinary("2"),p=(await db.query("select project_id id from public.work_orders where id=$1",[job.id])).rows[0].id;
            await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) select g.id,$2,12,$3,$3 from public.project_products g where g.project_id=$1",[p,product,actor.id]);
            target.assertOwnedClone(name);await db.query("commit");committedFixture=true;const a=await pool.connect(),b=await pool.connect();
            try{
              for(const c of [a,b]){await c.query("begin;set local statement_timeout='15s';set local lock_timeout='10s'");await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);}
              await a.query("set local role authenticated");await a.query("select * from public.adjust_inventory_warehouse($1,$2,'remove',1,'Owned integrated debit/edit')",[product,raw]);
              const pid=(await b.query("select pg_backend_pid() pid")).rows[0].pid,waiting=call("edit",job.id,job.updated,{...input("3"),project_id:p},randomUUID(),b).then(value=>({value,error:null}),error=>({value:null,error}));
              let blocked=false;for(let i=0;i<100;i++){blocked=(await db.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[pid])).rows[0]?.blocked===true;if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));}expect(blocked).toBe(true);
              const committed=await a.query("commit").then(()=>({error:null}),error=>({error}));if(committed.error)await a.query("rollback");const outcome=await waiting;if(outcome.error)await b.query("rollback");else await b.query("commit");expect(committed.error).toBeNull();expect(outcome.error).toBeNull();await conservation();
            }finally{await a.query("rollback");await b.query("rollback");a.release(true);b.release(true);baseline=await snapshot(pool);}
          });
        }
        it("175 exposes explicit physical/planning scopes and unchanged zero-hold membership",async()=>{
          const before=await stock();expect((await read()).items[0]).toMatchObject({physical_quantity:"5",scope_physical_quantity:"9",work_order_held_quantity:"0",warehouse_work_order_held_quantity:"0",net_available_after_all_commitments:"9"});
          expect((await read(customs)).items[0]).toMatchObject({physical_quantity:"4",scope_physical_quantity:"4",net_available_after_all_commitments:"4"});expect((await read(fg)).items).toEqual([]);expect(await stock()).toEqual(before);
        });
        it("175 distinguishes Required/Held/Uncovered and warehouse holds for competing Drafts",async()=>{
          const first=await ordinary("7"),second=await ordinary("8");expect((await status(first.id)).materials[0]).toMatchObject({required_quantity:"7",held_quantity:"7",uncovered_quantity:"0",eligible_quantity:"7"});
          expect((await status(second.id)).materials[0]).toMatchObject({required_quantity:"8",held_quantity:"5",uncovered_quantity:"3",eligible_quantity:"5",missing_quantity:"3"});
          expect((await read()).items[0]).toMatchObject({work_order_held_quantity:"9",warehouse_work_order_held_quantity:"5",hard_available_quantity:"0"});expect((await read(customs)).items[0]).toMatchObject({work_order_held_quantity:"4",warehouse_work_order_held_quantity:"4"});
        });
        it("175 never infers Project coverage from a linked Work Order",async()=>{
          const job=await ordinary("7");await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) select g.id,$2,10,$3,$3 from public.project_products g join public.work_orders w on w.project_id=g.project_id where w.id=$1",[job.id,product,actor.id]);
          expect((await read()).items[0]).toMatchObject({project_demand_quantity:"10",work_order_held_quantity:"7",project_coverage_quantity:"0",available_after_projects:"-1",hard_available_quantity:"2",net_available_after_all_commitments:"-8"});
        });
        it("175 preserves Test/FG accounting, legacy projections and physical-only Stock Health",async()=>{
          await db.query("select * from public.set_inventory_stock_minimum($1,$2,'6',null)",[product,raw]);const healthSql="select * from public.get_inventory_stock_health($1,$2,null,true,100,0)",search=await serial(),health=(await db.query(healthSql,[raw,search])).rows;
          await db.query("select public.save_test_calculation($1,'Owned accounting Test',$2,'2090-01-01')",[randomUUID(),JSON.stringify(items("2"))]);await ordinary("7");
          expect((await read()).items[0]).toMatchObject({physical_quantity:"5",test_held_quantity:"2",work_order_held_quantity:"7",net_available_after_all_commitments:"0"});
          expect((await db.query("select * from public.get_inventory_test_commitments($1,$2)",[raw,search])).rows[0]).toMatchObject({available_after_projects_and_tests:"7"});expect((await db.query(healthSql,[raw,search])).rows).toEqual(health);
          await finishedInput();const p=await project();await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,3,$3,$3)",[p.group,product,actor.id]);await db.query("select * from public.reserve_finished_goods_for_project($1,$2,1,0,$3)",[p.id,product,randomUUID()]);await ordinary("1");await db.query("select public.save_test_calculation($1,'Owned FG accounting',$2,'2090-01-01')",[randomUUID(),JSON.stringify(items("1"))]);
          expect((await read(fg)).items[0]).toMatchObject({physical_quantity:"3",fg_reserved_quantity:"1",test_held_quantity:"1",work_order_held_quantity:"1",available_after_projects:"2",net_available_after_all_commitments:"0"});expect((await read()).items.some((r:{product_id:string})=>r.product_id===product)).toBe(false);
        });
        it("175 enforces warehouse and Work Order read isolation under authenticated roles",async()=>{
          const job=await ordinary("7"),search=await serial(),authorizedRead=async(warehouse:string)=>(await db.query("select public.get_inventory_reservation_accounting($1,$2,true,100,0) value",[warehouse,search])).rows[0].value;await db.query("delete from public.user_permissions where user_id=$1",[member.id]);await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,actor.id,["inventory.customs.view","work_orders.view"]]);
          await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member.auth_user_id]);await db.query("set local role authenticated");expect((await authorizedRead(customs)).quantity_scope).toBe("customs_physical");await expect(attempt(()=>authorizedRead(raw))).rejects.toMatchObject({code:"42501"});await expect(attempt(()=>authorizedRead(fg))).rejects.toMatchObject({code:"42501"});expect((await status(job.id)).materials[0]).toMatchObject({held_quantity:"7",uncovered_quantity:"0"});await expect(attempt(()=>db.query("select * from public.work_order_material_reservation_states"))).rejects.toMatchObject({code:"42501"});await db.query("reset role");
          await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key='inventory.raw_materials.view'",[member.id,actor.id]);await db.query("set local role authenticated");expect((await authorizedRead(raw)).quantity_scope).toBe("raw_customs_planning");await db.query("reset role;set local role anon");await expect(attempt(()=>authorizedRead(customs))).rejects.toMatchObject({code:"42501"});await db.query("reset role");await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);await db.query("set local role authenticated");await expect(attempt(()=>authorizedRead(customs))).rejects.toMatchObject({code:"42501"});await db.query("reset role");await db.query("select set_config('request.jwt.claim.sub','',true)");await expect(attempt(()=>status(job.id))).rejects.toMatchObject({code:"42501"});
        });
        it("175 queue reconciliation resolves/reopens shortages without duplicate opening fanout",async()=>{
          const targetJob=await ordinary("8",false),holder=await ordinary("7");await drain();expect((await status(targetJob.id)).materials[0]).toMatchObject({held_quantity:"0",uncovered_quantity:"8",missing_quantity:"3"});
          const intents=async()=>(await db.query("select o.event_type,count(*)::int n from public.work_order_material_shortage_notification_outbox o join public.work_order_material_shortage_episodes e on e.id=o.episode_id where e.work_order_id=$1 group by o.event_type order by o.event_type",[targetJob.id])).rows;
          expect(await intents()).toEqual([{event_type:"opened",n:1}]);await db.query("update public.work_order_material_reservation_allocations set held_quantity=held_quantity where state_id in(select id from public.work_order_material_reservation_states where work_order_id=$1)",[holder.id]);expect((await db.query("select count(*)::int n from public.work_order_material_shortage_reconciliation_queue where transaction_id=txid_current() and product_id=$1",[product])).rows[0].n).toBe(1);await drain();expect(await intents()).toEqual([{event_type:"opened",n:1}]);
          await call("delete",holder.id,holder.updated);await drain();expect(await intents()).toEqual([{event_type:"opened",n:1},{event_type:"resolved",n:1}]);await ordinary("7");await drain();expect(await intents()).toEqual([{event_type:"opened",n:2},{event_type:"resolved",n:1}]);
        });
        it("175 excludes finished/deleted commitments, supports explicit archived filtering and bounded pages",async()=>{
          const job=await ordinary("7");await finish(job,await pdf(job));expect((await read()).items[0].work_order_held_quantity).toBe("0");await expect(attempt(()=>status(job.id))).rejects.toMatchObject({code:"WOR02"});
          const deleted=await ordinary("1");await call("delete",deleted.id,deleted.updated);await expect(attempt(()=>status(deleted.id))).rejects.toMatchObject({code:"P0002"});await db.query("select * from public.archive_product($1)",[product]);expect((await read()).items).toEqual([]);expect((await read(raw,false,1)).items).toHaveLength(1);expect((await read(raw,false,1,1)).items).toEqual([]);await expect(attempt(()=>read(raw,true,201))).rejects.toMatchObject({code:"22023"});
        });
        it("175 retains exact bigint scope/held/availability quantities",async()=>{
          await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add','9007199254740993','Owned accounting bigint',$3)",[product,raw,supplier]);const job=await ordinary("9007199254740994");expect((await status(job.id)).materials[0]).toMatchObject({held_quantity:"9007199254740994",uncovered_quantity:"0"});expect((await read()).items[0]).toMatchObject({scope_physical_quantity:"9007199254741002",work_order_held_quantity:"9007199254740994",net_available_after_all_commitments:"8"});
        });
      }
      it.each(["finish","other-finish","debit","debit-first","test","fg","fg-auto","edit","edit-first"])("174 serializes Finish against %s without double consumption",async scenario=>{
        if(scenario.startsWith("fg"))await finishedInput();
        const job=await ordinary(scenario.startsWith("fg")?"2":"7"),file=await pdf(job);
        const other=scenario==="other-finish"?await ordinary("5"):null,otherFile=other?await pdf(other):null;
        const p=scenario.startsWith("fg")?await project():null;if(p&&scenario==="fg")await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,3,$3,$3)",[p.group,product,actor.id]);
        target.assertOwnedClone(name);await db.query("commit");committedFixture=true;
        const a=await pool.connect(),b=await pool.connect();
        try{
          for(const c of [a,b]){await c.query("begin;set local statement_timeout='15s';set local lock_timeout='10s'");await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);}
          const pid=(await b.query("select pg_backend_pid() pid")).rows[0].pid;if(scenario!=="edit-first")await a.query("set local role authenticated");const winner=scenario==="edit-first"?await call("edit",job.id,job.updated,{...input("8"),project_id:(await a.query("select project_id from public.work_orders where id=$1",[job.id])).rows[0].project_id},randomUUID(),a):scenario==="debit-first"?await a.query("select * from public.adjust_inventory_warehouse($1,$2,'remove',1,'Owned free debit first')",[product,customs]):await finish(job,file,"2",a);
          if(scenario!=="edit")await b.query("set local role authenticated");
          const operation=scenario==="finish"||scenario==="edit-first"||scenario==="debit-first"?finish(job,file,"2",b):scenario==="other-finish"?finish(other!,otherFile!,"2",b):scenario==="debit"?b.query("select * from public.adjust_inventory_warehouse($1,$2,'remove',3,'Owned Finish race')",[product,customs]):scenario==="test"?b.query("select public.save_test_calculation($1,'Owned Finish/Test race',$2,'2090-01-01') value",[randomUUID(),JSON.stringify(items("7"))]):scenario==="fg"?b.query("select * from public.reserve_finished_goods_for_project($1,$2,1,0,$3)",[p!.id,product,randomUUID()]):scenario==="fg-auto"?b.query("select public.mutate_project_requirement($1,'create',$2,$3,null,$4,3,null,null) value",[randomUUID(),p!.id,p!.group,product]):call("edit",job.id,job.updated,input("8"),randomUUID(),b);
          const waiting=operation.then(value=>({value,error:null}),error=>({value:null,error}));
          let blocked=false;for(let i=0;i<100;i++){blocked=(await db.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[pid])).rows[0]?.blocked===true;if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));}expect(blocked).toBe(true);
          await a.query("commit");const outcome=await waiting;
          if(scenario==="debit"||scenario==="edit"||scenario==="edit-first"){expect(outcome.error).toMatchObject({code:scenario==="debit"?"IVB02":scenario==="edit-first"?"WOR05":"WOR02"});await b.query("rollback");}
          else{expect(outcome.error).toBeNull();if(scenario==="finish")expect(outcome.value).toEqual(winner);if(scenario==="test")expect((outcome.value as {rows:{value:{items:{held_quantity:string}[]} }[]}).rows[0]!.value.items[0]!.held_quantity).toBe("5");await b.query("commit");}
          expect((await db.query("select count(*)::int n from public.work_order_material_reservation_receipts where work_order_id=$1 and operation='finish'",[job.id])).rows[0].n).toBe(scenario==="edit-first"?0:2);await conservation();
        }finally{await a.query("rollback");await b.query("rollback");a.release(true);b.release(true);baseline=await snapshot(pool);}
      });
    }
  }
  // Last case commits ONLY inside this owned disposable clone to exercise real
  // cross-session visibility. afterAll drops it and verifies the source manifest.
  it("serializes concurrent exact creation replay and stale competing edits without duplicate holds",async()=>{
    target.assertOwnedClone(name);await db.query("commit");committedFixture=true;
    const a=await pool.connect(),b=await pool.connect();
    try{
      for(const c of [a,b]){await c.query("begin;set local statement_timeout='15s';set local lock_timeout='10s'");await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);}
      const request=randomUUID(),first=await call("create",null,null,{},request,a),replay=call("create",null,null,{},request,b);
      await a.query("commit");expect(await replay).toEqual(first);await b.query("commit");
      for(const c of [a,b]){await c.query("begin");await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);}
      const edited=await call("edit",first.work_order_id,first.updated_at,input("10"),randomUUID(),a);
      const stale=call("edit",first.work_order_id,first.updated_at,input("11"),randomUUID(),b).catch(e=>e);
      await a.query("commit");expect(await stale).toMatchObject({code:"WOR05"});await b.query("rollback");
      expect(edited.materials[0]).toMatchObject({held:"10",uncovered:"0"});
      for(const c of [a,b]){await c.query("begin");await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);}
      const nextA=await call("create",null,null,{},randomUUID(),a),nextBPending=call("create",null,null,{},randomUUID(),b);
      // Existing numbering serializes creation until the first writer commits.
      await a.query("commit");const nextB=await nextBPending;await b.query("commit");
      for(const c of [a,b]){await c.query("begin");await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);}
      const heldA=await call("edit",nextA.work_order_id,nextA.updated_at,input("5"),randomUUID(),a);
      const waitingB=call("edit",nextB.work_order_id,nextB.updated_at,input("5"),randomUUID(),b);
      await a.query("commit");const heldB=await waitingB;await b.query("commit");
      expect(heldA.materials[0]).toMatchObject({held:"2",uncovered:"3"});expect(heldB.materials[0]).toMatchObject({held:"0",uncovered:"5"});
      if(protection){
        for(const c of [a,b]){await c.query("begin");await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);}
        await call("delete",first.work_order_id,edited.updated_at,{},randomUUID(),a);await a.query("commit");await b.query("commit");
        await a.query("begin");await a.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);const probe=await call("create",null,null,{},randomUUID(),a);await a.query("commit");
        for(const c of [a,b]){await c.query("begin");await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);}
        const protectedDraft=await call("edit",probe.work_order_id,probe.updated_at,input("7"),randomUUID(),a);
        const pid=(await b.query("select pg_backend_pid() pid")).rows[0].pid;
        const blocked=async()=>{for(let i=0;i<100;i++){if((await db.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting)return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error("Expected controlled stock lock wait");};
        const directDebit=b.query("update public.inventory_balances set quantity=4 where product_id=$1 and warehouse_id=$2",[product,raw]).catch(e=>e);
        await blocked();await a.query("commit");expect(await directDebit).toMatchObject({code:"IVB02"});await b.query("rollback");
        for(const c of [a,b]){await c.query("begin");await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);}
        await call("delete",probe.work_order_id,protectedDraft.updated_at,{},randomUUID(),a);
        await b.query("set local role authenticated");
        const waitingSave=b.query("select public.save_test_calculation($1,'Concurrent release and admission',$2,'2090-01-01') value",[randomUUID(),JSON.stringify(items("11"))]);
        await blocked();await a.query("commit");const admitted=(await waitingSave).rows[0].value;expect(admitted.items[0]).toMatchObject({held_quantity:"10",uncovered_quantity:"1"});await b.query("commit;reset role");
      }
    }finally{await a.query("rollback");await b.query("rollback");a.release(true);b.release(true);}
  });
});
