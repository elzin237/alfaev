import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { LOCAL_RESERVATION, ReservationLocalTarget, reservationSnapshot,
  rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const enabled = process.env.TEST_CALCULATOR_FOUNDATION_LOCAL === "1";
const file = "20261027100000_add_test_calculator_foundation.sql";
const migration = readFileSync(`supabase/migrations/${file}`, "utf8");
const tables = ["test_calculations", "test_calculation_items", "test_calculation_holds"];
const rawWarehouse = "10000000-0000-4000-8000-000000000001";

describe.skipIf(!enabled)("Test Calculator foundation — newly owned local clone only", () => {
  const target = new ReservationLocalTarget();
  const name = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  let source: LocalReservationPool | undefined, pool: LocalReservationPool | undefined;
  let sourceBaseline: unknown, cloneBaseline: unknown, created = false;
  let transaction: ReturnType<typeof guardRollbackQueries> | undefined, db: PoolClient;
  let admin: { id: string; auth_user_id: string }, member: typeof admin, product: { id: string; name: string; serial_number: string; product_kind: string };
  let originalPermissions: unknown, originalGrants: unknown, originalSecurity: unknown;

  async function snapshot(pool: LocalReservationPool) {
    const client = await pool.connect();
    try { return await reservationSnapshot(client); } finally { client.release(true); }
  }
  async function attempt(sql: string, args: unknown[] = []) {
    await db.query("savepoint attempt");
    try { const result = await db.query(sql, args); await db.query("release savepoint attempt"); return result; }
    catch (error) { await db.query("rollback to savepoint attempt; release savepoint attempt"); throw error; }
  }
  async function permissions() {
    return (await db.query("select * from public.permission_definitions order by id")).rows;
  }
  async function roleQuery(role: string, actorId: string, sql: string) {
    if (!["anon", "authenticated", "service_role"].includes(role)) throw new Error("Unsafe role");
    await db.query("savepoint caller");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actorId]);
      await db.query(`set local role ${role}`);
      const result = await db.query(sql);
      await db.query("reset role; release savepoint caller"); return result;
    } catch (error) { await db.query("rollback to savepoint caller; release savepoint caller"); throw error; }
  }
  async function security() {
    return (await db.query(`select md5(jsonb_build_object(
      'tables',(select jsonb_agg(jsonb_build_array(c.oid,c.relacl,c.relrowsecurity,c.relforcerowsecurity) order by c.oid)
        from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p') and c.relname not like 'test_calculation%'),
      'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
      'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p where p.pronamespace='public'::regnamespace
        and p.proname not in ('reject_test_calculator_history_mutation','check_test_calculator_hold_total'))
      )::text) digest`)).rows;
  }
  async function header(overrides: Record<string, unknown> = {}) {
    const id = randomUUID();
    const data = { name: "Local immutable Test", actor: admin.id, created: "2026-03-27T12:00:00Z",
      deadline: "2026-03-29", expiry: "2026-03-29T22:00:00Z", request: randomUUID(), payload: {}, receipt: {}, ...overrides };
    await db.query(`insert into public.test_calculations(id,name,created_by_user_id,created_at,deadline_date,expires_at,
      request_id,submitted_payload,save_receipt) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id,data.name,data.actor,data.created,data.deadline,data.expiry,data.request,data.payload,data.receipt]);
    return { id, ...data };
  }
  async function item(calculation: string, required = "3", held = "3", uncovered = "0") {
    const id = randomUUID();
    await db.query(`insert into public.test_calculation_items(id,calculation_id,product_id,product_name_snapshot,
      serial_number_snapshot,product_kind_snapshot,required_quantity,held_quantity,uncovered_quantity)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id,calculation,product.id,product.name,product.serial_number,product.product_kind,required,held,uncovered]);
    return id;
  }
  const hold = (itemId: string, calculation: string, quantity = "3", productId = product.id, warehouse = rawWarehouse) =>
    db.query(`insert into public.test_calculation_holds(item_id,calculation_id,product_id,warehouse_id,quantity)
      values($1,$2,$3,$4,$5)`, [itemId,calculation,productId,warehouse,quantity]);

  beforeAll(async () => {
    if (process.env.TEST_CALCULATOR_FOUNDATION_APPROVAL !== "owned-clone-only") throw new Error("Owned-clone approval required");
    if (process.env.LOCAL_SUPABASE_DB_PASSWORD) throw new Error("Use pinned peer authentication only");
    source = target.pool(); await target.acquire(source); sourceBaseline = await snapshot(source);
    await target.createTemporary(source, name); created = true; target.copyIntoTemporary(name); pool = target.pool(name);
    const setup = await pool.connect();
    try {
      const files = readdirSync("supabase/migrations").filter(p => /^\d{14}_.+\.sql$/.test(p)).sort();
      expect(files[150]).toBe(file);
      await setup.query("begin");
      try {
        for (let i = 142; i < 150; i++) {
          const path = files[i]!;
          await setup.query(readFileSync(`supabase/migrations/${path}`, "utf8"));
          await setup.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)", [path.slice(0,14),path.slice(15,-4)]);
          if (i >= 145) {
            await setup.query("commit");
            await target.acceptClonePhase(setup, name, (i + 1) as 146 | 147 | 148 | 149 | 150);
            if (i < 149) await setup.query("begin");
          }
        }
      } catch (error) { await setup.query("rollback"); throw error; }
      admin = (await setup.query("select id,auth_user_id from public.user_profiles where is_active and is_admin order by id limit 1")).rows[0];
      member = (await setup.query("select id,auth_user_id from public.user_profiles where is_active and not is_admin order by id limit 1")).rows[0];
      product = (await setup.query("select id,name,serial_number,product_kind from public.products where id<>$1 order by id limit 1", [LOCAL_RESERVATION.residue])).rows[0];
      if (!admin || !member || !product) throw new Error("Existing local Admin/member/Product fixtures required");
      cloneBaseline = await reservationSnapshot(setup);
    } finally { setup.release(true); }
  });
  beforeEach(async context => {
    await target.assertQuiet();
    const client = await pool!.connect(); await client.query("begin");
    transaction = guardRollbackQueries(client, context.signal); db = transaction.client;
    await db.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
    originalPermissions = await permissions();
    originalGrants = (await db.query("select * from public.user_permissions order by user_id,permission_definition_id")).rows;
    originalSecurity = await security();
    await db.query(migration);
  });
  afterEach(async () => {
    let failure: unknown;
    if (transaction) { const current = transaction; transaction = undefined;
      try { await rollbackReservationTransactions([current]); } catch (error) { failure = error; } }
    try { if (pool && cloneBaseline) expect(await snapshot(pool)).toEqual(cloneBaseline); }
    finally { if (failure) throw failure; }
  });
  afterAll(async () => {
    try {
      if (pool) await pool.end();
      if (source && sourceBaseline) expect(await snapshot(source)).toEqual(sourceBaseline);
      if (created && source) await target.dropTemporary(source, name);
      if (created && source) expect((await source.query("select exists(select 1 from pg_database where datname=$1) present", [name])).rows[0].present).toBe(false);
      if (source && sourceBaseline) expect(await snapshot(source)).toEqual(sourceBaseline);
    } finally { await target.release(); if (source) await source.end(); }
  });

  it("applies after 150, adds only two definitions and preserves existing grants/security", async () => {
    const all = await permissions();
    expect(all.filter(row => !row.key.startsWith("test_calculator."))).toEqual(originalPermissions);
    expect(all.filter(row => row.key.startsWith("test_calculator.")).map(row => row.key).sort())
      .toEqual(["test_calculator.manage", "test_calculator.view"]);
    expect(all.filter(row => row.key.startsWith("test_calculator.")).every(row => row.is_delegable)).toBe(true);
    expect((await db.query("select * from public.user_permissions order by user_id,permission_definition_id")).rows).toEqual(originalGrants);
    expect(await security()).toEqual(originalSecurity);
    expect((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and prosecdef")).rows[0].n).toBe(190);
  });
  it("denies direct table reads/writes and helper EXECUTE, including Admin JWT and service role", async () => {
    for (const table of tables) {
      expect((await db.query("select relrowsecurity rls from pg_class where oid=$1::regclass", [`public.${table}`])).rows[0].rls).toBe(true);
      for (const role of ["anon", "authenticated", "service_role"]) {
        expect((await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed", [role,`public.${table}`])).rows[0].allowed).toBe(false);
        for (const actor of [admin, member]) {
          for (const sql of [`select * from public.${table}`, `insert into public.${table} default values`,
            `delete from public.${table}`])
            await expect(roleQuery(role, actor.auth_user_id, sql)).rejects.toMatchObject({ code: "42501" });
        }
      }
    }
    for (const role of ["anon", "authenticated", "service_role"]) for (const fn of ["reject_test_calculator_history_mutation", "check_test_calculator_hold_total"])
      expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role,`public.${fn}()`])).rows[0].allowed).toBe(false);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [admin.auth_user_id]);
    expect((await db.query("select public.has_permission('test_calculator.view') allowed")).rows[0].allowed).toBe(true);
  });
  it("preserves zero/partial/large exact quantities and expired Sarajevo history", async () => {
    for (const [required, held, missing] of [["3","0","3"],["5","3","2"],["9223372036854775807","9007199254740993","9214364837600034814"]]) {
      const calc = await header(), id = await item(calc.id, required, held, missing);
      if (held !== "0") await hold(id, calc.id, held);
      await db.query("set constraints all immediate; set constraints all deferred");
      expect((await db.query("select required_quantity::text r,held_quantity::text h,uncovered_quantity::text u from public.test_calculation_items where id=$1", [id])).rows[0])
        .toEqual({ r: required, h: held, u: missing });
      expect((await db.query("select expires_at < clock_timestamp() expired from public.test_calculations where id=$1", [calc.id])).rows[0].expired).toBe(true);
    }
  });
  it("keeps view/manage independent and uses existing active Admin/delegated permission checks", async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [member.auth_user_id]);
    const granted = async (key: string) => (await db.query("select public.has_permission($1) allowed", [key])).rows[0].allowed;
    expect(await granted("test_calculator.view")).toBe(false);
    expect(await granted("test_calculator.manage")).toBe(false);
    await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
      select $1,id,$2 from public.permission_definitions where key='test_calculator.view'`, [member.id,admin.id]);
    expect(await granted("test_calculator.view")).toBe(true);
    expect(await granted("test_calculator.manage")).toBe(false);
    await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
      select $1,id,$2 from public.permission_definitions where key='test_calculator.manage'`, [member.id,admin.id]);
    expect(await granted("test_calculator.manage")).toBe(true);
    await expect(roleQuery("authenticated",member.auth_user_id,"select submitted_payload from public.test_calculations"))
      .rejects.toMatchObject({code:"42501"});
  });
  it("rejects malformed identity, expiry, payload, arithmetic and foreign keys", async () => {
    await expect(attempt("insert into public.test_calculations(name,created_by_user_id,request_id,submitted_payload,save_receipt) values('X',$1,$2,'{}','{}')", [admin.id,randomUUID()])).rejects.toMatchObject({code:"23502"});
    const calc = await header();
    await expect(attempt("insert into public.test_calculations(name,created_by_user_id,deadline_date,expires_at,request_id,submitted_payload,save_receipt) values('X',$1,'2030-01-01','2030-01-01T00:00:00Z',$2,'{}','{}')", [admin.id,randomUUID()])).rejects.toMatchObject({code:"23514"});
    await expect(attempt("insert into public.test_calculations(name,created_by_user_id,deadline_date,expires_at,request_id,submitted_payload,save_receipt) values('X',$1,'2030-01-01','2030-01-01T23:00:00Z',$2,'[]','{}')", [admin.id,randomUUID()])).rejects.toMatchObject({code:"23514"});
    await expect(attempt("insert into public.test_calculation_items(calculation_id,product_id,product_name_snapshot,serial_number_snapshot,product_kind_snapshot,required_quantity,held_quantity,uncovered_quantity) values($1,$2,'X','001','component',3,4,0)", [calc.id,product.id])).rejects.toMatchObject({code:"23514"});
    const id = await item(calc.id);
    await expect(attempt("insert into public.test_calculation_holds(item_id,calculation_id,product_id,warehouse_id,quantity) values($1,$2,$3,$4,-1)", [id,calc.id,product.id,rawWarehouse])).rejects.toMatchObject({code:"23514"});
    await expect(attempt("insert into public.test_calculation_holds(item_id,calculation_id,product_id,warehouse_id,quantity) values($1,$2,$3,$4,3)", [id,calc.id,randomUUID(),rawWarehouse])).rejects.toMatchObject({code:"23503"});
    await expect(attempt("insert into public.test_calculation_holds(item_id,calculation_id,product_id,warehouse_id,quantity) values($1,$2,$3,$4,3)", [id,calc.id,product.id,randomUUID()])).rejects.toMatchObject({code:"23503"});
    await hold(id, calc.id);
    await expect(attempt("insert into public.test_calculations(name,created_by_user_id,created_at,deadline_date,expires_at,request_id,submitted_payload,save_receipt) select name,created_by_user_id,created_at,deadline_date,expires_at,request_id,submitted_payload,save_receipt from public.test_calculations where id=$1",[calc.id])).rejects.toMatchObject({code:"23505"});
    await db.query("set constraints all immediate");
  });
  it("rejects a deferred warehouse hold total mismatch", async () => {
    const calc = await header(), id = await item(calc.id);
    await expect(attempt("set constraints all immediate")).rejects.toMatchObject({ code: "23514" });
    await hold(id, calc.id); await db.query("set constraints all immediate");
  });
  it("forbids updates, deletes and truncation even for trusted historical rows", async () => {
    const calc = await header(), id = await item(calc.id); await hold(id, calc.id);
    await db.query("set constraints all immediate");
    for (const table of tables) {
      const column = table === "test_calculations" ? "name=name" : table === "test_calculation_items" ? "held_quantity=held_quantity" : "quantity=quantity";
      for (const sql of [`update public.${table} set ${column}`, `delete from public.${table}`, `truncate public.${table} cascade`])
        await expect(attempt(sql)).rejects.toMatchObject({ code: "55000" });
    }
  });
});
