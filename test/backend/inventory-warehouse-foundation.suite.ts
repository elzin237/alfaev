import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { createTestSerialNumber } from "./helpers/serial";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const rawWarehouseId = "10000000-0000-4000-8000-000000000001";
const finishedGoodsWarehouseId = "10000000-0000-4000-8000-000000000002";

async function setActor(database: PoolClient, actor: SecurityActor | null) {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor?.authUserId ?? ""],
  );
  await database.query(actor ? "set local role authenticated" : "set local role anon");
}

async function insertProduct(database: PoolClient, actorId: string): Promise<string> {
  const productId = randomUUID();
  await database.query(
    `insert into public.products (
       id, serial_number, name, category, product_kind,
       created_by_user_id, updated_by_user_id
     ) values ($1, $2, 'Warehouse Product', 'Components', 'component', $3, $3)`,
    [productId, createTestSerialNumber(), actorId],
  );
  return productId;
}

interface CountRow extends QueryResultRow {
  count: string;
}

export function registerInventoryWarehouseFoundationTests(
  requireHarness: () => SecurityFixtureHarness,
) {
  describe.skipIf(process.env.INVENTORY_WAREHOUSE_FOUNDATION !== "1")(
    "Inventory warehouse compatibility foundation",
    () => {
      it("seeds only the three immutable canonical warehouses and preserves all existing history as Raw Materials", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const warehouses = await database.query(
            `select id, code, display_name, bosnian_name, sort_order
             from public.inventory_warehouses order by sort_order`,
          );
          expect(warehouses.rows).toEqual([
            {
              id: rawWarehouseId,
              code: "raw_materials",
              display_name: "Raw Materials",
              bosnian_name: "Skladište repromaterijala",
              sort_order: 1,
            },
            {
              id: finishedGoodsWarehouseId,
              code: "finished_goods",
              display_name: "Finished Goods",
              bosnian_name: "Skladište gotovih proizvoda",
              sort_order: 2,
            },
            {
              id: "10000000-0000-4000-8000-000000000003",
              code: "customs",
              display_name: "Customs Warehouse",
              bosnian_name: "Carinsko skladište",
              sort_order: 3,
            },
          ]);

          if (process.env.INVENTORY_WAREHOUSE_OPERATIONS !== "1") {
            for (const table of [
              "inventory_movements",
              "inventory_source_lots",
              "inventory_source_allocations",
            ]) {
              const unexpected = await database.query<CountRow>(
                `select count(*)::text as count from public.${table}
                 where warehouse_id <> $1::uuid`,
                [rawWarehouseId],
              );
              expect(unexpected.rows[0]?.count).toBe("0");
            }
          }

          await expect(database.query(
            `update public.inventory_warehouses set display_name = 'Changed'
             where id = $1::uuid`,
            [rawWarehouseId],
          )).rejects.toMatchObject({ code: "55000" });
        });
      });

      it("initializes one zero balance per Product and warehouse", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const productId = await insertProduct(database, harness.actors.admin.profileId);
          const balances = await database.query(
            `select warehouse.code, balance.quantity::text
             from public.inventory_balances as balance
             join public.inventory_warehouses as warehouse
               on warehouse.id = balance.warehouse_id
             where balance.product_id = $1::uuid
             order by warehouse.sort_order`,
            [productId],
          );
          expect(balances.rows).toEqual([
            { code: "raw_materials", quantity: "0" },
            { code: "finished_goods", quantity: "0" },
            { code: "customs", quantity: "0" },
          ]);
          await expect(database.query(
            `update public.inventory_balances set warehouse_id = $2::uuid
             where product_id = $1::uuid and warehouse_id = $3::uuid`,
            [productId, finishedGoodsWarehouseId, rawWarehouseId],
          )).rejects.toMatchObject({ code: "IVW02" });
        });
      });

      it("keeps legacy Inventory mutations and FIFO provenance in Raw Materials", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const actor = harness.actors.admin;
          const productId = await insertProduct(database, actor.profileId);
          const source = await createSupplierSourceFixture(database, actor, productId, {
            catalogNumber: "WAREHOUSE-RAW-001",
          });
          await database.query(
            "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
            [actor.authUserId],
          );
          await database.query(
            `select * from public.manual_adjust_inventory(
               $1::uuid, 'add', 7, 'Raw receipt', $2::uuid
             )`,
            [productId, source.productSupplierId],
          );
          await database.query(
            `select * from public.manual_adjust_inventory(
               $1::uuid, 'remove', 2, 'Raw FIFO use', null
             )`,
            [productId],
          );

          const balances = await database.query(
            `select warehouse_id, quantity::text
             from public.inventory_balances where product_id = $1::uuid
             order by warehouse_id`,
            [productId],
          );
          expect(balances.rows).toEqual([
            { warehouse_id: rawWarehouseId, quantity: "5" },
            { warehouse_id: finishedGoodsWarehouseId, quantity: "0" },
            {
              warehouse_id: "10000000-0000-4000-8000-000000000003",
              quantity: "0",
            },
          ]);
          const provenance = await database.query(
            `select
               (select count(*)::text from public.inventory_movements
                where product_id = $1 and warehouse_id <> $2) as foreign_movements,
               (select count(*)::text from public.inventory_source_lots
                where product_id = $1 and warehouse_id <> $2) as foreign_lots,
               (select count(*)::text from public.inventory_source_allocations
                where product_id = $1 and warehouse_id <> $2) as foreign_allocations`,
            [productId, rawWarehouseId],
          );
          expect(provenance.rows[0]).toEqual({
            foreign_movements: "0",
            foreign_lots: "0",
            foreign_allocations: "0",
          });
        });
      });

      it("rejects cross-warehouse source allocations through composite integrity", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const actor = harness.actors.admin;
          const productId = await insertProduct(database, actor.profileId);
          const source = await createSupplierSourceFixture(database, actor, productId, {
            catalogNumber: "WAREHOUSE-FK-001",
          });
          await database.query(
            "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
            [actor.authUserId],
          );
          await database.query(
            `select * from public.manual_adjust_inventory(
               $1::uuid, 'add', 3, 'Raw receipt', $2::uuid
             )`,
            [productId, source.productSupplierId],
          );
          const raw = await database.query<{ movement_id: string; lot_id: string }>(
            `select movement.id as movement_id, lot.id as lot_id
             from public.inventory_movements as movement
             join public.inventory_source_lots as lot
               on lot.originating_inventory_movement_id = movement.id
             where movement.product_id = $1::uuid
             order by movement.created_at desc limit 1`,
            [productId],
          );
          await database.query("savepoint cross_warehouse_allocation");
          try {
            await expect(database.query(
              `insert into public.inventory_source_allocations (
                 outbound_inventory_movement_id, source_lot_id, product_id,
                 warehouse_id, allocated_quantity
               ) values ($1, $2, $3, $4, 1)`,
              [
                raw.rows[0]?.movement_id,
                raw.rows[0]?.lot_id,
                productId,
                finishedGoodsWarehouseId,
              ],
            )).rejects.toMatchObject({ code: "23503" });
          } finally {
            await database.query("rollback to savepoint cross_warehouse_allocation");
            await database.query("release savepoint cross_warehouse_allocation");
          }
        });
      });

      it("keeps browser reads Raw-only and denies warehouse/table writes", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const productId = await insertProduct(database, harness.actors.admin.profileId);
          await setActor(database, harness.actors.brandManager);
          try {
            const visible = await database.query(
              `select warehouse_id from public.inventory_balances
               where product_id = $1::uuid`,
              [productId],
            );
            expect(visible.rows).toEqual([{ warehouse_id: rawWarehouseId }]);
            await database.query("savepoint denied_warehouse_read");
            try {
              await expect(database.query(
                "select * from public.inventory_warehouses",
              )).rejects.toMatchObject({ code: "42501" });
            } finally {
              await database.query("rollback to savepoint denied_warehouse_read");
              await database.query("release savepoint denied_warehouse_read");
            }
            await database.query("savepoint denied_balance_write");
            try {
              await expect(database.query(
                `update public.inventory_balances set quantity = 1
                 where product_id = $1::uuid and warehouse_id = $2::uuid`,
                [productId, rawWarehouseId],
              )).rejects.toMatchObject({ code: "42501" });
            } finally {
              await database.query("rollback to savepoint denied_balance_write");
              await database.query("release savepoint denied_balance_write");
            }
          } finally {
            await database.query("reset role");
          }
        });
      });

      it("preserves the exact trusted SECURITY DEFINER inventory", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const result = await database.query<CountRow>(
            `select count(*)::text as count
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             where namespace.nspname = 'public' and routine.prosecdef`,
          );
          expect(result.rows[0]?.count).toBe(
            process.env.INVENTORY_WAREHOUSE_OPERATIONS === "1" ? "174" : "166",
          );
        });
      });
    },
  );
}
