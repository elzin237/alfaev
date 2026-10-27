import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { LOCAL_RESERVATION, ReservationLocalTarget, reservationSnapshot,
  rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const paths = readdirSync("supabase/migrations").filter(p => /^\d{14}_.+\.sql$/.test(p)
  && p.slice(0, 14) <= "20261023130000").sort();
const additions = paths.slice(142, 146).map(p => readFileSync(`supabase/migrations/${p}`, "utf8"));
const fg = "10000000-0000-4000-8000-000000000002";
const read = "select * from public.get_project_finished_goods_reservation_context($1)";
const reserve = "select * from public.reserve_finished_goods_for_project($1,$2,$3::bigint,$4::bigint,$5)";
const fields = ["product_id", "product_name", "serial_number", "planned_requirement", "actual_project_consumption",
  "outstanding_demand", "physical_quantity", "globally_reserved_quantity", "available_quantity",
  "project_reserved_quantity", "reservation_id", "reservation_version"];

describe.skipIf(process.env.FG_RESERVATION_READ_LOCAL !== "1")("Phase 3D1 isolated trusted FG context", () => {
  const target = new ReservationLocalTarget(), name = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  let source: LocalReservationPool, pool: LocalReservationPool, db: PoolClient, created = false;
  let sourceBaseline: unknown, baseline: unknown, transaction: ReturnType<typeof guardRollbackQueries> | undefined;
  let admin: { profileId: string; authUserId: string }, actor: typeof admin;
  async function call(sql: string, args: unknown[] = [], role = "authenticated", client = db) {
    if (!["postgres", "authenticated", "anon", "service_role"].includes(role)) throw new Error("Unsafe role");
    await client.query("savepoint rpc");
    try {
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [role === "anon" ? "" : actor.authUserId]);
      await client.query(`set local role ${role}`);
      const rows = (await client.query(sql, args)).rows;
      await client.query("reset role; release savepoint rpc"); return rows;
    } catch (error) { await client.query("rollback to savepoint rpc; release savepoint rpc"); throw error; }
  }
  async function demand(product: string, quantity: string | number = 20, client = db) {
    const project = randomUUID(), group = randomUUID();
    await client.query(`insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id)
      values($1,$2,'Local read proof','2026-10-23','2026-11-23',$3,$3)`, [project, `Read ${project}`, admin.profileId]);
    await client.query(`insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id)
      values($1,$2,'Explicit FG demand',$3,$3)`, [group, project, admin.profileId]);
    await client.query(`insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id)
      values($1,$2,$3::bigint,$4,$4)`, [group, product, quantity, admin.profileId]);
    return project;
  }
  async function fixture(quantity: string | number = 20, client = db) {
    const product = randomUUID(), card = randomUUID();
    if (product === LOCAL_RESERVATION.residue) throw new Error("Retained residue forbidden");
    const serial = (await client.query(`select s::text serial from generate_series(8000000,8999999) s
      where not exists(select 1 from public.products where serial_number=s::text) order by s limit 1`)).rows[0].serial;
    await client.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,'PCB','pcb_finished_good',$4,$4)`, [product, serial, `Read ${product}`, admin.profileId]);
    await client.query(`insert into public.pcb_cards(id,name,output_product_id,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,$4,$4)`, [card, `Read ${card}`, product, admin.profileId]);
    const project = await demand(product, quantity || 1, client);
    if (quantity !== 0) {
      const supplier = await createSupplierSourceFixture(client, admin, product);
      await call("select * from public.adjust_inventory_warehouse($1,$2,'add',$3::bigint,'Local FG read proof',$4)",
        [product, fg, quantity, supplier.productSupplierId], "authenticated", client);
    }
    return { product, project, serial };
  }
  async function complete(project: string, product: string) {
    const order = randomUUID();
    const number = (await db.query(`select 'RN-8992-'||lpad(s::text,4,'0') n from generate_series(1,9999) s
      where not exists(select 1 from public.work_orders where work_order_number='RN-8992-'||lpad(s::text,4,'0')) order by s limit 1`)).rows[0].n;
    await db.query(`insert into public.work_orders(id,work_order_number,project_id,customer_name_snapshot,description,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,'Local','Read lifecycle proof',$4,$4)`, [order, number, project, admin.profileId]);
    await db.query("insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id) values($1,$2,1,$3)", [order, product, admin.profileId]);
    const stamp = (await db.query("select updated_at::text stamp from public.work_orders where id=$1", [order])).rows[0].stamp;
    const fp = (await db.query("select public.get_work_order_source_allocation_fingerprint($1) fp", [order])).rows[0].fp;
    const path = `final/${order}/${randomUUID()}.pdf`;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('work-order-pdfs',$1,jsonb_build_object('mimetype','application/pdf'))", [path]);
    await call("select * from public.finish_work_order($1,$2::timestamptz,$3,$4,$5)", [order, stamp, path, "a".repeat(64), fp]);
  }
  beforeAll(async () => {
    expect(paths).toHaveLength(146);
    source = target.pool(); await target.acquire(source); sourceBaseline = await reservationSnapshot(source);
    await target.createTemporary(source, name); created = true; target.copyIntoTemporary(name); pool = target.pool(name);
    const setup = await pool.connect();
    try {
      const row = (await setup.query("select id,auth_user_id from public.user_profiles where is_admin and is_active order by id limit 1")).rows[0];
      if (!row) throw new Error("Existing local active Admin required");
      admin = { profileId: row.id, authUserId: row.auth_user_id }; actor = admin;
      // Commit schema only inside this owned clone so a second session can read it.
      await setup.query("begin");
      try { for (const sql of additions) await setup.query(sql); await setup.query("commit"); }
      catch (error) { await setup.query("rollback"); throw error; }
      baseline = await reservationSnapshot(setup);
    } finally { setup.release(); }
  });
  beforeEach(async context => {
    await target.assertQuiet(); actor = admin;
    const client = await pool.connect(); await client.query("begin");
    transaction = guardRollbackQueries(client, context.signal); db = transaction.client;
    await db.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
  });
  afterEach(async () => {
    try { if (transaction) await rollbackReservationTransactions([transaction]); }
    finally { transaction = undefined; if (baseline) expect(await reservationSnapshot(pool)).toEqual(baseline); }
  });
  afterAll(async () => {
    try { if (sourceBaseline) expect(await reservationSnapshot(source)).toEqual(sourceBaseline); }
    finally { try { if (pool) await pool.end(); if (created) await target.dropTemporary(source, name); }
      finally { await target.release(); if (source) await source.end(); } }
  });

  it("reads 20 physical / 8 globally reserved / 12 available with only own reservation identity", async () => {
    const f = await fixture(), other = await demand(f.product);
    const own = (await call(reserve, [f.project, f.product, 3, 0, randomUUID()], "postgres"))[0];
    const foreign = (await call(reserve, [other, f.product, 5, 0, randomUUID()], "postgres"))[0];
    const rows = await call(read, [f.project]);
    expect(rows).toHaveLength(1); expect(Object.keys(rows[0])).toEqual(fields);
    expect(rows[0]).toMatchObject({ product_id: f.product, serial_number: f.serial, planned_requirement: "20",
      actual_project_consumption: "0", outstanding_demand: "20", physical_quantity: "20", globally_reserved_quantity: "8",
      available_quantity: "12", project_reserved_quantity: "3", reservation_id: own.reservation_id, reservation_version: "1" });
    expect(JSON.stringify(rows)).not.toContain(other); expect(JSON.stringify(rows)).not.toContain(foreign.reservation_id);
    expect((await call(read, [other]))[0]).toMatchObject({ reservation_id: foreign.reservation_id, project_reserved_quantity: "5" });
  });
  it("includes demanded zero-stock outputs and uses version zero only for absent reservation state", async () => {
    const f = await fixture(0);
    expect((await call(read, [f.project]))[0]).toMatchObject({ product_id: f.product, physical_quantity: "0",
      globally_reserved_quantity: "0", available_quantity: "0", project_reserved_quantity: "0", reservation_id: null, reservation_version: "0" });
    expect(await call(read, [randomUUID()])).toEqual([]);
    await expect(call(read, [null])).rejects.toMatchObject({ code: "22023" });
  });
  it("excludes foreign-only demand, ordinary Products and name-only groups", async () => {
    const own = await fixture(), foreign = await fixture();
    const ordinary = randomUUID(), group = randomUUID();
    const serial = (await db.query(`select s::text serial from generate_series(8100000,8199999) s
      where not exists(select 1 from public.products where serial_number=s::text) order by s limit 1`)).rows[0].serial;
    await db.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,'Local','component',$4,$4)`, [ordinary, serial, `Ordinary ${ordinary}`, admin.profileId]);
    await db.query(`insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,$4,$4)`, [group, own.project, `Read ${foreign.product}`, admin.profileId]);
    await db.query(`insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id)
      values($1,$2,1,$3,$3)`, [group, ordinary, admin.profileId]);
    expect((await call(read, [own.project])).map(row => row.product_id)).toEqual([own.product]);
  });
  it("uses exact Product demand and canonical qualifying fulfillment consumption without duplicate joins", async () => {
    const f = await fixture();
    const group = (await db.query("select id from public.project_products where project_id=$1", [f.project])).rows[0].id;
    // A second group/component for the same Product must aggregate once, not multiply consumption.
    const group2 = randomUUID();
    await db.query(`insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id)
      values($1,$2,'Same Product',$3,$3)`, [group2, f.project, admin.profileId]);
    await db.query(`insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id)
      values($1,$2,2,$3,$3)`, [group2, f.product, admin.profileId]);
    expect(group).not.toBe(group2);
    const r = (await call(reserve, [f.project, f.product, 8, 0, randomUUID()], "postgres"))[0];
    const request = [r.reservation_id, f.project, f.product, 3, 1, randomUUID()];
    const sql = "select * from public.fulfill_finished_goods_project_reservation($1,$2,$3,$4::bigint,$5::bigint,$6)";
    await call(sql, request, "postgres"); await call(sql, request, "postgres");
    expect((await call(read, [f.project]))[0]).toMatchObject({ planned_requirement: "22", actual_project_consumption: "3",
      outstanding_demand: "19", physical_quantity: "17", globally_reserved_quantity: "5", available_quantity: "12",
      project_reserved_quantity: "5", reservation_version: "2" });
    const canonical = (await db.query("select * from public.calculate_open_project_commitments($1) where project_id=$2", [f.product, f.project])).rows[0];
    expect(canonical).toMatchObject({ planned_requirement: "22", actual_project_consumption: "3", outstanding_commitment: "19" });
    await db.query("set constraints all immediate");
  });
  it("preserves archived Product and cancelled/completed Project history without reopening commitments", async () => {
    const f = await fixture();
    const r = (await call(reserve, [f.project, f.product, 2, 0, randomUUID()], "postgres"))[0];
    await call("select public.cancel_project($1)", [f.project]);
    await db.query("update public.products set is_active=false,archived_at=now(),archived_by_user_id=$2 where id=$1", [f.product, admin.profileId]);
    expect((await call(read, [f.project]))[0]).toMatchObject({ product_id: f.product, reservation_id: r.reservation_id,
      reservation_version: "2", project_reserved_quantity: "0", planned_requirement: "20", outstanding_demand: "20" });
    expect((await db.query("select * from public.calculate_open_project_commitments($1) where project_id=$2", [f.product, f.project])).rows).toEqual([]);
    const completed = await fixture(); await complete(completed.project, completed.product);
    expect((await db.query("select status from public.projects where id=$1", [completed.project])).rows[0].status).toBe("completed");
    expect((await call(read, [completed.project]))[0]).toMatchObject({ actual_project_consumption: "1", outstanding_demand: "19", physical_quantity: "19" });
    expect((await db.query("select * from public.calculate_open_project_commitments($1)", [completed.product])).rows).toEqual([]);
    await db.query("set constraints all immediate");
  });
  it("requires both delegated views, not adjust/reserve/production permissions, and denies inactive/anonymous", async () => {
    const f = await fixture();
    const profile = (await db.query("select id,auth_user_id from public.user_profiles where not is_admin and is_active order by id limit 1")).rows[0];
    if (!profile) throw new Error("Existing local non-Admin required");
    await db.query("delete from public.user_permissions where user_id=$1", [profile.id]);
    actor = { profileId: profile.id, authUserId: profile.auth_user_id };
    for (const keys of [[], ["projects.view"], ["inventory.finished_goods.view"], ["inventory.finished_goods.adjust"],
      ["inventory.finished_goods.reserve"], ["work_orders.finish", "pcb.produce"]]) {
      await db.query("delete from public.user_permissions where user_id=$1", [profile.id]);
      await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
        select $1,id,$2 from public.permission_definitions where key=any($3::text[])`, [profile.id, admin.profileId, keys]);
      await expect(call(read, [f.project])).rejects.toMatchObject({ code: "42501" });
    }
    await db.query("delete from public.user_permissions where user_id=$1", [profile.id]);
    await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
      select $1,id,$2 from public.permission_definitions where key in ('projects.view','inventory.finished_goods.view')`, [profile.id, admin.profileId]);
    expect(await call(read, [f.project])).toHaveLength(1);
    await expect(call("select * from public.get_product_project_commitments($1)", [f.product])).rejects.toMatchObject({ code: "42501" });
    await db.query("update public.user_profiles set is_active=false where id=$1", [profile.id]);
    await expect(call(read, [f.project])).rejects.toMatchObject({ code: "42501" });
    actor = admin; await expect(call(read, [f.project], "anon")).rejects.toMatchObject({ code: "42501" });
  });
  it("preserves exact bigint values above JavaScript's safe integer range", async () => {
    const exact = "9007199254740993", f = await fixture(exact);
    expect((await call(read, [f.project]))[0]).toMatchObject({ planned_requirement: exact, physical_quantity: exact, available_quantity: exact });
  });
  it("is STABLE/SECURITY DEFINER with a narrow authenticated ACL, no table access or side effects", async () => {
    const f = await fixture(), before = await reservationSnapshot(db);
    await call(read, [f.project]); await call(read, [f.project]);
    expect(await reservationSnapshot(db)).toEqual(before);
    const row = (await db.query(`select prosecdef,provolatile,proconfig,pg_get_function_identity_arguments(oid) args,
      has_function_privilege('public',oid,'execute') public,has_function_privilege('anon',oid,'execute') anon,
      has_function_privilege('authenticated',oid,'execute') browser,has_function_privilege('service_role',oid,'execute') service
      from pg_proc where oid='public.get_project_finished_goods_reservation_context(uuid)'::regprocedure`)).rows[0];
    expect(row).toEqual({ prosecdef: true, provolatile: "s", proconfig: ['search_path=""'], args: "p_project_id uuid", public: false, anon: false, browser: true, service: false });
    const trusted = (await db.query(`select proname,proconfig,has_function_privilege('public',oid,'execute') public,
      has_function_privilege('anon',oid,'execute') anon from pg_proc where pronamespace='public'::regnamespace
      and prosecdef and proname<>'rls_auto_enable'`)).rows;
    expect(trusted).toHaveLength(185);
    for (const fn of trusted) expect(fn).toMatchObject({ proconfig: ['search_path=""'], public: false, anon: false });
    for (const role of ["authenticated", "anon", "service_role"]) {
      for (const table of ["finished_goods_project_reservations", "finished_goods_project_reservation_events"])
        for (const sql of [`select * from public.${table}`, `insert into public.${table} default values`,
          `update public.${table} set id=id`, `delete from public.${table}`])
          await expect(call(sql, [], role)).rejects.toMatchObject({ code: "42501" });
      for (const sql of ["select * from public.calculate_project_product_demand(null,null)",
        "select * from public.calculate_open_project_commitments(null)", reserve,
        "select * from public.release_finished_goods_project_reservation($1,$2,$3::bigint,$4::bigint,$5)",
        "select * from public.fulfill_finished_goods_project_reservation($1,$2,$3,$4::bigint,$5::bigint,$6)"])
        await expect(call(sql, sql.includes("$6") ? [randomUUID(), f.project, f.product, 1, 1, randomUUID()]
          : sql.includes("$1") ? [f.project, f.product, 1, 0, randomUUID()] : [], role)).rejects.toMatchObject({ code: "42501" });
    }
    for (const table of ["finished_goods_project_reservations", "finished_goods_project_reservation_events"])
      expect((await db.query("select relrowsecurity rls from pg_class where oid=$1::regclass", [`public.${table}`])).rows[0].rls).toBe(true);
  });
  it.each(["fresh 0 -> 146", "upgrade 145 -> only 146"])("migration proof: %s", async kind => {
    let existing: Awaited<ReturnType<typeof fixture>> | undefined;
    if (kind.startsWith("fresh")) {
      await db.query("drop schema public cascade; create schema public; grant usage on schema public to postgres,anon,authenticated,service_role; drop schema supabase_migrations cascade; create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text); truncate auth.users cascade; truncate storage.buckets cascade");
      await db.query(`do $fresh$ declare p record; begin for p in select schemaname,tablename,policyname from pg_policies
        where schemaname in ('storage','realtime') loop execute format('drop policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);end loop;end $fresh$`);
      for (const file of paths.slice(0, 145)) {
        await db.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
        await db.query("insert into supabase_migrations.schema_migrations(version) values($1)", [file.slice(0, 14)]);
      }
    } else {
      // Restore only the pre-146 schema inside this rollback transaction, then
      // create real reserve/fulfill history before applying 146 alone.
      const oldCalculation = additions[2]!.slice(additions[2]!.indexOf("create or replace function public.calculate_open_project_commitments"),
        additions[2]!.indexOf("create or replace function public.queue_project_shortage_reconciliation"));
      await db.query(oldCalculation);
      await db.query("drop function public.get_project_finished_goods_reservation_context(uuid); drop function public.calculate_project_product_demand(uuid,uuid)");
      for (const file of paths.slice(142, 145)) await db.query("insert into supabase_migrations.schema_migrations(version) values($1)", [file.slice(0, 14)]);
      existing = await fixture();
      const r = (await call(reserve, [existing.project, existing.product, 8, 0, randomUUID()], "postgres"))[0];
      await call("select * from public.fulfill_finished_goods_project_reservation($1,$2,$3,3,1,$4)",
        [r.reservation_id, existing.project, existing.product, randomUUID()], "postgres");
    }
    expect((await db.query("select count(*)::int n from supabase_migrations.schema_migrations")).rows[0].n).toBe(145);
    const before = await reservationSnapshot(db);
    await db.query(additions[3]!);
    // Additive DDL may change security metadata, never existing rows or sequences.
    const after = await reservationSnapshot(db);
    const { security: oldSecurity, ...oldData } = before;
    const { security: newSecurity, ...newData } = after;
    expect(oldSecurity).not.toEqual(newSecurity); expect(newData).toEqual(oldData);
    await db.query("insert into supabase_migrations.schema_migrations(version) values('20261023130000')");
    expect((await db.query("select count(*)::int n,max(version) latest from supabase_migrations.schema_migrations")).rows[0])
      .toEqual({ n: 146, latest: "20261023130000" });
    expect((await db.query("select prorettype='record'::regtype returns_table from pg_proc where oid='public.get_project_finished_goods_reservation_context(uuid)'::regprocedure")).rows[0].returns_table).toBe(true);
    if (existing) expect((await call(read, [existing.project]))[0]).toMatchObject({ physical_quantity: "17",
      globally_reserved_quantity: "5", actual_project_consumption: "3", outstanding_demand: "17", reservation_version: "2" });
    await db.query("set constraints all immediate");
  });
  it("reads a coherent old snapshot during uncommitted fulfillment, then a coherent new snapshot after commit", async context => {
    // A second independently owned clone isolates committed fixture history from
    // the rollback-only clone baseline and from the persistent source database.
    const concurrentName = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
    let concurrent: LocalReservationPool | undefined, a: PoolClient | undefined, b: PoolClient | undefined, owned = false;
    const guards: ReturnType<typeof guardRollbackQueries>[] = [];
    try {
      await target.createTemporary(source, concurrentName); owned = true; target.copyIntoTemporary(concurrentName);
      concurrent = target.pool(concurrentName);
      for (let i = 0; i < 2; i++) guards.push(guardRollbackQueries(await concurrent.connect(), context.signal));
      a = guards[0]!.client; b = guards[1]!.client;
      await a.query("begin"); for (const sql of additions) await a.query(sql);
      const f = await fixture(20, a);
      const r = (await call(reserve, [f.project, f.product, 8, 0, randomUUID()], "postgres", a))[0];
      await a.query("commit; begin");
      await call("select * from public.fulfill_finished_goods_project_reservation($1,$2,$3,3,1,$4)",
        [r.reservation_id, f.project, f.product, randomUUID()], "postgres", a);
      await b.query("begin read only");
      expect((await call(read, [f.project], "authenticated", b))[0]).toMatchObject({ physical_quantity: "20",
        globally_reserved_quantity: "8", available_quantity: "12", actual_project_consumption: "0", outstanding_demand: "20", reservation_version: "1" });
      await b.query("rollback"); await a.query("commit"); await b.query("begin read only");
      expect((await call(read, [f.project], "authenticated", b))[0]).toMatchObject({ physical_quantity: "17",
        globally_reserved_quantity: "5", available_quantity: "12", actual_project_consumption: "3", outstanding_demand: "17", reservation_version: "2" });
      await b.query("rollback");
    } finally {
      try { await rollbackReservationTransactions(guards); }
      finally { if (concurrent) await concurrent.end(); if (owned) await target.dropTemporary(source, concurrentName); }
    }
  });
});
