import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityFixtureHarness } from "./security-fixtures";
import { createTestSerialNumber } from "./helpers/serial";

interface CountResultRow {
  count: number;
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

interface CreatedProductRow {
  product_id: string;
  serial_number: string;
}

export function registerInventoryLedgerTests(requireHarness: () => SecurityFixtureHarness): void {
  it("creates exactly one whole-number zero InventoryBalance for every existing and future Product", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const missingZeroBalances = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.products as product
         where not exists (
           select 1
           from public.inventory_balances as balance
           where balance.product_id = product.id
             and balance.quantity = 0
         )`,
      );
      expect(missingZeroBalances.rows).toEqual([{ count: 0 }]);

      const activeProductId = randomUUID();
      const archivedProductId = randomUUID();
      await database.query(
        `insert into public.products (
           id,
           serial_number,
           name,
           category,
           product_kind,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $3::text, 'Balance Product', 'Components', 'component',
            true, $5::uuid, $5::uuid, null, null),
           ($2::uuid, $4::text, 'Archived Balance Product', 'Components',
            'pcb_finished_good', false, $5::uuid, $5::uuid,
            pg_catalog.now(), $5::uuid)`,
        [
          activeProductId,
          archivedProductId,
          createTestSerialNumber(),
          createTestSerialNumber(),
          actorId,
        ],
      );

      const balances = await database.query<InventoryBalanceRow>(
        `select product_id, quantity, updated_at
         from public.inventory_balances
         where product_id = any($1::uuid[])
         order by product_id`,
        [[activeProductId, archivedProductId]],
      );
      expect(balances.rows).toHaveLength(2);
      expect(balances.rows.map((balance) => ({
        productId: balance.product_id,
        quantity: balance.quantity,
        updatedAt: balance.updated_at,
      }))).toEqual(expect.arrayContaining([
        {
          productId: activeProductId,
          quantity: "0",
          updatedAt: expect.any(Date),
        },
        {
          productId: archivedProductId,
          quantity: "0",
          updatedAt: expect.any(Date),
        },
      ]));

      await database.query("savepoint duplicate_balance");
      await expect(
        database.query(
          `insert into public.inventory_balances (product_id)
           values ($1::uuid)`,
          [activeProductId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await database.query("rollback to savepoint duplicate_balance");

      await database.query("savepoint negative_balance");
      await expect(
        database.query(
          `update public.inventory_balances
           set quantity = -1
           where product_id = $1::uuid`,
          [activeProductId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await database.query("rollback to savepoint negative_balance");

      await database.query("savepoint fractional_balance");
      await expect(
        database.query(
          `update public.inventory_balances
           set quantity = $2::bigint
           where product_id = $1::uuid`,
          [activeProductId, "1.5"],
        ),
      ).rejects.toMatchObject({ code: "22P02" });
      await database.query("rollback to savepoint fractional_balance");

      const unchanged = await database.query<InventoryBalanceRow>(
        `select product_id, quantity, updated_at
         from public.inventory_balances
         where product_id = $1::uuid`,
        [activeProductId],
      );
      expect(unchanged.rows[0]?.quantity).toBe("0");

      await database.query("savepoint delete_product_with_balance");
      await expect(
        database.query("delete from public.products where id = $1::uuid", [activeProductId]),
      ).rejects.toMatchObject({ code: "23503" });
      await database.query("rollback to savepoint delete_product_with_balance");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<CreatedProductRow>(
        `select product_id, serial_number
         from public.create_product($1::text, $2::text, null)`,
        [`Balance RPC Product ${randomUUID()}`, "Components"],
      );
      await database.query("reset role");
      const createdProductId = created.rows[0]?.product_id;
      const createdBalance = await database.query<InventoryBalanceRow>(
        `select product_id, quantity, updated_at
         from public.inventory_balances
         where product_id = $1::uuid`,
        [createdProductId],
      );
      expect(createdBalance.rows).toEqual([
        {
          product_id: createdProductId,
          quantity: "0",
          updated_at: expect.any(Date),
        },
      ]);

      const columns = await database.query<{
        column_default: string | null;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'inventory_balances'
         order by ordinal_position`,
      );
      expect(columns.rows).toEqual([
        {
          column_default: null,
          column_name: "product_id",
          data_type: "uuid",
          is_nullable: "NO",
        },
        {
          column_default: "0",
          column_name: "quantity",
          data_type: "bigint",
          is_nullable: "NO",
        },
        {
          column_default: "now()",
          column_name: "updated_at",
          data_type: "timestamp with time zone",
          is_nullable: "NO",
        },
      ]);
      const constraints = await database.query<{ constraint_name: string }>(
        `select constraint_name
         from information_schema.table_constraints
         where table_schema = 'public'
           and table_name = 'inventory_balances'
         order by constraint_name`,
      );
      expect(constraints.rows.map((row) => row.constraint_name)).toEqual(
        expect.arrayContaining([
          "inventory_balances_product_id_fkey",
          "inventory_balances_pkey",
          "inventory_balances_quantity_nonnegative",
        ]),
      );
      const movements = await database.query<{ relation: string | null }>(
        "select pg_catalog.to_regclass('public.inventory_movements')::text as relation",
      );
      expect(movements.rows).toEqual([{ relation: "inventory_movements" }]);
    });
  });
  it("limits InventoryBalance reads to Inventory-authorized actors and denies all client writes", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const activeProductId = randomUUID();
      const archivedProductId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind, is_active,
           created_by_user_id, updated_by_user_id, archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $3::text, 'Visible Balance', 'Components', 'component',
            true, $5::uuid, $5::uuid, null, null),
           ($2::uuid, $4::text, 'Historical Balance', 'Components', 'component',
            false, $5::uuid, $5::uuid, pg_catalog.now(), $5::uuid)`,
        [
          activeProductId,
          archivedProductId,
          createTestSerialNumber(),
          createTestSerialNumber(),
          actorId,
        ],
      );

      for (const actor of [fixture.actors.admin, fixture.actors.brandManager]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ product_id: string; quantity: string }>(
          `select product_id, quantity
           from public.inventory_balances
           where product_id = any($1::uuid[])
           order by product_id`,
          [[activeProductId, archivedProductId]],
        );
        await database.query("reset role");
        expect(visible.rows).toHaveLength(2);
        expect(visible.rows.every((row) => row.quantity === "0")).toBe(true);
      }

      for (const actor of [
        fixture.actors.productCreator,
        fixture.actors.productEditor,
        fixture.actors.supplierViewer,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        fixture.actors.inactiveBrandManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ product_id: string }>(
          `select product_id
           from public.inventory_balances
           where product_id = any($1::uuid[])`,
          [[activeProductId, archivedProductId]],
        );
        await database.query("reset role");
        expect(hidden.rows).toEqual([]);
      }

      const security = await database.query<{
        authenticated_delete: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        row_security: boolean;
      }>(
        `select
           class.relrowsecurity as row_security,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'select') as authenticated_select,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'insert') as authenticated_insert,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'update') as authenticated_update,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'delete') as authenticated_delete
         from pg_catalog.pg_class as class
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = class.relnamespace
         where namespace.nspname = 'public'
           and class.relname = 'inventory_balances'`,
      );
      expect(security.rows).toEqual([{
        authenticated_delete: false,
        authenticated_insert: false,
        authenticated_select: true,
        authenticated_update: false,
        row_security: true,
      }]);

      const initializer = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        return_type: string;
        settings: string[];
        trigger_count: number;
      }>(
        `select
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute,
           pg_catalog.pg_get_function_result(routine.oid) as return_type,
           routine.proconfig as settings,
           (
             select count(*)::integer
             from pg_catalog.pg_trigger as trigger
             where trigger.tgfoid = routine.oid
               and not trigger.tgisinternal
           ) as trigger_count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'initialize_product_inventory_balance'`,
      );
      expect(initializer.rows).toEqual([{
        anonymous_execute: false,
        authenticated_execute: false,
        return_type: "trigger",
        settings: ["search_path=\"\""],
        trigger_count: 1,
      }]);
    });

    const client = fixture.actors.admin.client;
    const directInsert = await client.from("inventory_balances").insert({
      product_id: randomUUID(),
      quantity: 0,
    });
    const directUpdate = await client
      .from("inventory_balances")
      .update({ quantity: 1 })
      .eq("product_id", randomUUID());
    const directDelete = await client
      .from("inventory_balances")
      .delete()
      .eq("product_id", randomUUID());
    expectPermissionDenied(directInsert.error);
    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);

    const anonymousRead = await fixture.anonymousClient
      .from("inventory_balances")
      .select("product_id")
      .limit(1);
    expectPermissionDenied(anonymousRead.error);
    const initializerCall = await client.rpc("initialize_product_inventory_balance");
    expect(initializerCall.error).not.toBeNull();
    expect(["42501", "PGRST202"]).toContain(initializerCall.error?.code);
  });
  it("enforces canonical InventoryMovement fields, arithmetic, references, and optional context", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const productId = randomUUID();
      const firstMovementId = randomUUID();
      const secondMovementId = randomUUID();
      const reversalMovementId = randomUUID();
      const sourceId = randomUUID();
      const projectId = randomUUID();

      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         )
         values (
           $1::uuid, $2::text, 'Movement Product', 'Components', 'component',
           $3::uuid, $3::uuid
         )`,
        [productId, createTestSerialNumber(), actorId],
      );
      const balanceBefore = await database.query<InventoryBalanceRow>(
        `select product_id, quantity, updated_at
         from public.inventory_balances
         where product_id = $1::uuid`,
        [productId],
      );

      await database.query(
        `insert into public.inventory_movements (
           id, product_id, movement_type, quantity_delta, quantity_before,
           quantity_after, actor_user_id
         )
         values ($1::uuid, $2::uuid, 'stock_in', 5, 0, 5, $3::uuid)`,
        [firstMovementId, productId, actorId],
      );
      await database.query(
        `insert into public.inventory_movements (
           id, product_id, movement_type, quantity_delta, quantity_before,
           quantity_after, reason, source_type, source_id, project_id,
           actor_user_id
         )
         values (
           $1::uuid, $2::uuid, 'stock_out', -2, 5, 3,
           'Consumed by fixture', 'work_order', $3::uuid, $4::uuid, $5::uuid
         )`,
        [secondMovementId, productId, sourceId, projectId, actorId],
      );
      await database.query(
        `insert into public.inventory_movements (
           id, product_id, movement_type, quantity_delta, quantity_before,
           quantity_after, source_type, actor_user_id,
           reversal_of_movement_id
         )
         values (
           $1::uuid, $2::uuid, 'correction_reversal', -5, 5, 0,
           'correction_reversal', $3::uuid, $4::uuid
         )`,
        [reversalMovementId, productId, actorId, firstMovementId],
      );

      const movements = await database.query<InventoryMovementRow>(
        `select *
         from public.inventory_movements
         where id = any($1::uuid[])
         order by created_at, id`,
        [[firstMovementId, secondMovementId, reversalMovementId]],
      );
      expect(movements.rows).toHaveLength(3);
      expect(movements.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actor_user_id: actorId,
          id: firstMovementId,
          movement_type: "stock_in",
          product_id: productId,
          project_id: null,
          quantity_after: "5",
          quantity_before: "0",
          quantity_delta: "5",
          reason: null,
          reversal_of_movement_id: null,
          source_id: null,
          source_type: null,
        }),
        expect.objectContaining({
          id: secondMovementId,
          project_id: projectId,
          quantity_after: "3",
          quantity_before: "5",
          quantity_delta: "-2",
          reason: "Consumed by fixture",
          source_id: sourceId,
          source_type: "work_order",
        }),
        expect.objectContaining({
          id: reversalMovementId,
          reversal_of_movement_id: firstMovementId,
        }),
      ]));
      expect(movements.rows.every((movement) =>
        movement.created_at instanceof Date)).toBe(true);

      const invalidMovements: Array<{
        errorCode: string;
        sql: string;
        values: unknown[];
      }> = [
        {
          errorCode: "23514",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, actor_user_id
                ) values ($1::uuid, '   ', 1, 0, 1, $2::uuid)`,
          values: [productId, actorId],
        },
        {
          errorCode: "23514",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, reason, actor_user_id
                ) values ($1::uuid, 'stock_in', 1, 0, 1, ' padded ', $2::uuid)`,
          values: [productId, actorId],
        },
        {
          errorCode: "23514",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, source_type, actor_user_id
                ) values ($1::uuid, 'stock_in', 1, 0, 1, '', $2::uuid)`,
          values: [productId, actorId],
        },
        {
          errorCode: "23514",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, actor_user_id
                ) values ($1::uuid, 'stock_in', 2, 1, 2, $2::uuid)`,
          values: [productId, actorId],
        },
        {
          errorCode: "23514",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, actor_user_id
                ) values ($1::uuid, 'stock_in', 1, -1, 0, $2::uuid)`,
          values: [productId, actorId],
        },
        {
          errorCode: "23514",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, actor_user_id
                ) values ($1::uuid, 'stock_out', -1, 0, -1, $2::uuid)`,
          values: [productId, actorId],
        },
        {
          errorCode: "22P02",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, actor_user_id
                ) values (
                  $1::uuid, 'stock_in', $2::bigint, 0, 1, $3::uuid
                )`,
          values: [productId, "1.5", actorId],
        },
        {
          errorCode: "23514",
          sql: `insert into public.inventory_movements (
                  id, product_id, movement_type, quantity_delta,
                  quantity_before, quantity_after, actor_user_id,
                  reversal_of_movement_id
                ) values (
                  $1::uuid, $2::uuid, 'correction_reversal', 0, 0, 0,
                  $3::uuid, $1::uuid
                )`,
          values: [randomUUID(), productId, actorId],
        },
        {
          errorCode: "23503",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, actor_user_id
                ) values ($1::uuid, 'stock_in', 1, 0, 1, $2::uuid)`,
          values: [randomUUID(), actorId],
        },
        {
          errorCode: "23503",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, actor_user_id
                ) values ($1::uuid, 'stock_in', 1, 0, 1, $2::uuid)`,
          values: [productId, randomUUID()],
        },
      ];

      for (const invalid of invalidMovements) {
        await database.query("savepoint invalid_inventory_movement");
        await expect(database.query(invalid.sql, invalid.values))
          .rejects.toMatchObject({ code: invalid.errorCode });
        await database.query("rollback to savepoint invalid_inventory_movement");
      }

      const balanceAfter = await database.query<InventoryBalanceRow>(
        `select product_id, quantity, updated_at
         from public.inventory_balances
         where product_id = $1::uuid`,
        [productId],
      );
      expect(balanceAfter.rows).toEqual(balanceBefore.rows);

      const foreignKeys = await database.query<{
        constraint_name: string;
        delete_action: string;
      }>(
        `select
           constraint_name,
           delete_rule as delete_action
         from information_schema.referential_constraints
         where constraint_schema = 'public'
           and constraint_name like 'inventory_movements_%_fkey'
         order by constraint_name`,
      );
      expect(foreignKeys.rows).toEqual([
        {
          constraint_name: "inventory_movements_actor_user_id_fkey",
          delete_action: "RESTRICT",
        },
        {
          constraint_name: "inventory_movements_product_id_fkey",
          delete_action: "RESTRICT",
        },
        {
          constraint_name: "inventory_movements_reversal_of_movement_id_fkey",
          delete_action: "RESTRICT",
        },
      ]);
      const projectOrSourceForeignKey = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from information_schema.key_column_usage
         where constraint_schema = 'public'
           and table_name = 'inventory_movements'
           and column_name in ('project_id', 'source_id')
           and position_in_unique_constraint is not null`,
      );
      expect(projectOrSourceForeignKey.rows).toEqual([{ count: 0 }]);
    });
  });
  it("makes InventoryMovement rows immutable even for trusted database workflows", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const productId = randomUUID();
      const movementId = randomUUID();
      const actorId = fixture.actors.admin.profileId;
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Immutable Movement Product', 'Components',
           'component', $3::uuid, $3::uuid
         )`,
        [productId, createTestSerialNumber(), actorId],
      );
      await database.query(
        `insert into public.inventory_movements (
           id, product_id, movement_type, quantity_delta, quantity_before,
           quantity_after, actor_user_id
         ) values ($1::uuid, $2::uuid, 'stock_in', 4, 0, 4, $3::uuid)`,
        [movementId, productId, actorId],
      );

      await database.query("savepoint update_inventory_movement");
      await expect(
        database.query(
          `update public.inventory_movements
           set reason = 'Rewritten history'
           where id = $1::uuid`,
          [movementId],
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await database.query("rollback to savepoint update_inventory_movement");

      await database.query("savepoint delete_inventory_movement");
      await expect(
        database.query(
          "delete from public.inventory_movements where id = $1::uuid",
          [movementId],
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await database.query("rollback to savepoint delete_inventory_movement");

      const preserved = await database.query<InventoryMovementRow>(
        "select * from public.inventory_movements where id = $1::uuid",
        [movementId],
      );
      expect(preserved.rows).toHaveLength(1);

      const triggerSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        return_type: string;
        settings: string[];
        trigger_count: number;
      }>(
        `select
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute,
           pg_catalog.pg_get_function_result(routine.oid) as return_type,
           routine.proconfig as settings,
           (
             select count(*)::integer
             from pg_catalog.pg_trigger as trigger
             where trigger.tgfoid = routine.oid
               and not trigger.tgisinternal
           ) as trigger_count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'prevent_inventory_movement_mutation'`,
      );
      expect(triggerSecurity.rows).toEqual([{
        anonymous_execute: false,
        authenticated_execute: false,
        return_type: "trigger",
        settings: ["search_path=\"\""],
        trigger_count: 1,
      }]);
      const trustedInserters = await database.query<{ function_name: string }>(
        `select routine.proname as function_name
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.prorettype <> 'trigger'::pg_catalog.regtype
           and routine.prosrc ilike '%insert into public.inventory_movements%'
         order by routine.proname`,
      );
      expect(trustedInserters.rows).toEqual([
        { function_name: "apply_inventory_delta" },
      ]);
    });
  });
  it("limits InventoryMovement reads to Inventory-authorized actors and denies direct client writes", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const activeProductId = randomUUID();
      const archivedProductId = randomUUID();
      const activeMovementId = randomUUID();
      const archivedMovementId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind, is_active,
           created_by_user_id, updated_by_user_id, archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $3::text, 'Movement Read Product', 'Components',
            'component', true, $5::uuid, $5::uuid, null, null),
           ($2::uuid, $4::text, 'Archived Movement Product', 'Components',
            'component', false, $5::uuid, $5::uuid,
            pg_catalog.now(), $5::uuid)`,
        [
          activeProductId,
          archivedProductId,
          createTestSerialNumber(),
          createTestSerialNumber(),
          actorId,
        ],
      );
      await database.query(
        `insert into public.inventory_movements (
           id, product_id, movement_type, quantity_delta, quantity_before,
           quantity_after, actor_user_id
         ) values
           ($1::uuid, $3::uuid, 'stock_in', 1, 0, 1, $5::uuid),
           ($2::uuid, $4::uuid, 'stock_in', 2, 0, 2, $5::uuid)`,
        [activeMovementId, archivedMovementId, activeProductId, archivedProductId, actorId],
      );

      for (const actor of [fixture.actors.admin, fixture.actors.brandManager]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ id: string }>(
          `select id
           from public.inventory_movements
           where id = any($1::uuid[])
           order by id`,
          [[activeMovementId, archivedMovementId]],
        );
        await database.query("reset role");
        expect(visible.rows.map((row) => row.id).sort()).toEqual(
          [activeMovementId, archivedMovementId].sort(),
        );
      }

      for (const actor of [
        fixture.actors.productCreator,
        fixture.actors.productEditor,
        fixture.actors.supplierViewer,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        fixture.actors.inactiveBrandManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ id: string }>(
          `select id
           from public.inventory_movements
           where id = any($1::uuid[])`,
          [[activeMovementId, archivedMovementId]],
        );
        await database.query("reset role");
        expect(hidden.rows).toEqual([]);
      }

      const security = await database.query<{
        authenticated_delete: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        row_security: boolean;
      }>(
        `select
           class.relrowsecurity as row_security,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'select') as authenticated_select,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'insert') as authenticated_insert,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'update') as authenticated_update,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'delete') as authenticated_delete
         from pg_catalog.pg_class as class
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = class.relnamespace
         where namespace.nspname = 'public'
           and class.relname = 'inventory_movements'`,
      );
      expect(security.rows).toEqual([{
        authenticated_delete: false,
        authenticated_insert: false,
        authenticated_select: true,
        authenticated_update: false,
        row_security: true,
      }]);
    });

    const client = fixture.actors.admin.client;
    const directInsert = await client.from("inventory_movements").insert({
      product_id: randomUUID(),
      movement_type: "stock_in",
      quantity_delta: 1,
      quantity_before: 0,
      quantity_after: 1,
      actor_user_id: fixture.actors.admin.profileId,
    });
    const directUpdate = await client
      .from("inventory_movements")
      .update({ reason: "Forbidden" })
      .eq("id", randomUUID());
    const directDelete = await client
      .from("inventory_movements")
      .delete()
      .eq("id", randomUUID());
    expectPermissionDenied(directInsert.error);
    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);

    const anonymousRead = await fixture.anonymousClient
      .from("inventory_movements")
      .select("id")
      .limit(1);
    expectPermissionDenied(anonymousRead.error);
  });

}
