import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const prepareSql = `select * from public.prepare_project_issue_resolution_image_upload(
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
  $6::text, $7::bigint, $8::text, $9::text
)`;
const accessSql = `select * from public.get_project_issue_resolution_image_access_context(
  $1::uuid, $2::uuid, $3::uuid, $4::uuid
)`;

async function service<Row extends QueryResultRow>(
  database: PoolClient,
  sql: string,
  parameters: unknown[],
): Promise<Row[]> {
  await database.query("set local role service_role");
  try { return (await database.query<Row>(sql, parameters)).rows; }
  finally { await database.query("reset role"); }
}

async function rejected(
  database: PoolClient,
  sql: string,
  parameters: unknown[],
  code: string,
) {
  await database.query("savepoint resolution_image_rejected");
  try {
    await database.query("set local role service_role");
    await expect(database.query(sql, parameters)).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback to savepoint resolution_image_rejected");
    await database.query("release savepoint resolution_image_rejected");
  }
}

async function permission(
  database: PoolClient,
  actor: SecurityActor,
  grantedBy: string,
  key: "projects.edit" | "projects.view",
) {
  await database.query(
    `insert into public.user_permissions (
       user_id, permission_definition_id, granted_by_user_id
     ) select $1::uuid, definition.id, $2::uuid
       from public.permission_definitions as definition
       where definition.key = $3::text
       on conflict (user_id, permission_definition_id) do nothing`,
    [actor.profileId, grantedBy, key],
  );
}

async function issue(
  database: PoolClient,
  resolver: SecurityActor,
  createdBy: string,
  status: "planned" | "completed" | "cancelled" = "planned",
) {
  const projectId = randomUUID();
  const activityId = randomUUID();
  const activityRequestId = randomUUID();
  const resolutionId = randomUUID();
  const resolutionRequestId = randomUUID();
  await database.query(
    `insert into public.projects (
       id, name, customer_name, status, start_date, delivery_date,
       completed_at, cancelled_at, created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, 'Resolution image customer', $3::text,
       '2026-10-20'::date, '2026-11-20'::date,
       case when $3 = 'completed' then now() end,
       case when $3 = 'cancelled' then now() end,
       $4::uuid, $4::uuid
     )`,
    [projectId, `Resolution image ${projectId}`, status, createdBy],
  );
  await database.query(
    `insert into public.project_activity_updates (
       id, project_id, author_user_id, request_id, title, description, activity_kind
     ) values ($1, $2, $3, $4, 'Issue', 'Issue description', 'issue')`,
    [activityId, projectId, resolver.profileId, activityRequestId],
  );
  await database.query(
    `insert into public.project_issue_resolutions (
       id, project_activity_id, request_id, resolved_by_user_id, description
     ) values ($1, $2, $3, $4, 'Immutable resolution')`,
    [resolutionId, activityId, resolutionRequestId, resolver.profileId],
  );
  return { projectId, activityId, resolutionId, resolutionRequestId };
}

function prepare(fixture: Awaited<ReturnType<typeof issue>>, actor: SecurityActor) {
  return [
    fixture.projectId,
    fixture.activityId,
    fixture.resolutionId,
    fixture.resolutionRequestId,
    actor.authUserId,
    "image/png",
    128,
    "a".repeat(64),
    "Resolution evidence",
  ];
}

