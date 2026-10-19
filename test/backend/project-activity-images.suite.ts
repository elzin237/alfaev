import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261016150000_add_trusted_project_activity_image_boundaries.sql",
);

const prepareSql = `select * from public.prepare_project_activity_image_upload(
  $1::uuid, $2::uuid, $3::uuid, $4::uuid,
  $5::text, $6::bigint, $7::text, $8::text
)`;
const attachSql = `select * from public.attach_project_activity_image(
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
  $6::text, $7::bigint, $8::text, $9::text
)`;
const accessSql = `select * from public.get_project_activity_image_access_context(
  $1::uuid, $2::uuid, $3::uuid
)`;

interface AttachmentRow extends QueryResultRow {
  attachment_created?: boolean;
  attachment_exists?: boolean;
  attachment_id: string | null;
  storage_path: string | null;
  mime_type: string | null;
  byte_size: string | null;
  alt_text: string | null;
}

async function callAsService<Row extends QueryResultRow>(
  database: PoolClient,
  sql: string,
  parameters: unknown[],
): Promise<Row[]> {
  await database.query("set local role service_role");
  try {
    return (await database.query<Row>(sql, parameters)).rows;
  } finally {
    await database.query("reset role");
  }
}

async function expectServiceRejected(
  database: PoolClient,
  sql: string,
  parameters: unknown[],
  code: string,
): Promise<void> {
  await database.query("savepoint rejected_project_activity_image");
  try {
    await database.query("set local role service_role");
    await expect(database.query(sql, parameters)).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback to savepoint rejected_project_activity_image");
    await database.query("release savepoint rejected_project_activity_image");
  }
}

async function grantPermission(
  database: PoolClient,
  actor: SecurityActor,
  grantedById: string,
  key: "projects.edit" | "projects.view",
): Promise<void> {
  await database.query(
    `insert into public.user_permissions (
       user_id, permission_definition_id, granted_by_user_id
     )
     select $1::uuid, definition.id, $2::uuid
     from public.permission_definitions as definition
     where definition.key = $3::text
     on conflict (user_id, permission_definition_id) do nothing`,
    [actor.profileId, grantedById, key],
  );
}

async function createProjectActivity(
  database: PoolClient,
  author: SecurityActor,
  createdById: string,
  status: "planned" | "in_progress" | "on_hold" | "completed" | "cancelled" = "planned",
) {
  const projectId = randomUUID();
  const activityId = randomUUID();
  const requestId = randomUUID();
  await database.query(
    `insert into public.projects (
       id, name, customer_name, status, start_date, delivery_date,
       completed_at, cancelled_at, created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, 'Task D Customer', $3::text,
       '2026-10-16'::date, '2026-11-16'::date,
       case when $3::text = 'completed' then pg_catalog.now() end,
       case when $3::text = 'cancelled' then pg_catalog.now() end,
       $4::uuid, $4::uuid
     )`,
    [projectId, `Task D ${projectId}`, status, createdById],
  );
  await database.query(
    `insert into public.project_activity_updates (
       id, project_id, author_user_id, request_id, title, description
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       'Task D image', 'Task D attachment boundary'
     )`,
    [activityId, projectId, author.profileId, requestId],
  );
  return { activityId, projectId, requestId };
}

function metadata(
  fixture: { activityId: string; projectId: string; requestId: string },
  actor: SecurityActor,
) {
  const objectId = randomUUID();
  return {
    hash: "a".repeat(64),
    path: `final/${fixture.projectId}/${fixture.activityId}/${objectId}.png`,
    prepare: [
      fixture.projectId,
      fixture.activityId,
      fixture.requestId,
      actor.authUserId,
      "image/png",
      128,
      "a".repeat(64),
      "Site progress",
    ],
  };
}

