import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { PoolClient, QueryResultRow } from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { loadBackendTestEnvironment } from "./env";
import { createTestSerialNumber } from "./helpers/serial";
import type { SecurityFixtureHarness } from "./security-fixtures";
import {
  actAs,
  createPreflightFixture,
} from "./work-order-finish-preflight.suite";

const environment = loadBackendTestEnvironment();
const storageService = createClient(
  environment.supabaseUrl,
  environment.supabaseSecretKey,
  {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  },
);
const storagePaths = new Set<string>();
const pdfBytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n%%EOF\n");

interface ManualAdjustmentRow extends QueryResultRow {
  movement_id: string;
  quantity_after: string;
  quantity_before: string;
}

interface MovementRow extends QueryResultRow {
  id: string;
  movement_type: string;
  quantity_after: string;
  quantity_before: string;
  quantity_delta: string;
  source_id: string | null;
  source_type: string | null;
}

interface PcbFixture {
  bomVersionId: string;
  cardId: string;
  inputProductId: string;
  outputProductId: string;
  updatedAt: string;
  workOrderId: string;
}

interface GenericFixture {
  productId: string;
  projectId: string;
  updatedAt: string;
  workOrderId: string;
}

function normalizeDefinition(definition: string): string {
  return definition.toLowerCase().replace(/\s+/g, " ");
}

function expectOrderedFragments(definition: string, fragments: string[]): void {
  let previous = -1;
  for (const fragment of fragments) {
    const index = definition.indexOf(fragment, previous + 1);
    expect(index, `missing or out-of-order SQL fragment: ${fragment}`).toBeGreaterThan(previous);
    previous = index;
  }
}

