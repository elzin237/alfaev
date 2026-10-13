import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createTestSerialNumber } from "./helpers/serial";
import type { SecurityFixtureHarness } from "./security-fixtures";

interface BalanceRow {
  quantity: string;
}

interface LotRow {
  catalog_number_snapshot: string | null;
  description: string | null;
  received_quantity: string;
  remaining_quantity: string;
  source_kind: string;
  supplier_name_snapshot: string | null;
}

interface AllocationRow {
  allocated_quantity: string;
  catalog_number_snapshot: string | null;
}

interface AccountingRow {
  allocated_quantity: string;
  balance_quantity: string;
  consumed_quantity: string;
  remaining_quantity: string;
}

interface AclRow {
  allocations_authenticated_insert: boolean;
  allocations_authenticated_select: boolean;
  lots_anon_select: boolean;
  lots_authenticated_insert: boolean;
  lots_authenticated_select: boolean;
  source_choices_authenticated_execute: boolean;
  source_history_authenticated_execute: boolean;
}

export function registerInventorySourceProvenanceTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe.skipIf(process.env.SUPPLIER_PROVENANCE_MIGRATIONS !== "1")(
    "Supplier Catalog inventory provenance (requires local migrations 115A-115C)",
    () => {
      it("creates exact Supplier lots and consumes them FIFO across removal and correction", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const productId = randomUUID();
          const supplierAId = randomUUID();
          const supplierBId = randomUUID();
          const relationAId = randomUUID();
          const relationBId = randomUUID();

          await database.query(
            `insert into public.products (
               id, serial_number, name, category, product_kind,
               created_by_user_id, updated_by_user_id
             ) values (
               $1::uuid, $2::text, 'Provenance Relay', 'Components', 'component',
               $3::uuid, $3::uuid
             )`,
            [productId, createTestSerialNumber(), actor.profileId],
          );
          await database.query(
            `insert into public.suppliers (
               id, name, country, created_by_user_id, updated_by_user_id
             ) values
               ($1::uuid, 'Provenance Supplier A', 'BA', $3::uuid, $3::uuid),
               ($2::uuid, 'Provenance Supplier B', 'BA', $3::uuid, $3::uuid)`,
            [supplierAId, supplierBId, actor.profileId],
          );
          await database.query(
            `insert into public.product_suppliers (
               id, product_id, supplier_id, catalog_number, description,
               created_by_user_id, updated_by_user_id
             ) values
               ($1::uuid, $3::uuid, $4::uuid, 'CAT-A', 'Supplier A relay', $6::uuid, $6::uuid),
               ($2::uuid, $3::uuid, $5::uuid, 'CAT-B', null, $6::uuid, $6::uuid)`,
            [
              relationAId,
              relationBId,
              productId,
              supplierAId,
              supplierBId,
              actor.profileId,
            ],
          );
          await database.query(
            "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
            [actor.authUserId],
          );

          await database.query(
            "select * from public.manual_adjust_inventory($1::uuid, 'add', 5, 'Supplier A receipt', $2::uuid)",
            [productId, relationAId],
          );
          await database.query(
            "select * from public.manual_adjust_inventory($1::uuid, 'add', 7, 'Supplier B receipt', $2::uuid)",
            [productId, relationBId],
          );
          const removal = await database.query<{ movement_id: string }>(
            "select movement_id from public.manual_adjust_inventory($1::uuid, 'remove', 8, 'FIFO removal', null)",
            [productId],
          );

          const lotsAfterRemoval = await database.query<LotRow>(
            `select source_kind, supplier_name_snapshot, catalog_number_snapshot,
                    supplier_description_snapshot as description,
                    received_quantity::text, remaining_quantity::text
             from public.inventory_source_lots
             where product_id = $1::uuid
             order by received_at, id`,
            [productId],
          );
          expect(lotsAfterRemoval.rows).toEqual([
            {
              catalog_number_snapshot: "CAT-A",
              description: "Supplier A relay",
              received_quantity: "5",
              remaining_quantity: "0",
              source_kind: "supplier",
              supplier_name_snapshot: "Provenance Supplier A",
            },
            {
              catalog_number_snapshot: "CAT-B",
              description: null,
              received_quantity: "7",
              remaining_quantity: "4",
              source_kind: "supplier",
              supplier_name_snapshot: "Provenance Supplier B",
            },
          ]);
          const removalAllocations = await database.query<AllocationRow>(
            `select allocation.allocated_quantity::text,
                    lot.catalog_number_snapshot
             from public.inventory_source_allocations as allocation
             join public.inventory_source_lots as lot
               on lot.id = allocation.source_lot_id
             where allocation.outbound_inventory_movement_id = $1::uuid
             order by lot.received_at, lot.id`,
            [removal.rows[0]?.movement_id],
          );
          expect(removalAllocations.rows).toEqual([
            { allocated_quantity: "5", catalog_number_snapshot: "CAT-A" },
            { allocated_quantity: "3", catalog_number_snapshot: "CAT-B" },
          ]);

          await database.query(
            "select * from public.manual_adjust_inventory($1::uuid, 'correction', 10, 'Upward correction', $2::uuid)",
            [productId, relationBId],
          );
          await database.query(
            "select * from public.manual_adjust_inventory($1::uuid, 'correction', 3, 'Downward correction', null)",
            [productId],
          );

          const accounting = await database.query<AccountingRow>(
            `select
               balance.quantity::text as balance_quantity,
               pg_catalog.sum(lot.remaining_quantity)::text as remaining_quantity,
               pg_catalog.sum(lot.received_quantity - lot.remaining_quantity)::text as consumed_quantity,
               (select coalesce(pg_catalog.sum(allocation.allocated_quantity), 0)::text
                from public.inventory_source_allocations as allocation
                where allocation.product_id = $1::uuid) as allocated_quantity
             from public.inventory_balances as balance
             join public.inventory_source_lots as lot on lot.product_id = balance.product_id
             where balance.product_id = $1::uuid
             group by balance.quantity`,
            [productId],
          );
          expect(accounting.rows).toEqual([{
            allocated_quantity: "15",
            balance_quantity: "3",
            consumed_quantity: "15",
            remaining_quantity: "3",
          }]);
        });
      });

      it("rejects missing, mismatched, archived, and inactive inbound sources atomically", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const productId = randomUUID();
          const otherProductId = randomUUID();
          const supplierId = randomUUID();
          const inactiveSupplierId = randomUUID();
          const validRelationId = randomUUID();
          const wrongProductRelationId = randomUUID();
          const archivedRelationId = randomUUID();
          const inactiveSupplierRelationId = randomUUID();
          const serialA = createTestSerialNumber();
          const serialB = createTestSerialNumber();

          await database.query(
            `insert into public.products (
               id, serial_number, name, category, product_kind,
               created_by_user_id, updated_by_user_id
             ) values
               ($1::uuid, $3::text, 'Source Target', 'Components', 'component', $5::uuid, $5::uuid),
               ($2::uuid, $4::text, 'Source Other', 'Components', 'component', $5::uuid, $5::uuid)`,
            [productId, otherProductId, serialA, serialB, actor.profileId],
          );
          await database.query(
            `insert into public.suppliers (
               id, name, country, is_active, created_by_user_id, updated_by_user_id,
               archived_at, archived_by_user_id
             ) values
               ($1::uuid, 'Source Supplier', 'BA', true, $3::uuid, $3::uuid, null, null),
               ($2::uuid, 'Inactive Source Supplier', 'BA', false, $3::uuid, $3::uuid,
                pg_catalog.now(), $3::uuid)`,
            [supplierId, inactiveSupplierId, actor.profileId],
          );
          await database.query(
            `insert into public.product_suppliers (
               id, product_id, supplier_id, catalog_number, description, is_active,
               created_by_user_id, updated_by_user_id, archived_at, archived_by_user_id
             ) values
               ($1::uuid, $5::uuid, $6::uuid, 'VALID', null, true, $8::uuid, $8::uuid, null, null),
               ($2::uuid, $9::uuid, $6::uuid, 'WRONG', null, true, $8::uuid, $8::uuid, null, null),
               ($3::uuid, $5::uuid, $6::uuid, 'ARCHIVED', null, false, $8::uuid, $8::uuid,
                pg_catalog.now(), $8::uuid),
               ($4::uuid, $5::uuid, $7::uuid, 'INACTIVE-SUPPLIER', null, true,
                $8::uuid, $8::uuid, null, null)`,
            [
              validRelationId,
              wrongProductRelationId,
              archivedRelationId,
              inactiveSupplierRelationId,
              productId,
              supplierId,
              inactiveSupplierId,
              actor.profileId,
              otherProductId,
            ],
          );
          await database.query(
            "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
            [actor.authUserId],
          );

          for (const relationId of [null, wrongProductRelationId, archivedRelationId, inactiveSupplierRelationId]) {
            await database.query("savepoint rejected_source");
            await expect(database.query(
              "select * from public.manual_adjust_inventory($1::uuid, 'add', 1, 'Rejected source', $2::uuid)",
              [productId, relationId],
            )).rejects.toMatchObject({ code: "IVL03" });
            await database.query("rollback to savepoint rejected_source");
          }

          await database.query(
            "select * from public.manual_adjust_inventory($1::uuid, 'add', 2, 'Valid source', $2::uuid)",
            [productId, validRelationId],
          );
          await database.query("savepoint insufficient_remove");
          await expect(database.query(
            "select * from public.manual_adjust_inventory($1::uuid, 'remove', 3, 'Too much', null)",
            [productId],
          )).rejects.toMatchObject({ code: "IVB02" });
          await database.query("rollback to savepoint insufficient_remove");

          const balance = await database.query<BalanceRow>(
            "select quantity::text from public.inventory_balances where product_id = $1::uuid",
            [productId],
          );
          const lots = await database.query<LotRow>(
            `select source_kind, supplier_name_snapshot, catalog_number_snapshot,
                    supplier_description_snapshot as description,
                    received_quantity::text, remaining_quantity::text
             from public.inventory_source_lots where product_id = $1::uuid`,
            [productId],
          );
          expect(balance.rows).toEqual([{ quantity: "2" }]);
          expect(lots.rows).toEqual([expect.objectContaining({
            catalog_number_snapshot: "VALID",
            received_quantity: "2",
            remaining_quantity: "2",
          })]);
        });
      });

      it("keeps lot/allocation tables private and exposes only the narrow authenticated RPCs", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const acl = await database.query<AclRow>(
            `select
               pg_catalog.has_table_privilege('anon', 'public.inventory_source_lots', 'SELECT') as lots_anon_select,
               pg_catalog.has_table_privilege('authenticated', 'public.inventory_source_lots', 'SELECT') as lots_authenticated_select,
               pg_catalog.has_table_privilege('authenticated', 'public.inventory_source_lots', 'INSERT') as lots_authenticated_insert,
               pg_catalog.has_table_privilege('authenticated', 'public.inventory_source_allocations', 'SELECT') as allocations_authenticated_select,
               pg_catalog.has_table_privilege('authenticated', 'public.inventory_source_allocations', 'INSERT') as allocations_authenticated_insert,
               pg_catalog.has_function_privilege('authenticated', 'public.list_active_inventory_source_choices(uuid)', 'EXECUTE') as source_choices_authenticated_execute,
               pg_catalog.has_function_privilege('authenticated', 'public.list_inventory_source_lots(uuid)', 'EXECUTE') as source_history_authenticated_execute`,
          );
          expect(acl.rows).toEqual([{
            allocations_authenticated_insert: false,
            allocations_authenticated_select: false,
            lots_anon_select: false,
            lots_authenticated_insert: false,
            lots_authenticated_select: false,
            source_choices_authenticated_execute: true,
            source_history_authenticated_execute: true,
          }]);
        });
      });

      it("denies direct provenance table access and deferred-helper execution to browser roles", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          let attempt = 0;
          const deniedSql = [
            "select * from public.inventory_source_lots limit 1",
            "insert into public.inventory_source_lots default values",
            "update public.inventory_source_lots set remaining_quantity = remaining_quantity where false",
            "delete from public.inventory_source_lots where false",
            "select * from public.inventory_source_allocations limit 1",
            "insert into public.inventory_source_allocations default values",
            "update public.inventory_source_allocations set allocated_quantity = allocated_quantity where false",
            "delete from public.inventory_source_allocations where false",
            "select public.check_inventory_source_lot_balance()",
            "select public.check_inventory_source_lot_allocation_accounting()",
          ];
          for (const role of ["authenticated", "anon"] as const) {
            for (const sql of deniedSql) {
              attempt += 1;
              const savepoint = `provenance_attack_${attempt}`;
              await database.query(`savepoint ${savepoint}`);
              await database.query(
                "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
                [role === "authenticated" ? fixture.actors.admin.authUserId : ""],
              );
              await database.query(`set local role ${role}`);
              await expect(database.query(sql)).rejects.toMatchObject({ code: "42501" });
              await database.query(`rollback to savepoint ${savepoint}`);
              await database.query(`release savepoint ${savepoint}`);
            }
          }
        });
      });
    },
  );
}
