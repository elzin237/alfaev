import { randomUUID } from "node:crypto";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const markReadSql = "select * from public.mark_project_alert_read($1::uuid)";

interface MarkReadRow extends QueryResultRow {
  notification_id: string;
  read_at: Date;
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
  await database.query("savepoint rejected_notification_mark_read");
  await setActor(database, actor);
  let caught: unknown;
  try {
    await database.query(sql, values);
  } catch (error) {
    caught = error;
  } finally {
    await database.query("rollback to savepoint rejected_notification_mark_read");
    await database.query("release savepoint rejected_notification_mark_read");
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
    recipientId: string;
    status?: "planned" | "completed" | "cancelled";
    title: string;
  },
): Promise<NotificationFixture> {
  const projectId = randomUUID();
  const activityId = randomUUID();
  const alertId = randomUUID();
  const notificationId = randomUUID();
  const status = options.status ?? "planned";
  await database.query(
    `insert into public.projects (
       id, name, customer_name, status, start_date, delivery_date,
       completed_at, cancelled_at, created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, 'Task F2 Customer', $3::text,
       '2026-10-19'::date, '2026-11-19'::date,
       case when $3::text = 'completed' then $4::timestamptz else null end,
       case when $3::text = 'cancelled' then $4::timestamptz else null end,
       $5::uuid, $5::uuid
     )`,
    [projectId, `Task F2 Project ${projectId}`, status, options.createdAt, options.actorId],
  );
  await database.query(
    `insert into public.project_activity_updates (
       id, project_id, author_user_id, request_id, title, description, created_at
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
       'Task F2 Activity description', $6::timestamptz
     )`,
    [activityId, projectId, options.actorId, randomUUID(), options.title, options.createdAt],
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
         select 1
         from pg_catalog.pg_stat_activity as activity
         where activity.pid = $1::integer
           and activity.wait_event_type = 'Lock'
       ) as waiting`,
      [backendPid],
    )).rows[0]?.waiting ?? false;
    if (waiting) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

const localConcurrencyIt = process.env.SUPABASE_LOCAL_TEST === "1" ? it : it.skip;

export function registerProjectAlertMarkReadTests(
  requireHarness: () => SecurityFixtureHarness,
) {
  describe.skipIf(process.env.TASKF2_PROJECT_ALERT_MARK_READ !== "1")(
    "Task F2 Project alert mark-read (requires migration 127)",
    () => {
      it("has exact metadata and preserves table/trigger protections", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const metadata = (await database.query<{
            arguments: string;
            authenticated_execute: boolean;
            public_execute: boolean;
            anon_execute: boolean;
            result_type: string;
            security_definer: boolean;
            settings: string[];
            volatility: string;
          }>(
            `select
               pg_catalog.pg_get_function_identity_arguments(routine.oid) as arguments,
               pg_catalog.pg_get_function_result(routine.oid) as result_type,
               routine.prosecdef as security_definer,
               routine.provolatile as volatility,
               routine.proconfig as settings,
               pg_catalog.has_function_privilege('public', routine.oid, 'execute') as public_execute,
               pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anon_execute,
               pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             where namespace.nspname = 'public'
               and routine.proname = 'mark_project_alert_read'`,
          )).rows;
          expect(metadata).toEqual([{
            arguments: "p_notification_id uuid",
            authenticated_execute: true,
            public_execute: false,
            anon_execute: false,
            result_type: "TABLE(notification_id uuid, read_at timestamp with time zone)",
            security_definer: true,
            settings: ['search_path=""'],
            volatility: "v",
          }]);

          const target = await createNotification(database, {
            actorId: fixture.actors.admin.profileId,
            createdAt: "2026-10-19T08:00:00Z",
            recipientId: fixture.actors.permitted.profileId,
            title: "Task F2 trigger protection",
          });
          expect(await rejectAs(
            database,
            fixture.actors.permitted,
            `update public.project_activity_alert_recipients
             set read_at = pg_catalog.clock_timestamp()
             where id = $1::uuid`,
            [target.notificationId],
          )).toMatchObject({ code: "42501" });

          await database.query("savepoint arbitrary_recipient_mutation");
          await expect(database.query(
            `update public.project_activity_alert_recipients
             set created_at = created_at
             where id = $1::uuid`,
            [target.notificationId],
          )).rejects.toMatchObject({ code: "55000" });
          await database.query("rollback to savepoint arbitrary_recipient_mutation");
          await database.query("release savepoint arbitrary_recipient_mutation");
        });
      });

      it("enforces current authorization, ownership, safe errors, and frozen receive membership", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const recipient = fixture.actors.permitted;
          const unrelated = fixture.actors.unpermitted;
          await setReadPermissions(database, recipient.profileId, admin.profileId, [
            "dashboard.view", "projects.view", "projects.alerts.receive",
          ]);
          await setReadPermissions(database, unrelated.profileId, admin.profileId, [
            "dashboard.view", "projects.view",
          ]);

          const owned = await createNotification(database, {
            actorId: admin.profileId,
            createdAt: "2026-10-19T09:00:00Z",
            recipientId: recipient.profileId,
            title: "Task F2 owned notification",
          });
          const foreign = await rejectAs(
            database,
            unrelated,
            markReadSql,
            [owned.notificationId],
          );
          const missing = await rejectAs(
            database,
            unrelated,
            markReadSql,
            [randomUUID()],
          );
          expect(foreign).toMatchObject({ code: "P0002", message: "Notification not found" });
          expect(missing).toMatchObject({ code: "P0002", message: "Notification not found" });

          expect(await rejectAs(database, admin, markReadSql, [owned.notificationId]))
            .toMatchObject({ code: "P0002", message: "Notification not found" });

          const adminOwned = await createNotification(database, {
            actorId: recipient.profileId,
            createdAt: "2026-10-19T09:01:00Z",
            recipientId: admin.profileId,
            title: "Task F2 Admin recipient",
          });
          expect(await callAs<MarkReadRow>(database, admin, markReadSql, [adminOwned.notificationId]))
            .toEqual([expect.objectContaining({ notification_id: adminOwned.notificationId })]);

          await setReadPermissions(database, recipient.profileId, admin.profileId, [
            "dashboard.view", "projects.view",
          ]);
          expect(await callAs<MarkReadRow>(database, recipient, markReadSql, [owned.notificationId]))
            .toEqual([expect.objectContaining({ notification_id: owned.notificationId })]);

          const accessProbe = await createNotification(database, {
            actorId: admin.profileId,
            createdAt: "2026-10-19T09:02:00Z",
            recipientId: recipient.profileId,
            title: "Task F2 current access",
          });
          await setReadPermissions(database, recipient.profileId, admin.profileId, [
            "projects.view",
          ]);
          expect(await rejectAs(database, recipient, markReadSql, [accessProbe.notificationId]))
            .toMatchObject({ code: "42501" });
          await setReadPermissions(database, recipient.profileId, admin.profileId, [
            "dashboard.view",
          ]);
          expect(await rejectAs(database, recipient, markReadSql, [accessProbe.notificationId]))
            .toMatchObject({ code: "42501" });
          expect(await rejectAs(
            database,
            fixture.actors.inactive,
            markReadSql,
            [accessProbe.notificationId],
          )).toMatchObject({ code: "42501" });
          expect(await rejectAs(database, null, markReadSql, [accessProbe.notificationId]))
            .toMatchObject({ code: "42501" });
          expect(await rejectAs(database, recipient, markReadSql, [null]))
            .toMatchObject({ code: "22023" });
        });
      });

      it("updates exactly once, preserves row identity, and creates no side effects", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const recipient = fixture.actors.permitted;
          const adminId = fixture.actors.admin.profileId;
          await setReadPermissions(database, recipient.profileId, adminId, [
            "dashboard.view", "projects.view",
          ]);
          const target = await createNotification(database, {
            actorId: adminId,
            createdAt: "2026-10-19T10:00:00Z",
            recipientId: recipient.profileId,
            title: "Task F2 idempotency",
          });
          const other = await createNotification(database, {
            actorId: adminId,
            createdAt: "2026-10-19T10:01:00Z",
            recipientId: recipient.profileId,
            title: "Task F2 unrelated notification",
          });
          const initial = (await database.query(
            `select id, alert_id, recipient_user_id, created_at, read_at, ctid::text as ctid
             from public.project_activity_alert_recipients
             where id = $1::uuid`,
            [target.notificationId],
          )).rows[0];
          const before = (await database.query(
            `select
               (select pg_catalog.count(*)::text from public.audit_logs) as audits,
               (select pg_catalog.count(*)::text from public.project_activity_updates) as activities,
               (select pg_catalog.count(*)::text from public.project_activity_alerts) as alerts,
               (select read_at from public.project_activity_alert_recipients where id = $1::uuid) as other_read_at`,
            [other.notificationId],
          )).rows[0];

          const first = await callAs<MarkReadRow>(
            database,
            recipient,
            markReadSql,
            [target.notificationId],
          );
          const afterFirst = (await database.query(
            `select id, alert_id, recipient_user_id, created_at, read_at, ctid::text as ctid
             from public.project_activity_alert_recipients
             where id = $1::uuid`,
            [target.notificationId],
          )).rows[0];
          const second = await callAs<MarkReadRow>(
            database,
            recipient,
            markReadSql,
            [target.notificationId],
          );
          const afterSecond = (await database.query(
            `select id, alert_id, recipient_user_id, created_at, read_at, ctid::text as ctid
             from public.project_activity_alert_recipients
             where id = $1::uuid`,
            [target.notificationId],
          )).rows[0];

          expect(first).toEqual([expect.objectContaining({ notification_id: target.notificationId })]);
          expect(second).toEqual(first);
          expect(afterFirst.ctid).not.toBe(initial.ctid);
          expect(afterSecond.ctid).toBe(afterFirst.ctid);
          expect(afterSecond).toMatchObject({
            id: initial.id,
            alert_id: initial.alert_id,
            recipient_user_id: initial.recipient_user_id,
            created_at: initial.created_at,
            read_at: first[0]!.read_at,
          });
          expect((await database.query(
            `select
               (select pg_catalog.count(*)::text from public.audit_logs) as audits,
               (select pg_catalog.count(*)::text from public.project_activity_updates) as activities,
               (select pg_catalog.count(*)::text from public.project_activity_alerts) as alerts,
               (select read_at from public.project_activity_alert_recipients where id = $1::uuid) as other_read_at`,
            [other.notificationId],
          )).rows[0]).toEqual(before);
        });
      });

      it("marks completed and cancelled Project notification history", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const recipient = fixture.actors.permitted;
          const adminId = fixture.actors.admin.profileId;
          await setReadPermissions(database, recipient.profileId, adminId, [
            "dashboard.view", "projects.view",
          ]);
          const completed = await createNotification(database, {
            actorId: adminId,
            createdAt: "2026-10-19T11:00:00Z",
            recipientId: recipient.profileId,
            status: "completed",
            title: "Task F2 completed history",
          });
          const cancelled = await createNotification(database, {
            actorId: adminId,
            createdAt: "2026-10-19T11:01:00Z",
            recipientId: recipient.profileId,
            status: "cancelled",
            title: "Task F2 cancelled history",
          });
          expect(await callAs<MarkReadRow>(database, recipient, markReadSql, [completed.notificationId]))
            .toEqual([expect.objectContaining({ notification_id: completed.notificationId })]);
          expect(await callAs<MarkReadRow>(database, recipient, markReadSql, [cancelled.notificationId]))
            .toEqual([expect.objectContaining({ notification_id: cancelled.notificationId })]);
        });
      });

      localConcurrencyIt("serializes two same-notification marks to one timestamp", async () => {
        const fixture = requireHarness();
        await fixture.withDatabaseClients(3, async ([winner, contender, observer]) => {
          if (!winner || !contender || !observer) {
            throw new Error("Task F2 concurrency clients are unavailable");
          }

          await observer.query("begin");
          const target = await createNotification(observer, {
            actorId: fixture.actors.permitted.profileId,
            createdAt: "2026-10-19T12:00:00Z",
            recipientId: fixture.actors.admin.profileId,
            title: `Task F2 concurrency ${randomUUID()}`,
          });
          const before = (await observer.query(
            `select
               (select ctid::text from public.project_activity_alert_recipients where id = $1::uuid) as ctid,
               (select pg_catalog.count(*)::text from public.audit_logs) as audits,
               (select pg_catalog.count(*)::text from public.project_activity_updates) as activities,
               (select pg_catalog.count(*)::text from public.project_activity_alerts) as alerts`,
            [target.notificationId],
          )).rows[0];
          await observer.query("commit");

          await winner.query("begin");
          await contender.query("begin");
          await winner.query(
            `select id
             from public.project_activity_alert_recipients
             where id = $1::uuid
             for update`,
            [target.notificationId],
          );
          const contenderPid = Number((await contender.query<{ pid: number }>(
            "select pg_catalog.pg_backend_pid() as pid",
          )).rows[0]!.pid);
          await setActor(winner, fixture.actors.admin);
          await setActor(contender, fixture.actors.admin);

          const firstPromise = winner.query<MarkReadRow>(markReadSql, [target.notificationId]);
          const secondPromise = contender.query<MarkReadRow>(markReadSql, [target.notificationId]);
          const first = await firstPromise;
          expect(await waitForLockWait(observer, contenderPid)).toBe(true);
          await winner.query("commit");
          const second = await secondPromise;
          await contender.query("commit");

          expect(first.rows).toHaveLength(1);
          expect(second.rows).toHaveLength(1);
          expect(second.rows[0]).toEqual(first.rows[0]);
          const after = (await observer.query(
            `select
               recipient.read_at,
               recipient.ctid::text as ctid,
               (select pg_catalog.count(*)::text from public.audit_logs) as audits,
               (select pg_catalog.count(*)::text from public.project_activity_updates) as activities,
               (select pg_catalog.count(*)::text from public.project_activity_alerts) as alerts
             from public.project_activity_alert_recipients as recipient
             where recipient.id = $1::uuid`,
            [target.notificationId],
          )).rows[0];
          expect(after).toMatchObject({
            activities: before.activities,
            alerts: before.alerts,
            audits: before.audits,
            read_at: first.rows[0]!.read_at,
          });
          expect(after.ctid).not.toBe(before.ctid);
        });
      });
    },
  );
}
