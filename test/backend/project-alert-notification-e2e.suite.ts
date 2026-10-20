import { randomUUID } from "node:crypto";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const postSql = `select * from public.post_project_activity(
  $1::uuid, $2::uuid, $3::text, $4::text, $5::boolean
)`;
const listSql = `select * from public.list_project_alert_notifications(
  $1::integer, $2::timestamptz, $3::uuid
)`;
const countSql = "select public.get_project_alert_unread_count()::text as count";
const markSql = "select * from public.mark_project_alert_read($1::uuid)";

interface PostRow extends QueryResultRow {
  activity_id: string;
  alert_id: string;
  alert_sent: boolean;
  author_user_id: string;
  created_at: Date;
  description: string;
  project_id: string;
  recipient_count: string;
  request_id: string;
  title: string;
}

interface NotificationRow extends QueryResultRow {
  activity_author_full_name: string;
  activity_id: string;
  activity_title: string;
  alert_id: string;
  created_at: Date;
  has_more: boolean;
  notification_id: string;
  project_id: string;
  project_name: string;
  read_at: Date | null;
}

interface MarkRow extends QueryResultRow {
  notification_id: string;
  read_at: Date;
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
  values: unknown[] = [],
): Promise<DatabaseError> {
  await database.query("savepoint rejected_f3_call");
  await setActor(database, actor);
  let caught: unknown;
  try {
    await database.query(sql, values);
  } catch (error) {
    caught = error;
  } finally {
    await database.query("rollback to savepoint rejected_f3_call");
    await database.query("release savepoint rejected_f3_call");
    await database.query("reset role");
  }
  expect(caught).toBeTruthy();
  return caught as DatabaseError;
}

