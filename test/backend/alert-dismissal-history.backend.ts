import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ReservationLocalTarget, reservationSnapshot, type LocalReservationPool } from "./helpers/reservation-local-target";

const migration = "20261031120000_protect_active_project_alerts_and_add_history.sql";
const files = readdirSync("supabase/migrations").filter(f =>
  /^\d{14}_.+\.sql$/.test(f) && f.slice(0, 14) <= "20261031120000").sort();
const hashes = () => files.slice(0, 184).map(f => createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"));
const historical = hashes();
type Actor = { id: string; auth_user_id: string };

describe.skipIf(process.env.ALERT_HISTORY_LOCAL !== "1")("185 Dismissal and History — owned disposable database", () => {
  const target = new ReservationLocalTarget();
  const name = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  let source: LocalReservationPool, pool: LocalReservationPool, db: PoolClient;
  let sourceBefore: unknown, baseline: unknown, created = false;
  let admin: Actor, member: Actor;
  let concurrentIssue: { activity_id: string; notification_id: string };
  async function snapshot(p: LocalReservationPool) {
    const c = await p.connect(); try { return await reservationSnapshot(c); } finally { c.release(true); }
  }
  beforeAll(async () => {
    if (process.env.ALERT_HISTORY_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw Error("Owned local peer scope required");
    expect(files).toHaveLength(185); expect(files[184]).toBe(migration);
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
      for (const file of files.slice(150, 184)) {
        await setup.query("begin"); await setup.query(readFileSync(`supabase/migrations/${file}`, "utf8")); await setup.query("commit");
      }
      const before = await reservationSnapshot(setup);
      const contracts = (await setup.query("select oid::text id,md5(to_jsonb(p)::text) digest from pg_proc p where pronamespace='public'::regnamespace and proname not in ('dismiss_project_alert_notification','dashboard_alert_page_v2') order by oid")).rows;
      await setup.query("begin"); await setup.query(readFileSync(`supabase/migrations/${migration}`, "utf8")); await setup.query("commit");
      const after = await reservationSnapshot(setup);
      for (const [key, value] of Object.entries(before)) if (key !== "security") expect(after[key]).toEqual(value);
      expect((await setup.query("select oid::text id,md5(to_jsonb(p)::text) digest from pg_proc p where oid=any($1::oid[]) order by oid", [contracts.map(r => r.id)])).rows).toEqual(contracts);
      admin = (await setup.query("select id,auth_user_id from public.user_profiles where is_active and is_admin order by id limit 1")).rows[0];
      member = (await setup.query("select id,auth_user_id from public.user_profiles where is_active and not is_admin order by id limit 1")).rows[0];
      if (!admin || !member) throw Error("Existing isolated actor fixtures required");
      // Committed only inside the newly owned clone so independent clients can
      // exercise real resolve/dismiss waits. The entire clone is later removed.
      await setup.query("begin");
      await setup.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.auth_user_id]);
      const concurrentProject=randomUUID();
      await setup.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,'Owned concurrency issue','Owned',current_date,current_date+1,$2,$2)",[concurrentProject,admin.id]);
      const posted=(await setup.query("select * from public.post_project_activity($1,$2,'Concurrent issue','Owned resolve/dismiss fixture',true,'issue')",[concurrentProject,randomUUID()])).rows[0];
      concurrentIssue=(await setup.query("select $1::uuid activity_id,r.id notification_id from public.project_activity_alert_recipients r where r.alert_id=$2 and r.recipient_user_id=$3",[posted.activity_id,posted.alert_id,admin.id])).rows[0];
      await setup.query("commit");
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


  const history = async (actor = admin) => (await call("select public.list_dashboard_alert_history_v2(50) value", [], actor))[0].value;
  const ack = async (kind: string, id: string, actor = admin) => (await call("select public.acknowledge_dashboard_problem_v2($1,$2) value", [kind,id], actor))[0].value;
  const historyRows = async (id: string, actor = admin) => (await history(actor)).items.filter((r: any) => r.condition_id === id);
  const projectRows = async (project: string, actor = admin) => (await inbox(actor)).items.filter((r: any) => r.project_id === project);
  async function resolveIssue(f: Awaited<ReturnType<typeof issueFixture>>) {
    await call("select * from public.resolve_project_issue($1,$2,'Resolved with original history retained')", [f.issue.activity_id, randomUUID()]);
  }
  async function legacyDismiss(notification: string) {
    // Seed only an owned clone with a valid one-way receipt from the old era.
    // The migration never backfills or rewrites these historical receipts.
    await db.query("update public.project_activity_alert_recipients set dismissed_at=greatest(clock_timestamp(),created_at) where id=$1", [notification]);
  }
  it("rejects active Project shortage dismissal through direct, generic and condition RPCs", async () => {
    const f=await fixture(), [row]=await projectRows(f.project), before=await counts();
    for (const sql of ["select * from public.dismiss_project_alert_notification($1)","select * from public.dismiss_dashboard_notification($1)"]) {
      await expect(call(sql,[row.notification_id])).rejects.toMatchObject({code:"55000"});
    }
    await expect(ack('project_shortage',row.condition_id)).rejects.toMatchObject({code:"55000"});
    await call("select * from public.mark_project_alert_read($1)",[row.notification_id]);
    expect((await counts()).active_problems).toBe(before.active_problems);
    expect((await projectRows(f.project))[0].condition_status).toBe('active');
  });
  it("rejects unresolved alerted issue dismissal through every legacy route",async()=>{
    const f=await issueFixture(),[row]=await issueRows(f.issue.activity_id),before=await counts();
    await expect(call("select * from public.dismiss_project_alert_notification($1)",[row.notification_id])).rejects.toMatchObject({code:"55000"});
    await expect(call("select * from public.dismiss_dashboard_notification($1)",[row.notification_id])).rejects.toMatchObject({code:"55000"});
    await expect(ack('project_issue',row.condition_id)).rejects.toMatchObject({code:"55000"});
    await call("select * from public.mark_dashboard_notification_read($1)",[row.notification_id]);
    expect((await counts()).active_problems).toBe(before.active_problems);
  });
  it("keeps previously dismissed active shortages and issues visible without rewriting receipts",async()=>{
    const f=await fixture(),i=await activity(f.project);
    const rows=await projectRows(f.project); expect(rows).toHaveLength(2);
    for(const row of rows) await legacyDismiss(row.notification_id);
    const before=await reservationSnapshot(db),c=await counts();
    expect(await projectRows(f.project)).toHaveLength(2); expect(await issueRows(i.activity_id)).toHaveLength(1);
    expect(await reservationSnapshot(db)).toEqual(before);
    expect(BigInt(c.active_project_shortages)).toBeGreaterThan(0n); expect(BigInt(c.unresolved_project_issues)).toBeGreaterThan(0n);
    for(const row of rows) await expect(call("select * from public.dismiss_project_alert_notification($1)",[row.notification_id])).rejects.toMatchObject({code:"55000"});
  });
  it("acknowledges resolved Project shortages once and retains one historical condition",async()=>{
    const f=await fixture(),[opening]=await projectRows(f.project); await change(f,'0');
    const before=await historyRows(opening.condition_id); expect(before).toHaveLength(1); expect(before[0].acknowledged_at).toBeNull();
    const first=await ack('project_shortage',opening.condition_id),second=await ack('project_shortage',opening.condition_id);
    expect(second).toEqual(first); expect(first.acknowledged_at).toBeTruthy();
    expect(await projectRows(f.project)).toEqual([]);
    expect(await historyRows(opening.condition_id)).toHaveLength(1);
    expect((await historyRows(opening.condition_id))[0]).toMatchObject({condition_status:'resolved',acknowledged_at:first.acknowledged_at});
    expect((await db.query("select count(*)::int n from public.project_condition_acknowledgments where condition_id=$1",[opening.condition_id])).rows[0].n).toBe(1);
    await change(f,'3'); const active=(await projectRows(f.project)).filter((r:any)=>r.condition_status==='active');
    expect(active).toHaveLength(1); expect(active[0].condition_id).not.toBe(opening.condition_id);
  });
  it("resolved issue acknowledgment preserves content, resolver and original read receipts",async()=>{
    const f=await issueFixture(),[row]=await issueRows(f.issue.activity_id);await legacyDismiss(row.notification_id);
    const receipt=(await db.query("select dismissed_at::text stamp from public.project_activity_alert_recipients where id=$1",[row.notification_id])).rows[0].stamp;
    await resolveIssue(f); const before=(await historyRows(row.condition_id))[0];expect(before.acknowledged_at).toBeNull();
    const a=await ack('project_issue',row.condition_id);expect(await ack('project_issue',row.condition_id)).toEqual(a);
    expect(await issueRows(row.condition_id)).toEqual([]);
    const [h]=await historyRows(row.condition_id);expect(h).toMatchObject({description:'Original immutable description',resolution_description:'Resolved with original history retained',read_at:null});
    expect(h.resolver_full_name).toBeTruthy();expect(h.acknowledged_at).toBe(a.acknowledged_at);
    expect((await db.query("select dismissed_at::text stamp from public.project_activity_alert_recipients where id=$1",[row.notification_id])).rows[0].stamp).toBe(receipt);
  });
  it("direct resolved-message dismissal acknowledges the condition, not a second inbox event",async()=>{
    const f=await issueFixture();await resolveIssue(f);
    const r=(await db.query("select r.id from public.project_activity_alert_recipients r join public.project_activity_alerts n on n.id=r.alert_id where r.recipient_user_id=$1 and n.project_activity_id=$2 and n.notification_kind='issue_resolved'",[admin.id,f.issue.activity_id])).rows[0];
    const result=await call("select * from public.dismiss_dashboard_notification($1)",[r.id]);expect(Object.keys(result[0]).sort()).toEqual(['dismissed_at','notification_id']);
    expect(await issueRows(f.issue.activity_id)).toEqual([]);expect(await historyRows(f.issue.activity_id)).toHaveLength(1);
    expect((await historyRows(f.issue.activity_id))[0].acknowledged_at).not.toBeNull();
  });
  it("retains resolution-only Issue history without granting active subscription",async()=>{
    const f=await issueFixture();await resolveIssue(f);
    expect(await issueRows(f.issue.activity_id,member)).toEqual([]);
    const [h]=await historyRows(f.issue.activity_id,member);expect(h.condition_status).toBe('resolved');
    await ack('project_issue',f.issue.activity_id,member);expect((await historyRows(f.issue.activity_id,member))[0].acknowledged_at).not.toBeNull();
    expect((await historyRows(f.issue.activity_id))[0].acknowledged_at).toBeNull();
  });
  it("denies cross-recipient dismissal even for Admin and denies missing module/inactive actors",async()=>{
    await grants(['dashboard.view','projects.view','projects.alerts.receive']);const f=await issueFixture();await resolveIssue(f);
    const [other]=await issueRows(f.issue.activity_id,member);
    await expect(call("select * from public.dismiss_project_alert_notification($1)",[other.notification_id])).rejects.toMatchObject({code:'P0002'});
    await ack('project_issue',f.issue.activity_id);expect((await historyRows(f.issue.activity_id,member))[0].acknowledged_at).toBeNull();
    await grants(['dashboard.view']);expect((await history(member)).items).toEqual([]);
    await expect(ack('project_issue',f.issue.activity_id,member)).rejects.toMatchObject({code:'P0002'});
    await grants(['dashboard.view','projects.view']);await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);
    await expect(history(member)).rejects.toMatchObject({code:'42501'});
  });
  it("preserves general update unread/read/dismiss semantics with no condition acknowledgment",async()=>{
    const f=await issueFixture(),before=await counts(),u=await activity(f.project,'general');
    const page=(await call("select public.list_dashboard_informational_updates_v2(50) value",[]))[0].value;
    const row=page.items.find((r:any)=>r.activity_id===u.activity_id);expect(row).toBeDefined();
    expect(BigInt((await counts()).unread_updates)).toBe(BigInt(before.unread_updates)+1n);
    await call("select * from public.dismiss_project_alert_notification($1)",[row.notification_id]);
    expect((await counts()).unread_updates).toBe(before.unread_updates);
    expect((await counts()).active_problems).toBe(before.active_problems);
    expect((await db.query("select count(*)::int n from public.project_condition_acknowledgments")).rows[0].n).toBe(0);
  });
  it("retains legacy resolution-message dismissals in deduplicated History",async()=>{
    const f=await fixture(),[opening]=await projectRows(f.project);await change(f,'0');
    const resolution=(await db.query("select r.id from public.project_activity_alert_recipients r join public.project_activity_alerts n on n.id=r.alert_id join public.project_shortage_events e on e.id=n.project_shortage_event_id where r.recipient_user_id=$1 and e.episode_id=$2 and e.event_type='resolved'",[admin.id,opening.condition_id])).rows[0];
    await legacyDismiss(resolution.id);
    const [h]=await historyRows(opening.condition_id);expect(h.acknowledged_at).not.toBeNull();expect(await projectRows(f.project)).toEqual([]);
    expect((await db.query("select count(*)::int n from public.project_condition_acknowledgments")).rows[0].n).toBe(0);
  });
  it("paginates retained resolved conditions without duplicates and rejects invalid cursors",async()=>{
    const f=await issueFixture();await resolveIssue(f);
    for(let i=0;i<3;i++){const a=await activity(f.project);await call("select * from public.resolve_project_issue($1,$2,'Done')",[a.activity_id,randomUUID()]);await ack('project_issue',a.activity_id);}
    let cursor:any=null;const seen:string[]=[];let pages=0;
    do {const p=(await call("select public.list_dashboard_alert_history_v2(2,$1,$2,$3) value",[cursor?.before_resolved_at??null,cursor?.before_kind??null,cursor?.before_id??null]))[0].value;
      expect(p.as_of).toBeTruthy();for(const row of p.items){expect(row.condition_status).toBe('resolved');expect(row).toHaveProperty('acknowledged_at');seen.push(`${row.condition_kind}:${row.condition_id}`);}
      cursor=p.next_cursor;expect(p.has_more).toBe(cursor!==null);if(++pages>100)throw Error('Unbounded pages');
    }while(cursor);
    expect(new Set(seen).size).toBe(seen.length);expect(seen).toContain(`project_issue:${f.issue.activity_id}`);
    for(const n of [0,51,null])await expect(call("select public.list_dashboard_alert_history_v2($1)",[n])).rejects.toMatchObject({code:'22023'});
    await expect(call("select public.list_dashboard_alert_history_v2(2,now(),null,null)",[])).rejects.toMatchObject({code:'22023'});
  });
  it("keeps acknowledgment tables and helpers private and acknowledgment history immutable",async()=>{
    const f=await issueFixture();await resolveIssue(f);await ack('project_issue',f.issue.activity_id);
    for(const role of ['authenticated','anon','service_role']){
      await expect(call("select * from public.project_condition_acknowledgments",[],admin,role)).rejects.toMatchObject({code:'42501'});
      await expect(call("select * from public.dashboard_alert_history_rows_v2($1)",[admin.id],admin,role)).rejects.toMatchObject({code:'42501'});
    }
    await expect(call("select public.list_dashboard_alert_history_v2()",[],admin,'anon')).rejects.toMatchObject({code:'42501'});
    expect((await db.query("select relrowsecurity from pg_class where oid='public.project_condition_acknowledgments'::regclass")).rows[0].relrowsecurity).toBe(true);
    await db.query('savepoint immutable');try{await db.query("delete from public.project_condition_acknowledgments");throw Error('Mutable history');}catch(e){expect(e).toMatchObject({code:'55000'});await db.query('rollback to savepoint immutable;release savepoint immutable');}
  });
  it("retains resolved WO History after existing dismissal and preserves owner/module isolation",async()=>{
    await grants(['dashboard.view','work_orders.view']);const f=await fixture(),id=randomUUID();
    const number=(await db.query("select 'RN-8992-'||lpad(n::text,4,'0') v from generate_series(1,9999) n where not exists(select 1 from public.work_orders where work_order_number='RN-8992-'||lpad(n::text,4,'0')) order by n limit 1")).rows[0].v;
    await db.query("insert into public.work_orders(id,work_order_number,project_id,customer_name_snapshot,description,created_by_user_id,updated_by_user_id) values($1,$2,$3,'Owned','History fixture',$4,$4)",[id,number,f.project,admin.id]);
    await db.query("insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id) values($1,$2,7,$3)",[id,f.product,admin.id]);await flush();
    const row=(await inbox()).items.find((r:any)=>r.work_order_id===id);
    await expect(ack('work_order_shortage',row.condition_id)).rejects.toMatchObject({code:'55000'});
    await db.query("delete from public.work_order_items where work_order_id=$1",[id]);await flush();
    expect((await historyRows(row.condition_id,member))[0]).toMatchObject({work_order_number:number,condition_kind:'work_order_shortage',acknowledged_at:null});
    const a=await ack('work_order_shortage',row.condition_id);expect(await ack('work_order_shortage',row.condition_id)).toEqual(a);
    expect((await inbox()).items.some((r:any)=>r.condition_id===row.condition_id)).toBe(false);
    const [h]=await historyRows(row.condition_id);expect(h.acknowledged_at).toBe(a.acknowledged_at);expect(h.read_at).not.toBeNull();
    expect((await historyRows(row.condition_id,member))[0].acknowledged_at).toBeNull();
    expect((await inbox(member)).items.some((r:any)=>r.condition_id===row.condition_id)).toBe(true);
    await grants(['dashboard.view','projects.view']);expect(await historyRows(row.condition_id,member)).toEqual([]);
  });
  it("serializes resolve/dismiss and rechecks authoritative state after rollback or commit",async()=>{
    const branch=await pool.connect();let committed=false;
    const pid=(await db.query('select pg_backend_pid() pid')).rows[0].pid;
    const beginResolution=async()=>{
      await branch.query("begin;set local statement_timeout='8s';set local lock_timeout='5s'");
      await branch.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.auth_user_id]);
      await branch.query('set local role authenticated');
      await branch.query("select * from public.resolve_project_issue($1,$2,'Concurrent resolution')",[concurrentIssue.activity_id,randomUUID()]);
      await branch.query('reset role'); // Local test observer only; the mutation ran as authenticated.
    };
    const waitForLock=async()=>{
      for(let i=0;i<40;i++){
        await branch.query('select pg_stat_clear_snapshot()');
        if((await branch.query("select wait_event_type from pg_stat_activity where pid=$1",[pid])).rows[0]?.wait_event_type==='Lock')return;
        await new Promise(resolve=>setTimeout(resolve,20));
      }throw Error('Expected source lock wait');
    };
    try{
      await beginResolution();
      const rejected=call("select * from public.dismiss_project_alert_notification($1)",[concurrentIssue.notification_id]).then(value=>({value,error:null as any}),error=>({value:null,error}));
      await waitForLock();await branch.query('rollback');
      expect((await rejected).error).toMatchObject({code:'55000'});
      await beginResolution();
      const accepted=call("select * from public.dismiss_dashboard_notification($1)",[concurrentIssue.notification_id]);
      await waitForLock();await branch.query('commit');committed=true;
      expect((await accepted)[0].dismissed_at).toBeTruthy();
      expect((await historyRows(concurrentIssue.activity_id))[0].acknowledged_at).not.toBeNull();
      expect(await issueRows(concurrentIssue.activity_id)).toEqual([]);
    }finally{
      await branch.query('rollback');branch.release(true);
      // Retain the committed resolution only in the disposable baseline; the
      // primary transaction's acknowledgment still rolls back after this test.
      if(committed)baseline=await snapshot(pool);
    }
  });
});
