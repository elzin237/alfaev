import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { PERMISSION_KEYS } from "../../app/auth/permissions";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { LOCAL_RESERVATION, LocalReservationPool, ReservationLocalTarget,
  reservationSnapshot, rollbackReservationTransactions } from "./helpers/reservation-local-target";

const migration = readFileSync("supabase/migrations/20261023100000_add_finished_goods_project_reservation_foundation.sql", "utf8");
const readEnabled = process.env.FG_RESERVATION_READ_LOCAL === "1";
const fulfillmentEnabled = process.env.FG_RESERVATION_FULFILLMENT_LOCAL === "1" || readEnabled;
const protectionEnabled = process.env.FG_HARD_RESERVATION_PROTECTION_LOCAL === "1" || fulfillmentEnabled;
const protection = readFileSync("supabase/migrations/20261023110000_protect_finished_goods_hard_reservations.sql", "utf8");
const fulfillment = readFileSync("supabase/migrations/20261023120000_add_finished_goods_reservation_fulfillment.sql", "utf8");
const fg = "10000000-0000-4000-8000-000000000002";
const reserve = "select * from public.reserve_finished_goods_for_project($1,$2,$3::bigint,$4::bigint,$5)";
const release = "select * from public.release_finished_goods_project_reservation($1,$2,$3::bigint,$4::bigint,$5)";

