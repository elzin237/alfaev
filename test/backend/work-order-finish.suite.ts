import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { PoolClient } from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { loadBackendTestEnvironment } from "./env";
import type { SecurityFixtureHarness } from "./security-fixtures";
import { createTestSerialNumber } from "./helpers/serial";
import {
  actAs,
  createPreflightFixture,
  expectRejected,
  setOnlyRelevantPermission,
} from "./work-order-finish-preflight.suite";

const environment = loadBackendTestEnvironment();
const storageService = createClient(
  environment.supabaseUrl,
  environment.supabaseSecretKey,
  {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  },
);
const task121StoragePaths = new Set<string>();
const pdfBytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n%%EOF\n");

interface FinishResult {
  finished_at: string;
  project_completed: boolean;
  project_id: string;
  work_order_id: string;
  work_order_number: string;
  work_order_pdf_id: string;
}

async function finishWorkOrder(
  database: PoolClient,
  workOrderId: string,
  expectedUpdatedAt: string,
  storageReference: string,
  contentHash: string | null = null,
): Promise<FinishResult> {
  const result = await database.query<FinishResult>(
    `select
       finished.work_order_id,
       finished.work_order_number,
       finished.finished_at::text as finished_at,
       finished.project_id,
       finished.project_completed,
       finished.work_order_pdf_id
     from public.finish_work_order(
       $1::uuid, $2::timestamptz, $3::text, $4::text
     ) as finished`,
    [workOrderId, expectedUpdatedAt, storageReference, contentHash],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Finish Work Order returned no row");
  return row;
}

async function deleteDraftWorkOrder(
  database: PoolClient,
  workOrderId: string,
  expectedUpdatedAt: string,
): Promise<{ work_order_id: string; work_order_number: string }> {
  const result = await database.query<{
    work_order_id: string;
    work_order_number: string;
  }>(
    `select deleted.work_order_id, deleted.work_order_number
     from public.delete_draft_work_order(
       $1::uuid, $2::timestamptz
     ) as deleted`,
    [workOrderId, expectedUpdatedAt],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Delete Draft Work Order returned no row");
  return row;
}

async function insertPreparedPdfObject(
  _database: PoolClient,
  workOrderId: string,
): Promise<string> {
  const reference = `final/${workOrderId}/${randomUUID()}.pdf`;
  const { error } = await storageService.storage.from("work-order-pdfs").upload(
    reference,
    pdfBytes,
    { contentType: "application/pdf", upsert: false },
  );
  if (error) throw new Error(`Task 121 Storage fixture upload failed: ${error.message}`);
  task121StoragePaths.add(reference);
  return reference;
}

async function removeTask121StorageFixtures(): Promise<void> {
  const paths = [...task121StoragePaths];
  if (paths.length === 0) return;
  const { error } = await storageService.storage.from("work-order-pdfs")
    .remove(paths);
  if (error) {
    throw new Error(`Task 121 Storage fixture cleanup failed: ${error.message}`);
  }
  paths.forEach((path) => task121StoragePaths.delete(path));
}

async function nextIsolatedWorkOrderNumber(
  database: PoolClient,
): Promise<string> {
  const result = await database.query<{ work_order_number: string }>(
    `select 'RN-8997-' || pg_catalog.lpad(candidate::text, 4, '0')
       as work_order_number
     from pg_catalog.generate_series(1, 9999) as candidate
     where not exists (
       select 1
       from public.work_orders as work_order
       where work_order.work_order_number =
         'RN-8997-' || pg_catalog.lpad(candidate::text, 4, '0')
     )
     order by candidate
     limit 1`,
  );
  const number = result.rows[0]?.work_order_number;
  if (!number) throw new Error("No isolated Task 121 Work Order number available");
  return number;
}

async function addSiblingDraft(
  database: PoolClient,
  projectId: string,
  actorId: string,
): Promise<{ id: string; updatedAt: string }> {
  const workOrderId = randomUUID();
  await database.query(
    `insert into public.work_orders (
       id, work_order_number, project_id, customer_name_snapshot,
       description, created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, $3::uuid, 'Sibling Customer',
       'Sibling unfinished Work Order', $4::uuid, $4::uuid
     )`,
    [workOrderId, await nextIsolatedWorkOrderNumber(database), projectId, actorId],
  );
  const updatedAt = (await database.query<{ updated_at: string }>(
    `select updated_at::text as updated_at
     from public.work_orders where id = $1::uuid`,
    [workOrderId],
  )).rows[0]?.updated_at;
  if (!updatedAt) throw new Error("Sibling Work Order timestamp unavailable");
  return { id: workOrderId, updatedAt };
}

async function addFinishMaterial(
  database: PoolClient,
  values: {
    actorId: string;
    physicalQuantity: string;
    projectId: string;
    quantity: string;
    requiredQuantity: string;
    workOrderId: string;
  },
): Promise<string> {
  const productId = randomUUID();
  const projectProductId = randomUUID();
  await database.query(
    `insert into public.products (
       id, serial_number, name, category, product_kind,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, $3::text, 'Work Order', 'component',
       $4::uuid, $4::uuid
     )`,
    [
      productId,
      createTestSerialNumber(),
      `Task 121 Product ${productId}`,
      values.actorId,
    ],
  );
  await database.query(
    `update public.inventory_balances
     set quantity = $2::bigint, updated_at = pg_catalog.clock_timestamp()
     where product_id = $1::uuid`,
    [productId, values.physicalQuantity],
  );
  await database.query(
    `insert into public.project_products (
       id, project_id, name, created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::uuid, $3::text, $4::uuid, $4::uuid)`,
    [
      projectProductId,
      values.projectId,
      `Task 121 Group ${projectProductId}`,
      values.actorId,
    ],
  );
  await database.query(
    `insert into public.project_product_components (
       project_product_id, product_id, required_quantity,
       created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::uuid, $3::bigint, $4::uuid, $4::uuid)`,
    [
      projectProductId,
      productId,
      values.requiredQuantity,
      values.actorId,
    ],
  );
  await database.query(
    `insert into public.work_order_items (
       work_order_id, product_id, quantity, added_by_user_id
     ) values ($1::uuid, $2::uuid, $3::bigint, $4::uuid)`,
    [values.workOrderId, productId, values.quantity, values.actorId],
  );
  return productId;
}

async function waitForLockWait(
  observer: PoolClient,
  applicationName: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = (await observer.query<{ waiting: boolean }>(
      `select exists (
         select 1
         from pg_catalog.pg_stat_activity as activity
         where activity.application_name = $1::text
           and activity.wait_event_type = 'Lock'
       ) as waiting`,
      [applicationName],
    )).rows[0]?.waiting;
    if (waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected ${applicationName} to wait on a row lock`);
}

async function cleanupCommittedFixture(
  database: PoolClient,
  state: {
    additionalWorkOrderIds?: string[];
    productId: string;
    projectId: string;
    workOrderId: string;
  },
): Promise<void> {
  const workOrderIds = [
    state.workOrderId,
    ...(state.additionalWorkOrderIds ?? []),
  ];
  const immutableHistory = (await database.query<{
    audits: string;
    movements: string;
    pdfs: string;
  }>(
    `select
       (select pg_catalog.count(*)::text
        from public.audit_logs as audit
        where audit.entity_id in ($1::uuid, $2::uuid)) as audits,
       (select pg_catalog.count(*)::text
        from public.inventory_movements as movement
        where movement.source_type = 'work_order'
          and movement.source_id = $1::uuid) as movements,
       (select pg_catalog.count(*)::text
        from public.work_order_pdfs as pdf
        where pdf.work_order_id = $1::uuid) as pdfs`,
    [state.workOrderId, state.projectId],
  )).rows[0];
  if (
    !immutableHistory
    || immutableHistory.audits !== "0"
    || immutableHistory.movements !== "0"
    || immutableHistory.pdfs !== "0"
  ) {
    throw new Error("Task 121 concurrency fixture created immutable history");
  }

  await database.query("begin");
  try {
    await database.query(
      "delete from public.work_order_items where work_order_id = any($1::uuid[])",
      [workOrderIds],
    );
    await database.query(
      "delete from public.work_orders where id = any($1::uuid[])",
      [workOrderIds],
    );
    await database.query(
      `delete from public.project_product_components
       where project_product_id in (
         select project_product.id
         from public.project_products as project_product
         where project_product.project_id = $1::uuid
       )`,
      [state.projectId],
    );
    await database.query(
      "delete from public.project_products where project_id = $1::uuid",
      [state.projectId],
    );
    await database.query(
      "delete from public.inventory_balances where product_id = $1::uuid",
      [state.productId],
    );
    await database.query(
      "delete from public.products where id = $1::uuid",
      [state.productId],
    );
    await database.query(
      "delete from public.projects where id = $1::uuid",
      [state.projectId],
    );
    await database.query("commit");
  } catch (error) {
    await database.query("rollback");
    throw error;
  }
}

export function registerWorkOrderFinishTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe.skipIf(process.env.TASK121_MIGRATION !== "1")(
    "Task 121 atomic Work Order Finish (requires deployed migration)",
    () => {
      afterEach(async () => {
        await removeTask121StorageFixtures();
      });

      it("allows only active Admin or work_orders.finish and exposes hardened metadata", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const actor = fixture.actors.unpermitted;
          const state = await createPreflightFixture(database, admin.profileId);
          const reference = await insertPreparedPdfObject(database, state.workOrderId);

          for (const permission of [
            null,
            "work_orders.view",
            "work_orders.edit_draft",
            "work_orders.create",
            "work_orders.delete_draft",
            "inventory.view",
            "projects.view",
          ]) {
            await setOnlyRelevantPermission(database, actor, admin.profileId, permission);
            await actAs(database, actor);
            await expectRejected(
              database,
              () => finishWorkOrder(
                database, state.workOrderId, state.updatedAt, reference,
              ),
              "42501",
            );
            await database.query("reset role");
          }

          await setOnlyRelevantPermission(
            database,
            fixture.actors.inactive,
            admin.profileId,
            "work_orders.finish",
          );
          await actAs(database, fixture.actors.inactive);
          await expectRejected(
            database,
            () => finishWorkOrder(
              database, state.workOrderId, state.updatedAt, reference,
            ),
            "42501",
          );
          await database.query("reset role");

          await database.query(
            "select pg_catalog.set_config('request.jwt.claim.sub', '', true)",
          );
          await database.query("set local role anon");
          await expectRejected(
            database,
            () => finishWorkOrder(
              database, state.workOrderId, state.updatedAt, reference,
            ),
            "42501",
          );
          await database.query("reset role");

          await setOnlyRelevantPermission(
            database, actor, admin.profileId, "work_orders.finish",
          );
          await actAs(database, actor);
          expect((await finishWorkOrder(
            database, state.workOrderId, state.updatedAt, reference,
          )).work_order_id).toBe(state.workOrderId);
          await database.query("reset role");

          const metadata = (await database.query(
            `select
               language.lanname as language,
               routine.provolatile as volatility,
               routine.prosecdef as security_definer,
               routine.proconfig as settings,
               pg_catalog.has_function_privilege(
                 'public', routine.oid, 'execute'
               ) as public_execute,
               pg_catalog.has_function_privilege(
                 'anon', routine.oid, 'execute'
               ) as anon_execute,
               pg_catalog.has_function_privilege(
                 'authenticated', routine.oid, 'execute'
               ) as authenticated_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             join pg_catalog.pg_language as language
               on language.oid = routine.prolang
             where namespace.nspname = 'public'
               and routine.proname = 'finish_work_order'`,
          )).rows[0];
          expect(metadata).toEqual({
            anon_execute: false,
            authenticated_execute: true,
            language: "plpgsql",
            public_execute: false,
            security_definer: true,
            settings: ['search_path=""'],
            volatility: "v",
          });
        });
      });

      it("deducts exact stock, finishes once, links one PDF, audits, and completes the final Project", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const state = await createPreflightFixture(database, admin.profileId, {
            itemQuantity: "4",
            physicalQuantity: "10",
            requiredQuantity: "4",
          });
          const secondProductId = await addFinishMaterial(database, {
            actorId: admin.profileId,
            physicalQuantity: "9",
            projectId: state.projectId!,
            quantity: "3",
            requiredQuantity: "3",
            workOrderId: state.workOrderId,
          });
          const reference = await insertPreparedPdfObject(database, state.workOrderId);
          const planningBefore = (await database.query(
            `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(component)
                     order by component.id) as rows
             from public.project_product_components as component
             join public.project_products as project_product
               on project_product.id = component.project_product_id
             where project_product.project_id = $1::uuid`,
            [state.projectId],
          )).rows[0]?.rows;

          await actAs(database, admin);
          const result = await finishWorkOrder(
            database,
            state.workOrderId,
            state.updatedAt,
            reference,
            "a".repeat(64),
          );
          expect(result).toMatchObject({
            project_completed: true,
            project_id: state.projectId,
            work_order_id: state.workOrderId,
            work_order_number: state.workOrderNumber,
          });
          await database.query("reset role");

          expect((await database.query(
            `select
               work_order.status,
               work_order.finished_at::text,
               work_order.updated_at::text,
               work_order.finished_by_user_id,
               work_order.updated_by_user_id
             from public.work_orders as work_order
             where work_order.id = $1::uuid`,
            [state.workOrderId],
          )).rows).toEqual([{
            finished_at: result.finished_at,
            finished_by_user_id: admin.profileId,
            status: "finished",
            updated_at: result.finished_at,
            updated_by_user_id: admin.profileId,
          }]);

          expect((await database.query(
            `select product_id, quantity::text
             from public.inventory_balances
             where product_id in ($1::uuid, $2::uuid)
             order by product_id`,
            [state.productId, secondProductId],
          )).rows).toEqual([
            { product_id: state.productId, quantity: "6" },
            { product_id: secondProductId, quantity: "6" },
          ].sort((left, right) => left.product_id.localeCompare(right.product_id)));
          expect((await database.query(
            `select
               product_id, movement_type, quantity_delta::text, quantity_before::text,
               quantity_after::text, reason, source_type, source_id,
               project_id, actor_user_id
             from public.inventory_movements
             where source_type = 'work_order' and source_id = $1::uuid
             order by product_id`,
            [state.workOrderId],
          )).rows).toEqual([
            {
              actor_user_id: admin.profileId,
              movement_type: "work_order",
              product_id: state.productId,
              project_id: state.projectId,
              quantity_after: "6",
              quantity_before: "10",
              quantity_delta: "-4",
              reason: null,
              source_id: state.workOrderId,
              source_type: "work_order",
            },
            {
              actor_user_id: admin.profileId,
              movement_type: "work_order",
              product_id: secondProductId,
              project_id: state.projectId,
              quantity_after: "6",
              quantity_before: "9",
              quantity_delta: "-3",
              reason: null,
              source_id: state.workOrderId,
              source_type: "work_order",
            },
          ].sort((left, right) => left.product_id.localeCompare(right.product_id)));

          expect((await database.query(
            `select id, storage_reference, generated_at::text,
                    generated_by_user_id, document_version, content_hash
             from public.work_order_pdfs
             where work_order_id = $1::uuid`,
            [state.workOrderId],
          )).rows).toEqual([{
            content_hash: "a".repeat(64),
            document_version: 1,
            generated_at: result.finished_at,
            generated_by_user_id: admin.profileId,
            id: result.work_order_pdf_id,
            storage_reference: reference,
          }]);

          expect((await database.query(
            `select status, completed_at::text, updated_at::text,
                    updated_by_user_id
             from public.projects where id = $1::uuid`,
            [state.projectId],
          )).rows).toEqual([{
            completed_at: result.finished_at,
            status: "completed",
            updated_at: result.finished_at,
            updated_by_user_id: admin.profileId,
          }]);
          expect((await database.query(
            `select action_type, entity_id, actor_user_id
             from public.audit_logs
             where entity_id in ($1::uuid, $2::uuid)
               and action_type in ('work_order.finished', 'project.completed')
             order by action_type`,
            [state.workOrderId, state.projectId],
          )).rows).toEqual([
            {
              action_type: "project.completed",
              actor_user_id: admin.profileId,
              entity_id: state.projectId,
            },
            {
              action_type: "work_order.finished",
              actor_user_id: admin.profileId,
              entity_id: state.workOrderId,
            },
          ]);
          expect((await database.query(
            `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(component)
                     order by component.id) as rows
             from public.project_product_components as component
             join public.project_products as project_product
               on project_product.id = component.project_product_id
             where project_product.project_id = $1::uuid`,
            [state.projectId],
          )).rows[0]?.rows).toEqual(planningBefore);
        });
      });

      it("keeps the Project open when another Draft remains", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const state = await createPreflightFixture(database, admin.profileId);
          await addSiblingDraft(database, state.projectId!, admin.profileId);
          const reference = await insertPreparedPdfObject(database, state.workOrderId);
          await actAs(database, admin);
          const result = await finishWorkOrder(
            database, state.workOrderId, state.updatedAt, reference,
          );
          expect(result.project_completed).toBe(false);
          await database.query("reset role");
          expect((await database.query(
            "select status, completed_at from public.projects where id = $1::uuid",
            [state.projectId],
          )).rows).toEqual([{ completed_at: null, status: "planned" }]);
          expect((await database.query(
            `select pg_catalog.count(*)::text as count
             from public.audit_logs
             where entity_id = $1::uuid and action_type = 'project.completed'`,
            [state.projectId],
          )).rows).toEqual([{ count: "0" }]);
        });
      });

      it("rejects stale, Finished, incomplete, shortage, and invalid PDF inputs without mutation", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const valid = await createPreflightFixture(database, admin.profileId);
          const reference = await insertPreparedPdfObject(database, valid.workOrderId);
          await actAs(database, admin);

          await expectRejected(
            database,
            () => finishWorkOrder(
              database,
              valid.workOrderId,
              "2026-09-29 12:34:56.123455+00",
              reference,
            ),
            "WOR05",
          );
          await expectRejected(
            database,
            () => finishWorkOrder(
              database, valid.workOrderId, valid.updatedAt,
              `_tmp/${valid.workOrderId}/${randomUUID()}.pdf`,
            ),
            "22023",
          );
          await expectRejected(
            database,
            () => finishWorkOrder(
              database, valid.workOrderId, valid.updatedAt,
              `final/${randomUUID()}/${randomUUID()}.pdf`,
            ),
            "22023",
          );
          await expectRejected(
            database,
            () => finishWorkOrder(
              database, valid.workOrderId, valid.updatedAt,
              `final/${valid.workOrderId}/${randomUUID()}.pdf`,
            ),
            "22023",
          );
          await expectRejected(
            database,
            () => finishWorkOrder(
              database, valid.workOrderId, valid.updatedAt, reference,
              "A".repeat(64),
            ),
            "22023",
          );

          const wrongMime = `final/${valid.workOrderId}/${randomUUID()}.pdf`;
          const wrongMimeUpload = await storageService.storage
            .from("work-order-pdfs")
            .upload(wrongMime, pdfBytes, {
              contentType: "text/plain",
              upsert: false,
            });
          expect(wrongMimeUpload.error).not.toBeNull();
          expect(wrongMimeUpload.error?.message).toContain(
            "mime type text/plain is not supported",
          );
          await expectRejected(
            database,
            () => finishWorkOrder(
              database, valid.workOrderId, valid.updatedAt, wrongMime,
            ),
            "22023",
          );

          await database.query("reset role");
          const shortage = await createPreflightFixture(database, admin.profileId, {
            itemQuantity: "4",
            physicalQuantity: "3",
            requiredQuantity: "4",
          });
          const shortageReference = await insertPreparedPdfObject(
            database, shortage.workOrderId,
          );
          await actAs(database, admin);
          await expectRejected(
            database,
            () => finishWorkOrder(
              database,
              shortage.workOrderId,
              shortage.updatedAt,
              shortageReference,
            ),
            "IVB02",
          );

          await database.query("reset role");
          const incomplete = await createPreflightFixture(database, admin.profileId, {
            includeItem: false,
          });
          const incompleteReference = await insertPreparedPdfObject(
            database, incomplete.workOrderId,
          );
          await actAs(database, admin);
          await expectRejected(
            database,
            () => finishWorkOrder(
              database,
              incomplete.workOrderId,
              incomplete.updatedAt,
              incompleteReference,
            ),
            "WOR07",
          );

          await database.query("reset role");
          const alreadyFinished = await createPreflightFixture(database, admin.profileId);
          await database.query(
            `update public.work_orders
             set status = 'finished',
                 finished_at = pg_catalog.clock_timestamp(),
                 finished_by_user_id = $2::uuid
             where id = $1::uuid`,
            [alreadyFinished.workOrderId, admin.profileId],
          );
          const finishedReference = await insertPreparedPdfObject(
            database, alreadyFinished.workOrderId,
          );
          await actAs(database, admin);
          await expectRejected(
            database,
            () => finishWorkOrder(
              database,
              alreadyFinished.workOrderId,
              alreadyFinished.updatedAt,
              finishedReference,
            ),
            "WOR02",
          );
          await database.query("reset role");

          expect((await database.query(
            `select
               (select status from public.work_orders where id = $1::uuid) as status,
               (select quantity::text from public.inventory_balances
                where product_id = $2::uuid) as quantity,
               (select pg_catalog.count(*)::text from public.inventory_movements
                where source_type = 'work_order' and source_id = $1::uuid) as movements,
               (select pg_catalog.count(*)::text from public.work_order_pdfs
                where work_order_id = $1::uuid) as pdfs,
               (select pg_catalog.count(*)::text from public.audit_logs
                where entity_id = $1::uuid and action_type = 'work_order.finished') as audits`,
            [valid.workOrderId, valid.productId],
          )).rows).toEqual([{
            audits: "0",
            movements: "0",
            pdfs: "0",
            quantity: "10",
            status: "draft",
          }]);
        });
      });

      it("rolls back stock, lifecycle, PDF, Project, and history when the Finish audit fails", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const state = await createPreflightFixture(database, admin.profileId);
          const reference = await insertPreparedPdfObject(database, state.workOrderId);
          await database.query(
            `create function public.test_reject_work_order_finish_audit()
             returns trigger
             language plpgsql
             set search_path = ''
             as $function$
             begin
               if new.action_type = 'project.completed' then
                 raise exception 'Rejected Task 121 audit'
                   using errcode = '22023';
               end if;
               return new;
             end;
             $function$`,
          );
          await database.query(
            `create trigger test_reject_work_order_finish_audit
             before insert on public.audit_logs
             for each row
             execute function public.test_reject_work_order_finish_audit()`,
          );

          await actAs(database, admin);
          await expectRejected(
            database,
            () => finishWorkOrder(
              database, state.workOrderId, state.updatedAt, reference,
            ),
            "22023",
          );
          await database.query("reset role");

          expect((await database.query(
            `select
               (select status from public.work_orders where id = $1::uuid) as status,
               (select status from public.projects where id = $2::uuid) as project_status,
               (select quantity::text from public.inventory_balances
                where product_id = $3::uuid) as quantity,
               (select pg_catalog.count(*)::text from public.inventory_movements
                where source_type = 'work_order' and source_id = $1::uuid) as movements,
               (select pg_catalog.count(*)::text from public.work_order_pdfs
                where work_order_id = $1::uuid) as pdfs,
               (select pg_catalog.count(*)::text from public.audit_logs
                where entity_id in ($1::uuid, $2::uuid)
                  and action_type in ('work_order.finished', 'project.completed')) as audits`,
            [state.workOrderId, state.projectId, state.productId],
          )).rows).toEqual([{
            audits: "0",
            movements: "0",
            pdfs: "0",
            project_status: "planned",
            quantity: "10",
            status: "draft",
          }]);
        });
      });

      it("serializes competing Finish calls on the Work Order parent without persistent history", async () => {
        const fixture = requireHarness();
        const admin = fixture.actors.admin;
        const applicationName = `task121-finish-race-${randomUUID()}`;
        await fixture.withDatabaseClients(3, async ([first, second, observer]) => {
          if (!first || !second || !observer) {
            throw new Error("Task 121 concurrency clients unavailable");
          }
          let state: Awaited<ReturnType<typeof createPreflightFixture>> | undefined;
          let storageReference: string | undefined;
          let waitingFinish: Promise<FinishResult> | undefined;
          try {
            await observer.query("begin");
            state = await createPreflightFixture(observer, admin.profileId);
            storageReference = await insertPreparedPdfObject(
              observer, state.workOrderId,
            );
            await observer.query("commit");

            await first.query("begin");
            await actAs(first, admin);
            expect((await finishWorkOrder(
              first, state.workOrderId, state.updatedAt, storageReference,
            )).work_order_id).toBe(state.workOrderId);

            await second.query("begin");
            await second.query(
              "select pg_catalog.set_config('application_name', $1::text, true)",
              [applicationName],
            );
            await actAs(second, admin);
            waitingFinish = finishWorkOrder(
              second, state.workOrderId, state.updatedAt, storageReference,
            );
            await waitForLockWait(observer, applicationName);

            await first.query("rollback");
            expect((await waitingFinish).work_order_id).toBe(state.workOrderId);
            waitingFinish = undefined;
            await second.query("rollback");
          } finally {
            await first.query("rollback").catch(() => undefined);
            await second.query("rollback").catch(() => undefined);
            await waitingFinish?.catch(() => undefined);
            if (state?.projectId && storageReference) {
              await cleanupCommittedFixture(observer, {
                productId: state.productId,
                projectId: state.projectId,
                workOrderId: state.workOrderId,
              });
            }
          }
        });
      });

      it("makes a Project-backed Draft delete wait on the Project serialization row without mutating it", async () => {
        const fixture = requireHarness();
        const admin = fixture.actors.admin;
        const applicationName = `task121-delete-project-${randomUUID()}`;
        await fixture.withDatabaseClients(3, async ([locker, deleter, observer]) => {
          if (!locker || !deleter || !observer) {
            throw new Error("Task 121 delete-lock clients unavailable");
          }
          let state: Awaited<ReturnType<typeof createPreflightFixture>> | undefined;
          let sibling: Awaited<ReturnType<typeof addSiblingDraft>> | undefined;
          let storageReference: string | undefined;
          let waitingDelete: Promise<{
            work_order_id: string;
            work_order_number: string;
          }> | undefined;
          try {
            await observer.query("begin");
            state = await createPreflightFixture(observer, admin.profileId);
            sibling = await addSiblingDraft(
              observer, state.projectId!, admin.profileId,
            );
            storageReference = await insertPreparedPdfObject(
              observer, state.workOrderId,
            );
            await observer.query("commit");
            const projectBefore = (await observer.query(
              `select pg_catalog.to_jsonb(project) as value
               from public.projects as project where project.id = $1::uuid`,
              [state.projectId],
            )).rows[0]?.value;

            await locker.query("begin");
            await locker.query(
              "select id from public.projects where id = $1::uuid for update",
              [state.projectId],
            );

            await deleter.query("begin");
            await deleter.query(
              "select pg_catalog.set_config('application_name', $1::text, true)",
              [applicationName],
            );
            await actAs(deleter, admin);
            waitingDelete = deleteDraftWorkOrder(
              deleter, sibling.id, sibling.updatedAt,
            );
            await waitForLockWait(observer, applicationName);

            await locker.query("rollback");
            expect((await waitingDelete).work_order_id).toBe(sibling.id);
            waitingDelete = undefined;
            await deleter.query("rollback");

            expect((await observer.query(
              `select pg_catalog.to_jsonb(project) as value
               from public.projects as project where project.id = $1::uuid`,
              [state.projectId],
            )).rows[0]?.value).toEqual(projectBefore);
          } finally {
            await locker.query("rollback").catch(() => undefined);
            await deleter.query("rollback").catch(() => undefined);
            await waitingDelete?.catch(() => undefined);
            if (state?.projectId && sibling && storageReference) {
              await cleanupCommittedFixture(observer, {
                additionalWorkOrderIds: [sibling.id],
                productId: state.productId,
                projectId: state.projectId,
                workOrderId: state.workOrderId,
              });
            }
          }
        });
      });

      it("serializes Finish and deletion of a different Draft on the same Project without deadlock", async () => {
        const fixture = requireHarness();
        const admin = fixture.actors.admin;
        const applicationName = `task121-finish-delete-${randomUUID()}`;
        await fixture.withDatabaseClients(3, async ([finisher, deleter, observer]) => {
          if (!finisher || !deleter || !observer) {
            throw new Error("Task 121 Finish/delete clients unavailable");
          }
          let state: Awaited<ReturnType<typeof createPreflightFixture>> | undefined;
          let sibling: Awaited<ReturnType<typeof addSiblingDraft>> | undefined;
          let storageReference: string | undefined;
          let waitingDelete: Promise<{
            work_order_id: string;
            work_order_number: string;
          }> | undefined;
          try {
            await observer.query("begin");
            state = await createPreflightFixture(observer, admin.profileId);
            sibling = await addSiblingDraft(
              observer, state.projectId!, admin.profileId,
            );
            storageReference = await insertPreparedPdfObject(
              observer, state.workOrderId,
            );
            await observer.query("commit");

            await finisher.query("begin");
            await actAs(finisher, admin);
            expect((await finishWorkOrder(
              finisher,
              state.workOrderId,
              state.updatedAt,
              storageReference,
            )).project_completed).toBe(false);

            await deleter.query("begin");
            await deleter.query(
              "select pg_catalog.set_config('application_name', $1::text, true)",
              [applicationName],
            );
            await actAs(deleter, admin);
            waitingDelete = deleteDraftWorkOrder(
              deleter, sibling.id, sibling.updatedAt,
            );
            await waitForLockWait(observer, applicationName);

            await finisher.query("rollback");
            expect((await waitingDelete).work_order_id).toBe(sibling.id);
            waitingDelete = undefined;
            await deleter.query("rollback");

            expect((await observer.query(
              `select id, status from public.work_orders
               where id in ($1::uuid, $2::uuid) order by id`,
              [state.workOrderId, sibling.id],
            )).rows).toEqual([
              { id: state.workOrderId, status: "draft" },
              { id: sibling.id, status: "draft" },
            ].sort((left, right) => left.id.localeCompare(right.id)));
            expect((await observer.query(
              "select status from public.projects where id = $1::uuid",
              [state.projectId],
            )).rows).toEqual([{ status: "planned" }]);
          } finally {
            await finisher.query("rollback").catch(() => undefined);
            await deleter.query("rollback").catch(() => undefined);
            await waitingDelete?.catch(() => undefined);
            if (state?.projectId && sibling && storageReference) {
              await cleanupCommittedFixture(observer, {
                additionalWorkOrderIds: [sibling.id],
                productId: state.productId,
                projectId: state.projectId,
                workOrderId: state.workOrderId,
              });
            }
          }
        });
      });

      it.todo(
        "proves a committed Finish winner rejects concurrent Save/Delete/Finish without retaining immutable shared-dev history (disposable database)",
      );
      it.todo(
        "proves a committed same-Project Draft delete makes the waiting final Finish complete the Project (disposable database)",
      );
      it.todo(
        "proves committed same-Project final finishes cannot complete prematurely (disposable database)",
      );
      it.todo(
        "proves committed different-Project finishes sharing Inventory cannot overspend (disposable database)",
      );
    },
  );
}
