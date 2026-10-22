import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import {
  isDisposableOrLocalBackendTarget,
  loadBackendTestEnvironment,
} from "./env";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { createTestSerialNumber } from "./helpers/serial";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const rawWarehouseId = "10000000-0000-4000-8000-000000000001";
const finishedWarehouseId = "10000000-0000-4000-8000-000000000002";
const customsWarehouseId = "10000000-0000-4000-8000-000000000003";

const warehousePermissions = [
  "inventory.raw_materials.view",
  "inventory.raw_materials.adjust",
  "inventory.finished_goods.view",
  "inventory.finished_goods.adjust",
  "inventory.customs.view",
  "inventory.customs.adjust",
] as const;

const committedConcurrencyIt = it.skipIf(
  !isDisposableOrLocalBackendTarget(loadBackendTestEnvironment().projectRef),
);

async function setActor(database: PoolClient, actor: SecurityActor | null) {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor?.authUserId ?? ""],
  );
  await database.query(actor ? "set local role authenticated" : "set local role anon");
}

async function grantPermissions(
  database: PoolClient,
  fixture: SecurityFixtureHarness,
  actor: SecurityActor,
  permissions: readonly string[],
) {
  await database.query(
    `insert into public.user_permissions (
       user_id, permission_definition_id, granted_by_user_id
     )
     select $1::uuid, definition.id, $2::uuid
     from public.permission_definitions as definition
     where definition.key = any($3::text[])
     on conflict (user_id, permission_definition_id) do nothing`,
    [actor.profileId, fixture.actors.admin.profileId, [...permissions]],
  );
}

async function createProduct(database: PoolClient, actorId: string) {
  const productId = randomUUID();
  await database.query(
    `insert into public.products (
       id, serial_number, name, category, product_kind,
       created_by_user_id, updated_by_user_id
     ) values ($1, $2, 'Warehouse Operation Product', 'Components',
       'component', $3, $3)`,
    [productId, createTestSerialNumber(), actorId],
  );
  return productId;
}

async function expectDatabaseError(
  database: PoolClient,
  sql: string,
  parameters: unknown[],
  code: string,
) {
  const savepoint = `warehouse_error_${randomUUID().replace(/-/g, "")}`;
  await database.query(`savepoint ${savepoint}`);
  try {
    await expect(database.query(sql, parameters)).rejects.toMatchObject({ code });
  } finally {
    await database.query(`rollback to savepoint ${savepoint}`);
    await database.query(`release savepoint ${savepoint}`);
  }
}

