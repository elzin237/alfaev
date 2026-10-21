import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261020130000_add_project_issue_resolution_foundation.sql",
);

interface ResolutionRow extends QueryResultRow {
  resolution_id: string;
  project_activity_id: string;
  project_id: string;
  request_id: string;
  resolved_by_user_id: string;
  resolver_full_name: string;
  description: string;
  resolved_at: Date;
  notification_id: string;
  recipient_count: string;
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
) {
  await database.query("savepoint rejected_issue_call");
  await setActor(database, actor);
  try {
    await expect(database.query(sql, values)).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback to savepoint rejected_issue_call");
    await database.query("release savepoint rejected_issue_call");
    await database.query("reset role");
  }
}

async function grantPermissions(
  database: PoolClient,
  userId: string,
  grantedByUserId: string,
  keys: readonly string[],
) {
  await database.query(
    `insert into public.user_permissions (
       user_id, permission_definition_id, granted_by_user_id
     )
     select $1::uuid, definition.id, $2::uuid
     from public.permission_definitions as definition
     where definition.key = any($3::text[])
     on conflict (user_id, permission_definition_id) do nothing`,
    [userId, grantedByUserId, [...keys]],
  );
}

async function createProject(
  database: PoolClient,
  actorId: string,
  status: "planned" | "completed" | "cancelled" = "planned",
) {
  const id = randomUUID();
  await database.query(
    `insert into public.projects (
       id, name, customer_name, status, start_date, delivery_date,
       completed_at, cancelled_at, created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, 'Issue Customer', $3::text,
       '2026-10-20'::date, '2026-11-20'::date,
       case when $3::text = 'completed' then pg_catalog.now() else null end,
       case when $3::text = 'cancelled' then pg_catalog.now() else null end,
       $4::uuid, $4::uuid
     )`,
    [id, `Issue Project ${id}`, status, actorId],
  );
  return id;
}

async function postActivity(
  database: PoolClient,
  actor: SecurityActor,
  projectId: string,
  kind: "general" | "issue",
) {
  return (await callAs<{ activity_id: string }>(
    database,
    actor,
    `select activity_id
     from public.post_project_activity(
       $1::uuid, $2::uuid, $3::text, $4::text, false, $5::text
     )`,
    [projectId, randomUUID(), `${kind} title`, `${kind} description`, kind],
  ))[0]!.activity_id;
}

const resolveSql = `select * from public.resolve_project_issue(
  $1::uuid, $2::uuid, $3::text
)`;

