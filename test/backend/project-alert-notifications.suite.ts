import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261019110000_add_project_alert_notification_reads.sql",
);

const listSql = `select * from public.list_project_alert_notifications(
  $1::integer, $2::timestamptz, $3::uuid
)`;

interface NotificationRow extends QueryResultRow {
  notification_id: string;
  alert_id: string;
  project_id: string;
  project_name: string;
  activity_id: string;
  activity_title: string;
  activity_author_full_name: string;
  created_at: Date;
  read_at: Date | null;
  has_more: boolean;
}

interface NotificationFixture {
  activityId: string;
  alertId: string;
  notificationId: string;
  projectId: string;
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

async function expectRejected(
  database: PoolClient,
  actor: SecurityActor | null,
  sql: string,
  values: unknown[],
  code: string,
) {
  await database.query("savepoint rejected_notification_read");
  await setActor(database, actor);
  try {
    await expect(database.query(sql, values)).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback to savepoint rejected_notification_read");
    await database.query("release savepoint rejected_notification_read");
    await database.query("reset role");
  }
}

async function setNotificationPermissions(
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
    authorId?: string;
    createdAt: string;
    notificationId?: string;
    recipientId: string;
    status?: "planned" | "in_progress" | "on_hold" | "completed" | "cancelled";
    title: string;
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
       $1::uuid, $2::text, 'Task F1 Customer', $3::text,
       '2026-10-19'::date, '2026-11-19'::date,
       case when $3::text = 'completed' then $4::timestamptz else null end,
       case when $3::text = 'cancelled' then $4::timestamptz else null end,
       $5::uuid, $5::uuid
     )`,
    [projectId, `Task F1 Project ${projectId}`, status, options.createdAt, options.actorId],
  );
  await database.query(
    `insert into public.project_activity_updates (
       id, project_id, author_user_id, request_id, title, description, created_at
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
       'Task F1 private Activity description', $6::timestamptz
     )`,
    [
      activityId,
      projectId,
      options.authorId ?? options.actorId,
      randomUUID(),
      options.title,
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

export function registerProjectAlertNotificationTests(
  requireHarness: () => SecurityFixtureHarness,
) {
  describe("Task F1 Project alert notification reads (static)", () => {
    it("contains only the two reviewed read functions", () => {
      const sql = readFileSync(migrationPath, "utf8");
      expect(sql.match(/create function public\./g)).toHaveLength(2);
      expect(sql).toContain("public.list_project_alert_notifications(");
      expect(sql).toContain("public.get_project_alert_unread_count()");
      expect(sql).not.toContain("mark_project_alert_read");
      expect(sql).not.toMatch(/create\s+(?:table|index)|alter\s+table/i);
    });
  });

  describe.skipIf(process.env.TASKF1_PROJECT_ALERT_READS !== "1")(
    "Task F1 Project alert notification reads (requires migration 126)",
    () => {
      it("has exact metadata, ACLs, projection, and unchanged direct-table denial", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const metadata = (await database.query<{
            arguments: string;
            authenticated_execute: boolean;
            function_name: string;
            public_execute: boolean;
            anon_execute: boolean;
            result_type: string;
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
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             where namespace.nspname = 'public'
               and routine.proname in (
                 'get_project_alert_unread_count',
                 'list_project_alert_notifications'
               )
             order by routine.proname`,
          )).rows;
          expect(metadata).toEqual([
            {
              arguments: "",
              authenticated_execute: true,
              function_name: "get_project_alert_unread_count",
              public_execute: false,
              anon_execute: false,
              result_type: "bigint",
              security_definer: true,
              settings: ['search_path=""'],
              volatility: "s",
            },
            {
              arguments: "p_limit integer, p_before_created_at timestamp with time zone, p_before_recipient_id uuid",
              authenticated_execute: true,
              function_name: "list_project_alert_notifications",
              public_execute: false,
              anon_execute: false,
              result_type: "TABLE(notification_id uuid, alert_id uuid, project_id uuid, project_name text, activity_id uuid, activity_title text, activity_author_full_name text, created_at timestamp with time zone, read_at timestamp with time zone, has_more boolean)",
              security_definer: true,
              settings: ['search_path=""'],
              volatility: "s",
            },
          ]);

          for (const actor of [fixture.actors.admin, fixture.actors.permitted]) {
            await expectRejected(
              database,
              actor,
              "select * from public.project_activity_alert_recipients",
              [],
              "42501",
            );
          }
        });
      });

      it("enforces current access, recipient isolation, and frozen receive history", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const adminId = fixture.actors.admin.profileId;
          const recipient = fixture.actors.permitted;
          const unrelated = fixture.actors.unpermitted;
          await setNotificationPermissions(database, recipient.profileId, adminId, [
            "dashboard.view", "projects.view", "projects.alerts.receive",
          ]);
          await setNotificationPermissions(database, unrelated.profileId, adminId, [
            "dashboard.view", "projects.view",
          ]);

          const addressed = await createNotification(database, {
            actorId: adminId,
            createdAt: "2026-10-19T09:00:00Z",
            recipientId: recipient.profileId,
            title: "Recipient-only alert",
          });

          expect(await callAs<NotificationRow>(
            database,
            fixture.actors.admin,
            listSql,
            [20, null, null],
          )).toEqual([]);
          const adminAddressed = await createNotification(database, {
            actorId: adminId,
            createdAt: "2026-10-19T08:59:00Z",
            recipientId: fixture.actors.admin.profileId,
            title: "Admin recipient alert",
          });
          expect(await callAs<NotificationRow>(
            database,
            fixture.actors.admin,
            listSql,
            [20, null, null],
          )).toEqual([
            expect.objectContaining({
              notification_id: adminAddressed.notificationId,
              activity_title: "Admin recipient alert",
            }),
          ]);
          const rows = await callAs<NotificationRow>(
            database,
            recipient,
            listSql,
            [20, null, null],
          );
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({
            notification_id: addressed.notificationId,
            activity_title: "Recipient-only alert",
            activity_author_full_name: expect.any(String),
            has_more: false,
            read_at: null,
          });
          expect(Object.keys(rows[0]!).sort()).toEqual([
            "activity_author_full_name",
            "activity_id",
            "activity_title",
            "alert_id",
            "created_at",
            "has_more",
            "notification_id",
            "project_id",
            "project_name",
            "read_at",
          ]);
          expect(await callAs<NotificationRow>(
            database,
            unrelated,
            listSql,
            [20, null, null],
          )).toEqual([]);

          await setNotificationPermissions(database, recipient.profileId, adminId, [
            "dashboard.view", "projects.view",
          ]);
          expect(await callAs<NotificationRow>(
            database,
            recipient,
            listSql,
            [20, null, null],
          )).toHaveLength(1);

          await setNotificationPermissions(database, recipient.profileId, adminId, [
            "projects.view",
          ]);
          await expectRejected(database, recipient, listSql, [20, null, null], "42501");
          await setNotificationPermissions(database, recipient.profileId, adminId, [
            "dashboard.view",
          ]);
          await expectRejected(database, recipient, listSql, [20, null, null], "42501");
          await expectRejected(
            database,
            fixture.actors.inactive,
            listSql,
            [20, null, null],
            "42501",
          );
          await expectRejected(database, null, listSql, [20, null, null], "42501");
        });
      });

      it("retains completed/cancelled history and inactive author attribution", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const recipient = fixture.actors.permitted;
          await setNotificationPermissions(
            database,
            recipient.profileId,
            fixture.actors.admin.profileId,
            ["dashboard.view", "projects.view"],
          );
          await createNotification(database, {
            actorId: fixture.actors.admin.profileId,
            authorId: fixture.actors.inactive.profileId,
            createdAt: "2026-10-19T10:00:00Z",
            recipientId: recipient.profileId,
            status: "completed",
            title: "Completed history",
          });
          await createNotification(database, {
            actorId: fixture.actors.admin.profileId,
            authorId: fixture.actors.inactive.profileId,
            createdAt: "2026-10-19T11:00:00Z",
            recipientId: recipient.profileId,
            status: "cancelled",
            title: "Cancelled history",
          });
          const inactiveAuthor = (await database.query<{ full_name: string }>(
            `select full_name
             from public.user_profiles
             where id = $1::uuid`,
            [fixture.actors.inactive.profileId],
          )).rows[0]!.full_name;
          const rows = await callAs<NotificationRow>(
            database,
            recipient,
            listSql,
            [20, null, null],
          );
          expect(rows.map((row) => row.activity_title)).toEqual([
            "Cancelled history",
            "Completed history",
          ]);
          expect(rows.every(
            (row) => row.activity_author_full_name === inactiveAuthor,
          )).toBe(true);
        });
      });

      it("returns an exact isolated bigint unread count without changing rows", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const recipient = fixture.actors.permitted;
          const other = fixture.actors.unpermitted;
          const adminId = fixture.actors.admin.profileId;
          for (const actor of [recipient, other]) {
            await setNotificationPermissions(database, actor.profileId, adminId, [
              "dashboard.view", "projects.view",
            ]);
          }
          const first = await createNotification(database, {
            actorId: adminId,
            createdAt: "2026-10-19T12:00:00Z",
            recipientId: recipient.profileId,
            title: "Unread one",
          });
          await createNotification(database, {
            actorId: adminId,
            createdAt: "2026-10-19T12:01:00Z",
            recipientId: recipient.profileId,
            title: "Unread two",
          });
          await createNotification(database, {
            actorId: adminId,
            createdAt: "2026-10-19T12:02:00Z",
            recipientId: other.profileId,
            title: "Other recipient",
          });
          await database.query(
            `update public.project_activity_alert_recipients
             set read_at = created_at + interval '1 second'
             where id = $1::uuid`,
            [first.notificationId],
          );

          const before = (await database.query<{
            activities: string;
            audits: string;
            recipients: string;
            read_values: string;
          }>(
            `select
               (select pg_catalog.count(*)::text from public.project_activity_updates) as activities,
               (select pg_catalog.count(*)::text from public.audit_logs) as audits,
               (select pg_catalog.count(*)::text from public.project_activity_alert_recipients) as recipients,
               (select pg_catalog.count(read_at)::text from public.project_activity_alert_recipients) as read_values`,
          )).rows[0]!;
          const count = await callAs<{ count: string; result_type: string }>(
            database,
            recipient,
            `select public.get_project_alert_unread_count()::text as count,
                    pg_catalog.pg_typeof(public.get_project_alert_unread_count())::text as result_type`,
          );
          expect(count).toEqual([{ count: "1", result_type: "bigint" }]);
          expect(await callAs<{ count: string }>(
            database,
            other,
            "select public.get_project_alert_unread_count()::text as count",
          )).toEqual([{ count: "1" }]);
          await setNotificationPermissions(database, recipient.profileId, adminId, [
            "projects.view",
          ]);
          await expectRejected(
            database,
            recipient,
            "select public.get_project_alert_unread_count()",
            [],
            "42501",
          );
          await expectRejected(
            database,
            fixture.actors.inactive,
            "select public.get_project_alert_unread_count()",
            [],
            "42501",
          );
          await expectRejected(
            database,
            null,
            "select public.get_project_alert_unread_count()",
            [],
            "42501",
          );
          await setNotificationPermissions(database, recipient.profileId, adminId, [
            "dashboard.view", "projects.view",
          ]);
          await callAs<NotificationRow>(database, recipient, listSql, [20, null, null]);
          const after = (await database.query(
            `select
               (select pg_catalog.count(*)::text from public.project_activity_updates) as activities,
               (select pg_catalog.count(*)::text from public.audit_logs) as audits,
               (select pg_catalog.count(*)::text from public.project_activity_alert_recipients) as recipients,
               (select pg_catalog.count(read_at)::text from public.project_activity_alert_recipients) as read_values`,
          )).rows[0];
          expect(after).toEqual(before);
        });
      });

      it("validates limits/cursors and paginates tied timestamps without overlap or gaps", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const recipient = fixture.actors.permitted;
          const adminId = fixture.actors.admin.profileId;
          await setNotificationPermissions(database, recipient.profileId, adminId, [
            "dashboard.view", "projects.view",
          ]);
          for (let index = 0; index < 55; index += 1) {
            await createNotification(database, {
              actorId: adminId,
              createdAt: index < 2
                ? "2026-10-19T14:00:00Z"
                : new Date(Date.parse("2026-10-19T13:00:00Z") - index * 1_000)
                  .toISOString(),
              recipientId: recipient.profileId,
              title: `Page alert ${index.toString().padStart(2, "0")}`,
            });
          }

          const defaultPage = await callAs<NotificationRow>(
            database,
            recipient,
            "select * from public.list_project_alert_notifications()",
          );
          expect(defaultPage).toHaveLength(20);
          expect(defaultPage.every((row) => row.has_more)).toBe(true);
          expect(await callAs<NotificationRow>(
            database,
            recipient,
            listSql,
            [1, null, null],
          )).toHaveLength(1);
          const fifty = await callAs<NotificationRow>(
            database,
            recipient,
            listSql,
            [50, null, null],
          );
          expect(fifty).toHaveLength(50);
          expect(fifty.every((row) => row.has_more)).toBe(true);

          for (const limit of [null, 0, 51]) {
            await expectRejected(database, recipient, listSql, [limit, null, null], "22023");
          }
          await expectRejected(
            database,
            recipient,
            listSql,
            [20, "2026-10-19T14:00:00Z", null],
            "22023",
          );
          await expectRejected(
            database,
            recipient,
            listSql,
            [20, null, randomUUID()],
            "22023",
          );

          const expected = (await database.query<{ id: string }>(
            `select id
             from public.project_activity_alert_recipients
             where recipient_user_id = $1::uuid
             order by created_at desc, id desc`,
            [recipient.profileId],
          )).rows.map((row) => row.id);
          const actual: string[] = [];
          let cursor: { createdAt: Date; id: string } | null = null;
          for (;;) {
            const page: NotificationRow[] = await callAs<NotificationRow>(
              database,
              recipient,
              listSql,
              [20, cursor?.createdAt ?? null, cursor?.id ?? null],
            );
            actual.push(...page.map((row: NotificationRow) => row.notification_id));
            if (page.length === 0 || !page[0]!.has_more) {
              expect(page).toHaveLength(15);
              expect(page.every((row: NotificationRow) => !row.has_more)).toBe(true);
              break;
            }
            const last: NotificationRow = page[page.length - 1]!;
            cursor = { createdAt: last.created_at, id: last.notification_id };
          }
          expect(actual).toEqual(expected);
          expect(new Set(actual).size).toBe(55);

          const last = actual[actual.length - 1]!;
          const terminalCursor = (await database.query<{ created_at: Date }>(
            `select created_at
             from public.project_activity_alert_recipients
             where id = $1::uuid`,
            [last],
          )).rows[0]!.created_at;
          expect(await callAs<NotificationRow>(
            database,
            recipient,
            listSql,
            [20, terminalCursor, last],
          )).toEqual([]);
        });
      });
    },
  );
}
