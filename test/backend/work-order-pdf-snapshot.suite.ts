import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { expectPermissionDenied } from "./helpers/assertions";
import { createTestSerialNumber } from "./helpers/serial";
import type { SecurityFixtureHarness } from "./security-fixtures";
import {
  actAs,
  createPreflightFixture,
  expectRejected,
  setOnlyRelevantPermission,
} from "./work-order-finish-preflight.suite";

interface SnapshotRow {
  customer_name_snapshot: string;
  description: string;
  material_position: string;
  product_id: string;
  product_name: string;
  project_name: string;
  quantity: string;
  serial_number: string;
  snapshot_updated_at: string;
  work_order_created_at: string;
  work_order_id: string;
  work_order_number: string;
}

async function getSnapshot(
  database: PoolClient,
  workOrderId: string,
  expectedUpdatedAt: string,
): Promise<SnapshotRow[]> {
  return (await database.query<SnapshotRow>(
    `select
       snapshot.work_order_id,
       snapshot.work_order_number,
       snapshot.project_name,
       snapshot.customer_name_snapshot,
       snapshot.description,
       snapshot.work_order_created_at::text as work_order_created_at,
       snapshot.snapshot_updated_at::text as snapshot_updated_at,
       snapshot.material_position,
       snapshot.product_id,
       snapshot.serial_number,
       snapshot.product_name,
       snapshot.quantity
     from public.get_work_order_pdf_snapshot(
       $1::uuid, $2::timestamptz
     ) as snapshot`,
    [workOrderId, expectedUpdatedAt],
  )).rows;
}

async function addSecondMaterial(
  database: PoolClient,
  actorId: string,
  projectId: string,
  workOrderId: string,
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
    [productId, createTestSerialNumber(), `Snapshot Product ${productId}`, actorId],
  );
  await database.query(
    `update public.inventory_balances
     set quantity = 10, updated_at = pg_catalog.clock_timestamp()
     where product_id = $1::uuid`,
    [productId],
  );
  await database.query(
    `insert into public.project_products (
       id, project_id, name, created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::uuid, $3::text, $4::uuid, $4::uuid)`,
    [projectProductId, projectId, `Snapshot group ${projectProductId}`, actorId],
  );
  await database.query(
    `insert into public.project_product_components (
       project_product_id, product_id, required_quantity,
       created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::uuid, 10, $3::uuid, $3::uuid)`,
    [projectProductId, productId, actorId],
  );
  await database.query(
    `update public.work_order_items
     set added_at = '2026-09-29 12:00:02+00'::timestamptz
     where work_order_id = $1::uuid`,
    [workOrderId],
  );
  await database.query(
    `insert into public.work_order_items (
       work_order_id, product_id, quantity, added_at, added_by_user_id
     ) values (
       $1::uuid, $2::uuid, 2, '2026-09-29 12:00:01+00'::timestamptz, $3::uuid
     )`,
    [workOrderId, productId, actorId],
  );
  return productId;
}

export function registerWorkOrderPdfSnapshotTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe.skipIf(process.env.TASK119_MIGRATION !== "1")(
    "Task 119 trusted Work Order PDF snapshot (requires deployed migration)",
    () => {
      it("enforces Finish authority, exact projection, ordering, bigint text, and no mutation", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const actor = fixture.actors.unpermitted;
          const state = await createPreflightFixture(database, admin.profileId, {
            itemQuantity: "9007199254740993",
            physicalQuantity: "9007199254740993",
            requiredQuantity: "9007199254740993",
          });
          const secondProductId = await addSecondMaterial(
            database,
            admin.profileId,
            state.projectId!,
            state.workOrderId,
          );
          const before = (await database.query(
            `select
               work_order.status,
               work_order.updated_at::text,
               (select pg_catalog.count(*)::text from public.audit_logs
                where entity_id = work_order.id) as audit_count,
               (select pg_catalog.jsonb_object_agg(
                  balance.product_id::text, balance.quantity::text
                ) from public.inventory_balances as balance
                join public.work_order_items as item
                  on item.product_id = balance.product_id
                where item.work_order_id = work_order.id) as balances
             from public.work_orders as work_order
             where work_order.id = $1::uuid`,
            [state.workOrderId],
          )).rows[0];

          await actAs(database, admin);
          const adminRows = await getSnapshot(
            database,
            state.workOrderId,
            state.updatedAt,
          );
          expect(adminRows).toHaveLength(2);
          expect(adminRows.map((row) => row.material_position)).toEqual(["1", "2"]);
          expect(adminRows[0]?.product_id).toBe(secondProductId);
          expect(adminRows[1]).toMatchObject({
            product_id: state.productId,
            quantity: "9007199254740993",
            snapshot_updated_at: state.updatedAt,
            work_order_id: state.workOrderId,
            work_order_number: state.workOrderNumber,
          });
          expect(Object.keys(adminRows[0]!).sort()).toEqual([
            "customer_name_snapshot",
            "description",
            "material_position",
            "product_id",
            "product_name",
            "project_name",
            "quantity",
            "serial_number",
            "snapshot_updated_at",
            "work_order_created_at",
            "work_order_id",
            "work_order_number",
          ]);
          await database.query("reset role");

          await setOnlyRelevantPermission(
            database,
            actor,
            admin.profileId,
            "work_orders.finish",
          );
          await actAs(database, actor);
          expect(await getSnapshot(
            database,
            state.workOrderId,
            state.updatedAt,
          )).toHaveLength(2);
          await database.query("reset role");

          for (const permission of [null, "work_orders.view", "work_orders.edit_draft"] as const) {
            await setOnlyRelevantPermission(database, actor, admin.profileId, permission);
            await actAs(database, actor);
            await expectRejected(
              database,
              () => getSnapshot(database, state.workOrderId, state.updatedAt),
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
            () => getSnapshot(database, state.workOrderId, state.updatedAt),
            "42501",
          );
          await database.query("reset role");

          const after = (await database.query(
            `select
               work_order.status,
               work_order.updated_at::text,
               (select pg_catalog.count(*)::text from public.audit_logs
                where entity_id = work_order.id) as audit_count,
               (select pg_catalog.jsonb_object_agg(
                  balance.product_id::text, balance.quantity::text
                ) from public.inventory_balances as balance
                join public.work_order_items as item
                  on item.product_id = balance.product_id
                where item.work_order_id = work_order.id) as balances
             from public.work_orders as work_order
             where work_order.id = $1::uuid`,
            [state.workOrderId],
          )).rows[0];
          expect(after).toEqual(before);

          const metadata = (await database.query(
            `select
               language.lanname as language,
               routine.provolatile as volatility,
               routine.prosecdef as security_definer,
               routine.proconfig as settings,
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
               and routine.proname = 'get_work_order_pdf_snapshot'`,
          )).rows[0];
          expect(metadata).toEqual({
            anon_execute: false,
            authenticated_execute: true,
            language: "plpgsql",
            security_definer: true,
            settings: ['search_path=""'],
            volatility: "v",
          });
        });

        const anonymous = await fixture.anonymousClient.rpc(
          "get_work_order_pdf_snapshot",
          {
            p_expected_updated_at: "2026-09-29T12:34:56.123456Z",
            p_work_order_id: randomUUID(),
          },
        );
        expectPermissionDenied(anonymous.error);
      });

      it("inherits stale, lifecycle, Product, and Inventory validation without imposing Project-plan limits", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const valid = await createPreflightFixture(database, admin.profileId);
          await actAs(database, admin);
          expect(await getSnapshot(database, valid.workOrderId, valid.updatedAt)).toHaveLength(1);
          await expectRejected(
            database,
            () => getSnapshot(
              database,
              valid.workOrderId,
              "2026-09-29 12:34:56.123455+00",
            ),
            "WOR05",
          );
          await database.query("reset role");

          const finished = await createPreflightFixture(database, admin.profileId);
          await database.query(
            `update public.work_orders
             set status = 'finished',
                 finished_at = pg_catalog.clock_timestamp(),
                 finished_by_user_id = $2::uuid
             where id = $1::uuid`,
            [finished.workOrderId, admin.profileId],
          );
          const incomplete = await createPreflightFixture(database, admin.profileId, {
            includeItem: false,
          });
          const allocation = await createPreflightFixture(database, admin.profileId, {
            itemQuantity: "4",
            requiredQuantity: "3",
          });
          const archived = await createPreflightFixture(database, admin.profileId);
          await database.query(
            `update public.products
             set is_active = false,
                 archived_at = pg_catalog.clock_timestamp(),
                 archived_by_user_id = $2::uuid
             where id = $1::uuid`,
            [archived.productId, admin.profileId],
          );
          const missingBalance = await createPreflightFixture(database, admin.profileId);
          await database.query(
            "delete from public.inventory_balances where product_id = $1::uuid",
            [missingBalance.productId],
          );

          await actAs(database, admin);
          for (const [state, code] of [
            [finished, "WOR02"],
            [incomplete, "WOR07"],
            [archived, "PRD05"],
            [missingBalance, "IVB01"],
          ] as const) {
            await expectRejected(
              database,
              () => getSnapshot(database, state.workOrderId, state.updatedAt),
              code,
            );
          }
          if (
            process.env.GENERIC_WORK_ORDER_PLANNING_REFERENCE_MIGRATION === "1"
          ) {
            expect(await getSnapshot(
              database,
              allocation.workOrderId,
              allocation.updatedAt,
            )).toHaveLength(1);
          }
          await database.query("reset role");
        });
      });
    },
  );
}
