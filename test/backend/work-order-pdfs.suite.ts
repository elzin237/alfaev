import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { loadBackendTestEnvironment } from "./env";
import type {
  SecurityActor,
  SecurityFixtureHarness,
} from "./security-fixtures";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260929130000_create_private_work_order_pdf_storage.sql",
);
const environment = loadBackendTestEnvironment();
const pdfBytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n%%EOF\n");

async function actAs(
  database: PoolClient,
  actor: SecurityActor | null,
  role: "anon" | "authenticated" = "authenticated",
): Promise<void> {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor?.authUserId ?? ""],
  );
  await database.query(`set local role ${role}`);
}

async function expectRejected(
  database: PoolClient,
  operation: () => Promise<unknown>,
  code: string,
): Promise<void> {
  await database.query("savepoint rejected_work_order_pdf");
  await expect(operation()).rejects.toMatchObject({ code });
  await database.query("rollback to savepoint rejected_work_order_pdf");
}

async function setOnlyWorkOrderPermission(
  database: PoolClient,
  actor: SecurityActor,
  grantedByUserId: string,
  permissionKey: string | null,
): Promise<void> {
  await database.query(
    `delete from public.user_permissions as permission
     using public.permission_definitions as definition
     where permission.permission_definition_id = definition.id
       and permission.user_id = $1::uuid
       and definition.key like 'work_orders.%'`,
    [actor.profileId],
  );

  if (!permissionKey) return;

  await database.query(
    `insert into public.user_permissions (
       user_id, permission_definition_id, granted_by_user_id
     )
     select $1::uuid, definition.id, $2::uuid
     from public.permission_definitions as definition
     where definition.key = $3::text`,
    [actor.profileId, grantedByUserId, permissionKey],
  );
}

async function nextWorkOrderNumber(database: PoolClient): Promise<string> {
  const result = await database.query<{ work_order_number: string }>(
    `select 'RN-8999-' || pg_catalog.lpad(candidate::text, 4, '0')
       as work_order_number
     from pg_catalog.generate_series(1, 9999) as candidate
     where not exists (
       select 1
       from public.work_orders as work_order
       where work_order.work_order_number =
         'RN-8999-' || pg_catalog.lpad(candidate::text, 4, '0')
     )
     order by candidate
     limit 1`,
  );
  const number = result.rows[0]?.work_order_number;
  if (!number) throw new Error("No isolated Work Order PDF number is available");
  return number;
}

async function createWorkOrder(
  database: PoolClient,
  actorId: string,
  status: "draft" | "finished",
): Promise<{ projectId: string | null; workOrderId: string }> {
  const workOrderId = randomUUID();
  const number = await nextWorkOrderNumber(database);

  if (status === "draft") {
    await database.query(
      `insert into public.work_orders (
         id, work_order_number, status,
         created_by_user_id, updated_by_user_id
       ) values ($1::uuid, $2::text, 'draft', $3::uuid, $3::uuid)`,
      [workOrderId, number, actorId],
    );
    return { projectId: null, workOrderId };
  }

  const projectId = randomUUID();
  await database.query(
    `insert into public.projects (
       id, name, customer_name, start_date, delivery_date,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, $3::text, '2026-09-29'::date, '2026-10-29'::date,
       $4::uuid, $4::uuid
     )`,
    [
      projectId,
      `PDF Project ${projectId}`,
      `PDF Customer ${projectId}`,
      actorId,
    ],
  );
  await database.query(
    `insert into public.work_orders (
       id, work_order_number, project_id, customer_name_snapshot,
       description, status, created_by_user_id, updated_by_user_id,
       finished_at, finished_by_user_id
     ) values (
       $1::uuid, $2::text, $3::uuid, $4::text,
       'Finished PDF fixture', 'finished', $5::uuid, $5::uuid,
       pg_catalog.clock_timestamp(), $5::uuid
     )`,
    [workOrderId, number, projectId, `PDF Customer ${projectId}`, actorId],
  );
  return { projectId, workOrderId };
}

