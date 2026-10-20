import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { loadBackendTestEnvironment } from "./env";
import type { SecurityFixtureHarness } from "./security-fixtures";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261016130000_create_project_activity_alert_foundation.sql",
);
const environment = loadBackendTestEnvironment();
const foundationTables = [
  "project_activity_alert_recipients",
  "project_activity_alerts",
  "project_activity_attachments",
  "project_activity_updates",
] as const;

async function expectRejected(
  database: PoolClient,
  sql: string,
  parameters: unknown[],
  code: string,
): Promise<void> {
  await database.query("savepoint rejected_project_activity_foundation");
  try {
    await expect(database.query(sql, parameters)).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback to savepoint rejected_project_activity_foundation");
    await database.query("release savepoint rejected_project_activity_foundation");
  }
}

async function createBaseRows(
  database: PoolClient,
  actorId: string,
): Promise<{
  activityId: string;
  alertId: string;
  attachmentId: string;
  projectId: string;
}> {
  const projectId = randomUUID();
  const activityId = randomUUID();
  const attachmentId = randomUUID();
  const alertId = randomUUID();

  await database.query(
    `insert into public.projects (
       id, name, customer_name, start_date, delivery_date,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, 'Activity foundation Project', 'Activity Customer',
       '2026-10-16'::date, '2026-11-16'::date, $2::uuid, $2::uuid
     )`,
    [projectId, actorId],
  );
  await database.query(
    `insert into public.project_activity_updates (
       id, project_id, author_user_id, request_id, title, description
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text)`,
    [
      activityId,
      projectId,
      actorId,
      randomUUID(),
      "Foundation update",
      "Line one\nLine two",
    ],
  );
  await database.query(
    `insert into public.project_activity_attachments (
       id, project_activity_id, storage_path, mime_type,
       byte_size, content_hash, alt_text
     ) values (
       $1::uuid, $2::uuid, $3::text, 'image/png', 8, $4::text, 'Project image'
     )`,
    [
      attachmentId,
      activityId,
      `final/${projectId}/${activityId}/${randomUUID()}.png`,
      "foundation-content-hash",
    ],
  );
  await database.query(
    `insert into public.project_activity_alerts (
       id, project_activity_id, sent_by_user_id
     ) values ($1::uuid, $2::uuid, $3::uuid)`,
    [alertId, activityId, actorId],
  );

  return { activityId, alertId, attachmentId, projectId };
}

export function registerProjectActivityFoundationTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task B Project Activity foundation (static)", () => {
    it("contains foundation-only schema, permissions, private Storage, and no business RPC", () => {
      const sql = readFileSync(migrationPath, "utf8");

      expect(sql.match(/'projects\.alerts\.send'/g)).toHaveLength(1);
      expect(sql.match(/'projects\.alerts\.receive'/g)).toHaveLength(1);
      for (const table of foundationTables) {
        expect(sql).toContain(`create table public.${table} (`);
        expect(sql).toContain(
          `alter table public.${table} enable row level security`,
        );
      }
      expect(sql.match(/security invoker/g)).toHaveLength(2);
      expect(sql).not.toContain("security definer");
      expect(sql).not.toContain("append_audit_log");
      expect(sql).not.toContain("insert into public.audit_logs");
      expect(sql).not.toContain("has_permission(");
      expect(sql).not.toContain("current_user_is_admin");
      expect(sql).toContain("project-activity-images");
      expect(sql).toContain("as restrictive\nfor all\nto anon, authenticated");
    });
  });

  describe.skipIf(process.env.TASKB_ACTIVITY_FOUNDATION !== "1")(
    "Task B Project Activity foundation (requires migration 123)",
    () => {
      it("has exact schema, restrictive FKs, constraints, indexes, RLS, ACL, and trigger metadata", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const expectedColumns: Record<string, Array<{
            column_name: string;
            data_type: string;
            is_nullable: "NO" | "YES";
          }>> = {
            project_activity_updates: [
              { column_name: "id", data_type: "uuid", is_nullable: "NO" },
              { column_name: "project_id", data_type: "uuid", is_nullable: "NO" },
              { column_name: "author_user_id", data_type: "uuid", is_nullable: "NO" },
              { column_name: "request_id", data_type: "uuid", is_nullable: "NO" },
              { column_name: "title", data_type: "text", is_nullable: "NO" },
              { column_name: "description", data_type: "text", is_nullable: "NO" },
              { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
            ],
            project_activity_attachments: [
              { column_name: "id", data_type: "uuid", is_nullable: "NO" },
              { column_name: "project_activity_id", data_type: "uuid", is_nullable: "NO" },
              { column_name: "storage_path", data_type: "text", is_nullable: "NO" },
              { column_name: "mime_type", data_type: "text", is_nullable: "NO" },
              { column_name: "byte_size", data_type: "bigint", is_nullable: "NO" },
              { column_name: "content_hash", data_type: "text", is_nullable: "NO" },
              { column_name: "alt_text", data_type: "text", is_nullable: "YES" },
              { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
            ],
            project_activity_alerts: [
              { column_name: "id", data_type: "uuid", is_nullable: "NO" },
              { column_name: "project_activity_id", data_type: "uuid", is_nullable: "NO" },
              { column_name: "sent_by_user_id", data_type: "uuid", is_nullable: "NO" },
              { column_name: "sent_at", data_type: "timestamp with time zone", is_nullable: "NO" },
            ],
            project_activity_alert_recipients: [
              { column_name: "id", data_type: "uuid", is_nullable: "NO" },
              { column_name: "alert_id", data_type: "uuid", is_nullable: "NO" },
              { column_name: "recipient_user_id", data_type: "uuid", is_nullable: "NO" },
              { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
              { column_name: "read_at", data_type: "timestamp with time zone", is_nullable: "YES" },
              ...(process.env.PROJECT_ALERT_DISMISSAL_FOUNDATION === "1"
                ? [{ column_name: "dismissed_at", data_type: "timestamp with time zone", is_nullable: "YES" as const }]
                : []),
            ],
          };

          for (const table of foundationTables) {
            const columns = (await database.query<{
              column_name: string;
              data_type: string;
              is_nullable: "NO" | "YES";
            }>(
              `select column_name, data_type, is_nullable
               from information_schema.columns
               where table_schema = 'public' and table_name = $1::text
               order by ordinal_position`,
              [table],
            )).rows;
            expect(columns).toEqual(expectedColumns[table]);
          }

          const foreignKeys = (await database.query<{
            constraint_name: string;
            delete_action: string;
            source_table: string;
            target_table: string;
          }>(
            `select
               constraint_row.conname as constraint_name,
               constraint_row.conrelid::regclass::text as source_table,
               constraint_row.confrelid::regclass::text as target_table,
               case constraint_row.confdeltype when 'r' then 'RESTRICT' else constraint_row.confdeltype::text end as delete_action
             from pg_catalog.pg_constraint as constraint_row
             where constraint_row.contype = 'f'
               and constraint_row.conrelid = any($1::regclass[])
             order by constraint_row.conname`,
            [foundationTables.map((table) => `public.${table}`)],
          )).rows;
          expect(foreignKeys).toEqual([
            { constraint_name: "project_activity_alert_recipients_alert_id_fkey", delete_action: "RESTRICT", source_table: "project_activity_alert_recipients", target_table: "project_activity_alerts" },
            { constraint_name: "project_activity_alert_recipients_user_id_fkey", delete_action: "RESTRICT", source_table: "project_activity_alert_recipients", target_table: "user_profiles" },
            { constraint_name: "project_activity_alerts_activity_id_fkey", delete_action: "RESTRICT", source_table: "project_activity_alerts", target_table: "project_activity_updates" },
            { constraint_name: "project_activity_alerts_sender_user_id_fkey", delete_action: "RESTRICT", source_table: "project_activity_alerts", target_table: "user_profiles" },
            { constraint_name: "project_activity_attachments_activity_id_fkey", delete_action: "RESTRICT", source_table: "project_activity_attachments", target_table: "project_activity_updates" },
            { constraint_name: "project_activity_updates_author_user_id_fkey", delete_action: "RESTRICT", source_table: "project_activity_updates", target_table: "user_profiles" },
            { constraint_name: "project_activity_updates_project_id_fkey", delete_action: "RESTRICT", source_table: "project_activity_updates", target_table: "projects" },
          ]);

          const indexes = (await database.query<{ index_name: string; index_definition: string }>(
            `select indexname as index_name, indexdef as index_definition
             from pg_catalog.pg_indexes
             where schemaname = 'public'
               and tablename = any($1::text[])
             order by indexname`,
            [foundationTables],
          )).rows;
          expect(indexes.find((index) => index.index_name === "project_activity_updates_project_timeline_idx")?.index_definition)
            .toContain("(project_id, created_at DESC, id DESC)");
          expect(indexes.find((index) => index.index_name === "project_activity_alert_recipients_inbox_idx")?.index_definition)
            .toContain("(recipient_user_id, created_at DESC, id DESC)");
          const inboxIndex = indexes.find(
            (index) => index.index_name === "project_activity_alert_recipients_inbox_idx",
          )?.index_definition;
          const unreadIndex = indexes.find(
            (index) => index.index_name === "project_activity_alert_recipients_unread_inbox_idx",
          )?.index_definition;
          if (process.env.PROJECT_ALERT_DISMISSAL === "1") {
            expect(inboxIndex).toContain("WHERE (dismissed_at IS NULL)");
            expect(unreadIndex).toContain(
              "WHERE ((read_at IS NULL) AND (dismissed_at IS NULL))",
            );
          } else {
            expect(unreadIndex).toContain("WHERE (read_at IS NULL)");
          }

          const security = (await database.query<{
            direct_policies: string;
            rls_tables: string;
          }>(
            `select
               (select pg_catalog.count(*)::text
                from pg_catalog.pg_policies
                where schemaname = 'public' and tablename = any($1::text[])) as direct_policies,
               (select pg_catalog.count(*)::text
                from pg_catalog.pg_class as relation
                join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
                where namespace.nspname = 'public'
                  and relation.relname = any($1::text[])
                  and relation.relrowsecurity) as rls_tables`,
            [foundationTables],
          )).rows[0];
          expect(security).toEqual({ direct_policies: "0", rls_tables: "4" });

          for (const table of foundationTables) {
            for (const role of ["public", "anon", "authenticated"]) {
              const privileges = (await database.query<{ allowed: boolean }>(
                `select pg_catalog.has_table_privilege(
                   $1::text, $2::text, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
                 ) as allowed`,
                [role, `public.${table}`],
              )).rows[0]?.allowed;
              expect(privileges).toBe(false);
            }
          }

          const functions = (await database.query<{
            function_name: string;
            is_security_definer: boolean;
            configuration: string[] | null;
          }>(
            `select
               function_row.proname as function_name,
               function_row.prosecdef as is_security_definer,
               function_row.proconfig as configuration
             from pg_catalog.pg_proc as function_row
             join pg_catalog.pg_namespace as namespace on namespace.oid = function_row.pronamespace
             where namespace.nspname = 'public'
               and function_row.proname in (
                 'prevent_project_activity_history_mutation',
                 'enforce_project_activity_alert_recipient_history'
               )
             order by function_row.proname`,
          )).rows;
          expect(functions).toEqual([
            { function_name: "enforce_project_activity_alert_recipient_history", is_security_definer: false, configuration: ["search_path=\"\""] },
            { function_name: "prevent_project_activity_history_mutation", is_security_definer: false, configuration: ["search_path=\"\""] },
          ]);

          const permissions = (await database.query<{
            description: string;
            is_delegable: boolean;
            key: string;
            label: string;
            module: string;
          }>(
            `select key, module, label, description, is_delegable
             from public.permission_definitions
             where key like 'projects.alerts.%'
             order by key`,
          )).rows;
          expect(permissions).toEqual([
            {
              key: "projects.alerts.receive",
              module: "projects",
              label: "Receive Project Activity Alerts",
              description: "Receive Project Activity alerts when all current recipient requirements are met.",
              is_delegable: true,
            },
            {
              key: "projects.alerts.send",
              module: "projects",
              label: "Send Project Activity Alerts",
              description: "Send alerts with otherwise authorized Project Activity updates.",
              is_delegable: true,
            },
          ]);

          const bucket = (await database.query<{
            allowed_mime_types: string[];
            file_size_limit: string;
            id: string;
            public: boolean;
          }>(
            `select id, public, file_size_limit::text, allowed_mime_types
             from storage.buckets where id = 'project-activity-images'`,
          )).rows;
          expect(bucket).toEqual([{
            id: "project-activity-images",
            public: false,
            file_size_limit: "5242880",
            allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
          }]);

          const storagePolicies = (await database.query<{
            command: string;
            permissive: string;
            policy_name: string;
            roles: string[];
          }>(
            `select policyname as policy_name, permissive,
                    pg_catalog.to_jsonb(roles) as roles, cmd as command
             from pg_catalog.pg_policies
             where schemaname = 'storage' and tablename = 'objects'
               and policyname = 'project_activity_image_objects_no_direct_client_access'`,
          )).rows;
          expect(storagePolicies).toEqual([{
            policy_name: "project_activity_image_objects_no_direct_client_access",
            permissive: "RESTRICTIVE",
            roles: ["anon", "authenticated"],
            command: "ALL",
          }]);
        });
      });

      it("enforces validation, uniqueness, immutable history, and the future one-way read transition", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const base = await createBaseRows(database, actorId);
          const insertActivity = `insert into public.project_activity_updates (
            project_id, author_user_id, request_id, title, description
          ) values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text)`;

          for (const [title, description] of [
            ["   ", "Valid description"],
            ["A".repeat(121), "Valid description"],
            [" Untrimmed", "Valid description"],
            ["Valid title", "   "],
            ["Valid title", "D".repeat(5001)],
            ["Valid title", "Untrimmed "],
          ]) {
            await expectRejected(database, insertActivity, [
              base.projectId, actorId, randomUUID(), title, description,
            ], "23514");
          }

          const requestId = randomUUID();
          await database.query(insertActivity, [
            base.projectId, actorId, requestId, "Unique request", "Description",
          ]);
          await expectRejected(database, insertActivity, [
            base.projectId, actorId, requestId, "Duplicate request", "Description",
          ], "23505");

          const insertAttachment = `insert into public.project_activity_attachments (
            project_activity_id, storage_path, mime_type, byte_size, content_hash, alt_text
          ) values ($1::uuid, $2::text, $3::text, $4::bigint, $5::text, $6::text)`;
          for (const values of [
            [base.activityId, `final/${randomUUID()}.png`, "image/gif", 8, "hash", null],
            [base.activityId, `final/${randomUUID()}.png`, "image/png", 0, "hash", null],
            [base.activityId, `final/${randomUUID()}.png`, "image/png", 5242881, "hash", null],
            [base.activityId, "   ", "image/png", 8, "hash", null],
            [base.activityId, `final/${randomUUID()}.png`, "image/png", 8, "   ", null],
            [base.activityId, `final/${randomUUID()}.png`, "image/png", 8, "hash", "   "],
          ]) {
            await expectRejected(database, insertAttachment, values, "23514");
          }
          await expectRejected(database, insertAttachment, [
            base.activityId, `final/${randomUUID()}.png`, "image/png", 8, "hash", null,
          ], "23505");

          await expectRejected(
            database,
            `insert into public.project_activity_alerts (
               project_activity_id, sent_by_user_id
             ) values ($1::uuid, $2::uuid)`,
            [base.activityId, actorId],
            "23505",
          );

          const recipientId = randomUUID();
          await database.query(
            `insert into public.project_activity_alert_recipients (
               id, alert_id, recipient_user_id
             ) values ($1::uuid, $2::uuid, $3::uuid)`,
            [recipientId, base.alertId, fixture.actors.permitted.profileId],
          );
          await expectRejected(
            database,
            `insert into public.project_activity_alert_recipients (
               alert_id, recipient_user_id
             ) values ($1::uuid, $2::uuid)`,
            [base.alertId, fixture.actors.permitted.profileId],
            "23505",
          );
          await expectRejected(
            database,
            `insert into public.project_activity_alert_recipients (
               alert_id, recipient_user_id, read_at
             ) values ($1::uuid, $2::uuid, pg_catalog.clock_timestamp())`,
            [base.alertId, fixture.actors.unpermitted.profileId],
            "55000",
          );

          for (const statement of [
            ["update public.project_activity_updates set title = 'Changed' where id = $1::uuid", base.activityId],
            ["delete from public.project_activity_updates where id = $1::uuid", base.activityId],
            ["update public.project_activity_attachments set alt_text = 'Changed' where id = $1::uuid", base.attachmentId],
            ["delete from public.project_activity_attachments where id = $1::uuid", base.attachmentId],
            ["update public.project_activity_alerts set sent_at = sent_at where id = $1::uuid", base.alertId],
            ["delete from public.project_activity_alerts where id = $1::uuid", base.alertId],
          ] as const) {
            await expectRejected(database, statement[0], [statement[1]], "55000");
          }

          await database.query(
            `update public.project_activity_alert_recipients
             set read_at = pg_catalog.clock_timestamp() where id = $1::uuid`,
            [recipientId],
          );
          const recipient = (await database.query<{ read_at: Date | null }>(
            `select read_at from public.project_activity_alert_recipients
             where id = $1::uuid`,
            [recipientId],
          )).rows;
          expect(recipient[0]?.read_at).toBeInstanceOf(Date);
          await expectRejected(
            database,
            `update public.project_activity_alert_recipients
             set read_at = read_at + interval '1 second' where id = $1::uuid`,
            [recipientId],
            "55000",
          );
          await expectRejected(
            database,
            "delete from public.project_activity_alert_recipients where id = $1::uuid",
            [recipientId],
            "55000",
          );

          await expectRejected(
            database,
            "delete from public.projects where id = $1::uuid",
            [base.projectId],
            "23503",
          );
        });
      });

      it("denies direct table reads and writes to anon and authenticated browser roles", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          for (const role of ["anon", "authenticated"] as const) {
            for (const table of foundationTables) {
              for (const sql of [
                `select * from public.${table} limit 1`,
                `insert into public.${table} (id) values (pg_catalog.gen_random_uuid())`,
                `update public.${table} set id = id`,
                `delete from public.${table}`,
              ]) {
                await database.query("savepoint direct_project_activity_access");
                try {
                  await database.query(`set local role ${role}`);
                  await expect(database.query(sql)).rejects.toMatchObject({ code: "42501" });
                } finally {
                  await database.query("rollback to savepoint direct_project_activity_access");
                  await database.query("release savepoint direct_project_activity_access");
                }
              }
            }
          }
        });
      });

      it("keeps the private image bucket inaccessible and immutable to browser clients", async () => {
        const fixture = requireHarness();
        const service = createClient(
          environment.supabaseUrl,
          environment.supabaseSecretKey,
          { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } },
        );
        const projectId = randomUUID();
        const activityId = randomUUID();
        const objectPath = `final/${projectId}/${activityId}/${randomUUID()}.png`;
        const otherPath = `final/${projectId}/${activityId}/${randomUUID()}.png`;
        const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

        const trustedUpload = await service.storage
          .from("project-activity-images")
          .upload(objectPath, pngBytes, { contentType: "image/png" });
        expect(trustedUpload.error).toBeNull();

        try {
          const anonymousRead = await fixture.anonymousClient.storage
            .from("project-activity-images")
            .download(objectPath);
          const authenticatedRead = await fixture.actors.admin.client.storage
            .from("project-activity-images")
            .download(objectPath);
          const browserUpload = await fixture.actors.admin.client.storage
            .from("project-activity-images")
            .upload(otherPath, pngBytes, { contentType: "image/png" });
          const browserReplace = await fixture.actors.admin.client.storage
            .from("project-activity-images")
            .upload(objectPath, pngBytes, { contentType: "image/png", upsert: true });
          const browserDelete = await fixture.actors.admin.client.storage
            .from("project-activity-images")
            .remove([objectPath]);

          expect(anonymousRead.error).not.toBeNull();
          expect(authenticatedRead.error).not.toBeNull();
          expect(browserUpload.error).not.toBeNull();
          expect(browserReplace.error).not.toBeNull();
          expect(browserDelete.data).toEqual([]);

          const preserved = await service.storage
            .from("project-activity-images")
            .download(objectPath);
          expect(preserved.error).toBeNull();
        } finally {
          const cleanup = await service.storage
            .from("project-activity-images")
            .remove([objectPath, otherPath]);
          expect(cleanup.error).toBeNull();
        }
      });
    },
  );
}
