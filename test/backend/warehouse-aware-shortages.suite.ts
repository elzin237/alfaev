import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { createTestSerialNumber } from "./helpers/serial";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const raw = "10000000-0000-4000-8000-000000000001";
const finished = "10000000-0000-4000-8000-000000000002";
const customs = "10000000-0000-4000-8000-000000000003";

async function setActor(database: PoolClient, actor: SecurityActor | null) {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor?.authUserId ?? ""],
  );
  await database.query(actor ? "set local role authenticated" : "set local role anon");
}

async function callAs<Row extends QueryResultRow>(
  database: PoolClient,
  actor: SecurityActor | null,
  statement: string,
  values: unknown[] = [],
) {
  await database.query("savepoint warehouse_shortage_actor");
  try {
    await setActor(database, actor);
    const rows = (await database.query<Row>(statement, values)).rows;
    await database.query("reset role");
    await database.query("release savepoint warehouse_shortage_actor");
    return rows;
  } catch (error) {
    await database.query("rollback to savepoint warehouse_shortage_actor");
    await database.query("release savepoint warehouse_shortage_actor");
    await database.query("reset role");
    throw error;
  }
}

async function flush(database: PoolClient) {
  await database.query(
    "set constraints project_shortage_reconciliation_queue_process immediate",
  );
  await database.query(
    "set constraints project_shortage_reconciliation_queue_process deferred",
  );
}

async function grant(
  database: PoolClient,
  actor: SecurityActor,
  granter: SecurityActor,
  keys: string[],
) {
  await database.query(
    `insert into public.user_permissions (
       user_id, permission_definition_id, granted_by_user_id
     )
     select $1::uuid, definition.id, $2::uuid
     from public.permission_definitions as definition
     where definition.key = any($3::text[])
     on conflict (user_id, permission_definition_id) do nothing`,
    [actor.profileId, granter.profileId, keys],
  );
}

async function createFixture(
  database: PoolClient,
  actorId: string,
  requiredQuantity = 20,
) {
  const productId = randomUUID();
  const projectId = randomUUID();
  const groupId = randomUUID();
  await database.query(
    `insert into public.products (
       id, serial_number, name, category, product_kind,
       created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::text, $3::text, 'Warehouse planning',
       'component', $4::uuid, $4::uuid)`,
    [productId, createTestSerialNumber(), `Warehouse shortage ${productId}`, actorId],
  );
  await database.query(
    `insert into public.projects (
       id, name, customer_name, status, start_date, delivery_date,
       created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::text, 'Warehouse Customer', 'planned',
       '2026-10-22'::date, '2026-11-22'::date, $3::uuid, $3::uuid)`,
    [projectId, `Warehouse shortage Project ${projectId}`, actorId],
  );
  await database.query(
    `insert into public.project_products (
       id, project_id, name, created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::uuid, 'Warehouse Assembly', $3::uuid, $3::uuid)`,
    [groupId, projectId, actorId],
  );
  await database.query(
    `insert into public.project_product_components (
       project_product_id, product_id, required_quantity,
       created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::uuid, $3::bigint, $4::uuid, $4::uuid)`,
    [groupId, productId, requiredQuantity, actorId],
  );
  return { groupId, productId, projectId };
}

async function setBalance(
  database: PoolClient,
  productId: string,
  warehouseId: string,
  quantity: number,
) {
  await database.query(
    `update public.inventory_balances
     set quantity = $3::bigint
     where product_id = $1::uuid and warehouse_id = $2::uuid`,
    [productId, warehouseId, quantity],
  );
}

