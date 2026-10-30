import { randomUUID } from "node:crypto";
import { readFileSync,readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
// Exercise the actual frontend parsers against database receipts without creating a network client.
vi.mock("../../lib/supabase/client",()=>({supabase:{}}));
vi.mock("../../lib/config/env",()=>({frontendEnv:{supabaseUrl:"https://yzysgbrpbhiapalgetau.supabase.co",supabasePublishableKey:"local-parser-test-only"}}));
import { parseTestImportReceipt } from "../../features/test-calculator/services/testCalculationImportService";
import { parseTestConversions } from "../../features/test-calculator/services/testCalculationConversionService";
import { ReservationLocalTarget,reservationSnapshot,type LocalReservationPool } from "./helpers/reservation-local-target";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
const files=readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort();
describe.skipIf(process.env.TEST_CONVERSIONS_LOCAL!=="1")("Conversion reads — owned isolated clone",()=>{
  const target=new ReservationLocalTarget(),name=`alfaev_fg_3b1_${randomUUID().replace(/-/g,"")}`;
  let source:LocalReservationPool,pool:LocalReservationPool,created=false,sourceBefore:unknown,cloneBefore:unknown,db:PoolClient;
  let actor:{id:string;auth_user_id:string},member:{id:string;auth_user_id:string},product:{id:string;name:string;serial_number:string};
  beforeAll(async()=>{
    if(process.env.TEST_CONVERSIONS_APPROVAL!=="owned-clone-only"||process.env.LOCAL_SUPABASE_DB_PASSWORD)throw Error("Owned local peer scope required");
    expect(files[169]).toBe("20261030100000_add_test_calculation_conversion_reads.sql");
    source=target.pool();await target.acquire(source);const c=await source.connect();try{sourceBefore=await reservationSnapshot(c);}finally{c.release(true);}
    await target.createTemporary(source,name);created=true;target.copyIntoTemporary(name);pool=target.pool(name);const setup=await pool.connect();
    try{
      await setup.query("begin");
      for(let i=142;i<150;i++){
        const f=files[i]!;await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8"));
        await setup.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)",[f.slice(0,14),f.slice(15,-4)]);
        if(i>=145){await setup.query("commit");await target.acceptClonePhase(setup,name,(i+1) as 146|147|148|149|150);if(i<149)await setup.query("begin");}
      }
      await setup.query("begin");for(const f of files.slice(150,170))await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8"));await setup.query("commit");
      actor=(await setup.query("select id,auth_user_id from public.user_profiles where is_active and is_admin order by id limit 1")).rows[0];
      member=(await setup.query("select id,auth_user_id from public.user_profiles where is_active and not is_admin order by id limit 1")).rows[0];
      product=(await setup.query("select id,name,serial_number from public.products where is_active and product_kind='component' order by id limit 1")).rows[0];
      if(!actor||!member||!product)throw Error("Existing local identity/component fixture unavailable");
      cloneBefore=await reservationSnapshot(setup);console.info(`Owned conversion clone: ${name}`);
    }catch(e){await setup.query("rollback");throw e;}finally{setup.release(true);}
  });
  beforeEach(async()=>{await target.assertQuiet();db=await pool.connect();await db.query("begin;set local statement_timeout='15s';set local lock_timeout='3s'");});
  afterEach(async()=>{if(db){await db.query("rollback");db.release(true);}if(pool&&cloneBefore){const c=await pool.connect();try{expect(await reservationSnapshot(c)).toEqual(cloneBefore);}finally{c.release(true);}}});
  afterAll(async()=>{try{if(pool)await pool.end();if(source){const c=await source.connect();try{expect(await reservationSnapshot(c)).toEqual(sourceBefore);}finally{c.release(true);}if(created){await target.dropTemporary(source,name);expect((await source.query("select exists(select 1 from pg_database where datname=$1) present",[name])).rows[0].present).toBe(false);console.info("Owned conversion clone removed; source manifest unchanged");}}}finally{await target.release();if(source)await source.end();}});
  async function fixture(held="3",expired=false,required="5"){
    const calculation=randomUUID(),item=randomUUID();
    await db.query(`insert into public.test_calculations(id,name,created_by_user_id,created_at,deadline_date,expires_at,request_id,submitted_payload,save_receipt)
      values($1,$2,$3,'2020-01-01',$4,($5::timestamp at time zone 'Europe/Sarajevo'),$6,'{}','{}')`,[calculation,`Conversion ${calculation}`,actor.id,expired?"2020-01-02":"2090-01-02",expired?"2020-01-03":"2090-01-03",randomUUID()]);
    await db.query(`insert into public.test_calculation_items(id,calculation_id,product_id,product_name_snapshot,serial_number_snapshot,product_kind_snapshot,required_quantity,held_quantity,uncovered_quantity)
      values($1,$2,$3,$4,$5,'component',$6::bigint,$7::bigint,($6::numeric-$7::numeric)::bigint)`,[item,calculation,product.id,product.name,product.serial_number,required,held]);
    if(held!=="0")await db.query("insert into public.test_calculation_holds(item_id,calculation_id,product_id,warehouse_id,quantity) values($1,$2,$3,'10000000-0000-4000-8000-000000000001',$4)",[item,calculation,product.id,held]);
    await db.query("set constraints test_calculation_items_hold_total,test_calculation_holds_item_total immediate;set constraints test_calculation_items_hold_total,test_calculation_holds_item_total deferred");
    return calculation;
  }
  async function asRole(sql:string,args:unknown[],who=actor,role="authenticated"){
    if(!["authenticated","anon"].includes(role))throw Error("Invalid role");await db.query("savepoint caller");
    try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[who.auth_user_id]);await db.query(`set local role ${role}`);const r=await db.query(sql,args);await db.query("reset role;release savepoint caller");return r.rows[0]?.value;}
    catch(e){await db.query("rollback to savepoint caller;release savepoint caller");throw e;}
  }
  const read=(ids:string[],detail=true,who=actor)=>asRole("select public.get_test_calculation_conversions($1,$2) value",[ids,detail],who);
  async function convert(id:string){const serial=(await db.query("select lpad(n::text,3,'0') serial from generate_series(0,999) n where not exists(select 1 from public.products where serial_number=lpad(n::text,3,'0')) order by n limit 1")).rows[0].serial;
    return asRole("select public.import_test_calculation($1,$2,$3) value",[randomUUID(),id,serial]);}
  async function grants(keys:string[]){await db.query("delete from public.user_permissions where user_id=$1",[member.id]);await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,actor.id,keys]);}
  it("returns exact effective quantities without writes before conversion",async()=>{
    const id=await fixture(),before=await reservationSnapshot(db),r=await read([id]);expect(r.rows[0]).toMatchObject({imported:false,destination:null,can_navigate:false,items:[{effective_quantity:"3"}]});expect(r.next_expiry).not.toBeNull();expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("preserves original snapshot and returns authorized destination with zero current commitments",async()=>{
    const id=await fixture("5"),before=await asRole("select public.get_test_calculation($1) value",[id]),receipt=await convert(id),r=await read([id]);
    expect(r.rows[0]).toMatchObject({imported:true,can_navigate:true,destination:{calculator_id:receipt.pcb_card_id,product_id:receipt.output_product_id,serial_number:receipt.serial_number},items:[{effective_quantity:"0",warehouses:[]}]});expect(r.next_expiry).toBeNull();
    const after=await asRole("select public.get_test_calculation($1) value",[id]);expect({...after,as_of:null}).toEqual({...before,as_of:null});
  });
  it("handles partially held, zero-held and expired imports without rewriting holds",async()=>{
    for(const [held,expired] of [["3",false],["0",false],["3",true]] as const){const id=await fixture(held,expired);await convert(id);const r=await read([id]);expect(r.rows[0].items[0].effective_quantity).toBe("0");expect((await db.query("select held_quantity::text n from public.test_calculation_items where calculation_id=$1",[id])).rows[0].n).toBe(held);}
  });
  it("redacts every destination field for Test-only viewers, then honors current pcb.view",async()=>{
    const id=await fixture(),receipt=await convert(id);await grants(["test_calculator.view"]);
    expect((await read([id],false,member)).rows[0]).toEqual({calculation_id:id,imported:true,can_navigate:false,destination:null,items:[]});
    await expect(asRole("select count(*) value from public.get_pcb_bom_editor($1)",[receipt.pcb_card_id],member)).rejects.toMatchObject({code:"42501"});
    await grants(["test_calculator.view","pcb.view"]);expect((await read([id],false,member)).rows[0].can_navigate).toBe(true);
    expect(await asRole("select count(*) value from public.get_pcb_bom_editor($1)",[receipt.pcb_card_id],member)).toBe("1");
    await grants(["test_calculator.view"]);expect((await read([id],false,member)).rows[0].destination).toBeNull();
  });
  it("denies missing Test permission, inactive and anonymous callers and direct private table reads",async()=>{
    const id=await fixture();await grants(["pcb.view"]);await expect(read([id],true,member)).rejects.toMatchObject({code:"42501"});
    await grants(["test_calculator.view"]);await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);await expect(read([id],true,member)).rejects.toMatchObject({code:"42501"});
    await expect(asRole("select public.get_test_calculation_conversions($1,false) value",[[id]],actor,"anon")).rejects.toMatchObject({code:"42501"});
    await expect(asRole("select count(*) value from public.test_calculation_imports",[])).rejects.toMatchObject({code:"42501"});
  });
  it("enforces bounded complete inputs and no table/grant changes",async()=>{
    const id=await fixture();await expect(read([id,id],false)).rejects.toMatchObject({code:"22023"});await expect(read([],false)).rejects.toMatchObject({code:"22023"});
    await expect(read([randomUUID()],false)).rejects.toMatchObject({code:"P0002"});
    expect((await db.query("select has_function_privilege('authenticated','public.get_test_calculation_conversions(uuid[],boolean)','EXECUTE') allowed")).rows[0].allowed).toBe(true);
    for(const role of ["anon","service_role"])expect((await db.query("select has_function_privilege($1,'public.get_test_calculation_conversions(uuid[],boolean)','EXECUTE') allowed",[role])).rows[0].allowed).toBe(false);
    expect((await db.query("select relrowsecurity from pg_class where oid='public.test_calculation_imports'::regclass")).rows[0].relrowsecurity).toBe(true);
  });
  it("preserves bigint boundary strings and excludes expired unconverted holds",async()=>{
    const max="9223372036854775807",large=await fixture(max,false,max),expired=await fixture("3",true);
    expect((await read([large])).rows[0].items[0].effective_quantity).toBe(max);
    expect((await read([expired])).rows[0]).toMatchObject({imported:false,items:[{effective_quantity:"0",warehouses:[]}]});
  });
  it("integrates real Save, source-only release, Inventory, immutable history, provenance and exact retry through migration 170",async()=>{
    const sourceId=randomUUID(),raw="10000000-0000-4000-8000-000000000001",fg="10000000-0000-4000-8000-000000000002";
    const serial=(await db.query("select n::text serial from generate_series(8000000,8999999) n where not exists(select 1 from public.products where serial_number=n::text) order by n limit 1")).rows[0].serial;
    await db.query("insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id) values($1,$2,$3,'Integrated local fixture','component',$4,$4)",[sourceId,serial,`Integrated ${sourceId}`,actor.id]);
    const supplier=await createSupplierSourceFixture(db,{profileId:actor.id,authUserId:actor.auth_user_id},sourceId);
    for(const [warehouse,quantity] of [[raw,"20"],["10000000-0000-4000-8000-000000000003","10"],[fg,"5"]])
      await asRole("select to_jsonb(adjustment) value from public.adjust_inventory_warehouse($1,$2,'add',$3,'Owned integration fixture',$4) adjustment",[sourceId,warehouse,quantity,supplier.productSupplierId]);
    const items=JSON.stringify([{product_id:sourceId,quantity:"12"}]),name=`Integrated import ${randomUUID()}`;
    const selected=await asRole("select public.save_test_calculation($1,$2,$3,'2090-01-01') value",[randomUUID(),name,items]);
    const other=await asRole("select public.save_test_calculation($1,$2,$3,'2090-01-01') value",[randomUUID(),`Other ${randomUUID()}`,JSON.stringify([{product_id:sourceId,quantity:"4"}])]);
    const inventory=()=>asRole("select to_jsonb(commitment) value from public.get_inventory_test_commitments($1,$2) commitment where product_id=$3",[raw,serial,sourceId]);
    const accounting=async()=>(await db.query(`select jsonb_build_object(
      'balances',(select jsonb_agg(to_jsonb(b) order by b.warehouse_id) from public.inventory_balances b where b.product_id=$1),
      'movements',(select jsonb_agg(to_jsonb(m) order by m.id) from public.inventory_movements m),
      'lots',(select jsonb_agg(to_jsonb(l) order by l.id) from public.inventory_source_lots l),
      'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from public.inventory_source_allocations a)) value`,[sourceId])).rows[0].value;
    const history=await asRole("select public.get_test_calculation($1) value",[selected.calculation_id]);
    expect(await inventory()).toMatchObject({committed_to_tests:"16",available_after_projects_and_tests:"14"});
    const physical=await accounting(),request=randomUUID();
    const outputSerial=(await db.query("select lpad(n::text,3,'0') serial from generate_series(0,999) n where not exists(select 1 from public.products where serial_number=lpad(n::text,3,'0')) order by n limit 1")).rows[0].serial;
    const imported=await asRole("select public.import_test_calculation($1,$2,$3) value",[request,selected.calculation_id,outputSerial]);
    expect(parseTestImportReceipt(imported,{requestId:request,calculationId:selected.calculation_id,serialNumber:outputSerial})).toEqual(imported);
    expect(imported).toMatchObject({calculation_id:selected.calculation_id,name,serial_number:outputSerial,initial_bom_version_number:"1",release_totals:[{product_id:sourceId,quantity:"12"}]});
    expect(await accounting()).toEqual(physical);expect(await inventory()).toMatchObject({committed_to_tests:"4",available_after_projects_and_tests:"26"});
    const converted=await read([selected.calculation_id]);
    expect(parseTestConversions(converted,[selected.calculation_id],true)).toEqual(converted);
    expect(converted.rows[0]).toMatchObject({imported:true,can_navigate:true,destination:{calculator_id:imported.pcb_card_id,product_id:imported.output_product_id,serial_number:outputSerial},items:[{product_id:sourceId,effective_quantity:"0"}]});
    expect((await read([other.calculation_id])).rows[0]).toMatchObject({imported:false,items:[{product_id:sourceId,effective_quantity:"4"}]});
    expect((await db.query("select component_product_id,quantity_per_card::text quantity from public.pcb_bom_items where bom_version_id=$1",[imported.initial_bom_version_id])).rows).toEqual([{component_product_id:sourceId,quantity:"12"}]);
    const afterHistory=await asRole("select public.get_test_calculation($1) value",[selected.calculation_id]);expect({...afterHistory,as_of:null}).toEqual({...history,as_of:null});
    expect(await asRole("select count(*)::text value from public.search_inventory_products_by_warehouse($1,$2) where id=$3",[raw,outputSerial,imported.output_product_id])).toBe("0");
    expect(await asRole("select count(*)::text value from public.search_inventory_products_by_warehouse($1,$2) where id=$3",[fg,outputSerial,imported.output_product_id])).toBe("1");
    expect((await db.query("select sum(quantity)::text quantity from public.inventory_balances where product_id=$1",[imported.output_product_id])).rows[0].quantity).toBe("0");
    const beforeReplay=await reservationSnapshot(db);expect(await asRole("select public.import_test_calculation($1,$2,$3) value",[request,selected.calculation_id,outputSerial])).toEqual(imported);expect(await reservationSnapshot(db)).toEqual(beforeReplay);
  });
});
