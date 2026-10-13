import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  isDisposableOrLocalBackendTarget,
  loadBackendTestEnvironment,
} from "./env";
import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityFixtureHarness } from "./security-fixtures";
import { createTestSerialNumber } from "./helpers/serial";
import {
  assertInventorySourceInvariant,
  createSupplierSourceFixture,
  seedSupplierStock,
} from "./helpers/inventory-provenance";

const committedConcurrencyIt = it.skipIf(
  !isDisposableOrLocalBackendTarget(loadBackendTestEnvironment().projectRef),
);

interface CountResultRow {
  count: number;
}

interface ActivityWaitRow {
  wait_event: string | null;
  wait_event_type: string | null;
}

interface InventoryBalanceRow {
  product_id: string;
  quantity: string;
  updated_at: Date;
}

interface InventoryMovementRow {
  actor_user_id: string;
  created_at: Date;
  id: string;
  movement_type: string;
  product_id: string;
  project_id: string | null;
  quantity_after: string;
  quantity_before: string;
  quantity_delta: string;
  reason: string | null;
  reversal_of_movement_id: string | null;
  source_id: string | null;
  source_type: string | null;
}

interface AppliedInventoryDeltaRow {
  movement_id: string;
  quantity_after: string;
  quantity_before: string;
}

interface ManualInventoryAdjustmentRow {
  movement_id: string;
  quantity_after: string;
  quantity_before: string;
}