async function setPermissions(
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
         'dashboard.view', 'projects.view', 'projects.edit',
         'projects.alerts.send', 'projects.alerts.receive'
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

async function getActiveAdminIds(database: PoolClient): Promise<string[]> {
  return (await database.query<{ id: string }>(
    `select id
     from public.user_profiles
     where is_active
       and is_admin
     order by id`,
  )).rows.map((row) => row.id);
}

async function getAlertRecipientIds(
  database: PoolClient,
  alertId: string,
): Promise<string[]> {
  return (await database.query<{ recipient_user_id: string }>(
    `select recipient_user_id
     from public.project_activity_alert_recipients
     where alert_id = $1::uuid
     order by recipient_user_id`,
    [alertId],
  )).rows.map((row) => row.recipient_user_id);
}

async function createProject(database: PoolClient, actorId: string) {
  const projectId = randomUUID();
  const projectName = `Task F3 Project ${projectId}`;
  await database.query(
    `insert into public.projects (
       id, name, customer_name, status, start_date, delivery_date,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, 'Task F3 Customer', 'planned',
       '2026-10-19'::date, '2026-11-19'::date, $3::uuid, $3::uuid
     )`,
    [projectId, projectName, actorId],
  );
  return { projectId, projectName };
}

export function registerProjectAlertNotificationE2eTests(
  requireHarness: () => SecurityFixtureHarness,
) {
  describe.skipIf(
    process.env.TASKF3_PROJECT_ALERT_E2E !== "1" ||
      process.env.SUPABASE_LOCAL_TEST !== "1",
  )("Task F3 Project alert notification E2E (local only)", () => {
    it("posts, snapshots, lists, marks, isolates, and restores historical access", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const admin = fixture.actors.admin;
        const sender = fixture.actors.unpermitted;
        const recipient = fixture.actors.permitted;
        const otherRecipient = fixture.actors.brandManager;
        const lateRecipient = fixture.actors.productEditor;
        const { projectId, projectName } = await createProject(
          database,
          admin.profileId,
        );

        await database.query(
          `delete from public.user_permissions as permission
           using public.permission_definitions as definition
           where definition.id = permission.permission_definition_id
             and definition.key = 'projects.alerts.receive'`,
        );
        await setPermissions(database, sender.profileId, admin.profileId, [
          "dashboard.view",
          "projects.view",
          "projects.edit",
          "projects.alerts.send",
          "projects.alerts.receive",
        ]);
        for (const actor of [recipient, otherRecipient]) {
          await setPermissions(database, actor.profileId, admin.profileId, [
            "dashboard.view",
            "projects.view",
            "projects.alerts.receive",
          ]);
        }
        await setPermissions(database, lateRecipient.profileId, admin.profileId, [
          "dashboard.view",
          "projects.view",
        ]);
        const expectedRecipients = [
          ...await getActiveAdminIds(database),
          otherRecipient.profileId,
          recipient.profileId,
          sender.profileId,
        ].sort();
        const requestId = randomUUID();
        const posted = (await callAs<PostRow>(database, sender, postSql, [
          projectId,
          requestId,
          "Task F3 alert",
          "Private Task F3 Activity description",
          true,
        ]))[0]!;
        expect(posted).toMatchObject({
          alert_sent: true,
          author_user_id: sender.profileId,
          project_id: projectId,
          recipient_count: String(expectedRecipients.length),
          request_id: requestId,
        });
        expect((await callAs<PostRow>(database, sender, postSql, [
          projectId,
          requestId,
          "Task F3 alert",
          "Private Task F3 Activity description",
          true,
        ]))[0]).toEqual(posted);

        const recipients = await getAlertRecipientIds(database, posted.alert_id);
        expect(recipients).toEqual(expectedRecipients);
        expect(recipients).not.toContain(lateRecipient.profileId);

        await setPermissions(database, lateRecipient.profileId, admin.profileId, [
          "dashboard.view",
          "projects.view",
          "projects.alerts.receive",
        ]);
        expect((await database.query<{ count: string }>(
          `select pg_catalog.count(*)::text as count
           from public.project_activity_alert_recipients
           where alert_id = $1::uuid`,
          [posted.alert_id],
        )).rows[0]?.count).toBe(String(expectedRecipients.length));

        const senderRows = await callAs<NotificationRow>(
          database,
          sender,
          listSql,
          [20, null, null],
        );
        expect(senderRows).toHaveLength(1);
        expect(senderRows[0]).toMatchObject({
          activity_id: posted.activity_id,
          alert_id: posted.alert_id,
          project_id: projectId,
          read_at: null,
        });
        expect(await callAs<{ count: string }>(database, sender, countSql))
          .toEqual([{ count: "1" }]);
        const senderMark = await callAs<MarkRow>(
          database,
          sender,
          markSql,
          [senderRows[0]!.notification_id],
        );
        expect(senderMark).toEqual([{
          notification_id: senderRows[0]!.notification_id,
          read_at: expect.any(Date),
        }]);
        expect(await callAs<{ count: string }>(database, sender, countSql))
          .toEqual([{ count: "0" }]);

        const recipientRows = await callAs<NotificationRow>(
          database,
          recipient,
          listSql,
          [20, null, null],
        );
        expect(recipientRows).toHaveLength(1);
        expect(Object.keys(recipientRows[0]!).sort()).toEqual([
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
        expect(recipientRows[0]).toMatchObject({
          activity_id: posted.activity_id,
          activity_title: "Task F3 alert",
          alert_id: posted.alert_id,
          has_more: false,
          project_id: projectId,
          project_name: projectName,
          read_at: null,
        });
        const notificationId = recipientRows[0]!.notification_id;
        expect(await callAs<{ count: string }>(database, recipient, countSql))
          .toEqual([{ count: "1" }]);

        const otherRows = await callAs<NotificationRow>(
          database,
          otherRecipient,
          listSql,
          [20, null, null],
        );
        expect(otherRows).toHaveLength(1);
        expect(otherRows[0]!.read_at).toBeNull();
        expect(await callAs<{ count: string }>(database, otherRecipient, countSql))
          .toEqual([{ count: "1" }]);

        const beforeReads = (await database.query<{
          activities: string;
          alerts: string;
          audits: string;
          recipients: string;
        }>(
          `select
             (select pg_catalog.count(*)::text from public.project_activity_updates) as activities,
             (select pg_catalog.count(*)::text from public.project_activity_alerts) as alerts,
             (select pg_catalog.count(*)::text from public.project_activity_alert_recipients) as recipients,
             (select pg_catalog.count(*)::text from public.audit_logs) as audits`,
        )).rows[0]!;

        const firstMark = await callAs<MarkRow>(
          database,
          recipient,
          markSql,
          [notificationId],
        );
        expect(firstMark).toEqual([{
          notification_id: notificationId,
          read_at: expect.any(Date),
        }]);
        expect(await callAs<{ count: string }>(database, recipient, countSql))
          .toEqual([{ count: "0" }]);
        const afterMark = await callAs<NotificationRow>(
          database,
          recipient,
          listSql,
          [20, null, null],
        );
        expect(afterMark[0]!.read_at).toEqual(firstMark[0]!.read_at);
        expect(await callAs<MarkRow>(database, recipient, markSql, [notificationId]))
          .toEqual(firstMark);

        expect(await callAs<{ count: string }>(database, otherRecipient, countSql))
          .toEqual([{ count: "1" }]);
        expect((await callAs<NotificationRow>(
          database,
          otherRecipient,
          listSql,
          [20, null, null],
        ))[0]!.read_at).toBeNull();
        expect(await rejectAs(database, admin, markSql, [notificationId]))
          .toMatchObject({ code: "P0002", message: "Notification not found" });
        expect(await rejectAs(
          database,
          recipient,
          markSql,
          [otherRows[0]!.notification_id],
        )).toMatchObject({ code: "P0002", message: "Notification not found" });
        expect(await rejectAs(database, recipient, markSql, [randomUUID()]))
          .toMatchObject({ code: "P0002", message: "Notification not found" });

        expect((await database.query(
          `select
             (select pg_catalog.count(*)::text from public.project_activity_updates) as activities,
             (select pg_catalog.count(*)::text from public.project_activity_alerts) as alerts,
             (select pg_catalog.count(*)::text from public.project_activity_alert_recipients) as recipients,
             (select pg_catalog.count(*)::text from public.audit_logs) as audits`,
        )).rows[0]).toEqual(beforeReads);

        const audits = (await database.query<{
          action_type: string;
          after_data: unknown;
          before_data: unknown;
          metadata: Record<string, unknown>;
          summary: string;
        }>(
          `select action_type, summary, before_data, after_data, metadata
           from public.audit_logs
           where entity_id in ($1::uuid, $2::uuid)
           order by action_type`,
          [posted.activity_id, posted.alert_id],
        )).rows;
        expect(audits).toHaveLength(2);
        expect(audits.map((row) => row.action_type)).toEqual([
          "project_activity.alert_sent",
          "project_activity.created",
        ]);
        expect(audits.every((row) =>
          row.before_data === null && row.after_data === null
        )).toBe(true);
        expect(JSON.stringify(audits)).not.toContain("Private Task F3 Activity description");
        expect(JSON.stringify(audits)).not.toContain("recipient_user_id");

        await setPermissions(database, recipient.profileId, admin.profileId, [
          "dashboard.view",
          "projects.view",
        ]);
        expect(await callAs<NotificationRow>(database, recipient, listSql, [20, null, null]))
          .toHaveLength(1);

        await setPermissions(database, recipient.profileId, admin.profileId, [
          "projects.view",
        ]);
        for (const [sql, values] of [
          [listSql, [20, null, null]],
          [countSql, []],
          [markSql, [notificationId]],
        ] as const) {
          expect(await rejectAs(database, recipient, sql, [...values]))
            .toMatchObject({ code: "42501" });
        }
        await setPermissions(database, recipient.profileId, admin.profileId, [
          "dashboard.view",
        ]);
        for (const [sql, values] of [
          [listSql, [20, null, null]],
          [countSql, []],
          [markSql, [notificationId]],
        ] as const) {
          expect(await rejectAs(database, recipient, sql, [...values]))
            .toMatchObject({ code: "42501" });
        }

        await setPermissions(database, recipient.profileId, admin.profileId, [
          "dashboard.view",
          "projects.view",
        ]);
        await callAs(database, admin, "select public.set_user_active_state_admin($1::uuid, false)", [
          recipient.profileId,
        ]);
        for (const [sql, values] of [
          [listSql, [20, null, null]],
          [countSql, []],
          [markSql, [notificationId]],
        ] as const) {
          expect(await rejectAs(database, recipient, sql, [...values]))
            .toMatchObject({ code: "42501" });
        }
        expect((await database.query<{ count: string }>(
          `select pg_catalog.count(*)::text as count
           from public.project_activity_alert_recipients
           where id = $1::uuid`,
          [notificationId],
        )).rows[0]?.count).toBe("1");

        await callAs(database, admin, "select public.set_user_active_state_admin($1::uuid, true)", [
          recipient.profileId,
        ]);
        expect(await callAs<NotificationRow>(database, recipient, listSql, [20, null, null]))
          .toEqual(afterMark);
      });
    });

    it("includes an active Admin sender without receive permission and marks it independently", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const admin = fixture.actors.admin;
        const otherRecipient = fixture.actors.brandManager;
        const { projectId } = await createProject(database, admin.profileId);

        await database.query(
          `delete from public.user_permissions as permission
           using public.permission_definitions as definition
           where definition.id = permission.permission_definition_id
             and definition.key = 'projects.alerts.receive'`,
        );
        await setPermissions(database, otherRecipient.profileId, admin.profileId, [
          "dashboard.view",
          "projects.view",
          "projects.alerts.receive",
        ]);
        const expectedRecipients = [
          ...await getActiveAdminIds(database),
          otherRecipient.profileId,
        ].sort();

        const posted = (await callAs<PostRow>(database, admin, postSql, [
          projectId,
          randomUUID(),
          "Admin sender alert",
          "The eligible Admin sender receives this alert",
          true,
        ]))[0]!;
        expect(posted.recipient_count).toBe(String(expectedRecipients.length));
        expect(await getAlertRecipientIds(database, posted.alert_id))
          .toEqual(expectedRecipients);

        const adminRows = await callAs<NotificationRow>(
          database,
          admin,
          listSql,
          [20, null, null],
        );
        const ownNotification = adminRows.find((row) => row.alert_id === posted.alert_id);
        expect(ownNotification).toMatchObject({ read_at: null });
        expect(await callAs<{ count: string }>(database, admin, countSql))
          .toEqual([{ count: "1" }]);

        expect(await callAs<MarkRow>(
          database,
          admin,
          markSql,
          [ownNotification!.notification_id],
        )).toEqual([{
          notification_id: ownNotification!.notification_id,
          read_at: expect.any(Date),
        }]);
        expect(await callAs<{ count: string }>(database, admin, countSql))
          .toEqual([{ count: "0" }]);
        expect(await callAs<{ count: string }>(database, otherRecipient, countSql))
          .toEqual([{ count: "1" }]);
      });
    });
  });
}
