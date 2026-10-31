import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ReservationLocalTarget, reservationSnapshot, type LocalReservationPool } from "./helpers/reservation-local-target";

const migration = "20261031100000_add_private_project_shortage_condition_projection.sql";
const files = readdirSync("supabase/migrations").filter(f =>
  /^\d{14}_.+\.sql$/.test(f) && f.slice(0, 14) <= "20261031100000").sort();
const hashes = () => files.slice(0, 182).map(f => createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"));
const historical = hashes();
type Actor = { id: string; auth_user_id: string };
type Condition = { condition_id: string; condition_status: string; current_shortage_quantity: string;
  notification_id: string; opened_at: string; resolved_at: string | null; read_at: string | null;
  dismissed_at: string | null; has_opening_delivery: boolean; has_resolution_delivery: boolean; project_id: string };

describe.skipIf(process.env.PROJECT_CONDITIONS_LOCAL !== "1")("183 Project shortage conditions — owned disposable database", () => {
  const target = new ReservationLocalTarget();
  const name = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  let source: LocalReservationPool, pool: LocalReservationPool, db: PoolClient;
  let sourceBefore: unknown, baseline: unknown, created = false;
  let admin: Actor, member: Actor;
  async function snapshot(p: LocalReservationPool) {
    const c = await p.connect(); try { return await reservationSnapshot(c); } finally { c.release(true); }
  }
  beforeAll(async () => {
    if (process.env.PROJECT_CONDITIONS_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw Error("Owned local peer scope required");
    expect(files).toHaveLength(183); expect(files[182]).toBe(migration);
    source = target.pool(); await target.acquire(source); sourceBefore = await snapshot(source);
    await target.createTemporary(source, name); created = true;
    process.stdout.write(`Owned Project condition database: ${name}; pinned local socket/cluster only\n`);
    target.copyIntoTemporary(name); pool = target.pool(name);
    const setup = await pool.connect();
    try {
      await setup.query("begin");
      for (let i = 142; i < 150; i++) {
        const file = files[i]!;
        await setup.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
        await setup.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)", [file.slice(0, 14), file.slice(15, -4)]);
        if (i >= 145) {
          await setup.query("commit"); await target.acceptClonePhase(setup, name, (i + 1) as 146 | 147 | 148 | 149 | 150);
          if (i < 149) await setup.query("begin");
        }
      }
      // Preserve the harness's reviewed phase-150 connection identity. Later SQL
      // is installed only in this owned clone, as in existing integration suites.
      for (const file of files.slice(150, 182)) {
        await setup.query("begin"); await setup.query(readFileSync(`supabase/migrations/${file}`, "utf8")); await setup.query("commit");
      }
      const before = await reservationSnapshot(setup);
      const contracts = (await setup.query("select oid::text id,md5(to_jsonb(p)::text) digest from pg_proc p where pronamespace='public'::regnamespace order by oid")).rows;
      await setup.query("begin"); await setup.query(readFileSync(`supabase/migrations/${migration}`, "utf8")); await setup.query("commit");
      const after = await reservationSnapshot(setup);
      for (const [key, value] of Object.entries(before)) if (key !== "security") expect(after[key]).toEqual(value);
      expect((await setup.query("select oid::text id,md5(to_jsonb(p)::text) digest from pg_proc p where oid=any($1::oid[]) order by oid", [contracts.map(r => r.id)])).rows).toEqual(contracts);
      admin = (await setup.query("select id,auth_user_id from public.user_profiles where is_active and is_admin order by id limit 1")).rows[0];
      member = (await setup.query("select id,auth_user_id from public.user_profiles where is_active and not is_admin order by id limit 1")).rows[0];
      if (!admin || !member) throw Error("Existing isolated actor fixtures required");
      baseline = await reservationSnapshot(setup);
    } catch (error) { await setup.query("rollback"); throw error; } finally { setup.release(true); }
  });
  beforeEach(async () => {
    await target.assertQuiet(); db = await pool.connect();
    await db.query("begin; set local statement_timeout='15s'; set local lock_timeout='3s'");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [admin.auth_user_id]);
    // Test-only delegated execution boundary. Not part of the migration; rolled
    // back after every test. Real authenticated/anon/service_role calls exercise
    // the private helper's own JWT/ownership checks, not a mocked role argument.
    await db.query(`create function public.test_project_conditions(uuid) returns jsonb language sql stable security definer set search_path='' as
      'select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.project_shortage_condition_rows($1) t';
      revoke all on function public.test_project_conditions(uuid) from public;
      grant execute on function public.test_project_conditions(uuid) to authenticated,anon,service_role`);
    await grants(["dashboard.view", "projects.view"]);
  });
  afterEach(async () => {
    if (db) { await db.query("rollback"); db.release(true); }
    if (pool && baseline) expect(await snapshot(pool)).toEqual(baseline);
  });
  afterAll(async () => {
    try {
      if (pool) await pool.end();
      if (source && sourceBefore) expect(await snapshot(source)).toEqual(sourceBefore);
    } finally {
      try {
        if (created) {
          await target.dropTemporary(source, name);
          expect((await source.query("select 1 from pg_database where datname=$1", [name])).rowCount).toBe(0);
          process.stdout.write("Owned Project condition database removed; source data/security/sequences unchanged\n");
        }
      } finally { await target.release(); if (source) await source.end(); }
      expect(hashes()).toEqual(historical);
    }
  });
  async function grants(keys: string[]) {
    await db.query("delete from public.user_permissions where user_id=$1", [member.id]);
    await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])", [member.id, admin.id, keys]);
  }
  async function call(sql: string, args: unknown[], actor = admin, role = "authenticated") {
    if (!["authenticated", "anon", "service_role"].includes(role)) throw Error("Unsafe role");
    await db.query("savepoint rpc");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [role === "anon" ? "" : actor.auth_user_id]);
      await db.query(`set local role ${role}`); const result = (await db.query(sql, args)).rows;
      await db.query("reset role; release savepoint rpc"); return result;
    } catch (error) { await db.query("rollback to savepoint rpc; release savepoint rpc"); throw error; }
  }
  async function rows(actor = admin, recipient = actor.id): Promise<Condition[]> {
    return (await call("select public.test_project_conditions($1) result", [recipient], actor))[0].result;
  }
  async function flush() { await db.query("set constraints all immediate; set constraints all deferred"); }
  async function fixture(quantity = "10") {
    const product = randomUUID(), project = randomUUID(), group = randomUUID(), component = randomUUID();
    const serial = (await db.query("select n::text serial from generate_series(8000000,8999999) n where not exists(select 1 from public.products where serial_number=n::text) order by n limit 1")).rows[0].serial;
    await db.query("insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id) values($1,$2,'Owned condition material','Test','component',$3,$3)", [product, serial, admin.id]);
    await db.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,$2,'Owned conditions',current_date,current_date+1,$3,$3)", [project, `Owned conditions ${project}`, admin.id]);
    await db.query("insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id) values($1,$2,'Condition group',$3,$3)", [group, project, admin.id]);
    await db.query("insert into public.project_product_components(id,project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,$3,$4::bigint,$5,$5)", [component, group, product, quantity, admin.id]);
    await flush();
    return { product, project, component, serial, group };
  }
  async function change(f: { component: string; product: string; group: string }, quantity: string) {
    if (quantity === "0") {
      await call("select public.remove_project_product_component($1)", [f.component]); f.component = "";
    } else if (!f.component) {
      f.component = (await call("select public.create_project_product_component($1,$2,$3::bigint) id", [f.group, f.product, quantity]))[0].id;
    } else {
      await call("select public.update_project_product_component($1,$2,$3::bigint)", [f.component, f.product, quantity]);
    }
    await flush();
  }
  async function own(f: { project: string }, actor = admin) { return (await rows(actor)).filter(r => r.project_id === f.project); }

  it("keeps active identity/count unchanged after reading or legacy dismissal", async () => {
    const f = await fixture(), initial = (await own(f))[0]!;
    expect(initial).toMatchObject({ condition_status: "active", current_shortage_quantity: "10", read_at: null, dismissed_at: null });
    await call("select * from public.mark_project_alert_read($1)", [initial.notification_id]);
    expect(await own(f)).toHaveLength(1); expect((await own(f))[0]).toMatchObject({ condition_id: initial.condition_id, condition_status: "active" });
    await call("select * from public.dismiss_project_alert_notification($1)", [initial.notification_id]);
    expect((await own(f))[0]).toMatchObject({ condition_id: initial.condition_id, condition_status: "active" });
    expect((await own(f))[0]!.dismissed_at).not.toBeNull();
  });
  it("deduplicates opening and unread resolution deliveries and preserves exact episode times", async () => {
    const f = await fixture(), first = (await own(f))[0]!;
    await change(f, "0");
    const resolvedRows = await own(f); expect(resolvedRows).toHaveLength(1);
    const [resolved] = resolvedRows;
    expect(resolved).toMatchObject({ condition_id: first.condition_id, condition_status: "resolved", current_shortage_quantity: "0", opened_at: first.opened_at, read_at: null, has_opening_delivery: true, has_resolution_delivery: true, notification_id: first.notification_id });
    expect(resolved!.resolved_at).not.toBeNull();
    expect((await own(f)).filter(r => r.condition_status === "active")).toHaveLength(0);
    expect((await db.query("select count(*)::int n from public.project_activity_alert_recipients r join public.project_activity_alerts a on a.id=r.alert_id where a.project_id=$1 and r.recipient_user_id=$2", [f.project, admin.id])).rows[0].n).toBe(2);
    const episode = (await db.query("select opened_at::text,resolved_at::text from public.project_shortage_episodes where id=$1", [first.condition_id])).rows[0];
    expect(new Date(resolved!.resolved_at!).getTime()).toBe(new Date(episode.resolved_at).getTime());
  });
  it("retains history and creates a different episode identity on recurrence", async () => {
    const f = await fixture(), first = (await own(f))[0]!; await change(f, "0"); await change(f, "6");
    const history = await own(f); expect(history).toHaveLength(2);
    expect(history.find(r => r.condition_id === first.condition_id)!.condition_status).toBe("resolved");
    const active = history.filter(r => r.condition_status === "active"); expect(active).toHaveLength(1);
    expect(active[0]!.condition_id).not.toBe(first.condition_id);
  });
  it("projects increases/decreases on one identity without duplicating deliveries", async () => {
    const f = await fixture(), first = (await own(f))[0]!;
    await change(f, "12"); expect((await own(f))[0]).toMatchObject({ condition_id: first.condition_id, current_shortage_quantity: "12" });
    await change(f, "4"); expect(await own(f)).toHaveLength(1);
    expect((await own(f))[0]).toMatchObject({ condition_id: first.condition_id, current_shortage_quantity: "4", has_resolution_delivery: false });
    expect((await db.query("select count(*)::int n from public.project_activity_alerts where project_id=$1", [f.project])).rows[0].n).toBe(1);
  });
  it("preserves exact bigint quantities and distinct Product/Project episodes", async () => {
    const first = await fixture("9223372036854775807"), second = await fixture("9007199254740993");
    expect((await own(first))[0]!.current_shortage_quantity).toBe("9223372036854775807");
    expect((await own(second))[0]!.current_shortage_quantity).toBe("9007199254740993");
    expect((await own(first))[0]!.condition_id).not.toBe((await own(second))[0]!.condition_id);
  });
  it("preserves audiences and recipient-specific receipts; even Admin cannot select another recipient", async () => {
    const f = await fixture(), a = (await own(f))[0]!, b = (await own(f, member))[0]!;
    expect(a.condition_id).toBe(b.condition_id); expect(a.notification_id).not.toBe(b.notification_id);
    await call("select * from public.mark_project_alert_read($1)", [b.notification_id], member);
    expect((await own(f))[0]!.read_at).toBeNull(); expect((await own(f, member))[0]!.read_at).not.toBeNull();
    await expect(rows(admin, member.id)).rejects.toMatchObject({ code: "42501" });
    await expect(rows(member, admin.id)).rejects.toMatchObject({ code: "42501" });
  });
  it("does not manufacture delivery on a later permission grant and supports owned resolution-only history", async () => {
    await grants([]); const f = await fixture(); await grants(["dashboard.view", "projects.view"]);
    expect(await own(f, member)).toEqual([]); await change(f, "0");
    const result = await own(f, member); expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ condition_status: "resolved", has_opening_delivery: false, has_resolution_delivery: true });
  });
  it("fails closed on permission loss, inactivity and anonymous JWTs", async () => {
    await fixture();
    for (const keys of [["dashboard.view"], ["projects.view"], []]) {
      await grants(keys); await expect(rows(member)).rejects.toMatchObject({ code: "42501" });
    }
    await grants(["dashboard.view", "projects.view"]);
    await db.query("update public.user_profiles set is_active=false where id=$1", [member.id]);
    await expect(rows(member)).rejects.toMatchObject({ code: "42501" });
    await expect(call("select public.test_project_conditions($1)", [admin.id], admin, "anon")).rejects.toMatchObject({ code: "42501" });
  });
  it("keeps direct helper/table execution private and retains existing RLS", async () => {
    for (const role of ["authenticated", "anon", "service_role"]) {
      await expect(call("select * from public.project_shortage_condition_rows($1)", [admin.id], admin, role)).rejects.toMatchObject({ code: "42501" });
    }
    const meta = (await db.query(`select prosecdef,provolatile,proconfig,
      exists(select 1 from aclexplode(proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute
      from pg_proc where oid='public.project_shortage_condition_rows(uuid)'::regprocedure`)).rows[0];
    expect(meta).toEqual({ prosecdef: true, provolatile: "s", proconfig: ['search_path=""'], public_execute: false });
    for (const table of ["project_shortage_episodes", "project_shortage_events", "project_activity_alerts", "project_activity_alert_recipients"]) {
      expect((await db.query("select relrowsecurity from pg_class where oid=$1::regclass", [`public.${table}`])).rows[0].relrowsecurity).toBe(true);
      await expect(call(`select * from public.${table}`, [], member)).rejects.toMatchObject({ code: "42501" });
    }
  });
  it("leaves history/accounting and current public read/count contracts unchanged", async () => {
    const f = await fixture(), before = await reservationSnapshot(db);
    const unread = await call("select public.get_project_alert_unread_count()::text n", []);
    const inbox = await call("select * from public.list_project_notifications(20,null,null)", []);
    await rows(); await rows(member); await own(f);
    expect(await call("select public.get_project_alert_unread_count()::text n", [])).toEqual(unread);
    expect(await call("select * from public.list_project_notifications(20,null,null)", [])).toEqual(inbox);
    expect(await reservationSnapshot(db)).toEqual(before);
  });
});
