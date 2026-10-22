import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { createTestSerialNumber } from "./helpers/serial";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const raw = "10000000-0000-4000-8000-000000000001";
const finished = "10000000-0000-4000-8000-000000000002";
const customs = "10000000-0000-4000-8000-000000000003";

async function actAs(database: PoolClient, actor: SecurityActor | null) {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor?.authUserId ?? ""],
  );
  await database.query(actor ? "set local role authenticated" : "set local role anon");
}

async function addWarehouseStock(
  database: PoolClient,
  actor: SecurityActor,
  productId: string,
  warehouseId: string,
  quantity: string,
  productSupplierId: string,
) {
  await actAs(database, actor);
  await database.query(
    `select * from public.adjust_inventory_warehouse(
       $1::uuid, $2::uuid, 'add', $3::bigint,
       'Warehouse-aware production fixture', $4::uuid
     )`,
    [productId, warehouseId, quantity, productSupplierId],
  );
  await database.query("reset role");
}

async function createProduct(database: PoolClient, actorId: string, kind = "component") {
  const id = randomUUID();
  await database.query(
    `insert into public.products (
       id, serial_number, name, category, product_kind,
       created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::text, $3::text, 'Production', $4::text, $5::uuid, $5::uuid)`,
    [id, createTestSerialNumber(), `Warehouse-aware Product ${id}`, kind, actorId],
  );
  return id;
}

async function nextWorkOrderNumber(database: PoolClient) {
  return (await database.query<{ value: string }>(
    `select 'RN-8995-' || pg_catalog.lpad(candidate::text, 4, '0') as value
     from pg_catalog.generate_series(1, 9999) as candidate
     where not exists (
       select 1 from public.work_orders
       where work_order_number = 'RN-8995-' || pg_catalog.lpad(candidate::text, 4, '0')
     ) order by candidate limit 1`,
  )).rows[0]!.value;
}

async function waitForLockWait(database: PoolClient, applicationName: string) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const waiting = (await database.query<{ waiting: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_stat_activity as activity
         where activity.application_name = $1::text
           and activity.wait_event_type = 'Lock'
       ) as waiting`,
      [applicationName],
    )).rows[0]?.waiting;
    if (waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected ${applicationName} to wait on a database lock`);
}

