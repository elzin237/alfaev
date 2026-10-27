import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { LOCAL_RESERVATION, LocalReservationPool, ReservationLocalTarget,
  reservationSnapshot, rollbackReservationTransactions } from "./helpers/reservation-local-target";

const fg = "10000000-0000-4000-8000-000000000002";
const raw = "10000000-0000-4000-8000-000000000001";
const reserve = "select * from public.reserve_finished_goods_for_project($1,$2,$3::bigint,0,$4)";
const migrationPaths = [
  "supabase/migrations/20261023100000_add_finished_goods_project_reservation_foundation.sql",
  "supabase/migrations/20261023110000_protect_finished_goods_hard_reservations.sql",
  ...(process.env.FG_RESERVATION_FULFILLMENT_LOCAL==="1" || process.env.FG_RESERVATION_READ_LOCAL==="1" || process.env.FG_ACCOUNTING_LOCAL==="1"
    ?["supabase/migrations/20261023120000_add_finished_goods_reservation_fulfillment.sql"]:[]),
  ...(process.env.FG_RESERVATION_READ_LOCAL==="1" || process.env.FG_ACCOUNTING_LOCAL==="1"
    ?["supabase/migrations/20261023130000_add_project_finished_goods_reservation_context.sql"]:[]),
  ...(process.env.FG_ACCOUNTING_LOCAL==="1" ? [
    "supabase/migrations/20261023140000_activate_finished_goods_project_reservation_mutations.sql",
    "supabase/migrations/20261026100000_correct_finished_goods_input_sourcing_and_inventory_reads.sql",
  ]:[]),
];