export function registerInventoryWarehouseOperationsTests(
  requireHarness: () => SecurityFixtureHarness,
) {
  describe.skipIf(process.env.INVENTORY_WAREHOUSE_OPERATIONS !== "1")(
    "Inventory warehouse permissions and operations",
    () => {
      it("defines six independent permissions and exposes them in canonical Admin order", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const definitions = await database.query<{ key: string }>(
            `select key from public.permission_definitions
             where key = any($1::text[])
             order by key`,
            [[...warehousePermissions]],
          );
          expect(definitions.rows.map((row) => row.key)).toEqual(
            [...warehousePermissions].sort(),
          );

          await setActor(database, fixture.actors.admin);
          const matrix = await database.query<{ permission_key: string }>(
            "select * from public.get_user_permissions_admin($1::uuid)",
            [fixture.actors.unpermitted.profileId],
          );
          await database.query("reset role");
          const inventoryKeys = matrix.rows
            .map((row) => row.permission_key)
            .filter((key) => key.startsWith("inventory."));
          expect(inventoryKeys).toEqual([
            "inventory.view",
            ...warehousePermissions,
            "inventory.products.create",
            "inventory.products.edit",
            "inventory.brands.manage",
            "inventory.barcodes.generate",
          ]);
        });
      });

      it("enforces warehouse view isolation, active-account checks, and Admin bypass", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const productId = await createProduct(database, fixture.actors.admin.profileId);
          await grantPermissions(database, fixture, fixture.actors.permitted, [
            "inventory.raw_materials.view",
          ]);
          await grantPermissions(database, fixture, fixture.actors.inactiveBrandManager, [
            "inventory.customs.view",
          ]);

          await setActor(database, fixture.actors.permitted);
          const raw = await database.query(
            "select * from public.get_inventory_product_by_warehouse($1, $2)",
            [productId, rawWarehouseId],
          );
          expect(raw.rows[0]).toMatchObject({
            product_id: productId,
            warehouse_id: rawWarehouseId,
            quantity: "0",
          });
          await expectDatabaseError(
            database,
            "select * from public.get_inventory_product_by_warehouse($1, $2)",
            [productId, finishedWarehouseId],
            "42501",
          );

          await database.query("reset role");
          await setActor(database, fixture.actors.admin);
          const adminRead = await database.query(
            "select public.get_inventory_stock_availability_by_warehouse($1, $2) as quantity",
            [productId, customsWarehouseId],
          );
          expect(adminRead.rows).toEqual([{ quantity: "0" }]);

          await database.query("reset role");
          await setActor(database, fixture.actors.inactiveBrandManager);
          await expectDatabaseError(
            database,
            "select * from public.search_inventory_products_by_warehouse($1, null)",
            [customsWarehouseId],
            "42501",
          );
          await database.query("reset role");
          await setActor(database, null);
          await expectDatabaseError(
            database,
            "select * from public.search_inventory_products_by_warehouse($1, null)",
            [rawWarehouseId],
            "42501",
          );
          await database.query("reset role");
        });
      });

      it("returns the complete warehouse-scoped Product detail without leaking other stock", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const brandId = randomUUID();
          const productId = randomUUID();
          const createdAt = "2026-01-02T03:04:05.000Z";
          const updatedAt = "2026-02-03T04:05:06.000Z";
          const archivedAt = "2026-03-04T05:06:07.000Z";
          await database.query(
            `insert into public.brands (
               id, name, is_active, created_at, created_by_user_id,
               updated_at, updated_by_user_id, archived_at, archived_by_user_id
             ) values (
               $1, 'Archived Warehouse Brand', false, $2, $5, $3, $5, $4, $5
             )`,
            [
              brandId,
              createdAt,
              updatedAt,
              archivedAt,
              fixture.actors.admin.profileId,
            ],
          );
          await database.query(
            `insert into public.products (
               id, serial_number, name, category, brand_id, product_kind,
               is_active, created_at, created_by_user_id, updated_at,
               updated_by_user_id, archived_at, archived_by_user_id
             ) values (
               $1, $2, 'Archived Warehouse Product', 'Components', $3,
               'component', false, $4, $7, $5, $7, $6, $7
             )`,
            [
              productId,
              createTestSerialNumber(),
              brandId,
              createdAt,
              updatedAt,
              archivedAt,
              fixture.actors.admin.profileId,
            ],
          );
          await grantPermissions(database, fixture, fixture.actors.permitted, [
            "inventory.raw_materials.view",
          ]);
          await grantPermissions(database, fixture, fixture.actors.brandManager, [
            "inventory.finished_goods.view",
          ]);
          await grantPermissions(database, fixture, fixture.actors.inactiveBrandManager, [
            "inventory.raw_materials.view",
          ]);

          await setActor(database, fixture.actors.permitted);
          const detail = await database.query(
            "select * from public.get_inventory_product_by_warehouse($1, $2)",
            [productId, rawWarehouseId],
          );
          expect(detail.rows).toHaveLength(1);
          expect(Object.keys(detail.rows[0] ?? {}).sort()).toEqual([
            "archived_at",
            "balance_updated_at",
            "brand_id",
            "brand_is_active",
            "brand_name",
            "category",
            "created_at",
            "is_active",
            "name",
            "product_id",
            "product_kind",
            "quantity",
            "serial_number",
            "updated_at",
            "warehouse_code",
            "warehouse_id",
          ]);
          expect(detail.rows[0]).toMatchObject({
            archived_at: new Date(archivedAt),
            brand_id: brandId,
            brand_is_active: false,
            brand_name: "Archived Warehouse Brand",
            created_at: new Date(createdAt),
            is_active: false,
            product_id: productId,
            quantity: "0",
            updated_at: new Date(updatedAt),
            warehouse_id: rawWarehouseId,
          });
          expect(detail.rows[0]?.balance_updated_at).toBeInstanceOf(Date);
          expect(detail.rows[0]?.balance_updated_at).not.toEqual(
            detail.rows[0]?.updated_at,
          );
          await expectDatabaseError(
            database,
            "select * from public.get_inventory_product_by_warehouse($1, $2)",
            [productId, finishedWarehouseId],
            "42501",
          );

          await database.query("reset role");
          await setActor(database, fixture.actors.brandManager);
          const finished = await database.query(
            "select * from public.get_inventory_product_by_warehouse($1, $2)",
            [productId, finishedWarehouseId],
          );
          expect(finished.rows[0]).toMatchObject({
            product_id: productId,
            quantity: "0",
            warehouse_id: finishedWarehouseId,
          });
          await expectDatabaseError(
            database,
            "select * from public.get_inventory_product_by_warehouse($1, $2)",
            [productId, customsWarehouseId],
            "42501",
          );

          await database.query("reset role");
          await setActor(database, fixture.actors.admin);
          const admin = await database.query(
            "select * from public.get_inventory_product_by_warehouse($1, $2)",
            [productId, customsWarehouseId],
          );
          expect(admin.rows[0]).toMatchObject({
            product_id: productId,
            quantity: "0",
            warehouse_id: customsWarehouseId,
          });

          await database.query("reset role");
          await setActor(database, fixture.actors.inactiveBrandManager);
          await expectDatabaseError(
            database,
            "select * from public.get_inventory_product_by_warehouse($1, $2)",
            [productId, rawWarehouseId],
            "42501",
          );
          await database.query("reset role");
          await setActor(database, null);
          await expectDatabaseError(
            database,
            "select * from public.get_inventory_product_by_warehouse($1, $2)",
            [productId, rawWarehouseId],
            "42501",
          );
          await database.query("reset role");
        });
      });

      it("returns only active Supplier sources to the matching warehouse adjuster", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const productId = await createProduct(database, fixture.actors.admin.profileId);
          const active = await createSupplierSourceFixture(
            database,
            fixture.actors.admin,
            productId,
            {
              catalogNumber: "WAREHOUSE-SOURCE-ACTIVE",
              description: "Approved source choice",
              supplierName: "Active Warehouse Supplier",
            },
          );
          const archivedSupplier = await createSupplierSourceFixture(
            database,
            fixture.actors.admin,
            productId,
            {
              catalogNumber: "WAREHOUSE-SOURCE-ARCHIVED-SUPPLIER",
              supplierName: "Archived Warehouse Supplier",
            },
          );
          const archivedRelationship = await createSupplierSourceFixture(
            database,
            fixture.actors.admin,
            productId,
            {
              catalogNumber: "WAREHOUSE-SOURCE-ARCHIVED-RELATIONSHIP",
              supplierName: "Detached Warehouse Supplier",
            },
          );

          await setActor(database, fixture.actors.admin);
          await database.query("select public.archive_supplier($1)", [
            archivedSupplier.supplierId,
          ]);
          await database.query("select public.archive_product_supplier($1)", [
            archivedRelationship.productSupplierId,
          ]);
          const legacyAdmin = await database.query(
            "select * from public.list_active_inventory_source_choices($1)",
            [productId],
          );
          expect(legacyAdmin.rows.map((row) => row.product_supplier_id)).toEqual([
            active.productSupplierId,
          ]);
          const warehouseAdmin = await database.query(
            `select * from public.list_active_inventory_source_choices_by_warehouse(
               $1, $2
             )`,
            [productId, rawWarehouseId],
          );
          expect(warehouseAdmin.rows.map((row) => row.product_supplier_id)).toEqual([
            active.productSupplierId,
          ]);
          await database.query("reset role");

          await grantPermissions(database, fixture, fixture.actors.permitted, [
            "inventory.finished_goods.adjust",
          ]);
          await grantPermissions(database, fixture, fixture.actors.unpermitted, [
            "inventory.finished_goods.view",
          ]);
          await grantPermissions(database, fixture, fixture.actors.brandManager, [
            "inventory.customs.adjust",
          ]);
          await grantPermissions(database, fixture, fixture.actors.inactiveBrandManager, [
            "inventory.finished_goods.adjust",
          ]);

          await setActor(database, fixture.actors.permitted);
          const choices = await database.query(
            `select * from public.list_active_inventory_source_choices_by_warehouse(
               $1, $2
             )`,
            [productId, finishedWarehouseId],
          );
          expect(choices.rows).toEqual([{
            catalog_number: active.catalogNumber,
            description: "Approved source choice",
            product_supplier_id: active.productSupplierId,
            supplier_id: active.supplierId,
            supplier_name: "Active Warehouse Supplier",
          }]);
          expect(Object.keys(choices.rows[0] ?? {}).sort()).toEqual([
            "catalog_number",
            "description",
            "product_supplier_id",
            "supplier_id",
            "supplier_name",
          ]);
          await expectDatabaseError(
            database,
            "select * from public.list_active_inventory_source_choices($1)",
            [productId],
            "42501",
          );
          await expectDatabaseError(
            database,
            `select * from public.list_active_inventory_source_choices_by_warehouse(
               $1, $2
             )`,
            [randomUUID(), finishedWarehouseId],
            "P0002",
          );
          await expectDatabaseError(
            database,
            `select * from public.list_active_inventory_source_choices_by_warehouse(
               $1, $2
             )`,
            [productId, randomUUID()],
            "P0002",
          );

          await database.query("reset role");
          await setActor(database, fixture.actors.unpermitted);
          await expectDatabaseError(
            database,
            `select * from public.list_active_inventory_source_choices_by_warehouse(
               $1, $2
             )`,
            [productId, finishedWarehouseId],
            "42501",
          );
          await database.query("reset role");
          await setActor(database, fixture.actors.brandManager);
          await expectDatabaseError(
            database,
            `select * from public.list_active_inventory_source_choices_by_warehouse(
               $1, $2
             )`,
            [productId, finishedWarehouseId],
            "42501",
          );
          await database.query("reset role");
          await setActor(database, fixture.actors.inactiveBrandManager);
          await expectDatabaseError(
            database,
            `select * from public.list_active_inventory_source_choices_by_warehouse(
               $1, $2
             )`,
            [productId, finishedWarehouseId],
            "42501",
          );
          await database.query("reset role");
          await setActor(database, null);
          await expectDatabaseError(
            database,
            `select * from public.list_active_inventory_source_choices_by_warehouse(
               $1, $2
             )`,
            [productId, finishedWarehouseId],
            "42501",
          );
          await database.query("reset role");
        });
      });

      it("keeps view and adjust independent while preserving adjustment semantics and lot accounting", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.permitted;
          const productId = await createProduct(database, fixture.actors.admin.profileId);
          const source = await createSupplierSourceFixture(
            database,
            fixture.actors.admin,
            productId,
            { catalogNumber: "WAREHOUSE-ADJUST-001" },
          );
          await grantPermissions(database, fixture, actor, [
            "inventory.finished_goods.adjust",
          ]);

          await setActor(database, actor);
          const added = await database.query(
            `select * from public.adjust_inventory_warehouse(
               $1, $2, 'add', 10, 'Finished receipt', $3
             )`,
            [productId, finishedWarehouseId, source.productSupplierId],
          );
          expect(added.rows[0]).toMatchObject({
            warehouse_id: finishedWarehouseId,
            quantity_before: "0",
            quantity_after: "10",
          });
          const removed = await database.query(
            `select * from public.adjust_inventory_warehouse(
               $1, $2, 'remove', 3, 'Finished use', null
             )`,
            [productId, finishedWarehouseId],
          );
          expect(removed.rows[0]).toMatchObject({ quantity_after: "7" });
          const corrected = await database.query(
            `select * from public.adjust_inventory_warehouse(
               $1, $2, 'correction', 5, 'Count correction', null
             )`,
            [productId, finishedWarehouseId],
          );
          expect(corrected.rows[0]).toMatchObject({ quantity_after: "5" });

          await expectDatabaseError(
            database,
            "select * from public.get_inventory_product_by_warehouse($1, $2)",
            [productId, finishedWarehouseId],
            "42501",
          );
          await expectDatabaseError(
            database,
            `select * from public.adjust_inventory_warehouse(
               $1, $2, 'correction', 5, 'No change', null
             )`,
            [productId, finishedWarehouseId],
            "MIA02",
          );
          await expectDatabaseError(
            database,
            `select * from public.adjust_inventory_warehouse(
               $1, $2, 'remove', 6, 'Too much', null
             )`,
            [productId, finishedWarehouseId],
            "IVB02",
          );
          await expectDatabaseError(
            database,
            `select * from public.adjust_inventory_warehouse(
               $1, $2, 'add', 0, 'Invalid zero', $3
             )`,
            [productId, finishedWarehouseId, source.productSupplierId],
            "MIA01",
          );
          await expectDatabaseError(
            database,
            `select * from public.adjust_inventory_warehouse(
               $1, $2, 'correction', -1, 'Invalid correction', null
             )`,
            [productId, finishedWarehouseId],
            "MIA01",
          );
          await expectDatabaseError(
            database,
            `select * from public.adjust_inventory_warehouse(
               $1, $2, 'add', 1, 'Wrong warehouse', $3
             )`,
            [productId, customsWarehouseId, source.productSupplierId],
            "42501",
          );
          await database.query("reset role");

          await grantPermissions(database, fixture, actor, [
            "inventory.finished_goods.view",
          ]);
          await setActor(database, actor);
          const search = await database.query(
            "select * from public.search_inventory_products_by_warehouse($1, $2)",
            [finishedWarehouseId, "Warehouse Operation"],
          );
          // Ordinary Products may still hold stock here, but only Calculator
          // outputs belong to the Finished Goods list. Detail/history stay readable.
          expect(search.rows).toEqual([]);
          const detail = await database.query(
            "select * from public.get_inventory_product_by_warehouse($1, $2)",
            [productId, finishedWarehouseId],
          );
          expect(detail.rows[0]).toMatchObject({
            product_id: productId,
            warehouse_id: finishedWarehouseId,
            quantity: "5",
          });
          const history = await database.query(
            "select * from public.get_inventory_movements_for_product_by_warehouse($1, $2)",
            [productId, finishedWarehouseId],
          );
          expect(history.rows).toHaveLength(3);
          expect(history.rows.every((row) =>
            row.warehouse_id === finishedWarehouseId
          )).toBe(true);
          const lots = await database.query(
            "select * from public.list_inventory_source_lots_by_warehouse($1, $2)",
            [productId, finishedWarehouseId],
          );
          expect(lots.rows).toHaveLength(1);
          expect(lots.rows[0]).toMatchObject({
            warehouse_id: finishedWarehouseId,
            remaining_quantity: "5",
          });
          await database.query("reset role");

          await database.query(
            `update public.products
             set is_active = false,
                 updated_at = pg_catalog.now(),
                 updated_by_user_id = $2,
                 archived_at = pg_catalog.now(),
                 archived_by_user_id = $2
             where id = $1`,
            [productId, fixture.actors.admin.profileId],
          );
          await setActor(database, actor);
          await expectDatabaseError(
            database,
            `select * from public.adjust_inventory_warehouse(
               $1, $2, 'remove', 1, 'Archived denial', null
             )`,
            [productId, finishedWarehouseId],
            "PRD01",
          );
          await database.query("reset role");

          const invariant = await database.query(
            `select
               balance.quantity::text as balance_quantity,
               coalesce(sum(lot.remaining_quantity), 0)::text as lot_quantity
             from public.inventory_balances as balance
             left join public.inventory_source_lots as lot
               on lot.product_id = balance.product_id
               and lot.warehouse_id = balance.warehouse_id
             where balance.product_id = $1 and balance.warehouse_id = $2
             group by balance.quantity`,
            [productId, finishedWarehouseId],
          );
          expect(invariant.rows).toEqual([{
            balance_quantity: "5",
            lot_quantity: "5",
          }]);
          const movements = await database.query(
            `select count(*)::integer as count
             from public.inventory_movements
             where product_id = $1 and warehouse_id = $2`,
            [productId, finishedWarehouseId],
          );
          expect(movements.rows).toEqual([{ count: 3 }]);
        });
      });

      it("transfers atomically with paired movements, conservation, and traceable provenance", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.permitted;
          const productId = await createProduct(database, fixture.actors.admin.profileId);
          const source = await createSupplierSourceFixture(
            database,
            fixture.actors.admin,
            productId,
            { catalogNumber: "WAREHOUSE-TRANSFER-001" },
          );
          await setActor(database, fixture.actors.admin);
          await database.query(
            "select * from public.manual_adjust_inventory($1, 'add', 10, 'Raw receipt', $2)",
            [productId, source.productSupplierId],
          );
          await database.query("reset role");
          await grantPermissions(database, fixture, actor, [
            "inventory.raw_materials.adjust",
            "inventory.finished_goods.adjust",
          ]);

          await setActor(database, actor);
          const transfer = await database.query(
            `select * from public.transfer_inventory_between_warehouses(
               $1, $2, $3, 4, 'Move finished stock'
             )`,
            [productId, rawWarehouseId, finishedWarehouseId],
          );
          expect(transfer.rows[0]).toMatchObject({
            source_quantity_after: "6",
            destination_quantity_after: "4",
          });
          await database.query("reset role");

          const balances = await database.query(
            `select warehouse_id, quantity::text
             from public.inventory_balances
             where product_id = $1
             order by warehouse_id`,
            [productId],
          );
          expect(balances.rows).toEqual([
            { warehouse_id: rawWarehouseId, quantity: "6" },
            { warehouse_id: finishedWarehouseId, quantity: "4" },
            { warehouse_id: customsWarehouseId, quantity: "0" },
          ]);
          expect(balances.rows.reduce(
            (sum, row) => sum + BigInt(row.quantity), 0n,
          )).toBe(10n);

          const transferId = transfer.rows[0]?.transfer_id;
          const movementRows = await database.query(
            `select warehouse_id, movement_type, quantity_delta::text,
                    source_type, source_id
             from public.inventory_movements
             where source_type = 'warehouse_transfer' and source_id = $1
             order by warehouse_id`,
            [transferId],
          );
          expect(movementRows.rows).toEqual([
            {
              warehouse_id: rawWarehouseId,
              movement_type: "warehouse_transfer_out",
              quantity_delta: "-4",
              source_type: "warehouse_transfer",
              source_id: transferId,
            },
            {
              warehouse_id: finishedWarehouseId,
              movement_type: "warehouse_transfer_in",
              quantity_delta: "4",
              source_type: "warehouse_transfer",
              source_id: transferId,
            },
          ]);
          const provenance = await database.query(
            `select
               (select coalesce(sum(allocated_quantity), 0)::text
                from public.inventory_source_allocations
                where outbound_inventory_movement_id = $1) as source_allocated,
               (select coalesce(sum(remaining_quantity), 0)::text
                from public.inventory_source_lots
                where product_id = $2 and warehouse_id = $3) as source_remaining,
               (select coalesce(sum(remaining_quantity), 0)::text
                from public.inventory_source_lots
                where product_id = $2 and warehouse_id = $4
                  and source_kind = 'warehouse_transfer') as destination_received`,
            [
              transfer.rows[0]?.outbound_movement_id,
              productId,
              rawWarehouseId,
              finishedWarehouseId,
            ],
          );
          expect(provenance.rows).toEqual([{
            source_allocated: "4",
            source_remaining: "6",
            destination_received: "4",
          }]);
          const audit = await database.query(
            `select count(*)::integer as count from public.audit_logs
             where action_type = 'inventory.warehouse_transferred'
               and entity_id = $1`,
            [productId],
          );
          expect(audit.rows).toEqual([{ count: 1 }]);
        });
      });

      it("requires adjustment authority in both transfer warehouses and preserves state on denial", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.unpermitted;
          const productId = await createProduct(database, fixture.actors.admin.profileId);
          await grantPermissions(database, fixture, actor, [
            "inventory.raw_materials.adjust",
          ]);
          await setActor(database, actor);
          await expectDatabaseError(
            database,
            `select * from public.transfer_inventory_between_warehouses(
               $1, $2, $3, 1, 'Unauthorized destination'
             )`,
            [productId, rawWarehouseId, finishedWarehouseId],
            "42501",
          );
          await database.query("reset role");
          const state = await database.query(
            `select sum(quantity)::text as total,
                    (select count(*)::integer from public.inventory_movements
                     where product_id = $1) as movements
             from public.inventory_balances where product_id = $1`,
            [productId],
          );
          expect(state.rows).toEqual([{ total: "0", movements: 0 }]);
        });
      });

      it("hardens transfer storage, browser ACLs, and the exact SECURITY DEFINER inventory", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const metadata = await database.query<{
            anonymous_execute: boolean;
            authenticated_execute: boolean;
            function_name: string;
            proconfig: string[];
            prosecdef: boolean;
            public_execute: boolean;
          }>(
            `select
               routine.proname as function_name,
               routine.prosecdef,
               routine.proconfig,
               pg_catalog.has_function_privilege(
                 'anon', routine.oid, 'EXECUTE'
               ) as anonymous_execute,
               pg_catalog.has_function_privilege(
                 'authenticated', routine.oid, 'EXECUTE'
               ) as authenticated_execute,
               pg_catalog.has_function_privilege(
                 'public', routine.oid, 'EXECUTE'
               ) as public_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             where namespace.nspname = 'public'
               and routine.proname = any($1::text[])
             order by routine.proname`,
            [[
              "adjust_inventory_warehouse",
              "get_inventory_movements_for_product_by_warehouse",
              "get_inventory_product_by_warehouse",
              "get_inventory_stock_availability_by_warehouse",
              "list_active_inventory_source_choices_by_warehouse",
              "list_inventory_source_lots_by_warehouse",
              "search_inventory_products_by_warehouse",
              "transfer_inventory_between_warehouses",
            ]],
          );
          expect(metadata.rows).toHaveLength(8);
          for (const row of metadata.rows) {
            expect(row).toMatchObject({
              anonymous_execute: false,
              authenticated_execute: true,
              prosecdef: true,
              public_execute: false,
            });
            expect(row.proconfig).toEqual(["search_path=\"\""]);
          }

          const security = await database.query(
            `select
               (select count(*)::integer
                from pg_catalog.pg_proc as routine
                join pg_catalog.pg_namespace as namespace
                  on namespace.oid = routine.pronamespace
                where namespace.nspname = 'public' and routine.prosecdef)
                  as security_definer_count,
               pg_catalog.has_table_privilege(
                 'authenticated', 'public.inventory_warehouse_transfers', 'SELECT'
               ) as transfer_select,
               pg_catalog.has_table_privilege(
                 'authenticated', 'public.inventory_warehouse_transfers', 'INSERT'
               ) as transfer_insert,
               pg_catalog.has_table_privilege(
                 'authenticated', 'public.inventory_warehouse_transfers', 'UPDATE'
               ) as transfer_update,
               pg_catalog.has_table_privilege(
                 'authenticated', 'public.inventory_warehouse_transfers', 'DELETE'
               ) as transfer_delete,
               (select target.relrowsecurity
                from pg_catalog.pg_class as target
                join pg_catalog.pg_namespace as namespace
                  on namespace.oid = target.relnamespace
                where namespace.nspname = 'public'
                  and target.relname = 'inventory_warehouse_transfers') as transfer_rls,
               (select count(*)::integer from pg_catalog.pg_policy as policy
                join pg_catalog.pg_class as target on target.oid = policy.polrelid
                join pg_catalog.pg_namespace as namespace
                  on namespace.oid = target.relnamespace
                where namespace.nspname = 'public'
                  and target.relname = 'inventory_warehouse_transfers')
                  as transfer_policy_count,
               pg_catalog.has_function_privilege(
                 'authenticated',
                 'public.apply_inventory_delta_in_warehouse(uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text)',
                 'EXECUTE'
               ) as internal_apply_execute`,
          );
          expect(security.rows).toEqual([{
            security_definer_count: 174,
            transfer_delete: false,
            transfer_select: false,
            transfer_insert: false,
            transfer_policy_count: 0,
            transfer_rls: true,
            transfer_update: false,
            internal_apply_execute: false,
          }]);
        });
      });

      committedConcurrencyIt("serializes transfers, adjustment races, and permission revocation without overspend or deadlock", async () => {
        const fixture = requireHarness();
        const productId = randomUUID();
        const actor = fixture.actors.permitted;

        await fixture.withDatabaseClients(3, async (clients) => {
          const first = clients[0];
          const second = clients[1];
          const observer = clients[2];
          if (!first || !second || !observer) {
            throw new Error("Warehouse concurrency clients are unavailable");
          }

          await observer.query("begin");
          await observer.query(
            `insert into public.products (
               id, serial_number, name, category, product_kind,
               created_by_user_id, updated_by_user_id
             ) values ($1, $2, 'Warehouse Concurrency Product', 'Components',
               'component', $3, $3)`,
            [productId, createTestSerialNumber(), fixture.actors.admin.profileId],
          );
          const source = await createSupplierSourceFixture(
            observer,
            fixture.actors.admin,
            productId,
            { catalogNumber: "WAREHOUSE-CONCURRENCY-001" },
          );
          await grantPermissions(observer, fixture, actor, [
            "inventory.raw_materials.adjust",
            "inventory.finished_goods.adjust",
          ]);
          await setActor(observer, fixture.actors.admin);
          await observer.query(
            "select * from public.manual_adjust_inventory($1, 'add', 10, 'Concurrent seed', $2)",
            [productId, source.productSupplierId],
          );
          await observer.query("reset role");
          await observer.query("commit");

          const runActorTransaction = async <Result>(
            client: PoolClient,
            operation: () => Promise<Result>,
          ): Promise<{ ok: true; value: Result } | { ok: false; code: string }> => {
            await client.query("begin");
            await setActor(client, actor);
            try {
              const value = await operation();
              await client.query("commit");
              return { ok: true, value };
            } catch (error) {
              await client.query("rollback");
              return {
                ok: false,
                code: typeof error === "object" && error !== null && "code" in error
                  ? String(error.code)
                  : "unknown",
              };
            }
          };

          await first.query("begin");
          await setActor(first, actor);
          const affordable = await first.query(
            `select * from public.transfer_inventory_between_warehouses(
               $1, $2, $3, 7, 'Affordable concurrent transfer'
             )`,
            [productId, rawWarehouseId, finishedWarehouseId],
          );
          expect(affordable.rows[0]).toMatchObject({
            source_quantity_after: "3",
            destination_quantity_after: "7",
          });

          await second.query("begin");
          await second.query(
            "select pg_catalog.set_config('application_name', $1::text, true)",
            [`warehouse-transfer-wait-${randomUUID()}`],
          );
          await setActor(second, actor);
          const unaffordable = second.query(
            `select * from public.transfer_inventory_between_warehouses(
               $1, $2, $3, 6, 'Competing transfer'
             )`,
            [productId, rawWarehouseId, finishedWarehouseId],
          ).then(
            () => ({ code: "unexpected_success" }),
            (error: unknown) => ({
              code: typeof error === "object" && error !== null && "code" in error
                ? String(error.code)
                : "unknown",
            }),
          );
          await first.query("commit");
          expect(await unaffordable).toEqual({ code: "IVB02" });
          await second.query("rollback");

          await first.query("begin");
          await setActor(first, actor);
          await first.query(
            `select * from public.transfer_inventory_between_warehouses(
               $1, $2, $3, 1, 'Transfer before revoke'
             )`,
            [productId, rawWarehouseId, finishedWarehouseId],
          );
          const revoke = second.query(
            `delete from public.user_permissions as grant_row
             using public.permission_definitions as definition
             where grant_row.permission_definition_id = definition.id
               and grant_row.user_id = $1
               and definition.key = 'inventory.finished_goods.adjust'`,
            [actor.profileId],
          );
          await first.query("commit");
          expect((await revoke).rowCount).toBe(1);

          const deniedAfterRevoke = await runActorTransaction(second, () =>
            second.query(
              `select * from public.transfer_inventory_between_warehouses(
                 $1, $2, $3, 1, 'Denied after revoke'
               )`,
              [productId, rawWarehouseId, finishedWarehouseId],
            )
          );
          expect(deniedAfterRevoke).toEqual({ ok: false, code: "42501" });

          await grantPermissions(observer, fixture, actor, [
            "inventory.finished_goods.adjust",
          ]);
          const [transferRace, adjustmentRace] = await Promise.all([
            runActorTransaction(first, () => first.query(
              `select * from public.transfer_inventory_between_warehouses(
                 $1, $2, $3, 1, 'Transfer versus adjustment'
               )`,
              [productId, rawWarehouseId, finishedWarehouseId],
            )),
            runActorTransaction(second, () => second.query(
              `select * from public.adjust_inventory_warehouse(
                 $1, $2, 'remove', 1, 'Concurrent finished issue', null
               )`,
              [productId, finishedWarehouseId],
            )),
          ]);
          expect(transferRace.ok).toBe(true);
          expect(adjustmentRace.ok).toBe(true);

          const finalState = await observer.query(
            `select
               (select quantity::text from public.inventory_balances
                where product_id = $1 and warehouse_id = $2) as raw_quantity,
               (select quantity::text from public.inventory_balances
                where product_id = $1 and warehouse_id = $3) as finished_quantity,
               (select count(*)::integer from public.inventory_warehouse_transfers
                where product_id = $1) as transfer_count,
               (select count(*)::integer from public.inventory_movements
                where product_id = $1 and source_type = 'warehouse_transfer')
                  as transfer_movement_count`,
            [productId, rawWarehouseId, finishedWarehouseId],
          );
          expect(finalState.rows).toEqual([{
            raw_quantity: "1",
            finished_quantity: "8",
            transfer_count: 3,
            transfer_movement_count: 6,
          }]);
        });
      });
    },
  );
}
