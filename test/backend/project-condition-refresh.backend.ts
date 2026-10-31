import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ReservationLocalTarget, reservationSnapshot, runPinnedDocker, containerArguments, LOCAL_RESERVATION, type LocalReservationPool } from "./helpers/reservation-local-target";
// Parse actual owned-clone SQL responses without constructing any remote client.
vi.mock('../../lib/supabase/client',()=>({supabase:{rpc:()=>{throw Error('Remote RPC forbidden in local integration');}}}));
import { parseActiveProblemCounts, parseAlertPage, parseAcknowledgment, type AlertCursor, type AlertPage, type AlertResult } from '../../features/dashboard/services/activeAlertsV2Service';

const migration = "20261031130000_refresh_project_alert_conditions.sql";
const files = readdirSync("supabase/migrations").filter(f =>
  /^\d{14}_.+\.sql$/.test(f) && f.slice(0, 14) <= "20261031130000").sort();
const hashes = () => files.slice(0, 185).map(f => createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"));
const historical = hashes();
type Actor = { id: string; auth_user_id: string };

describe.skipIf(process.env.CONDITION_REFRESH_LOCAL !== "1")("186 Condition Refresh — owned disposable database", () => {
  const target = new ReservationLocalTarget();
  const name = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  let source: LocalReservationPool, pool: LocalReservationPool, db: PoolClient;
  let sourceBefore: unknown, baseline: unknown, created = false;
  let admin: Actor, member: Actor;
  async function snapshot(p: LocalReservationPool) {
    const c = await p.connect(); try { return await reservationSnapshot(c,true); } finally { c.release(true); }
  }
  beforeAll(async () => {
    if (process.env.CONDITION_REFRESH_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw Error("Owned local peer scope required");
    expect(files).toHaveLength(186); expect(files[185]).toBe(migration);
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
      for (const file of files.slice(150, 185)) {
        await setup.query("begin"); await setup.query(readFileSync(`supabase/migrations/${file}`, "utf8")); await setup.query("commit");
      }
      // The pinned local source's Realtime partitions stop on October 26.
      // Supply today's transport partition ONLY in this newly owned clone;
      // never mock realtime.send or alter the shared source/provider function.
      target.assertDatabaseAllowed(name);target.verifyDocker();
      const ownedOid=(await setup.query("select oid::text oid from pg_database where datname=current_database()")).rows[0].oid;
      const transportFixture=`do $guard$ begin
        if current_database()<>'${name}' or current_user<>'supabase_admin' or session_user<>'supabase_admin'
          or inet_server_addr() is not null or (select oid::text from pg_database where datname=current_database())<>'${ownedOid}'
          or (select system_identifier::text from pg_control_system())<>'${LOCAL_RESERVATION.cluster}' then raise exception 'Owned clone identity required'; end if; end $guard$;
        do $fixture$ declare lower_bound timestamp:=current_date::timestamp;
        upper_bound timestamp:=(current_date+1)::timestamp; begin
        if pg_get_partkeydef('realtime.messages'::regclass)<>'RANGE (inserted_at)' then raise exception 'Unexpected Realtime partition contract'; end if;
        if not exists(select 1 from pg_class c join pg_inherits i on i.inhrelid=c.oid
          where i.inhparent='realtime.messages'::regclass and pg_get_expr(c.relpartbound,c.oid)=format('FOR VALUES FROM (%L) TO (%L)',lower_bound::text,upper_bound::text)) then
          execute format('create table realtime.test_condition_refresh_current partition of realtime.messages for values from (%L) to (%L)',lower_bound,upper_bound);
          revoke all on realtime.test_condition_refresh_current from public,anon,authenticated,service_role;
        end if; end $fixture$;`;
      // Same pinned peer-authenticated privileged role used by the reviewed clone
      // restore, restricted above to this exact newly-owned database/OID only.
      runPinnedDocker(containerArguments([`${LOCAL_RESERVATION.pgBin}/psql`,'--no-password','--no-psqlrc','--quiet','--set','ON_ERROR_STOP=1',
        '--dbname',`host=${LOCAL_RESERVATION.socketDirectory} port=5432 dbname=${name} user=supabase_admin passfile=/dev/null sslmode=disable application_name=${target.application}`,
        '--file','-'],'supabase_admin',true),Buffer.from(transportFixture));
      const before = await reservationSnapshot(setup,true);
      const contracts = (await setup.query("select oid::text id,md5(to_jsonb(p)::text) digest from pg_proc p where pronamespace in ('public'::regnamespace,'realtime'::regnamespace) and proname<>'broadcast_project_alert_notification_invalidation' order by oid")).rows;
      await setup.query("begin"); await setup.query(readFileSync(`supabase/migrations/${migration}`, "utf8")); await setup.query("commit");
      const after = await reservationSnapshot(setup,true);
      for (const [key, value] of Object.entries(before)) if (key !== "security") expect(after[key]).toEqual(value);
      expect((await setup.query("select oid::text id,md5(to_jsonb(p)::text) digest from pg_proc p where oid=any($1::oid[]) order by oid", [contracts.map(r => r.id)])).rows).toEqual(contracts);
      admin = (await setup.query("select id,auth_user_id from public.user_profiles where is_active and is_admin order by id limit 1")).rows[0];
      member = (await setup.query("select id,auth_user_id from public.user_profiles where is_active and not is_admin order by id limit 1")).rows[0];
      if (!admin || !member) throw Error("Existing isolated actor fixtures required");
      baseline = await reservationSnapshot(setup,true);
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


  type Signal={id:string;topic:string;payload:unknown;event:string;private:boolean};
  const topic=(id:string)=>`project-alert-notifications:${id}`;
  const signals=async(client=db):Promise<Signal[]> => (await client.query("select id::text,topic,payload,event,private from realtime.messages where extension='broadcast' and topic like 'project-alert-notifications:%' order by id")).rows;
  const fresh=async(before:Signal[])=>{const ids=new Set(before.map(s=>s.id));return(await signals()).filter(s=>!ids.has(s.id));};
  function assertPrivate(rows:Signal[]){expect(rows.length).toBeGreaterThan(0);for(const s of rows){
    expect(s).toMatchObject({event:'invalidate',private:true});
    // The installed Supabase transport adds only an opaque message UUID to {}.
    expect(s.payload).toEqual({id:s.id});
  }}
  const recipients=async(project:string)=>(await db.query("select distinct r.recipient_user_id id from public.project_activity_alert_recipients r join public.project_activity_alerts n on n.id=r.alert_id left join public.project_activity_updates a on a.id=n.project_activity_id where coalesce(n.project_id,a.project_id)=$1 order by id",[project])).rows.map(r=>r.id as string);
  const notificationCount=async(project:string)=>(await db.query("select count(*)::int n from public.project_activity_alerts n left join public.project_activity_updates a on a.id=n.project_activity_id where coalesce(n.project_id,a.project_id)=$1",[project])).rows[0].n;

  it('accepts real SQL lifecycle/count/history/acknowledgment responses in the strict frontend parsers',async()=>{
    const requireValue=<T,>(result:AlertResult<T>):T=>{expect(result.ok).toBe(true);if(!result.ok)throw Error('SQL/frontend contract mismatch');return result.value;};
    const count=async()=>requireValue(parseActiveProblemCounts(await counts()));
    const initial=await count(),f=await fixture('9007199254740993'),issue=await activity(f.project),unalerted=await activity(f.project,'issue',false);
    const update=await activity(f.project,'general'),workOrder=randomUUID();
    const number=(await db.query("select 'RN-8990-'||lpad(n::text,4,'0') v from generate_series(1,9999)n where not exists(select 1 from public.work_orders where work_order_number='RN-8990-'||lpad(n::text,4,'0')) order by n limit 1")).rows[0].v;
    await db.query("insert into public.work_orders(id,work_order_number,project_id,customer_name_snapshot,description,created_by_user_id,updated_by_user_id) values($1,$2,$3,'Owned','Integrated contracts',$4,$4)",[workOrder,number,f.project,admin.id]);
    await db.query("insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id) values($1,$2,7,$3)",[workOrder,f.product,admin.id]);await flush();
    const active=requireValue(parseAlertPage(await inbox(admin,'active'),{feed:'conditions',status:'active',limit:50}));
    const owned=active.items.filter(i=>i.targetId===f.project||i.targetId===workOrder);
    expect(owned.map(i=>i.kind).sort()).toEqual(['project_issue','project_shortage','work_order_shortage']);
    expect(owned.some(i=>i.id===unalerted.activity_id)).toBe(false);
    const shortage=owned.find(i=>i.kind==='project_shortage')!;
    expect(shortage.shortageQuantity).toBe('9007199254740993');
    const beforeRead=await count();expect(BigInt(beforeRead.activeProblems)).toBe(BigInt(initial.activeProblems)+3n);
    for(const row of owned)await call('select * from public.mark_dashboard_notification_read($1)',[row.notificationId]);
    expect((await count()).activeProblems).toBe(beforeRead.activeProblems);
    await change(f,'8');expect((await count()).activeProblems).toBe(beforeRead.activeProblems);
    const changed=requireValue(parseAlertPage(await inbox(admin,'active'),{feed:'conditions',status:'active',limit:50}));
    expect(changed.items.find(i=>i.id===shortage.id)?.shortageQuantity).toBe('8');
    const updatesRaw=(await call('select public.list_dashboard_informational_updates_v2(50) value',[]))[0].value;
    const updates=requireValue(parseAlertPage(updatesRaw,{feed:'updates',limit:50}));
    const informational=updates.items.find(i=>i.id===update.activity_id)!;expect(informational.status).toBe('informational');
    await call('select * from public.mark_dashboard_notification_read($1)',[informational.notificationId]);
    expect((await count()).unreadUpdates).toBe(initial.unreadUpdates);
    await call('select * from public.resolve_project_issue($1,$2,\'Verified resolution\')',[issue.activity_id,randomUUID()]);
    await change(f,'0');await db.query('delete from public.work_order_items where work_order_id=$1',[workOrder]);await flush();
    expect((await count()).activeProblems).toBe(initial.activeProblems);
    const resolved=requireValue(parseAlertPage(await inbox(admin,'resolved'),{feed:'conditions',status:'resolved',limit:50}));
    expect(resolved.items.filter(i=>i.targetId===f.project||i.targetId===workOrder)).toHaveLength(3);
    const seen=new Set<string>();let cursor:AlertCursor|null=null;
    for(let pageNumber=0;pageNumber<100;pageNumber++){
      const raw:unknown=(await call('select public.list_dashboard_alert_history_v2(1,$1,$2,$3) value',[cursor?.beforeAt??null,cursor?.beforeKind??null,cursor?.beforeId??null]))[0].value;
      const history:AlertPage=requireValue(parseAlertPage(raw,{feed:'history',limit:1,cursor}));
      for(const row of history.items){expect(seen.has(`${row.kind}:${row.id}`)).toBe(false);seen.add(`${row.kind}:${row.id}`);}
      cursor=history.nextCursor;if(!cursor)break;if(pageNumber===99)throw Error('Unbounded History fixture');
    }
    for(const row of owned){expect(seen.has(`${row.kind}:${row.id}`)).toBe(true);
      const receipt=(await call('select public.acknowledge_dashboard_problem_v2($1,$2) value',[row.kind,row.id]))[0].value;
      requireValue(parseAcknowledgment(receipt,row.kind as 'project_shortage'|'project_issue'|'work_order_shortage',row.id));
    }
    const retainedRaw=(await call('select public.list_dashboard_alert_history_v2(50) value',[]))[0].value;
    const retained=requireValue(parseAlertPage(retainedRaw,{feed:'history',limit:50}));
    expect(retained.items.filter(i=>owned.some(o=>o.id===i.id)).every(i=>i.acknowledgedAt!==null)).toBe(true);
    await change(f,'4');const recurrence=requireValue(parseAlertPage(await inbox(admin,'active'),{feed:'conditions',status:'active',limit:50}));
    expect(recurrence.items.find(i=>i.targetId===f.project)?.id).not.toBe(shortage.id);
    expect(BigInt((await count()).activeProblems)).toBe(BigInt(initial.activeProblems)+1n);
  });

  it('signals shortage opening only to delivered owners with empty private payloads',async()=>{
    const before=await signals(),f=await fixture(),added=await fresh(before);
    assertPrivate(added);
    expect([...new Set(added.map(s=>s.topic))].sort()).toEqual((await recipients(f.project)).map(topic).sort());
    expect(added.some(s=>s.topic===topic(admin.id))).toBe(true);expect(added.some(s=>s.topic===topic(member.id))).toBe(true);
    expect(await notificationCount(f.project)).toBe(1);
  });
  it('signals quantity-only increases and decreases without new notification records',async()=>{
    const f=await fixture(),number=await notificationCount(f.project);let before=await signals();
    await change(f,'12');assertPrivate(await fresh(before));expect(await notificationCount(f.project)).toBe(number);
    before=await signals();await change(f,'4');assertPrivate(await fresh(before));expect(await notificationCount(f.project)).toBe(number);
    expect((await db.query("select count(*)::int n from public.project_shortage_episodes where project_id=$1",[f.project])).rows[0].n).toBe(1);
  });
  it('signals resolution and a new recurrence while preserving episode and delivery uniqueness',async()=>{
    const f=await fixture();let before=await signals();await change(f,'0');assertPrivate(await fresh(before));
    expect(await notificationCount(f.project)).toBe(2);before=await signals();await change(f,'6');assertPrivate(await fresh(before));
    expect(await notificationCount(f.project)).toBe(3);
    expect((await db.query("select count(*)::int total,count(*) filter(where resolved_at is null)::int active from public.project_shortage_episodes where project_id=$1",[f.project])).rows[0]).toEqual({total:2,active:1});
    expect((await db.query("select count(*)::int n from (select r.alert_id,r.recipient_user_id,count(*) from public.project_activity_alert_recipients r join public.project_activity_alerts n on n.id=r.alert_id where n.project_id=$1 group by r.alert_id,r.recipient_user_id having count(*)>1)t",[f.project])).rows[0].n).toBe(0);
  });
  it('does not emit for unalerted issues and preserves the manual opening audience',async()=>{
    const f=await fixture();await change(f,'0');const before=await signals();
    await activity(f.project,'issue',false);await flush();expect(await fresh(before)).toEqual([]);
    await activity(f.project);await flush();const added=await fresh(before);assertPrivate(added);
    expect(added.some(s=>s.topic===topic(admin.id))).toBe(true);expect(added.some(s=>s.topic===topic(member.id))).toBe(false);
  });
  it('signals issue resolution and resolution-only History recipients, but not actor-bound replay',async()=>{
    const f=await issueFixture();await flush();const before=await signals(),request=randomUUID();
    await call("select * from public.resolve_project_issue($1,$2,'Fixed')",[f.issue.activity_id,request]);await flush();
    const added=await fresh(before);assertPrivate(added);expect(added.some(s=>s.topic===topic(member.id))).toBe(true);
    expect([...new Set(added.map(s=>s.topic))].sort()).toEqual((await recipients(f.project)).map(topic).sort());
    const after=await signals(),number=await notificationCount(f.project);
    await call("select * from public.resolve_project_issue($1,$2,'Fixed')",[f.issue.activity_id,request]);await flush();
    expect(await fresh(after)).toEqual([]);expect(await notificationCount(f.project)).toBe(number);
  });
  it('signals acknowledgment even when a legacy dismissed receipt cannot change again',async()=>{
    const f=await issueFixture();await flush();const [row]=await issueRows(f.issue.activity_id);
    await db.query("update public.project_activity_alert_recipients set dismissed_at=greatest(clock_timestamp(),created_at) where id=$1",[row.notification_id]);await flush();
    await call("select * from public.resolve_project_issue($1,$2,'Done')",[f.issue.activity_id,randomUUID()]);await flush();
    const before=await signals(),number=await notificationCount(f.project);
    const first=(await call("select public.acknowledge_dashboard_problem_v2('project_issue',$1) value",[f.issue.activity_id]))[0].value;await flush();
    const added=await fresh(before);assertPrivate(added);expect(added.map(s=>s.topic)).toEqual([topic(admin.id)]);
    const after=await signals();expect((await call("select public.acknowledge_dashboard_problem_v2('project_issue',$1) value",[f.issue.activity_id]))[0].value).toEqual(first);await flush();
    expect(await fresh(after)).toEqual([]);expect(await notificationCount(f.project)).toBe(number);
  });
  it('coalesces acknowledgment and receipt changes in one pending recipient batch',async()=>{
    const f=await issueFixture();await call("select * from public.resolve_project_issue($1,$2,'Done')",[f.issue.activity_id,randomUUID()]);await flush();
    const before=await signals();await call("select public.acknowledge_dashboard_problem_v2('project_issue',$1)",[f.issue.activity_id]);
    expect((await db.query("select count(*)::int n from public.project_alert_condition_refresh_queue where recipient_user_id=$1",[admin.id])).rows[0].n).toBe(1);
    expect(await fresh(before)).toEqual([]);await flush();expect((await fresh(before)).map(s=>s.topic)).toEqual([topic(admin.id)]);
    expect((await db.query("select count(*)::int n from public.project_alert_condition_refresh_queue")).rows[0].n).toBe(0);
  });
  it('does not signal no-op reconciliation, episode updates or unchanged read receipts',async()=>{
    const f=await fixture(),row=(await inbox()).items.find((r:any)=>r.project_id===f.project);
    await call("select * from public.mark_project_alert_read($1)",[row.notification_id]);await flush();
    const before=await signals();await change(f,'10');
    await db.query("update public.project_shortage_episodes set current_shortage_quantity=current_shortage_quantity where project_id=$1",[f.project]);
    await call("select * from public.mark_project_alert_read($1)",[row.notification_id]);await flush();
    expect(await fresh(before)).toEqual([]);
  });
  it('omits inactive or permission-lost owners and never enrolls a new manual audience',async()=>{
    await grants([]);const f=await fixture();await grants(['dashboard.view','projects.view']);const before=await signals();await change(f,'12');
    expect((await fresh(before)).some(s=>s.topic===topic(member.id))).toBe(false);
    const second=await fixture();await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);
    const activeBefore=await signals();await change(second,'12');expect((await fresh(activeBefore)).some(s=>s.topic===topic(member.id))).toBe(false);
  });
  it('rechecks recipient access at deferred dispatch after queueing',async()=>{
    const f=await issueFixture();await flush();const before=await signals();
    await call("select * from public.resolve_project_issue($1,$2,'Done')",[f.issue.activity_id,randomUUID()]);
    await grants(['dashboard.view']);await flush();expect((await fresh(before)).some(s=>s.topic===topic(member.id))).toBe(false);
    assertPrivate(await fresh(before));
  });
  it('rolls back both authoritative changes and already-flushed realtime rows',async()=>{
    const f=await fixture(),before=await signals();const observer=await pool.connect();
    try{
      const visibleBefore=await signals(observer);await db.query('savepoint changed');await change(f,'12');assertPrivate(await fresh(before));
      expect(await signals(observer)).toEqual(visibleBefore);
      await db.query('rollback to savepoint changed;release savepoint changed');expect(await signals()).toEqual(before);
      expect(await signals(observer)).toEqual(visibleBefore);
      expect((await db.query("select current_shortage_quantity::text q from public.project_shortage_episodes where project_id=$1 and resolved_at is null",[f.project])).rows[0].q).toBe('10');
    }finally{observer.release(true);}
  });
  it('preserves general-update read/dismiss signals and does not repeat receipts',async()=>{
    const f=await fixture();await change(f,'0');const u=await activity(f.project,'general');await flush();
    const r=(await db.query("select r.id from public.project_activity_alert_recipients r where r.alert_id=$1 and r.recipient_user_id=$2",[u.alert_id,admin.id])).rows[0];
    const before=await signals();await call("select * from public.mark_project_alert_read($1)",[r.id]);await flush();expect((await fresh(before)).map(s=>s.topic)).toEqual([topic(admin.id)]);
    const after=await signals();await call("select * from public.mark_project_alert_read($1)",[r.id]);await flush();expect(await fresh(after)).toEqual([]);
  });
  it('keeps private queue/helpers inaccessible and retains the existing own-topic RLS policy',async()=>{
    for(const role of ['authenticated','anon','service_role']){
      await expect(call("select * from public.project_alert_condition_refresh_queue",[],admin,role)).rejects.toMatchObject({code:'42501'});
      await expect(call("select public.queue_project_alert_condition_refresh($1)",[admin.id],admin,role)).rejects.toMatchObject({code:'42501'});
    }
    const policy=(await db.query("select qual from pg_policies where schemaname='realtime' and tablename='messages' and policyname='project_alert_notification_invalidation_select_own'")).rows[0].qual;
    expect(policy).toContain('realtime.topic()');expect(policy).toContain('current_active_user_profile_id()');expect(policy).toContain('projects.view');
    expect((await db.query("select relrowsecurity from pg_class where oid='public.project_alert_condition_refresh_queue'::regclass")).rows[0].relrowsecurity).toBe(true);
  });
  it('denies another recipient topic even to Admin and permits only the authorized own topic',async()=>{
    const before=await signals();await fixture();const added=await fresh(before),id=added.find(s=>s.topic===topic(admin.id))!.id;
    await db.query("select set_config('realtime.topic',$1,true)",[topic(member.id)]);
    expect((await call("select count(*)::text n from realtime.messages where id=$1",[id]))[0].n).toBe('0');
    await db.query("select set_config('realtime.topic',$1,true)",[topic(admin.id)]);
    expect((await call("select count(*)::text n from realtime.messages where id=$1",[id]))[0].n).toBe('1');
  });
  it('preserves real Work Order private refresh signals on the unchanged separate channel',async()=>{
    const f=await fixture(),id=randomUUID();
    const read=async()=> (await db.query("select id::text,topic,payload,event,private from realtime.messages where extension='broadcast' and topic=$1 order by id",[`work-order-shortages:${admin.id}`])).rows as Signal[];
    const before=await read(),number=(await db.query("select 'RN-8991-'||lpad(n::text,4,'0') v from generate_series(1,9999)n where not exists(select 1 from public.work_orders where work_order_number='RN-8991-'||lpad(n::text,4,'0')) order by n limit 1")).rows[0].v;
    await db.query("insert into public.work_orders(id,work_order_number,project_id,customer_name_snapshot,description,created_by_user_id,updated_by_user_id) values($1,$2,$3,'Owned','Refresh regression',$4,$4)",[id,number,f.project,admin.id]);
    await db.query("insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id) values($1,$2,2,$3)",[id,f.product,admin.id]);await flush();
    const ids=new Set(before.map(s=>s.id)),added=(await read()).filter(s=>!ids.has(s.id));assertPrivate(added);
    expect(added.every(s=>s.topic===`work-order-shortages:${admin.id}`)).toBe(true);
    expect((await db.query("select count(*)::int n from public.work_order_material_shortage_episodes where work_order_id=$1 and resolved_at is null",[id])).rows[0].n).toBe(1);
  });
  it('publishes real transport rows only when the owned fixture transaction commits',async()=>{
    const writer=await pool.connect();let committed=false;const before=await signals();
    try{
      await writer.query('begin');await writer.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.auth_user_id]);
      const project=randomUUID();await writer.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,'Owned commit visibility','Owned',current_date,current_date+1,$2,$2)",[project,admin.id]);
      await writer.query('set local role authenticated');
      await writer.query("select * from public.post_project_activity($1,$2,'Commit visibility','Owned private signal fixture',true,'issue')",[project,randomUUID()]);
      await writer.query('reset role');
      expect((await writer.query("select count(*)::int n from public.project_alert_condition_refresh_queue")).rows[0].n).toBeGreaterThan(0);
      expect(await fresh(before)).toEqual([]);await writer.query('commit');committed=true;
      const added=await fresh(before);assertPrivate(added);expect(added.some(s=>s.topic===topic(admin.id))).toBe(true);
      expect(new Set(added.map(s=>s.topic)).size).toBe(added.length);
      expect((await writer.query("select count(*)::int n from public.project_alert_condition_refresh_queue")).rows[0].n).toBe(0);
    }finally{
      await writer.query('rollback');writer.release(true);
      // Committed fixture and transport records are retained only in this owned
      // clone's baseline; final cleanup removes the entire disposable database.
      if(committed)baseline=await snapshot(pool);
    }
  });
  it('serializes resolve/dismiss with all 186 triggers installed and publishes no rolled-back resolution',async()=>{
    const branch=await pool.connect(),observer=await pool.connect(),project=randomUUID(),request=randomUUID();let fixtureCommitted=false;
    let activityId:string,notificationId:string;
    const pid=(await db.query('select pg_backend_pid() pid')).rows[0].pid;
    const waitForLock=async()=>{for(let i=0;i<40;i++){
      await branch.query('select pg_stat_clear_snapshot()');
      if((await branch.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0]?.wait_event_type==='Lock')return;
      await new Promise(resolve=>setTimeout(resolve,20));
    }throw Error('Expected source-first lock wait');};
    try{
      await branch.query('begin');await branch.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.auth_user_id]);
      await branch.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,'Owned 186 concurrency','Owned',current_date,current_date+1,$2,$2)",[project,admin.id]);
      await branch.query('set local role authenticated');
      const posted=(await branch.query("select * from public.post_project_activity($1,$2,'Concurrent condition','Owned final integration',true,'issue')",[project,request])).rows[0];
      activityId=posted.activity_id;await branch.query('reset role');
      notificationId=(await branch.query('select id from public.project_activity_alert_recipients where alert_id=$1 and recipient_user_id=$2',[posted.alert_id,admin.id])).rows[0].id;
      await branch.query('commit');fixtureCommitted=true;const before=await signals();
      const beforeIds=new Set(before.map(s=>s.id));
      const committedSignals=async()=>(await signals(observer)).filter(s=>!beforeIds.has(s.id));
      const resolve=async()=>{
        await branch.query("begin;set local statement_timeout='8s';set local lock_timeout='5s'");await branch.query("select set_config('request.jwt.claim.sub',$1,true)",[admin.auth_user_id]);
        await branch.query('set local role authenticated');await branch.query("select * from public.resolve_project_issue($1,$2,'Final race resolution')",[activityId,randomUUID()]);await branch.query('reset role');
      };
      await resolve();
      const rejected=call('select * from public.dismiss_project_alert_notification($1)',[notificationId]).then(value=>({value,error:null as any}),error=>({value:null,error}));
      // The main connection is intentionally waiting inside dismiss: observe
      // committed transport rows from an independent, non-blocked connection.
      await waitForLock();expect(await committedSignals()).toEqual([]);await branch.query('rollback');expect((await rejected).error).toMatchObject({code:'55000'});expect(await fresh(before)).toEqual([]);
      await resolve();const accepted=call('select * from public.dismiss_dashboard_notification($1)',[notificationId]);await waitForLock();await branch.query('commit');expect((await accepted)[0].dismissed_at).toBeTruthy();await flush();
      const own=(await call('select public.list_dashboard_alert_history_v2(50) value',[]))[0].value.items.find((r:any)=>r.condition_id===activityId);
      expect(own.condition_status).toBe('resolved');expect(own.acknowledged_at).toBeTruthy();assertPrivate(await fresh(before));
    }finally{
      await branch.query('rollback');branch.release(true);observer.release(true);
      if(fixtureCommitted)baseline=await snapshot(pool);
    }
  });
});