// Cross-session DDL visibility needs a committed schema, never committed fixtures.
// Clone ONLY the repository's local database into a fresh throwaway database on
// the same verified container. Never alter/reset the source, use remote URLs,
// expose dump contents, or retain the clone after this opt-in suite.
describe.skipIf(process.env.FG_RESERVATION_CONCURRENCY_LOCAL !== "1")("Phase 3B1 rollback-only concurrent trusted RPCs", () => {
  const databaseName = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  const target = new ReservationLocalTarget();
  let source: LocalReservationPool, pool: LocalReservationPool, a: PoolClient, b: PoolClient;
  let created = false, sourceBaseline: unknown, cloneBaseline: unknown;
  let transactions: ReturnType<typeof guardRollbackQueries>[] = [];
  let actor: {id:string;auth_user_id:string};
  let product: {id:string;quantity:string;input_quantity:string};

  const snapshot = reservationSnapshot;
  async function call(db: PoolClient, sql: string, args: unknown[], owner = false) {
    await db.query("savepoint rpc");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);
      await db.query(owner ? "set local role postgres" : "set local role authenticated");
      const rows = (await db.query(sql,args)).rows;
      await db.query("reset role");
      await db.query("release savepoint rpc");
      return rows;
    } catch(error) {await db.query("rollback to savepoint rpc");await db.query("release savepoint rpc");throw error;}
  }
  async function demand(db: PoolClient) {
    const project=randomUUID(),group=randomUUID();
    await db.query(`insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id)
      values($1,$2,'Local concurrency','2026-10-23','2026-11-23',$3,$3)`,[project,`Concurrency ${project}`,actor.id]);
    await db.query(`insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id)
      values($1,$2,'Explicit demand',$3,$3)`,[group,project,actor.id]);
    await db.query(`insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id)
      values($1,$2,10,$3,$3)`,[group,product.id,actor.id]);
    return project;
  }
  async function generic(db: PoolClient) {
    const project=await demand(db),id=randomUUID();
    const number=(await db.query(`select 'RN-8991-'||lpad(s::text,4,'0') n from generate_series(1,9999) s
      where not exists(select 1 from public.work_orders where work_order_number='RN-8991-'||lpad(s::text,4,'0')) order by s limit 1`)).rows[0].n;
    await db.query(`insert into public.work_orders(id,work_order_number,project_id,customer_name_snapshot,description,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,'Local concurrency','Concurrent FG Finish',$4,$4)`,[id,number,project,actor.id]);
    await db.query("insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id) values($1,$2,$3::bigint,$4)",[id,product.id,product.input_quantity,actor.id]);
    return id;
  }
  async function pcb(db: PoolClient) {
    const serial=(await db.query(`select lpad(s::text,3,'0') serial from generate_series(0,999) s
      where not exists(select 1 from public.products where serial_number=lpad(s::text,3,'0')) order by s limit 1`)).rows[0].serial;
    const card=(await call(db,"select * from public.create_pcb_card($1,$2)",[`Concurrent ${randomUUID()}`,serial]))[0].pcb_card_id;
    await call(db,"select * from public.save_initial_pcb_bom($1,$2::jsonb)",[card,JSON.stringify([{product_id:product.id,quantity_per_card:"1"}])]);
    return (await call(db,"select * from public.create_pcb_production_work_order($1,$2,null,$3)",[card,product.input_quantity,randomUUID()]))[0].work_order_id;
  }
  async function finishArgs(db: PoolClient, id: string) {
    const stamp=(await db.query("select updated_at::text stamp from public.work_orders where id=$1",[id])).rows[0].stamp;
    const fp=(await db.query("select public.get_work_order_source_allocation_fingerprint($1) fp",[id])).rows[0].fp;
    const path=`final/${id}/${randomUUID()}.pdf`;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('work-order-pdfs',$1,jsonb_build_object('mimetype','application/pdf'))",[path]);
    return [id,stamp,path,"a".repeat(64),fp];
  }
  async function waitBlocked(waiter: PoolClient, holderPid: number) {
    const waiterPid=(await waiter.query("select pg_backend_pid() pid")).rows[0].pid;
    return async () => {
      for(let attempt=0;attempt<150;attempt++) {
        if ((await pool.query("select $2=any(pg_blocking_pids($1)) blocked",[waiterPid,holderPid])).rows[0].blocked) return;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      throw new Error("RPC did not wait on the competing transaction");
    };
  }

  beforeAll(async () => {
    expect(databaseName).toMatch(/^alfaev_fg_3b1_[a-f0-9]{32}$/);
    source=target.pool();
    await target.acquire(source);
    expect((await source.query("select count(*)::int n,max(version) latest from supabase_migrations.schema_migrations")).rows[0])
      .toEqual({n:142,latest:"20261022150000"});
    expect((await source.query("select 1 from pg_database where datname=$1",[databaseName])).rowCount).toBe(0);
    sourceBaseline=await snapshot(source);
    await target.createTemporary(source,databaseName);
    created=true;
    target.copyIntoTemporary(databaseName);
    pool=target.pool(databaseName);
    const setup=await pool.connect();
    try {
      await setup.query("begin");
      for(const path of migrationPaths) await setup.query(readFileSync(path,"utf8"));
      await setup.query("commit");
      actor=(await setup.query("select id,auth_user_id from public.user_profiles where is_admin and is_active order by id limit 1")).rows[0];
      product=(await setup.query(`select p.id,b.quantity::text,
        case when $3::boolean then b.quantity::text else
          (select sum(all_stock.quantity::numeric)::text from public.inventory_balances all_stock where all_stock.product_id=p.id) end input_quantity
        from public.products p join public.pcb_cards c on c.output_product_id=p.id
        join public.inventory_balances b on b.product_id=p.id and b.warehouse_id=$1
        where p.is_active and b.quantity>=2 and p.id<>$2 order by p.id limit 1`,[fg,LOCAL_RESERVATION.residue,process.env.FG_ACCOUNTING_LOCAL==="1"])).rows[0];
      if(!actor||!product) throw new Error("Existing local Admin and stocked output required; do not commit fixtures");
      cloneBaseline=await snapshot(setup);
    } finally {setup.release();}
  },240000);
  beforeEach(async context => {
    await target.assertQuiet();
    transactions=[];
    for(let index=0;index<2;index++) {
      const raw=await pool.connect();await raw.query("begin");
      transactions.push(guardRollbackQueries(raw,context.signal));
    }
    [a,b]=transactions.map(t=>t.client) as [PoolClient,PoolClient];
    for(const db of [a,b]) {await db.query("set local statement_timeout='8s'");await db.query("set local lock_timeout='5s'");}
  });
  afterEach(async () => {
    let rollbackError: unknown;
    try { await rollbackReservationTransactions(transactions); } catch (error) { rollbackError=error; }
    try { if(cloneBaseline) expect(await snapshot(pool)).toEqual(cloneBaseline); }
    finally { if (rollbackError) throw rollbackError; }
  });
  afterAll(async () => {
    try {if(sourceBaseline) expect(await snapshot(source)).toEqual(sourceBaseline);}
    finally {
      try {
        if(pool) await pool.end();
        if(created) await target.dropTemporary(source,databaseName);
      } finally { await target.release(); if(source) await source.end(); }
    }
  });

  it.each(["remove","correction","transfer","generic","pcb"])("serializes reserve versus trusted %s and rolls both transactions back", async kind => {
    const project=await demand(a);
    let finish: unknown[]|undefined;
    if(kind==="generic"||kind==="pcb") {
      const id=kind==="generic"?await generic(b):await pcb(b);
      finish=await finishArgs(b,id); // Release setup balance locks before the race.
      // Allocation takes stock locks. Roll this setup back, retaining only the
      // fingerprint for the exact same Product/quantity/lots, then recreate the
      // Draft without calling the allocator before the actual Finish race.
      await b.query("rollback");
      await b.query("begin");
      await b.query("set local statement_timeout='8s'");
      await b.query("set local lock_timeout='5s'");
      const newId=kind==="generic"?await generic(b):await pcb(b);
      const stamp=(await b.query("select updated_at::text stamp from public.work_orders where id=$1",[newId])).rows[0].stamp;
      const path=`final/${newId}/${randomUUID()}.pdf`;
      await b.query("insert into storage.objects(bucket_id,name,metadata) values('work-order-pdfs',$1,jsonb_build_object('mimetype','application/pdf'))",[path]);
      finish=[newId,stamp,path,"a".repeat(64),finish[4]];
    }
    await call(a,reserve,[project,product.id,product.quantity,randomUUID()],true);
    const aPid=(await a.query("select pg_backend_pid() pid")).rows[0].pid;
    const blocked=await waitBlocked(b,aPid);
    let operation:Promise<unknown>;
    if(finish) operation=call(b,`select * from public.finish_work_order($1,$2::timestamptz,$3,$4,$5${kind==="pcb"?",'1'":""})`,finish);
    else if(kind==="transfer") operation=call(b,"select * from public.transfer_inventory_between_warehouses($1,$2,$3,$4::bigint,'Concurrent rollback')",[product.id,fg,raw,product.quantity]);
    else operation=call(b,"select * from public.adjust_inventory_warehouse($1,$2,$3,$4::bigint,'Concurrent rollback',null)",
      [product.id,fg,kind,kind==="correction"?0:product.quantity]);
    const settled=operation.then(rows=>({rows}),error=>({error}));
    try {await blocked();} finally {await a.query("rollback");}
    expect(await settled).toHaveProperty("rows");
    expect((await b.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[product.id,fg])).rows[0].q)
      .toBe("0");
  });
  it("serializes two real concurrent debits without deadlock or partial history", async () => {
    const sql="select * from public.adjust_inventory_warehouse($1,$2,'remove',1,'Concurrent debits',null)";
    await call(a,sql,[product.id,fg]);
    const aPid=(await a.query("select pg_backend_pid() pid")).rows[0].pid;
    const blocked=await waitBlocked(b,aPid);
    const pending=call(b,sql,[product.id,fg]).then(rows=>({rows}),error=>({error}));
    try {await blocked();} finally {await a.query("rollback");}
    expect(await pending).toHaveProperty("rows");
    expect((await b.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[product.id,fg])).rows[0].q)
      .toBe(String(BigInt(product.quantity)-1n));
  });
});

