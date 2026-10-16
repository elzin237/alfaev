import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261016140000_add_trusted_project_activity_operations.sql",
);

const postSql = `select * from public.post_project_activity(
  $1::uuid, $2::uuid, $3::text, $4::text, $5::boolean
)`;

interface PostRow extends QueryResultRow {
  activity_id: string;
  project_id: string;
  request_id: string;
  title: string;
  description: string;
  created_at: Date;
  author_user_id: string;
  alert_sent: boolean;
  alert_id: string | null;
  recipient_count: string;
}

interface ActivityRow extends QueryResultRow {
  activity_id: string;
  project_id: string;
  author_user_id: string;
  author_full_name: string;
  title: string;
  description: string;
  created_at: Date;
  alert_sent: boolean;
  attachment_id: string | null;
  attachment_mime_type: string | null;
  attachment_byte_size: string | null;
  attachment_alt_text: string | null;
  has_more?: boolean;
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
  values: unknown[],
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
): Promise<void> {
  await database.query("savepoint rejected_project_activity_call");
  await setActor(database, actor);
  try {
    await expect(database.query(sql, values)).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback to savepoint rejected_project_activity_call");
    await database.query("release savepoint rejected_project_activity_call");
  }
}

async function grantPermissions(
  database: PoolClient,
  userId: string,
  grantedByUserId: string,
  keys: string[],
): Promise<void> {
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

async function createProject(
  database: PoolClient,
  actorId: string,
  status: "planned" | "in_progress" | "on_hold" | "completed" | "cancelled" = "planned",
): Promise<string> {
  const projectId = randomUUID();
  await database.query(
    `insert into public.projects (
       id, name, customer_name, status, start_date, delivery_date,
       completed_at, cancelled_at, created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, 'Activity Customer', $3::text,
       '2026-10-16'::date, '2026-11-16'::date,
       case when $3::text = 'completed' then pg_catalog.now() else null end,
       case when $3::text = 'cancelled' then pg_catalog.now() else null end,
       $4::uuid, $4::uuid
     )`,
    [projectId, `Activity Project ${projectId}`, status, actorId],
  );
  return projectId;
}

export function registerProjectActivityOperationsTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task C Project Activity operations (static)", () => {
    it("uses the reviewed trusted-operation, idempotency, pagination, and ACL patterns", () => {
      const sql = readFileSync(migrationPath, "utf8");
      expect(sql).toContain("create function public.post_project_activity(");
      expect(sql).toContain("pg_catalog.pg_advisory_xact_lock(");
      expect(sql).toContain("for update;");
      expect(sql).toContain("create function public.list_project_activity(");
      expect(sql).toContain("create function public.get_project_activity(");
      expect(sql.match(/security definer/g)).toHaveLength(3);
      expect(sql.match(/set search_path = ''/g)).toHaveLength(3);
      expect(sql.match(/to authenticated;/g)).toHaveLength(3);
      expect(sql).not.toMatch(/\boffset\b/i);
      expect(sql).not.toContain("attachment.storage_path");
      expect(sql).not.toMatch(/insert into public\.project_activity_attachments/i);
    });
  });

  describe.skipIf(process.env.TASKC_PROJECT_ACTIVITY !== "1")(
    "Task C Project Activity operations (requires migration 124)",
    () => {
      it("has exact trusted RPC metadata and preserves direct-table denial", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const functions = (await database.query<{
            arguments: string;
            configuration: string[] | null;
            function_name: string;
            is_security_definer: boolean;
            volatility: string;
          }>(
            `select
               procedure.proname as function_name,
               pg_catalog.pg_get_function_identity_arguments(procedure.oid) as arguments,
               procedure.prosecdef as is_security_definer,
               procedure.provolatile as volatility,
               procedure.proconfig as configuration
             from pg_catalog.pg_proc as procedure
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'public'
               and procedure.proname = any($1::text[])
             order by procedure.proname`,
            [["get_project_activity", "list_project_activity", "post_project_activity"]],
          )).rows;
          expect(functions).toEqual([
            {
              function_name: "get_project_activity",
              arguments: "p_project_id uuid, p_activity_id uuid",
              is_security_definer: true,
              volatility: "s",
              configuration: ["search_path=\"\""],
            },
            {
              function_name: "list_project_activity",
              arguments: "p_project_id uuid, p_limit integer, p_before_created_at timestamp with time zone, p_before_id uuid",
              is_security_definer: true,
              volatility: "s",
              configuration: ["search_path=\"\""],
            },
            {
              function_name: "post_project_activity",
              arguments: "p_project_id uuid, p_request_id uuid, p_title text, p_description text, p_send_alert boolean",
              is_security_definer: true,
              volatility: "v",
              configuration: ["search_path=\"\""],
            },
          ]);

          for (const signature of [
            "public.get_project_activity(uuid,uuid)",
            "public.list_project_activity(uuid,integer,timestamp with time zone,uuid)",
            "public.post_project_activity(uuid,uuid,text,text,boolean)",
          ]) {
            for (const [role, allowed] of [
              ["public", false],
              ["anon", false],
              ["authenticated", true],
            ] as const) {
              expect((await database.query<{ allowed: boolean }>(
                "select pg_catalog.has_function_privilege($1::text, $2::text, 'EXECUTE') as allowed",
                [role, signature],
              )).rows[0]?.allowed).toBe(allowed);
            }
          }

          for (const table of [
            "project_activity_updates",
            "project_activity_attachments",
            "project_activity_alerts",
            "project_activity_alert_recipients",
          ]) {
            for (const role of ["public", "anon", "authenticated"]) {
              expect((await database.query<{ allowed: boolean }>(
                `select pg_catalog.has_table_privilege(
                   $1::text, $2::text, 'SELECT,INSERT,UPDATE,DELETE'
                 ) as allowed`,
                [role, `public.${table}`],
              )).rows[0]?.allowed).toBe(false);
            }
          }

          for (const sql of [
            "select * from public.project_activity_updates limit 1",
            `insert into public.project_activity_updates (
               project_id, author_user_id, request_id, title, description
             ) values (
               '00000000-0000-0000-0000-000000000001'::uuid,
               '00000000-0000-0000-0000-000000000002'::uuid,
               '00000000-0000-0000-0000-000000000003'::uuid,
               'Denied', 'Denied'
             )`,
            "update public.project_activity_updates set title = title",
            "delete from public.project_activity_updates",
            "select * from public.project_activity_alerts limit 1",
            "select * from public.project_activity_alert_recipients limit 1",
          ]) {
            await expectRejected(
              database,
              fixture.actors.admin,
              sql,
              [],
              "42501",
            );
          }
        });
      });

      it("authorizes and normalizes normal posts while enforcing Project lifecycle", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const adminId = fixture.actors.admin.profileId;
          const projects = {
            planned: await createProject(database, adminId, "planned"),
            in_progress: await createProject(database, adminId, "in_progress"),
            on_hold: await createProject(database, adminId, "on_hold"),
            completed: await createProject(database, adminId, "completed"),
            cancelled: await createProject(database, adminId, "cancelled"),
          };

          await grantPermissions(
            database,
            fixture.actors.unpermitted.profileId,
            adminId,
            ["projects.edit"],
          );

          const normalRequestId = randomUUID();
          const normalized = (await callAs<PostRow>(
            database,
            fixture.actors.unpermitted,
            postSql,
            [projects.planned, normalRequestId, "  Status update  ", "  Line one\nLine two  ", false],
          ))[0]!;
          expect(normalized).toMatchObject({
            project_id: projects.planned,
            title: "Status update",
            description: "Line one\nLine two",
            author_user_id: fixture.actors.unpermitted.profileId,
            alert_sent: false,
            alert_id: null,
            recipient_count: "0",
          });
          const normalRetry = (await callAs<PostRow>(
            database,
            fixture.actors.unpermitted,
            postSql,
            [projects.planned, normalRequestId, "Status update", "Line one\nLine two", false],
          ))[0]!;
          expect(normalRetry).toEqual(normalized);
          expect((await database.query<{ count: string }>(
            `select pg_catalog.count(*)::text as count
             from public.audit_logs
             where entity_id = $1::uuid
               and action_type = 'project_activity.created'`,
            [normalized.activity_id],
          )).rows[0]?.count).toBe("1");

          for (const projectId of [projects.in_progress, projects.on_hold]) {
            expect(await callAs<PostRow>(
              database,
              fixture.actors.admin,
              postSql,
              [projectId, randomUUID(), "Allowed", "Open Project", false],
            )).toHaveLength(1);
          }

          for (const projectId of [projects.completed, projects.cancelled]) {
            await expectRejected(
              database,
              fixture.actors.admin,
              postSql,
              [projectId, randomUUID(), "Blocked", "Closed Project", false],
              "PAC02",
            );
          }

          for (const actor of [
            fixture.actors.permitted,
            fixture.actors.productCreator,
            fixture.actors.inactive,
          ]) {
            await expectRejected(
              database,
              actor,
              postSql,
              [projects.planned, randomUUID(), "Denied", "No post authority", false],
              "42501",
            );
          }
          await expectRejected(
            database,
            null,
            postSql,
            [projects.planned, randomUUID(), "Denied", "Anonymous", false],
            "42501",
          );

          for (const values of [
            [null, randomUUID(), "Valid", "Valid", false],
            [projects.planned, null, "Valid", "Valid", false],
            [projects.planned, randomUUID(), "Valid", "Valid", null],
          ]) {
            await expectRejected(
              database,
              fixture.actors.admin,
              postSql,
              values,
              "22023",
            );
          }

          for (const [title, description] of [
            ["   ", "Valid"],
            ["A".repeat(121), "Valid"],
            ["Valid", "   "],
            ["Valid", "D".repeat(5001)],
          ]) {
            await expectRejected(
              database,
              fixture.actors.admin,
              postSql,
              [projects.planned, randomUUID(), title, description, false],
              "22023",
            );
          }
          expect(await callAs<PostRow>(
            database,
            fixture.actors.admin,
            postSql,
            [projects.planned, randomUUID(), "T", "D", false],
          )).toHaveLength(1);
          expect(await callAs<PostRow>(
            database,
            fixture.actors.admin,
            postSql,
            [projects.planned, randomUUID(), "T".repeat(120), "D".repeat(5000), false],
          )).toHaveLength(1);

          const audit = (await database.query<{
            action_type: string;
            after_data: unknown;
            before_data: unknown;
            metadata: Record<string, unknown>;
          }>(
            `select action_type, before_data, after_data, metadata
             from public.audit_logs
             where entity_id = $1::uuid`,
            [normalized.activity_id],
          )).rows;
          expect(audit).toEqual([{
            action_type: "project_activity.created",
            before_data: null,
            after_data: null,
            metadata: { project_id: projects.planned, alert_requested: false },
          }]);
        });
      });

      it("snapshots only eligible recipients and makes alert retries exactly-once", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const adminId = fixture.actors.admin.profileId;
          const sender = fixture.actors.unpermitted;
          const projectId = await createProject(database, adminId);
          const otherProjectId = await createProject(database, adminId);
          await database.query(
            `delete from public.user_permissions as permission
             using public.permission_definitions as definition
             where definition.id = permission.permission_definition_id
               and definition.key = 'projects.alerts.receive'`,
          );
          await database.query(
            `delete from public.user_permissions as permission
             using public.permission_definitions as definition
             where definition.id = permission.permission_definition_id
               and definition.key in ('dashboard.view', 'projects.view')
               and permission.user_id = any($1::uuid[])`,
            [[
              fixture.actors.brandManager.profileId,
              fixture.actors.productEditor.profileId,
              fixture.actors.supplierCreator.profileId,
            ]],
          );
          await grantPermissions(database, sender.profileId, adminId, [
            "projects.edit",
            "projects.alerts.send",
            "projects.alerts.receive",
            "dashboard.view",
            "projects.view",
          ]);
          await grantPermissions(database, fixture.actors.permitted.profileId, adminId, [
            "projects.alerts.receive",
            "dashboard.view",
            "projects.view",
          ]);
          await grantPermissions(database, fixture.actors.admin.profileId, adminId, [
            "projects.alerts.receive",
          ]);
          await grantPermissions(database, fixture.actors.brandManager.profileId, adminId, [
            "projects.alerts.receive",
          ]);
          await grantPermissions(database, fixture.actors.productEditor.profileId, adminId, [
            "projects.alerts.receive",
            "dashboard.view",
          ]);
          await grantPermissions(database, fixture.actors.supplierCreator.profileId, adminId, [
            "projects.alerts.receive",
            "projects.view",
          ]);
          await grantPermissions(database, fixture.actors.inactive.profileId, adminId, [
            "projects.alerts.receive",
            "dashboard.view",
            "projects.view",
          ]);
          await database.query(
            `update public.user_profiles
             set is_admin = true
             where id = $1::uuid`,
            [fixture.actors.productCreator.profileId],
          );

          const requestId = randomUUID();
          const first = (await callAs<PostRow>(database, sender, postSql, [
            projectId,
            requestId,
            "  Alert title  ",
            "  Alert description  ",
            true,
          ]))[0]!;
          const retry = (await callAs<PostRow>(database, sender, postSql, [
            projectId,
            requestId,
            "Alert title",
            "Alert description",
            true,
          ]))[0]!;
          expect(retry).toEqual(first);
          expect(first).toMatchObject({
            alert_sent: true,
            recipient_count: "2",
          });

          const recipients = (await database.query<{ recipient_user_id: string }>(
            `select recipient_user_id
             from public.project_activity_alert_recipients
             where alert_id = $1::uuid
             order by recipient_user_id`,
            [first.alert_id],
          )).rows.map((row) => row.recipient_user_id);
          expect(recipients).toEqual([
            fixture.actors.admin.profileId,
            fixture.actors.permitted.profileId,
          ].sort());
          expect(recipients).not.toContain(sender.profileId);
          expect(recipients).not.toContain(fixture.actors.brandManager.profileId);
          expect(recipients).not.toContain(fixture.actors.productEditor.profileId);
          expect(recipients).not.toContain(fixture.actors.supplierCreator.profileId);
          expect(recipients).not.toContain(fixture.actors.inactive.profileId);
          expect(recipients).not.toContain(fixture.actors.productCreator.profileId);

          await grantPermissions(database, fixture.actors.brandManager.profileId, adminId, [
            "dashboard.view",
            "projects.view",
          ]);
          expect((await database.query<{ count: string }>(
            `select pg_catalog.count(*)::text as count
             from public.project_activity_alert_recipients
             where alert_id = $1::uuid`,
            [first.alert_id],
          )).rows[0]?.count).toBe("2");

          const adminSend = (await callAs<PostRow>(
            database,
            fixture.actors.admin,
            postSql,
            [projectId, randomUUID(), "Admin alert", "Admin may send", true],
          ))[0]!;
          expect(adminSend.alert_sent).toBe(true);
          expect(Number(adminSend.recipient_count)).toBeGreaterThan(0);

          const counts = (await database.query<{
            activities: string;
            alerts: string;
            audits: string;
            recipients: string;
          }>(
            `select
               (select pg_catalog.count(*)::text from public.project_activity_updates where request_id = $1::uuid) as activities,
               (select pg_catalog.count(*)::text from public.project_activity_alerts where project_activity_id = $2::uuid) as alerts,
               (select pg_catalog.count(*)::text from public.project_activity_alert_recipients where alert_id = $3::uuid) as recipients,
               (select pg_catalog.count(*)::text from public.audit_logs where entity_id in ($2::uuid, $3::uuid)) as audits`,
            [requestId, first.activity_id, first.alert_id],
          )).rows[0];
          expect(counts).toEqual({ activities: "1", alerts: "1", recipients: "2", audits: "2" });

          const auditText = JSON.stringify((await database.query(
            `select action_type, entity_type, summary, before_data, after_data, metadata
             from public.audit_logs
             where entity_id in ($1::uuid, $2::uuid)
             order by action_type`,
            [first.activity_id, first.alert_id],
          )).rows);
          expect(auditText).not.toContain("Alert description");
          expect(auditText).not.toContain("recipient_user_id");
          expect(auditText).not.toContain("@example.com");

          for (const values of [
            [otherProjectId, requestId, "Alert title", "Alert description", true],
            [projectId, requestId, "Different title", "Alert description", true],
            [projectId, requestId, "Alert title", "Different description", true],
            [projectId, requestId, "Alert title", "Alert description", false],
          ]) {
            await expectRejected(database, sender, postSql, values, "PAC01");
          }

          await grantPermissions(database, fixture.actors.permitted.profileId, adminId, [
            "projects.alerts.send",
          ]);
          await expectRejected(
            database,
            fixture.actors.permitted,
            postSql,
            [projectId, randomUUID(), "No edit", "Send alone is insufficient", true],
            "42501",
          );
          await grantPermissions(database, fixture.actors.productEditor.profileId, adminId, [
            "projects.edit",
          ]);
          await expectRejected(
            database,
            fixture.actors.productEditor,
            postSql,
            [projectId, randomUUID(), "No send", "Edit alone is insufficient", true],
            "42501",
          );
        });
      });

      it("rolls zero-recipient and late-audit failures back atomically", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const adminId = fixture.actors.admin.profileId;
          const projectId = await createProject(database, adminId);
          await database.query(
            `delete from public.user_permissions as permission
             using public.permission_definitions as definition
             where definition.id = permission.permission_definition_id
               and definition.key = 'projects.alerts.receive'`,
          );
          const before = (await database.query<{ value: string }>(
            `select (
               (select pg_catalog.count(*) from public.project_activity_updates)
               + (select pg_catalog.count(*) from public.project_activity_alerts)
               + (select pg_catalog.count(*) from public.project_activity_alert_recipients)
             )::text as value`,
          )).rows[0]!.value;

          await expectRejected(
            database,
            fixture.actors.admin,
            postSql,
            [projectId, randomUUID(), "No recipients", "Must roll back", true],
            "PAC03",
          );
          const afterZero = (await database.query<{ value: string }>(
            `select (
               (select pg_catalog.count(*) from public.project_activity_updates)
               + (select pg_catalog.count(*) from public.project_activity_alerts)
               + (select pg_catalog.count(*) from public.project_activity_alert_recipients)
             )::text as value`,
          )).rows[0]!.value;
          expect(afterZero).toBe(before);

          await grantPermissions(database, fixture.actors.permitted.profileId, adminId, [
            "projects.alerts.receive",
            "dashboard.view",
            "projects.view",
          ]);
          await database.query(`create function pg_temp.fail_project_activity_alert_audit()
            returns trigger language plpgsql as $test$
            begin
              if new.action_type = 'project_activity.alert_sent' then
                raise exception 'Forced late audit failure' using errcode = '55000';
              end if;
              return new;
            end;
            $test$`);
          await database.query(`create trigger taskc_force_late_audit_failure
            before insert on public.audit_logs
            for each row execute function pg_temp.fail_project_activity_alert_audit()`);

          const failedRequestId = randomUUID();
          await expectRejected(
            database,
            fixture.actors.admin,
            postSql,
            [projectId, failedRequestId, "Late failure", "Everything must roll back", true],
            "55000",
          );
          expect((await database.query<{ count: string }>(
            `select pg_catalog.count(*)::text as count
             from public.project_activity_updates where request_id = $1::uuid`,
            [failedRequestId],
          )).rows[0]?.count).toBe("0");
          expect((await database.query<{ count: string }>(
            `select pg_catalog.count(*)::text as count
             from public.audit_logs
             where action_type in ('project_activity.created', 'project_activity.alert_sent')`,
          )).rows[0]?.count).toBe("0");
        });
      });

      it("provides bounded historical timeline and same-Project by-ID reads", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const adminId = fixture.actors.admin.profileId;
          const projectId = await createProject(database, adminId, "completed");
          const cancelledProjectId = await createProject(database, adminId, "cancelled");
          const otherProjectId = await createProject(database, adminId);
          const timestamp = "2026-10-16T10:00:00.123456Z";
          const activityIds = Array.from({ length: 22 }, () => randomUUID()).sort();

          for (let index = 0; index < activityIds.length; index += 1) {
            await database.query(
              `insert into public.project_activity_updates (
                 id, project_id, author_user_id, request_id,
                 title, description, created_at
               ) values (
                 $1::uuid, $2::uuid, $3::uuid, $4::uuid,
                 $5::text, $6::text, $7::timestamptz
               )`,
              [
                activityIds[index],
                projectId,
                index === 0 ? fixture.actors.inactive.profileId : adminId,
                randomUUID(),
                `Timeline ${index}`,
                `Description ${index}`,
                timestamp,
              ],
            );
          }
          const alertId = randomUUID();
          await database.query(
            `insert into public.project_activity_alerts (
               id, project_activity_id, sent_by_user_id, sent_at
             ) values ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz)`,
            [alertId, activityIds[21], adminId, timestamp],
          );
          const attachmentId = randomUUID();
          await database.query(
            `insert into public.project_activity_attachments (
               id, project_activity_id, storage_path, mime_type,
               byte_size, content_hash, alt_text, created_at
             ) values (
               $1::uuid, $2::uuid, $3::text, 'image/png',
               123, 'safe-hash', 'Safe alt', $4::timestamptz
             )`,
            [
              attachmentId,
              activityIds[20],
              `final/${projectId}/${activityIds[20]}/${randomUUID()}.png`,
              timestamp,
            ],
          );

          const defaultPage = await callAs<ActivityRow>(
            database,
            fixture.actors.admin,
            "select * from public.list_project_activity($1::uuid)",
            [projectId],
          );
          expect(defaultPage).toHaveLength(20);
          expect(defaultPage.every((row) => row.has_more)).toBe(true);
          expect(defaultPage.map((row) => row.activity_id)).toEqual(
            [...activityIds].sort().reverse().slice(0, 20),
          );
          expect(defaultPage.find((row) => row.activity_id === activityIds[21])?.alert_sent)
            .toBe(true);
          expect(defaultPage.find((row) => row.activity_id === activityIds[20]))
            .toMatchObject({
              attachment_id: attachmentId,
              attachment_mime_type: "image/png",
              attachment_byte_size: "123",
              attachment_alt_text: "Safe alt",
            });
          expect(defaultPage.find((row) => row.activity_id === activityIds[0])).toBeUndefined();

          expect(await callAs<ActivityRow>(
            database,
            fixture.actors.admin,
            "select * from public.list_project_activity($1::uuid, 1, null, null)",
            [projectId],
          )).toHaveLength(1);
          expect(await callAs<ActivityRow>(
            database,
            fixture.actors.admin,
            "select * from public.list_project_activity($1::uuid, 50, null, null)",
            [projectId],
          )).toHaveLength(22);

          const firstPage = await callAs<ActivityRow>(
            database,
            fixture.actors.permitted,
            "select * from public.list_project_activity($1::uuid, $2::integer, null, null)",
            [projectId, 5],
          );
          const last = firstPage[firstPage.length - 1]!;
          const exactCursor = (await database.query<{ created_at: string }>(
            `select created_at::text as created_at
             from public.project_activity_updates
             where id = $1::uuid`,
            [last.activity_id],
          )).rows[0]!.created_at;
          const secondPage = await callAs<ActivityRow>(
            database,
            fixture.actors.permitted,
            "select * from public.list_project_activity($1::uuid, $2::integer, $3::timestamptz, $4::uuid)",
            [projectId, 5, exactCursor, last.activity_id],
          );
          expect(new Set([
            ...firstPage.map((row) => row.activity_id),
            ...secondPage.map((row) => row.activity_id),
          ]).size).toBe(10);
          expect(secondPage[0]?.activity_id).toBe(
            [...activityIds].sort().reverse()[5],
          );

          const allPages: ActivityRow[] = [];
          let cursorCreatedAt: string | null = null;
          let cursorId: string | null = null;
          for (;;) {
            const page: ActivityRow[] = await callAs<ActivityRow>(
              database,
              fixture.actors.admin,
              `select * from public.list_project_activity(
                 $1::uuid, 5, $2::timestamptz, $3::uuid
               )`,
              [projectId, cursorCreatedAt, cursorId],
            );
            allPages.push(...page);
            if (page.length === 0 || !page[0]?.has_more) break;
            cursorCreatedAt = timestamp;
            cursorId = page[page.length - 1]!.activity_id;
          }
          expect(allPages.map((row) => row.activity_id)).toEqual(
            [...activityIds].sort().reverse(),
          );
          expect(new Set(allPages.map((row) => row.activity_id)).size).toBe(22);
          expect(allPages.slice(-2).every((row) => row.has_more === false)).toBe(true);

          const terminalPage = await callAs<ActivityRow>(
            database,
            fixture.actors.admin,
            `select * from public.list_project_activity(
               $1::uuid, 5, $2::timestamptz, $3::uuid
             )`,
            [projectId, timestamp, allPages[allPages.length - 1]!.activity_id],
          );
          expect(terminalPage).toEqual([]);

          const exactPageProjectId = await createProject(database, adminId, "completed");
          for (let index = 0; index < 5; index += 1) {
            await database.query(
              `insert into public.project_activity_updates (
                 project_id, author_user_id, request_id, title, description, created_at
               ) values (
                 $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::timestamptz
               )`,
              [
                exactPageProjectId,
                adminId,
                randomUUID(),
                `Exact page ${index}`,
                `Exact page description ${index}`,
                timestamp,
              ],
            );
          }
          const exactPage = await callAs<ActivityRow>(
            database,
            fixture.actors.admin,
            "select * from public.list_project_activity($1::uuid, 5, null, null)",
            [exactPageProjectId],
          );
          expect(exactPage).toHaveLength(5);
          expect(exactPage.every((row) => row.has_more === false)).toBe(true);

          const inactiveAuthor = (await callAs<ActivityRow>(
            database,
            fixture.actors.admin,
            "select * from public.get_project_activity($1::uuid, $2::uuid)",
            [projectId, activityIds[0]],
          ))[0]!;
          expect(inactiveAuthor.author_user_id).toBe(fixture.actors.inactive.profileId);
          expect(inactiveAuthor.author_full_name).toContain("inactive");
          expect(Object.keys(inactiveAuthor).sort()).toEqual([
            "activity_id",
            "alert_sent",
            "attachment_alt_text",
            "attachment_byte_size",
            "attachment_id",
            "attachment_mime_type",
            "author_full_name",
            "author_user_id",
            "created_at",
            "description",
            "project_id",
            "title",
          ]);
          expect(inactiveAuthor).not.toHaveProperty("storage_path");
          expect(inactiveAuthor).not.toHaveProperty("email");
          expect(inactiveAuthor).not.toHaveProperty("is_admin");

          await database.query(
            `insert into public.project_activity_updates (
               project_id, author_user_id, request_id, title, description
             ) values ($1::uuid, $2::uuid, $3::uuid, 'Cancelled history', 'Readable')`,
            [cancelledProjectId, adminId, randomUUID()],
          );
          expect(await callAs<ActivityRow>(
            database,
            fixture.actors.permitted,
            "select * from public.list_project_activity($1::uuid)",
            [cancelledProjectId],
          )).toHaveLength(1);

          await expectRejected(
            database,
            fixture.actors.admin,
            "select * from public.get_project_activity($1::uuid, $2::uuid)",
            [otherProjectId, activityIds[0]],
            "P0002",
          );
          for (const actor of [fixture.actors.productCreator, fixture.actors.inactive]) {
            await expectRejected(
              database,
              actor,
              "select * from public.list_project_activity($1::uuid)",
              [projectId],
              "42501",
            );
          }
          await expectRejected(
            database,
            null,
            "select * from public.list_project_activity($1::uuid)",
            [projectId],
            "42501",
          );
          for (const limit of [0, 51, null]) {
            await expectRejected(
              database,
              fixture.actors.admin,
              "select * from public.list_project_activity($1::uuid, $2::integer, null, null)",
              [projectId, limit],
              "22023",
            );
          }
          await expectRejected(
            database,
            fixture.actors.admin,
            "select * from public.list_project_activity($1::uuid, 20, $2::timestamptz, null)",
            [projectId, timestamp],
            "22023",
          );
        });
      });
    },
  );
}