export function registerWarehouseAwareProductionTests(
  requireHarness: () => SecurityFixtureHarness,
) {
  describe.skipIf(process.env.WAREHOUSE_AWARE_PRODUCTION !== "1")(
    "warehouse-aware Work Order production",
    () => {
      it("preflights combined stock and finishes with exact priority movements and provenance", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const actor = harness.actors.admin;
          const productId = await createProduct(database, actor.profileId);
          const source = await createSupplierSourceFixture(database, actor, productId, {
            catalogNumber: "MIXED-WAREHOUSE-001",
          });
          await addWarehouseStock(database, actor, productId, raw, "4", source.productSupplierId);
          await addWarehouseStock(database, actor, productId, customs, "3", source.productSupplierId);
          await addWarehouseStock(database, actor, productId, finished, "5", source.productSupplierId);

          const projectId = randomUUID();
          await database.query(
            `insert into public.projects (
               id, name, customer_name, status, start_date, delivery_date,
               created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::text, 'Warehouse Customer', 'planned',
               '2026-10-21'::date, '2026-11-21'::date, $3::uuid, $3::uuid)`,
            [projectId, `Warehouse Project ${projectId}`, actor.profileId],
          );
          const workOrderId = randomUUID();
          await database.query(
            `insert into public.work_orders (
               id, work_order_number, project_id, customer_name_snapshot,
               description, created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::text, $3::uuid, 'Warehouse Customer',
               'Mixed warehouse Work Order', $4::uuid, $4::uuid)`,
            [workOrderId, await nextWorkOrderNumber(database), projectId, actor.profileId],
          );
          await database.query(
            `insert into public.work_order_items (
               work_order_id, product_id, quantity, added_by_user_id
             ) values ($1::uuid, $2::uuid, 10, $3::uuid)`,
            [workOrderId, productId, actor.profileId],
          );
          const updatedAt = (await database.query<{ value: string }>(
            "select updated_at::text as value from public.work_orders where id = $1::uuid",
            [workOrderId],
          )).rows[0]!.value;

          await actAs(database, actor);
          const preflight = await database.query<{ available_quantity: string; missing_quantity: string }>(
            `select available_quantity::text, missing_quantity::text
             from public.preflight_finish_work_order($1::uuid, $2::timestamptz)`,
            [workOrderId, updatedAt],
          );
          expect(preflight.rows).toEqual([{ available_quantity: "12", missing_quantity: "0" }]);
          await database.query("reset role");

          await database.query(
            `insert into public.user_permissions (
               user_id, permission_definition_id, granted_by_user_id
             ) select $1::uuid, definition.id, $2::uuid
               from public.permission_definitions as definition
               where definition.key = 'work_orders.finish'
             on conflict (user_id, permission_definition_id) do nothing`,
            [harness.actors.permitted.profileId, actor.profileId],
          );
          await actAs(database, harness.actors.permitted);
          await expect(database.query(
            `select available_quantity
             from public.preflight_finish_work_order($1::uuid, $2::timestamptz)`,
            [workOrderId, updatedAt],
          )).resolves.toMatchObject({ rowCount: 1 });
          await database.query("savepoint private_plan_denial");
          await expect(database.query(
            "select * from public.get_work_order_warehouse_source_allocation_plan($1::uuid)",
            [workOrderId],
          )).rejects.toMatchObject({ code: "42501" });
          await database.query("rollback to savepoint private_plan_denial");
          await database.query("reset role");

          const plan = await database.query<{
            allocated_quantity: string; warehouse_code: string;
          }>(
            `select warehouse_code, allocated_quantity::text
             from public.get_work_order_warehouse_source_allocation_plan($1::uuid)`,
            [workOrderId],
          );
          expect(plan.rows).toEqual([
            { warehouse_code: "raw_materials", allocated_quantity: "4" },
            { warehouse_code: "customs", allocated_quantity: "3" },
            { warehouse_code: "finished_goods", allocated_quantity: "3" },
          ]);
          const fingerprint = (await database.query<{ value: string }>(
            "select public.get_work_order_source_allocation_fingerprint($1::uuid) as value",
            [workOrderId],
          )).rows[0]!.value;
          expect(fingerprint).toMatch(/^[0-9a-f]{32}$/);

          await actAs(database, actor);
          const pdfSnapshot = await database.query<{
            allocation_fingerprint: string;
            quantity: string;
          }>(
            `select allocation_fingerprint, quantity
             from public.get_work_order_pdf_snapshot(
               $1::uuid, $2::timestamptz
             )`,
            [workOrderId, updatedAt],
          );
          await database.query("reset role");
          expect(pdfSnapshot.rows.map((row) => row.quantity)).toEqual(["4", "3", "3"]);
          expect(new Set(pdfSnapshot.rows.map((row) => row.allocation_fingerprint)))
            .toEqual(new Set([fingerprint]));

          await database.query("savepoint stale_warehouse_fingerprint");
          await addWarehouseStock(
            database,
            actor,
            productId,
            raw,
            "1",
            source.productSupplierId,
          );
          const staleStorage = `final/${workOrderId}/${randomUUID()}.pdf`;
          await database.query(
            `insert into storage.objects (bucket_id, name, metadata)
             values ('work-order-pdfs', $1::text,
               pg_catalog.jsonb_build_object('mimetype', 'application/pdf'))`,
            [staleStorage],
          );
          await actAs(database, actor);
          await expect(database.query(
            `select * from public.finish_work_order(
               $1::uuid, $2::timestamptz, $3::text, $4::text, $5::text
             )`,
            [workOrderId, updatedAt, staleStorage, "d".repeat(64), fingerprint],
          )).rejects.toMatchObject({ code: "WOR11" });
          await database.query("rollback to savepoint stale_warehouse_fingerprint");
          expect((await database.query(
            `select status from public.work_orders where id = $1::uuid`,
            [workOrderId],
          )).rows).toEqual([{ status: "draft" }]);
          expect((await database.query<{ count: string }>(
            `select pg_catalog.count(*)::text as count
             from public.inventory_movements
             where source_type = 'work_order' and source_id = $1::uuid`,
            [workOrderId],
          )).rows).toEqual([{ count: "0" }]);

          const storageReference = `final/${workOrderId}/${randomUUID()}.pdf`;
          await database.query(
            `insert into storage.objects (bucket_id, name, metadata)
             values ('work-order-pdfs', $1::text,
               pg_catalog.jsonb_build_object('mimetype', 'application/pdf'))`,
            [storageReference],
          );
          await actAs(database, actor);
          await database.query(
            `select * from public.finish_work_order(
               $1::uuid, $2::timestamptz, $3::text, $4::text, $5::text
             )`,
            [workOrderId, updatedAt, storageReference, "a".repeat(64), fingerprint],
          );
          await database.query("reset role");

          await actAs(database, actor);
          await database.query("savepoint repeated_finish");
          await expect(database.query(
            `select * from public.finish_work_order(
               $1::uuid, $2::timestamptz, $3::text, $4::text, $5::text
             )`,
            [workOrderId, updatedAt, storageReference, "a".repeat(64), fingerprint],
          )).rejects.toMatchObject({ code: "WOR02" });
          await database.query("rollback to savepoint repeated_finish");
          await database.query("reset role");

          const movements = await database.query(
            `select warehouse.code, movement.quantity_delta::text
             from public.inventory_movements as movement
             join public.inventory_warehouses as warehouse
               on warehouse.id = movement.warehouse_id
             where movement.source_type = 'work_order'
               and movement.source_id = $1::uuid
             order by public.production_warehouse_priority(movement.warehouse_id)`,
            [workOrderId],
          );
          expect(movements.rows).toEqual([
            { code: "raw_materials", quantity_delta: "-4" },
            { code: "customs", quantity_delta: "-3" },
            { code: "finished_goods", quantity_delta: "-3" },
          ]);
          const balances = await database.query(
            `select warehouse.code, balance.quantity::text
             from public.inventory_balances as balance
             join public.inventory_warehouses as warehouse
               on warehouse.id = balance.warehouse_id
             where balance.product_id = $1::uuid
             order by public.production_warehouse_priority(balance.warehouse_id)`,
            [productId],
          );
          expect(balances.rows).toEqual([
            { code: "raw_materials", quantity: "0" },
            { code: "customs", quantity: "0" },
            { code: "finished_goods", quantity: "2" },
          ]);
          await actAs(database, actor);
          const finishedMaterials = await database.query(
            `select warehouse_code, quantity
             from public.list_finished_work_order_materials($1::uuid)`,
            [workOrderId],
          );
          const finishedMovements = await database.query(
            `select warehouse_code, quantity_delta
             from public.list_finished_work_order_movements($1::uuid)`,
            [workOrderId],
          );
          await database.query("reset role");
          expect(finishedMaterials.rows.map((row) => row.warehouse_code)).toEqual([
            "raw_materials", "customs", "finished_goods",
          ]);
          expect(new Set(finishedMovements.rows.map((row) => row.warehouse_code)))
            .toEqual(new Set(["raw_materials", "customs", "finished_goods"]));
        });
      });

      it("keeps new PCB creation Project-free and rejects non-null Project input", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const actor = harness.actors.admin;
          const outputId = await createProduct(database, actor.profileId, "pcb_finished_good");
          const componentId = await createProduct(database, actor.profileId);
          const componentSource = await createSupplierSourceFixture(
            database, actor, componentId, { catalogNumber: "PCB-MIXED-001" },
          );
          await addWarehouseStock(database, actor, componentId, raw, "4", componentSource.productSupplierId);
          await addWarehouseStock(database, actor, componentId, customs, "3", componentSource.productSupplierId);
          await addWarehouseStock(database, actor, componentId, finished, "5", componentSource.productSupplierId);
          const cardId = randomUUID();
          await database.query(
            `insert into public.pcb_cards (
               id, name, output_product_id, created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::text, $3::uuid, $4::uuid, $4::uuid)`,
            [cardId, `Warehouse PCB ${cardId}`, outputId, actor.profileId],
          );
          const versionId = (await database.query<{ id: string }>(
            `insert into public.pcb_bom_versions (
               pcb_card_id, version_number, created_by_user_id
             ) values ($1::uuid, 1, $2::uuid) returning id`,
            [cardId, actor.profileId],
          )).rows[0]!.id;
          await database.query(
            `insert into public.pcb_bom_items (
               bom_version_id, component_product_id, quantity_per_card
             ) values ($1::uuid, $2::uuid, 5)`,
            [versionId, componentId],
          );
          const projectId = randomUUID();
          await database.query(
            `insert into public.projects (
               id, name, customer_name, status, start_date, delivery_date,
               created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::text, 'Customer', 'planned', current_date,
               current_date + 1, $3::uuid, $3::uuid)`,
            [projectId, `Rejected Project ${projectId}`, actor.profileId],
          );
          await actAs(database, actor);
          await database.query("savepoint reject_project_creation");
          await expect(database.query(
            `select * from public.create_pcb_production_work_order(
               $1::uuid, '1', $2::uuid, $3::uuid
             )`,
            [cardId, projectId, randomUUID()],
          )).rejects.toMatchObject({ code: "PCB10" });
          await database.query("rollback to savepoint reject_project_creation");
          await database.query("reset role");

          const requestId = randomUUID();
          await actAs(database, actor);
          const created = (await database.query<{
            work_order_id: string; work_order_number: string;
          }>(
            `select * from public.create_pcb_production_work_order(
               $1::uuid, '2', null, $2::uuid
             )`,
            [cardId, requestId],
          )).rows[0]!;
          await database.query("reset role");
          const workOrder = (await database.query<{
            project_id: string | null; updated_at: string;
          }>(
            `select project_id, updated_at::text
             from public.work_orders where id = $1::uuid`,
            [created.work_order_id],
          )).rows[0]!;
          expect(workOrder.project_id).toBeNull();
          await actAs(database, actor);
          const pcbPreflight = await database.query<{
            available_quantity: string; required_quantity: string;
          }>(
            `select available_quantity::text, required_quantity::text
             from public.preflight_finish_pcb_production_work_order(
               $1::uuid, $2::timestamptz, '2'
             ) where product_id = $3::uuid`,
            [created.work_order_id, workOrder.updated_at, componentId],
          );
          await database.query("reset role");
          expect(pcbPreflight.rows).toEqual([{
            available_quantity: "12", required_quantity: "10",
          }]);
          const fingerprint = (await database.query<{ value: string }>(
            "select public.get_work_order_source_allocation_fingerprint($1::uuid) as value",
            [created.work_order_id],
          )).rows[0]!.value;
          await actAs(database, actor);
          const pcbPdfSnapshot = await database.query<{
            allocation_fingerprint: string;
            quantity: string;
          }>(
            `select allocation_fingerprint, quantity
             from public.get_work_order_pdf_snapshot(
               $1::uuid, $2::timestamptz, '2'
             )`,
            [created.work_order_id, workOrder.updated_at],
          );
          await database.query("reset role");
          expect(pcbPdfSnapshot.rows.map((row) => row.quantity)).toEqual(["4", "3", "3"]);
          expect(new Set(pcbPdfSnapshot.rows.map((row) => row.allocation_fingerprint)))
            .toEqual(new Set([fingerprint]));
          const storageReference = `final/${created.work_order_id}/${randomUUID()}.pdf`;
          await database.query(
            `insert into storage.objects (bucket_id, name, metadata)
             values ('work-order-pdfs', $1::text,
               pg_catalog.jsonb_build_object('mimetype', 'application/pdf'))`,
            [storageReference],
          );
          await actAs(database, actor);
          await database.query(
            `select * from public.finish_work_order(
               $1::uuid, $2::timestamptz, $3::text, $4::text, $5::text, '2'
             )`,
            [created.work_order_id, workOrder.updated_at, storageReference,
              "b".repeat(64), fingerprint],
          );
          await database.query("reset role");

          const output = await database.query(
            `select warehouse.code, balance.quantity::text
             from public.inventory_balances as balance
             join public.inventory_warehouses as warehouse
               on warehouse.id = balance.warehouse_id
             where balance.product_id = $1::uuid
             order by public.production_warehouse_priority(balance.warehouse_id)`,
            [outputId],
          );
          expect(output.rows).toEqual([
            { code: "raw_materials", quantity: "0" },
            { code: "customs", quantity: "0" },
            { code: "finished_goods", quantity: "2" },
          ]);
          const outputLedger = await database.query(
            `select warehouse.code, movement.quantity_delta::text,
               lot.source_kind, lot.remaining_quantity::text
             from public.inventory_movements as movement
             join public.inventory_warehouses as warehouse
               on warehouse.id = movement.warehouse_id
             join public.inventory_source_lots as lot
               on lot.originating_inventory_movement_id = movement.id
             where movement.source_type = 'pcb_production_output'
               and movement.source_id in (
                 select run.id from public.pcb_production_runs as run
                 where run.work_order_id = $1::uuid
               )`,
            [created.work_order_id],
          );
          expect(outputLedger.rows).toEqual([{
            code: "finished_goods",
            quantity_delta: "2",
            source_kind: "internal_production",
            remaining_quantity: "2",
          }]);
          const inputLedger = await database.query(
            `select warehouse.code, movement.quantity_delta::text
             from public.inventory_movements as movement
             join public.inventory_warehouses as warehouse
               on warehouse.id = movement.warehouse_id
             join public.pcb_production_runs as run on run.id = movement.source_id
             where run.work_order_id = $1::uuid
               and movement.movement_type = 'pcb_production_input'
             order by public.production_warehouse_priority(movement.warehouse_id)`,
            [created.work_order_id],
          );
          expect(inputLedger.rows).toEqual([
            { code: "raw_materials", quantity_delta: "-4" },
            { code: "customs", quantity_delta: "-3" },
            { code: "finished_goods", quantity_delta: "-3" },
          ]);

          await addWarehouseStock(database, actor, componentId, customs, "3", componentSource.productSupplierId);

          await actAs(database, actor);
          const zero = (await database.query<{ work_order_id: string }>(
            `select work_order_id from public.create_pcb_production_work_order(
               $1::uuid, '1', null, $2::uuid
             )`,
            [cardId, randomUUID()],
          )).rows[0]!;
          await database.query("reset role");
          const zeroUpdatedAt = (await database.query<{ value: string }>(
            "select updated_at::text as value from public.work_orders where id = $1::uuid",
            [zero.work_order_id],
          )).rows[0]!.value;
          const zeroFingerprint = (await database.query<{ value: string }>(
            "select public.get_work_order_source_allocation_fingerprint($1::uuid) as value",
            [zero.work_order_id],
          )).rows[0]!.value;
          const zeroStorage = `final/${zero.work_order_id}/${randomUUID()}.pdf`;
          await database.query(
            `insert into storage.objects (bucket_id, name, metadata)
             values ('work-order-pdfs', $1::text,
               pg_catalog.jsonb_build_object('mimetype', 'application/pdf'))`,
            [zeroStorage],
          );
          await actAs(database, actor);
          await database.query(
            `select * from public.finish_work_order(
               $1::uuid, $2::timestamptz, $3::text, $4::text, $5::text, '0'
             )`,
            [zero.work_order_id, zeroUpdatedAt, zeroStorage,
              "c".repeat(64), zeroFingerprint],
          );
          await database.query("reset role");
          expect((await database.query<{ count: string }>(
            `select count(*)::text as count
             from public.inventory_movements as movement
             join public.pcb_production_runs as run on run.id = movement.source_id
             where run.work_order_id = $1::uuid
               and movement.movement_type = 'pcb_production_output'`,
            [zero.work_order_id],
          )).rows[0]!.count).toBe("0");
        });
      });

      it("serializes mixed-source Finish against a warehouse transfer without partial effects", async () => {
        const harness = requireHarness();
        const actor = harness.actors.admin;
        await harness.withDatabaseClients(3, async ([finisher, transfer, observer]) => {
          if (!finisher || !transfer || !observer) {
            throw new Error("Warehouse-aware concurrency clients are unavailable");
          }
          await observer.query("begin");
          const productId = await createProduct(observer, actor.profileId);
          const source = await createSupplierSourceFixture(observer, actor, productId, {
            catalogNumber: "MIXED-RACE-001",
          });
          await addWarehouseStock(observer, actor, productId, raw, "4", source.productSupplierId);
          await addWarehouseStock(observer, actor, productId, customs, "3", source.productSupplierId);
          await addWarehouseStock(observer, actor, productId, finished, "5", source.productSupplierId);
          const projectId = randomUUID();
          const workOrderId = randomUUID();
          await observer.query(
            `insert into public.projects (
               id, name, customer_name, status, start_date, delivery_date,
               created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::text, 'Concurrency Customer', 'planned',
               current_date, current_date + 1, $3::uuid, $3::uuid)`,
            [projectId, `Warehouse Race Project ${projectId}`, actor.profileId],
          );
          await observer.query(
            `insert into public.work_orders (
               id, work_order_number, project_id, customer_name_snapshot,
               description, created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::text, $3::uuid, 'Concurrency Customer',
               'Warehouse transfer race', $4::uuid, $4::uuid)`,
            [workOrderId, await nextWorkOrderNumber(observer), projectId, actor.profileId],
          );
          await observer.query(
            `insert into public.work_order_items (
               work_order_id, product_id, quantity, added_by_user_id
             ) values ($1::uuid, $2::uuid, 10, $3::uuid)`,
            [workOrderId, productId, actor.profileId],
          );
          const updatedAt = (await observer.query<{ value: string }>(
            "select updated_at::text as value from public.work_orders where id = $1::uuid",
            [workOrderId],
          )).rows[0]!.value;
          const fingerprint = (await observer.query<{ value: string }>(
            "select public.get_work_order_source_allocation_fingerprint($1::uuid) as value",
            [workOrderId],
          )).rows[0]!.value;
          const storageReference = `final/${workOrderId}/${randomUUID()}.pdf`;
          await observer.query(
            `insert into storage.objects (bucket_id, name, metadata)
             values ('work-order-pdfs', $1::text,
               pg_catalog.jsonb_build_object('mimetype', 'application/pdf'))`,
            [storageReference],
          );
          await observer.query("commit");

          const applicationName = `warehouse-finish-transfer-${randomUUID()}`;
          try {
            await finisher.query("begin");
            await actAs(finisher, actor);
            await finisher.query(
              `select * from public.finish_work_order(
                 $1::uuid, $2::timestamptz, $3::text, $4::text, $5::text
               )`,
              [workOrderId, updatedAt, storageReference, "e".repeat(64), fingerprint],
            );

            await transfer.query("begin");
            await transfer.query(
              "select pg_catalog.set_config('application_name', $1::text, true)",
              [applicationName],
            );
            await actAs(transfer, actor);
            const waitingTransfer = transfer.query(
              `select * from public.transfer_inventory_between_warehouses(
                 $1::uuid, $2::uuid, $3::uuid, 1,
                 'Transfer serialized behind Finish'
               )`,
              [productId, customs, finished],
            );
            await waitForLockWait(observer, applicationName);
            await finisher.query("rollback");
            await expect(waitingTransfer).resolves.toMatchObject({ rowCount: 1 });
            await transfer.query("rollback");

            expect((await observer.query(
              `select warehouse.code, balance.quantity::text
               from public.inventory_balances as balance
               join public.inventory_warehouses as warehouse
                 on warehouse.id = balance.warehouse_id
               where balance.product_id = $1::uuid
               order by public.production_warehouse_priority(balance.warehouse_id)`,
              [productId],
            )).rows).toEqual([
              { code: "raw_materials", quantity: "4" },
              { code: "customs", quantity: "3" },
              { code: "finished_goods", quantity: "5" },
            ]);
            expect((await observer.query(
              `select status from public.work_orders where id = $1::uuid`,
              [workOrderId],
            )).rows).toEqual([{ status: "draft" }]);
          } finally {
            await finisher.query("rollback").catch(() => undefined);
            await transfer.query("rollback").catch(() => undefined);
          }
        });
      });

      it("rechecks Finish permission after a blocking Work Order lock", async () => {
        const harness = requireHarness();
        const admin = harness.actors.admin;
        const actor = harness.actors.permitted;
        await harness.withDatabaseClients(4, async ([blocker, finisher, revoker, observer]) => {
          if (!blocker || !finisher || !revoker || !observer) {
            throw new Error("Warehouse-aware permission-race clients are unavailable");
          }
          await observer.query("begin");
          const productId = await createProduct(observer, admin.profileId);
          const source = await createSupplierSourceFixture(observer, admin, productId, {
            catalogNumber: "FINISH-REVOKE-001",
          });
          await addWarehouseStock(observer, admin, productId, raw, "2", source.productSupplierId);
          const projectId = randomUUID();
          const workOrderId = randomUUID();
          await observer.query(
            `insert into public.projects (
               id, name, customer_name, status, start_date, delivery_date,
               created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::text, 'Permission Customer', 'planned',
               current_date, current_date + 1, $3::uuid, $3::uuid)`,
            [projectId, `Finish Permission Project ${projectId}`, admin.profileId],
          );
          await observer.query(
            `insert into public.work_orders (
               id, work_order_number, project_id, customer_name_snapshot,
               description, created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::text, $3::uuid, 'Permission Customer',
               'Finish permission race', $4::uuid, $4::uuid)`,
            [workOrderId, await nextWorkOrderNumber(observer), projectId, admin.profileId],
          );
          await observer.query(
            `insert into public.work_order_items (
               work_order_id, product_id, quantity, added_by_user_id
             ) values ($1::uuid, $2::uuid, 1, $3::uuid)`,
            [workOrderId, productId, admin.profileId],
          );
          await observer.query(
            `insert into public.user_permissions (
               user_id, permission_definition_id, granted_by_user_id
             ) select $1::uuid, definition.id, $2::uuid
               from public.permission_definitions as definition
              where definition.key = 'work_orders.finish'
             on conflict (user_id, permission_definition_id) do nothing`,
            [actor.profileId, admin.profileId],
          );
          const updatedAt = (await observer.query<{ value: string }>(
            "select updated_at::text as value from public.work_orders where id = $1::uuid",
            [workOrderId],
          )).rows[0]!.value;
          const fingerprint = (await observer.query<{ value: string }>(
            "select public.get_work_order_source_allocation_fingerprint($1::uuid) as value",
            [workOrderId],
          )).rows[0]!.value;
          const storageReference = `final/${workOrderId}/${randomUUID()}.pdf`;
          await observer.query(
            `insert into storage.objects (bucket_id, name, metadata)
             values ('work-order-pdfs', $1::text,
               pg_catalog.jsonb_build_object('mimetype', 'application/pdf'))`,
            [storageReference],
          );
          await observer.query("commit");

          const applicationName = `warehouse-finish-revoke-${randomUUID()}`;
          try {
            await blocker.query("begin");
            await blocker.query(
              "select 1 from public.work_orders where id = $1::uuid for update",
              [workOrderId],
            );
            await finisher.query("begin");
            await finisher.query(
              "select pg_catalog.set_config('application_name', $1::text, true)",
              [applicationName],
            );
            await actAs(finisher, actor);
            const waitingFinish = finisher.query(
              `select * from public.finish_work_order(
                 $1::uuid, $2::timestamptz, $3::text, $4::text, $5::text
               )`,
              [workOrderId, updatedAt, storageReference, "f".repeat(64), fingerprint],
            ).then(
              () => ({ code: "unexpected_success" }),
              (error: unknown) => ({
                code: typeof error === "object" && error !== null && "code" in error
                  ? String(error.code)
                  : "unknown",
              }),
            );
            await waitForLockWait(observer, applicationName);
            await revoker.query(
              `delete from public.user_permissions as permission
               using public.permission_definitions as definition
               where permission.permission_definition_id = definition.id
                 and permission.user_id = $1::uuid
                 and definition.key = 'work_orders.finish'`,
              [actor.profileId],
            );
            await blocker.query("rollback");
            expect(await waitingFinish).toEqual({ code: "42501" });
            await finisher.query("rollback");
            expect((await observer.query(
              `select status from public.work_orders where id = $1::uuid`,
              [workOrderId],
            )).rows).toEqual([{ status: "draft" }]);
            expect((await observer.query<{ count: string }>(
              `select pg_catalog.count(*)::text as count
               from public.inventory_movements
               where source_type = 'work_order' and source_id = $1::uuid`,
              [workOrderId],
            )).rows).toEqual([{ count: "0" }]);
          } finally {
            await blocker.query("rollback").catch(() => undefined);
            await finisher.query("rollback").catch(() => undefined);
            await revoker.query("rollback").catch(() => undefined);
          }
        });
      });
    },
  );
}
