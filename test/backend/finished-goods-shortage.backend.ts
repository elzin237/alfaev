import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { ReservationLocalTarget, reservationSnapshot, rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const paths=readdirSync("supabase/migrations").filter(p=>/^\d{14}_.+\.sql$/.test(p)&&p.slice(0,14)<="20261026120000").sort();
const fg="10000000-0000-4000-8000-000000000002";
const mutate="select public.mutate_project_requirement($1,$2,$3,$4,$5,$6,$7::bigint,$8,$9::bigint) result";
describe.skipIf(process.env.FG_SHORTAGES_LOCAL!=="1")("Task 1/4 FG shortages — owned local clone only",()=>{
  const target=new ReservationLocalTarget(),name=`alfaev_fg_3b1_${randomUUID().replace(/-/g,"")}`;
  let source:LocalReservationPool,pool:LocalReservationPool,db:PoolClient,created=false;
  let before150:Record<string,unknown>|undefined;
  let sourceBaseline:unknown,baseline:unknown,tx:ReturnType<typeof guardRollbackQueries>|undefined;
  let admin:{profileId:string;authUserId:string},actor:typeof admin;
  async function call(sql:string,args:unknown[]=[],role="authenticated",client=db){
    if(!["authenticated","anon","service_role"].includes(role))throw Error("Unsafe role");
    await client.query("savepoint rpc");
    try{await client.query("select set_config('request.jwt.claim.sub',$1,true)",[role==="anon"?"":actor.authUserId]);
      await client.query(`set local role ${role}`);const result=(await client.query(sql,args)).rows;
      await client.query("reset role; release savepoint rpc");return result;
    }catch(e){await client.query("rollback to savepoint rpc; release savepoint rpc");throw e;}
  }
  async function group(client=db){const project=randomUUID(),id=randomUUID();
    await client.query(`insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id)
      values($1,$2,'Local FG shortage','2026-10-26','2026-11-26',$3,$3)`,[project,`FG shortage ${project}`,admin.profileId]);
    await client.query(`insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id)
      values($1,$2,'FG shortage requirements',$3,$3)`,[id,project,admin.profileId]);return{project,group:id};}
  async function stock(product:string,quantity:string|number,client=db,warehouse=fg){
    const supplier=await createSupplierSourceFixture(client,admin,product);
    await call("select * from public.adjust_inventory_warehouse($1,$2,'add',$3::bigint,'FG shortage stock',$4)",[product,warehouse,quantity,supplier.productSupplierId],"authenticated",client);
  }
  async function fixture(quantity:string|number=10,client=db){const product=randomUUID(),card=randomUUID();
    const serial=(await client.query(`select s::text serial from generate_series(8000000,8999999) s where not exists
      (select 1 from public.products where serial_number=s::text) order by s limit 1`)).rows[0].serial;
    await client.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,'FG shortage','pcb_finished_good',$4,$4)`,[product,serial,`FG shortage ${product}`,admin.profileId]);
    await client.query(`insert into public.pcb_cards(id,name,output_product_id,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,$4,$4)`,[card,`FG shortage ${card}`,product,admin.profileId]);
    if(BigInt(quantity)>0n)await stock(product,quantity,client);
    return{...await group(client),product,card};}
  type Fixture=Awaited<ReturnType<typeof fixture>>;
  const args=(f:Fixture,qty:string|number,id:string|null=null,old:string|number|null=null,op=id?"update":"create",request=randomUUID(),oldProduct=f.product)=>
    [request,op,f.project,f.group,id,op==="remove"?null:f.product,op==="remove"?null:qty,id?oldProduct:null,id?old:null];
  const run=async(a:unknown[],client=db)=>(await call(mutate,a,"authenticated",client))[0].result;
  const reservation=async(f:Fixture)=>(await db.query("select reserved_quantity::text q,version::text v,id from public.finished_goods_project_reservations where project_id=$1 and product_id=$2",[f.project,f.product])).rows[0];
  beforeAll(async()=>{
    expect(paths).toHaveLength(150);source=target.pool();await target.acquire(source);sourceBaseline=await reservationSnapshot(source);
    console.info(`FG shortage source verified; newly owned clone ${name}`);
    await target.createTemporary(source,name);created=true;target.copyIntoTemporary(name);pool=target.pool(name);
    const setup=await pool.connect();try{
      const a=(await setup.query("select id,auth_user_id from public.user_profiles where is_admin and is_active order by id limit 1")).rows[0];
      if(!a)throw Error("Active local Admin required");admin={profileId:a.id,authUserId:a.auth_user_id};actor=admin;
      await setup.query("begin");try{for(let i=142;i<paths.length;i++){
        if(i===149)before150=await reservationSnapshot(setup);
        await setup.query(readFileSync(`supabase/migrations/${paths[i]}`,"utf8"));
        await setup.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)",[paths[i]!.slice(0,14),paths[i]!.slice(15,-4)]);
        if(i>=145){await setup.query("commit");await target.acceptClonePhase(setup,name,(i+1) as 146|147|148|149|150);if(i<149)await setup.query("begin");}
      }}catch(e){await setup.query("rollback");throw e;}
      baseline=await reservationSnapshot(setup);
      if(!before150)throw Error("Missing 149 business baseline");
      for(const [key,value] of Object.entries(before150))if(key!=="security"&&key!=="supabase_migrations.schema_migrations")
        expect((baseline as Record<string,unknown>)[key]).toEqual(value);
    }finally{setup.release();}
  });
  beforeEach(async context=>{await target.assertQuiet();actor=admin;const c=await pool.connect();await c.query("begin");tx=guardRollbackQueries(c,context.signal);db=tx.client;await db.query("set local statement_timeout=\'15s\'; set local lock_timeout=\'3s\'");});
  afterEach(async()=>{try{if(tx)await rollbackReservationTransactions([tx]);}finally{tx=undefined;if(baseline)expect(await reservationSnapshot(pool)).toEqual(baseline);}});
  afterAll(async()=>{try{if(sourceBaseline)expect(await reservationSnapshot(source)).toEqual(sourceBaseline);}
    finally{try{if(pool)await pool.end();if(created){await target.dropTemporary(source,name);
      expect((await source.query("select 1 from pg_database where datname=$1",[name])).rowCount).toBe(0);}}
      finally{await target.release();if(source)await source.end();}}});


  const raw="10000000-0000-4000-8000-000000000001",customs="10000000-0000-4000-8000-000000000003";
  async function flush(){await db.query("set constraints project_shortage_reconciliation_queue_process immediate");await db.query("set constraints project_shortage_reconciliation_queue_process deferred");}
  async function episodes(f:Fixture){return (await db.query("select current_shortage_quantity::text q from public.project_shortage_episodes where project_id=$1 and product_id=$2 and resolved_at is null",[f.project,f.product])).rows;}
  async function notices(f:Fixture){return Number((await db.query("select count(*)::int n from public.project_activity_alerts where project_id=$1 and product_id=$2 and notification_kind='shortage'",[f.project,f.product])).rows[0].n);}
  async function material(){const product=randomUUID();const serial=(await db.query(`select s::text serial from generate_series(8000000,8999999) s where not exists(select 1 from public.products where serial_number=s::text) order by s limit 1`)).rows[0].serial;
    await db.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id) values($1,$2,$3,'Components','component',$4,$4)`,[product,serial,`Shortage material ${product}`,admin.profileId]);
    return{...await group(),product,card:randomUUID()};}
  it("keeps trusted boundaries and adds only the reviewed reservation queue trigger",async()=>{
    expect((await db.query("select count(*)::int n from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.proname<>'rls_auto_enable'")).rows[0].n).toBe(190);
    for(const name of ["reconcile_project_shortages_for_products","queue_project_shortage_reconciliation"]){
      const m=(await db.query(`select prosecdef,proconfig,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service from pg_proc where pronamespace='public'::regnamespace and proname=$1`,[name])).rows[0];
      expect(m).toMatchObject({prosecdef:true,proconfig:['search_path=""'],authenticated:false,anon:false,service:false});
    }
    expect((await db.query("select tgenabled from pg_trigger where tgname='finished_goods_reservations_queue_shortage_reconciliation'")).rows).toEqual([{tgenabled:"O"}]);
  });
  it.each([[10,6,null],[3,6,"3"],[0,6,"6"]])("FG stock %s and demand %s use FG only",async(amount,demand,shortage)=>{
    const f=await fixture(amount);await stock(f.product,100,db,raw);await stock(f.product,100,db,customs);
    await run(args(f,demand));await flush();expect(await episodes(f)).toEqual(shortage===null?[]:[{q:shortage}]);
    expect(await notices(f)).toBe(shortage===null?0:1);
  });
  it("stock arrivals decrease/resolve and later debits reopen without auto-allocation",async()=>{
    const f=await fixture(3);await run(args(f,6));await flush();expect(await episodes(f)).toEqual([{q:"3"}]);
    await stock(f.product,2);await flush();expect(await episodes(f)).toEqual([{q:"1"}]);expect(await notices(f)).toBe(1);
    await stock(f.product,1);await flush();expect(await episodes(f)).toEqual([]);expect(await notices(f)).toBe(2);expect((await reservation(f)).q).toBe("3");
    await call("select * from public.adjust_inventory_warehouse($1,$2,'remove',1,'shortage stock debit',null)",[f.product,fg]);await flush();
    expect(await episodes(f)).toEqual([{q:"1"}]);expect(await notices(f)).toBe(3);
  });
  it("preserves ordinary Raw + Customs demand logic and ignores ordinary FG stock",async()=>{
    const f=await material();await stock(f.product,3,db,raw);await stock(f.product,2,db,customs);await stock(f.product,100);
    await call("select public.create_project_product_component($1,$2,9)",[f.group,f.product]);await flush();expect(await episodes(f)).toEqual([{q:"4"}]);
    await stock(f.product,4,db,customs);await flush();expect(await episodes(f)).toEqual([]);expect(await notices(f)).toBe(2);
  });
  it("requirement changes preserve one episode until zero and never duplicate notifications",async()=>{
    const f=await fixture(3),a=args(f,6),receipt=await run(a);await flush();const first=await db.query("select id from public.project_shortage_episodes where project_id=$1",[f.project]);
    expect(await run(a)).toEqual(receipt);await flush();expect(await notices(f)).toBe(1);
    await run(args(f,8,receipt.component_id,6));await flush();expect(await episodes(f)).toEqual([{q:"5"}]);expect(await notices(f)).toBe(1);
    expect((await db.query("select id from public.project_shortage_episodes where project_id=$1",[f.project])).rows).toEqual(first.rows);
    await run(args(f,2,receipt.component_id,8));await flush();expect(await episodes(f)).toEqual([]);expect(await notices(f)).toBe(2);
    await run(args(f,0,receipt.component_id,2,"remove"));await flush();expect(await notices(f)).toBe(2);
  });
  it("reservation changes affect only Project eligibility, never the shared physical deficit",async()=>{
    const f=await fixture(6);await run(args(f,6));const other={...f,...await group()};await run(args(other,6));await flush();
    expect(await episodes(f)).toEqual([]);expect(await episodes(other)).toEqual([{q:"6"}]);
    const s=await reservation(f),id=randomUUID();
    await call("select * from public.release_finished_goods_project_reservation($1,$2,3,$3::bigint,$4)",[f.project,f.product,s.v,id]);await flush();
    expect(await episodes(f)).toEqual([{q:"6"}]);expect(await episodes(other)).toEqual([{q:"6"}]);const count=await notices(f);
    await call("select * from public.release_finished_goods_project_reservation($1,$2,3,$3::bigint,$4)",[f.project,f.product,s.v,id]);await flush();expect(await notices(f)).toBe(count);
    await call("select * from public.reserve_finished_goods_for_project($1,$2,3,2,$3)",[f.project,f.product,randomUUID()]);await flush();
    expect(await episodes(f)).toEqual([]);expect(await episodes(other)).toEqual([{q:"6"}]);expect(await notices(other)).toBe(1);
    expect((await db.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[f.product,fg])).rows[0].q).toBe("6");
  });
  it("cancellation resolves and completion keeps existing reservation guards",async()=>{
    const f=await fixture(3);await run(args(f,6));await flush();await call("select public.cancel_project($1)",[f.project]);await flush();
    expect(await episodes(f)).toEqual([]);expect((await reservation(f)).q).toBe("0");expect(await notices(f)).toBe(2);
    const completed=await fixture(0);await run(args(completed,6));await flush();
    await db.query("update public.projects set status='completed',completed_at=clock_timestamp() where id=$1",[completed.project]);await flush();expect(await episodes(completed)).toEqual([]);
    const protectedProject=await fixture(3);await run(args(protectedProject,2));await db.query("savepoint completion");
    await expect(db.query("update public.projects set status='completed',completed_at=clock_timestamp() where id=$1",[protectedProject.project])).rejects.toMatchObject({code:"FGR08"});
    await db.query("rollback to savepoint completion; release savepoint completion");
  });
  it("fulfillment preserves the shared deficit and never consumes original BOM inputs again",async()=>{
    const component=await material();await stock(component.product,20,db,raw);const f=await fixture(3);
    await call("select * from public.save_initial_pcb_bom($1,$2::jsonb)",[f.card,JSON.stringify([{product_id:component.product,quantity_per_card:"2"}])]);
    await run(args(f,6));await flush();const s=await reservation(f);
    const movementsBefore=(await db.query("select count(*)::int n from public.inventory_movements where product_id=$1",[component.product])).rows[0].n;
    await call("select * from public.fulfill_finished_goods_project_reservation($1,$2,$3,1,$4::bigint,$5)",[s.id,f.project,f.product,s.v,randomUUID()]);await flush();
    expect(await episodes(f)).toEqual([{q:"3"}]);expect(await notices(f)).toBe(1);
    expect((await db.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[component.product,raw])).rows[0].q).toBe("20");
    expect((await db.query("select count(*)::int n from public.inventory_movements where product_id=$1",[component.product])).rows[0].n).toBe(movementsBefore);
    expect((await db.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[f.product,fg])).rows[0].q).toBe("2");
    await db.query("set constraints all immediate");
  });
  it("evaluates final state only, with no transient alert and complete recipient snapshots",async()=>{
    const f=await fixture(0);await run(args(f,5));await stock(f.product,5);await flush();expect(await notices(f)).toBe(0);expect((await reservation(f))?.q??"0").toBe("0");
    await call("select * from public.adjust_inventory_warehouse($1,$2,'remove',1,'shortage recipient check',null)",[f.product,fg]);await flush();
    const actual=(await db.query(`select count(*)::int n from public.project_activity_alert_recipients r join public.project_activity_alerts a on a.id=r.alert_id where a.product_id=$1`,[f.product])).rows[0].n;
    const expected=(await db.query(`select count(*)::int n from public.user_profiles u where u.is_active and (u.is_admin or (
      exists(select 1 from public.user_permissions p join public.permission_definitions d on d.id=p.permission_definition_id where p.user_id=u.id and d.key='dashboard.view' and d.is_delegable)
      and exists(select 1 from public.user_permissions p join public.permission_definitions d on d.id=p.permission_definition_id where p.user_id=u.id and d.key='projects.view' and d.is_delegable)))`)).rows[0].n;
    expect(actual).toBe(expected);expect(await notices(f)).toBe(1);
    await db.query("savepoint history");await expect(db.query("delete from public.project_shortage_events where product_id=$1",[f.product])).rejects.toMatchObject({code:"55000"});await db.query("rollback to savepoint history; release savepoint history");
  });
});