export function registerProjectIssueResolutionTests(
  requireHarness: () => SecurityFixtureHarness,
) {
  describe("Task 002A Project Issue resolution (static)", () => {
    it("keeps the migration modular and free of frontend or Storage implementation", () => {
      const sql = readFileSync(migrationPath, "utf8");
      expect(sql).toContain("create table public.project_issue_resolutions");
      expect(sql).toContain("create function public.resolve_project_issue(");
      expect(sql).not.toMatch(/storage\.objects|storage\.buckets|signed_url/i);
      expect(sql).not.toMatch(/create table public\..*shortage/i);
    });
  });

  describe.skipIf(process.env.PROJECT_ISSUE_RESOLUTION !== "1")(
    "Task 002A Project Issue resolution (requires migration 133)",
    () => {
      it("has exact schema, RLS, function metadata, ACL, and historical General defaults", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const columns = (await database.query(
            `select column_name, data_type, is_nullable, column_default
             from information_schema.columns
             where table_schema = 'public'
               and table_name = 'project_issue_resolutions'
             order by ordinal_position`,
          )).rows;
          expect(columns.map((column) => column.column_name)).toEqual([
            "id", "project_activity_id", "request_id", "resolved_by_user_id",
            "description", "resolved_at",
          ]);
          expect(columns.every((column) => column.is_nullable === "NO")).toBe(true);

          const boundary = (await database.query(
            `select relation.relrowsecurity as rls_enabled,
               pg_catalog.has_table_privilege('public', relation.oid, 'SELECT,INSERT,UPDATE,DELETE') as public_access,
               pg_catalog.has_table_privilege('anon', relation.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon_access,
               pg_catalog.has_table_privilege('authenticated', relation.oid, 'SELECT,INSERT,UPDATE,DELETE') as authenticated_access
             from pg_catalog.pg_class as relation
             where relation.oid = 'public.project_issue_resolutions'::pg_catalog.regclass`,
          )).rows[0];
          expect(boundary).toEqual({
            rls_enabled: true,
            public_access: false,
            anon_access: false,
            authenticated_access: false,
          });

          const functions = (await database.query(
            `select routine.proname as name,
               pg_catalog.pg_get_function_identity_arguments(routine.oid) as arguments,
               routine.prosecdef as security_definer,
               routine.provolatile as volatility,
               routine.proconfig as settings,
               pg_catalog.has_function_privilege('public', routine.oid, 'execute') as public_execute,
               pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anon_execute,
               pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
             where namespace.nspname = 'public'
               and (
                 routine.proname in (
                   'resolve_project_issue',
                   'list_project_activity_with_issue_resolution',
                   'get_project_activity_with_issue_resolution',
                   'list_project_notifications'
                 )
                 or (
                   routine.proname = 'post_project_activity'
                   and pg_catalog.pg_get_function_identity_arguments(routine.oid) like '%p_activity_kind text'
                 )
               )
             order by name, arguments`,
          )).rows;
          expect(functions).toHaveLength(5);
          for (const routine of functions) {
            expect(routine).toMatchObject({
              security_definer: true,
              settings: ['search_path=""'],
              public_execute: false,
              anon_execute: false,
              authenticated_execute: true,
            });
          }

          const projectId = await createProject(
            database,
            fixture.actors.admin.profileId,
          );
          const historicalId = randomUUID();
          await database.query(
            `insert into public.project_activity_updates (
               id, project_id, author_user_id, request_id, title, description
             ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Historical', 'Historical')`,
            [historicalId, projectId, fixture.actors.admin.profileId, randomUUID()],
          );
          expect((await database.query(
            "select activity_kind from public.project_activity_updates where id = $1::uuid",
            [historicalId],
          )).rows[0]?.activity_kind).toBe("general");
        });
      });

      it("posts General and Issue kinds while preserving the five-argument contract and closed-Project rule", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const projectId = await createProject(database, fixture.actors.admin.profileId);
          const general = (await callAs<{ activity_id: string }>(
            database,
            fixture.actors.admin,
            `select activity_id from public.post_project_activity(
               $1::uuid, $2::uuid, 'Legacy General', 'Five arguments', false
             )`,
            [projectId, randomUUID()],
          ))[0]!;
          const issueId = await postActivity(
            database,
            fixture.actors.admin,
            projectId,
            "issue",
          );
          const kinds = (await database.query(
            `select id, activity_kind from public.project_activity_updates
             where id = any($1::uuid[]) order by id`,
            [[general.activity_id, issueId]],
          )).rows;
          expect(kinds.map((row) => row.activity_kind).sort()).toEqual(["general", "issue"]);

          await expectRejected(
            database,
            fixture.actors.admin,
            `select * from public.post_project_activity(
               $1::uuid, $2::uuid, 'Invalid', 'Invalid', false, 'unknown'
             )`,
            [projectId, randomUUID()],
            "22023",
          );

          const completedId = await createProject(
            database,
            fixture.actors.admin.profileId,
            "completed",
          );
          await expectRejected(
            database,
            fixture.actors.admin,
            `select * from public.post_project_activity(
               $1::uuid, $2::uuid, 'Closed', 'Closed', false, 'issue'
             )`,
            [completedId, randomUUID()],
            "PAC02",
          );
        });
      });

      it("authorizes resolution, validates description and kind, and supports completed/cancelled history", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const adminId = fixture.actors.admin.profileId;
          await grantPermissions(
            database,
            fixture.actors.unpermitted.profileId,
            adminId,
            ["projects.edit", "dashboard.view", "projects.view"],
          );
          const projectId = await createProject(database, adminId);
          const issueId = await postActivity(database, fixture.actors.admin, projectId, "issue");
          const generalId = await postActivity(database, fixture.actors.admin, projectId, "general");

          await expectRejected(
            database,
            fixture.actors.unpermitted,
            resolveSql,
            [issueId, randomUUID(), "   "],
            "22023",
          );
          await expectRejected(
            database,
            fixture.actors.unpermitted,
            resolveSql,
            [generalId, randomUUID(), "Not an Issue"],
            "PIR02",
          );
          await expectRejected(
            database,
            fixture.actors.brandManager,
            resolveSql,
            [issueId, randomUUID(), "Unauthorized"],
            "42501",
          );

          const resolution = (await callAs<ResolutionRow>(
            database,
            fixture.actors.unpermitted,
            resolveSql,
            [issueId, randomUUID(), "  Corrective action completed  "],
          ))[0]!;
          expect(resolution).toMatchObject({
            project_activity_id: issueId,
            project_id: projectId,
            resolved_by_user_id: fixture.actors.unpermitted.profileId,
            description: "Corrective action completed",
          });

          for (const status of ["completed", "cancelled"] as const) {
            const closedProjectId = await createProject(database, adminId, status);
            const closedIssueId = randomUUID();
            await database.query(
              `insert into public.project_activity_updates (
                 id, project_id, author_user_id, request_id, title, description, activity_kind
               ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, 'Existing Issue', 'issue')`,
              [closedIssueId, closedProjectId, adminId, randomUUID(), `${status} Issue`],
            );
            const closedResolution = (await callAs<ResolutionRow>(
              database,
              fixture.actors.admin,
              resolveSql,
              [closedIssueId, randomUUID(), `${status} resolution`],
            ))[0]!;
            expect(closedResolution.project_id).toBe(closedProjectId);
            expect((await database.query(
              "select status from public.projects where id = $1::uuid",
              [closedProjectId],
            )).rows[0]?.status).toBe(status);
          }
        });
      });

      it("binds request UUIDs to the resolver, deduplicates exact retries, and creates one immutable audit/notification", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const adminId = fixture.actors.admin.profileId;
          await grantPermissions(
            database,
            fixture.actors.unpermitted.profileId,
            adminId,
            ["projects.edit", "dashboard.view", "projects.view"],
          );
          await grantPermissions(
            database,
            fixture.actors.brandManager.profileId,
            adminId,
            ["projects.edit"],
          );
          const projectId = await createProject(database, adminId);
          const issueId = await postActivity(database, fixture.actors.admin, projectId, "issue");
          const requestId = randomUUID();
          const first = (await callAs<ResolutionRow>(
            database,
            fixture.actors.unpermitted,
            resolveSql,
            [issueId, requestId, "Stable resolution"],
          ))[0]!;
          const retry = (await callAs<ResolutionRow>(
            database,
            fixture.actors.unpermitted,
            resolveSql,
            [issueId, requestId, "Stable resolution"],
          ))[0]!;
          expect(retry).toEqual(first);

          await expectRejected(
            database,
            fixture.actors.unpermitted,
            resolveSql,
            [issueId, requestId, "Changed resolution"],
            "PIR01",
          );
          await expectRejected(
            database,
            fixture.actors.brandManager,
            resolveSql,
            [issueId, requestId, "Stable resolution"],
            "42501",
          );
          await expectRejected(
            database,
            fixture.actors.admin,
            resolveSql,
            [issueId, randomUUID(), "Second resolution"],
            "PIR03",
          );

          expect((await database.query(
            `select pg_catalog.count(*)::int as count
             from public.project_issue_resolutions where project_activity_id = $1::uuid`,
            [issueId],
          )).rows[0]?.count).toBe(1);
          expect((await database.query(
            `select pg_catalog.count(*)::int as count
             from public.project_activity_alerts
             where project_issue_resolution_id = $1::uuid
               and notification_kind = 'issue_resolved'`,
            [first.resolution_id],
          )).rows[0]?.count).toBe(1);
          expect((await database.query(
            `select pg_catalog.count(*)::int as count
             from public.audit_logs
             where action_type = 'project_activity.issue_resolved'
               and entity_id = $1::uuid`,
            [first.resolution_id],
          )).rows[0]?.count).toBe(1);

          const otherIssueId = randomUUID();
          const sourceIssueId = randomUUID();
          await database.query(
            `insert into public.project_activity_updates (
               id, project_id, author_user_id, request_id, title, description, activity_kind
             ) values
             (
               $1::uuid, $2::uuid, $3::uuid, $4::uuid,
               'Other Issue', 'Other Issue', 'issue'
             ),
             (
               $5::uuid, $2::uuid, $3::uuid, $6::uuid,
               'Source Issue', 'Source Issue', 'issue'
             )`,
            [otherIssueId, projectId, adminId, randomUUID(), sourceIssueId, randomUUID()],
          );
          const sourceResolutionId = (await database.query<{ id: string }>(
            `insert into public.project_issue_resolutions (
               project_activity_id, request_id, resolved_by_user_id, description
             ) values ($1::uuid, $2::uuid, $3::uuid, 'Source resolution')
             returning id`,
            [sourceIssueId, randomUUID(), adminId],
          )).rows[0]!.id;
          await database.query("savepoint mismatched_resolution_target");
          try {
            await expect(database.query(
              `insert into public.project_activity_alerts (
                 project_activity_id, sent_by_user_id, notification_kind,
                 project_issue_resolution_id
               ) values ($1::uuid, $2::uuid, 'issue_resolved', $3::uuid)`,
              [otherIssueId, adminId, sourceResolutionId],
            )).rejects.toMatchObject({ code: "23503" });
          } finally {
            await database.query("rollback to savepoint mismatched_resolution_target");
            await database.query("release savepoint mismatched_resolution_target");
          }

          await expect(database.query(
            `update public.project_issue_resolutions
             set description = 'Changed' where id = $1::uuid`,
            [first.resolution_id],
          )).rejects.toMatchObject({ code: "55000" });
        });
      });

      it("fans out to active Admins and active Dashboard+Project viewers without receive permission", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const adminId = fixture.actors.admin.profileId;
          await grantPermissions(
            database,
            fixture.actors.unpermitted.profileId,
            adminId,
            ["projects.edit", "dashboard.view", "projects.view"],
          );
          await grantPermissions(
            database,
            fixture.actors.productCreator.profileId,
            adminId,
            ["projects.alerts.receive"],
          );
          const projectId = await createProject(database, adminId);
          const issueId = await postActivity(database, fixture.actors.admin, projectId, "issue");
          const resolution = (await callAs<ResolutionRow>(
            database,
            fixture.actors.unpermitted,
            resolveSql,
            [issueId, randomUUID(), "Fanout resolution"],
          ))[0]!;

          const expected = (await database.query<{ id: string }>(
            `select profile.id
             from public.user_profiles as profile
             where profile.is_active
               and (
                 profile.is_admin
                 or (
                   not profile.is_admin
                   and exists (
                     select 1 from public.user_permissions permission
                     join public.permission_definitions definition
                       on definition.id = permission.permission_definition_id
                     where permission.user_id = profile.id
                       and definition.key = 'dashboard.view'
                       and definition.is_delegable
                   )
                   and exists (
                     select 1 from public.user_permissions permission
                     join public.permission_definitions definition
                       on definition.id = permission.permission_definition_id
                     where permission.user_id = profile.id
                       and definition.key = 'projects.view'
                       and definition.is_delegable
                   )
                 )
               )
             order by profile.id`,
          )).rows.map((row) => row.id);
          const actual = (await database.query<{ recipient_user_id: string }>(
            `select recipient_user_id
             from public.project_activity_alert_recipients
             where alert_id = $1::uuid order by recipient_user_id`,
            [resolution.notification_id],
          )).rows.map((row) => row.recipient_user_id);
          expect(actual).toEqual(expected);
          expect(actual).toContain(adminId);
          expect(actual).toContain(fixture.actors.unpermitted.profileId);
          expect(actual).not.toContain(fixture.actors.productCreator.profileId);
          expect(actual).not.toContain(fixture.actors.inactive.profileId);
          expect(resolution.recipient_count).toBe(String(expected.length));
        });
      });

      it("exposes narrow Issue context while preserving legacy alert semantics and recipient state operations", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const adminId = fixture.actors.admin.profileId;
          const projectId = await createProject(database, adminId);
          const issueId = await postActivity(database, fixture.actors.admin, projectId, "issue");
          const resolution = (await callAs<ResolutionRow>(
            database,
            fixture.actors.admin,
            resolveSql,
            [issueId, randomUUID(), "Visible resolution"],
          ))[0]!;

          const legacy = (await callAs<Record<string, unknown> & QueryResultRow>(
            database,
            fixture.actors.admin,
            "select * from public.get_project_activity($1::uuid, $2::uuid)",
            [projectId, issueId],
          ))[0]!;
          expect(Object.keys(legacy).sort()).toEqual([
            "activity_id", "alert_sent", "attachment_alt_text",
            "attachment_byte_size", "attachment_id", "attachment_mime_type",
            "author_full_name", "author_user_id", "created_at", "description",
            "project_id", "title",
          ].sort());
          expect(legacy.alert_sent).toBe(false);

          const detailed = (await callAs<Record<string, unknown> & QueryResultRow>(
            database,
            fixture.actors.admin,
            `select * from public.get_project_activity_with_issue_resolution(
               $1::uuid, $2::uuid
             )`,
            [projectId, issueId],
          ))[0]!;
          expect(detailed).toMatchObject({
            activity_kind: "issue",
            issue_resolved: true,
            resolution_id: resolution.resolution_id,
            resolved_by_user_id: adminId,
            resolution_description: "Visible resolution",
          });
          expect(detailed).not.toHaveProperty("email");
          expect(detailed).not.toHaveProperty("storage_path");

          const notifications = await callAs<Record<string, unknown> & QueryResultRow>(
            database,
            fixture.actors.admin,
            `select * from public.list_project_notifications(20, null, null)`,
            [],
          );
          expect(notifications.some((notification) =>
            notification.event_id === resolution.notification_id
            && notification.notification_kind === "issue_resolved"
            && notification.project_id === projectId
            && notification.activity_id === issueId
            && notification.resolution_id === resolution.resolution_id
          )).toBe(true);
          expect(notifications.every((notification) =>
            !("email" in notification) && !("storage_path" in notification)
          )).toBe(true);

          const recipient = (await database.query<{ id: string }>(
            `select id from public.project_activity_alert_recipients
             where alert_id = $1::uuid and recipient_user_id = $2::uuid`,
            [resolution.notification_id, adminId],
          )).rows[0]!;
          const marked = await callAs<{ read_at: Date }>(
            database,
            fixture.actors.admin,
            "select * from public.mark_project_alert_read($1::uuid)",
            [recipient.id],
          );
          expect(marked[0]?.read_at).toBeInstanceOf(Date);
          const dismissed = await callAs<{ dismissed_at: Date }>(
            database,
            fixture.actors.admin,
            "select * from public.dismiss_project_alert_notification($1::uuid)",
            [recipient.id],
          );
          expect(dismissed[0]?.dismissed_at).toBeInstanceOf(Date);
        });
      });
    },
  );
}