export function registerProjectActivityImageTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task D Project Activity image boundaries (static)", () => {
    it("defines only service-role trusted helpers and preserves private Storage", () => {
      const sql = readFileSync(migrationPath, "utf8");
      for (const functionName of [
        "prepare_project_activity_image_upload",
        "attach_project_activity_image",
        "reconcile_project_activity_image_upload",
        "get_project_activity_image_access_context",
      ]) {
        expect(sql).toContain(`create function public.${functionName}(`);
      }
      expect(sql.match(/security definer/g)).toHaveLength(4);
      expect(sql.match(/set search_path = ''/g)).toHaveLength(4);
      expect(sql.match(/to service_role;/g)).toHaveLength(4);
      expect(sql).not.toMatch(/to authenticated;/);
      expect(sql).not.toContain("append_audit_log");
      expect(sql).toContain("object.bucket_id = 'project-activity-images'");
      expect(sql).toContain("actor_profile.id is distinct from current_activity.author_user_id");
      expect(sql).toContain("current_activity.request_id is distinct from p_request_id");
    });
  });

  describe.skipIf(process.env.TASKD_PROJECT_ACTIVITY_IMAGES !== "1")(
    "Task D Project Activity image boundaries (requires migration 125)",
    () => {
      it("has exact SECURITY DEFINER metadata and service-role-only ACLs", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const functions = (await database.query<{
            arguments: string;
            configuration: string[] | null;
            function_name: string;
            security_definer: boolean;
            volatility: string;
          }>(
            `select
               procedure.proname as function_name,
               pg_catalog.pg_get_function_identity_arguments(procedure.oid) as arguments,
               procedure.prosecdef as security_definer,
               procedure.provolatile as volatility,
               procedure.proconfig as configuration
             from pg_catalog.pg_proc as procedure
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'public'
               and procedure.proname = any($1::text[])
             order by procedure.proname`,
            [[
              "attach_project_activity_image",
              "get_project_activity_image_access_context",
              "prepare_project_activity_image_upload",
              "reconcile_project_activity_image_upload",
            ]],
          )).rows;
          expect(functions).toHaveLength(4);
          expect(functions.every((row) => row.security_definer)).toBe(true);
          expect(functions.every((row) =>
            row.configuration?.includes('search_path=""')
          )).toBe(true);
          expect(functions.find((row) =>
            row.function_name === "get_project_activity_image_access_context"
          )?.volatility).toBe("s");

          for (const row of functions) {
            const signature = `public.${row.function_name}(${row.arguments
              .split(", ").map((argument) => argument.replace(/^\w+ /, "")).join(",")})`;
            for (const [role, allowed] of [
              ["public", false],
              ["anon", false],
              ["authenticated", false],
              ["service_role", true],
            ] as const) {
              expect((await database.query<{ allowed: boolean }>(
                "select pg_catalog.has_function_privilege($1::text, $2::text, 'EXECUTE') as allowed",
                [role, signature],
              )).rows[0]?.allowed).toBe(allowed);
            }
          }
        });
      });

      it("authorizes Admin/edit authors, enforces one attachment, and reconciles exact retries", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const adminActivity = await createProjectActivity(
            database,
            fixture.actors.admin,
            fixture.actors.admin.profileId,
          );
          const adminMetadata = metadata(adminActivity, fixture.actors.admin);
          expect((await callAsService<AttachmentRow>(
            database,
            prepareSql,
            adminMetadata.prepare,
          ))[0]).toMatchObject({ attachment_exists: false, attachment_id: null });
          await database.query(
            `insert into storage.objects (bucket_id, name, metadata)
             values ('project-activity-images', $1::text,
               pg_catalog.jsonb_build_object('mimetype', 'image/png'))`,
            [adminMetadata.path],
          );
          const attachParameters = [
            ...adminMetadata.prepare.slice(0, 4),
            adminMetadata.path,
            ...adminMetadata.prepare.slice(4),
          ];
          const attached = (await callAsService<AttachmentRow>(
            database,
            attachSql,
            attachParameters,
          ))[0];
          expect(attached).toMatchObject({
            attachment_created: true,
            storage_path: adminMetadata.path,
            mime_type: "image/png",
            byte_size: "128",
            alt_text: "Site progress",
          });
          expect((await callAsService<AttachmentRow>(
            database,
            prepareSql,
            adminMetadata.prepare,
          ))[0]).toMatchObject({
            attachment_exists: true,
            attachment_id: attached?.attachment_id,
          });
          expect((await callAsService<AttachmentRow>(
            database,
            attachSql,
            attachParameters,
          ))[0]).toMatchObject({
            attachment_created: false,
            attachment_id: attached?.attachment_id,
          });
          expect((await database.query<{ count: string }>(
            `select pg_catalog.count(*)::text as count
             from public.project_activity_attachments
             where project_activity_id = $1::uuid`,
            [adminActivity.activityId],
          )).rows[0]?.count).toBe("1");

          const changedHash = [...adminMetadata.prepare];
          changedHash[6] = "b".repeat(64);
          await expectServiceRejected(database, prepareSql, changedHash, "PAC04");
          const changedRequest = [...adminMetadata.prepare];
          changedRequest[2] = randomUUID();
          await expectServiceRejected(database, prepareSql, changedRequest, "PAC04");

          await grantPermission(
            database,
            fixture.actors.permitted,
            fixture.actors.admin.profileId,
            "projects.edit",
          );
          const editorActivity = await createProjectActivity(
            database,
            fixture.actors.permitted,
            fixture.actors.admin.profileId,
          );
          expect((await callAsService<AttachmentRow>(
            database,
            prepareSql,
            metadata(editorActivity, fixture.actors.permitted).prepare,
          ))[0]?.attachment_exists).toBe(false);

          await expectServiceRejected(
            database,
            prepareSql,
            metadata(editorActivity, fixture.actors.admin).prepare,
            "42501",
          );
          const inactiveActivity = await createProjectActivity(
            database,
            fixture.actors.inactive,
            fixture.actors.admin.profileId,
          );
          await expectServiceRejected(
            database,
            prepareSql,
            metadata(inactiveActivity, fixture.actors.inactive).prepare,
            "42501",
          );
        });
      });

      it("rejects new images on closed Projects but preserves authorized historical reads", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          await grantPermission(
            database,
            fixture.actors.permitted,
            fixture.actors.admin.profileId,
            "projects.view",
          );
          for (const status of ["completed", "cancelled"] as const) {
            const activity = await createProjectActivity(
              database,
              fixture.actors.admin,
              fixture.actors.admin.profileId,
              status,
            );
            const values = metadata(activity, fixture.actors.admin);
            await expectServiceRejected(database, prepareSql, values.prepare, "PAC02");

            const attachmentId = randomUUID();
            await database.query(
              `insert into public.project_activity_attachments (
                 id, project_activity_id, storage_path, mime_type,
                 byte_size, content_hash, alt_text
               ) values (
                 $1::uuid, $2::uuid, $3::text, 'image/png',
                 128, $4::text, 'Historical image'
               )`,
              [attachmentId, activity.activityId, values.path, values.hash],
            );
            for (const actor of [fixture.actors.admin, fixture.actors.permitted]) {
              expect((await callAsService<AttachmentRow>(database, accessSql, [
                activity.projectId,
                activity.activityId,
                actor.authUserId,
              ]))[0]).toMatchObject({
                attachment_id: attachmentId,
                storage_path: values.path,
              });
            }
            await expectServiceRejected(database, accessSql, [
              activity.projectId,
              activity.activityId,
              fixture.actors.unpermitted.authUserId,
            ], "42501");
            await expectServiceRejected(database, accessSql, [
              activity.projectId,
              activity.activityId,
              fixture.actors.inactive.authUserId,
            ], "42501");
            await expectServiceRejected(database, accessSql, [
              randomUUID(),
              activity.activityId,
              fixture.actors.admin.authUserId,
            ], "P0002");
          }
        });
      });

      it("creates no attachment audit and exposes no path/hash through Task C reads", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const activity = await createProjectActivity(
            database,
            fixture.actors.admin,
            fixture.actors.admin.profileId,
          );
          const values = metadata(activity, fixture.actors.admin);
          await database.query(
            `insert into storage.objects (bucket_id, name, metadata)
             values ('project-activity-images', $1::text,
               pg_catalog.jsonb_build_object('mimetype', 'image/png'))`,
            [values.path],
          );
          const beforeAudits = (await database.query<{ count: string }>(
            "select pg_catalog.count(*)::text as count from public.audit_logs",
          )).rows[0]!.count;
          await callAsService(database, attachSql, [
            ...values.prepare.slice(0, 4),
            values.path,
            ...values.prepare.slice(4),
          ]);
          expect((await database.query<{ count: string }>(
            "select pg_catalog.count(*)::text as count from public.audit_logs",
          )).rows[0]!.count).toBe(beforeAudits);

          await database.query(
            "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
            [fixture.actors.admin.authUserId],
          );
          await database.query("set local role authenticated");
          const result = await database.query(
            "select * from public.get_project_activity($1::uuid, $2::uuid)",
            [activity.projectId, activity.activityId],
          );
          await database.query("reset role");
          expect(result.rows).toHaveLength(1);
          expect(Object.keys(result.rows[0] ?? {})).not.toContain("storage_path");
          expect(Object.keys(result.rows[0] ?? {})).not.toContain("content_hash");
        });
      });
    },
  );
}