async function insertPdfReference(
  database: PoolClient,
  workOrderId: string,
  storageReference: string,
  actorId: string,
  options: { contentHash?: string | null; documentVersion?: number } = {},
): Promise<string> {
  const result = await database.query<{ id: string }>(
    `insert into public.work_order_pdfs (
       work_order_id, storage_reference, generated_at,
       generated_by_user_id, document_version, content_hash
     ) values (
       $1::uuid, $2::text, pg_catalog.clock_timestamp(),
       $3::uuid, $4::integer, $5::text
     ) returning id`,
    [
      workOrderId,
      storageReference,
      actorId,
      options.documentVersion ?? 1,
      options.contentHash ?? null,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Work Order PDF insert returned no ID");
  return id;
}

export function registerWorkOrderPdfTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 118 Work Order PDF migration static contract", () => {
    it("contains the private bucket, immutable metadata, exact-reference read, and restrictive write guards", () => {
      const sql = readFileSync(migrationPath, "utf8");
      expect(sql).toContain("'work-order-pdfs'");
      expect(sql).toContain("10485760");
      expect(sql).toContain("array['application/pdf']::text[]");
      expect(sql).toContain("create table public.work_order_pdfs");
      expect(sql).toContain("document_version = 1");
      expect(sql).toContain("^final/");
      expect(sql).toContain("using errcode = 'WOR09'");
      expect(sql).toContain("public.can_read_work_order_pdf_object(name)");
      expect(sql).toContain("as restrictive\nfor insert");
      expect(sql).toContain("as restrictive\nfor update");
      expect(sql).toContain("as restrictive\nfor delete");
      expect(sql).not.toMatch(/generate.*pdf|edge function|signed[_ -]?url/i);
    });
  });

  describe.skipIf(process.env.TASK118_MIGRATION !== "1")(
    "Task 118 private Work Order PDF storage (requires deployed migration)",
    () => {
      it("creates the exact bucket, schema, constraints, policies, and helper security", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const bucket = await database.query(
            `select public, file_size_limit::text, allowed_mime_types
             from storage.buckets where id = 'work-order-pdfs'`,
          );
          expect(bucket.rows).toEqual([{
            allowed_mime_types: ["application/pdf"],
            file_size_limit: "10485760",
            public: false,
          }]);

          const columns = await database.query(
            `select column_name, data_type, is_nullable, column_default
             from information_schema.columns
             where table_schema = 'public'
               and table_name = 'work_order_pdfs'
             order by ordinal_position`,
          );
          expect(columns.rows.map((row) => row.column_name)).toEqual([
            "id", "work_order_id", "storage_reference", "generated_at",
            "generated_by_user_id", "document_version", "content_hash",
          ]);
          expect(columns.rows.find((row) => row.column_name === "document_version"))
            .toMatchObject({ column_default: "1", data_type: "integer", is_nullable: "NO" });

          const constraints = await database.query<{ constraint_name: string }>(
            `select constraint_name
             from information_schema.table_constraints
             where table_schema = 'public'
               and table_name = 'work_order_pdfs'
             order by constraint_name`,
          );
          expect(constraints.rows.map((row) => row.constraint_name)).toEqual(
            expect.arrayContaining([
              "work_order_pdfs_content_hash_sha256",
              "work_order_pdfs_document_version_one",
              "work_order_pdfs_final_reference_for_work_order",
              "work_order_pdfs_generated_by_user_id_fkey",
              "work_order_pdfs_pkey",
              "work_order_pdfs_storage_reference_key",
              "work_order_pdfs_work_order_id_fkey",
              "work_order_pdfs_work_order_id_key",
            ]),
          );

          const functionMetadata = await database.query(
            `select procedure.proname, language.lanname, procedure.provolatile,
                    procedure.prosecdef, procedure.proconfig
             from pg_catalog.pg_proc as procedure
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = procedure.pronamespace
             join pg_catalog.pg_language as language
               on language.oid = procedure.prolang
             where namespace.nspname = 'public'
               and procedure.proname in (
                 'can_read_work_order_pdf_object',
                 'enforce_work_order_pdf_immutability',
                 'validate_work_order_pdf_insert'
               )
             order by procedure.proname`,
          );
          expect(functionMetadata.rows).toEqual([
            {
              lanname: "sql", proconfig: ['search_path=""'],
              proname: "can_read_work_order_pdf_object", prosecdef: true,
              provolatile: "s",
            },
            {
              lanname: "plpgsql", proconfig: ['search_path=""'],
              proname: "enforce_work_order_pdf_immutability", prosecdef: false,
              provolatile: "v",
            },
            {
              lanname: "plpgsql", proconfig: ['search_path=""'],
              proname: "validate_work_order_pdf_insert", prosecdef: false,
              provolatile: "v",
            },
          ]);

          const helperPrivileges = await database.query(
            `select
               pg_catalog.has_function_privilege(
                 'anon', 'public.can_read_work_order_pdf_object(text)', 'EXECUTE'
               ) as anon_execute,
               pg_catalog.has_function_privilege(
                 'authenticated', 'public.can_read_work_order_pdf_object(text)', 'EXECUTE'
               ) as authenticated_execute,
               pg_catalog.has_function_privilege(
                 'public', 'public.can_read_work_order_pdf_object(text)', 'EXECUTE'
               ) as public_execute`,
          );
          expect(helperPrivileges.rows).toEqual([{
            anon_execute: false,
            authenticated_execute: true,
            public_execute: false,
          }]);

          const policies = await database.query(
            `select policyname, permissive, cmd, roles
             from pg_catalog.pg_policies
             where schemaname in ('public', 'storage')
               and (
                 (tablename = 'work_order_pdfs')
                 or policyname like 'work_order_pdf_objects_%'
               )
             order by policyname`,
          );
          expect(policies.rows.map((row) => row.policyname)).toEqual([
            "work_order_pdf_objects_delete_guard",
            "work_order_pdf_objects_insert_guard",
            "work_order_pdf_objects_select_guard_anon",
            "work_order_pdf_objects_select_guard_authenticated",
            "work_order_pdf_objects_select_referenced",
            "work_order_pdf_objects_update_guard",
            "work_order_pdfs_select_authorized_finished",
          ]);
          expect(policies.rows.filter((row) => row.policyname.endsWith("_guard"))
            .every((row) => row.permissive === "RESTRICTIVE")).toBe(true);
        });
      });

      it("enforces final paths, object validity, Finished state, hashes, uniqueness, and immutability", async () => {
        const fixture = requireHarness();
        const service = createClient(
          environment.supabaseUrl,
          environment.supabaseSecretKey,
          { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } },
        );
        const uploadedPaths: string[] = [];
        try {
          await fixture.withRollbackDatabaseTransaction(async (database) => {
            const actorId = fixture.actors.admin.profileId;
            const finished = await createWorkOrder(database, actorId, "finished");
            const draft = await createWorkOrder(database, actorId, "draft");
            const validPath = `final/${finished.workOrderId}/${randomUUID()}.pdf`;
            const secondPath = `final/${finished.workOrderId}/${randomUUID()}.pdf`;
            const draftPath = `final/${draft.workOrderId}/${randomUUID()}.pdf`;
            for (const path of [validPath, secondPath, draftPath]) {
              const { error } = await service.storage.from("work-order-pdfs")
                .upload(path, pdfBytes, { contentType: "application/pdf", upsert: false });
              expect(error).toBeNull();
              uploadedPaths.push(path);
            }

            const invalidReferences = [
              `_tmp/${finished.workOrderId}/${randomUUID()}.pdf`,
              `final/${randomUUID()}/${randomUUID()}.pdf`,
              `final/${finished.workOrderId}/user-file.pdf`,
            ];
            for (const reference of invalidReferences) {
              const { error } = await service.storage.from("work-order-pdfs")
                .upload(reference, pdfBytes, {
                  contentType: "application/pdf",
                  upsert: false,
                });
              expect(error).toBeNull();
              uploadedPaths.push(reference);
              await expectRejected(
                database,
                () => insertPdfReference(database, finished.workOrderId, reference, actorId),
                "23514",
              );
            }

            const missingPath = `final/${finished.workOrderId}/${randomUUID()}.pdf`;
            await expectRejected(
              database,
              () => insertPdfReference(database, finished.workOrderId, missingPath, actorId),
              "22023",
            );

            const wrongMimePath = `final/${finished.workOrderId}/${randomUUID()}.pdf`;
            await database.query(
              `insert into storage.objects (bucket_id, name, metadata)
               values ('work-order-pdfs', $1::text,
                 pg_catalog.jsonb_build_object('mimetype', 'text/plain'))`,
              [wrongMimePath],
            );
            await expectRejected(
              database,
              () => insertPdfReference(database, finished.workOrderId, wrongMimePath, actorId),
              "22023",
            );

            await expectRejected(
              database,
              () => insertPdfReference(database, draft.workOrderId, draftPath, actorId),
              "22023",
            );
            await expectRejected(
              database,
              () => insertPdfReference(database, finished.workOrderId, validPath, actorId, {
                documentVersion: 2,
              }),
              "23514",
            );
            for (const contentHash of ["A".repeat(64), "a".repeat(63), "not-a-hash"] ) {
              await expectRejected(
                database,
                () => insertPdfReference(database, finished.workOrderId, validPath, actorId, {
                  contentHash,
                }),
                "23514",
              );
            }

            const pdfId = await insertPdfReference(
              database,
              finished.workOrderId,
              validPath,
              actorId,
              { contentHash: "a".repeat(64) },
            );
            expect((await database.query(
              `select document_version, content_hash
               from public.work_order_pdfs where id = $1::uuid`,
              [pdfId],
            )).rows).toEqual([{ content_hash: "a".repeat(64), document_version: 1 }]);

            await expectRejected(
              database,
              () => database.query(
                `update public.work_order_pdfs set content_hash = null
                 where id = $1::uuid`,
                [pdfId],
              ),
              "WOR09",
            );
            await expectRejected(
              database,
              () => database.query(
                "delete from public.work_order_pdfs where id = $1::uuid",
                [pdfId],
              ),
              "WOR09",
            );
            await expectRejected(
              database,
              () => insertPdfReference(database, finished.workOrderId, secondPath, actorId),
              "23505",
            );

            await actAs(database, fixture.actors.admin);
            await expectRejected(
              database,
              () => database.query(
                `update public.work_order_pdfs set content_hash = null
                 where id = $1::uuid`,
                [pdfId],
              ),
              "42501",
            );
            await expectRejected(
              database,
              () => database.query(
                "delete from public.work_order_pdfs where id = $1::uuid",
                [pdfId],
              ),
              "42501",
            );
            await expect(database.query(
              `insert into public.work_order_pdfs (
                 work_order_id, storage_reference, generated_at, generated_by_user_id
               ) values ($1::uuid, $2::text, pg_catalog.clock_timestamp(), $3::uuid)`,
              [finished.workOrderId, secondPath, actorId],
            )).rejects.toMatchObject({ code: "42501" });
          });
        } finally {
          if (uploadedPaths.length > 0) {
            const { error } = await service.storage.from("work-order-pdfs").remove(uploadedPaths);
            expect(error).toBeNull();
          }
        }
      });

      it("exposes only exact referenced final metadata and objects to Admin or work_orders.view", async () => {
        const fixture = requireHarness();
        const service = createClient(
          environment.supabaseUrl,
          environment.supabaseSecretKey,
          { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } },
        );
        const uploadedPaths: string[] = [];
        try {
          await fixture.withRollbackDatabaseTransaction(async (database) => {
            const admin = fixture.actors.admin;
            const viewer = fixture.actors.unpermitted;
            const finishOnly = fixture.actors.permitted;
            const ordinary = fixture.actors.productCreator;
            const finished = await createWorkOrder(database, admin.profileId, "finished");
            const finalPath = `final/${finished.workOrderId}/${randomUUID()}.pdf`;
            const unreferencedPath = `final/${finished.workOrderId}/${randomUUID()}.pdf`;
            const temporaryPath = `_tmp/${finished.workOrderId}/${randomUUID()}.pdf`;
            for (const path of [finalPath, unreferencedPath, temporaryPath]) {
              const { error } = await service.storage.from("work-order-pdfs")
                .upload(path, pdfBytes, { contentType: "application/pdf", upsert: false });
              expect(error).toBeNull();
              uploadedPaths.push(path);
            }

            expect((await service.storage.from("work-order-pdfs").download(temporaryPath)).error)
              .toBeNull();
            expect((await fixture.anonymousClient.storage.from("work-order-pdfs")
              .download(finalPath)).error).not.toBeNull();
            expect((await fixture.anonymousClient.storage.from("work-order-pdfs")
              .download(temporaryPath)).error).not.toBeNull();
            expect((await admin.client.storage.from("work-order-pdfs")
              .download(finalPath)).error).not.toBeNull();

            await setOnlyWorkOrderPermission(
              database, viewer, admin.profileId, "work_orders.view",
            );
            await setOnlyWorkOrderPermission(
              database, finishOnly, admin.profileId, "work_orders.finish",
            );
            const pdfId = await insertPdfReference(
              database, finished.workOrderId, finalPath, admin.profileId,
            );

            for (const actor of [admin, viewer]) {
              await actAs(database, actor);
              expect((await database.query(
                `select id, work_order_id, storage_reference, generated_at,
                        generated_by_user_id, document_version, content_hash
                 from public.work_order_pdfs where id = $1::uuid`,
                [pdfId],
              )).rows).toHaveLength(1);
              expect((await database.query(
                `select name from storage.objects
                 where bucket_id = 'work-order-pdfs'
                 order by name`,
              )).rows).toEqual([{ name: finalPath }]);
              await database.query("reset role");
            }

            for (const actor of [finishOnly, ordinary, fixture.actors.inactive]) {
              await actAs(database, actor);
              expect((await database.query(
                "select id from public.work_order_pdfs where id = $1::uuid",
                [pdfId],
              )).rows).toEqual([]);
              expect((await database.query(
                `select name from storage.objects
                 where bucket_id = 'work-order-pdfs'`,
              )).rows).toEqual([]);
              await database.query("reset role");
            }

            await actAs(database, null, "anon");
            expect((await database.query(
              `select name from storage.objects
               where bucket_id = 'work-order-pdfs'`,
            )).rows).toEqual([]);
          });
        } finally {
          if (uploadedPaths.length > 0) {
            const { error } = await service.storage.from("work-order-pdfs").remove(uploadedPaths);
            expect(error).toBeNull();
          }
        }
      });

      it("denies all browser writes while service-role temporary and final object management remains available", async () => {
        const fixture = requireHarness();
        const service = createClient(
          environment.supabaseUrl,
          environment.supabaseSecretKey,
          { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } },
        );
        const workOrderId = randomUUID();
        const protectedPath = `final/${workOrderId}/${randomUUID()}.pdf`;
        const temporaryPath = `_tmp/${workOrderId}/${randomUUID()}.pdf`;
        const uploadedPaths: string[] = [];
        try {
          for (const path of [protectedPath, temporaryPath]) {
            const { error } = await service.storage.from("work-order-pdfs")
              .upload(path, pdfBytes, { contentType: "application/pdf", upsert: false });
            expect(error).toBeNull();
            uploadedPaths.push(path);
          }
          expect((await service.storage.from("work-order-pdfs").download(temporaryPath)).error)
            .toBeNull();

          for (const client of [
            fixture.anonymousClient,
            fixture.actors.permitted.client,
            fixture.actors.admin.client,
          ]) {
            const attemptedPath = `final/${workOrderId}/${randomUUID()}.pdf`;
            expect((await client.storage.from("work-order-pdfs").upload(
              attemptedPath, pdfBytes, { contentType: "application/pdf" },
            )).error).not.toBeNull();
            expect((await client.storage.from("work-order-pdfs").update(
              protectedPath, pdfBytes, { contentType: "application/pdf" },
            )).error).not.toBeNull();
            await client.storage.from("work-order-pdfs").remove([protectedPath]);
            expect((await service.storage.from("work-order-pdfs").download(protectedPath)).error)
              .toBeNull();
          }

          const { error: removeTempError } = await service.storage
            .from("work-order-pdfs").remove([temporaryPath]);
          expect(removeTempError).toBeNull();
          uploadedPaths.splice(uploadedPaths.indexOf(temporaryPath), 1);
        } finally {
          if (uploadedPaths.length > 0) {
            const { error } = await service.storage.from("work-order-pdfs").remove(uploadedPaths);
            expect(error).toBeNull();
          }
        }
      });

      it("keeps Storage reads side-effect free", async () => {
        const fixture = requireHarness();
        const service = createClient(
          environment.supabaseUrl,
          environment.supabaseSecretKey,
          { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } },
        );
        const path = `final/${randomUUID()}/${randomUUID()}.pdf`;
        const { error: uploadError } = await service.storage.from("work-order-pdfs")
          .upload(path, pdfBytes, { contentType: "application/pdf", upsert: false });
        expect(uploadError).toBeNull();
        try {
          await fixture.withRollbackDatabaseTransaction(async (database) => {
            const before = (await database.query(
              `select
                 (select pg_catalog.count(*)::text from public.work_orders) as work_orders,
                 (select pg_catalog.count(*)::text from public.inventory_balances) as balances,
                 (select pg_catalog.count(*)::text from public.inventory_movements) as movements,
                 (select pg_catalog.count(*)::text from public.projects) as projects,
                 (select pg_catalog.count(*)::text from public.audit_logs) as audits`,
            )).rows[0];
            await actAs(database, fixture.actors.admin);
            expect((await database.query(
              `select name from storage.objects
               where bucket_id = 'work-order-pdfs' and name = $1::text`,
              [path],
            )).rows).toEqual([]);
            await database.query("reset role");
            const after = (await database.query(
              `select
                 (select pg_catalog.count(*)::text from public.work_orders) as work_orders,
                 (select pg_catalog.count(*)::text from public.inventory_balances) as balances,
                 (select pg_catalog.count(*)::text from public.inventory_movements) as movements,
                 (select pg_catalog.count(*)::text from public.projects) as projects,
                 (select pg_catalog.count(*)::text from public.audit_logs) as audits`,
            )).rows[0];
            expect(after).toEqual(before);
          });
        } finally {
          const { error } = await service.storage.from("work-order-pdfs").remove([path]);
          expect(error).toBeNull();
        }
      });
    },
  );
}