export function registerWarehouseAwareShortageTests(
  requireHarness: () => SecurityFixtureHarness,
) {
  describe.skipIf(process.env.WAREHOUSE_AWARE_SHORTAGES !== "1")(
    "warehouse-aware Project commitments and shortages",
    () => {
      it("uses Raw plus Customs, excludes Finished Goods, and preserves source-independent consumption", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const actor = harness.actors.admin;
          const created = await createFixture(database, actor.profileId);
          await setBalance(database, created.productId, raw, 4);
          await setBalance(database, created.productId, customs, 6);
          await setBalance(database, created.productId, finished, 100);
          await flush(database);

          const read = await callAs<{
            available_after_commitments: string;
            committed_to_projects: string;
            physical_quantity: string;
            product_id: string;
          }>(database, actor,
            "select * from public.get_inventory_project_commitments() where product_id = $1::uuid",
            [created.productId],
          );
          expect(read).toEqual([{
            product_id: created.productId,
            physical_quantity: "10",
            committed_to_projects: "20",
            available_after_commitments: "-10",
          }]);

          const episode = await database.query<{ current_shortage_quantity: string }>(
            `select current_shortage_quantity::text
             from public.project_shortage_episodes
             where project_id = $1::uuid and product_id = $2::uuid
               and resolved_at is null`,
            [created.projectId, created.productId],
          );
          expect(episode.rows).toEqual([{ current_shortage_quantity: "10" }]);

          for (const warehouseId of [raw, customs, finished]) {
            await database.query(
              `insert into public.inventory_movements (
                 product_id, warehouse_id, movement_type, quantity_delta,
                 quantity_before, quantity_after, source_type, source_id,
                 project_id, actor_user_id
               ) values ($1::uuid, $2::uuid, 'work_order', -2, 100, 98,
                 'work_order', $3::uuid, $4::uuid, $5::uuid)`,
              [created.productId, warehouseId, randomUUID(), created.projectId, actor.profileId],
            );
          }
          const commitment = await database.query<{
            actual_project_consumption: string;
            outstanding_commitment: string;
          }>(
            `select actual_project_consumption::text, outstanding_commitment::text
             from public.calculate_open_project_commitments($1::uuid)`,
            [created.productId],
          );
          expect(commitment.rows).toEqual([{
            actual_project_consumption: "6",
            outstanding_commitment: "14",
          }]);
        });
      });

      it("withholds combined stock unless both eligible warehouse views are authorized", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const admin = harness.actors.admin;
          const reader = harness.actors.permitted;
          const created = await createFixture(database, admin.profileId, 8);
          await setBalance(database, created.productId, raw, 3);
          await setBalance(database, created.productId, customs, 4);
          await flush(database);
          await grant(database, reader, admin, [
            "projects.view", "inventory.raw_materials.view",
          ]);

          const hidden = await callAs<Record<string, unknown>>(
            database, reader,
            "select * from public.get_project_planning($1::uuid)",
            [created.projectId],
          );
          expect(hidden).toEqual([expect.objectContaining({
            product_id: created.productId,
            physical_quantity: null,
            committed_to_projects: null,
            available_after_commitments: null,
          })]);
          await expect(callAs(
            database, reader,
            "select * from public.get_inventory_project_commitments()",
          )).rejects.toMatchObject({ code: "42501" });

          await grant(database, reader, admin, ["inventory.customs.view"]);
          const visible = await callAs<Record<string, unknown>>(
            database, reader,
            "select * from public.get_project_planning($1::uuid)",
            [created.projectId],
          );
          expect(visible).toEqual([expect.objectContaining({
            product_id: created.productId,
            physical_quantity: "7",
            committed_to_projects: "8",
            available_after_commitments: "-1",
          })]);
          const aggregate = await callAs<{ product_id: string }>(
            database, reader,
            "select product_id from public.get_inventory_project_commitments() where product_id = $1::uuid",
            [created.productId],
          );
          expect(aggregate).toEqual([{ product_id: created.productId }]);
        });
      });

      it("reconciles eligible transfers once from final state and ignores Finished-only changes", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const actor = harness.actors.admin;
          const created = await createFixture(database, actor.profileId, 15);
          const source = await createSupplierSourceFixture(
            database, actor, created.productId,
            { catalogNumber: "WAREHOUSE-SHORTAGE-001" },
          );
          await setActor(database, actor);
          await database.query(
            `select * from public.adjust_inventory_warehouse(
               $1::uuid, $2::uuid, 'add', 10, 'Shortage stock', $3::uuid
             )`,
            [created.productId, raw, source.productSupplierId],
          );
          await database.query("reset role");
          await flush(database);

          const counts = async () => (await database.query<{
            alerts: number; events: number; quantity: string;
          }>(
            `select
               (select count(*)::integer from public.project_shortage_events
                where project_id = $1::uuid and product_id = $2::uuid) as events,
               (select count(*)::integer from public.project_activity_alerts
                where project_id = $1::uuid and product_id = $2::uuid) as alerts,
               (select current_shortage_quantity::text
                from public.project_shortage_episodes
                where project_id = $1::uuid and product_id = $2::uuid
                  and resolved_at is null) as quantity`,
            [created.projectId, created.productId],
          )).rows[0];
          expect(await counts()).toEqual({ alerts: 1, events: 1, quantity: "5" });

          const transfer = async (from: string, to: string, quantity: number) => {
            await setActor(database, actor);
            await database.query(
              `select * from public.transfer_inventory_between_warehouses(
                 $1::uuid, $2::uuid, $3::uuid, $4::bigint, 'Shortage transfer'
               )`,
              [created.productId, from, to, quantity],
            );
            await database.query("reset role");
            await flush(database);
          };

          await transfer(raw, customs, 2);
          await transfer(customs, raw, 1);
          expect(await counts()).toEqual({ alerts: 1, events: 1, quantity: "5" });

          await transfer(raw, finished, 3);
          expect(await counts()).toEqual({ alerts: 1, events: 2, quantity: "8" });
          await transfer(finished, customs, 2);
          expect(await counts()).toEqual({ alerts: 1, events: 3, quantity: "6" });

          await setActor(database, actor);
          await database.query(
            `select * from public.adjust_inventory_warehouse(
               $1::uuid, $2::uuid, 'add', 4, 'Finished-only stock', $3::uuid
             )`,
            [created.productId, finished, source.productSupplierId],
          );
          await database.query("reset role");
          await flush(database);
          expect(await counts()).toEqual({ alerts: 1, events: 3, quantity: "6" });
        });
      });

      it("rolls back eligible-stock and derived shortage changes atomically", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const created = await createFixture(
            database, harness.actors.admin.profileId, 10,
          );
          await setBalance(database, created.productId, raw, 5);
          await flush(database);
          const before = (await database.query(
            `select
               (select quantity::text from public.inventory_balances
                where product_id = $1::uuid and warehouse_id = $2::uuid) as raw,
               (select count(*)::integer from public.project_shortage_events
                where project_id = $3::uuid and product_id = $1::uuid) as events`,
            [created.productId, raw, created.projectId],
          )).rows[0];

          await database.query("savepoint warehouse_shortage_rollback");
          await setBalance(database, created.productId, raw, 10);
          await flush(database);
          await database.query("rollback to savepoint warehouse_shortage_rollback");
          await database.query("release savepoint warehouse_shortage_rollback");

          const after = (await database.query(
            `select
               (select quantity::text from public.inventory_balances
                where product_id = $1::uuid and warehouse_id = $2::uuid) as raw,
               (select count(*)::integer from public.project_shortage_events
                where project_id = $3::uuid and product_id = $1::uuid) as events`,
            [created.productId, raw, created.projectId],
          )).rows[0];
          expect(after).toEqual(before);
        });
      });

      it("serializes simultaneous Raw and Customs changes without duplicate episodes or deadlock", async () => {
        const harness = requireHarness();
        await harness.withDatabaseClients(2, async ([first, second]) => {
          if (!first || !second) throw new Error("Task 001G concurrency clients are missing");

          await first.query("begin");
          const created = await createFixture(
            first, harness.actors.admin.profileId, 20,
          );
          const source = await createSupplierSourceFixture(
            first, harness.actors.admin, created.productId,
            { catalogNumber: "WAREHOUSE-SHORTAGE-CONCURRENT" },
          );
          await first.query("commit");

          await first.query("begin");
          await second.query("begin");
          await setActor(first, harness.actors.admin);
          await setActor(second, harness.actors.admin);
          await first.query(
            `select * from public.adjust_inventory_warehouse(
               $1::uuid, $2::uuid, 'add', 2,
               'Concurrent Raw adjustment', $3::uuid
             )`,
            [created.productId, raw, source.productSupplierId],
          );
          let secondCompleted = false;
          const secondAdjustment = second.query(
            `select * from public.adjust_inventory_warehouse(
               $1::uuid, $2::uuid, 'add', 3,
               'Concurrent Customs adjustment', $3::uuid
             )`,
            [created.productId, customs, source.productSupplierId],
          ).then(() => { secondCompleted = true; });
          await new Promise((resolve) => setTimeout(resolve, 100));
          expect(secondCompleted).toBe(false);
          await first.query("commit");
          await secondAdjustment;
          await second.query("commit");

          const result = (await first.query<{
            active_episodes: number;
            alerts: number;
            events: number;
            shortage: string;
          }>(
            `select
               (select count(*)::integer from public.project_shortage_episodes
                where project_id = $1::uuid and product_id = $2::uuid
                  and resolved_at is null) as active_episodes,
               (select count(*)::integer from public.project_shortage_events
                where project_id = $1::uuid and product_id = $2::uuid) as events,
               (select count(*)::integer from public.project_activity_alerts
                where project_id = $1::uuid and product_id = $2::uuid) as alerts,
               (select current_shortage_quantity::text
                from public.project_shortage_episodes
                where project_id = $1::uuid and product_id = $2::uuid
                  and resolved_at is null) as shortage`,
            [created.projectId, created.productId],
          )).rows[0];
          expect(result).toEqual({
            active_episodes: 1,
            alerts: 1,
            events: 3,
            shortage: "15",
          });

          await first.query("begin");
          await first.query(
            "select public.reconcile_project_shortages_for_products(array[$1::uuid], false)",
            [created.productId],
          );
          await first.query("commit");
          expect((await first.query<{ events: number }>(
            `select count(*)::integer as events
             from public.project_shortage_events
             where project_id = $1::uuid and product_id = $2::uuid`,
            [created.projectId, created.productId],
          )).rows[0]?.events).toBe(3);
        });
      });
    },
  );
}