export function registerInventoryPrimitiveTests(requireHarness: () => SecurityFixtureHarness): void {
  it("applies trusted Inventory deltas atomically with normalized movement context and no generic audit", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const productId = randomUUID();
      const sourceId = randomUUID();
      const projectId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Delta Product', 'Components', 'component',
           $3::uuid, $3::uuid
         )`,
        [productId, createTestSerialNumber(), actor.profileId],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      const source = await createSupplierSourceFixture(
        database,
        actor,
        productId,
        { catalogNumber: "DELTA-001" },
      );
      const auditBefore = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.audit_logs",
      );

      const positive = await database.query<AppliedInventoryDeltaRow>(
        `select *
         from public.apply_inventory_delta(
           $1::uuid,
           10,
           '  stock_in  ',
           '  Initial receipt  ',
           '  fixture_source  ',
           $2::uuid,
           $3::uuid,
           null,
           $4::uuid,
           'supplier'
         )`,
        [productId, sourceId, projectId, source.productSupplierId],
      );
      expect(positive.rows).toEqual([{
        movement_id: expect.any(String),
        quantity_after: "10",
        quantity_before: "0",
      }]);

      const negative = await database.query<AppliedInventoryDeltaRow>(
        `select *
         from public.apply_inventory_delta(
           $1::uuid,
           -4,
           ' stock_out ',
           '   ',
           '',
           null,
           null,
           null
         )`,
        [productId],
      );
      expect(negative.rows).toEqual([{
        movement_id: expect.any(String),
        quantity_after: "6",
        quantity_before: "10",
      }]);

      const movementRows = await database.query<InventoryMovementRow>(
        `select *
         from public.inventory_movements
         where id = any($1::uuid[])
         order by created_at, id`,
        [[positive.rows[0]?.movement_id, negative.rows[0]?.movement_id]],
      );
      expect(movementRows.rows).toHaveLength(2);
      expect(movementRows.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actor_user_id: actor.profileId,
          id: positive.rows[0]?.movement_id,
          movement_type: "stock_in",
          product_id: productId,
          project_id: projectId,
          quantity_after: "10",
          quantity_before: "0",
          quantity_delta: "10",
          reason: "Initial receipt",
          source_id: sourceId,
          source_type: "fixture_source",
        }),
        expect.objectContaining({
          actor_user_id: actor.profileId,
          id: negative.rows[0]?.movement_id,
          movement_type: "stock_out",
          project_id: null,
          quantity_after: "6",
          quantity_before: "10",
          quantity_delta: "-4",
          reason: null,
          source_id: null,
          source_type: null,
        }),
      ]));
      const balance = await database.query<InventoryBalanceRow>(
        `select product_id, quantity, updated_at
         from public.inventory_balances
         where product_id = $1::uuid`,
        [productId],
      );
      expect(balance.rows[0]).toMatchObject({
        product_id: productId,
        quantity: "6",
      });
      expect(balance.rows[0]?.updated_at).toEqual(
        movementRows.rows.find((row) =>
          row.id === negative.rows[0]?.movement_id)?.created_at,
      );

      await database.query("savepoint outer_inventory_operation");
      const rolledBack = await database.query<AppliedInventoryDeltaRow>(
        `select * from public.apply_inventory_delta(
           $1::uuid, 2, 'stock_in', null, null, null, null, null,
           $2::uuid, 'supplier'
         )`,
        [productId, source.productSupplierId],
      );
      await database.query("rollback to savepoint outer_inventory_operation");
      const afterOuterRollback = await database.query<InventoryBalanceRow>(
        `select product_id, quantity, updated_at
         from public.inventory_balances
         where product_id = $1::uuid`,
        [productId],
      );
      const rolledBackMovement = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.inventory_movements
         where id = $1::uuid`,
        [rolledBack.rows[0]?.movement_id],
      );
      expect(afterOuterRollback.rows).toEqual(balance.rows);
      expect(rolledBackMovement.rows).toEqual([{ count: 0 }]);
      await assertInventorySourceInvariant(database, productId);

      const auditAfter = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.audit_logs",
      );
      expect(auditAfter.rows).toEqual(auditBefore.rows);
    });
  });
  it("fails Inventory deltas closed without leaving a balance or movement change", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const productId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Failed Delta Product', 'Components',
           'component', $3::uuid, $3::uuid
         )`,
        [productId, createTestSerialNumber(), actor.profileId],
      );
      const source = await seedSupplierStock(
        database,
        actor,
        productId,
        3,
        { catalogNumber: "FAILED-DELTA-001" },
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );

      for (const [savepoint, sql, values, errorCode] of [
        [
          "negative_inventory_result",
          "select * from public.apply_inventory_delta($1::uuid, -4, 'stock_out')",
          [productId],
          "IVB02",
        ],
        [
          "blank_inventory_movement_type",
          `select * from public.apply_inventory_delta(
             $1::uuid, 1, '   ', null, null, null, null, null,
             $2::uuid, 'supplier'
           )`,
          [productId, source.productSupplierId],
          "22023",
        ],
        [
          "null_inventory_delta",
          `select * from public.apply_inventory_delta(
             $1::uuid, null, 'stock_in', null, null, null, null, null,
             $2::uuid, 'supplier'
           )`,
          [productId, source.productSupplierId],
          "22023",
        ],
        [
          "failed_inventory_movement_insert",
          `select *
           from public.apply_inventory_delta(
             $1::uuid, 1, 'correction_reversal', 'Missing original',
             'correction_reversal', null, null,
             $2::uuid, $3::uuid, 'supplier'
           )`,
          [productId, randomUUID(), source.productSupplierId],
          "23503",
        ],
      ] as const) {
        await database.query(`savepoint ${savepoint}`);
        await expect(database.query(sql, [...values]))
          .rejects.toMatchObject({ code: errorCode });
        await database.query(`rollback to savepoint ${savepoint}`);

        const unchangedBalance = await database.query<{ quantity: string }>(
          `select quantity
           from public.inventory_balances
           where product_id = $1::uuid`,
          [productId],
        );
        const movementCount = await database.query<CountResultRow>(
          `select count(*)::integer as count
           from public.inventory_movements
           where product_id = $1::uuid`,
          [productId],
        );
        expect(unchangedBalance.rows).toEqual([{ quantity: "3" }]);
        expect(movementCount.rows).toEqual([{ count: 1 }]);
      }

      await database.query(
        `select * from public.manual_adjust_inventory(
           $1::uuid, 'correction', 9223372036854775807,
           'Prepare bigint overflow boundary', $2::uuid
         )`,
        [productId, source.productSupplierId],
      );
      await database.query("savepoint overflowing_inventory_delta");
      await expect(
        database.query(
          `select * from public.apply_inventory_delta(
             $1::uuid, 1, 'stock_in', null, null, null, null, null,
             $2::uuid, 'supplier'
           )`,
          [productId, source.productSupplierId],
        ),
      ).rejects.toMatchObject({ code: "22003" });
      await database.query("rollback to savepoint overflowing_inventory_delta");
      const afterOverflow = await database.query<{ quantity: string }>(
        `select quantity
         from public.inventory_balances
         where product_id = $1::uuid`,
        [productId],
      );
      expect(afterOverflow.rows).toEqual([{ quantity: "9223372036854775807" }]);

      const missingBalanceProductId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Missing Balance Delta Product', 'Components',
           'component', $3::uuid, $3::uuid
         )`,
        [missingBalanceProductId, createTestSerialNumber(), actor.profileId],
      );
      await database.query(
        "delete from public.inventory_balances where product_id = $1::uuid",
        [missingBalanceProductId],
      );
      await database.query("savepoint missing_inventory_balance");
      await expect(
        database.query(
          "select * from public.apply_inventory_delta($1::uuid, 1, 'stock_in')",
          [missingBalanceProductId],
        ),
      ).rejects.toMatchObject({ code: "IVB01" });
      await database.query("rollback to savepoint missing_inventory_balance");

      await database.query(
        `insert into public.inventory_balances (product_id, quantity)
         values ($1::uuid, 0)`,
        [missingBalanceProductId],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.inactive.authUserId],
      );
      await database.query("savepoint inactive_inventory_actor");
      await expect(
        database.query(
          "select * from public.apply_inventory_delta($1::uuid, 1, 'stock_in')",
          [missingBalanceProductId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint inactive_inventory_actor");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', '', true)",
      );
      await database.query("savepoint anonymous_inventory_actor");
      await expect(
        database.query(
          "select * from public.apply_inventory_delta($1::uuid, 1, 'stock_in')",
          [missingBalanceProductId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_inventory_actor");
      const finalBalance = await database.query<{ quantity: string }>(
        `select quantity
         from public.inventory_balances
         where product_id = $1::uuid`,
        [missingBalanceProductId],
      );
      expect(finalBalance.rows).toEqual([{ quantity: "0" }]);
    });
  });
  committedConcurrencyIt("serializes competing deductions on one Product and prevents overspending", async () => {
    const fixture = requireHarness();
    const productId = randomUUID();
    const applicationName = `alfaev-inventory-wait-${randomUUID()}`;

    await fixture.withDatabaseClients(3, async (clients) => {
      const first = clients[0];
      const second = clients[1];
      const observer = clients[2];
      if (!first || !second || !observer) {
        throw new Error("Inventory concurrency clients are unavailable");
      }

      await observer.query("begin");
      await observer.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Concurrent Delta Product', 'Components',
           'component', $3::uuid, $3::uuid
         )`,
        [
          productId,
          createTestSerialNumber(),
          fixture.actors.admin.profileId,
        ],
      );
      await seedSupplierStock(
        observer,
        fixture.actors.admin,
        productId,
        5,
        { catalogNumber: "CONCURRENT-DELTA-001" },
      );
      await observer.query("commit");

      try {
        await first.query("begin");
        await first.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        const firstDeduction = await first.query<AppliedInventoryDeltaRow>(
          "select * from public.apply_inventory_delta($1::uuid, -4, 'stock_out')",
          [productId],
        );
        expect(firstDeduction.rows).toEqual([{
          movement_id: expect.any(String),
          quantity_after: "1",
          quantity_before: "5",
        }]);

        await second.query("begin");
        await second.query(
          "select pg_catalog.set_config('application_name', $1::text, true)",
          [applicationName],
        );
        await second.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        const competingDeduction = second.query(
          "select * from public.apply_inventory_delta($1::uuid, -6, 'stock_out')",
          [productId],
        ).then(
          () => null,
          (error: unknown) => error,
        );

        let observedBalanceWait = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = await observer.query<ActivityWaitRow>(
            `select wait_event_type, wait_event
             from pg_catalog.pg_stat_activity
             where application_name = $1::text`,
            [applicationName],
          );
          if (activity.rows[0]?.wait_event_type === "Lock") {
            observedBalanceWait = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(observedBalanceWait).toBe(true);

        const committedWhileWaiting = await observer.query<{
          movement_count: number;
          quantity: string;
        }>(
          `select
             balance.quantity,
             (
               select count(*)::integer
               from public.inventory_movements as movement
               where movement.product_id = balance.product_id
             ) as movement_count
           from public.inventory_balances as balance
           where balance.product_id = $1::uuid`,
          [productId],
        );
        expect(committedWhileWaiting.rows).toEqual([{
          movement_count: 1,
          quantity: "5",
        }]);

        await first.query("rollback");
        const competingError = await competingDeduction;
        expect(competingError).toMatchObject({ code: "IVB02" });
        await second.query("rollback");

        const finalState = await observer.query<{
          movement_count: number;
          quantity: string;
        }>(
          `select
             balance.quantity,
             (
               select count(*)::integer
               from public.inventory_movements as movement
               where movement.product_id = balance.product_id
             ) as movement_count
           from public.inventory_balances as balance
           where balance.product_id = $1::uuid`,
          [productId],
        );
        expect(finalState.rows).toEqual([{
          movement_count: 1,
          quantity: "5",
        }]);
      } finally {
        await first.query("rollback");
        await second.query("rollback");
        await assertInventorySourceInvariant(observer, productId);
      }
    });
  });
  it("keeps the Inventory primitive internal, permission-neutral, and client inaccessible", async () => {
    const fixture = requireHarness();
    const rpcArguments = {
      p_product_id: randomUUID(),
      p_quantity_delta: 1,
      p_movement_type: "stock_in",
    };

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.admin.client,
      fixture.actors.unpermitted.client,
    ]) {
      const { error } = await client.rpc("apply_inventory_delta", rpcArguments);
      expectPermissionDenied(error);
    }

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const primitive = await database.query<{
        anonymous_execute: boolean;
        arguments: string;
        authenticated_execute: boolean;
        definition: string;
        is_security_definer: boolean;
        result_type: string;
        settings: string[];
      }>(
        `select
           pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
           pg_catalog.pg_get_function_result(routine.oid) as result_type,
           pg_catalog.pg_get_functiondef(routine.oid) as definition,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege(
             'authenticated', routine.oid, 'execute'
           ) as authenticated_execute,
           pg_catalog.has_function_privilege(
             'anon', routine.oid, 'execute'
           ) as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'apply_inventory_delta'`,
      );
      expect(primitive.rows).toHaveLength(1);
      expect(primitive.rows[0]).toMatchObject({
        anonymous_execute: false,
        authenticated_execute: false,
        is_security_definer: true,
        result_type: "TABLE(movement_id uuid, quantity_before bigint, quantity_after bigint)",
        settings: ["search_path=\"\""],
      });
      expect(primitive.rows[0]?.arguments).not.toMatch(/actor/i);
      const definition = primitive.rows[0]?.definition.toLowerCase() ?? "";
      expect(definition).toContain("current_active_user_profile_id");
      expect(definition).toContain("for update");
      expect(definition).toContain("for share");
      expect(definition).not.toContain("has_permission");
      expect(definition).not.toContain("current_user_is_admin");
      expect(definition).not.toContain("append_audit_log");
    });
  });
}

export function registerManualInventoryAdjustmentTests(requireHarness: () => SecurityFixtureHarness): void {
  it("applies each Admin manual Inventory adjustment exactly once with canonical movement and audit data", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const productId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Manual Adjustment Product', 'Components',
           'component', $3::uuid, $3::uuid
         )`,
        [productId, createTestSerialNumber(), actor.profileId],
      );
      const source = await createSupplierSourceFixture(
        database,
        actor,
        productId,
        { catalogNumber: "MANUAL-001" },
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");

      const adjustments: Array<{
        adjustmentType: string;
        expectedAfter: string;
        expectedBefore: string;
        quantity: number;
        reason: string;
      }> = [
        {
          adjustmentType: "  ADD  ",
          expectedAfter: "10",
          expectedBefore: "0",
          quantity: 10,
          reason: "  Initial manual receipt  ",
        },
        {
          adjustmentType: "remove",
          expectedAfter: "7",
          expectedBefore: "10",
          quantity: 3,
          reason: "Manual issue",
        },
        {
          adjustmentType: "correction",
          expectedAfter: "12",
          expectedBefore: "7",
          quantity: 12,
          reason: "Count corrected up",
        },
        {
          adjustmentType: "correction",
          expectedAfter: "4",
          expectedBefore: "12",
          quantity: 4,
          reason: "Count corrected down",
        },
        {
          adjustmentType: "correction",
          expectedAfter: "0",
          expectedBefore: "4",
          quantity: 0,
          reason: "Count corrected to zero",
        },
      ];
      const results: ManualInventoryAdjustmentRow[] = [];

      for (const adjustment of adjustments) {
        const result = await database.query<ManualInventoryAdjustmentRow>(
          `select *
           from public.manual_adjust_inventory(
             $1::uuid,
             $2::text,
             $3::bigint,
             $4::text,
             $5::uuid
           )`,
          [
            productId,
            adjustment.adjustmentType,
            adjustment.quantity,
            adjustment.reason,
            BigInt(adjustment.expectedAfter) > BigInt(adjustment.expectedBefore)
              ? source.productSupplierId
              : null,
          ],
        );
        expect(result.rows).toEqual([{
          movement_id: expect.any(String),
          quantity_after: adjustment.expectedAfter,
          quantity_before: adjustment.expectedBefore,
        }]);
        const appliedAdjustment = result.rows[0];

        if (!appliedAdjustment) {
          throw new Error("Manual Inventory adjustment returned no result");
        }

        results.push(appliedAdjustment);
      }

      await database.query("reset role");
      const movementIds = results.map((result) => result.movement_id);
      const movements = await database.query<InventoryMovementRow>(
        `select *
         from public.inventory_movements
         where id = any($1::uuid[])
         order by created_at, id`,
        [movementIds],
      );
      const audits = await database.query<{
        action_type: string;
        actor_user_id: string;
        after_data: Record<string, unknown>;
        before_data: Record<string, unknown>;
        entity_id: string;
        entity_type: string;
      }>(
        `select action_type, actor_user_id, after_data, before_data,
                entity_id, entity_type
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'inventory.manual_adjusted'
         order by created_at, id`,
        [productId],
      );
      const balance = await database.query<{ quantity: string }>(
        `select quantity
         from public.inventory_balances
         where product_id = $1::uuid`,
        [productId],
      );

      expect(balance.rows).toEqual([{ quantity: "0" }]);
      expect(movements.rows).toHaveLength(adjustments.length);
      expect(audits.rows).toHaveLength(adjustments.length);
      expect(movements.rows.map((movement) => ({
        actor: movement.actor_user_id,
        after: movement.quantity_after,
        before: movement.quantity_before,
        delta: movement.quantity_delta,
        reason: movement.reason,
        sourceId: movement.source_id,
        sourceType: movement.source_type,
        type: movement.movement_type,
      }))).toEqual([
        {
          actor: actor.profileId,
          after: "10",
          before: "0",
          delta: "10",
          reason: "Initial manual receipt",
          sourceId: null,
          sourceType: "manual_adjustment",
          type: "manual_add",
        },
        {
          actor: actor.profileId,
          after: "7",
          before: "10",
          delta: "-3",
          reason: "Manual issue",
          sourceId: null,
          sourceType: "manual_adjustment",
          type: "manual_remove",
        },
        {
          actor: actor.profileId,
          after: "12",
          before: "7",
          delta: "5",
          reason: "Count corrected up",
          sourceId: null,
          sourceType: "manual_adjustment",
          type: "manual_correction",
        },
        {
          actor: actor.profileId,
          after: "4",
          before: "12",
          delta: "-8",
          reason: "Count corrected down",
          sourceId: null,
          sourceType: "manual_adjustment",
          type: "manual_correction",
        },
        {
          actor: actor.profileId,
          after: "0",
          before: "4",
          delta: "-4",
          reason: "Count corrected to zero",
          sourceId: null,
          sourceType: "manual_adjustment",
          type: "manual_correction",
        },
      ]);
      expect(audits.rows.every((audit) =>
        audit.actor_user_id === actor.profileId &&
        audit.entity_id === productId &&
        audit.entity_type === "product_inventory"
      )).toBe(true);
      expect(audits.rows.map((audit) => audit.after_data)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            adjustment_type: "add",
            entered_quantity: 10,
            movement_type: "manual_add",
            quantity_after: 10,
            quantity_before: 0,
            quantity_delta: 10,
            reason: "Initial manual receipt",
          }),
          expect.objectContaining({
            adjustment_type: "remove",
            entered_quantity: 3,
            movement_type: "manual_remove",
            quantity_after: 7,
            quantity_before: 10,
            quantity_delta: -3,
            reason: "Manual issue",
          }),
          expect.objectContaining({
            adjustment_type: "correction",
            entered_quantity: 12,
            movement_type: "manual_correction",
            quantity_after: 12,
            quantity_before: 7,
            quantity_delta: 5,
            reason: "Count corrected up",
          }),
          expect.objectContaining({
            adjustment_type: "correction",
            entered_quantity: 4,
            movement_type: "manual_correction",
            quantity_after: 4,
            quantity_before: 12,
            quantity_delta: -8,
            reason: "Count corrected down",
          }),
          expect.objectContaining({
            adjustment_type: "correction",
            entered_quantity: 0,
            movement_type: "manual_correction",
            quantity_after: 0,
            quantity_before: 4,
            quantity_delta: -4,
            reason: "Count corrected to zero",
          }),
        ]),
      );
      await assertInventorySourceInvariant(database, productId);
    });
  });
  it("rejects invalid, missing, archived, no-op, and insufficient manual adjustments without side effects", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const productId = randomUUID();
      const archivedProductId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind, is_active,
           created_by_user_id, updated_by_user_id, archived_at,
           archived_by_user_id
         ) values
           ($1::uuid, $3::text, 'Adjustment Validation Product', 'Components',
            'component', true, $5::uuid, $5::uuid, null, null),
           ($2::uuid, $4::text, 'Archived Adjustment Product', 'Components',
            'component', false, $5::uuid, $5::uuid,
            pg_catalog.now(), $5::uuid)`,
        [
          productId,
          archivedProductId,
          createTestSerialNumber(),
          createTestSerialNumber(),
          actor.profileId,
        ],
      );
      const source = await seedSupplierStock(
        database,
        actor,
        productId,
        5,
        { catalogNumber: "VALIDATION-001" },
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");

      const rejectedCases: Array<{
        code: string;
        label: string;
        values: unknown[];
      }> = [
        {
          code: "MIA01",
          label: "null_product",
          values: [null, "add", 1, "Reason", source.productSupplierId],
        },
        {
          code: "P0002",
          label: "missing_product",
          values: [randomUUID(), "add", 1, "Reason", source.productSupplierId],
        },
        {
          code: "PRD01",
          label: "archived_product",
          values: [archivedProductId, "add", 1, "Reason", source.productSupplierId],
        },
        {
          code: "MIA01",
          label: "invalid_type",
          values: [productId, "replace", 1, "Reason", source.productSupplierId],
        },
        {
          code: "MIA01",
          label: "null_type",
          values: [productId, null, 1, "Reason", source.productSupplierId],
        },
        {
          code: "MIA01",
          label: "zero_add",
          values: [productId, "add", 0, "Reason", source.productSupplierId],
        },
        {
          code: "MIA01",
          label: "negative_add",
          values: [productId, "add", -1, "Reason", source.productSupplierId],
        },
        {
          code: "MIA01",
          label: "zero_remove",
          values: [productId, "remove", 0, "Reason", null],
        },
        {
          code: "MIA01",
          label: "negative_remove",
          values: [productId, "remove", -1, "Reason", null],
        },
        {
          code: "MIA01",
          label: "negative_correction",
          values: [productId, "correction", -1, "Reason", null],
        },
        {
          code: "MIA01",
          label: "null_quantity",
          values: [productId, "add", null, "Reason", source.productSupplierId],
        },
        {
          code: "MIA01",
          label: "blank_reason",
          values: [productId, "add", 1, "   ", source.productSupplierId],
        },
        {
          code: "MIA01",
          label: "null_reason",
          values: [productId, "add", 1, null, source.productSupplierId],
        },
        {
          code: "MIA02",
          label: "no_op_correction",
          values: [productId, "correction", 5, "No change", null],
        },
        {
          code: "IVB02",
          label: "insufficient_remove",
          values: [productId, "remove", 6, "Too much", null],
        },
      ];

      for (const rejected of rejectedCases) {
        await database.query(`savepoint ${rejected.label}`);
        await expect(
          database.query(
            `select *
             from public.manual_adjust_inventory(
               $1::uuid,
               $2::text,
               $3::bigint,
               $4::text,
               $5::uuid
             )`,
            rejected.values,
          ),
        ).rejects.toMatchObject({ code: rejected.code });
        await database.query(`rollback to savepoint ${rejected.label}`);
      }

      await database.query("reset role");
      const state = await database.query<{
        audit_count: number;
        movement_count: number;
        quantity: string;
      }>(
        `select
           balance.quantity,
           (
             select count(*)::integer
             from public.inventory_movements as movement
             where movement.product_id = balance.product_id
           ) as movement_count,
           (
             select count(*)::integer
             from public.audit_logs as audit
             where audit.entity_id = balance.product_id
               and audit.action_type = 'inventory.manual_adjusted'
           ) as audit_count
         from public.inventory_balances as balance
         where balance.product_id = $1::uuid`,
        [productId],
      );
      expect(state.rows).toEqual([{
        audit_count: 1,
        movement_count: 1,
        quantity: "5",
      }]);
      await assertInventorySourceInvariant(database, productId);
    });
  });
  it("keeps manual adjustment Admin-only and preserves all lower-level client write boundaries", async () => {
    const fixture = requireHarness();
    const argumentsForRpc = {
      p_adjustment_type: "add",
      p_product_id: randomUUID(),
      p_product_supplier_id: randomUUID(),
      p_quantity: 1,
      p_reason: "Authorization probe",
    };
    const adminAttempt = await fixture.actors.admin.client.rpc(
      "manual_adjust_inventory",
      argumentsForRpc,
    );
    expect(adminAttempt.error).toMatchObject({ code: "P0002" });

    for (const client of [
      fixture.actors.productCreator.client,
      fixture.actors.productEditor.client,
      fixture.actors.brandManager.client,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
      fixture.anonymousClient,
    ]) {
      const attempt = await client.rpc(
        "manual_adjust_inventory",
        argumentsForRpc,
      );
      expectPermissionDenied(attempt.error);
    }

    const directBalanceUpdate = await fixture.actors.admin.client
      .from("inventory_balances")
      .update({ quantity: 1 })
      .eq("product_id", randomUUID());
    const directMovementInsert = await fixture.actors.admin.client
      .from("inventory_movements")
      .insert({
        actor_user_id: fixture.actors.admin.profileId,
        movement_type: "manual_add",
        product_id: randomUUID(),
        quantity_after: 1,
        quantity_before: 0,
        quantity_delta: 1,
        reason: "Forbidden",
      });
    const primitiveAttempt = await fixture.actors.admin.client.rpc(
      "apply_inventory_delta",
      {
        p_movement_type: "manual_add",
        p_product_id: randomUUID(),
        p_quantity_delta: 1,
      },
    );
    expectPermissionDenied(directBalanceUpdate.error);
    expectPermissionDenied(directMovementInsert.error);
    expectPermissionDenied(primitiveAttempt.error);

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const security = await database.query<{
        anonymous_execute: boolean;
        arguments: string;
        authenticated_execute: boolean;
        definition: string;
        is_security_definer: boolean;
        result_type: string;
        settings: string[];
      }>(
        `select
           pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
           pg_catalog.pg_get_function_result(routine.oid) as result_type,
           pg_catalog.pg_get_functiondef(routine.oid) as definition,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege(
             'authenticated', routine.oid, 'execute'
           ) as authenticated_execute,
           pg_catalog.has_function_privilege(
             'anon', routine.oid, 'execute'
           ) as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'manual_adjust_inventory'`,
      );
      expect(security.rows).toHaveLength(1);
      expect(security.rows[0]).toMatchObject({
        anonymous_execute: false,
        authenticated_execute: true,
        is_security_definer: true,
        result_type: "TABLE(movement_id uuid, quantity_before bigint, quantity_after bigint)",
        settings: ["search_path=\"\""],
      });
      expect(security.rows[0]?.arguments).toBe(
        "p_product_id uuid, p_adjustment_type text, p_quantity bigint, p_reason text, p_product_supplier_id uuid",
      );
      const definition = security.rows[0]?.definition.toLowerCase() ?? "";
      expect(definition.match(/apply_inventory_delta/g)).toHaveLength(1);
      expect(definition).toContain("current_user_is_admin");
      expect(definition).toContain("append_audit_log");
      expect(definition).toContain("from public.products");
      expect(definition).toContain("for update");
      expect(definition).toContain("from public.user_profiles");
      expect(definition).toContain("for share");
      expect(definition.indexOf("from public.products")).toBeLessThan(
        definition.indexOf("from public.user_profiles"),
      );
      expect(definition).not.toContain("update public.inventory_balances");
      expect(definition).not.toContain("insert into public.inventory_movements");

      const primitiveAcl = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
      }>(
        `select
           pg_catalog.has_function_privilege(
             'authenticated', routine.oid, 'execute'
           ) as authenticated_execute,
           pg_catalog.has_function_privilege(
             'anon', routine.oid, 'execute'
           ) as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'apply_inventory_delta'`,
      );
      expect(primitiveAcl.rows).toEqual([{
        anonymous_execute: false,
        authenticated_execute: false,
      }]);
    });
  });
  it("keeps denied manual Inventory actors side-effect free across Inventory permission combinations", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const productId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Authorization Boundary Product', 'Components',
           'component', $3::uuid, $3::uuid
         )`,
        [
          productId,
          createTestSerialNumber(),
          fixture.actors.admin.profileId,
        ],
      );
      await seedSupplierStock(
        database,
        fixture.actors.admin,
        productId,
        8,
        { catalogNumber: "DENIED-001" },
      );

      for (const [label, actor] of [
        ["inventory_view", fixture.actors.brandManager],
        ["inventory_product_edit", fixture.actors.productEditor],
        ["inventory_product_create", fixture.actors.productCreator],
        ["ordinary_user", fixture.actors.unpermitted],
        ["inactive_admin", fixture.actors.inactive],
      ] as const) {
        await database.query(`savepoint denied_manual_${label}`);
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await expect(
          database.query(
            `select *
             from public.manual_adjust_inventory(
               $1::uuid,
               'remove',
               1,
               'Denied authorization attempt',
               null
             )`,
            [productId],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_manual_${label}`);
        await database.query("reset role");
      }

      await database.query("savepoint denied_manual_anonymous");
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', '', true)",
      );
      await database.query("set local role anon");
      await expect(
        database.query(
          `select *
           from public.manual_adjust_inventory(
             $1::uuid,
             'remove',
             1,
             'Anonymous authorization attempt',
             null
           )`,
          [productId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint denied_manual_anonymous");
      await database.query("reset role");

      const unchanged = await database.query<{
        audit_count: number;
        movement_count: number;
        quantity: string;
      }>(
        `select
           balance.quantity,
           (
             select count(*)::integer
             from public.inventory_movements as movement
             where movement.product_id = balance.product_id
           ) as movement_count,
           (
             select count(*)::integer
             from public.audit_logs as audit
             where audit.entity_id = balance.product_id
               and audit.action_type = 'inventory.manual_adjusted'
           ) as audit_count
         from public.inventory_balances as balance
         where balance.product_id = $1::uuid`,
        [productId],
      );
      expect(unchanged.rows).toEqual([{
        audit_count: 1,
        movement_count: 1,
        quantity: "8",
      }]);
      await assertInventorySourceInvariant(database, productId);
    });
  });
  committedConcurrencyIt("serializes competing Admin manual removals and commits only the affordable adjustment", async () => {
    const fixture = requireHarness();
    const productId = randomUUID();
    const applicationName = `alfaev-manual-remove-wait-${randomUUID()}`;

    await fixture.withDatabaseClients(3, async (clients) => {
      const firstAdmin = clients[0];
      const secondAdmin = clients[1];
      const observer = clients[2];
      if (!firstAdmin || !secondAdmin || !observer) {
        throw new Error("Manual removal concurrency clients are unavailable");
      }

      await observer.query("begin");
      await observer.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Concurrent Manual Removal Product',
           'Components', 'component', $3::uuid, $3::uuid
         )`,
        [
          productId,
          createTestSerialNumber(),
          fixture.actors.admin.profileId,
        ],
      );
      await seedSupplierStock(
        observer,
        fixture.actors.admin,
        productId,
        10,
        { catalogNumber: "CONCURRENT-REMOVE-001" },
      );
      await observer.query("commit");

      try {
        await firstAdmin.query("begin");
        await firstAdmin.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await firstAdmin.query("set local role authenticated");
        const affordableRemoval = await firstAdmin.query<
          ManualInventoryAdjustmentRow
        >(
          `select *
           from public.manual_adjust_inventory(
             $1::uuid,
             'remove',
             7,
             'First concurrent removal',
             null
           )`,
          [productId],
        );
        expect(affordableRemoval.rows).toEqual([{
          movement_id: expect.any(String),
          quantity_after: "3",
          quantity_before: "10",
        }]);

        await secondAdmin.query("begin");
        await secondAdmin.query(
          "select pg_catalog.set_config('application_name', $1::text, true)",
          [applicationName],
        );
        await secondAdmin.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await secondAdmin.query("set local role authenticated");
        const unaffordableRemoval = secondAdmin.query(
          `select *
           from public.manual_adjust_inventory(
             $1::uuid,
             'remove',
             6,
             'Competing concurrent removal',
             null
           )`,
          [productId],
        ).then(
          () => null,
          (error: unknown) => error,
        );

        let observedLockWait = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = await observer.query<ActivityWaitRow>(
            `select wait_event_type, wait_event
             from pg_catalog.pg_stat_activity
             where application_name = $1::text`,
            [applicationName],
          );
          if (activity.rows[0]?.wait_event_type === "Lock") {
            observedLockWait = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(observedLockWait).toBe(true);

        const stateWhileWaiting = await observer.query<{
          audit_count: number;
          movement_count: number;
          quantity: string;
        }>(
          `select
             balance.quantity,
             (
               select count(*)::integer
               from public.inventory_movements as movement
               where movement.product_id = balance.product_id
             ) as movement_count,
             (
               select count(*)::integer
               from public.audit_logs as audit
               where audit.entity_id = balance.product_id
                 and audit.action_type = 'inventory.manual_adjusted'
             ) as audit_count
           from public.inventory_balances as balance
           where balance.product_id = $1::uuid`,
          [productId],
        );
        expect(stateWhileWaiting.rows).toEqual([{
          audit_count: 1,
          movement_count: 1,
          quantity: "10",
        }]);

        await firstAdmin.query("reset role");
        await firstAdmin.query("commit");
        const competingError = await unaffordableRemoval;
        expect(competingError).toMatchObject({ code: "IVB02" });
        await secondAdmin.query("rollback");

        const committedState = await observer.query<{
          action_type: string;
          actor_user_id: string;
          audit_count: number;
          movement_count: number;
          movement_type: string;
          quantity: string;
          quantity_after: string;
          quantity_before: string;
          quantity_delta: string;
        }>(
          `select
             balance.quantity,
             movement.movement_type,
             movement.quantity_delta,
             movement.quantity_before,
             movement.quantity_after,
             movement.actor_user_id,
             audit.action_type,
             (
               select count(*)::integer
               from public.inventory_movements as counted_movement
               where counted_movement.product_id = balance.product_id
             ) as movement_count,
             (
               select count(*)::integer
               from public.audit_logs as counted_audit
               where counted_audit.entity_id = balance.product_id
                 and counted_audit.action_type = 'inventory.manual_adjusted'
             ) as audit_count
           from public.inventory_balances as balance
           join public.inventory_movements as movement
             on movement.product_id = balance.product_id
            and movement.movement_type = 'manual_remove'
           join public.audit_logs as audit
             on audit.entity_id = balance.product_id
            and audit.action_type = 'inventory.manual_adjusted'
            and audit.after_data->>'movement_id' = movement.id::text
           where balance.product_id = $1::uuid`,
          [productId],
        );
        expect(committedState.rows).toEqual([{
          action_type: "inventory.manual_adjusted",
          actor_user_id: fixture.actors.admin.profileId,
          audit_count: 2,
          movement_count: 2,
          movement_type: "manual_remove",
          quantity: "3",
          quantity_after: "3",
          quantity_before: "10",
          quantity_delta: "-7",
        }]);

        const readableHistory = await fixture.actors.admin.client.rpc(
          "get_inventory_movements_for_product",
          { p_product_id: productId },
        );
        expect(readableHistory.error).toBeNull();
        expect(readableHistory.data).toEqual(expect.arrayContaining([
          expect.objectContaining({
            movement_id: affordableRemoval.rows[0]?.movement_id,
            movement_type: "manual_remove",
            quantity_after: 3,
            quantity_before: 10,
            quantity_delta: -7,
          }),
        ]));
        await assertInventorySourceInvariant(observer, productId);
      } finally {
        await firstAdmin.query("rollback");
        await secondAdmin.query("rollback");
      }
    });
  });
  it("rolls back the manual balance and movement when the required audit append fails", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const productId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Audit Rollback Product', 'Components',
           'component', $3::uuid, $3::uuid
         )`,
        [productId, createTestSerialNumber(), actor.profileId],
      );
      const source = await createSupplierSourceFixture(
        database,
        actor,
        productId,
        { catalogNumber: "AUDIT-ROLLBACK-001" },
      );
      await database.query(
        `create function public.test_reject_manual_inventory_audit()
         returns trigger
         language plpgsql
         set search_path = ''
         as $test_function$
         begin
           if new.action_type = 'inventory.manual_adjusted' then
             raise exception 'Test audit rejection'
               using errcode = 'TST01';
           end if;

           return new;
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_reject_manual_inventory_audit
         before insert on public.audit_logs
         for each row
         execute function public.test_reject_manual_inventory_audit()`,
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint failed_manual_inventory_audit");
      await expect(
        database.query(
          `select *
           from public.manual_adjust_inventory(
             $1::uuid,
             'add',
             3,
             'Must roll back',
             $2::uuid
           )`,
          [productId, source.productSupplierId],
        ),
      ).rejects.toMatchObject({ code: "TST01" });
      await database.query("rollback to savepoint failed_manual_inventory_audit");
      await database.query("reset role");

      const state = await database.query<{
        audit_count: number;
        movement_count: number;
        quantity: string;
      }>(
        `select
           balance.quantity,
           (
             select count(*)::integer
             from public.inventory_movements as movement
             where movement.product_id = balance.product_id
           ) as movement_count,
           (
             select count(*)::integer
             from public.audit_logs as audit
             where audit.entity_id = balance.product_id
               and audit.action_type = 'inventory.manual_adjusted'
           ) as audit_count
         from public.inventory_balances as balance
         where balance.product_id = $1::uuid`,
        [productId],
      );
      expect(state.rows).toEqual([{
        audit_count: 0,
        movement_count: 0,
        quantity: "0",
      }]);
      await assertInventorySourceInvariant(database, productId);
    });
  });
  committedConcurrencyIt("fails a waiting manual adjustment when the Product archive transition wins", async () => {
    const fixture = requireHarness();
    const productId = randomUUID();
    const applicationName = `alfaev-manual-adjust-wait-${randomUUID()}`;

    await fixture.withDatabaseClients(3, async (clients) => {
      const archiver = clients[0];
      const adjuster = clients[1];
      const observer = clients[2];
      if (!archiver || !adjuster || !observer) {
        throw new Error("Manual adjustment concurrency clients are unavailable");
      }

      await observer.query("begin");
      await observer.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Archive Race Product', 'Components',
           'component', $3::uuid, $3::uuid
         )`,
        [
          productId,
          createTestSerialNumber(),
          fixture.actors.admin.profileId,
        ],
      );
      const source = await createSupplierSourceFixture(
        observer,
        fixture.actors.admin,
        productId,
        { catalogNumber: "ARCHIVE-RACE-001" },
      );
      await observer.query("commit");

      try {
        await archiver.query("begin");
        await archiver.query(
          `update public.products
           set is_active = false,
               updated_at = pg_catalog.now(),
               updated_by_user_id = $2::uuid,
               archived_at = pg_catalog.now(),
               archived_by_user_id = $2::uuid
           where id = $1::uuid`,
          [productId, fixture.actors.admin.profileId],
        );

        await adjuster.query("begin");
        await adjuster.query(
          "select pg_catalog.set_config('application_name', $1::text, true)",
          [applicationName],
        );
        await adjuster.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await adjuster.query("set local role authenticated");
        const waitingAdjustment = adjuster.query(
          `select *
           from public.manual_adjust_inventory(
             $1::uuid,
             'add',
             1,
             'Must lose archive race',
             $2::uuid
           )`,
          [productId, source.productSupplierId],
        ).then(
          () => null,
          (error: unknown) => error,
        );

        let observedProductWait = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = await observer.query<ActivityWaitRow>(
            `select wait_event_type, wait_event
             from pg_catalog.pg_stat_activity
             where application_name = $1::text`,
            [applicationName],
          );
          if (activity.rows[0]?.wait_event_type === "Lock") {
            observedProductWait = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(observedProductWait).toBe(true);

        await archiver.query("commit");
        const adjustmentError = await waitingAdjustment;
        expect(adjustmentError).toMatchObject({ code: "PRD01" });
        await adjuster.query("rollback");

        const finalState = await observer.query<{
          audit_count: number;
          is_active: boolean;
          movement_count: number;
          quantity: string;
        }>(
          `select
             product.is_active,
             balance.quantity,
             (
               select count(*)::integer
               from public.inventory_movements as movement
               where movement.product_id = product.id
             ) as movement_count,
             (
               select count(*)::integer
               from public.audit_logs as audit
               where audit.entity_id = product.id
                 and audit.action_type = 'inventory.manual_adjusted'
             ) as audit_count
           from public.products as product
           join public.inventory_balances as balance
             on balance.product_id = product.id
           where product.id = $1::uuid`,
          [productId],
        );
        expect(finalState.rows).toEqual([{
          audit_count: 0,
          is_active: false,
          movement_count: 0,
          quantity: "0",
        }]);
      } finally {
        await archiver.query("rollback");
        await adjuster.query("rollback");
      }
    });
  });

}