export function registerProjectIssueResolutionImageTests(
  requireHarness: () => SecurityFixtureHarness,
) {
  describe.skipIf(process.env.PROJECT_ISSUE_RESOLUTION_IMAGES !== "1")(
    "Task 002C Project Issue resolution images",
    () => {
      it("keeps the attachment table private and all four helpers service-role only", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const table = (await database.query<{ rls: boolean }>(
            `select relrowsecurity as rls from pg_catalog.pg_class
             where oid = 'public.project_issue_resolution_attachments'::regclass`,
          )).rows[0];
          expect(table?.rls).toBe(true);
          for (const signature of [
            "prepare_project_issue_resolution_image_upload(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text)",
            "attach_project_issue_resolution_image(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text)",
            "reconcile_project_issue_resolution_image_upload(uuid,uuid,uuid,uuid,text,text,bigint,text,text)",
            "get_project_issue_resolution_image_access_context(uuid,uuid,uuid,uuid)",
          ]) {
            for (const [role, allowed] of [
              ["public", false], ["anon", false], ["authenticated", false], ["service_role", true],
            ] as const) {
              expect((await database.query<{ allowed: boolean }>(
                "select has_function_privilege($1, $2, 'execute') as allowed",
                [role, `public.${signature}`],
              )).rows[0]?.allowed).toBe(allowed);
            }
          }
        });
      });

      it("binds upload to the exact active resolver/request while allowing closed Projects", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          for (const status of ["planned", "completed", "cancelled"] as const) {
            const item = await issue(database, fixture.actors.admin, fixture.actors.admin.profileId, status);
            expect((await service<{ attachment_exists: boolean }>(
              database, prepareSql, prepare(item, fixture.actors.admin),
            ))[0]?.attachment_exists).toBe(false);
            const changed = prepare(item, fixture.actors.admin);
            changed[3] = randomUUID();
            await rejected(database, prepareSql, changed, "PIR04");
            await rejected(database, prepareSql, prepare(item, fixture.actors.permitted), "42501");
          }

          await permission(database, fixture.actors.permitted, fixture.actors.admin.profileId, "projects.edit");
          const editor = await issue(database, fixture.actors.permitted, fixture.actors.admin.profileId);
          expect((await service<{ attachment_exists: boolean }>(
            database, prepareSql, prepare(editor, fixture.actors.permitted),
          ))[0]?.attachment_exists).toBe(false);
          await database.query(
            `delete from public.user_permissions where user_id = $1 and
             permission_definition_id = (select id from public.permission_definitions where key = 'projects.edit')`,
            [fixture.actors.permitted.profileId],
          );
          await rejected(database, prepareSql, prepare(editor, fixture.actors.permitted), "42501");
          const inactive = await issue(database, fixture.actors.inactive, fixture.actors.admin.profileId);
          await rejected(database, prepareSql, prepare(inactive, fixture.actors.inactive), "42501");
        });
      });

      it("allows only current Project viewers to read exact immutable evidence", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const item = await issue(database, fixture.actors.admin, fixture.actors.admin.profileId);
          const attachmentId = randomUUID();
          const path = `resolution-final/${item.projectId}/${item.activityId}/${item.resolutionId}/${randomUUID()}.png`;
          await database.query(
            `insert into public.project_issue_resolution_attachments (
               id, project_issue_resolution_id, storage_path, mime_type,
               byte_size, content_hash, alt_text
             ) values ($1, $2, $3, 'image/png', 128, $4, 'Evidence')`,
            [attachmentId, item.resolutionId, path, "a".repeat(64)],
          );
          expect((await service<{ attachment_id: string }>(database, accessSql, [
            item.projectId, item.activityId, item.resolutionId, fixture.actors.admin.authUserId,
          ]))[0]?.attachment_id).toBe(attachmentId);
          await permission(database, fixture.actors.permitted, fixture.actors.admin.profileId, "projects.view");
          expect((await service<{ attachment_id: string }>(database, accessSql, [
            item.projectId, item.activityId, item.resolutionId, fixture.actors.permitted.authUserId,
          ]))[0]?.attachment_id).toBe(attachmentId);
          await rejected(database, accessSql, [
            item.projectId, item.activityId, item.resolutionId, fixture.actors.unpermitted.authUserId,
          ], "42501");
          await rejected(database, accessSql, [
            item.projectId, item.activityId, item.resolutionId, fixture.actors.inactive.authUserId,
          ], "42501");

          await expect(database.query(
            "update public.project_issue_resolution_attachments set alt_text = 'Changed' where id = $1",
            [attachmentId],
          )).rejects.toBeDefined();
        });
      });
    },
  );
}
