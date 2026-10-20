import { randomUUID } from "node:crypto";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const dismissSql =
  "select * from public.dismiss_project_alert_notification($1::uuid)";
const listSql =
  "select * from public.list_project_alert_notifications($1::integer, $2::timestamptz, $3::uuid)";
const markReadSql = "select * from public.mark_project_alert_read($1::uuid)";

interface DismissRow extends QueryResultRow {
  notification_id: string;
  dismissed_at: Date;
}

interface NotificationFixture {
  activityId: string;
  alertId: string;
  notificationId: string;
  projectId: string;
}

interface DatabaseError {
  code: string;
  message: string;
}

async function setActor(database: PoolClient, actor: SecurityActor | null) {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor?.authUserId ?? ""],
  );
  await database.query(actor ? "set local role authenticated" : "set local role anon");
}

async function callAs<Row extends QueryResultRow>(
  database: PoolClient,
  actor: SecurityActor,
  sql: string,
  values: unknown[] = [],
): Promise<Row[]> {
  await setActor(database, actor);
  try {
    return (await database.query<Row>(sql, values)).rows;
  } finally {
    await database.query("reset role");
  }
}

async function rejectAs(
  database: PoolClient,
  actor: SecurityActor | null,
  sql: string,
  values: unknown[],
): Promise<DatabaseError> {
  await database.query("savepoint rejected_notification_dismissal");
  await setActor(database, actor);
  let caught: unknown;
  try {
    await database.query(sql, values);
  } catch (error) {
    caught = error;
  } finally {
    await database.query("rollback to savepoint rejected_notification_dismissal");
    await database.query("release savepoint rejected_notification_dismissal");
    await database.query("reset role");
  }
  expect(caught).toBeTruthy();
  return caught as DatabaseError;
}

async function setReadPermissions(
  database: PoolClient,
  userId: string,
  grantedByUserId: string,
  keys: string[],
) {
  await database.query(
    `delete from public.user_permissions as permission
     using public.permission_definitions as definition
     where definition.id = permission.permission_definition_id
       and permission.user_id = $1::uuid
       and definition.key in (
         'dashboard.view', 'projects.view', 'projects.alerts.receive'
       )`,
    [userId],
  );
  await database.query(
    `insert into public.user_permissions (
       user_id, permission_definition_id, granted_by_user_id
     )
     select $1::uuid, definition.id, $2::uuid
     from public.permission_definitions as definition
     where definition.key = any($3::text[])
     on conflict (user_id, permission_definition_id) do nothing`,
    [userId, grantedByUserId, keys],
  );
}

async function createNotification(
  database: PoolClient,
  options: {
    actorId: string;
    createdAt: string;
    notificationId?: string;
    recipientId: string;
    status?: "planned" | "completed" | "cancelled";
    title?: string;
  },
): Promise<NotificationFixture> {
  const projectId = randomUUID();
  const activityId = randomUUID();
  const alertId = randomUUID();
  const notificationId = options.notificationId ?? randomUUID();
  const status = options.status ?? "planned";
  await database.query(
    `insert into public.projects (
       id, name, customer_name, status, start_date, delivery_date,
       completed_at, cancelled_at, created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, 'Task D2 Customer', $3::text,
       '2026-10-19'::date, '2026-11-19'::date,
       case when $3::text = 'completed' then $4::timestamptz else null end,
       case when $3::text = 'cancelled' then $4::timestamptz else null end,
       $5::uuid, $5::uuid
     )`,
    [projectId, `Task D2 Project ${projectId}`, status, options.createdAt, options.actorId],
  );
  await database.query(
    `insert into public.project_activity_updates (
       id, project_id, author_user_id, request_id, title, description, created_at
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
       'Task D2 Activity description', $6::timestamptz
     )`,
    [
      activityId,
      projectId,
      options.actorId,
      randomUUID(),
      options.title ?? `Task D2 Activity ${activityId}`,
      options.createdAt,
    ],
  );
  await database.query(
    `insert into public.project_activity_alerts (
       id, project_activity_id, sent_by_user_id, sent_at
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz)`,
    [alertId, activityId, options.actorId, options.createdAt],
  );
  await database.query(
    `insert into public.project_activity_alert_recipients (
       id, alert_id, recipient_user_id, created_at
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz)`,
    [notificationId, alertId, options.recipientId, options.createdAt],
  );
  return { activityId, alertId, notificationId, projectId };
}

