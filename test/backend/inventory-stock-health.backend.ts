import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { LOCAL_RESERVATION, ReservationLocalTarget, reservationSnapshot, rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const raw="10000000-0000-4000-8000-000000000001", fg="10000000-0000-4000-8000-000000000002", customs="10000000-0000-4000-8000-000000000003";
const inventory="select * from public.get_inventory_stock_health($1,$2,$3,$4,$5,$6)";
const dashboard="select public.get_dashboard_stock_health($1) result";
describe.skipIf(process.env.INVENTORY_HEALTH_LOCAL!=="1")("LS-02 — newly owned pinned local clone only",()=>{
  const target=new ReservationLocalTarget(),name=`alfaev_fg_3b1_${randomUUID().replace(/-/g,"")}`;
  let source:LocalReservationPool|undefined,pool:LocalReservationPool|undefined,created=false,sourceBaseline:unknown,baseline:unknown;
  let transaction:ReturnType<typeof guardRollbackQueries>|undefined,db:PoolClient;
  const branches:ReturnType<typeof guardRollbackQueries>[]=[];
  let admin:{id:string;auth_user_id:string},member:typeof admin;
  async function snapshot(p:LocalReservationPool){const c=await p.connect();try{return await reservationSnapshot(c);}finally{c.release(true);}}
  async function call(sql:string,args:unknown[],actor=admin,role="authenticated"){
    if(!["authenticated","anon","service_role"].includes(role))throw Error("Unsafe role");
    await db.query("savepoint caller");
    try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);await db.query(`set local role ${role}`);
      const rows=(await db.query(sql,args)).rows;await db.query("reset role; release savepoint caller");return rows;
    }catch(e){await db.query("rollback to savepoint caller; release savepoint caller");throw e;}
  }
  async function read(warehouse=raw,search:string|null="LS-02",status:string|null=null,active:boolean|null=true,limit=200,offset=0,actor=admin){
    return call(inventory,[warehouse,search,status,active,limit,offset],actor);
  }
  async function dash(actor=admin,limit=100){return (await call(dashboard,[limit],actor))[0].result;}
  async function product(tag:string,linked=false,quantities=["0","0","0"]){
    const id=randomUUID();if(id===LOCAL_RESERVATION.residue)throw Error("Residue forbidden");
    const serial=(await db.query("select n::text serial from generate_series(8000000,8999999) n where not exists(select 1 from public.products where serial_number=n::text) order by n limit 1")).rows[0].serial;
    await db.query("insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id) values($1,$2,$3,'LS-02 test',$4,$5,$5)",[id,serial,`LS-02 ${tag} ${id}`,linked?"pcb_finished_good":"component",admin.id]);
    if(linked)await db.query("insert into public.pcb_cards(id,name,output_product_id,created_by_user_id,updated_by_user_id) values($1,$2,$3,$4,$4)",[randomUUID(),`LS-02 ${id}`,id,admin.id]);
    if(quantities.some(q=>BigInt(q)>0n)){
      const supplier=await createSupplierSourceFixture(db,{profileId:admin.id,authUserId:admin.auth_user_id},id);
      for(const [i,w] of [raw,fg,customs].entries())if(BigInt(quantities[i]!)>0n)
        await call("select * from public.adjust_inventory_warehouse($1,$2,'add',$3::bigint,'LS-02 owned fixture',$4)",[id,w,quantities[i],supplier.productSupplierId]);
    }
    return id;
  }
  async function minimum(p:string,w=raw,q:string|null="5",version:string|null=null){
    return call("select * from public.set_inventory_stock_minimum($1,$2,$3,$4)",[p,w,q,version]);
  }
  async function grant(keys:string[]){await db.query("delete from public.user_permissions where user_id=$1",[member.id]);
    await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,admin.id,keys]);}
  beforeAll(async()=>{
    if(process.env.INVENTORY_HEALTH_APPROVAL!=="owned-clone-only"||process.env.LOCAL_SUPABASE_DB_PASSWORD)throw Error("Owned-clone peer scope required");
    source=target.pool();await target.acquire(source);sourceBaseline=await snapshot(source);
    await target.createTemporary(source,name);created=true;console.info(`LS-02 owned clone: ${name}`);
    target.copyIntoTemporary(name);pool=target.pool(name);const setup=await pool.connect();
    try{
      // LS-02 includes the reviewed membership correction (161), but deliberately
      // excludes the later Work Order shortage pipeline and its mutation hooks.
      const files=readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort().slice(0,161);
      expect(files.length).toBe(161);expect(files[160]).toBe("20261028120000_exclude_calculator_outputs_from_raw_inventory.sql");
      await setup.query("begin");
      try{for(let i=142;i<150;i++){const f=files[i]!;await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8"));
        await setup.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)",[f.slice(0,14),f.slice(15,-4)]);
        if(i>=145){await setup.query("commit");await target.acceptClonePhase(setup,name,(i+1) as 146|147|148|149|150);if(i<149)await setup.query("begin");}}
      }catch(e){await setup.query("rollback");throw e;}
      // Existing TC/LS convention: forward SQL in clone, approved phase-150 ledger.
      await setup.query("begin");try{for(const f of files.slice(150))await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8"));await setup.query("commit");}
      catch(e){await setup.query("rollback");throw e;}
      expect((await setup.query("select to_regprocedure('public.get_work_order_material_availability(uuid)') later_read")).rows[0].later_read).toBeNull();
      admin=(await setup.query("select id,auth_user_id from public.user_profiles where is_active and is_admin order by id limit 1")).rows[0];
      member=(await setup.query("select id,auth_user_id from public.user_profiles where is_active and not is_admin order by id limit 1")).rows[0];
      if(!admin||!member)throw Error("Existing local identities required");baseline=await reservationSnapshot(setup);
    }finally{setup.release(true);}
  });
  beforeEach(async context=>{await target.assertQuiet();transaction=guardRollbackQueries(await pool!.connect(),context.signal);db=transaction.client;
    await db.query("begin; set local statement_timeout='15s'; set local lock_timeout='3s'");});
  afterEach(async()=>{let failure:unknown;try{if(transaction){const t=transaction;transaction=undefined;await rollbackReservationTransactions([t,...branches.splice(0)]);}}
    catch(e){failure=e;}try{if(pool&&baseline)expect(await snapshot(pool)).toEqual(baseline);}finally{if(failure)throw failure;}});
  afterAll(async()=>{try{if(pool)await pool.end();if(source&&sourceBaseline)expect(await snapshot(source)).toEqual(sourceBaseline);
    if(created&&source){await target.dropTemporary(source,name);expect((await source.query("select exists(select 1 from pg_database where datname=$1) present",[name])).rows[0].present).toBe(false);console.info("LS-02 owned clone removed; source manifest unchanged");}
    if(source&&sourceBaseline)expect(await snapshot(source)).toEqual(sourceBaseline);
  }finally{await target.release();if(source)await source.end();}});

  it("classifies four exclusive states using physical stock and exact minimums",async()=>{
    const none=await product("none"),zero=await product("zero"),low=await product("low",false,["3","0","0"]),healthy=await product("healthy",false,["5","0","0"]);
    await minimum(zero);await minimum(low);await minimum(healthy);
    const rows=await read();for(const [id,status] of [[none,"NOT_CONFIGURED"],[zero,"OUT_OF_STOCK"],[low,"LOW_STOCK"],[healthy,"HEALTHY"]])
      expect(rows.find(r=>r.product_id===id)).toMatchObject({health_status:status});
    expect(rows.find(r=>r.product_id===none)).toMatchObject({minimum_quantity:null,configuration_version:null});
    await minimum(low,raw,null,"1");expect((await read()).find(r=>r.product_id===low)).toMatchObject({health_status:"NOT_CONFIGURED",configuration_version:"2"});
    await expect(minimum(none,raw,"0")).rejects.toMatchObject({code:"22023"});
  });
  it("preserves Raw/FG/Customs listing, zero-stock linked output and Customs history",async()=>{
    const ordinary=await product("ordinary"),linked=await product("linked",true),custom=await product("custom",false,["0","0","1"]);
    expect((await read(raw)).map(r=>r.product_id)).toEqual(expect.arrayContaining([ordinary,custom]));
    expect((await read(raw)).some(r=>r.product_id===linked)).toBe(false);
    expect((await read(fg)).map(r=>r.product_id)).toEqual([linked]);expect((await read(customs)).map(r=>r.product_id)).toEqual([custom]);
    await call("select * from public.adjust_inventory_warehouse($1,$2,'remove',1,'LS-02 depletion',null)",[custom,customs]);
    expect((await read(customs))[0]).toMatchObject({product_id:custom,physical_quantity:"0"});
  });
  it("excludes linked outputs from every Raw search, details and minimum configuration without moving stock",async()=>{
    const linked=await product("visibility output",true,["7","0","0"]);
    const unlinked=await product("visibility ordinary");
    const serial=(await db.query("select serial_number from public.products where id=$1",[linked])).rows[0].serial_number;
    const before=await reservationSnapshot(db);
    for(const search of [null,"LS-02","visibility output",serial]){
      const rows=await call("select * from public.search_inventory_products_by_warehouse($1,$2)",[raw,search]);
      expect(rows.some(r=>r.id===linked)).toBe(false);
    }
    expect((await read(raw)).some(r=>r.product_id===unlinked)).toBe(true);
    expect((await read(fg)).find(r=>r.product_id===linked)).toMatchObject({physical_quantity:"0"});
    await expect(call("select * from public.get_inventory_product_by_warehouse($1,$2)",[linked,raw])).rejects.toMatchObject({code:"P0002"});
    expect((await call("select * from public.get_inventory_product_by_warehouse($1,$2)",[linked,fg]))[0]).toMatchObject({product_id:linked,quantity:"0"});
    expect((await call("select * from public.get_inventory_product_by_warehouse($1,$2)",[unlinked,customs]))[0]).toMatchObject({product_id:unlinked,quantity:"0"});
    await expect(minimum(linked,raw)).rejects.toMatchObject({code:"P0002"});
    expect(await reservationSnapshot(db)).toEqual(before);
    expect((await db.query("select quantity::text quantity from public.inventory_balances where product_id=$1 and warehouse_id=$2",[linked,raw])).rows[0].quantity).toBe("7");
  });
  it("retains legacy Raw minimum metadata but omits it from Raw health and Dashboard counts",async()=>{
    const before=await dash(),linked=await product("retained minimum",true);
    await db.query("insert into public.inventory_stock_minimums(product_id,warehouse_id,minimum_quantity,created_by_user_id,updated_by_user_id) values($1,$2,9,$3,$3)",[linked,raw,admin.id]);
    await minimum(linked,fg,"4");
    const after=await dash();
    const count=(result:typeof after,w:string)=>BigInt(result.warehouses.find((r:{warehouse_id:string})=>r.warehouse_id===w).product_count);
    expect(count(after,raw)).toBe(count(before,raw));expect(count(after,fg)).toBe(count(before,fg)+1n);
    expect((await read(raw)).some(r=>r.product_id===linked)).toBe(false);
    expect(after.critical_items.filter((r:{product_id:string})=>r.product_id===linked)).toEqual([expect.objectContaining({warehouse_id:fg,physical_quantity:"0",minimum_quantity:"4",health_status:"OUT_OF_STOCK"})]);
    expect((await db.query("select minimum_quantity::text minimum from public.inventory_stock_minimums where product_id=$1 and warehouse_id=$2",[linked,raw])).rows).toEqual([{minimum:"9"}]);
  });
  it("excludes archived Products by default and Dashboard, with explicit historical reads",async()=>{
    const p=await product("archived",true);await minimum(p,fg);
    await db.query("update public.products set is_active=false,archived_at=clock_timestamp(),archived_by_user_id=$2 where id=$1",[p,admin.id]);
    expect(await read(fg)).toEqual([]);expect((await read(fg,null,null,false)).find(r=>r.product_id===p)).toMatchObject({is_active:false,minimum_quantity:"5"});
    expect((await read(fg,null,null,null)).some(r=>r.product_id===p)).toBe(true);
    expect((await read(raw,null,null,false)).some(r=>r.product_id===p)).toBe(false);
    expect((await dash()).critical_items.some((r:{product_id:string})=>r.product_id===p)).toBe(false);
  });
  it("preserves bigint physical/minimum/version transport without numeric rounding",async()=>{
    const p=await product("bigint",true,["0","9007199254740993","0"]);await minimum(p,fg,"9223372036854775807");
    await db.query("update public.inventory_stock_minimums set version=9007199254740993 where product_id=$1",[p]);
    expect((await read(fg))[0]).toMatchObject({physical_quantity:"9007199254740993",minimum_quantity:"9223372036854775807",configuration_version:"9007199254740993",health_status:"LOW_STOCK"});
    expect((await dash()).critical_items.find((r:{product_id:string})=>r.product_id===p)).toMatchObject({physical_quantity:"9007199254740993"});
  });
  it("supports literal search, exclusive status filters and stable bounded pagination",async()=>{
    await product("A%literal");await product("B");const c=await product("C");await minimum(c);
    expect(await read(raw,"A%literal")).toHaveLength(1);expect(await read(raw,"A_literal")).toHaveLength(0);
    expect(await read(raw,"LS-02","OUT_OF_STOCK")).toHaveLength(1);
    const all=await read();expect(await read(raw,"LS-02",null,true,1,0)).toEqual(all.slice(0,1));expect(await read(raw,"LS-02",null,true,1,1)).toEqual(all.slice(1,2));
    for(const args of [[raw,null,"bogus",true,10,0],[raw,null,null,true,201,0],[raw,null,null,true,10,-1],[raw,null,null,true,null,0]])
      await expect(call(inventory,args)).rejects.toMatchObject({code:"22023"});
    await expect(read(randomUUID())).rejects.toMatchObject({code:"P0002"});await expect(dash(admin,101)).rejects.toMatchObject({code:"22023"});
  });
  it("enforces warehouse view independently and Dashboard view plus per-warehouse permission",async()=>{
    await product("permissions",true);await grant(["inventory.raw_materials.view"]);
    expect(await read(raw,null,null,true,10,0,member)).not.toHaveLength(0);
    await expect(read(fg,null,null,true,10,0,member)).rejects.toMatchObject({code:"42501"});
    await expect(dash(member)).rejects.toMatchObject({code:"42501"});
    await grant(["dashboard.view","inventory.raw_materials.view"]);expect((await dash(member)).warehouses.map((w:{warehouse_id:string})=>w.warehouse_id)).toEqual([raw]);
    await grant(["dashboard.view"]);expect(await dash(member)).toMatchObject({warehouses:[],critical_items:[]});
    await grant(["dashboard.view","inventory.finished_goods.view"]);expect((await dash(member)).warehouses.map((w:{warehouse_id:string})=>w.warehouse_id)).toEqual([fg]);
  });
  it("denies inactive, anonymous and service-role access and private helper/table access",async()=>{
    for(const role of ["anon","service_role"]){await expect(call(inventory,[raw,null,null,true,10,0],admin,role)).rejects.toMatchObject({code:"42501"});await expect(call(dashboard,[10],admin,role)).rejects.toMatchObject({code:"42501"});}
    await grant(["dashboard.view","inventory.raw_materials.view"]);await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);await expect(dash(member)).rejects.toMatchObject({code:"42501"});
    await expect(read(raw,null,null,true,10,0,member)).rejects.toMatchObject({code:"42501"});
    await expect(call(dashboard,[10],{id:admin.id,auth_user_id:""})).rejects.toMatchObject({code:"42501"});
    for(const statement of ["select * from public.inventory_stock_minimums","select public.inventory_stock_health_status(0,1)",`select * from public.inventory_stock_health_rows('${raw}',null,true)`])
      await expect(call(statement,[])).rejects.toMatchObject({code:"42501"});
  });
  it("counts Product/warehouse pairs, including Not Configured, without summing stock",async()=>{
    const before=await dash();const p=await product("mixed",true,["7","4","2"]);await minimum(p,fg,"5");
    const after=await dash();for(const w of [raw,fg,customs]){
      const a=after.warehouses.find((r:{warehouse_id:string})=>r.warehouse_id===w),b=before.warehouses.find((r:{warehouse_id:string})=>r.warehouse_id===w);
      expect(BigInt(a.product_count)-BigInt(b.product_count)).toBe(w===raw?0n:1n);
      expect(BigInt(a.healthy_count)+BigInt(a.low_stock_count)+BigInt(a.out_of_stock_count)+BigInt(a.not_configured_count)).toBe(BigInt(a.product_count));
      expect(BigInt(a[w===fg?"low_stock_count":"not_configured_count"])-BigInt(b[w===fg?"low_stock_count":"not_configured_count"])).toBe(w===raw?0n:1n);
    }
  });
  it("does not subtract Project demand, hard FG reservations or active Test holds",async()=>{
    const ordinary=await product("ordinary physical",false,["10","0","0"]);
    const p=await product("physical only",true,["10","10","0"]),project=randomUUID(),group=randomUUID();
    await minimum(ordinary,raw,"8");await minimum(p,fg,"8");
    await db.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,'LS-02 demand','Local','2026-10-28','2030-01-01',$2,$2)",[project,admin.id]);
    await db.query("insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id) values($1,$2,'LS-02 group',$3,$3)",[group,project,admin.id]);
    await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,20,$3,$3)",[group,p,admin.id]);
    await call("select * from public.reserve_finished_goods_for_project($1,$2,3,0,$3)",[project,p,randomUUID()]);
    await call("select public.save_test_calculation($1,'LS-02 physical test',$2::jsonb,'2030-01-01'::date)",[randomUUID(),JSON.stringify([{product_id:p,quantity:"4"}])]);
    expect((await db.query("select sum(quantity)::text quantity from public.test_calculation_holds where product_id=$1",[p])).rows[0].quantity).toBe("4");
    expect((await read(raw)).find(r=>r.product_id===ordinary)).toMatchObject({physical_quantity:"10",minimum_quantity:"8",health_status:"HEALTHY"});
    expect((await read(raw)).some(r=>r.product_id===p)).toBe(false);
    expect((await read(fg)).find(r=>r.product_id===p)).toMatchObject({physical_quantity:"10",minimum_quantity:"8",health_status:"HEALTHY"});
    expect((await dash()).critical_items.some((r:{product_id:string})=>r.product_id===p)).toBe(false);
  });
  it("orders configured OUT first then LOW, by name/warehouse/Product ID with a bound",async()=>{
    const low=await product("AAA",true,["1","1","0"]),zero=await product("ZZZ",true);
    await minimum(low,fg);await minimum(zero,fg);
    const result=await dash();const expected=[...result.critical_items].sort((a,b)=>(a.health_status==="OUT_OF_STOCK"?0:1)-(b.health_status==="OUT_OF_STOCK"?0:1)||a.product_name.toLowerCase().localeCompare(b.product_name.toLowerCase())||a.warehouse_id.localeCompare(b.warehouse_id)||a.product_id.localeCompare(b.product_id));
    expect(result.critical_items).toEqual(expected);expect((await dash(admin,1)).critical_items).toHaveLength(1);
    expect(result.critical_items.filter((r:{product_id:string})=>r.product_id===zero).length).toBe(1);
    expect(Number.isNaN(Date.parse(result.as_of))).toBe(false);
  });
  it("reads do not mutate any data, accounting, notifications, security or sequences",async()=>{
    const p=await product("unchanged",true);await minimum(p,fg);const before=await reservationSnapshot(db);
    await read();await read(fg);await read(customs);await dash();expect(await reservationSnapshot(db)).toEqual(before);
    for(const f of ["public.get_inventory_stock_health(uuid,text,text,boolean,integer,integer)","public.get_dashboard_stock_health(integer)"])
      expect((await db.query("select prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure",[f])).rows[0]).toEqual({prosecdef:true,provolatile:"s",proconfig:['search_path=""']});
    for(const f of ["public.search_inventory_products_by_warehouse(uuid,text)","public.get_inventory_product_by_warehouse(uuid,uuid)"]){
      const security=(await db.query("select prosecdef,provolatile,proconfig,has_function_privilege('authenticated',oid,'execute') allowed,has_function_privilege('anon',oid,'execute') anon,exists(select 1 from aclexplode(proacl) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') public_execute from pg_proc where oid=$1::regprocedure",[f])).rows[0];
      expect(security).toEqual({prosecdef:true,provolatile:"s",proconfig:['search_path=""'],allowed:true,anon:false,public_execute:false});
    }
  });
  it("executes both contracts inside a read-only transaction",async()=>{
    await db.query("set transaction read only");await read();await read(fg);await read(customs);await dash();
  });
  it("keeps Inventory, summary and critical rows on one MVCC snapshot across concurrent configuration",async context=>{
    const p=await product("snapshot",true);await minimum(p,fg);await db.query("commit");baseline=await snapshot(pool!);
    await db.query("begin isolation level repeatable read");const old=await dash();
    const other=guardRollbackQueries(await pool!.connect(),context.signal);branches.push(other);
    await other.client.query("begin");await other.client.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.auth_user_id]);
    await other.client.query("set local role authenticated");await other.client.query("select * from public.set_inventory_stock_minimum($1,$2,null,'1')",[p,fg]);await other.client.query("commit");
    expect((await read(fg)).find(r=>r.product_id===p)).toMatchObject({health_status:"OUT_OF_STOCK",configuration_version:"1"});
    const same=await dash();expect(same.warehouses).toEqual(old.warehouses);expect(same.critical_items).toEqual(old.critical_items);
    await db.query("rollback; begin");expect((await read(fg)).find(r=>r.product_id===p)).toMatchObject({health_status:"NOT_CONFIGURED",configuration_version:"2"});
    expect((await dash()).critical_items.some((r:{product_id:string})=>r.product_id===p)).toBe(false);
    await rollbackReservationTransactions(branches.splice(0));baseline=await snapshot(pool!);
  });
});
