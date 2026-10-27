import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { ReservationLocalTarget, reservationSnapshot, rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const paths=readdirSync("supabase/migrations").filter(p=>/^\d{14}_.+\.sql$/.test(p)&&p.slice(0,14)<="20261026110000").sort();
const fg="10000000-0000-4000-8000-000000000002";
const mutate="select public.mutate_project_requirement($1,$2,$3,$4,$5,$6,$7::bigint,$8,$9::bigint) result";
describe.skipIf(process.env.FG_REQUIREMENTS_LOCAL!=="1")("Task 001L atomic requirements — owned local clone only",()=>{
  const target=new ReservationLocalTarget(),name=`alfaev_fg_3b1_${randomUUID().replace(/-/g,"")}`;
  let source:LocalReservationPool,pool:LocalReservationPool,db:PoolClient,created=false;
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
      values($1,$2,'Local 001L','2026-10-26','2026-11-26',$3,$3)`,[project,`001L ${project}`,admin.profileId]);
    await client.query(`insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id)
      values($1,$2,'001L requirements',$3,$3)`,[id,project,admin.profileId]);return{project,group:id};}
  async function stock(product:string,quantity:string|number,client=db){
    const supplier=await createSupplierSourceFixture(client,admin,product);
    await call("select * from public.adjust_inventory_warehouse($1,$2,'add',$3::bigint,'001L stock',$4)",[product,fg,quantity,supplier.productSupplierId],"authenticated",client);
  }
  async function fixture(quantity:string|number=10,client=db){const product=randomUUID(),card=randomUUID();
    const serial=(await client.query(`select s::text serial from generate_series(8000000,8999999) s where not exists
      (select 1 from public.products where serial_number=s::text) order by s limit 1`)).rows[0].serial;
    await client.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,'001L','pcb_finished_good',$4,$4)`,[product,serial,`001L ${product}`,admin.profileId]);
    await client.query(`insert into public.pcb_cards(id,name,output_product_id,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,$4,$4)`,[card,`001L ${card}`,product,admin.profileId]);
    if(BigInt(quantity)>0n)await stock(product,quantity,client);
    return{...await group(client),product};}
  type Fixture=Awaited<ReturnType<typeof fixture>>;
  const args=(f:Fixture,qty:string|number,id:string|null=null,old:string|number|null=null,op=id?"update":"create",request=randomUUID(),oldProduct=f.product)=>
    [request,op,f.project,f.group,id,op==="remove"?null:f.product,op==="remove"?null:qty,id?oldProduct:null,id?old:null];
  const run=async(a:unknown[],client=db)=>(await call(mutate,a,"authenticated",client))[0].result;
  const reservation=async(f:Fixture)=>(await db.query("select reserved_quantity::text q,version::text v,id from public.finished_goods_project_reservations where project_id=$1 and product_id=$2",[f.project,f.product])).rows[0];
  beforeAll(async()=>{
    expect(paths).toHaveLength(149);source=target.pool();await target.acquire(source);sourceBaseline=await reservationSnapshot(source);
    console.info(`001L source verified; newly owned clone ${name}`);
    await target.createTemporary(source,name);created=true;target.copyIntoTemporary(name);pool=target.pool(name);
    const setup=await pool.connect();try{
      const a=(await setup.query("select id,auth_user_id from public.user_profiles where is_admin and is_active order by id limit 1")).rows[0];
      if(!a)throw Error("Active local Admin required");admin={profileId:a.id,authUserId:a.auth_user_id};actor=admin;
      await setup.query("begin");try{for(let i=142;i<paths.length;i++){
        await setup.query(readFileSync(`supabase/migrations/${paths[i]}`,"utf8"));
        await setup.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)",[paths[i]!.slice(0,14),paths[i]!.slice(15,-4)]);
        if(i>=145){await setup.query("commit");await target.acceptClonePhase(setup,name,(i+1) as 146|147|148|149);if(i<148)await setup.query("begin");}
      }}catch(e){await setup.query("rollback");throw e;}
      baseline=await reservationSnapshot(setup);
    }finally{setup.release();}
  });
  beforeEach(async context=>{await target.assertQuiet();actor=admin;const c=await pool.connect();await c.query("begin");tx=guardRollbackQueries(c,context.signal);db=tx.client;});
  afterEach(async()=>{try{if(tx)await rollbackReservationTransactions([tx]);}finally{tx=undefined;if(baseline)expect(await reservationSnapshot(pool)).toEqual(baseline);}});
  afterAll(async()=>{try{if(sourceBaseline)expect(await reservationSnapshot(source)).toEqual(sourceBaseline);}
    finally{try{if(pool)await pool.end();if(created)await target.dropTemporary(source,name);}finally{await target.release();if(source)await source.end();}}});

  it.each([[10,6,"6","0"],[3,6,"3","3"],[0,6,"0","6"]])("stock %s saves demand %s with correct partial/zero receipt",async(stockQty,qty,reserved,uncovered)=>{
    const f=await fixture(stockQty),before=await db.query("select quantity::text from public.inventory_balances where product_id=$1 order by warehouse_id",[f.product]);
    const r=await run(args(f,qty));expect(r.affected_products).toEqual([{product_id:f.product,reserved_quantity:reserved,outstanding_demand:String(qty),uncovered_demand:uncovered}]);
    expect((await db.query("select quantity::text from public.inventory_balances where product_id=$1 order by warehouse_id",[f.product])).rows).toEqual(before.rows);
    expect((await db.query("select required_quantity::text q from public.project_product_components where id=$1",[r.component_id])).rows[0].q).toBe(String(qty));
  });
  it("has exactly 190 trusted definers, correct RPC/helper ACLs, immutable receipts and no legacy bypass",async()=>{
    expect((await db.query("select count(*)::int n from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.proname<>'rls_auto_enable'")).rows[0].n).toBe(190);
    const names=["create_project_requirement_private","update_project_requirement_private","remove_project_requirement_private",
      "create_project_product_component","update_project_product_component","remove_project_product_component","mutate_project_requirement"];
    const metadata=(await db.query(`select proname,prosecdef,proconfig,has_function_privilege('authenticated',oid,'execute') authenticated,
      has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service,
      exists(select 1 from aclexplode(proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') public
      from pg_proc where pronamespace='public'::regnamespace and proname=any($1::text[])`,[names])).rows;
    expect(metadata).toHaveLength(7);
    for(const row of metadata)expect(row).toMatchObject({prosecdef:true,proconfig:['search_path=""'],authenticated:!row.proname.endsWith("_private"),anon:false,service:false,public:false});
    const f=await fixture(),a=args(f,2),r=await run(a),s=await reservation(f);
    await expect(call("select public.update_project_product_component($1,$2,1)",[r.component_id,f.product])).rejects.toMatchObject({code:"FGA01"});
    await expect(call("select public.remove_project_product_component($1)",[r.component_id])).rejects.toMatchObject({code:"FGA01"});
    await expect(call("select public.create_project_requirement_private($1,$2,1)",[f.group,f.product])).rejects.toMatchObject({code:"42501"});
    await db.query("savepoint immutable");await expect(db.query("delete from public.project_requirement_mutation_receipts where request_id=$1",[a[0]])).rejects.toMatchObject({code:"55000"});await db.query("rollback to savepoint immutable");
    await expect(call("select * from public.release_finished_goods_project_reservation($1,$2,1,$3::bigint,$4)",[f.project,f.product,s.v,a[0]])).rejects.toMatchObject({code:"FGR01"});
    expect((await reservation(f)).q).toBe("2");
  });
  it("rejects new archived allocation but permits reduction/removal and keeps Raw shortage formula unchanged",async()=>{
    const f=await fixture(),r=await run(args(f,4));
    await call("select public.archive_product($1)",[f.product]);
    await expect(run(args(f,5,r.component_id,4))).rejects.toMatchObject({code:"FGR03"});
    await run(args(f,2,r.component_id,4));expect((await reservation(f)).q).toBe("2");
    await run(args(f,0,r.component_id,2,"remove"));expect((await reservation(f)).q).toBe("0");
    const definition=(await db.query("select pg_get_functiondef('public.reconcile_project_shortages_for_products(uuid[],boolean)'::regprocedure) body")).rows[0].body;
    expect(definition).toContain("10000000-0000-4000-8000-000000000001");expect(definition).toContain("10000000-0000-4000-8000-000000000003");
    expect(definition).not.toContain("finished_goods_project_reservations");
  });
  it("increase covers all uncovered groups; unchanged save and manual release never top up",async()=>{
    const f=await fixture(3),r=await run(args(f,5));await stock(f.product,10);
    await run(args(f,5,r.component_id,5));expect((await reservation(f)).q).toBe("3");
    const other=randomUUID();await db.query("insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id) values($1,$2,'Other',$3,$3)",[other,f.project,admin.profileId]);
    await run(args({...f,group:other},2));expect((await reservation(f)).q).toBe("7");
    const s=await reservation(f);await call("select * from public.release_finished_goods_project_reservation($1,$2,2,$3::bigint,$4)",[f.project,f.product,s.v,randomUUID()]);
    await run(args(f,5,r.component_id,5));expect((await reservation(f)).q).toBe("5");
    await run(args(f,6,r.component_id,5));expect((await reservation(f)).q).toBe("8");
  });
  it("release excess before reduction/removal and replay deleted receipts without allocation",async()=>{
    const f=await fixture(),r=await run(args(f,8));await run(args(f,3,r.component_id,8));expect((await reservation(f)).q).toBe("3");
    const removal=args(f,0,r.component_id,3,"remove");const receipt=await run(removal);expect((await reservation(f)).q).toBe("0");
    expect(await run(removal)).toEqual(receipt);expect((await db.query("select 1 from public.project_product_components where id=$1",[r.component_id])).rowCount).toBe(0);
  });
  it("replacement releases old Product and reserves new Product atomically",async()=>{
    const f=await fixture(),next=await fixture(2),r=await run(args(f,7));
    const a=args({...f,product:next.product},5,r.component_id,7,"update",randomUUID(),f.product);const receipt=await run(a);
    expect((await reservation(f)).q).toBe("0");expect(receipt.affected_products.find((x:{product_id:string})=>x.product_id===next.product)).toMatchObject({reserved_quantity:"2",uncovered_demand:"3"});
  });
  it("zero-stock replay after stock arrival does not allocate; altered payload and stale edits reject",async()=>{
    const f=await fixture(0),a=args(f,5),r=await run(a);await stock(f.product,10);expect(await run(a)).toEqual(r);expect(await reservation(f)).toBeUndefined();
    const changed=[...a];changed[6]=6;await expect(run(changed)).rejects.toMatchObject({code:"FGR01"});
    await run(args(f,6,r.component_id,5));await expect(run(args(f,7,r.component_id,5))).rejects.toMatchObject({code:"FGA02"});
  });
  it("fulfillment is FG-only and reduces later demand before automatic allocation",async()=>{
    const f=await fixture(),r=await run(args(f,6)),s=await reservation(f);
    await call("select * from public.fulfill_finished_goods_project_reservation($1,$2,$3,2,1,$4)",[s.id,f.project,f.product,randomUUID()]);
    const next=await run(args(f,7,r.component_id,6));expect(next.affected_products[0]).toMatchObject({outstanding_demand:"5",reserved_quantity:"5",uncovered_demand:"0"});
    expect((await db.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[f.product,fg])).rows[0].q).toBe("8");
    expect((await db.query("select count(*)::int n from public.inventory_movements where product_id=$1 and quantity_delta<0",[f.product])).rows[0].n).toBe(1);
    await run(args(f,0,r.component_id,7,"remove"));
    expect((await run(args(f,3))).affected_products[0]).toMatchObject({outstanding_demand:"1",reserved_quantity:"1"});
    await db.query("set constraints all immediate");
  });
  it("keeps legacy FG writes closed and receipts/private helpers/table writes inaccessible",async()=>{
    const f=await fixture();await expect(call("select public.create_project_product_component($1,$2,1)",[f.group,f.product])).rejects.toMatchObject({code:"FGA01"});
    for(const role of ["anon","service_role"])await expect(call(mutate,args(f,1),role)).rejects.toMatchObject({code:"42501"});
    await expect(call("select * from public.project_requirement_mutation_receipts")).rejects.toMatchObject({code:"42501"});
    await expect(call("select public.set_requirement_finished_goods_reservation($1,$2,1,$3,$4)",[f.project,f.product,admin.profileId,randomUUID()])).rejects.toMatchObject({code:"42501"});
  });
  it("denies each missing permission, inactive users and another actor's receipt",async()=>{
    const f=await fixture(),a=args(f,1),original=await run(a);
    const row=(await db.query("select id,auth_user_id from public.user_profiles where not is_admin and is_active order by id limit 1")).rows[0];
    if(!row)throw Error("Active non-Admin local fixture required");actor={profileId:row.id,authUserId:row.auth_user_id};
    await db.query("delete from public.user_permissions where user_id=$1",[actor.profileId]);
    const keys=["projects.view","projects.edit","inventory.finished_goods.view","inventory.finished_goods.reserve"];
    for(const missing of keys){await db.query("delete from public.user_permissions where user_id=$1",[actor.profileId]);
      await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
        select $1,id,$2 from public.permission_definitions where key=any($3::text[])`,[actor.profileId,admin.profileId,keys.filter(k=>k!==missing)]);
      await expect(run(args(f,1))).rejects.toMatchObject({code:"42501"});}
    await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
      select $1,id,$2 from public.permission_definitions where key='inventory.finished_goods.reserve'`,[actor.profileId,admin.profileId]);
    await expect(run(a)).rejects.toMatchObject({code:"42501"});
    expect((await run(args(f,3,original.component_id,1))).affected_products[0].reserved_quantity).toBe("3");
    await db.query("update public.user_profiles set is_active=false where id=$1",[actor.profileId]);
    await expect(run(args(f,1))).rejects.toMatchObject({code:"42501"});
  });
  it("cancellation releases reservations and exact replay never reopens them",async()=>{
    const f=await fixture(),a=args(f,3),r=await run(a);await call("select public.cancel_project($1)",[f.project]);
    expect((await reservation(f)).q).toBe("0");expect(await run(a)).toEqual(r);expect((await reservation(f)).q).toBe("0");
    await expect(run(args(f,1))).rejects.toMatchObject({code:"PPL01"});
  });
  it("preserves SQL bigint quantities in partial allocation and receipts",async()=>{
    const f=await fixture("9007199254740993"),r=await run(args(f,"9223372036854775807"));
    expect(r.affected_products[0]).toMatchObject({reserved_quantity:"9007199254740993",outstanding_demand:"9223372036854775807",uncovered_demand:"9214364837600034814"});
  });
  it("ordinary requirement legacy create/update/remove remains planning-only",async()=>{
    const f=await fixture(0),product=randomUUID();
    const serial=(await db.query(`select s::text serial from generate_series(9000000,9999999) s where not exists
      (select 1 from public.products where serial_number=s::text) order by s limit 1`)).rows[0].serial;
    await db.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
      values($1,$2,'001L ordinary','Components','component',$3,$3)`,[product,serial,admin.profileId]);
    const row=(await db.query("select id,auth_user_id from public.user_profiles where not is_admin and is_active order by id limit 1")).rows[0];
    if(!row)throw Error("Local non-Admin fixture required");actor={profileId:row.id,authUserId:row.auth_user_id};
    await db.query("delete from public.user_permissions where user_id=$1",[actor.profileId]);
    await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
      select $1,id,$2 from public.permission_definitions where key='projects.edit'`,[actor.profileId,admin.profileId]);
    const id=(await call("select public.create_project_product_component($1,$2,7) id",[f.group,product]))[0].id;
    await call("select public.update_project_product_component($1,$2,4)",[id,product]);
    await call("select public.remove_project_product_component($1)",[id]);
    expect((await db.query("select 1 from public.finished_goods_project_reservations where product_id=$1",[product])).rowCount).toBe(0);
  });
  it("completion rejects automatic reservations and reopening never recreates a released reservation",async()=>{
    const f=await fixture();await run(args(f,3));
    await db.query("savepoint completion");await expect(db.query("update public.projects set status='completed',completed_at=clock_timestamp() where id=$1",[f.project])).rejects.toMatchObject({code:"FGR08"});
    await db.query("rollback to savepoint completion");const s=await reservation(f);
    await call("select * from public.release_finished_goods_project_reservation($1,$2,3,$3::bigint,$4)",[f.project,f.product,s.v,randomUUID()]);
    await db.query("update public.projects set status='completed',completed_at=clock_timestamp() where id=$1",[f.project]);
    await call("select public.reopen_project($1)",[f.project]);expect((await reservation(f)).q).toBe("0");
  });
  it.each(["duplicate","competing-projects","stale-edit","release","fulfill","reserve","debit","cancel","cancel-first"])(
    "committed concurrent %s observes the winner without over-reservation or duplicate history",async kind=>{
      const setup=await pool.connect();let f:Fixture,initial:{component_id:string}|undefined;
      try{await setup.query("begin");f=await fixture(5,setup);
        if(!["duplicate","competing-projects"].includes(kind))initial=await run(args(f,2),setup);
        if(kind==="competing-projects"){const other=await group(setup);(f as Fixture&{other?:typeof other}).other=other;}
        await setup.query("commit");
      }catch(e){await setup.query("rollback");throw e;}finally{setup.release(true);}
      const a=await pool.connect(),b=await pool.connect();
      try{await a.query("begin");await b.query("begin");
        const first=args(f!,kind==="competing-projects"?7:kind==="debit"?5:4,initial?.component_id??null,initial?2:null);
        if(kind==="cancel-first")await call("select public.cancel_project($1)",[f!.project],"authenticated",a);
        else await run(first,a);
        const state=(await a.query("select id,version from public.finished_goods_project_reservations where project_id=$1 and product_id=$2",[f!.project,f!.product])).rows[0];
        const pid=(await b.query("select pg_backend_pid() pid")).rows[0].pid;
        const next=kind==="duplicate"?run(first,b)
          :kind==="competing-projects"?run(args({...f!,...(f as Fixture&{other:Awaited<ReturnType<typeof group>>}).other},7),b)
          :kind==="release"?call("select * from public.release_finished_goods_project_reservation($1,$2,1,1,$3)",[f!.project,f!.product,randomUUID()],"authenticated",b)
          :kind==="reserve"?call("select * from public.reserve_finished_goods_for_project($1,$2,1,1,$3)",[f!.project,f!.product,randomUUID()],"authenticated",b)
          :kind==="fulfill"?call("select * from public.fulfill_finished_goods_project_reservation($1,$2,$3,1,1,$4)",[state.id,f!.project,f!.product,randomUUID()],"authenticated",b)
          :kind==="debit"?call("select * from public.adjust_inventory_warehouse($1,$2,'remove',1,'001L race',null)",[f!.product,fg],"authenticated",b)
          :kind==="cancel"?call("select public.cancel_project($1)",[f!.project],"authenticated",b)
          :run(args(f!,3,initial!.component_id,2),b);
        const pending=next.then(value=>({value,error:undefined as {code:string}|undefined}),error=>({value:undefined,error:error as {code:string}}));
        const deadline=Date.now()+2000;let blocked=false;
        while(Date.now()<deadline){blocked=(await pool.query("select cardinality(pg_blocking_pids($1))>0 blocked",[pid])).rows[0].blocked;if(blocked)break;await new Promise(r=>setTimeout(r,20));}
        expect(blocked).toBe(true);await a.query("commit");const result=await pending;
        const expected=kind==="stale-edit"?"FGA02":["release","reserve","fulfill"].includes(kind)?"FGR04":kind==="debit"?"IVB02":kind==="cancel-first"?"PPL01":undefined;
        expect(result.error?.code).toBe(expected);await b.query(result.error?"rollback":"commit");
        const totals=(await pool.query(`select (select quantity::text from public.inventory_balances where product_id=$1 and warehouse_id=$2) physical,
          (select coalesce(sum(reserved_quantity),0)::text from public.finished_goods_project_reservations where product_id=$1) reserved`,[f!.product,fg])).rows[0];
        expect(totals.physical).toBe("5");expect(BigInt(totals.reserved)).toBeLessThanOrEqual(5n);
        if(kind==="duplicate"){
          expect((await pool.query("select 1 from public.project_requirement_mutation_receipts where request_id=$1",[first[0]])).rowCount).toBe(1);
          expect((await pool.query("select count(*)::int n from public.finished_goods_project_reservation_events where project_id=$1 and product_id=$2",[f!.project,f!.product])).rows[0].n).toBe(1);
        }
        if(kind==="competing-projects")expect(totals.reserved).toBe("5");
        if(kind.startsWith("cancel"))expect(totals.reserved).toBe("0");
      }finally{try{await a.query("rollback");await b.query("rollback");}finally{a.release(true);b.release(true);}}
      // Committed winners are confined to this newly owned disposable clone.
      // Source digest verification remains fixed and cleanup drops only this clone.
      baseline=await reservationSnapshot(pool);
    });
});
