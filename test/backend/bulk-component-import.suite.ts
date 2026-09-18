import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";
import { expectPermissionDenied } from "./helpers/assertions";

interface ImportedRow {
  input_index: number;
  product_id: string;
  serial_number: string;
}

async function actAs(database: PoolClient, actor: SecurityActor): Promise<void> {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor.authUserId],
  );
  await database.query("set local role authenticated");
}

async function importRows(database: PoolClient, rows: unknown): Promise<ImportedRow[]> {
  return (await database.query<ImportedRow>(
    "select * from public.bulk_import_components($1::jsonb)",
    [rows === null ? null : JSON.stringify(rows)],
  )).rows;
}

export function registerBulkComponentImportTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  // Keep migration-dependent coverage opt-in for environments not yet migrated.
  describe.skipIf(process.env.TASK100B_MIGRATION !== "1")(
    "Task 100B trusted Component bulk import (requires deployed migration)", () => {
      it("keeps the bulk RPC SECURITY DEFINER, volatile, and authenticated-only", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const functionSecurity = (await database.query<{
            language: string; is_security_definer: boolean; volatility: string;
            settings: string[]; public_execute: boolean;
            authenticated_execute: boolean; anonymous_execute: boolean;
          }>(
            `select language.lanname as language,
                    routine.prosecdef as is_security_definer,
                    routine.provolatile as volatility,
                    routine.proconfig as settings,
                    exists (
                      select 1
                      from pg_catalog.aclexplode(routine.proacl) as privilege
                      where privilege.grantee = 0
                        and privilege.privilege_type = 'EXECUTE'
                    ) as public_execute,
                    pg_catalog.has_function_privilege(
                      'authenticated', routine.oid, 'execute'
                    ) as authenticated_execute,
                    pg_catalog.has_function_privilege(
                      'anon', routine.oid, 'execute'
                    ) as anonymous_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             join pg_catalog.pg_language as language
               on language.oid = routine.prolang
             where namespace.nspname = 'public'
               and routine.proname = 'bulk_import_components'`,
          )).rows;
          expect(functionSecurity).toEqual([{
            language: "plpgsql", is_security_definer: true, volatility: "v",
            settings: ['search_path=""'], public_execute: false,
            authenticated_execute: true, anonymous_execute: false,
          }]);
        });
      });

      it("allows only active Admin and inventory.products.create", async () => {
        const fixture = requireHarness();
        for (const actor of [fixture.actors.admin, fixture.actors.productCreator]) {
          await fixture.withRollbackDatabaseTransaction(async (database) => {
            await actAs(database, actor);
            const created = await importRows(database, [{
              name: `Authorized ${randomUUID()}`, category: "Components",
            }]);
            expect(created).toHaveLength(1);
            expect(created[0]?.serial_number).toMatch(/^[0-9]{7}$/);
            await database.query("reset role");
          });
        }

        for (const client of [
          fixture.anonymousClient,
          fixture.actors.unpermitted.client,
          fixture.actors.permitted.client,
          fixture.actors.productEditor.client,
          fixture.actors.brandManager.client,
          fixture.actors.inactive.client,
          fixture.actors.inactiveBrandManager.client,
        ]) {
          const { error } = await client.rpc("bulk_import_components", {
            p_rows: [{ name: `Denied ${randomUUID()}`, category: "Components" }],
          });
          expectPermissionDenied(error);
        }

        // Isolate inventory.view without the Brand-management grant carried by
        // the normal brandManager fixture.
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          await database.query(
            `insert into public.user_permissions
               (user_id, permission_definition_id, granted_by_user_id)
             select $1, definition.id, $2
             from public.permission_definitions as definition
             where definition.key = 'inventory.view'`,
            [fixture.actors.unpermitted.profileId, fixture.actors.admin.profileId],
          );
          await actAs(database, fixture.actors.unpermitted);
          await expect(importRows(database, [{ name: "View Only", category: "Parts" }]))
            .rejects.toMatchObject({ code: "42501" });
        });
      });

      it("rejects malformed, empty, excessive, injected, and blank rows before writes", async () => {
        const fixture = requireHarness();
        const valid = { name: `Bulk shape ${randomUUID()}`, category: "Components" };
        const badPayloads: unknown[] = [
          null, {}, [], Array.from({ length: 1001 }, () => valid),
          [null], [3], ["not an object"],
          [{ category: "Parts" }], [{ name: "Part" }],
          [{ name: null, category: "Parts" }],
          [{ name: 1, category: "Parts" }],
          [{ name: {}, category: "Parts" }],
          [{ name: "Part", category: false }],
          [{ name: "Part", category: [] }],
          [{ name: "Part", category: "Parts", brand: 12 }],
          [{ name: "Part", category: "Parts", brand: false }],
          [{ name: "Part", category: "Parts", brand: [] }],
          [{ name: "Part", category: "Parts", brand: {} }],
          [{ name: "  ", category: "Parts" }],
          [{ name: "Part", category: "  " }],
          ...[
            "extra", "serial_number", "product_kind", "product_id",
            "actor", "actor_id", "created_at", "updated_at",
            "quantity", "initial_quantity", "supplier", "catalog_number",
          ].map((key) => [{ ...valid, [key]: "untrusted" }]),
          [valid, { name: " ", category: "Parts" }],
        ];

        await fixture.withRollbackDatabaseTransaction(async (database) => {
          await actAs(database, fixture.actors.admin);
          for (const payload of badPayloads) {
            await database.query("savepoint invalid_bulk_payload");
            await expect(importRows(database, payload)).rejects.toMatchObject({ code: "22023" });
            await database.query("rollback to savepoint invalid_bulk_payload");
          }
          await database.query("reset role");
          const noProducts = await database.query<{ count: string }>(
            "select count(*) from public.products where name = $1", [valid.name],
          );
          expect(noProducts.rows[0]?.count).toBe("0");
        });
      });

      it("normalizes Brands and fields, preserves duplicate rows, zero balances, and one batch audit", async () => {
        const fixture = requireHarness();
        const brandId = randomUUID();
        const brandName = `Omron ${randomUUID()}`;
        const duplicateName = `Identical ${randomUUID()}`;
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          await database.query(
            `insert into public.brands
               (id, name, created_by_user_id, updated_by_user_id)
             values ($1, $2, $3, $3)`,
            [brandId, brandName, fixture.actors.admin.profileId],
          );
          await actAs(database, fixture.actors.productCreator);
          const created = await importRows(database, [
            { name: "  Board  ", category: "  Electronics  ", brand: brandName },
            { name: "Board Two", category: "Parts", brand: brandName.toUpperCase() },
            { name: "Board Three", category: "Parts", brand: `  ${brandName}  ` },
            { name: duplicateName, category: "Parts", brand: "   " },
            { name: duplicateName, category: "Parts", brand: null },
            { name: "No Brand", category: "Parts" },
          ]);
          await database.query("reset role");

          expect(created.map((row) => row.input_index)).toEqual([1, 2, 3, 4, 5, 6]);
          expect(new Set(created.map((row) => row.product_id)).size).toBe(6);
          expect(new Set(created.map((row) => row.serial_number)).size).toBe(6);
          expect(created.every((row) => /^[0-9]{7}$/.test(row.serial_number))).toBe(true);
          const ids = created.map((row) => row.product_id);
          const products = (await database.query<{
            id: string; name: string; category: string; brand_id: string | null;
            product_kind: string; is_active: boolean; created_by_user_id: string;
            updated_by_user_id: string; created_at: Date; updated_at: Date;
          }>(
            `select id, name, category, brand_id, product_kind, is_active,
                    created_by_user_id, updated_by_user_id, created_at, updated_at
             from public.products where id = any($1::uuid[])`, [ids],
          )).rows;
          expect(products).toHaveLength(6);
          expect(products.every((row) => row.is_active && row.product_kind === "component"
            && row.created_by_user_id === fixture.actors.productCreator.profileId
            && row.updated_by_user_id === fixture.actors.productCreator.profileId
            && row.created_at.getTime() === row.updated_at.getTime())).toBe(true);
          expect(products.find((row) => row.id === ids[0])).toMatchObject({
            name: "Board", category: "Electronics", brand_id: brandId,
          });
          expect(products.filter((row) => row.brand_id === brandId)).toHaveLength(3);
          expect(products.filter((row) => row.name === duplicateName)).toHaveLength(2);
          expect(products.filter((row) => row.brand_id === null)).toHaveLength(3);

          const balances = (await database.query<{ product_id: string; quantity: string }>(
            `select product_id, quantity from public.inventory_balances
             where product_id = any($1::uuid[])`, [ids],
          )).rows;
          expect(balances).toHaveLength(6);
          expect(balances.every((row) => row.quantity === "0")).toBe(true);
          for (const table of ["inventory_movements", "product_suppliers"] as const) {
            const count = (await database.query<{ count: string }>(
              `select count(*) from public.${table} where product_id = any($1::uuid[])`, [ids],
            )).rows[0]?.count;
            expect(count).toBe("0");
          }
          const audits = (await database.query<{
            actor_user_id: string; action_type: string; entity_type: string;
            entity_id: string | null; summary: string;
            after_data: { created_count: number; created_product_ids: string[] };
          }>(
            `select actor_user_id, action_type, entity_type, entity_id,
                    summary, after_data
             from public.audit_logs
             where action_type in ('product.bulk_imported', 'product.created')
               and (after_data->'created_product_ids' = $1::jsonb
                 or entity_id = any($2::uuid[]))`,
            [JSON.stringify(ids), ids],
          )).rows;
          expect(audits).toEqual([{
            actor_user_id: fixture.actors.productCreator.profileId,
            action_type: "product.bulk_imported",
            entity_type: "product",
            entity_id: null,
            summary: "Bulk imported 6 Components",
            after_data: { created_count: 6, created_product_ids: ids },
          }]);
        });
      });

      it("rejects unknown/archived Brands and leaves later-invalid batches untouched", async () => {
        const fixture = requireHarness();
        const archivedName = `Old Brand ${randomUUID()}`;
        const uniqueName = `Would Be Imported ${randomUUID()}`;
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const auditBefore = (await database.query<{ count: string }>(
            `select count(*) from public.audit_logs
             where action_type = 'product.bulk_imported' and actor_user_id = $1`,
            [fixture.actors.admin.profileId],
          )).rows[0]?.count;
          const balanceBefore = (await database.query<{ count: string }>(
            "select count(*) from public.inventory_balances",
          )).rows[0]?.count;
          const movementBefore = (await database.query<{ count: string }>(
            "select count(*) from public.inventory_movements",
          )).rows[0]?.count;
          await database.query(
            `insert into public.brands
               (name, is_active, created_by_user_id, updated_by_user_id,
                archived_at, archived_by_user_id)
             values ($1, false, $2, $2, pg_catalog.now(), $2)`,
            [archivedName, fixture.actors.admin.profileId],
          );
          await actAs(database, fixture.actors.admin);
          for (const brand of [archivedName, `Missing ${randomUUID()}`]) {
            await database.query("savepoint unavailable_brand");
            await expect(importRows(database, [
              { name: uniqueName, category: "Parts" },
              { name: "Later Row", category: "Parts", brand },
            ])).rejects.toMatchObject({ code: "PRD04" });
            await database.query("rollback to savepoint unavailable_brand");
          }
          const lateRows = Array.from({ length: 499 }, (_, index) => ({
            name: `${uniqueName} ${index}`, category: "Parts",
          }));
          await database.query("savepoint late_invalid_row");
          await expect(importRows(database, [...lateRows, {
            name: " ", category: "Parts",
          }])).rejects.toMatchObject({ code: "22023" });
          await database.query("rollback to savepoint late_invalid_row");
          await database.query("reset role");
          expect((await database.query<{ count: string }>(
            "select count(*) from public.products where name like $1", [`${uniqueName}%`],
          )).rows[0]?.count).toBe("0");
          expect((await database.query<{ count: string }>(
            `select count(*) from public.audit_logs
             where action_type = 'product.bulk_imported' and actor_user_id = $1`,
            [fixture.actors.admin.profileId],
          )).rows[0]?.count).toBe(auditBefore);
          expect((await database.query<{ count: string }>(
            "select count(*) from public.inventory_balances",
          )).rows[0]?.count).toBe(balanceBefore);
          expect((await database.query<{ count: string }>(
            "select count(*) from public.inventory_movements",
          )).rows[0]?.count).toBe(movementBefore);
        });
      });

      it("keeps concurrent authorized imports disjoint with unique Serials", async () => {
        const fixture = requireHarness();
        await fixture.withDatabaseClients(2, async ([adminDb, creatorDb]) => {
          if (!adminDb || !creatorDb) throw new Error("Import clients unavailable");
          await Promise.all([adminDb.query("begin"), creatorDb.query("begin")]);
          try {
            await Promise.all([
              actAs(adminDb, fixture.actors.admin),
              actAs(creatorDb, fixture.actors.productCreator),
            ]);
            const [first, second] = await Promise.all([
              importRows(adminDb, [
                { name: `Concurrent A ${randomUUID()}`, category: "Parts" },
                { name: `Concurrent A ${randomUUID()}`, category: "Parts" },
              ]),
              importRows(creatorDb, [
                { name: `Concurrent B ${randomUUID()}`, category: "Parts" },
                { name: `Concurrent B ${randomUUID()}`, category: "Parts" },
              ]),
            ]);
            const combined = [...first, ...second];
            expect(first.map((row) => row.input_index)).toEqual([1, 2]);
            expect(second.map((row) => row.input_index)).toEqual([1, 2]);
            expect(new Set(combined.map((row) => row.product_id)).size).toBe(4);
            expect(new Set(combined.map((row) => row.serial_number)).size).toBe(4);
            expect(combined.every((row) => /^[0-9]{7}$/.test(row.serial_number))).toBe(true);
            await Promise.all([adminDb.query("reset role"), creatorDb.query("reset role")]);
            for (const [database, imported] of [
              [adminDb, first], [creatorDb, second],
            ] as const) {
              const ids = imported.map((row) => row.product_id);
              expect((await database.query<{ count: string }>(
                `select count(*) from public.inventory_balances
                 where product_id = any($1::uuid[]) and quantity = 0`, [ids],
              )).rows[0]?.count).toBe("2");
              expect((await database.query<{ count: string }>(
                `select count(*) from public.audit_logs
                 where action_type = 'product.bulk_imported'
                   and after_data->'created_product_ids' = $1::jsonb`,
                [JSON.stringify(ids)],
              )).rows[0]?.count).toBe("1");
            }
          } finally {
            await Promise.all([adminDb.query("rollback"), creatorDb.query("rollback")]);
          }
        });
      });

      it("retains the normal per-Product create_product audit contract", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          await actAs(database, fixture.actors.productCreator);
          const normal = (await database.query<{ product_id: string; serial_number: string }>(
            "select * from public.create_product($1, $2, null)",
            [`Normal ${randomUUID()}`, "Components"],
          )).rows[0];
          await database.query("reset role");
          expect(normal?.serial_number).toMatch(/^[0-9]{7}$/);
          expect((await database.query<{ count: string }>(
            `select count(*) from public.audit_logs
             where action_type = 'product.created' and entity_id = $1`,
            [normal?.product_id],
          )).rows[0]?.count).toBe("1");
          expect((await database.query<{ quantity: string }>(
            "select quantity from public.inventory_balances where product_id = $1",
            [normal?.product_id],
          )).rows[0]?.quantity).toBe("0");
        });
      });

      it("accepts exactly 1000 valid rows in a rollback-safe transaction", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          await actAs(database, fixture.actors.productCreator);
          const prefix = `Thousand ${randomUUID()}`;
          const rows = Array.from({ length: 1000 }, (_, index) => ({
            name: `${prefix} ${index}`, category: "Components",
          }));
          const created = await importRows(database, rows);
          expect(created).toHaveLength(1000);
          expect(created.map((row) => row.input_index)).toEqual(
            Array.from({ length: 1000 }, (_, index) => index + 1),
          );
          expect(new Set(created.map((row) => row.product_id)).size).toBe(1000);
          expect(new Set(created.map((row) => row.serial_number)).size).toBe(1000);
          await database.query("reset role");
          expect((await database.query<{ count: string }>(
            `select count(*) from public.inventory_balances
             where product_id = any($1::uuid[]) and quantity = 0`,
            [created.map((row) => row.product_id)],
          )).rows[0]?.count).toBe("1000");
        });
      }, 120_000);
    },
  );
}
