import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { createTestSerialNumber } from "./helpers/serial";
import type { SecurityFixtureHarness } from "./security-fixtures";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260930120000_add_inventory_reversal_foundation.sql",
);
const ledgerMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260914110000_create_inventory_movement_schema.sql",
);
const primitiveMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260914120000_add_trusted_inventory_mutation_primitive.sql",
);
const auditHelperMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260904132604_add_trusted_audit_append_helper.sql",
);

interface CountRow {
  count: number;
}

interface FoundationSnapshotRow {
  audit_logs: string;
  work_order_items: string;
  work_order_pdfs: string;
  work_orders: string;
}

async function snapshotHistoricalWorkOrderState(
  database: PoolClient,
): Promise<FoundationSnapshotRow> {
  return (await database.query<FoundationSnapshotRow>(
    `select
       (select pg_catalog.count(*) from public.work_orders)::text as work_orders,
       (select pg_catalog.count(*) from public.work_order_items)::text as work_order_items,
       (select pg_catalog.count(*) from public.work_order_pdfs)::text as work_order_pdfs,
       (select pg_catalog.count(*) from public.audit_logs)::text as audit_logs`,
  )).rows[0]!;
}

export function registerInventoryReversalFoundationTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 127 Inventory reversal foundation (static)", () => {
    it("adds narrow internal integrity without exposing a correction operation", () => {
      const sql = readFileSync(migrationPath, "utf8");
      const ledgerSql = readFileSync(ledgerMigrationPath, "utf8");
      const primitiveSql = readFileSync(primitiveMigrationPath, "utf8");
      const auditSql = readFileSync(auditHelperMigrationPath, "utf8");

      expect(sql).toContain("inventory_movements_reversal_context_consistent");
      expect(sql).toContain("reversal_of_movement_id is not null");
      expect(sql).toContain("source_type = 'correction_reversal'");
      expect(sql).toContain("reason is not null");
      expect(sql).toContain("original.id = new.reversal_of_movement_id");
      expect(sql).toContain("original_product_id is distinct from new.product_id");
      expect(sql).toContain("before insert");
      expect(sql).toContain("security invoker");
      expect(sql).toContain("set search_path = ''");
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain("append");
      expect(sql).toContain("AuditLog");

      expect(sql).not.toMatch(/grant\s+execute/i);
      expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function\s+public\.(correct|reverse)/i);
      expect(sql).not.toMatch(/\b(update|delete)\s+public\.inventory_movements/i);
      expect(sql).not.toMatch(/\b(update|delete)\s+public\.(work_orders|work_order_items|work_order_pdfs|audit_logs)/i);
      expect(sql).not.toMatch(/\b(insert|update|delete)\s+public\.projects/i);

      expect(ledgerSql).toContain("inventory_movements_reversal_of_movement_id_fkey");
      expect(ledgerSql).toContain("references public.inventory_movements(id)");
      expect(ledgerSql).toContain("inventory_movements_reversal_not_self");
      expect(ledgerSql).toContain("inventory_movements_reason_trimmed_nonblank");
      expect(ledgerSql).toContain("inventory_movements_reject_update_delete");
      expect(primitiveSql).toContain("p_reversal_of_movement_id uuid default null");
      expect(primitiveSql).toContain("p_reversal_of_movement_id\n  )");
      expect(primitiveSql).toContain("from public, anon, authenticated");
      expect(primitiveSql).not.toContain("append_audit_log");
      expect(auditSql).toContain("create function public.append_audit_log(");
      expect(auditSql).toContain("actor_profile_id := public.current_active_user_profile_id()");
      expect(auditSql).toContain("p_before_data");
      expect(auditSql).toContain("p_after_data");
      expect(auditSql).toContain("p_metadata");
      expect(auditSql).toContain("from public, anon, authenticated");
    });
  });

  describe.skipIf(process.env.TASK127_MIGRATION !== "1")(
    "Task 127 Inventory reversal foundation (requires deployed migration)",
    () => {
      it("enforces reversal integrity through the existing atomic internal primitive", async () => {
        const fixture = requireHarness();

        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const originalProductId = randomUUID();
          const otherProductId = randomUUID();
          await database.query(
            `insert into public.products (
               id, serial_number, name, category, product_kind,
               created_by_user_id, updated_by_user_id
             ) values
               ($1::uuid, $3::text, 'Reversal Original Product', 'Components',
                'component', $5::uuid, $5::uuid),
               ($2::uuid, $4::text, 'Reversal Other Product', 'Components',
                'component', $5::uuid, $5::uuid)`,
            [
              originalProductId,
              otherProductId,
              createTestSerialNumber(),
              createTestSerialNumber(),
              actor.profileId,
            ],
          );
          await database.query(
            "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
            [actor.authUserId],
          );

          const original = (await database.query<{ movement_id: string }>(
            `select movement_id
             from public.apply_inventory_delta($1::uuid, 7, 'fixture_receipt')`,
            [originalProductId],
          )).rows[0]!;
          const historyBefore = await snapshotHistoricalWorkOrderState(database);

          const reversal = (await database.query<{
            movement_id: string;
            quantity_after: string;
            quantity_before: string;
          }>(
            `select *
             from public.apply_inventory_delta(
               $1::uuid, -7, 'correction_reversal', 'Correct fixture receipt',
               'correction_reversal', null, null, $2::uuid
             )`,
            [originalProductId, original.movement_id],
          )).rows[0]!;
          expect(reversal).toMatchObject({
            movement_id: expect.any(String),
            quantity_after: "0",
            quantity_before: "7",
          });

          const stored = (await database.query<{
            actor_user_id: string;
            created_at: Date;
            product_id: string;
            reason: string;
            reversal_of_movement_id: string;
            source_type: string;
          }>(
            `select actor_user_id, created_at, product_id, reason,
                    reversal_of_movement_id, source_type
             from public.inventory_movements
             where id = $1::uuid`,
            [reversal.movement_id],
          )).rows[0]!;
          expect(stored).toMatchObject({
            actor_user_id: actor.profileId,
            created_at: expect.any(Date),
            product_id: originalProductId,
            reason: "Correct fixture receipt",
            reversal_of_movement_id: original.movement_id,
            source_type: "correction_reversal",
          });

          for (const invalid of [
            {
              code: "23514",
              name: "blank_reason",
              productId: originalProductId,
              delta: "1",
              reason: "   ",
              sourceType: "correction_reversal",
              referenceId: original.movement_id,
            },
            {
              code: "23514",
              name: "different_product",
              productId: otherProductId,
              delta: "1",
              reason: "Wrong Product",
              sourceType: "correction_reversal",
              referenceId: original.movement_id,
            },
            {
              code: "23503",
              name: "missing_reference",
              productId: originalProductId,
              delta: "1",
              reason: "Missing original",
              sourceType: "correction_reversal",
              referenceId: randomUUID(),
            },
            {
              code: "IVB02",
              name: "negative_balance",
              productId: originalProductId,
              delta: "-1",
              reason: "Would overspend",
              sourceType: "correction_reversal",
              referenceId: original.movement_id,
            },
          ]) {
            const beforeBalance = (await database.query<{ quantity: string }>(
              `select quantity from public.inventory_balances
               where product_id = $1::uuid`,
              [invalid.productId],
            )).rows[0]!.quantity;
            const beforeMovements = (await database.query<CountRow>(
              "select pg_catalog.count(*)::integer as count from public.inventory_movements",
            )).rows[0]!.count;

            await database.query(`savepoint ${invalid.name}`);
            await expect(database.query(
              `select * from public.apply_inventory_delta(
                 $1::uuid, $2::bigint, 'correction_reversal', $3::text,
                 $4::text, null, null, $5::uuid
               )`,
              [
                invalid.productId,
                invalid.delta,
                invalid.reason,
                invalid.sourceType,
                invalid.referenceId,
              ],
            )).rejects.toMatchObject({ code: invalid.code });
            await database.query(`rollback to savepoint ${invalid.name}`);

            expect((await database.query<{ quantity: string }>(
              `select quantity from public.inventory_balances
               where product_id = $1::uuid`,
              [invalid.productId],
            )).rows[0]!.quantity).toBe(beforeBalance);
            expect((await database.query<CountRow>(
              "select pg_catalog.count(*)::integer as count from public.inventory_movements",
            )).rows[0]!.count).toBe(beforeMovements);
          }

          await database.query("savepoint immutable_original");
          await expect(database.query(
            `update public.inventory_movements set reason = 'Rewritten'
             where id = $1::uuid`,
            [original.movement_id],
          )).rejects.toMatchObject({ code: "55000" });
          await database.query("rollback to savepoint immutable_original");

          expect(await snapshotHistoricalWorkOrderState(database)).toEqual(historyBefore);
        });
      });

      it("keeps reversal infrastructure non-browser-callable", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const acl = await database.query<{
            anonymous_execute: boolean;
            authenticated_execute: boolean;
            settings: string[];
          }>(
            `select
               pg_catalog.has_function_privilege(
                 'anon', routine.oid, 'execute'
               ) as anonymous_execute,
               pg_catalog.has_function_privilege(
                 'authenticated', routine.oid, 'execute'
               ) as authenticated_execute,
               routine.proconfig as settings
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             where namespace.nspname = 'public'
               and routine.proname = 'validate_inventory_movement_reversal_product'`,
          );
          expect(acl.rows).toEqual([{
            anonymous_execute: false,
            authenticated_execute: false,
            settings: ["search_path=\"\""],
          }]);
        });
      });
    },
  );
}