// Hard-coded loopback only. Apply DDL and ALL fixture changes inside the same
// rolled-back transaction; no remote harness, Auth API, migration commit or reset.
describe.skipIf(process.env.FG_RESERVATION_FOUNDATION_LOCAL !== "1")("Phase 3A local rollback-only foundation", () => {
  const target = new ReservationLocalTarget();
  const databaseName=`alfaev_fg_3b1_${randomUUID().replace(/-/g,"")}`;
  let source: LocalReservationPool, sourceBaseline: unknown, created=false;
  let pool: LocalReservationPool, db: PoolClient;
  let actor: { profileId: string; authUserId: string };
  let baseline: unknown;
  let transaction: ReturnType<typeof guardRollbackQueries> | undefined;

  const snapshot = reservationSnapshot;
  async function call(sql: string, args: unknown[] = [], role = "postgres") {
    if (!["postgres", "authenticated", "anon", "service_role"].includes(role)) throw new Error("Unsafe role");
    await db.query("savepoint attempt");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [role === "anon" ? "" : actor.authUserId]);
      await db.query(`set local role ${role}`);
      const rows = (await db.query(sql, args)).rows;
      await db.query("reset role");
      await db.query("release savepoint attempt");
      return rows;
    } catch (error) {
      await db.query("rollback to savepoint attempt");
      await db.query("release savepoint attempt");
      throw error;
    }
  }
  async function fixture(quantity = 10) {
    const product = randomUUID(), card = randomUUID(), project = randomUUID(), group = randomUUID();
    if (product === LOCAL_RESERVATION.residue) throw new Error("Retained residue cannot be a fixture");
    const serial = (await db.query(`select s::text serial from generate_series(8000000,8999999) s
      where not exists(select 1 from public.products where serial_number=s::text) order by s limit 1`)).rows[0].serial;
    await db.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,'PCB','pcb_finished_good',$4,$4)`, [product, serial, `FG ${product}`, actor.profileId]);
    await db.query(`insert into public.pcb_cards(id,name,output_product_id,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,$4,$4)`, [card, `FG ${card}`, product, actor.profileId]);
    const source = await createSupplierSourceFixture(db, actor, product);
    await db.query("reset role");
    await call("select * from public.adjust_inventory_warehouse($1,$2,'add',10,'Local foundation proof',$3)",
      [product, fg, source.productSupplierId], "authenticated");
    await db.query(`insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id)
      values($1,$2,'Local','2026-10-23','2026-11-23',$3,$3)`, [project, `FG ${project}`, actor.profileId]);
    await db.query(`insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id)
      values($1,$2,'Not an inferred output identity',$3,$3)`, [group, project, actor.profileId]);
    if (quantity > 0) await db.query(`insert into public.project_product_components(project_product_id,product_id,
      required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,$3,$4,$4)`, [group, product, quantity, actor.profileId]);
    return { project, product, group, card, source: source.productSupplierId };
  }

  async function work(product: string, quantity: number, project: string | null = null) {
    if (project === null) {
      project = randomUUID();
      await db.query(`insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id)
        values($1,$2,'Local','2026-10-23','2026-11-23',$3,$3)`,[project,`Unrelated demand ${project}`,actor.profileId]);
    }
    const id = randomUUID();
    const number = (await db.query(`select 'RN-8992-'||lpad(s::text,4,'0') n from generate_series(1,9999) s
      where not exists(select 1 from public.work_orders where work_order_number='RN-8992-'||lpad(s::text,4,'0')) order by s limit 1`)).rows[0].n;
    await db.query(`insert into public.work_orders(id,work_order_number,project_id,customer_name_snapshot,
      description,created_by_user_id,updated_by_user_id) values($1,$2,$3,'Local','Reservation protection proof',$4,$4)`,[id,number,project,actor.profileId]);
    await db.query("insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id) values($1,$2,$3,$4)",[id,product,quantity,actor.profileId]);
    return id;
  }
  async function finishArgs(id: string, fingerprint?: string) {
    const updated = (await db.query("select updated_at::text stamp from public.work_orders where id=$1",[id])).rows[0].stamp;
    const path = `final/${id}/${randomUUID()}.pdf`;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('work-order-pdfs',$1,jsonb_build_object('mimetype','application/pdf'))",[path]);
    const fp = fingerprint ?? (await db.query("select public.get_work_order_source_allocation_fingerprint($1) fp",[id])).rows[0].fp;
    return [id,updated,path,"a".repeat(64),fp];
  }
  const finishSql = "select * from public.finish_work_order($1,$2::timestamptz,$3,$4,$5)";
  async function quantity(product: string) {
    return (await db.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[product,fg])).rows[0].q;
  }

  beforeAll(async () => {
    source = target.pool();
    await target.acquire(source);
    sourceBaseline=await snapshot(source);
    await target.createTemporary(source,databaseName);
    created=true;
    target.copyIntoTemporary(databaseName);
    pool = target.pool(databaseName);
    const client = await pool.connect();
    try {
      expect((await client.query("select current_database() db, inet_server_port() port")).rows[0])
        .toMatchObject({ db: databaseName, port: process.env.LOCAL_SUPABASE_DB_PASSWORD?5432:null });
      expect((await client.query("select count(*)::int n,max(version) latest from supabase_migrations.schema_migrations")).rows[0])
        .toEqual({ n: 142, latest: "20261022150000" });
      const row = (await client.query(`select id,auth_user_id from public.user_profiles where is_admin and is_active order by id limit 1`)).rows[0];
      if (!row) throw new Error("Existing disposable local Admin required; no reset or Auth creation");
      actor = { profileId: row.id, authUserId: row.auth_user_id };
      baseline = await snapshot(client);
    } finally { client.release(); }
  });
  beforeEach(async context => {
    await target.assertQuiet();
    const raw = await pool.connect();
    await raw.query("begin");
    transaction = guardRollbackQueries(raw, context.signal);
    db = transaction.client;
    await db.query("set local statement_timeout='15s'");
    await db.query("set local lock_timeout='3s'");
    if (!context.task.name.startsWith("migration proof:")) {
      await db.query(migration);
      if (protectionEnabled) await db.query(protection);
      if (fulfillmentEnabled) await db.query(fulfillment);
      if (readEnabled) await db.query(readFileSync("supabase/migrations/20261023130000_add_project_finished_goods_reservation_context.sql", "utf8"));
    }
  });
  afterEach(async () => {
    let rollbackError: unknown;
    if (transaction) {
      const current = transaction;
      transaction = undefined;
      try { await rollbackReservationTransactions([current]); } catch (error) { rollbackError=error; }
    }
    // Fresh checked connection verifies the original baseline, residue included,
    // even when rollback failed. A rollback error can never become a PASS.
    try {
      if (baseline) { const c=await pool.connect(); try { expect(await snapshot(c)).toEqual(baseline); } finally { c.release(); } }
    } finally { if (rollbackError) throw rollbackError; }
  });
  afterAll(async () => {
    try { if (pool && baseline) { const c = await pool.connect(); try { expect(await snapshot(c)).toEqual(baseline); } finally { c.release(); } } }
    finally {
      try {
        if(pool) await pool.end();
        if(source && sourceBaseline) expect(await snapshot(source)).toEqual(sourceBaseline);
        if(created) await target.dropTemporary(source,databaseName);
      } finally { await target.release(); if(source) await source.end(); }
    }
  });

  it.skipIf(!protectionEnabled)("migration proof: fresh application schema 0 -> 144 on the disposable clone",async()=>{
    expect((await db.query("select current_database() db")).rows[0].db).toBe(databaseName);
    // Platform auth/storage/realtime remain installed, like a fresh Supabase stack.
    // Only this owned clone's application schema is rebuilt, inside ROLLBACK.
    await db.query("drop schema public cascade; create schema public; grant usage on schema public to postgres,anon,authenticated,service_role; drop schema supabase_migrations cascade; create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text)");
    // A fresh platform has no copied Auth users or application Storage buckets.
    // This is transactional and ONLY on the verified disposable clone.
    await db.query("truncate auth.users cascade; truncate storage.buckets cascade");
    // Copied application policies on platform tables must not pre-exist their
    // migration. A fresh platform has no application Storage/Broadcast policies.
    await db.query(`do $fresh$ declare p record; begin
      for p in select schemaname,tablename,policyname from pg_policies where schemaname in ('storage','realtime') loop
        execute format('drop policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);
      end loop; end $fresh$`);
    const paths=readdirSync("supabase/migrations").filter(p=>/^\d{14}_.+\.sql$/.test(p) && p.slice(0,14)<="20261023110000").sort();
    expect(paths).toHaveLength(144);
    for(const path of paths) {
      await db.query(readFileSync(`supabase/migrations/${path}`,"utf8"));
      await db.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)",[path.slice(0,14),path.slice(15,-4)]);
    }
    expect((await db.query("select count(*)::int n,max(version) latest from supabase_migrations.schema_migrations")).rows[0])
      .toEqual({n:144,latest:"20261023110000"});
    expect((await db.query("select count(*)::int n from public.finished_goods_project_reservations")).rows[0].n).toBe(0);
    await db.query("set constraints all immediate");
  });
  it.skipIf(!protectionEnabled)("migration proof: existing 142 -> only 143 -> only 144",async()=>{
    expect((await db.query("select count(*)::int n,max(version) latest from supabase_migrations.schema_migrations")).rows[0])
      .toEqual({n:142,latest:"20261022150000"});
    for(const [sql,version,count] of [[migration,"20261023100000",143],[protection,"20261023110000",144]] as const) {
      await db.query(sql);
      await db.query("insert into supabase_migrations.schema_migrations(version) values($1)",[version]);
      expect((await db.query("select count(*)::int n,max(version) latest from supabase_migrations.schema_migrations")).rows[0])
        .toEqual({n:count,latest:version});
      expect((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and prosecdef and proname<>'rls_auto_enable'")).rows[0].n)
        .toBe(count===143?179:182);
    }
    await db.query("set constraints all immediate");
  });

  it("applies cleanly, fixes the warehouse, and exposes no mutation/table access", async () => {
    expect((await db.query("select key from public.permission_definitions where is_delegable order by key")).rows.map(r=>r.key))
      .toEqual([...PERMISSION_KEYS].sort());
    const metadata = (await db.query(`select proname,prosecdef,proconfig,
      has_function_privilege('authenticated',oid,'execute') browser,
      has_function_privilege('anon',oid,'execute') anon,
      has_function_privilege('public',oid,'execute') public,
      has_function_privilege('service_role',oid,'execute') service from pg_proc
      where pronamespace='public'::regnamespace and proname in (
        'change_finished_goods_project_reservation','reserve_finished_goods_for_project',
        'release_finished_goods_project_reservation','list_project_finished_goods_reservations',
        'list_project_finished_goods_reservation_events')`)).rows;
    expect(metadata).toHaveLength(5);
    for (const row of metadata) {
      expect(row).toMatchObject({ prosecdef: true, proconfig: ['search_path=""'], anon: false, public: false, service: false,
        browser: row.proname.startsWith("list_") });
    }
    expect((await db.query(`select count(*)::int n from pg_proc where pronamespace='public'::regnamespace
      and prosecdef and proname <> 'rls_auto_enable'`)).rows[0].n).toBe(readEnabled ? 185 : fulfillmentEnabled ? 184 : protectionEnabled ? 182 : 179);
    for (const role of ["authenticated", "anon", "service_role"]) {
      await expect(call(reserve, [randomUUID(),randomUUID(),1,0,randomUUID()], role)).rejects.toMatchObject({code:"42501"});
      for (const table of ["finished_goods_project_reservations","finished_goods_project_reservation_events"]) {
        await expect(call(`select * from public.${table}`, [], role)).rejects.toMatchObject({code:"42501"});
        await expect(call(`insert into public.${table} default values`,[],role)).rejects.toMatchObject({code:"42501"});
        await expect(call(`delete from public.${table}`,[],role)).rejects.toMatchObject({code:"42501"});
        const field=table.endsWith("_events")?"quantity_after":"reserved_quantity";
        await expect(call(`update public.${table} set ${field}=0`,[],role)).rejects.toMatchObject({code:"42501"});
        expect((await db.query("select relrowsecurity enabled from pg_class where oid=$1::regclass", [`public.${table}`])).rows[0].enabled).toBe(true);
      }
    }
  });
  it("uses only explicit demand, with no inferred demand from the group/Card", async () => {
    const f = await fixture(0);
    await expect(call(reserve,[f.project,f.product,1,0,randomUUID()])).rejects.toMatchObject({code:"FGR06"});
    expect((await db.query("select count(*)::int n from public.finished_goods_project_reservations")).rows[0].n).toBe(0);
  });
  it("preserves the full trusted-function search-path and PUBLIC/anon boundary",async()=>{
    const functions=(await db.query(`select proname,proconfig,
      has_function_privilege('public',oid,'execute') public,
      has_function_privilege('anon',oid,'execute') anon
      from pg_proc where pronamespace='public'::regnamespace and prosecdef and proname<>'rls_auto_enable'`)).rows;
    expect(functions).toHaveLength(readEnabled?185:fulfillmentEnabled?184:protectionEnabled?182:179);
    for(const row of functions) expect(row).toMatchObject({proconfig:['search_path=""'],public:false,anon:false});
  });
  it("bounds demand and FG stock independently and rejects double allocation/stale versions", async () => {
    const f = await fixture(30);
    await expect(call(reserve,[f.project,f.product,11,0,randomUUID()])).rejects.toMatchObject({code:"FGR07"});
    await db.query("update public.project_product_components set required_quantity=6 where project_product_id=$1", [f.group]);
    await expect(call(reserve,[f.project,f.product,7,0,randomUUID()])).rejects.toMatchObject({code:"FGR06"});
    const result = await call(reserve,[f.project,f.product,6,0,randomUUID()]);
    expect(result[0]).toMatchObject({reserved_quantity:"6",reservation_version:"1"});
    await expect(call(reserve,[f.project,f.product,1,0,randomUUID()])).rejects.toMatchObject({code:"FGR04"});
    await expect(call(reserve,[f.project,f.product,1,1,randomUUID()])).rejects.toMatchObject({code:"FGR06"});
  });
  it("replays immutable receipts exactly and never increments twice", async () => {
    const f = await fixture(), request = randomUUID();
    const args = [f.project,f.product,4,0,request];
    const first = await call(reserve,args);
    expect(await call(reserve,args)).toEqual(first);
    await expect(call(reserve,[f.project,f.product,5,0,request])).rejects.toMatchObject({code:"FGR01"});
    expect((await db.query("select count(*)::int n from public.finished_goods_project_reservation_events")).rows[0].n).toBe(1);
    expect((await db.query("select quantity from public.inventory_balances where product_id=$1 and warehouse_id=$2",[f.product,fg])).rows[0].quantity).toBe("10");
  });
  it("rolls back state, receipt and audit together and exposes only narrow Project-owned reads", async () => {
    const f = await fixture();
    const before = (await db.query("select count(*)::text n from public.audit_logs")).rows[0].n;
    await db.query("savepoint reservation_operation");
    await call(reserve,[f.project,f.product,4,0,randomUUID()]);
    const rows = await call("select * from public.list_project_finished_goods_reservations($1)",[f.project],"authenticated");
    expect(Object.keys(rows[0]).sort()).toEqual(["reservation_id","product_id","reserved_quantity","reservation_version","updated_at"].sort());
    expect(await call("select * from public.list_project_finished_goods_reservations($1)",[randomUUID()],"authenticated")).toEqual([]);
    const events = await call("select * from public.list_project_finished_goods_reservation_events($1)",[f.project],"authenticated");
    expect(Object.keys(events[0]).sort()).toEqual(["event_id","reservation_id","product_id","event_type","quantity_before","quantity_after","reservation_version","created_at"].sort());
    await db.query("rollback to savepoint reservation_operation");
    expect((await db.query("select count(*)::int n from public.finished_goods_project_reservations")).rows[0].n).toBe(0);
    expect((await db.query("select count(*)::int n from public.finished_goods_project_reservation_events")).rows[0].n).toBe(0);
    expect((await db.query("select count(*)::text n from public.audit_logs")).rows[0].n).toBe(before);
  });
  it("waits on the shared FG balance lock and resumes after the other transaction rolls back", async () => {
    // Use an existing local output solely for a row lock: no committed fixture is
    // needed. The demand and any resulting reservation are in this test transaction.
    const existing = (await db.query(`select p.id,b.quantity from public.products p
      join public.pcb_cards c on c.output_product_id=p.id
      join public.inventory_balances b on b.product_id=p.id and b.warehouse_id=$1
      where p.is_active and p.id<>$2 order by p.id limit 1`,[fg,LOCAL_RESERVATION.residue])).rows[0];
    if (!existing) throw new Error("Existing disposable output required for lock proof");
    const project = randomUUID(), group = randomUUID();
    await db.query(`insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id)
      values($1,'Local lock proof','Local','2026-10-23','2026-11-23',$2,$2)`,[project,actor.profileId]);
    await db.query(`insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id)
      values($1,$2,'Explicit existing Product demand',$3,$3)`,[group,project,actor.profileId]);
    await db.query(`insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id)
      values($1,$2,1,$3,$3)`,[group,existing.id,actor.profileId]);
    const holder = await pool.connect(), observer = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await holder.query("begin");
      await holder.query("select 1 from public.inventory_balances where product_id=$1 and warehouse_id=$2 for update",[existing.id,fg]);
      const pid = (await db.query("select pg_backend_pid() pid")).rows[0].pid;
      pending = call(reserve,[project,existing.id,1,0,randomUUID()]).then(rows=>({rows}),error=>({error}));
      let blocked = false;
      for (let attempt=0;attempt<100;attempt++) {
        blocked = (await observer.query("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock') blocked",[pid])).rows[0].blocked;
        if (blocked) break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(blocked).toBe(true);
      await holder.query("rollback");
      const result = await pending as {rows?: Record<string,unknown>[];error?: {code:string}};
      if (BigInt(existing.quantity)>0n) expect(result.rows?.[0]?.reserved_quantity).toBe("1");
      else expect(result.error?.code).toBe("FGR07");
    } finally {
      await holder.query("rollback");
      if (pending) await pending;
      holder.release();observer.release();
    }
  });
  it("releases without stock mutation and protects archived Products and immutable events", async () => {
    const f = await fixture();
    await call(reserve,[f.project,f.product,4,0,randomUUID()]);
    await db.query("update public.products set is_active=false,archived_at=now(),archived_by_user_id=$2 where id=$1",[f.product,actor.profileId]);
    await expect(call(reserve,[f.project,f.product,1,1,randomUUID()])).rejects.toMatchObject({code:"FGR03"});
    expect((await call(release,[f.project,f.product,4,1,randomUUID()]))[0].reserved_quantity).toBe("0");
    await expect(call("update public.finished_goods_project_reservation_events set quantity_after=0")).rejects.toMatchObject({code:"55000"});
    await expect(call("delete from public.finished_goods_project_reservations")).rejects.toMatchObject({code:"55000"});
    expect((await db.query("select quantity from public.inventory_balances where product_id=$1 and warehouse_id=$2",[f.product,fg])).rows[0].quantity).toBe("10");
  });
  it("denies inactive and anonymous reads and requires both Project and FG view", async () => {
    const f = await fixture();
    expect(await call("select * from public.list_project_finished_goods_reservations($1)",[f.project],"authenticated")).toEqual([]);
    await expect(call("select * from public.list_project_finished_goods_reservations($1)",[f.project],"anon")).rejects.toMatchObject({code:"42501"});
    const nonadmin = (await db.query("select id,auth_user_id from public.user_profiles where not is_admin and is_active order by id limit 1")).rows[0];
    if (!nonadmin) throw new Error("Existing disposable local non-Admin required");
    const admin = actor;
    actor = {profileId:nonadmin.id,authUserId:nonadmin.auth_user_id};
    try {
      await db.query("delete from public.user_permissions where user_id=$1",[actor.profileId]);
      await expect(call("select * from public.list_project_finished_goods_reservations($1)",[f.project],"authenticated")).rejects.toMatchObject({code:"42501"});
      await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
        select $1,id,$2 from public.permission_definitions where key in ('projects.view','inventory.finished_goods.view')`,[actor.profileId,admin.profileId]);
      expect(await call("select * from public.list_project_finished_goods_reservations($1)",[f.project],"authenticated")).toEqual([]);
      await expect(call(reserve,[f.project,f.product,1,0,randomUUID()])).rejects.toMatchObject({code:"42501"});
      await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
        select $1,id,$2 from public.permission_definitions where key in ('projects.edit','inventory.finished_goods.reserve')`,[actor.profileId,admin.profileId]);
      // Owner-only harness invocation tests the internal business authorization;
      // even this fully permitted user still has no browser mutation EXECUTE.
      const request=randomUUID(), args=[f.project,f.product,1,0,request];
      const receipt=await call(reserve,args);
      expect(receipt[0].reserved_quantity).toBe("1");
      await expect(call(reserve,args,"authenticated")).rejects.toMatchObject({code:"42501"});
      actor=admin;
      await expect(call(reserve,args)).rejects.toMatchObject({code:"42501"});
    } finally {actor=admin;}
    await db.query("update public.user_profiles set is_active=false where id=$1",[actor.profileId]);
    await expect(call("select * from public.list_project_finished_goods_reservations($1)",[f.project],"authenticated")).rejects.toMatchObject({code:"42501"});
  });

  describe.skipIf(!protectionEnabled)("Phase 3B1 trusted debit and lifecycle protection", () => {
    it("keeps all new guard functions private and preserves mutation ACLs", async () => {
      const rows = (await db.query(`select proname,prosecdef,proconfig,
        has_function_privilege('authenticated',oid,'execute') browser,
        has_function_privilege('anon',oid,'execute') anon,
        has_function_privilege('public',oid,'execute') public,
        has_function_privilege('service_role',oid,'execute') service from pg_proc
        where pronamespace='public'::regnamespace and proname in
        ('protect_finished_goods_reserved_stock','protect_finished_goods_reservation_demand',
        'protect_finished_goods_reservation_project_lifecycle')`)).rows;
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(row).toMatchObject({prosecdef:true,proconfig:['search_path=""'],browser:false,anon:false,public:false,service:false});
    });
    it.each(["remove","correction","transfer"])("rejects %s taking reserved stock, with no partial effects", async kind => {
      const f = await fixture();
      await call(reserve,[f.project,f.product,6,0,randomUUID()]);
      const before = await snapshot(db);
      if (kind === "transfer") await expect(call("select * from public.transfer_inventory_between_warehouses($1,$2,$3,5,'Local protection')",
        [f.product,fg,"10000000-0000-4000-8000-000000000001"] ,"authenticated")).rejects.toMatchObject({code:"IVB02"});
      else await expect(call("select * from public.adjust_inventory_warehouse($1,$2,$3,5,'Local protection',null)",
        [f.product,fg,kind],"authenticated")).rejects.toMatchObject({code:"IVB02"});
      expect(await snapshot(db)).toEqual(before);
      await call("select * from public.adjust_inventory_warehouse($1,$2,'remove',4,'Unreserved remainder',null)",[f.product,fg],"authenticated");
      expect(await quantity(f.product)).toBe("6");
      expect((await db.query("select public.get_production_eligible_quantity($1)::text q",[f.product])).rows[0].q).toBe("0");
    });
    it("uses unreserved stock in generic preflight, plan, fingerprint, snapshot and atomic Finish", async () => {
      const f = await fixture();
      await call(reserve,[f.project,f.product,6,0,randomUUID()]);
      const blocked = await work(f.product,5);
      const stamp = (await db.query("select updated_at::text stamp from public.work_orders where id=$1",[blocked])).rows[0].stamp;
      const preflight = await call("select inventory_sufficient,available_quantity::text,missing_quantity::text from public.preflight_finish_work_order($1,$2::timestamptz)",[blocked,stamp],"authenticated");
      expect(preflight[0]).toMatchObject({inventory_sufficient:false,available_quantity:"4",missing_quantity:"1"});
      await expect(call(finishSql,await finishArgs(blocked,"0".repeat(32)),"authenticated")).rejects.toMatchObject({code:"IVB02"});
      expect(await quantity(f.product)).toBe("10");
      expect((await db.query("select status from public.work_orders where id=$1",[blocked])).rows[0].status).toBe("draft");
      const usable = await work(f.product,4);
      const args = await finishArgs(usable);
      expect(args[4]).toMatch(/^[0-9a-f]{32}$/);
      const pdf = await call("select allocation_fingerprint from public.get_work_order_pdf_snapshot($1,$2::timestamptz)",args.slice(0,2),"authenticated");
      expect(pdf[0].allocation_fingerprint).toBe(args[4]);
      const finished = await call(finishSql,args,"authenticated");
      expect(finished).toHaveLength(1);
      const afterFinish = await snapshot(db);
      await expect(call(finishSql,args,"authenticated")).rejects.toMatchObject({code:"WOR02"});
      expect(await snapshot(db)).toEqual(afterFinish);
      expect(await quantity(f.product)).toBe("6");
      expect((await db.query("select reserved_quantity::text q from public.finished_goods_project_reservations where product_id=$1",[f.product])).rows[0].q).toBe("6");
      await db.query("set constraints all immediate");
    });
    it("preserves Raw -> Customs -> unreserved FG FIFO and fingerprint rows", async () => {
      const f = await fixture();
      await call(reserve,[f.project,f.product,6,0,randomUUID()]);
      for (const [warehouse,n] of [["10000000-0000-4000-8000-000000000001",3],["10000000-0000-4000-8000-000000000003",2]])
        await call("select * from public.adjust_inventory_warehouse($1,$2,'add',$3::bigint,'Mixed priority',$4)",[f.product,warehouse,n,f.source],"authenticated");
      const id = await work(f.product,8);
      const plan = await call("select warehouse_code,allocated_quantity::text from public.get_work_order_warehouse_source_allocation_plan($1)",[id]);
      expect(plan).toEqual([{warehouse_code:"raw_materials",allocated_quantity:"3"},{warehouse_code:"customs",allocated_quantity:"2"},{warehouse_code:"finished_goods",allocated_quantity:"3"}]);
      await call(finishSql,await finishArgs(id),"authenticated");
      expect(await quantity(f.product)).toBe("7");
      await db.query("set constraints all immediate");
    });
    it("blocks PCB inputs taking reserved FG, then consumes only unreserved inputs and credits actual-good output", async () => {
      const input = await fixture(), output = await fixture(0);
      await call(reserve,[input.project,input.product,6,0,randomUUID()]);
      await call("select * from public.save_initial_pcb_bom($1,$2::jsonb)",[output.card,JSON.stringify([{product_id:input.product,quantity_per_card:"1"}])],"authenticated");
      const blocked = (await call("select * from public.create_pcb_production_work_order($1,'5',null,$2)",[output.card,randomUUID()],"authenticated"))[0].work_order_id;
      const args = await finishArgs(blocked,"0".repeat(32));
      await expect(call("select * from public.finish_work_order($1,$2::timestamptz,$3,$4,$5,'4')",args,"authenticated")).rejects.toMatchObject({code:"IVB02"});
      const usable = (await call("select * from public.create_pcb_production_work_order($1,'4',null,$2)",[output.card,randomUUID()],"authenticated"))[0].work_order_id;
      await call("select * from public.finish_work_order($1,$2::timestamptz,$3,$4,$5,'3')",await finishArgs(usable),"authenticated");
      expect(await quantity(input.product)).toBe("6");
      expect(await quantity(output.product)).toBe("13");
      await db.query("set constraints all immediate");
    });
    it("rejects invalid requirement edits/removal and same-Project consumption without reducing the plan", async () => {
      const f = await fixture();
      await call(reserve,[f.project,f.product,6,0,randomUUID()]);
      const id = (await db.query("select id from public.project_product_components where project_product_id=$1",[f.group])).rows[0].id;
      await expect(call("select public.update_project_product_component($1,$2,5)",[id,f.product],"authenticated")).rejects.toMatchObject({code:"FGR06"});
      await expect(call("select public.remove_project_product_component($1)",[id],"authenticated")).rejects.toMatchObject({code:"FGR06"});
      await call("select public.update_project_product_component($1,$2,6)",[id,f.product],"authenticated");
      const wo = await work(f.product,1,f.project);
      await expect(call(finishSql,await finishArgs(wo),"authenticated")).rejects.toMatchObject({code:"FGR06"});
      expect(await quantity(f.product)).toBe("10");
      expect((await db.query("select required_quantity::text q from public.project_product_components where id=$1",[id])).rows[0].q).toBe("6");
    });
    it("cancels atomically, retains one immutable release receipt, and does not replay a reservation into active state", async () => {
      const f = await fixture(), request=randomUUID(), args=[f.project,f.product,6,0,request];
      await call(reserve,args);
      await call("select public.cancel_project($1)",[f.project],"authenticated");
      expect((await db.query("select reserved_quantity::text q,version::text v from public.finished_goods_project_reservations where project_id=$1",[f.project])).rows).toEqual([{q:"0",v:"2"}]);
      expect((await db.query("select count(*)::int n from public.finished_goods_project_reservation_events where project_id=$1",[f.project])).rows[0].n).toBe(2);
      await call(reserve,args); // Original result replay, not a new reservation.
      expect((await db.query("select reserved_quantity::text q from public.finished_goods_project_reservations where project_id=$1",[f.project])).rows[0].q).toBe("0");
      expect(await quantity(f.product)).toBe("10");
    });
    it("blocks final Work Order completion atomically until release; reopening never reclaims stock", async () => {
      const f = await fixture();
      await call(reserve,[f.project,f.product,6,0,randomUUID()]);
      const wo = await work(f.product,1,f.project), args=await finishArgs(wo);
      await expect(call(finishSql,args,"authenticated")).rejects.toMatchObject({code:"FGR08"});
      expect(await quantity(f.product)).toBe("10");
      expect((await db.query("select status from public.work_orders where id=$1",[wo])).rows[0].status).toBe("draft");
      await call(release,[f.project,f.product,6,1,randomUUID()]);
      await call(finishSql,args,"authenticated");
      expect((await db.query("select status from public.projects where id=$1",[f.project])).rows[0].status).toBe("completed");
      await call("select public.reopen_project($1)",[f.project],"authenticated");
      expect((await db.query("select reserved_quantity::text q from public.finished_goods_project_reservations where project_id=$1",[f.project])).rows[0].q).toBe("0");
      await db.query("set constraints all immediate");
    });
  });
});
