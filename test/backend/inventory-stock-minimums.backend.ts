import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { LOCAL_RESERVATION, ReservationLocalTarget, reservationSnapshot, rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const raw="10000000-0000-4000-8000-000000000001", fg="10000000-0000-4000-8000-000000000002", customs="10000000-0000-4000-8000-000000000003";
const rpc="select * from public.set_inventory_stock_minimum($1,$2,$3,$4)";
describe.skipIf(process.env.INVENTORY_MINIMUMS_LOCAL!=="1")("LS-01 — newly owned pinned local clone only",()=>{
  const target=new ReservationLocalTarget(), name=`alfaev_fg_3b1_${randomUUID().replace(/-/g,"")}`;
  let source:LocalReservationPool|undefined,pool:LocalReservationPool|undefined,created=false,sourceBaseline:unknown,baseline:unknown;
  let transaction:ReturnType<typeof guardRollbackQueries>|undefined, db:PoolClient;
  const branches:ReturnType<typeof guardRollbackQueries>[]=[];
  let admin:{id:string;auth_user_id:string},member:typeof admin;
  async function snapshot(p:LocalReservationPool){const c=await p.connect();try{return await reservationSnapshot(c);}finally{c.release(true);}}
  async function call(product:string,warehouse=raw,minimum:string|null="5",version:string|null=null,actor=admin,role="authenticated"){
    if(!["authenticated","anon","service_role"].includes(role))throw Error("Unsafe role");
    await db.query("savepoint caller");
    try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);await db.query(`set local role ${role}`);
      const r=(await db.query(rpc,[product,warehouse,minimum,version])).rows[0];await db.query("reset role; release savepoint caller");return r;
    }catch(e){await db.query("rollback to savepoint caller; release savepoint caller");throw e;}
  }
  async function product(linked=false){
    const id=randomUUID();if(id===LOCAL_RESERVATION.residue)throw Error("Residue forbidden");
    const serial=(await db.query("select n::text serial from generate_series(8000000,8999999) n where not exists(select 1 from public.products where serial_number=n::text) order by n limit 1")).rows[0].serial;
    await db.query("insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id) values($1,$2,$3,'LS-01 test',$4,$5,$5)",[id,serial,`LS-01 ${id}`,linked?"pcb_finished_good":"component",admin.id]);
    if(linked)await db.query("insert into public.pcb_cards(id,name,output_product_id,created_by_user_id,updated_by_user_id) values($1,$2,$3,$4,$4)",[randomUUID(),`LS-01 ${id}`,id,admin.id]);
    return id;
  }
  async function grant(keys:string[]){await db.query("delete from public.user_permissions where user_id=$1",[member.id]);
    await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,admin.id,keys]);}
  beforeAll(async()=>{
    if(process.env.INVENTORY_MINIMUMS_APPROVAL!=="owned-clone-only"||process.env.LOCAL_SUPABASE_DB_PASSWORD)throw Error("Owned-clone peer scope required");
    source=target.pool();await target.acquire(source);sourceBaseline=await snapshot(source);
    await target.createTemporary(source,name);created=true;console.info(`LS-01 owned clone: ${name}`);
    target.copyIntoTemporary(name);pool=target.pool(name);const setup=await pool.connect();
    try{
      // Pin this foundation suite to its historical prefix; later migrations must
      // neither break setup nor silently change the schema under these tests.
      const files=readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort().slice(0,159);
      expect(files.length).toBe(159);expect(files[158]).toBe("20261028100000_add_inventory_stock_minimum_configuration.sql");
      await setup.query("begin");
      try{for(let i=142;i<150;i++){const f=files[i]!;await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8"));
        await setup.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)",[f.slice(0,14),f.slice(15,-4)]);
        if(i>=145){await setup.query("commit");await target.acceptClonePhase(setup,name,(i+1) as 146|147|148|149|150);if(i<149)await setup.query("begin");}}
      }catch(e){await setup.query("rollback");throw e;}
      // Existing TC harness convention: install forward SQL only in this clone;
      // retain its approved phase-150 ledger guard, never advance source postgres.
      await setup.query("begin");try{for(const f of files.slice(150))await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8"));await setup.query("commit");}
      catch(e){await setup.query("rollback");throw e;}
      expect((await setup.query("select to_regprocedure('public.get_inventory_stock_health(uuid,text,text,boolean,integer,integer)') later_read")).rows[0].later_read).toBeNull();
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
    if(created&&source){await target.dropTemporary(source,name);expect((await source.query("select exists(select 1 from pg_database where datname=$1) present",[name])).rows[0].present).toBe(false);console.info("LS-01 owned clone removed; source manifest unchanged");}
    if(source&&sourceBaseline)expect(await snapshot(source)).toEqual(sourceBaseline);
  }finally{await target.release();if(source)await source.end();}});

  it("sets, updates and clears with exact bigint transport and retained creator",async()=>{
    const p=await product();expect(await call(p,raw,"9223372036854775807")).toMatchObject({product_id:p,warehouse_id:raw,minimum_quantity:"9223372036854775807",version:"1"});
    expect(await call(p,raw,"9007199254740993","1")).toMatchObject({minimum_quantity:"9007199254740993",version:"2"});
    expect(await call(p,raw,null,"2")).toMatchObject({minimum_quantity:null,version:"3"});
    const row=(await db.query("select * from public.inventory_stock_minimums where product_id=$1",[p])).rows[0];expect(row.created_by_user_id).toBe(admin.id);expect(row.updated_by_user_id).toBe(admin.id);
  });
  it("rejects malformed, nonpositive and out-of-range values without a setting",async()=>{
    const p=await product();for(const v of ["","0","000","-1","1.5","1e3"," 1","+1","NaN","9223372036854775808"])
      await expect(call(p,raw,v)).rejects.toMatchObject({code:"22023"});
    for(const v of ["0","-1","1.0","9223372036854775808"])await expect(call(p,raw,"1",v)).rejects.toMatchObject({code:"22023"});
    expect((await db.query("select count(*)::int n from public.inventory_stock_minimums where product_id=$1",[p])).rows[0].n).toBe(0);
    expect(await call(p,raw,"00042")).toMatchObject({minimum_quantity:"42"});
  });
  it("rejects missing/stale versions including retries after clearing",async()=>{
    const p=await product();await expect(call(p,raw,"1","1")).rejects.toMatchObject({code:"ISM01"});
    await call(p);for(const v of [null,"2"])await expect(call(p,raw,"8",v)).rejects.toMatchObject({code:"ISM01"});
    await call(p,raw,null,"1");await expect(call(p,raw,"9",null)).rejects.toMatchObject({code:"ISM01"});
  });
  it("uses warehouse membership, including Customs depletion history and linked zero-stock FG",async()=>{
    const p=await product(),out=await product(true);await call(out,fg,"3");
    await expect(call(p,fg)).rejects.toMatchObject({code:"P0002"});await expect(call(p,customs)).rejects.toMatchObject({code:"P0002"});
    const supplier=await createSupplierSourceFixture(db,{profileId:admin.id,authUserId:admin.auth_user_id},p);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.auth_user_id]);
    await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add',1,'LS-01 isolated fixture',$3)",[p,customs,supplier.productSupplierId]);
    await db.query("select * from public.adjust_inventory_warehouse($1,$2,'remove',1,'LS-01 depleted fixture',null)",[p,customs]);
    expect(await call(p,customs)).toMatchObject({minimum_quantity:"5"});
    await expect(call(p,randomUUID())).rejects.toMatchObject({code:"P0002"});
  });
  it("denies archived Products while retaining their prior setting",async()=>{
    const p=await product();await call(p);await db.query("update public.products set is_active=false,archived_at=clock_timestamp(),archived_by_user_id=$2 where id=$1",[p,admin.id]);
    await expect(call(p,raw,"8","1")).rejects.toMatchObject({code:"PRD01"});await expect(call(p,raw,null,"1")).rejects.toMatchObject({code:"PRD01"});
    expect((await db.query("select version::text from public.inventory_stock_minimums where product_id=$1",[p])).rows[0].version).toBe("1");
  });
  it("requires edit AND the specific warehouse view; denies inactive, anonymous and service role",async()=>{
    const p=await product(),out=await product(true);
    for(const keys of [[],["inventory.products.edit"],["inventory.raw_materials.view"],["inventory.products.edit","inventory.finished_goods.view"]]){
      await grant(keys);await expect(call(p,raw,"1",null,member)).rejects.toMatchObject({code:"42501"});}
    await grant(["inventory.products.edit","inventory.raw_materials.view"]);await call(p,raw,"2",null,member);
    await expect(call(out,fg,"1",null,member)).rejects.toMatchObject({code:"42501"});
    await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);await expect(call(p,raw,"3","1",member)).rejects.toMatchObject({code:"42501"});
    for(const role of ["anon","service_role"])await expect(call(p,raw,"3","1",admin,role)).rejects.toMatchObject({code:"42501"});
    await expect(call(p,raw,"3","1",{id:admin.id,auth_user_id:""})).rejects.toMatchObject({code:"42501"});
  });
  it("preserves every existing dataset/security/sequence and denies direct table reads and writes",async()=>{
    const p=await product();const before=await reservationSnapshot(db);await call(p);await call(p,raw,null,"1");const after=await reservationSnapshot(db);
    delete before['public.inventory_stock_minimums'];delete after['public.inventory_stock_minimums'];expect(after).toEqual(before);
    expect((await db.query("select relrowsecurity from pg_class where oid='public.inventory_stock_minimums'::regclass")).rows[0].relrowsecurity).toBe(true);
    for(const role of ["authenticated","anon","service_role"])expect((await db.query("select has_table_privilege($1,'public.inventory_stock_minimums','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed",[role])).rows[0].allowed).toBe(false);
    expect((await db.query("select prosecdef,proconfig from pg_proc where oid='public.set_inventory_stock_minimum(uuid,uuid,text,text)'::regprocedure")).rows[0]).toEqual({prosecdef:true,proconfig:['search_path=""']});
    for(const statement of ["select * from public.inventory_stock_minimums","insert into public.inventory_stock_minimums default values",
      "update public.inventory_stock_minimums set minimum_quantity=1","delete from public.inventory_stock_minimums"]){
      await db.query("savepoint direct; set local role authenticated");await expect(db.query(statement)).rejects.toMatchObject({code:"42501"});await db.query("rollback to savepoint direct; release savepoint direct");
    }
  });
  it("enforces table constraints and fails closed on exhausted versions",async()=>{
    const p=await product();await call(p);
    for(const statement of ["update public.inventory_stock_minimums set minimum_quantity=0","update public.inventory_stock_minimums set minimum_quantity=-1","update public.inventory_stock_minimums set version=0"]){
      await db.query("savepoint invalid");await expect(db.query(statement)).rejects.toMatchObject({code:"23514"});await db.query("rollback to savepoint invalid; release savepoint invalid");
    }
    await db.query("savepoint invalid");await expect(db.query("update public.inventory_stock_minimums set warehouse_id=$1 where product_id=$2",[randomUUID(),p])).rejects.toMatchObject({code:"23503"});await db.query("rollback to savepoint invalid; release savepoint invalid");
    await db.query("update public.inventory_stock_minimums set version=9223372036854775807 where product_id=$1",[p]);
    await expect(call(p,raw,"8","9223372036854775807")).rejects.toMatchObject({code:"22003"});
  });
  it("serializes concurrent first writes and stale updates to exactly one winner",async context=>{
    const p=await product();await db.query("commit");baseline=await snapshot(pool!);
    for(const [version,minimum] of [[null,"7"],["1","11"]] as const){
      const a=guardRollbackQueries(await pool!.connect(),context.signal);branches.push(a);
      const b=guardRollbackQueries(await pool!.connect(),context.signal);branches.push(b);
      for(const c of [a.client,b.client]){await c.query("begin");await c.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.auth_user_id]);await c.query("set local role authenticated");}
      const secondPid=(await b.client.query("select pg_backend_pid() pid")).rows[0].pid;
      const first=(await a.client.query(rpc,[p,raw,minimum,version])).rows[0];
      const second=b.client.query(rpc,[p,raw,"13",version]).then(()=>({code:"UNEXPECTED_SUCCESS"}),e=>({code:e.code}));
      const deadline=Date.now()+2000;let blocked=false;
      while(Date.now()<deadline){blocked=(await db.query("select cardinality(pg_blocking_pids($1))>0 blocked",[secondPid])).rows[0].blocked;if(blocked)break;await new Promise(resolve=>setTimeout(resolve,20));}
      expect(blocked).toBe(true);
      await a.client.query("commit");expect(await second).toMatchObject({code:"ISM01"});await b.client.query("rollback");
      expect(first.minimum_quantity).toBe(minimum);
      // Release each pair before the next race; register each checkout above so
      // even a second-checkout failure cannot leak a client into Pool.end().
      await rollbackReservationTransactions(branches.splice(0));baseline=await snapshot(pool!);
    }
    expect((await db.query("select version::text,minimum_quantity::text from public.inventory_stock_minimums where product_id=$1",[p])).rows[0]).toEqual({version:"2",minimum_quantity:"11"});
    await rollbackReservationTransactions(branches.splice(0));baseline=await snapshot(pool!);
  });
});
