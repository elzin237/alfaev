import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { PoolClient, QueryResultRow } from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { loadBackendTestEnvironment } from "./env";
import { createTestSerialNumber } from "./helpers/serial";
import {
  assertInventorySourceInvariant,
  createSupplierSourceFixture,
  getWorkOrderAllocationFingerprint,
} from "./helpers/inventory-provenance";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";
import {
  actAs,
  createPreflightFixture,
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
const storagePaths = new Set<string>();
const originalPdfBytes = new TextEncoder().encode("%PDF-1.4\nTask 149 canonical\n%%EOF\n");
const replacementPdfBytes = new TextEncoder().encode("%PDF-1.4\nTask 149 forged\n%%EOF\n");
let savepointSequence = 0;

async function expectSqlRejected(
  database: PoolClient,
  operation: () => Promise<unknown>,
  code: string,
): Promise<void> {
  savepointSequence += 1;
  const savepoint = `task149_rejected_${savepointSequence}`;
  await database.query(`savepoint ${savepoint}`);
  await expect(operation()).rejects.toMatchObject({ code });
  await database.query(`rollback to savepoint ${savepoint}`);
}

async function actAsAnonymous(database: PoolClient): Promise<void> {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', '', true)",
  );
  await database.query("set local role anon");
}

async function resetRole(database: PoolClient): Promise<void> {
  await database.query("reset role");
}

async function uploadPdf(workOrderId: string): Promise<string> {
  const path = `final/${workOrderId}/${randomUUID()}.pdf`;
  const { error } = await storageService.storage.from("work-order-pdfs").upload(
    path,
    originalPdfBytes,
    { contentType: "application/pdf", upsert: false },
  );
  if (error) throw new Error(`Task 149 PDF upload failed: ${error.message}`);
  storagePaths.add(path);
  return path;
}

async function removeStorageFixtures(): Promise<void> {
  const paths = [...storagePaths];
  if (paths.length === 0) return;
  const { error } = await storageService.storage.from("work-order-pdfs").remove(paths);
  if (error) throw new Error(`Task 149 PDF cleanup failed: ${error.message}`);
  paths.forEach((path) => storagePaths.delete(path));
}

async function nextWorkOrderNumber(database: PoolClient): Promise<string> {
  const row = (await database.query<{ work_order_number: string }>(
    `select 'RN-8993-' || pg_catalog.lpad(candidate::text, 4, '0') as work_order_number
     from pg_catalog.generate_series(1, 9999) as candidate
     where not exists (
       select 1 from public.work_orders as work_order
       where work_order.work_order_number =
         'RN-8993-' || pg_catalog.lpad(candidate::text, 4, '0')
     )
     order by candidate
     limit 1`,
  )).rows[0];
  if (!row) throw new Error("Task 149 Work Order number unavailable");
  return row.work_order_number;
}

async function createProduct(
  database: PoolClient,
  actorId: string,
  kind: "component" | "pcb_finished_good" = "component",
): Promise<{ id: string; serialNumber: string }> {
  const id = randomUUID();
  const serialNumber = createTestSerialNumber();
  await database.query(
    `insert into public.products (
       id, serial_number, name, category, product_kind,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, $3::text, 'Task 149', $4::text,
       $5::uuid, $5::uuid
     )`,
    [id, serialNumber, `Task 149 Product ${id}`, kind, actorId],
  );
  return { id, serialNumber };
}

async function finishWorkOrder(
  database: PoolClient,
  actor: SecurityActor,
  workOrderId: string,
  expectedUpdatedAt: string,
  storageReference: string,
): Promise<{ work_order_pdf_id: string }> {
  await actAs(database, actor);
  const row = (await database.query<{ work_order_pdf_id: string }>(
    `select finished.work_order_pdf_id
     from public.finish_work_order(
       $1::uuid, $2::timestamptz, $3::text, null::text, $4::text
     ) as finished`,
    [
      workOrderId,
      expectedUpdatedAt,
      storageReference,
      await getWorkOrderAllocationFingerprint(database, workOrderId),
    ],
  )).rows[0];
  if (!row) throw new Error("Task 149 Finish returned no row");
  await resetRole(database);
  return row;
}

async function snapshotFinishedArtifacts(
  database: PoolClient,
  workOrderId: string,
): Promise<Record<string, unknown>> {
  const row = (await database.query<Record<string, unknown>>(
    `select
       pg_catalog.to_jsonb(work_order) as work_order,
       coalesce((
         select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item) order by item.id)
         from public.work_order_items as item
         where item.work_order_id = work_order.id
       ), '[]'::jsonb) as items,
       coalesce((
         select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(pdf) order by pdf.id)
         from public.work_order_pdfs as pdf
         where pdf.work_order_id = work_order.id
       ), '[]'::jsonb) as pdfs,
       coalesce((
         select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(movement) order by movement.id)
         from public.inventory_movements as movement
         where movement.source_type = 'work_order'
           and movement.source_id = work_order.id
       ), '[]'::jsonb) as movements
     from public.work_orders as work_order
     where work_order.id = $1::uuid`,
    [workOrderId],
  )).rows[0];
  if (!row) throw new Error("Task 149 Finished snapshot unavailable");
  return row;
}

export function registerHistoricalImmutabilityAuditTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 149 historical immutability audit", () => {
    afterEach(async () => {
      await removeStorageFixtures();
    });

    it.skipIf(process.env.SUPPLIER_PROVENANCE_MIGRATIONS !== "1")(
      "keeps Supplier lot snapshots and outbound allocations immutable after source edits and archival",
      async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const product = await createProduct(database, admin.profileId);
          const source = await createSupplierSourceFixture(database, admin, product.id, {
            catalogNumber: "TASK149-CATALOG-OLD",
            description: "Task 149 original source description",
            supplierName: "Task 149 Original Supplier",
          });

          await actAs(database, admin);
          const inboundMovementId = (await database.query<{ movement_id: string }>(
            `select movement_id
             from public.manual_adjust_inventory(
               $1::uuid, 'add', 5::bigint, 'Task 149 immutable source lot', $2::uuid
             )`,
            [product.id, source.productSupplierId],
          )).rows[0]?.movement_id;
          await resetRole(database);
          if (!inboundMovementId) throw new Error("Task 149 source movement unavailable");

          await actAs(database, admin);
          await database.query(
            "select public.update_product_supplier($1::uuid, $2::text, $3::text)",
            [
              source.productSupplierId,
              "TASK149-CATALOG-NEW",
              "Task 149 changed source description",
            ],
          );
          await database.query(
            `select public.update_supplier(
               $1::uuid, 'Task 149 Renamed Supplier', 'Bosnia and Herzegovina',
               null, null, null
             )`,
            [source.supplierId],
          );
          await database.query(
            "select public.archive_product_supplier($1::uuid)",
            [source.productSupplierId],
          );
          await resetRole(database);

          await actAs(database, admin);
          const outboundMovementId = (await database.query<{ movement_id: string }>(
            `select movement_id
             from public.manual_adjust_inventory(
               $1::uuid, 'remove', 2::bigint, 'Task 149 immutable allocation', null
             )`,
            [product.id],
          )).rows[0]?.movement_id;
          await resetRole(database);
          if (!outboundMovementId) throw new Error("Task 149 allocation movement unavailable");

          const lot = (await database.query<{
            catalog_number_snapshot: string;
            id: string;
            remaining_quantity: string;
            source_kind: string;
            supplier_description_snapshot: string;
            supplier_name_snapshot: string;
          }>(
            `select id, source_kind, supplier_name_snapshot,
                    catalog_number_snapshot, supplier_description_snapshot,
                    remaining_quantity::text
             from public.inventory_source_lots
             where originating_inventory_movement_id = $1::uuid`,
            [inboundMovementId],
          )).rows[0];
          expect(lot).toMatchObject({
            catalog_number_snapshot: "TASK149-CATALOG-OLD",
            remaining_quantity: "3",
            source_kind: "supplier",
            supplier_description_snapshot: "Task 149 original source description",
            supplier_name_snapshot: "Task 149 Original Supplier",
          });
          expect((await database.query(
            `select catalog_number, description, is_active
             from public.product_suppliers where id = $1::uuid`,
            [source.productSupplierId],
          )).rows).toEqual([{
            catalog_number: "TASK149-CATALOG-NEW",
            description: "Task 149 changed source description",
            is_active: false,
          }]);
          expect((await database.query<{ allocated_quantity: string; id: string }>(
            `select id, allocated_quantity::text
             from public.inventory_source_allocations
             where outbound_inventory_movement_id = $1::uuid`,
            [outboundMovementId],
          )).rows).toEqual([expect.objectContaining({ allocated_quantity: "2" })]);

          const allocationId = (await database.query<{ id: string }>(
            `select id from public.inventory_source_allocations
             where outbound_inventory_movement_id = $1::uuid`,
            [outboundMovementId],
          )).rows[0]?.id;
          if (!lot?.id || !allocationId) throw new Error("Task 149 provenance rows unavailable");
          await expectSqlRejected(
            database,
            () => database.query(
              `update public.inventory_source_lots
               set catalog_number_snapshot = 'FORGED' where id = $1::uuid`,
              [lot.id],
            ),
            "IVL01",
          );
          await expectSqlRejected(
            database,
            () => database.query(
              `update public.inventory_source_allocations
               set allocated_quantity = allocated_quantity where id = $1::uuid`,
              [allocationId],
            ),
            "IVL01",
          );
          await expectSqlRejected(
            database,
            () => database.query(
              "delete from public.inventory_source_allocations where id = $1::uuid",
              [allocationId],
            ),
            "IVL01",
          );
          await assertInventorySourceInvariant(database, product.id);
        });
      },
    );

    it("keeps AuditLog and InventoryMovement append-only across every browser actor and privileged row attacks", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const state = await createPreflightFixture(database, fixture.actors.admin.profileId, {
          itemQuantity: "2",
          physicalQuantity: "5",
          requiredQuantity: "2",
        });

        await actAs(database, fixture.actors.admin);
        const movementId = (await database.query<{ movement_id: string }>(
          `select adjusted.movement_id
           from public.manual_adjust_inventory(
             $1::uuid, 'add'::text, 1::bigint,
             'Task 149 positive control'::text,
             (select relationship.id from public.product_suppliers as relationship
              where relationship.product_id = $1::uuid and relationship.is_active
              order by relationship.created_at, relationship.id limit 1)
           ) as adjusted`,
          [state.productId],
        )).rows[0]?.movement_id;
        await resetRole(database);
        if (!movementId) throw new Error("Task 149 movement positive control failed");
        const auditId = (await database.query<{ id: string }>(
          `select id from public.audit_logs
           where action_type = 'inventory.manual_adjusted'
             and entity_id = $1::uuid
           order by created_at desc, id desc
           limit 1`,
          [state.productId],
        )).rows[0]?.id;
        if (!auditId) throw new Error("Task 149 audit positive control failed");

        const baseline = (await database.query<Record<string, unknown>>(
          `select
             (select pg_catalog.to_jsonb(audit) from public.audit_logs as audit
              where audit.id = $1::uuid) as audit,
             (select pg_catalog.to_jsonb(movement) from public.inventory_movements as movement
              where movement.id = $2::uuid) as movement,
             (select quantity::text from public.inventory_balances
              where product_id = $3::uuid) as balance`,
          [auditId, movementId, state.productId],
        )).rows;

        for (const actor of [
          fixture.actors.admin,
          fixture.actors.unpermitted,
          fixture.actors.inactive,
        ]) {
          await actAs(database, actor);
          await expectSqlRejected(database, () => database.query(
            `insert into public.audit_logs (
               actor_user_id, action_type, entity_type, entity_id, summary,
               before_data, after_data, metadata, created_at
             ) values (
               $1::uuid, 'user.promoted', 'user_profile', $1::uuid,
               'Forged privileged history', '{}'::jsonb, '{}'::jsonb,
               '{}'::jsonb, '2000-01-01'::timestamptz
             )`,
            [actor.profileId],
          ), "42501");
          await expectSqlRejected(database, () => database.query(
            `update public.audit_logs
             set actor_user_id = $2::uuid,
                 action_type = 'forged', entity_type = 'forged', entity_id = $2::uuid,
                 summary = 'Forged', before_data = '{}'::jsonb,
                 after_data = '{}'::jsonb, metadata = '{}'::jsonb,
                 created_at = '2000-01-01'::timestamptz
             where id = $1::uuid`,
            [auditId, actor.profileId],
          ), "42501");
          await expectSqlRejected(database, () => database.query(
            "delete from public.audit_logs where id = $1::uuid",
            [auditId],
          ), "42501");
          await expectSqlRejected(database, () => database.query(
            `select public.append_audit_log(
               'forged', 'forged', 'Forged audit', $1::uuid,
               '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
             )`,
            [actor.profileId],
          ), "42501");

          await expectSqlRejected(database, () => database.query(
            `insert into public.inventory_movements (
               product_id, movement_type, quantity_delta, quantity_before,
               quantity_after, reason, source_type, source_id, project_id,
               actor_user_id, reversal_of_movement_id
             ) values (
               $1::uuid, 'work_order', -1, 6, 5, 'Forged', 'work_order',
               $2::uuid, $3::uuid, $4::uuid, null
             )`,
            [state.productId, state.workOrderId, state.projectId, actor.profileId],
          ), "42501");
          await expectSqlRejected(database, () => database.query(
            `update public.inventory_movements
             set quantity_delta = -99, quantity_before = 99, quantity_after = 0,
                 source_type = 'pcb_production_input', source_id = $2::uuid,
                 project_id = null, actor_user_id = $3::uuid,
                 reversal_of_movement_id = $1::uuid
             where id = $1::uuid`,
            [movementId, randomUUID(), actor.profileId],
          ), "42501");
          await expectSqlRejected(database, () => database.query(
            "delete from public.inventory_movements where id = $1::uuid",
            [movementId],
          ), "42501");
          await expectSqlRejected(database, () => database.query(
            `select * from public.apply_inventory_delta(
               $1::uuid, 1::bigint, 'manual_add'::text,
               'Forged'::text, 'manual_adjustment'::text,
               null::uuid, null::uuid, null::uuid
             )`,
            [state.productId],
          ), "42501");
          await resetRole(database);
        }

        await actAsAnonymous(database);
        await expectSqlRejected(database, () => database.query(
          "delete from public.audit_logs where id = $1::uuid",
          [auditId],
        ), "42501");
        await expectSqlRejected(database, () => database.query(
          "delete from public.inventory_movements where id = $1::uuid",
          [movementId],
        ), "42501");
        await resetRole(database);

        for (const operation of [
          () => database.query(
            "update public.audit_logs set summary = 'Changed' where id = $1::uuid",
            [auditId],
          ),
          () => database.query("delete from public.audit_logs where id = $1::uuid", [auditId]),
          () => database.query(
            "update public.inventory_movements set reason = 'Changed' where id = $1::uuid",
            [movementId],
          ),
          () => database.query(
            "delete from public.inventory_movements where id = $1::uuid",
            [movementId],
          ),
        ]) {
          await expectSqlRejected(database, operation, "55000");
        }

        expect((await database.query<Record<string, unknown>>(
          `select
             (select pg_catalog.to_jsonb(audit) from public.audit_logs as audit
              where audit.id = $1::uuid) as audit,
             (select pg_catalog.to_jsonb(movement) from public.inventory_movements as movement
              where movement.id = $2::uuid) as movement,
             (select quantity::text from public.inventory_balances
              where product_id = $3::uuid) as balance`,
          [auditId, movementId, state.productId],
        )).rows).toEqual(baseline);
      });
    });

    it("keeps Finished Work Order headers, materials, movements, PDF metadata, and bytes permanent", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const admin = fixture.actors.admin;
        const state = await createPreflightFixture(database, admin.profileId, {
          itemQuantity: "2",
          physicalQuantity: "5",
          requiredQuantity: "2",
        });
        const itemQuantity = (await database.query<{ quantity: string }>(
          "select quantity::text as quantity from public.work_order_items where work_order_id = $1::uuid",
          [state.workOrderId],
        )).rows[0]?.quantity;
        if (!itemQuantity) throw new Error("Task 149 Draft material unavailable");

        await actAs(database, admin);
        const saved = (await database.query<{ updated_at: string }>(
          `select saved.updated_at::text as updated_at
           from public.save_draft_work_order(
             $1::uuid, $2::uuid, 'Task 149 saved Draft'::text,
             $3::jsonb, $4::timestamptz
           ) as saved`,
          [
            state.workOrderId,
            state.projectId,
            JSON.stringify([{ product_id: state.productId, quantity: itemQuantity }]),
            state.updatedAt,
          ],
        )).rows[0];
        await resetRole(database);
        if (!saved) throw new Error("Task 149 Draft positive control failed");

        const officialPath = await uploadPdf(state.workOrderId);
        const secondPath = await uploadPdf(state.workOrderId);
        const finished = await finishWorkOrder(
          database,
          admin,
          state.workOrderId,
          saved.updated_at,
          officialPath,
        );
        const itemId = (await database.query<{ id: string }>(
          "select id from public.work_order_items where work_order_id = $1::uuid",
          [state.workOrderId],
        )).rows[0]!.id;
        const movementId = (await database.query<{ id: string }>(
          `select id from public.inventory_movements
           where source_type = 'work_order' and source_id = $1::uuid`,
          [state.workOrderId],
        )).rows[0]!.id;
        const finishedUpdatedAt = (await database.query<{ updated_at: string }>(
          "select updated_at::text as updated_at from public.work_orders where id = $1::uuid",
          [state.workOrderId],
        )).rows[0]!.updated_at;
        const baseline = await snapshotFinishedArtifacts(database, state.workOrderId);
        const replacementProduct = await createProduct(database, admin.profileId);
        const replacementWorkOrderNumber = await nextWorkOrderNumber(database);

        await expectSqlRejected(database, () => database.query(
          "update public.work_orders set project_id = null where id = $1::uuid",
          [state.workOrderId],
        ), "WOR07");
        for (const operation of [
          () => database.query(
            "update public.work_orders set customer_name_snapshot = 'Changed' where id = $1::uuid",
            [state.workOrderId],
          ),
          () => database.query(
            "update public.work_orders set description = 'Changed' where id = $1::uuid",
            [state.workOrderId],
          ),
          () => database.query(
            "update public.work_orders set status = 'draft' where id = $1::uuid",
            [state.workOrderId],
          ),
          () => database.query(
            "update public.work_orders set finished_at = null where id = $1::uuid",
            [state.workOrderId],
          ),
          () => database.query(
            "update public.work_orders set finished_by_user_id = null where id = $1::uuid",
            [state.workOrderId],
          ),
          () => database.query(
            `update public.work_orders
             set updated_at = updated_at + interval '1 second',
                 updated_by_user_id = $2::uuid
             where id = $1::uuid`,
            [state.workOrderId, fixture.actors.unpermitted.profileId],
          ),
          () => database.query(
            "update public.work_orders set work_order_number = $2::text where id = $1::uuid",
            [state.workOrderId, replacementWorkOrderNumber],
          ),
          () => database.query("delete from public.work_orders where id = $1::uuid", [state.workOrderId]),
        ]) {
          await expectSqlRejected(database, operation, "WOR02");
        }

        for (const operation of [
          () => database.query(
            `insert into public.work_order_items (
               work_order_id, product_id, quantity, added_by_user_id
             ) values ($1::uuid, $2::uuid, 1, $3::uuid)`,
            [state.workOrderId, replacementProduct.id, admin.profileId],
          ),
          () => database.query(
            "update public.work_order_items set product_id = $2::uuid where id = $1::uuid",
            [itemId, replacementProduct.id],
          ),
          () => database.query(
            "update public.work_order_items set quantity = quantity + 1 where id = $1::uuid",
            [itemId],
          ),
          () => database.query(
            "update public.work_order_items set source_type = 'pcb_bom' where id = $1::uuid",
            [itemId],
          ),
          () => database.query("delete from public.work_order_items where id = $1::uuid", [itemId]),
        ]) {
          await expectSqlRejected(database, operation, "WOR04");
        }

        for (const [column, value] of [
          ["storage_reference", secondPath],
          ["content_hash", "a".repeat(64)],
          ["document_version", 2],
          ["generated_by_user_id", fixture.actors.unpermitted.profileId],
        ] as const) {
          await expectSqlRejected(database, () => database.query(
            `update public.work_order_pdfs set ${column} = $2 where id = $1::uuid`,
            [finished.work_order_pdf_id, value],
          ), "WOR09");
        }
        await expectSqlRejected(database, () => database.query(
          `update public.work_order_pdfs
           set generated_at = generated_at + interval '1 second'
           where id = $1::uuid`,
          [finished.work_order_pdf_id],
        ), "WOR09");
        await expectSqlRejected(database, () => database.query(
          "delete from public.work_order_pdfs where id = $1::uuid",
          [finished.work_order_pdf_id],
        ), "WOR09");
        await expectSqlRejected(database, () => database.query(
          `insert into public.work_order_pdfs (
             work_order_id, storage_reference, generated_at, generated_by_user_id
           ) values ($1::uuid, $2::text, pg_catalog.now(), $3::uuid)`,
          [state.workOrderId, secondPath, admin.profileId],
        ), "23505");

        await expectSqlRejected(database, () => database.query(
          "update public.inventory_movements set quantity_delta = -99 where id = $1::uuid",
          [movementId],
        ), "55000");
        await expectSqlRejected(database, () => database.query(
          "delete from public.inventory_movements where id = $1::uuid",
          [movementId],
        ), "55000");

        await actAs(database, admin);
        await expectSqlRejected(database, () => database.query(
          "update public.work_orders set description = 'Browser forged' where id = $1::uuid",
          [state.workOrderId],
        ), "42501");
        await expectSqlRejected(database, () => database.query(
          "update public.work_order_items set quantity = 99 where id = $1::uuid",
          [itemId],
        ), "42501");
        await expectSqlRejected(database, () => database.query(
          "update public.work_order_pdfs set content_hash = null where id = $1::uuid",
          [finished.work_order_pdf_id],
        ), "42501");
        await expectSqlRejected(database, () => database.query(
          `select * from public.save_draft_work_order(
             $1::uuid, $2::uuid, 'Changed'::text, $3::jsonb, $4::timestamptz
           )`,
          [
            state.workOrderId,
            state.projectId,
            JSON.stringify([{ product_id: state.productId, quantity: itemQuantity }]),
            finishedUpdatedAt,
          ],
        ), "WOR02");
        await expectSqlRejected(database, () => database.query(
          "select * from public.delete_draft_work_order($1::uuid, $2::timestamptz)",
          [state.workOrderId, finishedUpdatedAt],
        ), "WOR02");
        await expectSqlRejected(database, () => database.query(
          `select * from public.finish_work_order(
             $1::uuid, $2::timestamptz, $3::text, null::text, $4::text
           )`,
          [state.workOrderId, finishedUpdatedAt, secondPath, "0".repeat(32)],
        ), "WOR02");
        await resetRole(database);

        const browserStorage = admin.client.storage.from("work-order-pdfs");
        expect((await browserStorage.upload(officialPath, replacementPdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        })).error).not.toBeNull();
        const forgedPath = `final/${state.workOrderId}/${randomUUID()}.pdf`;
        expect((await browserStorage.upload(forgedPath, replacementPdfBytes, {
          contentType: "application/pdf",
          upsert: false,
        })).error).not.toBeNull();

        const { data: downloaded, error: downloadError } = await storageService.storage
          .from("work-order-pdfs")
          .download(officialPath);
        expect(downloadError).toBeNull();
        expect(new Uint8Array(await downloaded!.arrayBuffer())).toEqual(originalPdfBytes);
        expect(await snapshotFinishedArtifacts(database, state.workOrderId)).toEqual(baseline);
      });
    });

    it("keeps used BOM definitions, frozen PCB context, and completed production history immutable", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const admin = fixture.actors.admin;
        const input = await createProduct(database, admin.profileId);
        const replacement = await createProduct(database, admin.profileId);
        const output = await createProduct(database, admin.profileId, "pcb_finished_good");
        const cardId = randomUUID();
        const versionId = randomUUID();
        await database.query(
          `insert into public.pcb_cards (
             id, name, output_product_id, created_by_user_id, updated_by_user_id
           ) values ($1::uuid, $2::text, $3::uuid, $4::uuid, $4::uuid)`,
          [cardId, `Task 149 PCB ${cardId}`, output.id, admin.profileId],
        );
        await database.query(
          `insert into public.pcb_bom_versions (
             id, pcb_card_id, version_number, created_by_user_id
           ) values ($1::uuid, $2::uuid, 1, $3::uuid)`,
          [versionId, cardId, admin.profileId],
        );
        const bomItemId = (await database.query<{ id: string }>(
          `insert into public.pcb_bom_items (
             bom_version_id, component_product_id, quantity_per_card
           ) values ($1::uuid, $2::uuid, 2) returning id`,
          [versionId, input.id],
        )).rows[0]!.id;
        await actAs(database, admin);
        const workOrderId = (await database.query<{ work_order_id: string }>(
          `select created.work_order_id
           from public.create_pcb_production_work_order(
             $1::uuid, '1'::text, null::uuid, $2::uuid
           ) as created`,
          [cardId, randomUUID()],
        )).rows[0]?.work_order_id;
        await resetRole(database);
        if (!workOrderId) throw new Error("Task 149 PCB Draft positive control failed");
        const workOrderItemId = (await database.query<{ id: string }>(
          `select id from public.work_order_items
           where work_order_id = $1::uuid and source_type = 'pcb_bom'`,
          [workOrderId],
        )).rows[0]!.id;
        const initialUpdatedAt = (await database.query<{ updated_at: string }>(
          "select updated_at::text as updated_at from public.work_orders where id = $1::uuid",
          [workOrderId],
        )).rows[0]!.updated_at;
        await actAs(database, admin);
        await database.query(
          `select * from public.save_pcb_production_supplemental_materials(
             $1::uuid, $2::jsonb, $3::timestamptz
           )`,
          [
            workOrderId,
            JSON.stringify([{ product_id: replacement.id, quantity: "1" }]),
            initialUpdatedAt,
          ],
        );
        await resetRole(database);
        const supplementalItemId = (await database.query<{ id: string }>(
          `select id from public.work_order_items
           where work_order_id = $1::uuid and source_type = 'manual'`,
          [workOrderId],
        )).rows[0]!.id;

        for (const operation of [
          () => database.query(
            "update public.work_order_items set quantity = 3 where id = $1::uuid",
            [workOrderItemId],
          ),
          () => database.query(
            "update public.work_order_items set source_type = 'manual' where id = $1::uuid",
            [workOrderItemId],
          ),
          () => database.query(
            "delete from public.work_order_items where id = $1::uuid",
            [workOrderItemId],
          ),
        ]) {
          await expectSqlRejected(database, operation, "PCB12");
        }
        await database.query(
          `update public.work_orders
           set status = 'finished', finished_at = pg_catalog.now(),
               finished_by_user_id = $2::uuid, updated_at = pg_catalog.now(),
               updated_by_user_id = $2::uuid
           where id = $1::uuid`,
          [workOrderId, admin.profileId],
        );
        const runId = (await database.query<{ id: string }>(
          `insert into public.pcb_production_runs (
             pcb_card_id, bom_version_id, quantity_produced,
             produced_by_user_id, work_order_id
           ) values ($1::uuid, $2::uuid, 1, $3::uuid, $4::uuid)
           returning id`,
          [cardId, versionId, admin.profileId, workOrderId],
        )).rows[0]!.id;

        const baseline = (await database.query<Record<string, unknown>>(
          `select
             (select pg_catalog.to_jsonb(version) from public.pcb_bom_versions as version
              where version.id = $1::uuid) as version,
             (select pg_catalog.to_jsonb(item) from public.pcb_bom_items as item
              where item.id = $2::uuid) as bom_item,
             (select pg_catalog.to_jsonb(context) from public.pcb_production_work_orders as context
              where context.work_order_id = $3::uuid) as context,
             (select pg_catalog.to_jsonb(item) from public.work_order_items as item
              where item.id = $4::uuid) as work_order_item,
             (select pg_catalog.to_jsonb(item) from public.work_order_items as item
              where item.id = $6::uuid) as supplemental_item,
             (select pg_catalog.to_jsonb(run) from public.pcb_production_runs as run
              where run.id = $5::uuid) as run`,
          [versionId, bomItemId, workOrderId, workOrderItemId, runId, supplementalItemId],
        )).rows;

        for (const operation of [
          () => database.query(
            "update public.pcb_bom_versions set version_number = 2 where id = $1::uuid",
            [versionId],
          ),
          () => database.query(
            "update public.pcb_bom_versions set created_at = created_at + interval '1 second' where id = $1::uuid",
            [versionId],
          ),
          () => database.query(
            "update public.pcb_bom_versions set is_active = is_active where id = $1::uuid",
            [versionId],
          ),
          () => database.query("delete from public.pcb_bom_versions where id = $1::uuid", [versionId]),
          () => database.query(
            `insert into public.pcb_bom_items (
               bom_version_id, component_product_id, quantity_per_card
             ) values ($1::uuid, $2::uuid, 1)`,
            [versionId, replacement.id],
          ),
          () => database.query(
            "update public.pcb_bom_items set component_product_id = $2::uuid where id = $1::uuid",
            [bomItemId, replacement.id],
          ),
          () => database.query(
            "update public.pcb_bom_items set quantity_per_card = 9 where id = $1::uuid",
            [bomItemId],
          ),
          () => database.query("delete from public.pcb_bom_items where id = $1::uuid", [bomItemId]),
        ]) {
          await expectSqlRejected(database, operation, "PCB09");
        }

        savepointSequence += 1;
        const allowedSavepoint = `task149_allowed_${savepointSequence}`;
        await database.query(`savepoint ${allowedSavepoint}`);
        await database.query(
          "update public.pcb_bom_versions set is_active = false where id = $1::uuid",
          [versionId],
        );
        await expectSqlRejected(database, () => database.query(
          "update public.pcb_bom_versions set is_active = true where id = $1::uuid",
          [versionId],
        ), "PCB09");
        await database.query(`rollback to savepoint ${allowedSavepoint}`);

        for (const operation of [
          () => database.query(
            "update public.pcb_production_work_orders set planned_quantity = 2 where work_order_id = $1::uuid",
            [workOrderId],
          ),
          () => database.query(
            "update public.pcb_production_work_orders set bom_version_id = $2::uuid where work_order_id = $1::uuid",
            [workOrderId, randomUUID()],
          ),
          () => database.query(
            "delete from public.pcb_production_work_orders where work_order_id = $1::uuid",
            [workOrderId],
          ),
        ]) {
          await expectSqlRejected(database, operation, "PCB11");
        }

        for (const itemId of [workOrderItemId, supplementalItemId]) {
          for (const operation of [
          () => database.query(
            "update public.work_order_items set quantity = 3 where id = $1::uuid",
            [itemId],
          ),
          () => database.query(
            "update public.work_order_items set source_type = 'manual' where id = $1::uuid",
            [itemId],
          ),
          () => database.query("delete from public.work_order_items where id = $1::uuid", [itemId]),
          ]) {
            await expectSqlRejected(database, operation, "WOR04");
          }
        }

        for (const operation of [
          () => database.query(
            "update public.pcb_production_runs set quantity_produced = 9 where id = $1::uuid",
            [runId],
          ),
          () => database.query(
            "update public.pcb_production_runs set pcb_card_id = $2::uuid where id = $1::uuid",
            [runId, randomUUID()],
          ),
          () => database.query(
            "update public.pcb_production_runs set bom_version_id = $2::uuid where id = $1::uuid",
            [runId, randomUUID()],
          ),
          () => database.query(
            "update public.pcb_production_runs set project_id = $2::uuid where id = $1::uuid",
            [runId, randomUUID()],
          ),
          () => database.query(
            "update public.pcb_production_runs set produced_by_user_id = $2::uuid where id = $1::uuid",
            [runId, fixture.actors.unpermitted.profileId],
          ),
          () => database.query(
            "update public.pcb_production_runs set completed_at = completed_at + interval '1 second' where id = $1::uuid",
            [runId],
          ),
          () => database.query(
            "update public.pcb_production_runs set work_order_id = null where id = $1::uuid",
            [runId],
          ),
          () => database.query("delete from public.pcb_production_runs where id = $1::uuid", [runId]),
        ]) {
          await expectSqlRejected(database, operation, "PCB08");
        }
        await expectSqlRejected(database, () => database.query(
          `insert into public.pcb_production_runs (
             pcb_card_id, bom_version_id, quantity_produced,
             produced_by_user_id, work_order_id
           ) values ($1::uuid, $2::uuid, 1, $3::uuid, $4::uuid)`,
          [cardId, versionId, admin.profileId, workOrderId],
        ), "23505");

        await actAs(database, admin);
        await expectSqlRejected(database, () => database.query(
          `insert into public.pcb_production_runs (
             pcb_card_id, bom_version_id, quantity_produced,
             produced_by_user_id, work_order_id
           ) values ($1::uuid, $2::uuid, 1, $3::uuid, null)`,
          [cardId, versionId, admin.profileId],
        ), "42501");
        await expectSqlRejected(database, () => database.query(
          "update public.pcb_production_runs set quantity_produced = 9 where id = $1::uuid",
          [runId],
        ), "42501");
        await resetRole(database);

        expect((await database.query<Record<string, unknown>>(
          `select
             (select pg_catalog.to_jsonb(version) from public.pcb_bom_versions as version
              where version.id = $1::uuid) as version,
             (select pg_catalog.to_jsonb(item) from public.pcb_bom_items as item
              where item.id = $2::uuid) as bom_item,
             (select pg_catalog.to_jsonb(context) from public.pcb_production_work_orders as context
              where context.work_order_id = $3::uuid) as context,
             (select pg_catalog.to_jsonb(item) from public.work_order_items as item
              where item.id = $4::uuid) as work_order_item,
             (select pg_catalog.to_jsonb(item) from public.work_order_items as item
              where item.id = $6::uuid) as supplemental_item,
             (select pg_catalog.to_jsonb(run) from public.pcb_production_runs as run
              where run.id = $5::uuid) as run`,
          [versionId, bomItemId, workOrderId, workOrderItemId, runId, supplementalItemId],
        )).rows).toEqual(baseline);
      });
    });

    it("keeps Product Serials and Work Order numbers permanent and non-recyclable through browser writes", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const admin = fixture.actors.admin;
        const first = await createProduct(database, admin.profileId);
        const second = await createProduct(database, admin.profileId);
        const state = await createPreflightFixture(database, admin.profileId);
        const baseline = (await database.query<Record<string, unknown>>(
          `select
             (select pg_catalog.to_jsonb(product) from public.products as product
              where product.id = $1::uuid) as first_product,
             (select pg_catalog.to_jsonb(product) from public.products as product
              where product.id = $2::uuid) as second_product,
             (select pg_catalog.to_jsonb(work_order) from public.work_orders as work_order
              where work_order.id = $3::uuid) as work_order`,
          [first.id, second.id, state.workOrderId],
        )).rows;

        for (const value of [createTestSerialNumber(), second.serialNumber, null]) {
          await expectSqlRejected(database, () => database.query(
            "update public.products set serial_number = $2::text where id = $1::uuid",
            [first.id, value],
          ), "PRD03");
        }
        await database.query(
          `update public.products
           set is_active = false, archived_at = pg_catalog.now(),
               archived_by_user_id = $2::uuid, updated_at = pg_catalog.now(),
               updated_by_user_id = $2::uuid
           where id = $1::uuid`,
          [first.id, admin.profileId],
        );
        await expectSqlRejected(database, () => database.query(
          `insert into public.products (
             serial_number, name, category, product_kind,
             created_by_user_id, updated_by_user_id
           ) values ($1::text, 'Recycled', 'Task 149', 'component', $2::uuid, $2::uuid)`,
          [first.serialNumber, admin.profileId],
        ), "23505");

        for (const value of [await nextWorkOrderNumber(database), "RN-2026-0001", null]) {
          await expectSqlRejected(database, () => database.query(
            "update public.work_orders set work_order_number = $2::text where id = $1::uuid",
            [state.workOrderId, value],
          ), "WOR01");
        }

        const browserReplacementNumber = await nextWorkOrderNumber(database);
        await actAs(database, admin);
        await expectSqlRejected(database, () => database.query(
          "update public.products set serial_number = $2::text where id = $1::uuid",
          [second.id, createTestSerialNumber()],
        ), "42501");
        await expectSqlRejected(database, () => database.query(
          "update public.work_orders set work_order_number = $2::text where id = $1::uuid",
          [state.workOrderId, browserReplacementNumber],
        ), "42501");
        await expectSqlRejected(database, () => database.query(
          `insert into public.work_orders (
             work_order_number, created_by_user_id, updated_by_user_id
           ) values ($1::text, $2::uuid, $2::uuid)`,
          [state.workOrderNumber, admin.profileId],
        ), "42501");
        await resetRole(database);

        const final = (await database.query<Record<string, unknown>>(
          `select
             (select serial_number from public.products where id = $1::uuid)
               as first_serial,
             (select serial_number from public.products where id = $2::uuid)
               as second_serial,
             (select work_order_number from public.work_orders where id = $3::uuid)
               as work_order_number`,
          [first.id, second.id, state.workOrderId],
        )).rows;
        expect(final).toEqual([{
          first_serial: first.serialNumber,
          second_serial: second.serialNumber,
          work_order_number: state.workOrderNumber,
        }]);
        expect(baseline).toHaveLength(1);
      });
    });

    it("exposes only intended lifecycle RPCs and keeps historical mutation helpers internal", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const rows = (await database.query<{
          identity_arguments: string;
          name: string;
          authenticated_execute: boolean;
          anon_execute: boolean;
          public_execute: boolean;
          security_definer: boolean;
          search_path: string | null;
        }>(
          `select
             routine.proname as name,
             pg_catalog.pg_get_function_identity_arguments(routine.oid)
               as identity_arguments,
             routine.prosecdef as security_definer,
             (
               select setting
               from pg_catalog.unnest(routine.proconfig) as setting
               where setting like 'search_path=%'
             ) as search_path,
             pg_catalog.has_function_privilege(
               'authenticated', routine.oid, 'EXECUTE'
             ) as authenticated_execute,
             pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
               as anon_execute,
             pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
               as public_execute
           from pg_catalog.pg_proc as routine
           join pg_catalog.pg_namespace as namespace
             on namespace.oid = routine.pronamespace
           where namespace.nspname = 'public'
             and routine.proname = any($1::text[])
           order by routine.proname, identity_arguments`,
          [[
            "append_audit_log",
            "apply_inventory_delta",
            "prevent_audit_log_mutation",
            "prevent_inventory_movement_mutation",
            "enforce_work_order_lifecycle",
            "enforce_work_order_item_parent_draft",
            "enforce_work_order_pdf_immutability",
            "enforce_used_pcb_bom_version_immutability",
            "enforce_used_pcb_bom_item_immutability",
            "prevent_pcb_production_run_mutation",
            "enforce_pcb_production_work_order_context_lifecycle",
            "save_draft_work_order",
            "delete_draft_work_order",
            "finish_work_order",
          ]],
        )).rows;
        const internalNames = new Set([
          "append_audit_log",
          "apply_inventory_delta",
          "prevent_audit_log_mutation",
          "prevent_inventory_movement_mutation",
          "enforce_work_order_lifecycle",
          "enforce_work_order_item_parent_draft",
          "enforce_work_order_pdf_immutability",
          "enforce_used_pcb_bom_version_immutability",
          "enforce_used_pcb_bom_item_immutability",
          "prevent_pcb_production_run_mutation",
          "enforce_pcb_production_work_order_context_lifecycle",
        ]);
        const lifecycleNames = new Set([
          "save_draft_work_order",
          "delete_draft_work_order",
          "finish_work_order",
        ]);
        expect(rows.length).toBeGreaterThanOrEqual(internalNames.size + lifecycleNames.size);
        for (const row of rows) {
          expect(row.search_path).toBe("search_path=\"\"");
          expect(row.anon_execute).toBe(false);
          expect(row.public_execute).toBe(false);
          if (internalNames.has(row.name)) {
            expect(row.authenticated_execute).toBe(false);
          }
          if (lifecycleNames.has(row.name)) {
            expect(row.authenticated_execute).toBe(true);
            expect(row.security_definer).toBe(true);
          }
        }
      });
    });
  });
}