async function waitForLockWait(
  observer: PoolClient,
  applicationName: string,
): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const waiting = (await observer.query<{ waiting: boolean }>(
      `select exists (
         select 1
         from pg_catalog.pg_stat_activity as activity
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

async function uploadPdf(workOrderId: string): Promise<string> {
  const path = `final/${workOrderId}/${randomUUID()}.pdf`;
  const { error } = await storageService.storage.from("work-order-pdfs").upload(
    path,
    pdfBytes,
    { contentType: "application/pdf", upsert: false },
  );
  if (error) throw new Error(`Task 148 PDF fixture upload failed: ${error.message}`);
  storagePaths.add(path);
  return path;
}

async function removeStorageFixtures(): Promise<void> {
  const paths = [...storagePaths];
  if (paths.length === 0) return;
  const { error } = await storageService.storage.from("work-order-pdfs").remove(paths);
  if (error) throw new Error(`Task 148 PDF cleanup failed: ${error.message}`);
  paths.forEach((path) => storagePaths.delete(path));
}

async function createProduct(
  database: PoolClient,
  actorId: string,
  quantity: string,
  kind: "component" | "pcb_finished_good" = "component",
): Promise<string> {
  const productId = randomUUID();
  await database.query(
    `insert into public.products (
       id, serial_number, name, category, product_kind,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, $3::text, 'Task 148', $4::text,
       $5::uuid, $5::uuid
     )`,
    [
      productId,
      createTestSerialNumber(),
      `Task 148 Product ${productId}`,
      kind,
      actorId,
    ],
  );
  await database.query(
    `update public.inventory_balances
     set quantity = $2::bigint, updated_at = pg_catalog.clock_timestamp()
     where product_id = $1::uuid`,
    [productId, quantity],
  );
  return productId;
}

async function manualAdjust(
  database: PoolClient,
  productId: string,
  type: "add" | "correction" | "remove",
  quantity: string,
  reason: string,
): Promise<ManualAdjustmentRow> {
  const row = (await database.query<ManualAdjustmentRow>(
    `select movement_id, quantity_before::text, quantity_after::text
     from public.manual_adjust_inventory($1::uuid, $2::text, $3::bigint, $4::text)`,
    [productId, type, quantity, reason],
  )).rows[0];
  if (!row) throw new Error("Task 148 manual adjustment returned no row");
  return row;
}

async function assertLedger(
  database: PoolClient,
  productId: string,
  initialQuantity: bigint,
  expectedTerminal: bigint,
  expectedCount: number,
): Promise<MovementRow[]> {
  const movements = (await database.query<MovementRow>(
    `select id, movement_type, quantity_delta::text, quantity_before::text,
            quantity_after::text, source_type, source_id
     from public.inventory_movements
     where product_id = $1::uuid
     order by created_at, id`,
    [productId],
  )).rows;
  expect(movements).toHaveLength(expectedCount);
  let expectedBefore = initialQuantity;
  for (const movement of movements) {
    expect(BigInt(movement.quantity_before)).toBe(expectedBefore);
    const expectedAfter = expectedBefore + BigInt(movement.quantity_delta);
    expect(BigInt(movement.quantity_after)).toBe(expectedAfter);
    expect(expectedAfter).toBeGreaterThanOrEqual(0n);
    expectedBefore = expectedAfter;
  }
  expect(expectedBefore).toBe(expectedTerminal);
  expect((await database.query<{ quantity: string }>(
    `select quantity::text as quantity
     from public.inventory_balances where product_id = $1::uuid`,
    [productId],
  )).rows).toEqual([{ quantity: expectedTerminal.toString() }]);
  return movements;
}

async function cleanupManualFixture(
  database: PoolClient,
  productId: string,
): Promise<void> {
  await database.query("begin");
  try {
    await database.query("set local session_replication_role = replica");
    await database.query(
      `delete from public.audit_logs
       where entity_id = $1::uuid
         and action_type = 'inventory.manual_adjusted'`,
      [productId],
    );
    await database.query(
      "delete from public.inventory_movements where product_id = $1::uuid",
      [productId],
    );
    await database.query(
      "delete from public.inventory_balances where product_id = $1::uuid",
      [productId],
    );
    await database.query("delete from public.products where id = $1::uuid", [productId]);
    await database.query("commit");
  } catch (error) {
    await database.query("rollback");
    throw error;
  }
  expect((await database.query<{ count: string }>(
    `select (
       (select pg_catalog.count(*) from public.products where id = $1::uuid)
       + (select pg_catalog.count(*) from public.inventory_balances where product_id = $1::uuid)
       + (select pg_catalog.count(*) from public.inventory_movements where product_id = $1::uuid)
       + (select pg_catalog.count(*) from public.audit_logs
          where entity_id = $1::uuid and action_type = 'inventory.manual_adjusted')
     )::text as count`,
    [productId],
  )).rows).toEqual([{ count: "0" }]);
}

async function nextWorkOrderNumber(database: PoolClient): Promise<string> {
  const number = (await database.query<{ work_order_number: string }>(
    `select 'RN-8996-' || pg_catalog.lpad(candidate::text, 4, '0') as work_order_number
     from pg_catalog.generate_series(1, 9999) as candidate
     where not exists (
       select 1 from public.work_orders as work_order
       where work_order.work_order_number =
         'RN-8996-' || pg_catalog.lpad(candidate::text, 4, '0')
     )
     order by candidate
     limit 1`,
  )).rows[0]?.work_order_number;
  if (!number) throw new Error("Task 148 isolated Work Order number unavailable");
  return number;
}

async function finishGeneric(
  database: PoolClient,
  fixture: GenericFixture,
  storageReference: string,
): Promise<void> {
  await database.query(
    `select * from public.finish_work_order(
       $1::uuid, $2::timestamptz, $3::text, null::text
     )`,
    [fixture.workOrderId, fixture.updatedAt, storageReference],
  );
}

async function finishPcb(
  database: PoolClient,
  fixture: PcbFixture,
  storageReference: string,
  actualGood: string,
): Promise<void> {
  await database.query(
    `select * from public.finish_work_order(
       $1::uuid, $2::timestamptz, $3::text, null::text, $4::text
     )`,
    [fixture.workOrderId, fixture.updatedAt, storageReference, actualGood],
  );
}

async function cleanupGenericFixture(
  database: PoolClient,
  fixture: GenericFixture,
): Promise<void> {
  const immutable = (await database.query<{
    audits: string;
    movements: string;
    pdfs: string;
  }>(
    `select
       (select pg_catalog.count(*)::text from public.audit_logs
        where entity_id in ($1::uuid, $2::uuid)) as audits,
       (select pg_catalog.count(*)::text from public.inventory_movements
        where source_type = 'work_order' and source_id = $1::uuid) as movements,
       (select pg_catalog.count(*)::text from public.work_order_pdfs
        where work_order_id = $1::uuid) as pdfs`,
    [fixture.workOrderId, fixture.projectId],
  )).rows[0];
  expect(immutable).toEqual({ audits: "0", movements: "0", pdfs: "0" });

  await database.query("begin");
  try {
    await database.query(
      "delete from public.work_order_items where work_order_id = $1::uuid",
      [fixture.workOrderId],
    );
    await database.query("delete from public.work_orders where id = $1::uuid", [fixture.workOrderId]);
    await database.query(
      `delete from public.project_product_components
       where project_product_id in (
         select id from public.project_products where project_id = $1::uuid
       )`,
      [fixture.projectId],
    );
    await database.query("delete from public.project_products where project_id = $1::uuid", [fixture.projectId]);
    await database.query("delete from public.inventory_balances where product_id = $1::uuid", [fixture.productId]);
    await database.query("delete from public.products where id = $1::uuid", [fixture.productId]);
    await database.query("delete from public.projects where id = $1::uuid", [fixture.projectId]);
    await database.query("commit");
  } catch (error) {
    await database.query("rollback");
    throw error;
  }
}

async function createPcbFixture(
  database: PoolClient,
  actorId: string,
  values: {
    frozenQuantity: string;
    inputProductId?: string;
    inputStock?: string;
    supplementalQuantity?: string;
  },
): Promise<PcbFixture> {
  const inputProductId = values.inputProductId ?? await createProduct(
    database,
    actorId,
    values.inputStock ?? "10",
  );
  if (values.inputProductId && values.inputStock !== undefined) {
    await database.query(
      "update public.inventory_balances set quantity = $2::bigint where product_id = $1::uuid",
      [inputProductId, values.inputStock],
    );
  }
  const outputProductId = await createProduct(database, actorId, "0", "pcb_finished_good");
  const cardId = randomUUID();
  const bomVersionId = randomUUID();
  const workOrderId = randomUUID();
  await database.query(
    `insert into public.pcb_cards (
       id, name, output_product_id, created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::text, $3::uuid, $4::uuid, $4::uuid)`,
    [cardId, `Task 148 Card ${cardId}`, outputProductId, actorId],
  );
  await database.query(
    `insert into public.pcb_bom_versions (
       id, pcb_card_id, version_number, created_by_user_id
     ) values ($1::uuid, $2::uuid, 1, $3::uuid)`,
    [bomVersionId, cardId, actorId],
  );
  await database.query(
    `insert into public.pcb_bom_items (
       bom_version_id, component_product_id, quantity_per_card
     ) values ($1::uuid, $2::uuid, $3::bigint)`,
    [bomVersionId, inputProductId, values.frozenQuantity],
  );
  await database.query(
    `insert into public.work_orders (
       id, work_order_number, project_id, customer_name_snapshot, description,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, null, null, $3::text, $4::uuid, $4::uuid
     )`,
    [workOrderId, await nextWorkOrderNumber(database), `PCB production — Task 148 Card ${cardId}`, actorId],
  );
  await database.query(
    `insert into public.work_order_items (
       work_order_id, product_id, quantity, added_by_user_id
     ) values ($1::uuid, $2::uuid, $3::bigint, $4::uuid)`,
    [workOrderId, inputProductId, values.frozenQuantity, actorId],
  );
  await database.query(
    `insert into public.pcb_production_work_orders (
       work_order_id, pcb_card_id, bom_version_id, planned_quantity,
       creation_request_id, created_by_user_id
     ) values ($1::uuid, $2::uuid, $3::uuid, 1, $4::uuid, $5::uuid)`,
    [workOrderId, cardId, bomVersionId, randomUUID(), actorId],
  );
  if (values.supplementalQuantity !== undefined) {
    await database.query(
      `insert into public.work_order_items (
         work_order_id, product_id, quantity, added_by_user_id, source_type
       ) values ($1::uuid, $2::uuid, $3::bigint, $4::uuid, 'manual')`,
      [workOrderId, inputProductId, values.supplementalQuantity, actorId],
    );
  }
  const updatedAt = (await database.query<{ updated_at: string }>(
    "select updated_at::text as updated_at from public.work_orders where id = $1::uuid",
    [workOrderId],
  )).rows[0]?.updated_at;
  if (!updatedAt) throw new Error("Task 148 PCB Work Order timestamp unavailable");
  return {
    bomVersionId,
    cardId,
    inputProductId,
    outputProductId,
    updatedAt,
    workOrderId,
  };
}

async function cleanupPcbFixtures(
  database: PoolClient,
  fixtures: PcbFixture[],
  sharedInputProductId?: string,
): Promise<void> {
  const workOrderIds = fixtures.map((fixture) => fixture.workOrderId);
  const cardIds = fixtures.map((fixture) => fixture.cardId);
  const versionIds = fixtures.map((fixture) => fixture.bomVersionId);
  const productIds = [
    ...new Set([
      ...fixtures.map((fixture) => fixture.outputProductId),
      ...fixtures.map((fixture) => fixture.inputProductId),
    ]),
  ];
  const immutable = (await database.query<{
    audits: string;
    movements: string;
    pdfs: string;
    runs: string;
  }>(
    `select
       (select pg_catalog.count(*)::text from public.audit_logs
        where entity_id = any($1::uuid[])) as audits,
       (select pg_catalog.count(*)::text from public.inventory_movements
        where product_id = any($2::uuid[])) as movements,
       (select pg_catalog.count(*)::text from public.work_order_pdfs
        where work_order_id = any($1::uuid[])) as pdfs,
       (select pg_catalog.count(*)::text from public.pcb_production_runs
        where work_order_id = any($1::uuid[])) as runs`,
    [workOrderIds, productIds],
  )).rows[0];
  expect(immutable).toEqual({ audits: "0", movements: "0", pdfs: "0", runs: "0" });

  await database.query("begin");
  try {
    await database.query("delete from public.pcb_production_work_orders where work_order_id = any($1::uuid[])", [workOrderIds]);
    await database.query("delete from public.work_order_items where work_order_id = any($1::uuid[])", [workOrderIds]);
    await database.query("delete from public.work_orders where id = any($1::uuid[])", [workOrderIds]);
    await database.query("delete from public.pcb_bom_items where bom_version_id = any($1::uuid[])", [versionIds]);
    await database.query("delete from public.pcb_bom_versions where id = any($1::uuid[])", [versionIds]);
    await database.query("delete from public.pcb_cards where id = any($1::uuid[])", [cardIds]);
    await database.query("delete from public.inventory_balances where product_id = any($1::uuid[])", [productIds]);
    await database.query("delete from public.products where id = any($1::uuid[])", [
      sharedInputProductId ? productIds.filter((id) => id !== sharedInputProductId) : productIds,
    ]);
    await database.query("commit");
  } catch (error) {
    await database.query("rollback");
    throw error;
  }
}

export function registerInventoryConcurrencyAuditTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 148 Inventory concurrency audit", () => {
    afterEach(async () => {
      await removeStorageFixtures();
    });

    it("audits the deployed lock order, atomic ledger primitive, and trusted boundaries", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const rows = (await database.query<{
          apply_authenticated: boolean;
          apply_definition: string;
          finish_definition: string;
          legacy_pcb_authenticated: boolean;
          manual_definition: string;
          pcb_finish_definition: string;
          pcb_preflight_definition: string;
          preflight_definition: string;
        }>(
          `select
             pg_catalog.pg_get_functiondef('public.apply_inventory_delta(uuid,bigint,text,text,text,uuid,uuid,uuid)'::pg_catalog.regprocedure) as apply_definition,
             pg_catalog.pg_get_functiondef('public.manual_adjust_inventory(uuid,text,bigint,text)'::pg_catalog.regprocedure) as manual_definition,
             pg_catalog.pg_get_functiondef('public.preflight_finish_work_order(uuid,timestamptz)'::pg_catalog.regprocedure) as preflight_definition,
             pg_catalog.pg_get_functiondef('public.finish_work_order(uuid,timestamptz,text,text)'::pg_catalog.regprocedure) as finish_definition,
             pg_catalog.pg_get_functiondef('public.preflight_finish_pcb_production_work_order(uuid,timestamptz,text)'::pg_catalog.regprocedure) as pcb_preflight_definition,
             pg_catalog.pg_get_functiondef('public.finish_work_order(uuid,timestamptz,text,text,text)'::pg_catalog.regprocedure) as pcb_finish_definition,
             pg_catalog.has_function_privilege('authenticated', 'public.apply_inventory_delta(uuid,bigint,text,text,text,uuid,uuid,uuid)', 'EXECUTE') as apply_authenticated,
             pg_catalog.has_function_privilege('authenticated', 'public.produce_pcb(uuid,text,uuid)', 'EXECUTE') as legacy_pcb_authenticated`,
        )).rows[0]!;
        const apply = normalizeDefinition(rows.apply_definition);
        const manual = normalizeDefinition(rows.manual_definition);
        const preflight = normalizeDefinition(rows.preflight_definition);
        const finish = normalizeDefinition(rows.finish_definition);
        const pcbPreflight = normalizeDefinition(rows.pcb_preflight_definition);
        const pcbFinish = normalizeDefinition(rows.pcb_finish_definition);

        expectOrderedFragments(apply, [
          "from public.inventory_balances as balance",
          "for update",
          "if resulting_quantity < 0",
          "update public.inventory_balances as balance",
          "insert into public.inventory_movements as inserted",
        ]);
        expectOrderedFragments(manual, [
          "from public.products as product",
          "for update",
          "when 'correction' then",
          "from public.inventory_balances as balance",
          "for update",
          "from public.apply_inventory_delta",
          "public.append_audit_log",
        ]);
        expectOrderedFragments(preflight, [
          "from public.work_orders as work_order",
          "for update",
          "from public.projects as project",
          "for update",
          "order by product.id",
          "for share of product",
          "order by balance.product_id",
          "for update of balance",
        ]);
        expect(finish).toContain("order by item.product_id");
        expect(finish).toContain("from public.apply_inventory_delta");
        expect(pcbPreflight).toContain("group by item.product_id");
        expect(pcbPreflight).toContain("order by balance.product_id");
        expect(pcbPreflight).toContain("for update");
        expect(pcbPreflight).toContain(
          "balance.quantity::numeric - coalesce(( select pg_catalog.sum(item.quantity::numeric)",
        );
        expect(pcbPreflight).toContain("+ actual_good_value::numeric");
        expect(pcbFinish).toContain("group by item.product_id order by item.product_id");
        expect(pcbFinish).toContain("p_movement_type => 'pcb_production_input'");
        expect(pcbFinish).toContain("p_movement_type => 'pcb_production_output'");
        expect(rows.apply_authenticated).toBe(false);
        expect(rows.legacy_pcb_authenticated).toBe(false);

        expect((await database.query<{
          balances_delete: boolean;
          balances_insert: boolean;
          balances_update: boolean;
          movements_delete: boolean;
          movements_insert: boolean;
          movements_update: boolean;
        }>(
          `select
             pg_catalog.has_table_privilege('authenticated', 'public.inventory_balances', 'INSERT') as balances_insert,
             pg_catalog.has_table_privilege('authenticated', 'public.inventory_balances', 'UPDATE') as balances_update,
             pg_catalog.has_table_privilege('authenticated', 'public.inventory_balances', 'DELETE') as balances_delete,
             pg_catalog.has_table_privilege('authenticated', 'public.inventory_movements', 'INSERT') as movements_insert,
             pg_catalog.has_table_privilege('authenticated', 'public.inventory_movements', 'UPDATE') as movements_update,
             pg_catalog.has_table_privilege('authenticated', 'public.inventory_movements', 'DELETE') as movements_delete`,
        )).rows[0]).toEqual({
          balances_delete: false,
          balances_insert: false,
          balances_update: false,
          movements_delete: false,
          movements_insert: false,
          movements_update: false,
        });
      });
    });

    it("commits one of two unaffordable concurrent manual Removes without a partial loser", async () => {
      const fixture = requireHarness();
      const actor = fixture.actors.admin;
      await fixture.withDatabaseClients(3, async ([first, second, observer]) => {
        if (!first || !second || !observer) throw new Error("Task 148 Remove clients unavailable");
        const productId = await (async () => {
          await observer.query("begin");
          const id = await createProduct(observer, actor.profileId, "10");
          await observer.query("commit");
          return id;
        })();
        const applicationName = `task148-remove-${randomUUID()}`;
        try {
          await first.query("begin");
          await actAs(first, actor);
          expect(await manualAdjust(first, productId, "remove", "7", "Task 148 first Remove"))
            .toMatchObject({ quantity_before: "10", quantity_after: "3" });

          await second.query("begin");
          await second.query("select pg_catalog.set_config('application_name', $1::text, true)", [applicationName]);
          await actAs(second, actor);
          const loser = manualAdjust(second, productId, "remove", "7", "Task 148 second Remove")
            .then(() => null, (error: unknown) => error);
          await waitForLockWait(observer, applicationName);
          await first.query("commit");
          expect(await loser).toMatchObject({ code: "IVB02" });
          await second.query("rollback");

          const movements = await assertLedger(observer, productId, 10n, 3n, 1);
          expect(movements[0]).toMatchObject({
            movement_type: "manual_remove",
            quantity_delta: "-7",
            source_type: "manual_adjustment",
          });
          expect((await observer.query<{ count: string }>(
            `select pg_catalog.count(*)::text as count from public.audit_logs
             where entity_id = $1::uuid and action_type = 'inventory.manual_adjusted'`,
            [productId],
          )).rows).toEqual([{ count: "1" }]);
        } finally {
          await first.query("rollback").catch(() => undefined);
          await second.query("rollback").catch(() => undefined);
          await cleanupManualFixture(observer, productId);
        }
      });
    });

    it("commits concurrent manual Adds without a lost update and preserves the ledger chain", async () => {
      const fixture = requireHarness();
      const actor = fixture.actors.admin;
      await fixture.withDatabaseClients(3, async ([first, second, observer]) => {
        if (!first || !second || !observer) throw new Error("Task 148 Add clients unavailable");
        await observer.query("begin");
        const productId = await createProduct(observer, actor.profileId, "5");
        await observer.query("commit");
        const applicationName = `task148-add-${randomUUID()}`;
        try {
          await first.query("begin");
          await actAs(first, actor);
          expect(await manualAdjust(first, productId, "add", "3", "Task 148 first Add"))
            .toMatchObject({ quantity_before: "5", quantity_after: "8" });
          await second.query("begin");
          await second.query("select pg_catalog.set_config('application_name', $1::text, true)", [applicationName]);
          await actAs(second, actor);
          const waiting = manualAdjust(second, productId, "add", "4", "Task 148 second Add");
          await waitForLockWait(observer, applicationName);
          await first.query("commit");
          expect(await waiting).toMatchObject({ quantity_before: "8", quantity_after: "12" });
          await second.query("commit");
          const movements = await assertLedger(observer, productId, 5n, 12n, 2);
          expect(movements.map((row) => row.quantity_delta)).toEqual(["3", "4"]);
        } finally {
          await first.query("rollback").catch(() => undefined);
          await second.query("rollback").catch(() => undefined);
          await cleanupManualFixture(observer, productId);
        }
      });
    });

    it("evaluates Correction races against the authoritative locked balance", async () => {
      const fixture = requireHarness();
      const actor = fixture.actors.admin;
      const cases: Array<{
        expectedDeltas: string[];
        final: bigint;
        firstQuantity: string;
        secondQuantity: string;
        secondType: "add" | "correction" | "remove";
      }> = [
        { expectedDeltas: ["-3", "-4"], final: 3n, firstQuantity: "7", secondQuantity: "3", secondType: "correction" },
        { expectedDeltas: ["-5", "4"], final: 9n, firstQuantity: "5", secondQuantity: "4", secondType: "add" },
        { expectedDeltas: ["-5", "-4"], final: 1n, firstQuantity: "5", secondQuantity: "4", secondType: "remove" },
      ];

      await fixture.withDatabaseClients(3, async ([first, second, observer]) => {
        if (!first || !second || !observer) throw new Error("Task 148 Correction clients unavailable");
        for (const [index, testCase] of cases.entries()) {
          await observer.query("begin");
          const productId = await createProduct(observer, actor.profileId, "10");
          await observer.query("commit");
          const applicationName = `task148-correction-${index}-${randomUUID()}`;
          try {
            await first.query("begin");
            await actAs(first, actor);
            expect(await manualAdjust(first, productId, "correction", testCase.firstQuantity, "Task 148 Correction winner"))
              .toMatchObject({ quantity_before: "10", quantity_after: testCase.firstQuantity });
            await second.query("begin");
            await second.query("select pg_catalog.set_config('application_name', $1::text, true)", [applicationName]);
            await actAs(second, actor);
            const waiting = manualAdjust(second, productId, testCase.secondType, testCase.secondQuantity, "Task 148 serialized follower");
            await waitForLockWait(observer, applicationName);
            await first.query("commit");
            expect((await waiting).quantity_after).toBe(testCase.final.toString());
            await second.query("commit");
            const movements = await assertLedger(observer, productId, 10n, testCase.final, 2);
            expect(movements.map((row) => row.quantity_delta)).toEqual(testCase.expectedDeltas);
          } finally {
            await first.query("rollback").catch(() => undefined);
            await second.query("rollback").catch(() => undefined);
            await cleanupManualFixture(observer, productId);
          }
        }
      });
    });

    it("serializes manual Remove, Add, and Correction behind generic Finish stock locks", async () => {
      const fixture = requireHarness();
      const actor = fixture.actors.admin;
      await fixture.withDatabaseClients(3, async ([finisher, adjuster, observer]) => {
        if (!finisher || !adjuster || !observer) throw new Error("Task 148 generic Finish clients unavailable");
        await observer.query("begin");
        const state = await createPreflightFixture(observer, actor.profileId, {
          itemQuantity: "4",
          physicalQuantity: "10",
          requiredQuantity: "4",
        });
        await observer.query("commit");
        const fixtureState: GenericFixture = {
          productId: state.productId,
          projectId: state.projectId!,
          updatedAt: state.updatedAt,
          workOrderId: state.workOrderId,
        };
        const reference = await uploadPdf(state.workOrderId);
        const cases = [
          { after: "3", quantity: "7", type: "remove" as const },
          { after: "13", quantity: "3", type: "add" as const },
          { after: "2", quantity: "2", type: "correction" as const },
        ];
        try {
          for (const [index, testCase] of cases.entries()) {
            const applicationName = `task148-generic-${index}-${randomUUID()}`;
            await finisher.query("begin");
            await actAs(finisher, actor);
            await finishGeneric(finisher, fixtureState, reference);
            await adjuster.query("begin");
            await adjuster.query("select pg_catalog.set_config('application_name', $1::text, true)", [applicationName]);
            await actAs(adjuster, actor);
            const waiting = manualAdjust(adjuster, state.productId, testCase.type, testCase.quantity, `Task 148 ${testCase.type} vs Finish`);
            await waitForLockWait(observer, applicationName);
            await finisher.query("rollback");
            expect(await waiting).toMatchObject({ quantity_before: "10", quantity_after: testCase.after });
            await adjuster.query("rollback");
          }
          expect((await observer.query(
            `select
               (select quantity::text from public.inventory_balances where product_id = $1::uuid) as quantity,
               (select status from public.work_orders where id = $2::uuid) as status,
               (select pg_catalog.count(*)::text from public.inventory_movements where product_id = $1::uuid) as movements,
               (select pg_catalog.count(*)::text from public.work_order_pdfs where work_order_id = $2::uuid) as pdfs`,
            [state.productId, state.workOrderId],
          )).rows).toEqual([{ movements: "0", pdfs: "0", quantity: "10", status: "draft" }]);
        } finally {
          await finisher.query("rollback").catch(() => undefined);
          await adjuster.query("rollback").catch(() => undefined);
          await cleanupGenericFixture(observer, fixtureState);
        }
      });
    });

    it("aggregates same-Product BOM and supplemental quantities into one atomic PCB input movement", async () => {
      const fixture = requireHarness();
      const actor = fixture.actors.admin;
      await fixture.withDatabaseClients(2, async ([worker, observer]) => {
        if (!worker || !observer) throw new Error("Task 148 PCB aggregate clients unavailable");
        await observer.query("begin");
        const state = await createPcbFixture(observer, actor.profileId, {
          frozenQuantity: "5",
          inputStock: "6",
          supplementalQuantity: "2",
        });
        await observer.query("commit");
        const reference = await uploadPdf(state.workOrderId);
        try {
          await worker.query("begin");
          await actAs(worker, actor);
          await expect(finishPcb(worker, state, reference, "1"))
            .rejects.toMatchObject({ code: "IVB02" });
          await worker.query("rollback");
          expect((await observer.query(
            `select
               (select quantity::text from public.inventory_balances where product_id = $1::uuid) as input_quantity,
               (select pg_catalog.count(*)::text from public.inventory_movements where product_id in ($1::uuid, $2::uuid)) as movements,
               (select pg_catalog.count(*)::text from public.pcb_production_runs where work_order_id = $3::uuid) as runs`,
            [state.inputProductId, state.outputProductId, state.workOrderId],
          )).rows).toEqual([{ input_quantity: "6", movements: "0", runs: "0" }]);

          await observer.query(
            "update public.inventory_balances set quantity = 7 where product_id = $1::uuid",
            [state.inputProductId],
          );
          await worker.query("begin");
          await actAs(worker, actor);
          await finishPcb(worker, state, reference, "1");
          expect((await worker.query<MovementRow>(
            `select id, movement_type, quantity_delta::text, quantity_before::text,
                    quantity_after::text, source_type, source_id
             from public.inventory_movements
             where product_id = $1::uuid`,
            [state.inputProductId],
          )).rows).toEqual([expect.objectContaining({
            movement_type: "pcb_production_input",
            quantity_before: "7",
            quantity_delta: "-7",
            quantity_after: "0",
            source_type: "pcb_production_input",
          })]);
          expect((await worker.query(
            `select
               (select quantity::text from public.inventory_balances where product_id = $1::uuid) as input_quantity,
               (select quantity::text from public.inventory_balances where product_id = $2::uuid) as output_quantity,
               (select pg_catalog.count(*)::text from public.pcb_production_runs where work_order_id = $3::uuid) as runs,
               (select pg_catalog.count(*)::text from public.work_order_pdfs where work_order_id = $3::uuid) as pdfs`,
            [state.inputProductId, state.outputProductId, state.workOrderId],
          )).rows).toEqual([{ input_quantity: "0", output_quantity: "1", pdfs: "1", runs: "1" }]);
          await worker.query("rollback");
        } finally {
          await worker.query("rollback").catch(() => undefined);
          await cleanupPcbFixtures(observer, [state]);
        }
      });
    });

    it("serializes competing and duplicate PCB Finish calls without partial production", async () => {
      const fixture = requireHarness();
      const actor = fixture.actors.admin;
      await fixture.withDatabaseClients(3, async ([first, second, observer]) => {
        if (!first || !second || !observer) throw new Error("Task 148 PCB Finish clients unavailable");
        await observer.query("begin");
        const sharedInput = await createProduct(observer, actor.profileId, "10");
        const firstState = await createPcbFixture(observer, actor.profileId, {
          frozenQuantity: "7",
          inputProductId: sharedInput,
        });
        const secondState = await createPcbFixture(observer, actor.profileId, {
          frozenQuantity: "7",
          inputProductId: sharedInput,
        });
        await observer.query("commit");
        const firstReference = await uploadPdf(firstState.workOrderId);
        const secondReference = await uploadPdf(secondState.workOrderId);
        try {
          await first.query("begin");
          await actAs(first, actor);
          await finishPcb(first, firstState, firstReference, "1");
          await second.query("begin");
          const competingName = `task148-pcb-competing-${randomUUID()}`;
          await second.query("select pg_catalog.set_config('application_name', $1::text, true)", [competingName]);
          await actAs(second, actor);
          const competing = finishPcb(second, secondState, secondReference, "1");
          await waitForLockWait(observer, competingName);
          await first.query("rollback");
          await expect(competing).resolves.toBeUndefined();
          expect((await second.query(
            `select
               (select pg_catalog.count(*)::text from public.pcb_production_runs where work_order_id = $1::uuid) as runs,
               (select pg_catalog.count(*)::text from public.inventory_movements
                where source_id in (select id from public.pcb_production_runs where work_order_id = $1::uuid)) as movements`,
            [secondState.workOrderId],
          )).rows).toEqual([{ movements: "2", runs: "1" }]);
          await second.query("rollback");

          await first.query("begin");
          await actAs(first, actor);
          await finishPcb(first, firstState, firstReference, "1");
          await second.query("begin");
          const duplicateName = `task148-pcb-duplicate-${randomUUID()}`;
          await second.query("select pg_catalog.set_config('application_name', $1::text, true)", [duplicateName]);
          await actAs(second, actor);
          const duplicate = finishPcb(second, firstState, firstReference, "1");
          await waitForLockWait(observer, duplicateName);
          await first.query("rollback");
          await expect(duplicate).resolves.toBeUndefined();
          await second.query("set role postgres");
          expect((await second.query(
            `select
               (select pg_catalog.count(*)::text from public.pcb_production_runs where work_order_id = $1::uuid) as runs,
               (select pg_catalog.count(*)::text from public.work_order_pdfs where work_order_id = $1::uuid) as pdfs,
               (select pg_catalog.count(*)::text from public.audit_logs
                where action_type in ('work_order.finished', 'pcb_production.completed')
                  and (entity_id = $1::uuid or after_data->>'work_order_id' = $1::text)) as audits`,
            [firstState.workOrderId],
          )).rows).toEqual([{ audits: "2", pdfs: "1", runs: "1" }]);
          await second.query("rollback");

          expect((await observer.query(
            `select
               (select quantity::text from public.inventory_balances where product_id = $1::uuid) as quantity,
               (select pg_catalog.count(*)::text from public.inventory_movements where product_id = $1::uuid) as movements,
               (select pg_catalog.count(*)::text from public.pcb_production_runs
                where work_order_id in ($2::uuid, $3::uuid)) as runs`,
            [sharedInput, firstState.workOrderId, secondState.workOrderId],
          )).rows).toEqual([{ movements: "0", quantity: "10", runs: "0" }]);
        } finally {
          await first.query("rollback").catch(() => undefined);
          await second.query("rollback").catch(() => undefined);
          await cleanupPcbFixtures(observer, [firstState, secondState]);
        }
      });
    });

    it("serializes PCB input consumption and output posting with manual adjustments", async () => {
      const fixture = requireHarness();
      const actor = fixture.actors.admin;
      await fixture.withDatabaseClients(3, async ([finisher, adjuster, observer]) => {
        if (!finisher || !adjuster || !observer) throw new Error("Task 148 PCB output clients unavailable");
        await observer.query("begin");
        const state = await createPcbFixture(observer, actor.profileId, {
          frozenQuantity: "2",
          inputStock: "10",
        });
        await observer.query(
          "update public.inventory_balances set quantity = 10 where product_id = $1::uuid",
          [state.outputProductId],
        );
        await observer.query("commit");
        const reference = await uploadPdf(state.workOrderId);
        try {
          const cases = [
            { after: "13", quantity: "3", type: "add" as const },
            { after: "3", quantity: "7", type: "remove" as const },
            { after: "2", quantity: "2", type: "correction" as const },
          ];
          for (const [targetName, productId] of [
            ["input", state.inputProductId],
            ["output", state.outputProductId],
          ] as const) {
            for (const [index, testCase] of cases.entries()) {
              const applicationName = `task148-${targetName}-${index}-${randomUUID()}`;
              await finisher.query("begin");
              await actAs(finisher, actor);
              await finishPcb(finisher, state, reference, "1");
              await adjuster.query("begin");
              await adjuster.query("select pg_catalog.set_config('application_name', $1::text, true)", [applicationName]);
              await actAs(adjuster, actor);
              const waiting = manualAdjust(
                adjuster,
                productId,
                testCase.type,
                testCase.quantity,
                `Task 148 ${targetName} race`,
              );
              await waitForLockWait(observer, applicationName);
              await finisher.query("rollback");
              expect(await waiting).toMatchObject({
                quantity_before: "10",
                quantity_after: testCase.after,
              });
              await adjuster.query("rollback");
            }
          }
          expect((await observer.query(
            `select quantity::text as quantity from public.inventory_balances
             where product_id = $1::uuid`,
            [state.outputProductId],
          )).rows).toEqual([{ quantity: "10" }]);
        } finally {
          await finisher.query("rollback").catch(() => undefined);
          await adjuster.query("rollback").catch(() => undefined);
          await cleanupPcbFixtures(observer, [state]);
        }
      });
    });

    it("serializes generic Finish and PCB Finish through one shared physical balance", async () => {
      const fixture = requireHarness();
      const actor = fixture.actors.admin;
      await fixture.withDatabaseClients(3, async ([genericFinisher, pcbFinisher, observer]) => {
        if (!genericFinisher || !pcbFinisher || !observer) {
          throw new Error("Task 148 mixed Finish clients unavailable");
        }
        await observer.query("begin");
        const genericState = await createPreflightFixture(observer, actor.profileId, {
          itemQuantity: "7",
          physicalQuantity: "10",
          requiredQuantity: "7",
        });
        const genericFixture: GenericFixture = {
          productId: genericState.productId,
          projectId: genericState.projectId!,
          updatedAt: genericState.updatedAt,
          workOrderId: genericState.workOrderId,
        };
        const pcbState = await createPcbFixture(observer, actor.profileId, {
          frozenQuantity: "7",
          inputProductId: genericState.productId,
        });
        await observer.query("commit");
        const genericReference = await uploadPdf(genericState.workOrderId);
        const pcbReference = await uploadPdf(pcbState.workOrderId);
        const applicationName = `task148-generic-pcb-${randomUUID()}`;
        try {
          await genericFinisher.query("begin");
          await actAs(genericFinisher, actor);
          await finishGeneric(genericFinisher, genericFixture, genericReference);

          await pcbFinisher.query("begin");
          await pcbFinisher.query(
            "select pg_catalog.set_config('application_name', $1::text, true)",
            [applicationName],
          );
          await actAs(pcbFinisher, actor);
          const waitingPcb = finishPcb(pcbFinisher, pcbState, pcbReference, "1");
          await waitForLockWait(observer, applicationName);
          await genericFinisher.query("rollback");
          await expect(waitingPcb).resolves.toBeUndefined();
          expect((await pcbFinisher.query<MovementRow>(
            `select id, movement_type, quantity_delta::text, quantity_before::text,
                    quantity_after::text, source_type, source_id
             from public.inventory_movements
             where product_id = $1::uuid and source_type = 'pcb_production_input'`,
            [genericState.productId],
          )).rows).toEqual([expect.objectContaining({
            quantity_before: "10",
            quantity_delta: "-7",
            quantity_after: "3",
          })]);
          await pcbFinisher.query("rollback");
          expect((await observer.query(
            `select
               (select quantity::text from public.inventory_balances where product_id = $1::uuid) as quantity,
               (select status from public.work_orders where id = $2::uuid) as generic_status,
               (select status from public.work_orders where id = $3::uuid) as pcb_status,
               (select pg_catalog.count(*)::text from public.inventory_movements where product_id = $1::uuid) as movements`,
            [genericState.productId, genericState.workOrderId, pcbState.workOrderId],
          )).rows).toEqual([{
            generic_status: "draft",
            movements: "0",
            pcb_status: "draft",
            quantity: "10",
          }]);
        } finally {
          await genericFinisher.query("rollback").catch(() => undefined);
          await pcbFinisher.query("rollback").catch(() => undefined);
          await cleanupPcbFixtures(observer, [pcbState], genericState.productId);
          await cleanupGenericFixture(observer, genericFixture);
        }
      });
    });

    it("locks overlapping multi-Product Finish inputs in UUID order without deadlock", async () => {
      const fixture = requireHarness();
      const actor = fixture.actors.admin;
      await fixture.withDatabaseClients(3, async ([first, second, observer]) => {
        if (!first || !second || !observer) throw new Error("Task 148 multi-Product clients unavailable");
        await observer.query("begin");
        const firstState = await createPreflightFixture(observer, actor.profileId, {
          itemQuantity: "3",
          physicalQuantity: "20",
          requiredQuantity: "3",
        });
        const secondProductId = await createProduct(observer, actor.profileId, "20");
        await observer.query(
          `insert into public.work_order_items (
             work_order_id, product_id, quantity, added_by_user_id
           ) values ($1::uuid, $2::uuid, 4, $3::uuid)`,
          [firstState.workOrderId, secondProductId, actor.profileId],
        );
        const secondProjectId = randomUUID();
        const secondWorkOrderId = randomUUID();
        const secondUpdatedAt = "2026-10-06 12:34:56.123456+00";
        await observer.query(
          `insert into public.projects (
             id, name, customer_name, start_date, delivery_date,
             created_by_user_id, updated_by_user_id
           ) values (
             $1::uuid, $2::text, 'Task 148 Customer', '2026-10-06', '2026-11-06',
             $3::uuid, $3::uuid
           )`,
          [secondProjectId, `Task 148 Project ${secondProjectId}`, actor.profileId],
        );
        await observer.query(
          `insert into public.work_orders (
             id, work_order_number, project_id, customer_name_snapshot,
             description, created_at, created_by_user_id, updated_at, updated_by_user_id
           ) values (
             $1::uuid, $2::text, $3::uuid, 'Task 148 Customer',
             'Reverse insertion order', $4::timestamptz, $5::uuid, $4::timestamptz, $5::uuid
           )`,
          [secondWorkOrderId, await nextWorkOrderNumber(observer), secondProjectId, secondUpdatedAt, actor.profileId],
        );
        await observer.query(
          `insert into public.work_order_items (
             work_order_id, product_id, quantity, added_by_user_id
           ) values
             ($1::uuid, $2::uuid, 4, $4::uuid),
             ($1::uuid, $3::uuid, 3, $4::uuid)`,
          [secondWorkOrderId, secondProductId, firstState.productId, actor.profileId],
        );
        await observer.query("commit");
        const applicationName = `task148-multiproduct-${randomUUID()}`;
        try {
          await first.query("begin");
          await actAs(first, actor);
          expect((await first.query(
            `select product_id from public.preflight_finish_work_order($1::uuid, $2::timestamptz)`,
            [firstState.workOrderId, firstState.updatedAt],
          )).rows).toHaveLength(2);

          await second.query("begin");
          await second.query(
            "select pg_catalog.set_config('application_name', $1::text, true)",
            [applicationName],
          );
          await actAs(second, actor);
          const waiting = second.query(
            `select product_id from public.preflight_finish_work_order($1::uuid, $2::timestamptz)`,
            [secondWorkOrderId, secondUpdatedAt],
          );
          await waitForLockWait(observer, applicationName);
          await first.query("rollback");
          await expect(waiting).resolves.toMatchObject({ rows: expect.arrayContaining([
            { product_id: firstState.productId },
            { product_id: secondProductId },
          ]) });
          await second.query("rollback");
        } finally {
          await first.query("rollback").catch(() => undefined);
          await second.query("rollback").catch(() => undefined);
          await observer.query("begin");
          await observer.query("delete from public.work_order_items where work_order_id in ($1::uuid, $2::uuid)", [firstState.workOrderId, secondWorkOrderId]);
          await observer.query("delete from public.work_orders where id in ($1::uuid, $2::uuid)", [firstState.workOrderId, secondWorkOrderId]);
          await observer.query(
            `delete from public.project_product_components where project_product_id in (
               select id from public.project_products where project_id in ($1::uuid, $2::uuid)
             )`,
            [firstState.projectId, secondProjectId],
          );
          await observer.query("delete from public.project_products where project_id in ($1::uuid, $2::uuid)", [firstState.projectId, secondProjectId]);
          await observer.query("delete from public.inventory_balances where product_id in ($1::uuid, $2::uuid)", [firstState.productId, secondProductId]);
          await observer.query("delete from public.products where id in ($1::uuid, $2::uuid)", [firstState.productId, secondProductId]);
          await observer.query("delete from public.projects where id in ($1::uuid, $2::uuid)", [firstState.projectId, secondProjectId]);
          await observer.query("commit");
        }
      });
    });
  });
}