// Committed winners require a disposable database, not deletion of immutable
// receipts afterwards. Each case owns and discards its entire clone.
describe.skipIf(process.env.FG_RESERVATION_CONCURRENCY_LOCAL !== "1")("Phase 3B1 committed-winner races in disposable clones",()=>{
  const target=new ReservationLocalTarget();
  let source:LocalReservationPool,pool:LocalReservationPool,name:string,baseline:unknown;
  let created=false,clients:ReturnType<typeof guardRollbackQueries>[]=[];
  let actor:{id:string;auth_user_id:string},product:{id:string;quantity:string},projects:string[];
  async function rpc(db:PoolClient,sql:string,args:unknown[],owner=false) {
    await db.query("savepoint rpc");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);
      await db.query(owner?"set local role postgres":"set local role authenticated");
      const rows=(await db.query(sql,args)).rows;
      await db.query("reset role; release savepoint rpc");return rows;
    } catch(error) {await db.query("rollback to savepoint rpc; release savepoint rpc");throw error;}
  }
  const reservation=(db:PoolClient,project:string,qty:string|number,version=0)=>rpc(db,
    "select * from public.reserve_finished_goods_for_project($1,$2,$3::bigint,$4::bigint,$5)",
    [project,product.id,qty,version,randomUUID()],true);
  const release=(db:PoolClient,project:string,qty:number,version:number)=>rpc(db,
    "select * from public.release_finished_goods_project_reservation($1,$2,$3::bigint,$4::bigint,$5)",
    [project,product.id,qty,version,randomUUID()],true);
  beforeAll(async()=>{source=target.pool();await target.acquire(source);baseline=await reservationSnapshot(source);});
  beforeEach(async context=>{
    await target.assertQuiet();created=false;clients=[];
    name=`alfaev_fg_3b1_${randomUUID().replace(/-/g,"")}`;
    await target.createTemporary(source,name);created=true;target.copyIntoTemporary(name);pool=target.pool(name);
    const setup=await pool.connect();
    try {
      await setup.query("begin");
      for(const path of migrationPaths) await setup.query(readFileSync(path,"utf8"));
      actor=(await setup.query("select id,auth_user_id from public.user_profiles where is_admin and is_active order by id limit 1")).rows[0];
      product=(await setup.query(`select p.id,b.quantity::text from public.products p
        join public.pcb_cards c on c.output_product_id=p.id join public.inventory_balances b on b.product_id=p.id
        where p.is_active and b.warehouse_id=$1 and b.quantity>=2 and p.id<>$2 order by p.id limit 1`,[fg,LOCAL_RESERVATION.residue])).rows[0];
      if(!actor||!product) throw new Error("Existing local actor/stock fixture missing");
      projects=[];
      for(let i=0;i<2;i++) {
        const project=randomUUID(),group=randomUUID();projects.push(project);
        await setup.query(`insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id)
          values($1,$2,'Local committed race','2026-10-23','2026-11-23',$3,$3)`,[project,`Race ${project}`,actor.id]);
        await setup.query(`insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id)
          values($1,$2,'Explicit demand',$3,$3)`,[group,project,actor.id]);
        await setup.query(`insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id)
          values($1,$2,$3::bigint,$4,$4)`,[group,product.id,(BigInt(product.quantity)+2n).toString(),actor.id]);
      }
      await setup.query("commit");
    } catch(error) {await setup.query("rollback");throw error;} finally {setup.release(true);}
    for(let i=0;i<2;i++) {
      const raw=await pool.connect();await raw.query("begin");
      await raw.query("set local statement_timeout='10s'; set local lock_timeout='5s'");
      clients.push(guardRollbackQueries(raw,context.signal));
    }
  },120000);
  afterEach(async()=>{
    try {await rollbackReservationTransactions(clients);}
    finally {
      try {if(pool)await pool.end();if(baseline)expect(await reservationSnapshot(source)).toEqual(baseline);}
      finally {if(created)await target.dropTemporary(source,name);}
    }
  });
  afterAll(async()=>{try{if(baseline)expect(await reservationSnapshot(source)).toEqual(baseline);}
    finally{await target.release();if(source)await source.end();}});
  it.each(["reserve-reserve","reserve-debit","debit-debit","reserve-release","reserve-cancel","cancel-reserve","release-cancel"])(
    "%s observes the committed winner without duplicate or partial effects",async kind=>{
      const [a,b]=clients.map(t=>t.client) as [PoolClient,PoolClient];
      const project=projects[0]!;
      if(kind==="reserve-release"||kind==="release-cancel") {
        await reservation(a,project,kind==="release-cancel"?2:1);await a.query("commit; begin");
      }
      const debit=(db:PoolClient,qty:string|number)=>rpc(db,
        "select * from public.adjust_inventory_warehouse($1,$2,'remove',$3::bigint,'Committed local race',null)",[product.id,fg,qty]);
      if(kind==="debit-debit") await debit(a,product.quantity);
      else if(kind==="cancel-reserve") await rpc(a,"select public.cancel_project($1)",[project]);
      else if(kind==="release-cancel") await release(a,project,1,1);
      else await reservation(a,project,kind==="reserve-release"?1:product.quantity,kind==="reserve-release"?1:0);
      const aPid=(await a.query("select pg_backend_pid() pid")).rows[0].pid;
      const bPid=(await b.query("select pg_backend_pid() pid")).rows[0].pid;
      const pending=(kind==="reserve-reserve"?reservation(b,projects[1]!,product.quantity)
        :kind==="reserve-release"?release(b,project,1,1)
        :kind.endsWith("cancel")?rpc(b,"select public.cancel_project($1)",[project])
        :kind==="cancel-reserve"?reservation(b,project,1):debit(b,1))
        .then(rows=>({rows,error:undefined}),error=>({rows:undefined,error}));
      let blocked=false;
      for(let i=0;i<150;i++) {
        if((await pool.query("select $2=any(pg_blocking_pids($1)) blocked",[bPid,aPid])).rows[0].blocked){blocked=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(blocked).toBe(true);await a.query("commit");
      const outcome=await pending;
      if(kind.endsWith("cancel")) {expect(outcome.error).toBeUndefined();await b.query("commit");}
      else {expect(outcome.error).toMatchObject({code:kind==="reserve-reserve"?"FGR07":kind==="reserve-release"?"FGR04":kind==="cancel-reserve"?"FGR02":"IVB02"});await b.query("rollback");}
      const state=(await pool.query(`select coalesce(sum(reserved_quantity),0)::text reserved,count(*)::int states
        from public.finished_goods_project_reservations where product_id=$1`,[product.id])).rows[0];
      expect(state.reserved).toBe(kind.includes("cancel")?"0":kind==="debit-debit"?"0":kind==="reserve-release"?"2":product.quantity);
      expect((await pool.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[product.id,fg])).rows[0].q)
        .toBe(kind==="debit-debit"?"0":product.quantity);
      const events=(await pool.query("select count(*)::int n,count(distinct request_id)::int requests from public.finished_goods_project_reservation_events where product_id=$1",[product.id])).rows[0];
      const expected=kind==="debit-debit"||kind==="cancel-reserve"?0:kind==="release-cancel"?3:kind==="reserve-release"||kind==="reserve-cancel"?2:1;
      expect(events).toEqual({n:expected,requests:expected});
    },30000);
  it.skipIf(process.env.FG_RESERVATION_FULFILLMENT_LOCAL!=="1").each([
    "fulfill-fulfill","identical-replay","fulfill-release","release-fulfill",
    "fulfill-cancel","cancel-fulfill","fulfill-transfer","fulfill-adjustment","fulfill-generic","fulfill-pcb",
  ])("%s preserves the committed fulfillment winner and ledger",async kind=>{
    const [a,b]=clients.map(t=>t.client) as [PoolClient,PoolClient],project=projects[0]!;
    const reservationId=(await reservation(a,project,2))[0].reservation_id;
    await a.query("commit; begin");
    const request=[reservationId,project,product.id,1,1,randomUUID()];
    const fulfillment=(db:PoolClient)=>rpc(db,
      "select * from public.fulfill_finished_goods_project_reservation($1,$2,$3,$4::bigint,$5::bigint,$6)",
      db===a||kind==="identical-replay"?request:[...request.slice(0,5),randomUUID()],true);
    let finishArgs:unknown[]|undefined;
    if(kind==="fulfill-generic"||kind==="fulfill-pcb") {
      const input=(await b.query(`select (sum(quantity::numeric)-1)::text q from public.inventory_balances
        where product_id=$1 and (not $2::boolean or warehouse_id=$3)`,
        [product.id,process.env.FG_ACCOUNTING_LOCAL==="1",fg])).rows[0].q;
      let work:string;
      if(kind==="fulfill-pcb") {
        const serial=(await b.query(`select lpad(s::text,3,'0') serial from generate_series(0,999) s
          where not exists(select 1 from public.products where serial_number=lpad(s::text,3,'0')) order by s limit 1`)).rows[0].serial;
        const card=(await rpc(b,"select * from public.create_pcb_card($1,$2)",[`Fulfillment race ${randomUUID()}`,serial]))[0].pcb_card_id;
        await rpc(b,"select * from public.save_initial_pcb_bom($1,$2::jsonb)",[card,JSON.stringify([{product_id:product.id,quantity_per_card:"1"}])]);
        work=(await rpc(b,"select * from public.create_pcb_production_work_order($1,$2,null,$3)",[card,input,randomUUID()]))[0].work_order_id;
      } else {
        work=randomUUID();
        const number=(await b.query(`select 'RN-8990-'||lpad(s::text,4,'0') n from generate_series(1,9999) s
          where not exists(select 1 from public.work_orders where work_order_number='RN-8990-'||lpad(s::text,4,'0')) order by s limit 1`)).rows[0].n;
        await b.query(`insert into public.work_orders(id,work_order_number,project_id,customer_name_snapshot,description,created_by_user_id,updated_by_user_id)
          values($1,$2,$3,'Local','Fulfillment race',$4,$4)`,[work,number,projects[1],actor.id]);
        await b.query("insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id) values($1,$2,$3::bigint,$4)",[work,product.id,input,actor.id]);
      }
      const stamp=(await b.query("select updated_at::text stamp from public.work_orders where id=$1",[work])).rows[0].stamp;
      const path=`final/${work}/${randomUUID()}.pdf`;
      await b.query("insert into storage.objects(bucket_id,name,metadata) values('work-order-pdfs',$1,jsonb_build_object('mimetype','application/pdf'))",[path]);
      finishArgs=[work,stamp,path,"a".repeat(64),"0".repeat(32)];
    }
    let first:Record<string,unknown>[]|undefined;
    if(kind==="cancel-fulfill")await rpc(a,"select public.cancel_project($1)",[project]);
    else if(kind==="release-fulfill")await release(a,project,1,1);
    else first=await fulfillment(a);
    const aPid=(await a.query("select pg_backend_pid() pid")).rows[0].pid,bPid=(await b.query("select pg_backend_pid() pid")).rows[0].pid;
    const pending=(kind==="fulfill-release"?release(b,project,1,1)
      :kind==="fulfill-cancel"?rpc(b,"select public.cancel_project($1)",[project])
      :kind==="fulfill-transfer"?rpc(b,"select * from public.transfer_inventory_between_warehouses($1,$2,$3,$4::bigint,'Fulfillment race')",[product.id,fg,raw,(BigInt(product.quantity)-1n).toString()])
      :kind==="fulfill-adjustment"?rpc(b,"select * from public.adjust_inventory_warehouse($1,$2,'correction',0,'Fulfillment race',null)",[product.id,fg])
      :finishArgs?rpc(b,`select * from public.finish_work_order($1,$2::timestamptz,$3,$4,$5${kind==="fulfill-pcb"?",'1'":""})`,finishArgs)
      :fulfillment(b)).then(rows=>({rows,error:undefined}),error=>({rows:undefined,error}));
    let blocked=false;
    for(let i=0;i<150;i++){
      if((await pool.query("select $2=any(pg_blocking_pids($1)) blocked",[bPid,aPid])).rows[0].blocked){blocked=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    expect(blocked).toBe(true);await a.query("commit");const outcome=await pending;
    if(kind==="identical-replay"||kind==="fulfill-cancel") {
      expect(outcome.error).toBeUndefined();if(kind==="identical-replay")expect(outcome.rows).toEqual(first);await b.query("commit");
    }else{
      expect(outcome.error).toMatchObject({code:kind==="cancel-fulfill"?"FGR02":kind==="fulfill-fulfill"||kind==="fulfill-release"||kind==="release-fulfill"?"FGR04":"IVB02"});
      await b.query("rollback");
    }
    const completed=kind!=="cancel-fulfill"&&kind!=="release-fulfill";
    expect((await pool.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[product.id,fg])).rows[0].q)
      .toBe((BigInt(product.quantity)-(completed?1n:0n)).toString());
    expect((await pool.query("select count(*)::int n,sum(-quantity_delta)::text q from public.inventory_movements where product_id=$1 and source_type='finished_goods_reservation_fulfillment'",[product.id])).rows[0])
      .toEqual({n:completed?1:0,q:completed?"1":null});
    expect((await pool.query("select reserved_quantity::text q from public.finished_goods_project_reservations where id=$1",[reservationId])).rows[0].q)
      .toBe(kind.includes("cancel")?"0":"1");
    expect((await pool.query("select count(*)::int n from public.finished_goods_project_reservation_events where reservation_id=$1 and event_type='fulfilled'",[reservationId])).rows[0].n).toBe(completed?1:0);
  },30000);
});
