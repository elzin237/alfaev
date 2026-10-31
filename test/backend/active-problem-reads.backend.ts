import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ReservationLocalTarget, reservationSnapshot, type LocalReservationPool } from "./helpers/reservation-local-target";

const migration = "20261031110000_add_versioned_active_problem_reads.sql";
const files = readdirSync("supabase/migrations").filter(f =>
  /^\d{14}_.+\.sql$/.test(f) && f.slice(0, 14) <= "20261031110000").sort();
const hashes = () => files.slice(0, 183).map(f => createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"));
const historical = hashes();
type Actor = { id: string; auth_user_id: string };

describe.skipIf(process.env.ACTIVE_PROBLEMS_LOCAL !== "1")("184 Active Problems — owned disposable database", () => {
  const target = new ReservationLocalTarget();
  const name = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  let source: LocalReservationPool, pool: LocalReservationPool, db: PoolClient;
  let sourceBefore: unknown, baseline: unknown, created = false;
  let admin: Actor, member: Actor;
  async function snapshot(p: LocalReservationPool) {
    const c = await p.connect(); try { return await reservationSnapshot(c); } finally { c.release(true); }
  }
  beforeAll(async () => {
    if (process.env.ACTIVE_PROBLEMS_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw Error("Owned local peer scope required");
    expect(files).toHaveLength(184); expect(files[183]).toBe(migration);
    source = target.pool(); await target.acquire(source); sourceBefore = await snapshot(source);
    await target.createTemporary(source, name); created = true;
    process.stdout.write(`Owned Active Problems database: ${name}; pinned local socket/cluster only\n`);
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
      for (const file of files.slice(150, 183)) {
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
          process.stdout.write("Owned Active Problems database removed; source data/security/sequences unchanged\n");
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


  const counts = async (actor = admin) => (await call("select public.get_dashboard_active_problem_counts_v2() value", [], actor))[0].value;
  const inbox = async (actor = admin, status = "all") => (await call("select public.list_dashboard_problem_conditions_v2(50,null,null,null,$1) value", [status], actor))[0].value;
  async function activity(project: string, kind = "issue", alert = true) {
    return (await call("select * from public.post_project_activity($1,$2,'Owned activity','Original immutable description',$3,$4)", [project, randomUUID(), alert, kind]))[0];
  }
  async function issueFixture() {
    const f = await fixture(); await change(f, "0");
    return { ...f, issue: await activity(f.project) };
  }
  const issueRows = async (id: string, actor = admin) => (await inbox(actor)).items.filter((r: any) => r.condition_kind === "project_issue" && r.condition_id === id);

  it("counts only delivered issues, independent of read and legacy dismissal", async () => {
    const before = await counts(), f = await issueFixture();
    const unalerted = await activity(f.project, "issue", false);
    expect(await issueRows(unalerted.activity_id)).toEqual([]);
    const [row] = await issueRows(f.issue.activity_id);
    expect(row).toMatchObject({ condition_status: "active", title: "Owned activity", read_at: null });
    await call("select * from public.mark_project_alert_read($1)", [row.notification_id]);
    await call("select * from public.dismiss_project_alert_notification($1)", [row.notification_id]);
    expect((await issueRows(f.issue.activity_id))[0]).toMatchObject({ condition_status: "active" });
    const after = await counts();
    expect(BigInt(after.active_problems)).toBe(BigInt(before.active_problems) + 1n);
    expect(BigInt(after.unresolved_project_issues)).toBe(BigInt(before.unresolved_project_issues) + 1n);
  });
  it("authoritative resolution stops count even with unread resolution; retry does not duplicate", async () => {
    const f = await issueFixture(), before = await counts(), request = randomUUID();
    await call("select * from public.resolve_project_issue($1,$2,'Fixed safely')", [f.issue.activity_id, request]);
    await call("select * from public.resolve_project_issue($1,$2,'Fixed safely')", [f.issue.activity_id, request]);
    expect(await issueRows(f.issue.activity_id)).toHaveLength(1);
    expect((await issueRows(f.issue.activity_id))[0]).toMatchObject({ condition_status: "resolved", resolution_description: "Fixed safely", read_at: null });
    expect(BigInt((await counts()).active_problems)).toBe(BigInt(before.active_problems) - 1n);
    expect((await inbox(admin, "active")).items.some((r: any) => r.condition_id === f.issue.activity_id)).toBe(false);
  });
  it("keeps general updates separate and uses existing unread/read/dismiss receipts", async () => {
    const f = await issueFixture(), before = await counts();
    const update = await activity(f.project, "general");
    const get = async () => (await call("select public.list_dashboard_informational_updates_v2(50) value", []))[0].value;
    const row = (await get()).items.find((r: any) => r.activity_id === update.activity_id);
    expect(row).toBeDefined(); expect((await counts()).active_problems).toBe(before.active_problems);
    expect(BigInt((await counts()).unread_updates)).toBe(BigInt(before.unread_updates) + 1n);
    await call("select * from public.mark_project_alert_read($1)", [row.notification_id]);
    expect((await counts()).unread_updates).toBe(before.unread_updates);
    expect((await get()).items.find((r: any) => r.activity_id === update.activity_id).read_at).not.toBeNull();
    await call("select * from public.dismiss_project_alert_notification($1)", [row.notification_id]);
    expect((await get()).items.some((r: any) => r.activity_id === update.activity_id)).toBe(false);
  });
  it("does not grant an issue audience to resolution-only or newly authorized recipients", async () => {
    await grants(["dashboard.view", "projects.view"]);
    const f = await issueFixture();
    expect(await issueRows(f.issue.activity_id, member)).toEqual([]);
    await call("select * from public.resolve_project_issue($1,$2,'Resolved')", [f.issue.activity_id, randomUUID()]);
    expect(await issueRows(f.issue.activity_id, member)).toEqual([]);
    const delivered = await db.query("select 1 from public.project_activity_alert_recipients r join public.project_activity_alerts a on a.id=r.alert_id where r.recipient_user_id=$1 and a.project_activity_id=$2 and a.notification_kind='issue_resolved'", [member.id, f.issue.activity_id]);
    expect(delivered.rowCount).toBe(1);
  });
  it("preserves delivered member audience, current module permissions and recipient-only receipts", async () => {
    await grants(["dashboard.view", "projects.view", "projects.alerts.receive"]);
    const f = await issueFixture(), [a] = await issueRows(f.issue.activity_id), [b] = await issueRows(f.issue.activity_id, member);
    expect(a.condition_id).toBe(b.condition_id); expect(a.notification_id).not.toBe(b.notification_id);
    await call("select * from public.mark_project_alert_read($1)", [b.notification_id], member);
    expect((await issueRows(f.issue.activity_id))[0].read_at).toBeNull();
    await grants(["dashboard.view"]);
    expect((await inbox(member)).items).toEqual([]); expect((await counts(member)).active_problems).toBe("0");
    await grants(["projects.view"]); await expect(counts(member)).rejects.toMatchObject({ code: "42501" });
    await grants(["dashboard.view", "projects.view"]);
    await db.query("update public.user_profiles set is_active=false where id=$1", [member.id]);
    await expect(counts(member)).rejects.toMatchObject({ code: "42501" });
  });
  it("integrates Project shortage resolution/recurrence and exact bigint quantities without message duplication", async () => {
    const before = await counts(), f = await fixture("9007199254740993");
    const ownRows = async () => (await inbox()).items.filter((r: any) => r.project_id === f.project);
    expect((await ownRows())[0].shortage_quantity).toBe("9007199254740993");
    expect(BigInt((await counts()).active_problems)).toBe(BigInt(before.active_problems) + 1n);
    const id = (await ownRows())[0].condition_id;
    await change(f, "0"); expect((await counts()).active_problems).toBe(before.active_problems);
    await change(f, "4"); expect(await ownRows()).toHaveLength(2);
    expect((await ownRows()).filter((r: any) => r.condition_status === "active")).toHaveLength(1);
    expect((await ownRows()).find((r: any) => r.condition_id === id).condition_status).toBe("resolved");
  });
  it("uses the existing WO episode projection and does not resolve a condition on read", async () => {
    const original = await counts(), f = await fixture(); await activity(f.project);
    const before = await counts(), id = randomUUID();
    expect(BigInt(before.active_problems)).toBe(BigInt(original.active_problems) + 2n);
    const number = (await db.query("select 'RN-8993-'||lpad(n::text,4,'0') v from generate_series(1,9999) n where not exists(select 1 from public.work_orders where work_order_number='RN-8993-'||lpad(n::text,4,'0')) order by n limit 1")).rows[0].v;
    await db.query("insert into public.work_orders(id,work_order_number,project_id,customer_name_snapshot,description,created_by_user_id,updated_by_user_id) values($1,$2,$3,'Owned','Owned alerts',$4,$4)", [id, number, f.project, admin.id]);
    await db.query("insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id) values($1,$2,7,$3)", [id, f.product, admin.id]); await flush();
    const [row] = (await inbox()).items.filter((r: any) => r.work_order_id === id);
    expect(row).toMatchObject({ condition_kind: "work_order_shortage", shortage_quantity: "7", work_order_number: number });
    expect(BigInt((await counts()).active_work_order_shortages)).toBe(BigInt(before.active_work_order_shortages) + 1n);
    expect(BigInt((await counts()).active_problems)).toBe(BigInt(original.active_problems) + 3n);
    await call("select public.mark_dashboard_notification_read($1)", [row.notification_id]);
    expect(BigInt((await counts()).active_problems)).toBe(BigInt(before.active_problems) + 1n);
    await db.query("delete from public.work_order_items where work_order_id=$1", [id]); await flush();
    expect((await counts()).active_problems).toBe(before.active_problems);
    const resolved = (await inbox()).items.find((r: any) => r.condition_id === row.condition_id);
    expect(resolved.condition_status).toBe("resolved"); expect(resolved.resolved_at).not.toBeNull();
    await db.query("insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id) values($1,$2,3,$3)", [id, f.product, admin.id]); await flush();
    const active = (await inbox()).items.filter((r: any) => r.work_order_id === id && r.condition_status === "active");
    expect(active).toHaveLength(1); expect(active[0].condition_id).not.toBe(row.condition_id);
    expect(BigInt((await counts()).active_problems)).toBe(BigInt(before.active_problems) + 1n);
  });
  it("paginates stable condition identities with no duplicates and validates bounds", async () => {
    const f = await issueFixture(); for (let i=0;i<4;i++) await activity(f.project);
    let cursor: any = null; const seen: string[] = []; let pages = 0;
    do {
      const page = (await call("select public.list_dashboard_problem_conditions_v2(2,$1,$2,$3) value", [cursor?.before_created_at ?? null, cursor?.before_kind ?? null, cursor?.before_id ?? null]))[0].value;
      expect(page.as_of).toBeTruthy(); seen.push(...page.items.map((r: any) => `${r.condition_kind}:${r.condition_id}`));
      cursor = page.next_cursor; expect(page.has_more).toBe(cursor !== null); if (++pages>100) throw Error("Unbounded pagination");
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toContain(`project_issue:${f.issue.activity_id}`);
    for (const n of [0,51,null]) await expect(call("select public.list_dashboard_problem_conditions_v2($1)", [n])).rejects.toMatchObject({ code: "22023" });
    await expect(call("select public.list_dashboard_problem_conditions_v2(2,now(),null,null)", [])).rejects.toMatchObject({ code: "22023" });
    await expect(call("select public.list_dashboard_problem_conditions_v2(2,null,null,null,'unread')", [])).rejects.toMatchObject({ code: "22023" });
    const c = await counts(); expect(BigInt(c.active_problems)).toBe(BigInt(c.active_work_order_shortages)+BigInt(c.active_project_shortages)+BigInt(c.unresolved_project_issues));
  });
  it("denies direct helpers and cross-recipient delegation, including Admin", async () => {
    await db.query(`create function public.test_issue_conditions(uuid) returns jsonb language sql stable security definer set search_path='' as
      'select coalesce(jsonb_agg(item),''[]''::jsonb) from public.project_issue_condition_rows($1)';
      revoke all on function public.test_issue_conditions(uuid) from public; grant execute on function public.test_issue_conditions(uuid) to authenticated`);
    await expect(call("select public.test_issue_conditions($1)", [member.id])).rejects.toMatchObject({ code: "42501" });
    for (const role of ["anon", "service_role"]) await expect(call("select public.get_dashboard_active_problem_counts_v2()", [], admin, role)).rejects.toMatchObject({ code: "42501" });
    await expect(call("select public.get_dashboard_active_problem_counts_v2()", [], { ...admin, auth_user_id: "" })).rejects.toMatchObject({ code: "42501" });
    for (const fn of ["project_issue_condition_rows", "dashboard_problem_condition_rows_v2", "dashboard_informational_update_rows_v2"]) {
      await expect(call(`select * from public.${fn}($1)`, [admin.id])).rejects.toMatchObject({ code: "42501" });
    }
  });
  it("deduplicates actor-bound issue posting retries and resolution messages", async () => {
    const f = await issueFixture(), source = f.issue;
    const before = await counts();
    const replay = (await call("select * from public.post_project_activity($1,$2,'Owned activity','Original immutable description',true,'issue')", [f.project, source.request_id]))[0];
    expect(replay.activity_id).toBe(source.activity_id);
    expect(await issueRows(source.activity_id)).toHaveLength(1); expect((await counts()).active_problems).toBe(before.active_problems);
    await expect(call("select * from public.post_project_activity($1,$2,'Changed title','Original immutable description',true,'issue')", [f.project, source.request_id])).rejects.toMatchObject({ code: "PAC01" });
  });
  it("new reads are side-effect-free and old public count contracts remain unchanged", async () => {
    await issueFixture(); const before = await reservationSnapshot(db);
    const old = (await call("select public.get_dashboard_alert_counts() v", []))[0].v;
    await counts(); await inbox(); await call("select public.list_dashboard_informational_updates_v2()", []);
    expect(await reservationSnapshot(db)).toEqual(before);
    expect((await call("select public.get_dashboard_alert_counts() v", []))[0].v).toMatchObject({
      active_work_order_shortages: old.active_work_order_shortages, unread_project_notifications: old.unread_project_notifications,
    });
  });
});
