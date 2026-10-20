import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityFixtureHarness } from "./security-fixtures";

interface NotificationFixture {
  alertId: string;
  notificationId: string;
}

async function expectRejected(
  database: PoolClient,
  sql: string,
  parameters: unknown[],
  code: string,
): Promise<void> {
  await database.query("savepoint rejected_alert_dismissal_foundation");
  try {
    await expect(database.query(sql, parameters)).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback to savepoint rejected_alert_dismissal_foundation");
    await database.query("release savepoint rejected_alert_dismissal_foundation");
  }
}

async function createNotification(
  database: PoolClient,
  actorId: string,
  recipientId: string,
  createdAt: string,
): Promise<NotificationFixture> {
  const projectId = randomUUID();
  const activityId = randomUUID();
  const alertId = randomUUID();
  const notificationId = randomUUID();

  await database.query(
    `insert into public.projects (
       id, name, customer_name, start_date, delivery_date,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, 'Dismissal foundation Customer',
       '2026-10-19'::date, '2026-11-19'::date, $3::uuid, $3::uuid
     )`,
    [projectId, `Dismissal foundation ${projectId}`, actorId],
  );
  await database.query(
    `insert into public.project_activity_updates (
       id, project_id, author_user_id, request_id, title, description, created_at
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       'Dismissal foundation', 'Dismissal foundation description', $5::timestamptz
     )`,
    [activityId, projectId, actorId, randomUUID(), createdAt],
  );
  await database.query(
    `insert into public.project_activity_alerts (
       id, project_activity_id, sent_by_user_id, sent_at
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz)`,
    [alertId, activityId, actorId, createdAt],
  );
  await database.query(
    `insert into public.project_activity_alert_recipients (
       id, alert_id, recipient_user_id, created_at
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz)`,
    [notificationId, alertId, recipientId, createdAt],
  );

  return { alertId, notificationId };
}

export function registerProjectAlertDismissalFoundationTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe.skipIf(process.env.PROJECT_ALERT_DISMISSAL_FOUNDATION !== "1")(
    "Project alert dismissal D1 foundation (requires migration 130)",
    () => {
      it("has the nullable timestamp, constraint, unchanged RLS/ACL, and invoker trigger security", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const column = (await database.query<{
            column_default: string | null;
            data_type: string;
            is_nullable: string;
          }>(
            `select data_type, is_nullable, column_default
             from information_schema.columns
             where table_schema = 'public'
               and table_name = 'project_activity_alert_recipients'
               and column_name = 'dismissed_at'`,
          )).rows;
          expect(column).toEqual([{
            column_default: null,
            data_type: "timestamp with time zone",
            is_nullable: "YES",
          }]);

          const constraint = (await database.query<{ definition: string }>(
            `select pg_catalog.pg_get_constraintdef(constraint_row.oid) as definition
             from pg_catalog.pg_constraint as constraint_row
             where constraint_row.conrelid =
                 'public.project_activity_alert_recipients'::regclass
               and constraint_row.conname =
                 'project_activity_alert_recipients_dismissed_at_valid'`,
          )).rows;
          expect(constraint).toEqual([{
            definition: "CHECK (((dismissed_at IS NULL) OR (dismissed_at >= created_at)))",
          }]);

          const trigger = (await database.query<{
            enabled: string;
            function_name: string;
            is_security_definer: boolean;
            settings: string[];
            volatility: string;
          }>(
            `select
               trigger_row.tgenabled as enabled,
               function_row.proname as function_name,
               function_row.prosecdef as is_security_definer,
               function_row.provolatile as volatility,
               function_row.proconfig as settings
             from pg_catalog.pg_trigger as trigger_row
             join pg_catalog.pg_proc as function_row
               on function_row.oid = trigger_row.tgfoid
             where trigger_row.tgrelid =
                 'public.project_activity_alert_recipients'::regclass
               and trigger_row.tgname =
                 'project_activity_alert_recipients_protect_history'
               and not trigger_row.tgisinternal`,
          )).rows;
          expect(trigger).toEqual([{
            enabled: "O",
            function_name: "enforce_project_activity_alert_recipient_history",
            is_security_definer: false,
            settings: ['search_path=""'],
            volatility: "v",
          }]);

          const security = (await database.query<{
            authenticated_execute: boolean;
            authenticated_table_access: boolean;
            anon_execute: boolean;
            anon_table_access: boolean;
            direct_policies: string;
            public_execute: boolean;
            public_table_access: boolean;
            rls_enabled: boolean;
          }>(
            `select
               relation.relrowsecurity as rls_enabled,
               (select pg_catalog.count(*)::text
                from pg_catalog.pg_policies
                where schemaname = 'public'
                  and tablename = 'project_activity_alert_recipients') as direct_policies,
               pg_catalog.has_table_privilege(
                 'public', relation.oid,
                 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
               ) as public_table_access,
               pg_catalog.has_table_privilege(
                 'anon', relation.oid,
                 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
               ) as anon_table_access,
               pg_catalog.has_table_privilege(
                 'authenticated', relation.oid,
                 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
               ) as authenticated_table_access,
               pg_catalog.has_function_privilege(
                 'public', function_row.oid, 'EXECUTE'
               ) as public_execute,
               pg_catalog.has_function_privilege(
                 'anon', function_row.oid, 'EXECUTE'
               ) as anon_execute,
               pg_catalog.has_function_privilege(
                 'authenticated', function_row.oid, 'EXECUTE'
               ) as authenticated_execute
             from pg_catalog.pg_class as relation
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = relation.relnamespace
             cross join pg_catalog.pg_proc as function_row
             join pg_catalog.pg_namespace as function_namespace
               on function_namespace.oid = function_row.pronamespace
             where namespace.nspname = 'public'
               and relation.relname = 'project_activity_alert_recipients'
               and function_namespace.nspname = 'public'
               and function_row.proname =
                 'enforce_project_activity_alert_recipient_history'`,
          )).rows[0];
          expect(security).toEqual({
            authenticated_execute: false,
            authenticated_table_access: false,
            anon_execute: false,
            anon_table_access: false,
            direct_policies: "0",
            public_execute: false,
            public_table_access: false,
            rls_enabled: true,
          });
        });
      });

      it("enforces one-way independent read and dismissal transitions", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const recipientId = fixture.actors.permitted.profileId;
          const createdAt = "2026-10-19T10:00:00Z";
          const unread = await createNotification(
            database, actorId, recipientId, createdAt,
          );
          const readFirst = await createNotification(
            database, actorId, recipientId, "2026-10-19T10:01:00Z",
          );
          const together = await createNotification(
            database, actorId, recipientId, "2026-10-19T10:02:00Z",
          );

          expect((await database.query(
            `select read_at, dismissed_at
             from public.project_activity_alert_recipients
             where id = $1::uuid`,
            [unread.notificationId],
          )).rows).toEqual([{ dismissed_at: null, read_at: null }]);

          await expectRejected(
            database,
            `insert into public.project_activity_alert_recipients (
               alert_id, recipient_user_id, dismissed_at
             ) values ($1::uuid, $2::uuid, '2026-10-19T10:03:00Z'::timestamptz)`,
            [unread.alertId, fixture.actors.unpermitted.profileId],
            "55000",
          );

          await expectRejected(
            database,
            `update public.project_activity_alert_recipients
             set dismissed_at = '2026-10-19T09:59:59Z'::timestamptz
             where id = $1::uuid`,
            [unread.notificationId],
            "23514",
          );

          await database.query(
            `update public.project_activity_alert_recipients
             set dismissed_at = '2026-10-19T10:03:00Z'::timestamptz
             where id = $1::uuid`,
            [unread.notificationId],
          );
          expect((await database.query(
            `select read_at, dismissed_at
             from public.project_activity_alert_recipients
             where id = $1::uuid`,
            [unread.notificationId],
          )).rows).toEqual([{
            dismissed_at: new Date("2026-10-19T10:03:00Z"),
            read_at: null,
          }]);

          await database.query(
            `update public.project_activity_alert_recipients
             set read_at = '2026-10-19T10:04:00Z'::timestamptz
             where id = $1::uuid`,
            [unread.notificationId],
          );
          expect((await database.query(
            `select read_at, dismissed_at
             from public.project_activity_alert_recipients
             where id = $1::uuid`,
            [unread.notificationId],
          )).rows).toEqual([{
            dismissed_at: new Date("2026-10-19T10:03:00Z"),
            read_at: new Date("2026-10-19T10:04:00Z"),
          }]);

          await database.query(
            `update public.project_activity_alert_recipients
             set read_at = '2026-10-19T10:04:00Z'::timestamptz
             where id = $1::uuid`,
            [readFirst.notificationId],
          );
          await database.query(
            `update public.project_activity_alert_recipients
             set dismissed_at = '2026-10-19T10:05:00Z'::timestamptz
             where id = $1::uuid`,
            [readFirst.notificationId],
          );
          expect((await database.query(
            `select read_at, dismissed_at
             from public.project_activity_alert_recipients
             where id = $1::uuid`,
            [readFirst.notificationId],
          )).rows).toEqual([{
            dismissed_at: new Date("2026-10-19T10:05:00Z"),
            read_at: new Date("2026-10-19T10:04:00Z"),
          }]);

          await database.query(
            `update public.project_activity_alert_recipients
             set read_at = '2026-10-19T10:06:00Z'::timestamptz,
                 dismissed_at = '2026-10-19T10:06:00Z'::timestamptz
             where id = $1::uuid`,
            [together.notificationId],
          );

          for (const [sql, id] of [
            [`update public.project_activity_alert_recipients
              set dismissed_at = dismissed_at + interval '1 second'
              where id = $1::uuid`, unread.notificationId],
            [`update public.project_activity_alert_recipients
              set dismissed_at = null where id = $1::uuid`, unread.notificationId],
            [`update public.project_activity_alert_recipients
              set read_at = read_at + interval '1 second'
              where id = $1::uuid`, unread.notificationId],
            [`update public.project_activity_alert_recipients
              set recipient_user_id = $2::uuid where id = $1::uuid`,
              unread.notificationId],
            [`update public.project_activity_alert_recipients
              set read_at = read_at, dismissed_at = dismissed_at
              where id = $1::uuid`, unread.notificationId],
            [`delete from public.project_activity_alert_recipients
              where id = $1::uuid`, unread.notificationId],
          ] as const) {
            const parameters = sql.includes("$2")
              ? [id, fixture.actors.unpermitted.profileId]
              : [id];
            await expectRejected(database, sql, parameters, "55000");
          }

          await database.query("savepoint browser_dismissal_update");
          try {
            await database.query("set local role authenticated");
            await expect(database.query(
              `update public.project_activity_alert_recipients
               set dismissed_at = pg_catalog.clock_timestamp()
               where id = $1::uuid`,
              [readFirst.notificationId],
            )).rejects.toMatchObject({ code: "42501" });
          } finally {
            await database.query("rollback to savepoint browser_dismissal_update");
            await database.query("release savepoint browser_dismissal_update");
          }
        });
      });
    },
  );
}