async function waitForLockWait(
  observer: PoolClient,
  backendPid: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const waiting = (await observer.query<{ waiting: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_stat_activity
         where pid = $1::integer and wait_event_type = 'Lock'
       ) as waiting`,
      [backendPid],
    )).rows[0]?.waiting ?? false;
    if (waiting) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

const localConcurrencyIt = process.env.SUPABASE_LOCAL_TEST === "1" ? it : it.skip;

export function registerProjectAlertDismissalTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe.skipIf(process.env.PROJECT_ALERT_DISMISSAL !== "1")(
    "Project alert dismissal D2 (requires migration 130)",
    () => {
      it("has exact RPC/read metadata, ACLs, projections, RLS, and partial indexes", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const functions = (await database.query<{
            arguments: string;
            authenticated_execute: boolean;
            function_name: string;
            result_type: string;
            public_execute: boolean;
            anon_execute: boolean;
            security_definer: boolean;
            settings: string[];
            volatility: string;
          }>(
            `select
               routine.proname as function_name,
               pg_catalog.pg_get_function_identity_arguments(routine.oid) as arguments,
               pg_catalog.pg_get_function_result(routine.oid) as result_type,
               routine.prosecdef as security_definer,
               routine.provolatile as volatility,
               routine.proconfig as settings,
               pg_catalog.has_function_privilege('public', routine.oid, 'execute') as public_execute,
               pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anon_execute,
               pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
             where namespace.nspname = 'public'
               and routine.proname in (
                 'dismiss_project_alert_notification',
                 'get_project_alert_unread_count',
                 'list_project_alert_notifications'
               )
             order by routine.proname`,
          )).rows;
          expect(functions).toEqual([
            {
              arguments: "p_notification_id uuid",
              authenticated_execute: true,
              function_name: "dismiss_project_alert_notification",
              result_type: "TABLE(notification_id uuid, dismissed_at timestamp with time zone)",
              public_execute: false,
              anon_execute: false,
              security_definer: true,
              settings: ['search_path=""'],
              volatility: "v",
            },
            {
              arguments: "",
              authenticated_execute: true,
              function_name: "get_project_alert_unread_count",
              result_type: "bigint",
              public_execute: false,
              anon_execute: false,
              security_definer: true,
              settings: ['search_path=""'],
              volatility: "s",
            },
            {
              arguments: "p_limit integer, p_before_created_at timestamp with time zone, p_before_recipient_id uuid",
              authenticated_execute: true,
              function_name: "list_project_alert_notifications",
              result_type: "TABLE(notification_id uuid, alert_id uuid, project_id uuid, project_name text, activity_id uuid, activity_title text, activity_author_full_name text, created_at timestamp with time zone, read_at timestamp with time zone, has_more boolean)",
              public_execute: false,
              anon_execute: false,
              security_definer: true,
              settings: ['search_path=""'],
              volatility: "s",
            },
          ]);

          const indexes = (await database.query<{ index_name: string; definition: string }>(
            `select indexname as index_name, indexdef as definition
             from pg_catalog.pg_indexes
             where schemaname = 'public'
               and tablename = 'project_activity_alert_recipients'
               and indexname in (
                 'project_activity_alert_recipients_inbox_idx',
                 'project_activity_alert_recipients_unread_inbox_idx'
               )
             order by indexname`,
          )).rows;
          expect(indexes).toHaveLength(2);
          expect(indexes[0]!.definition).toContain(
            "(recipient_user_id, created_at DESC, id DESC) WHERE (dismissed_at IS NULL)",
          );
          expect(indexes[1]!.definition).toContain(
            "(recipient_user_id, created_at DESC, id DESC) WHERE ((read_at IS NULL) AND (dismissed_at IS NULL))",
          );

          const tableSecurity = (await database.query<{
            policies: string;
            rls_enabled: boolean;
            authenticated_access: boolean;
          }>(
            `select
               relation.relrowsecurity as rls_enabled,
               (select pg_catalog.count(*)::text from pg_catalog.pg_policies
                where schemaname = 'public'
                  and tablename = 'project_activity_alert_recipients') as policies,
               pg_catalog.has_table_privilege(
                 'authenticated', relation.oid,
                 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
               ) as authenticated_access
             from pg_catalog.pg_class as relation
             join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
             where namespace.nspname = 'public'
               and relation.relname = 'project_activity_alert_recipients'`,
          )).rows[0];
          expect(tableSecurity).toEqual({
            authenticated_access: false,
            policies: "0",
            rls_enabled: true,
          });
        });
      });

      it("enforces ownership/current access while preserving historical receive semantics", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const recipient = fixture.actors.permitted;
          const unpermitted = fixture.actors.unpermitted;
          const inactive = fixture.actors.inactive;
          await setReadPermissions(database, recipient.profileId, admin.profileId, [
            "dashboard.view", "projects.view",
          ]);
          await setReadPermissions(database, unpermitted.profileId, admin.profileId, [
            "projects.view",
          ]);

          const owned = await createNotification(database, {
            actorId: admin.profileId,
            createdAt: "2026-10-20T08:00:00Z",
            recipientId: recipient.profileId,
          });
          const adminOwned = await createNotification(database, {
            actorId: recipient.profileId,
            createdAt: "2026-10-20T08:01:00Z",
            recipientId: admin.profileId,
          });
          const inactiveOwned = await createNotification(database, {
            actorId: admin.profileId,
            createdAt: "2026-10-20T08:02:00Z",
            recipientId: inactive.profileId,
          });

          expect(await callAs<DismissRow>(database, recipient, dismissSql, [owned.notificationId]))
            .toEqual([expect.objectContaining({ notification_id: owned.notificationId })]);
          expect(await callAs<DismissRow>(database, admin, dismissSql, [adminOwned.notificationId]))
            .toEqual([expect.objectContaining({ notification_id: adminOwned.notificationId })]);
          expect(await rejectAs(database, admin, dismissSql, [owned.notificationId]))
            .toMatchObject({ code: "P0002", message: "Notification not found" });
          expect(await rejectAs(database, recipient, dismissSql, [randomUUID()]))
            .toMatchObject({ code: "P0002", message: "Notification not found" });
          expect(await rejectAs(database, recipient, dismissSql, [null]))
            .toMatchObject({ code: "22023" });
          expect(await rejectAs(database, inactive, dismissSql, [inactiveOwned.notificationId]))
            .toMatchObject({ code: "42501" });
          expect(await rejectAs(database, null, dismissSql, [owned.notificationId]))
            .toMatchObject({ code: "42501" });

          const denied = await createNotification(database, {
            actorId: admin.profileId,
            createdAt: "2026-10-20T08:03:00Z",
            recipientId: unpermitted.profileId,
          });
          expect(await rejectAs(database, unpermitted, dismissSql, [denied.notificationId]))
            .toMatchObject({ code: "42501" });
          await setReadPermissions(database, unpermitted.profileId, admin.profileId, [
            "dashboard.view",
          ]);
          expect(await rejectAs(database, unpermitted, dismissSql, [denied.notificationId]))
            .toMatchObject({ code: "42501" });

          for (const [status, minute] of [["completed", "04"], ["cancelled", "05"]] as const) {
            const historical = await createNotification(database, {
              actorId: admin.profileId,
              createdAt: `2026-10-20T08:${minute}:00Z`,
              recipientId: recipient.profileId,
              status,
            });
            expect(await callAs<DismissRow>(database, recipient, dismissSql, [historical.notificationId]))
              .toEqual([expect.objectContaining({ notification_id: historical.notificationId })]);
          }
        });
      });

      it("filters dismissed unread/read rows, preserves read state, and is physically idempotent", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const recipient = fixture.actors.permitted;
          await setReadPermissions(database, recipient.profileId, admin.profileId, [
            "dashboard.view", "projects.view",
          ]);
          const unread = await createNotification(database, {
            actorId: admin.profileId,
            createdAt: "2026-10-20T09:00:00Z",
            recipientId: recipient.profileId,
          });
          const read = await createNotification(database, {
            actorId: admin.profileId,
            createdAt: "2026-10-20T09:01:00Z",
            recipientId: recipient.profileId,
          });
          const otherRecipient = fixture.actors.brandManager;
          await database.query(
            `insert into public.project_activity_alert_recipients (
               alert_id, recipient_user_id, created_at
             ) values ($1::uuid, $2::uuid, '2026-10-20T09:00:00Z'::timestamptz)`,
            [unread.alertId, otherRecipient.profileId],
          );

          await callAs(database, recipient, markReadSql, [read.notificationId]);
          const before = (await database.query(
            `select
               recipient.read_at,
               recipient.ctid::text as ctid,
               (select pg_catalog.count(*)::text from public.audit_logs) as audits,
               (select pg_catalog.count(*)::text from public.project_activity_updates) as activities,
               (select pg_catalog.count(*)::text from public.project_activity_alerts) as alerts,
               (select pg_catalog.count(*)::text from public.project_activity_attachments) as attachments,
               (select dismissed_at from public.project_activity_alert_recipients
                where alert_id = $2::uuid and recipient_user_id = $3::uuid) as other_dismissed_at
             from public.project_activity_alert_recipients as recipient
             where recipient.id = $1::uuid`,
            [read.notificationId, unread.alertId, otherRecipient.profileId],
          )).rows[0];

          expect(await callAs(database, recipient,
            "select public.get_project_alert_unread_count() as count"))
            .toEqual([{ count: "1" }]);
          const unreadDismiss = await callAs<DismissRow>(
            database, recipient, dismissSql, [unread.notificationId],
          );
          expect(await callAs(database, recipient,
            "select public.get_project_alert_unread_count() as count"))
            .toEqual([{ count: "0" }]);
          expect(await callAs(database, recipient, listSql, [20, null, null]))
            .toEqual([expect.objectContaining({ notification_id: read.notificationId })]);

          const firstReadDismiss = await callAs<DismissRow>(
            database, recipient, dismissSql, [read.notificationId],
          );
          const afterFirst = (await database.query(
            `select read_at, dismissed_at, ctid::text as ctid
             from public.project_activity_alert_recipients where id = $1::uuid`,
            [read.notificationId],
          )).rows[0];
          const secondReadDismiss = await callAs<DismissRow>(
            database, recipient, dismissSql, [read.notificationId],
          );
          const afterSecond = (await database.query(
            `select read_at, dismissed_at, ctid::text as ctid
             from public.project_activity_alert_recipients where id = $1::uuid`,
            [read.notificationId],
          )).rows[0];

          expect(unreadDismiss[0]!.notification_id).toBe(unread.notificationId);
          expect(firstReadDismiss).toEqual(secondReadDismiss);
          expect(afterFirst.read_at).toEqual(before.read_at);
          expect(afterSecond.read_at).toEqual(before.read_at);
          expect(afterSecond.dismissed_at).toEqual(firstReadDismiss[0]!.dismissed_at);
          expect(afterSecond.ctid).toBe(afterFirst.ctid);
          expect(await callAs(database, recipient, listSql, [20, null, null])).toEqual([]);

          const after = (await database.query(
            `select
               (select pg_catalog.count(*)::text from public.audit_logs) as audits,
               (select pg_catalog.count(*)::text from public.project_activity_updates) as activities,
               (select pg_catalog.count(*)::text from public.project_activity_alerts) as alerts,
               (select pg_catalog.count(*)::text from public.project_activity_attachments) as attachments,
               (select dismissed_at from public.project_activity_alert_recipients
                where alert_id = $1::uuid and recipient_user_id = $2::uuid) as other_dismissed_at`,
            [unread.alertId, otherRecipient.profileId],
          )).rows[0];
          expect(after).toEqual({
            activities: before.activities,
            alerts: before.alerts,
            attachments: before.attachments,
            audits: before.audits,
            other_dismissed_at: null,
          });
        });
      });

      it("filters before keyset limits and preserves stable tied-timestamp pagination", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const recipient = fixture.actors.permitted;
          await setReadPermissions(database, recipient.profileId, admin.profileId, [
            "dashboard.view", "projects.view",
          ]);
          const ids = [
            "00000000-0000-4000-8000-000000000005",
            "00000000-0000-4000-8000-000000000004",
            "00000000-0000-4000-8000-000000000003",
            "00000000-0000-4000-8000-000000000002",
            "00000000-0000-4000-8000-000000000001",
          ];
          for (const notificationId of ids) {
            await createNotification(database, {
              actorId: admin.profileId,
              createdAt: "2026-10-20T10:00:00Z",
              notificationId,
              recipientId: recipient.profileId,
            });
          }
          await callAs(database, recipient, dismissSql, [ids[1]]);

          const first = await callAs<Record<string, unknown> & QueryResultRow>(
            database, recipient, listSql, [2, null, null],
          );
          expect(first.map((row) => row.notification_id)).toEqual([ids[0], ids[2]]);
          expect(first.map((row) => row.has_more)).toEqual([true, true]);
          const cursor = first[1]!;
          const second = await callAs<Record<string, unknown> & QueryResultRow>(
            database, recipient, listSql,
            [2, cursor.created_at, cursor.notification_id],
          );
          expect(second.map((row) => row.notification_id)).toEqual([ids[3], ids[4]]);
          expect(second.map((row) => row.has_more)).toEqual([false, false]);
          expect(new Set([...first, ...second].map((row) => row.notification_id)).size)
            .toBe(4);

          expect(await callAs(database, recipient, listSql, [1, null, null]))
            .toHaveLength(1);
          expect(await callAs(database, recipient, listSql, [50, null, null]))
            .toHaveLength(4);
          for (const values of [[null, null, null], [0, null, null], [51, null, null], [20, "2026-10-20T10:00:00Z", null]]) {
            expect(await rejectAs(database, recipient, listSql, values))
              .toMatchObject({ code: "22023" });
          }
        });
      });

      it("uses dismissal-aware indexes for dismissal-heavy inbox/count scans", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const recipientId = fixture.actors.permitted.profileId;
          const projectId = randomUUID();
          await database.query(
            `insert into public.projects (
               id, name, customer_name, start_date, delivery_date,
               created_by_user_id, updated_by_user_id
             ) values (
               $1::uuid, $2::text, 'Task D2 Plan Customer',
               '2026-10-19', '2026-11-19', $3::uuid, $3::uuid
             )`,
            [projectId, `Task D2 Plan ${projectId}`, actorId],
          );
          await database.query(
            `create temporary table task_d2_plan_rows on commit drop as
             select
               pg_catalog.gen_random_uuid() as activity_id,
               pg_catalog.gen_random_uuid() as alert_id,
               pg_catalog.gen_random_uuid() as recipient_id,
               ('2026-10-20T11:00:00Z'::timestamptz
                 + sequence.value * interval '1 millisecond') as created_at,
               sequence.value <= 1800 as should_dismiss
             from pg_catalog.generate_series(1, 2000) as sequence(value)`,
          );
          await database.query(
            `insert into public.project_activity_updates (
               id, project_id, author_user_id, request_id, title, description, created_at
             )
             select activity_id, $1::uuid, $2::uuid, pg_catalog.gen_random_uuid(),
                    'Task D2 plan row ' || activity_id::text, 'Plan description', created_at
             from task_d2_plan_rows`,
            [projectId, actorId],
          );
          await database.query(
            `insert into public.project_activity_alerts (
               id, project_activity_id, sent_by_user_id, sent_at
             ) select alert_id, activity_id, $1::uuid, created_at
               from task_d2_plan_rows`,
            [actorId],
          );
          await database.query(
            `insert into public.project_activity_alert_recipients (
               id, alert_id, recipient_user_id, created_at
             ) select recipient_id, alert_id, $1::uuid, created_at
               from task_d2_plan_rows`,
            [recipientId],
          );
          await database.query(
            `update public.project_activity_alert_recipients as recipient
             set dismissed_at = recipient.created_at + interval '1 second'
             from task_d2_plan_rows as source
             where source.recipient_id = recipient.id and source.should_dismiss`,
          );
          await database.query(
            `update public.project_activity_alert_recipients as recipient
             set read_at = recipient.created_at + interval '1 second'
             from task_d2_plan_rows as source
             where source.recipient_id = recipient.id
               and not source.should_dismiss
               and mod(extract(milliseconds from source.created_at)::integer, 2) = 0`,
          );
          await database.query("analyze public.project_activity_alert_recipients");
          await database.query("set local enable_seqscan = off");

          const inboxPlan = JSON.stringify((await database.query(
            `explain (analyze, buffers, format json)
             select id from public.project_activity_alert_recipients
             where recipient_user_id = $1::uuid and dismissed_at is null
             order by created_at desc, id desc limit 20`,
            [recipientId],
          )).rows);
          const unreadPlan = JSON.stringify((await database.query(
            `explain (analyze, buffers, format json)
             select id from public.project_activity_alert_recipients
             where recipient_user_id = $1::uuid
               and read_at is null and dismissed_at is null
             order by created_at desc, id desc limit 20`,
            [recipientId],
          )).rows);
          expect(inboxPlan).toContain("project_activity_alert_recipients_inbox_idx");
          expect(unreadPlan).toContain("project_activity_alert_recipients_unread_inbox_idx");
        });
      });

      localConcurrencyIt("serializes identical dismissals to one physical transition", async () => {
        const fixture = requireHarness();
        await fixture.withDatabaseClients(3, async ([winner, contender, observer]) => {
          if (!winner || !contender || !observer) throw new Error("D2 clients unavailable");
          const recipient = fixture.actors.permitted;
          const admin = fixture.actors.admin;
          await observer.query("begin");
          await setReadPermissions(observer, recipient.profileId, admin.profileId, [
            "dashboard.view", "projects.view",
          ]);
          const target = await createNotification(observer, {
            actorId: admin.profileId,
            createdAt: "2026-10-20T12:00:00Z",
            recipientId: recipient.profileId,
          });
          const beforeCtid = (await observer.query<{ ctid: string }>(
            `select ctid::text as ctid from public.project_activity_alert_recipients
             where id = $1::uuid`, [target.notificationId],
          )).rows[0]!.ctid;
          await observer.query("commit");

          await winner.query("begin");
          await contender.query("begin");
          await winner.query(
            `select id from public.project_activity_alert_recipients
             where id = $1::uuid for update`, [target.notificationId],
          );
          const contenderPid = (await contender.query<{ pid: number }>(
            "select pg_catalog.pg_backend_pid() as pid",
          )).rows[0]!.pid;
          await setActor(winner, recipient);
          await setActor(contender, recipient);
          const firstPromise = winner.query<DismissRow>(dismissSql, [target.notificationId]);
          const secondPromise = contender.query<DismissRow>(dismissSql, [target.notificationId]);
          const first = await firstPromise;
          expect(await waitForLockWait(observer, contenderPid)).toBe(true);
          await winner.query("commit");
          const second = await secondPromise;
          await contender.query("commit");

          expect(second.rows).toEqual(first.rows);
          const after = (await observer.query<{ ctid: string; dismissed_at: Date }>(
            `select ctid::text as ctid, dismissed_at
             from public.project_activity_alert_recipients where id = $1::uuid`,
            [target.notificationId],
          )).rows[0]!;
          expect(after.ctid).not.toBe(beforeCtid);
          expect(after.dismissed_at).toEqual(first.rows[0]!.dismissed_at);
        });
      });

      localConcurrencyIt("preserves both timestamps when mark-read races dismissal", async () => {
        const fixture = requireHarness();
        await fixture.withDatabaseClients(3, async ([marker, dismisser, observer]) => {
          if (!marker || !dismisser || !observer) throw new Error("D2 clients unavailable");
          const recipient = fixture.actors.permitted;
          const admin = fixture.actors.admin;
          await observer.query("begin");
          await setReadPermissions(observer, recipient.profileId, admin.profileId, [
            "dashboard.view", "projects.view",
          ]);
          const target = await createNotification(observer, {
            actorId: admin.profileId,
            createdAt: "2026-10-20T12:01:00Z",
            recipientId: recipient.profileId,
          });
          await observer.query("commit");

          await marker.query("begin");
          await dismisser.query("begin");
          await marker.query(
            `select id from public.project_activity_alert_recipients
             where id = $1::uuid for update`, [target.notificationId],
          );
          const dismisserPid = (await dismisser.query<{ pid: number }>(
            "select pg_catalog.pg_backend_pid() as pid",
          )).rows[0]!.pid;
          await setActor(marker, recipient);
          await setActor(dismisser, recipient);
          const markPromise = marker.query(markReadSql, [target.notificationId]);
          const dismissPromise = dismisser.query<DismissRow>(dismissSql, [target.notificationId]);
          await markPromise;
          expect(await waitForLockWait(observer, dismisserPid)).toBe(true);
          await marker.query("commit");
          await dismissPromise;
          await dismisser.query("commit");

          const result = (await observer.query<{ read_at: Date | null; dismissed_at: Date | null }>(
            `select read_at, dismissed_at from public.project_activity_alert_recipients
             where id = $1::uuid`, [target.notificationId],
          )).rows[0]!;
          expect(result.read_at).toBeInstanceOf(Date);
          expect(result.dismissed_at).toBeInstanceOf(Date);
        });
      });

      localConcurrencyIt("serializes profile access loss ahead of dismissal and rechecks authorization", async () => {
        const fixture = requireHarness();
        await fixture.withDatabaseClients(3, async ([permissionWriter, dismisser, observer]) => {
          if (!permissionWriter || !dismisser || !observer) throw new Error("D2 clients unavailable");
          const recipient = fixture.actors.permitted;
          const admin = fixture.actors.admin;
          await observer.query("begin");
          await setReadPermissions(observer, recipient.profileId, admin.profileId, [
            "dashboard.view", "projects.view",
          ]);
          const target = await createNotification(observer, {
            actorId: admin.profileId,
            createdAt: "2026-10-20T12:02:00Z",
            recipientId: recipient.profileId,
          });
          await observer.query("commit");

          await permissionWriter.query("begin");
          await dismisser.query("begin");
          await permissionWriter.query(
            "select id from public.user_profiles where id = $1::uuid for update",
            [recipient.profileId],
          );
          const dismisserPid = (await dismisser.query<{ pid: number }>(
            "select pg_catalog.pg_backend_pid() as pid",
          )).rows[0]!.pid;
          await setActor(dismisser, recipient);
          const dismissal = dismisser.query(dismissSql, [target.notificationId]);
          expect(await waitForLockWait(observer, dismisserPid)).toBe(true);
          await permissionWriter.query(
            `delete from public.user_permissions as permission
             using public.permission_definitions as definition
             where definition.id = permission.permission_definition_id
               and permission.user_id = $1::uuid
               and definition.key = 'dashboard.view'`,
            [recipient.profileId],
          );
          await permissionWriter.query("commit");
          await expect(dismissal).rejects.toMatchObject({ code: "42501" });
          await dismisser.query("rollback");

          const state = (await observer.query<{ dismissed_at: Date | null }>(
            `select dismissed_at from public.project_activity_alert_recipients
             where id = $1::uuid`, [target.notificationId],
          )).rows[0]!;
          expect(state.dismissed_at).toBeNull();
          await observer.query("begin");
          await setReadPermissions(observer, recipient.profileId, admin.profileId, [
            "dashboard.view", "projects.view",
          ]);
          await observer.query("commit");
        });
      });
    },
  );
}
