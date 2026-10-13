import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { expect, it } from "vitest";

import { createTestSerialNumber } from "./helpers/serial";
import {
  createSupplierSourceFixture,
  getWorkOrderAllocationFingerprint,
} from "./helpers/inventory-provenance";
import type { SecurityFixtureHarness } from "./security-fixtures";

interface ActorRef {
  authUserId: string;
  profileId: string;
}

interface DomainFixture {
  bomVersionId: string;
  cardId: string;
  componentAId: string;
  componentBId: string;
  outputProductId: string;
  projectId: string;
  supplementalId: string;
}

interface WorkOrderResult {
  work_order_id: string;
  work_order_number: string;
}

async function queryAs<Row extends QueryResultRow>(
  database: PoolClient,
  actor: ActorRef | null,
  sql: string,
  parameters: readonly unknown[] = [],
): Promise<Row[]> {
  await database.query("savepoint task151_actor_query");
  try {
    if (actor) {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");
    } else {
      await database.query("set local role anon");
    }
    const result = await database.query<Row>(sql, [...parameters]);
    await database.query("reset role");
    await database.query("release savepoint task151_actor_query");
    return result.rows;
  } catch (error) {
    await database.query("rollback to savepoint task151_actor_query");
    throw error;
  }
}

async function expectRejected(
  database: PoolClient,
  actor: ActorRef | null,
  sql: string,
  parameters: readonly unknown[],
  code: string,
): Promise<void> {
  await expect(queryAs(database, actor, sql, parameters)).rejects.toMatchObject({ code });
}

async function grantPermissions(
  database: PoolClient,
  actor: ActorRef,
  grantedByUserId: string,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  await database.query(
    `insert into public.user_permissions (
       user_id, permission_definition_id, granted_by_user_id
     )
     select $1::uuid, definition.id, $2::uuid
     from public.permission_definitions as definition
     where definition.key = any($3::text[])`,
    [actor.profileId, grantedByUserId, keys],
  );
}

async function createDomainFixture(
  database: PoolClient,
  actorId: string,
): Promise<DomainFixture> {
  const outputProductId = randomUUID();
  const componentAId = randomUUID();
  const componentBId = randomUUID();
  const supplementalId = randomUUID();
  const products = [
    [outputProductId, "Task 151 finished PCB", "pcb_finished_good"],
    [componentAId, "Task 151 Component A", "component"],
    [componentBId, "Task 151 Component B", "component"],
    [supplementalId, "Task 151 Supplemental C", "component"],
  ] as const;
  for (const [productId, name, kind] of products) {
    await database.query(
      `insert into public.products (
         id, serial_number, name, category, product_kind,
         created_by_user_id, updated_by_user_id
       ) values ($1::uuid, $2::text, $3::text, 'Task 151', $4::text,
                 $5::uuid, $5::uuid)`,
      [productId, createTestSerialNumber(), `${name} ${productId}`, kind, actorId],
    );
  }

  const cardId = randomUUID();
  await database.query(
    `insert into public.pcb_cards (
       id, name, output_product_id, created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::text, $3::uuid, $4::uuid, $4::uuid)`,
    [cardId, `Task 151 PCB ${cardId}`, outputProductId, actorId],
  );
  const version = await database.query<{ id: string }>(
    `insert into public.pcb_bom_versions (
       pcb_card_id, version_number, created_by_user_id
     ) values ($1::uuid, 1, $2::uuid) returning id`,
    [cardId, actorId],
  );
  const bomVersionId = version.rows[0]?.id;
  if (!bomVersionId) throw new Error("Task 151 BOM fixture returned no version ID");
  await database.query(
    `insert into public.pcb_bom_items (
       bom_version_id, component_product_id, quantity_per_card
     ) values
       ($1::uuid, $2::uuid, 2),
       ($1::uuid, $3::uuid, 3)`,
    [bomVersionId, componentAId, componentBId],
  );

  const projectId = randomUUID();
  await database.query(
    `insert into public.projects (
       id, name, customer_name, status, start_date, delivery_date,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, 'Task 151 Customer', 'planned',
       '2026-10-06'::date, '2026-12-06'::date, $3::uuid, $3::uuid
     )`,
    [projectId, `Task 151 Project ${projectId}`, actorId],
  );

  return {
    bomVersionId,
    cardId,
    componentAId,
    componentBId,
    outputProductId,
    projectId,
    supplementalId,
  };
}

async function manualAdjustment(
  database: PoolClient,
  admin: ActorRef,
  productId: string,
  type: "add" | "remove",
  quantity: string,
  reason: string,
) {
  const source = type === "add"
    ? await createSupplierSourceFixture(database, admin, productId, {
      catalogNumber: `TASK151-${productId}-${randomUUID()}`,
    })
    : null;
  const rows = await queryAs<{
    movement_id: string;
    quantity_after: string;
    quantity_before: string;
  }>(
    database,
    admin,
    `select * from public.manual_adjust_inventory(
       $1::uuid, $2::text, $3::bigint, $4::text, $5::uuid
     )`,
    [productId, type, quantity, reason, source?.productSupplierId ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error("Task 151 manual adjustment returned no row");
  return row;
}

async function createProductionWorkOrder(
  database: PoolClient,
  producer: ActorRef,
  cardId: string,
  plannedQuantity: string,
  projectId: string | null,
  requestId: string,
): Promise<WorkOrderResult> {
  const rows = await queryAs<WorkOrderResult>(
    database,
    producer,
    `select * from public.create_pcb_production_work_order(
       $1::uuid, $2::text, $3::uuid, $4::uuid
     )`,
    [cardId, plannedQuantity, projectId, requestId],
  );
  const row = rows[0];
  if (!row) throw new Error("Task 151 Work Order creation returned no row");
  return row;
}

async function workOrderTimestamp(database: PoolClient, workOrderId: string) {
  const result = await database.query<{ updated_at: string }>(
    `select updated_at::text as updated_at
     from public.work_orders where id = $1::uuid`,
    [workOrderId],
  );
  const timestamp = result.rows[0]?.updated_at;
  if (!timestamp) throw new Error("Task 151 Work Order timestamp is unavailable");
  return timestamp;
}

async function addPdfCandidate(database: PoolClient, workOrderId: string) {
  const reference = `final/${workOrderId}/${randomUUID()}.pdf`;
  await database.query(
    `insert into storage.objects (bucket_id, name, metadata)
     values ('work-order-pdfs', $1::text,
       pg_catalog.jsonb_build_object('mimetype', 'application/pdf'))`,
    [reference],
  );
  return reference;
}

export function registerInventoryPcbProjectE2eTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  it("validates Project-linked and General Stock PCB production through immutable Work Orders", async () => {
    const fixture = requireHarness();
    const admin = fixture.actors.admin;
    const producer = await fixture.createTemporaryProfile(
      "task-151-producer",
      undefined,
      admin.profileId,
    );
    const editor = await fixture.createTemporaryProfile(
      "task-151-editor",
      undefined,
      admin.profileId,
    );
    const finisher = await fixture.createTemporaryProfile(
      "task-151-finisher",
      undefined,
      admin.profileId,
    );

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await grantPermissions(database, producer, admin.profileId, ["pcb.produce"]);
      await grantPermissions(database, editor, admin.profileId, ["work_orders.edit_draft"]);
      await grantPermissions(database, finisher, admin.profileId, ["work_orders.finish"]);

      const domain = await createDomainFixture(database, admin.profileId);
      expect((await database.query<{ count: number }>(
        `select count(*)::integer as count from public.project_products
         where project_id = $1::uuid`,
        [domain.projectId],
      )).rows).toEqual([{ count: 0 }]);
      const afterBomMovementCount = await database.query<{ count: number }>(
        `select count(*)::integer as count from public.inventory_movements
         where product_id = any($1::uuid[])`,
        [[domain.outputProductId, domain.componentAId, domain.componentBId, domain.supplementalId]],
      );
      expect(afterBomMovementCount.rows).toEqual([{ count: 0 }]);
      expect((await database.query<{
        component_product_id: string;
        quantity_per_card: string;
      }>(
        `select component_product_id, quantity_per_card
         from public.pcb_bom_items where bom_version_id = $1::uuid
         order by component_product_id`,
        [domain.bomVersionId],
      )).rows).toEqual(expect.arrayContaining([
        { component_product_id: domain.componentAId, quantity_per_card: "2" },
        { component_product_id: domain.componentBId, quantity_per_card: "3" },
      ]));
      expect((await database.query<{
        output_product_id: string;
        product_kind: string;
      }>(
        `select card.output_product_id, product.product_kind
         from public.pcb_cards as card
         join public.products as product on product.id = card.output_product_id
         where card.id = $1::uuid`,
        [domain.cardId],
      )).rows).toEqual([{
        output_product_id: domain.outputProductId,
        product_kind: "pcb_finished_good",
      }]);
      await database.query("savepoint task151_output_identity");
      await expect(database.query(
        `update public.pcb_cards set output_product_id = $1::uuid
         where id = $2::uuid`,
        [domain.componentAId, domain.cardId],
      )).rejects.toMatchObject({ code: "PCB02" });
      await database.query("rollback to savepoint task151_output_identity");

      const stockA = await manualAdjustment(
        database, admin, domain.componentAId, "add", "100", "Task 151 initial A",
      );
      const stockB = await manualAdjustment(
        database, admin, domain.componentBId, "add", "100", "Task 151 initial B",
      );
      const stockC = await manualAdjustment(
        database, admin, domain.supplementalId, "add", "50", "Task 151 initial C",
      );
      expect([stockA, stockB, stockC]).toEqual([
        expect.objectContaining({ quantity_before: "0", quantity_after: "100" }),
        expect.objectContaining({ quantity_before: "0", quantity_after: "100" }),
        expect.objectContaining({ quantity_before: "0", quantity_after: "50" }),
      ]);
      const initialStockMovements = await database.query<{
        actor_user_id: string;
        movement_type: string;
        product_id: string;
        quantity_delta: string;
      }>(
        `select product_id, movement_type, quantity_delta, actor_user_id
         from public.inventory_movements
         where id = any($1::uuid[]) order by product_id`,
        [[stockA.movement_id, stockB.movement_id, stockC.movement_id]],
      );
      expect(initialStockMovements.rows).toHaveLength(3);
      expect(initialStockMovements.rows.every((row) =>
        row.actor_user_id === admin.profileId && row.movement_type === "manual_add"
      )).toBe(true);

      await expectRejected(
        database,
        producer,
        "update public.inventory_balances set quantity = 999 where product_id = $1::uuid",
        [domain.componentAId],
        "42501",
      );
      await expectRejected(
        database,
        fixture.actors.unpermitted,
        `select * from public.create_pcb_production_work_order(
           $1::uuid, '10', $2::uuid, $3::uuid
         )`,
        [domain.cardId, domain.projectId, randomUUID()],
        "42501",
      );

      const businessYear = Number((await database.query<{ year: string }>(
        `select pg_catalog.date_part(
           'year', pg_catalog.timezone('Europe/Sarajevo', pg_catalog.clock_timestamp())
         )::text as year`,
      )).rows[0]?.year);
      const counterBefore = Number((await database.query<{ value: string }>(
        `select coalesce((
           select counter.last_value from public.work_order_number_counters as counter
           where counter.business_year = $1::integer
         ), 0)::text as value`,
        [businessYear],
      )).rows[0]?.value);
      const creationRequestId = randomUUID();
      const primary = await createProductionWorkOrder(
        database,
        producer,
        domain.cardId,
        "00010",
        domain.projectId,
        creationRequestId,
      );
      expect(primary.work_order_number).toMatch(/^RN-\d{4}-\d{4}$/);
      const counterAfterCreation = Number((await database.query<{ value: string }>(
        `select last_value::text as value from public.work_order_number_counters
         where business_year = $1::integer`,
        [businessYear],
      )).rows[0]?.value);
      expect(counterAfterCreation).toBe(counterBefore + 1);

      const creationBalances = await database.query<{ product_id: string; quantity: string }>(
        `select product_id, quantity from public.inventory_balances
         where product_id = any($1::uuid[]) order by product_id`,
        [[domain.outputProductId, domain.componentAId, domain.componentBId, domain.supplementalId]],
      );
      const creationMovementCount = await database.query<{ count: number }>(
        `select count(*)::integer as count from public.inventory_movements
         where product_id = any($1::uuid[])`,
        [[domain.outputProductId, domain.componentAId, domain.componentBId, domain.supplementalId]],
      );
      expect(new Map(creationBalances.rows.map((row) => [row.product_id, row.quantity])))
        .toEqual(new Map([
          [domain.outputProductId, "0"],
          [domain.componentAId, "100"],
          [domain.componentBId, "100"],
          [domain.supplementalId, "50"],
        ]));
      expect(creationMovementCount.rows).toEqual([{ count: 3 }]);
      expect((await database.query(
        "select id from public.pcb_production_runs where work_order_id = $1::uuid",
        [primary.work_order_id],
      )).rowCount).toBe(0);

      const frozenContext = await database.query<{
        bom_version_id: string;
        pcb_card_id: string;
        planned_quantity: string;
      }>(
        `select pcb_card_id, bom_version_id, planned_quantity
         from public.pcb_production_work_orders where work_order_id = $1::uuid`,
        [primary.work_order_id],
      );
      expect(frozenContext.rows).toEqual([{
        bom_version_id: domain.bomVersionId,
        pcb_card_id: domain.cardId,
        planned_quantity: "10",
      }]);
      const frozenMaterials = await database.query<{
        product_id: string;
        quantity: string;
        source_type: string;
      }>(
        `select product_id, quantity, source_type from public.work_order_items
         where work_order_id = $1::uuid order by product_id, source_type`,
        [primary.work_order_id],
      );
      expect(frozenMaterials.rows).toEqual(expect.arrayContaining([
        { product_id: domain.componentAId, quantity: "20", source_type: "pcb_bom" },
        { product_id: domain.componentBId, quantity: "30", source_type: "pcb_bom" },
      ]));
      expect((await database.query<{ action_type: string }>(
        `select action_type from public.audit_logs where entity_id = $1::uuid
         order by action_type`,
        [primary.work_order_id],
      )).rows).toEqual([
        { action_type: "pcb_production.work_order_created" },
        { action_type: "work_order.created" },
      ]);

      const replay = await createProductionWorkOrder(
        database,
        producer,
        domain.cardId,
        "10",
        domain.projectId,
        creationRequestId,
      );
      expect(replay).toEqual(primary);
      expect((await database.query<{ value: string }>(
        `select last_value::text as value from public.work_order_number_counters
         where business_year = $1::integer`,
        [businessYear],
      )).rows).toEqual([{ value: String(counterAfterCreation) }]);
      expect((await database.query<{ count: number }>(
        `select count(*)::integer as count from public.work_orders
         where id = $1::uuid`,
        [primary.work_order_id],
      )).rows).toEqual([{ count: 1 }]);
      expect((await database.query<{ count: number }>(
        `select count(*)::integer as count from public.work_order_items
         where work_order_id = $1::uuid`,
        [primary.work_order_id],
      )).rows).toEqual([{ count: 2 }]);

      await expectRejected(
        database,
        producer,
        "select * from public.get_pcb_production_work_order_context($1::uuid)",
        [primary.work_order_id],
        "42501",
      );
      await expectRejected(
        database,
        producer,
        `select * from public.save_pcb_production_supplemental_materials(
           $1::uuid, $2::jsonb, $3::timestamptz
         )`,
        [
          primary.work_order_id,
          JSON.stringify([{ product_id: domain.supplementalId, quantity: "5" }]),
          await workOrderTimestamp(database, primary.work_order_id),
        ],
        "42501",
      );
      await expectRejected(
        database,
        producer,
        `select * from public.finish_work_order(
           $1::uuid, $2::timestamptz, $3::text, null, $4::text, '8'
         )`,
        [
          primary.work_order_id,
          await workOrderTimestamp(database, primary.work_order_id),
          `final/${primary.work_order_id}/${randomUUID()}.pdf`,
          "0".repeat(32),
        ],
        "42501",
      );

      const originalTimestamp = await workOrderTimestamp(database, primary.work_order_id);
      let saved = await queryAs<{ updated_at: string }>(
        database,
        editor,
        `select updated_at::text as updated_at
         from public.save_pcb_production_supplemental_materials(
           $1::uuid, $2::jsonb, $3::timestamptz
         )`,
        [
          primary.work_order_id,
          JSON.stringify([
            { product_id: domain.componentAId, quantity: "2" },
            { product_id: domain.supplementalId, quantity: "5" },
          ]),
          originalTimestamp,
        ],
      );
      const firstSavedTimestamp = saved[0]?.updated_at;
      if (!firstSavedTimestamp) throw new Error("Task 151 supplemental save returned no timestamp");
      saved = await queryAs<{ updated_at: string }>(
        database,
        editor,
        `select updated_at::text as updated_at
         from public.save_pcb_production_supplemental_materials(
           $1::uuid, $2::jsonb, $3::timestamptz
         )`,
        [
          primary.work_order_id,
          JSON.stringify([
            { product_id: domain.componentAId, quantity: "2" },
            { product_id: domain.supplementalId, quantity: "6" },
          ]),
          firstSavedTimestamp,
        ],
      );
      saved = await queryAs<{ updated_at: string }>(
        database,
        editor,
        `select updated_at::text as updated_at
         from public.save_pcb_production_supplemental_materials(
           $1::uuid, $2::jsonb, $3::timestamptz
         )`,
        [
          primary.work_order_id,
          JSON.stringify([{ product_id: domain.componentAId, quantity: "2" }]),
          saved[0]?.updated_at,
        ],
      );
      saved = await queryAs<{ updated_at: string }>(
        database,
        editor,
        `select updated_at::text as updated_at
         from public.save_pcb_production_supplemental_materials(
           $1::uuid, $2::jsonb, $3::timestamptz
         )`,
        [
          primary.work_order_id,
          JSON.stringify([
            { product_id: domain.componentAId, quantity: "2" },
            { product_id: domain.supplementalId, quantity: "5" },
          ]),
          saved[0]?.updated_at,
        ],
      );
      const finalDraftTimestamp = saved[0]?.updated_at;
      if (!finalDraftTimestamp) throw new Error("Task 151 final Draft timestamp is unavailable");
      const allDraftMaterials = await database.query<{
        product_id: string;
        quantity: string;
        source_type: string;
      }>(
        `select product_id, quantity, source_type from public.work_order_items
         where work_order_id = $1::uuid order by product_id, source_type`,
        [primary.work_order_id],
      );
      expect(allDraftMaterials.rows).toEqual(expect.arrayContaining([
        { product_id: domain.componentAId, quantity: "20", source_type: "pcb_bom" },
        { product_id: domain.componentAId, quantity: "2", source_type: "manual" },
        { product_id: domain.componentBId, quantity: "30", source_type: "pcb_bom" },
        { product_id: domain.supplementalId, quantity: "5", source_type: "manual" },
      ]));
      expect((await database.query<{ count: number }>(
        `select count(*)::integer as count from public.project_products
         where project_id = $1::uuid`,
        [domain.projectId],
      )).rows).toEqual([{ count: 0 }]);
      expect((await database.query<{ count: number }>(
        `select count(*)::integer as count from public.inventory_movements
         where product_id = any($1::uuid[])`,
        [[domain.outputProductId, domain.componentAId, domain.componentBId, domain.supplementalId]],
      )).rows).toEqual(creationMovementCount.rows);

      await database.query("savepoint task151_frozen_item_update");
      await expect(database.query(
        `update public.work_order_items set quantity = quantity + 1
         where work_order_id = $1::uuid and source_type = 'pcb_bom'`,
        [primary.work_order_id],
      )).rejects.toMatchObject({ code: "PCB12" });
      await database.query("rollback to savepoint task151_frozen_item_update");
      await database.query("savepoint task151_frozen_origin_forgery");
      await expect(database.query(
        `insert into public.work_order_items (
           work_order_id, product_id, quantity, source_type, added_by_user_id
         ) values ($1::uuid, $2::uuid, 1, 'pcb_bom', $3::uuid)`,
        [primary.work_order_id, domain.supplementalId, admin.profileId],
      )).rejects.toMatchObject({ code: "PCB12" });
      await database.query("rollback to savepoint task151_frozen_origin_forgery");
      await expectRejected(
        database,
        producer,
        "select * from public.produce_pcb($1::uuid, '1', null)",
        [domain.cardId],
        "42501",
      );
      await expectRejected(
        database,
        producer,
        `insert into public.pcb_production_runs (
           pcb_card_id, bom_version_id, quantity_produced, status,
           produced_by_user_id, completed_at
         ) values ($1::uuid, $2::uuid, 1, 'completed', $3::uuid, pg_catalog.now())`,
        [domain.cardId, domain.bomVersionId, producer.profileId],
        "42501",
      );

      await expectRejected(
        database,
        finisher,
        `select * from public.preflight_finish_pcb_production_work_order(
           $1::uuid, $2::timestamptz, '8'
         )`,
        [primary.work_order_id, originalTimestamp],
        "WOR05",
      );
      await manualAdjustment(
        database, admin, domain.componentBId, "remove", "71", "Task 151 insufficiency",
      );
      const insufficient = await queryAs<{
        available_quantity: string;
        inventory_sufficient: boolean;
        missing_quantity: string;
        product_id: string;
        required_quantity: string;
      }>(
        database,
        finisher,
        `select product_id, required_quantity, available_quantity,
                missing_quantity, inventory_sufficient
         from public.preflight_finish_pcb_production_work_order(
           $1::uuid, $2::timestamptz, '8'
         )`,
        [primary.work_order_id, finalDraftTimestamp],
      );
      expect(insufficient.find((row) => row.product_id === domain.componentAId))
        .toMatchObject({
          inventory_sufficient: false,
          missing_quantity: "0",
          required_quantity: "22",
        });
      expect(insufficient.find((row) => row.product_id === domain.componentBId))
        .toMatchObject({
          available_quantity: "29",
          inventory_sufficient: false,
          missing_quantity: "1",
          required_quantity: "30",
        });
      expect(insufficient.find((row) => row.product_id === domain.supplementalId))
        .toMatchObject({
          inventory_sufficient: false,
          missing_quantity: "0",
          required_quantity: "5",
        });
      const failedFinishState = await database.query<{
        audits: number;
        movements: number;
        pdfs: number;
        runs: number;
        status: string;
      }>(
        `select
           (select count(*)::integer from public.pcb_production_runs
            where work_order_id = $1::uuid) as runs,
           (select count(*)::integer from public.inventory_movements
            where source_id in (select id from public.pcb_production_runs
              where work_order_id = $1::uuid)) as movements,
           (select count(*)::integer from public.work_order_pdfs
            where work_order_id = $1::uuid) as pdfs,
           (select count(*)::integer from public.audit_logs
            where action_type in ('work_order.finished', 'pcb_production.completed')
              and (entity_id = $1::uuid or after_data->>'work_order_id' = $1::text)) as audits,
           (select status from public.work_orders where id = $1::uuid) as status`,
        [primary.work_order_id],
      );
      await expectRejected(
        database,
        finisher,
        `select * from public.finish_work_order(
           $1::uuid, $2::timestamptz, $3::text, null, $4::text, '8'
         )`,
        [
          primary.work_order_id,
          finalDraftTimestamp,
          `final/${primary.work_order_id}/${randomUUID()}.pdf`,
          "0".repeat(32),
        ],
        "IVB02",
      );
      expect((await database.query(
        `select
           (select count(*)::integer from public.pcb_production_runs
            where work_order_id = $1::uuid) as runs,
           (select count(*)::integer from public.inventory_movements
            where source_id in (select id from public.pcb_production_runs
              where work_order_id = $1::uuid)) as movements,
           (select count(*)::integer from public.work_order_pdfs
            where work_order_id = $1::uuid) as pdfs,
           (select count(*)::integer from public.audit_logs
            where action_type in ('work_order.finished', 'pcb_production.completed')
              and (entity_id = $1::uuid or after_data->>'work_order_id' = $1::text)) as audits,
           (select status from public.work_orders where id = $1::uuid) as status`,
        [primary.work_order_id],
      )).rows).toEqual(failedFinishState.rows);
      await manualAdjustment(
        database, admin, domain.componentBId, "add", "71", "Task 151 restore B",
      );

      const snapshot = await queryAs<{
        catalog_number: string;
        customer_name_snapshot: string | null;
        production_actual_good_quantity: string;
        production_output_product_id: string;
        production_planned_quantity: string;
        product_id: string;
        project_name: string;
        quantity: string;
      }>(
        database,
        finisher,
        `select project_name, customer_name_snapshot, product_id, quantity,
                catalog_number,
                production_planned_quantity, production_actual_good_quantity,
                production_output_product_id
         from public.get_work_order_pdf_snapshot(
           $1::uuid, $2::timestamptz, '8'
         )`,
        [primary.work_order_id, finalDraftTimestamp],
      );
      expect(snapshot).toHaveLength(4);
      const quantitiesByProduct = new Map<string, bigint>();
      for (const row of snapshot) {
        quantitiesByProduct.set(
          row.product_id,
          (quantitiesByProduct.get(row.product_id) ?? 0n) + BigInt(row.quantity),
        );
        expect(row.catalog_number).toMatch(/^TASK151-/);
      }
      expect(new Map([...quantitiesByProduct].map(([productId, quantity]) => [
        productId,
        quantity.toString(),
      ])))
        .toEqual(new Map([
          [domain.componentAId, "22"],
          [domain.componentBId, "30"],
          [domain.supplementalId, "5"],
        ]));
      expect(snapshot.every((row) =>
        row.production_planned_quantity === "10" &&
        row.production_actual_good_quantity === "8" &&
        row.production_output_product_id === domain.outputProductId &&
        row.project_name === `Task 151 Project ${domain.projectId}`
      )).toBe(true);

      const primaryReference = await addPdfCandidate(database, primary.work_order_id);
      const primaryFingerprint = await getWorkOrderAllocationFingerprint(
        database,
        primary.work_order_id,
      );
      const primaryFinish = await queryAs<{
        project_completed: boolean;
        work_order_id: string;
        work_order_pdf_id: string;
      }>(
        database,
        finisher,
        `select * from public.finish_work_order(
           $1::uuid, $2::timestamptz, $3::text, $4::text, $5::text, '8'
         )`,
        [
          primary.work_order_id,
          finalDraftTimestamp,
          primaryReference,
          "a".repeat(64),
          primaryFingerprint,
        ],
      );
      expect(primaryFinish).toEqual([expect.objectContaining({
        project_completed: false,
        work_order_id: primary.work_order_id,
        work_order_pdf_id: expect.any(String),
      })]);
      const primaryRun = await database.query<{
        bom_version_id: string;
        id: string;
        pcb_card_id: string;
        project_id: string;
        quantity_produced: string;
        work_order_id: string;
      }>(
        `select id, work_order_id, pcb_card_id, bom_version_id,
                project_id, quantity_produced
         from public.pcb_production_runs where work_order_id = $1::uuid`,
        [primary.work_order_id],
      );
      const primaryRunRow = primaryRun.rows[0];
      if (!primaryRunRow) throw new Error("Task 151 primary run is unavailable");
      expect(primaryRunRow).toMatchObject({
        bom_version_id: domain.bomVersionId,
        pcb_card_id: domain.cardId,
        project_id: domain.projectId,
        quantity_produced: "8",
        work_order_id: primary.work_order_id,
      });
      const primaryMovements = await database.query<{
        movement_type: string;
        product_id: string;
        project_id: string;
        quantity_after: string;
        quantity_before: string;
        quantity_delta: string;
        source_id: string;
        source_type: string;
      }>(
        `select product_id, movement_type, source_type, source_id, project_id,
                quantity_before, quantity_delta, quantity_after
         from public.inventory_movements where source_id = $1::uuid
         order by product_id`,
        [primaryRunRow.id],
      );
      expect(primaryMovements.rows).toHaveLength(4);
      expect(primaryMovements.rows.map((row) => [row.product_id, row.quantity_delta]))
        .toEqual(expect.arrayContaining([
          [domain.componentAId, "-22"],
          [domain.componentBId, "-30"],
          [domain.supplementalId, "-5"],
          [domain.outputProductId, "8"],
        ]));
      expect(primaryMovements.rows.every((row) =>
        row.source_id === primaryRunRow.id && row.project_id === domain.projectId &&
        BigInt(row.quantity_before) + BigInt(row.quantity_delta) === BigInt(row.quantity_after)
      )).toBe(true);
      expect(primaryMovements.rows.filter((row) =>
        row.product_id === domain.componentAId && row.source_type === "pcb_production_input"
      )).toHaveLength(1);
      expect(primaryMovements.rows.find((row) => row.product_id === domain.outputProductId))
        .toMatchObject({
          movement_type: "pcb_production_output",
          quantity_after: "8",
          quantity_before: "0",
          quantity_delta: "8",
          source_type: "pcb_production_output",
        });
      expect((await database.query<{ product_id: string; quantity: string }>(
        `select product_id, quantity from public.inventory_balances
         where product_id = any($1::uuid[])`,
        [[domain.outputProductId, domain.componentAId, domain.componentBId, domain.supplementalId]],
      )).rows).toEqual(expect.arrayContaining([
        { product_id: domain.componentAId, quantity: "78" },
        { product_id: domain.componentBId, quantity: "70" },
        { product_id: domain.supplementalId, quantity: "45" },
        { product_id: domain.outputProductId, quantity: "8" },
      ]));
      expect((await database.query<{
        content_hash: string;
        document_version: number;
        storage_reference: string;
      }>(
        `select storage_reference, document_version, content_hash
         from public.work_order_pdfs where work_order_id = $1::uuid`,
        [primary.work_order_id],
      )).rows).toEqual([{
        content_hash: "a".repeat(64),
        document_version: 1,
        storage_reference: primaryReference,
      }]);
      expect((await database.query<{ status: string }>(
        "select status from public.projects where id = $1::uuid",
        [domain.projectId],
      )).rows).toEqual([{ status: "planned" }]);
      expect((await database.query<{ count: number }>(
        `select count(*)::integer as count from public.audit_logs
         where entity_id = $1::uuid and action_type = 'project.completed'`,
        [domain.projectId],
      )).rows).toEqual([{ count: 0 }]);
      expect((await database.query<{ status: string }>(
        "select status from public.work_orders where id = $1::uuid",
        [primary.work_order_id],
      )).rows).toEqual([{ status: "finished" }]);
      await database.query("savepoint task151_finished_immutable");
      await expect(database.query(
        "update public.work_orders set description = 'Changed' where id = $1::uuid",
        [primary.work_order_id],
      )).rejects.toMatchObject({ code: "WOR02" });
      await database.query("rollback to savepoint task151_finished_immutable");
      const beforeRepeat = await database.query<{
        movements: number;
        pdfs: number;
        runs: number;
      }>(
        `select
           (select count(*)::integer from public.pcb_production_runs
            where work_order_id = $1::uuid) as runs,
           (select count(*)::integer from public.inventory_movements
            where source_id = $2::uuid) as movements,
           (select count(*)::integer from public.work_order_pdfs
            where work_order_id = $1::uuid) as pdfs`,
        [primary.work_order_id, primaryRunRow.id],
      );
      await expectRejected(
        database,
        finisher,
        `select * from public.finish_work_order(
           $1::uuid, $2::timestamptz, $3::text, null, $4::text, '8'
         )`,
        [primary.work_order_id, finalDraftTimestamp, primaryReference, "0".repeat(32)],
        "WOR02",
      );
      expect((await database.query(
        `select
           (select count(*)::integer from public.pcb_production_runs
            where work_order_id = $1::uuid) as runs,
           (select count(*)::integer from public.inventory_movements
            where source_id = $2::uuid) as movements,
           (select count(*)::integer from public.work_order_pdfs
            where work_order_id = $1::uuid) as pdfs`,
        [primary.work_order_id, primaryRunRow.id],
      )).rows).toEqual(beforeRepeat.rows);

      const legacyRunId = randomUUID();
      await database.query(
        `insert into public.pcb_production_runs (
           id, pcb_card_id, bom_version_id, project_id, quantity_produced,
           status, produced_by_user_id, completed_at, work_order_id
         ) values (
           $1::uuid, $2::uuid, $3::uuid, null, 1, 'completed', $4::uuid,
           '2026-01-01T00:00:00Z'::timestamptz, null
         )`,
        [legacyRunId, domain.cardId, domain.bomVersionId, admin.profileId],
      );

      const generalRequestId = randomUUID();
      const general = await createProductionWorkOrder(
        database,
        producer,
        domain.cardId,
        "3",
        null,
        generalRequestId,
      );
      expect(general.work_order_id).not.toBe(primary.work_order_id);
      expect(general.work_order_number).not.toBe(primary.work_order_number);
      const generalTimestamp = await workOrderTimestamp(database, general.work_order_id);
      const generalSnapshot = await queryAs<{
        customer_name_snapshot: string | null;
        production_actual_good_quantity: string;
        production_planned_quantity: string;
        project_name: string | null;
      }>(
        database,
        finisher,
        `select project_name, customer_name_snapshot,
                production_planned_quantity, production_actual_good_quantity
         from public.get_work_order_pdf_snapshot(
           $1::uuid, $2::timestamptz, '0'
         )`,
        [general.work_order_id, generalTimestamp],
      );
      expect(generalSnapshot).toHaveLength(2);
      expect(generalSnapshot.every((row) =>
        row.project_name === null && row.customer_name_snapshot === null &&
        row.production_planned_quantity === "3" &&
        row.production_actual_good_quantity === "0"
      )).toBe(true);
      const outputBeforeZero = (await database.query<{ quantity: string }>(
        "select quantity from public.inventory_balances where product_id = $1::uuid",
        [domain.outputProductId],
      )).rows[0]?.quantity;
      const generalReference = await addPdfCandidate(database, general.work_order_id);
      const generalFingerprint = await getWorkOrderAllocationFingerprint(
        database,
        general.work_order_id,
      );
      await queryAs(
        database,
        finisher,
        `select * from public.finish_work_order(
           $1::uuid, $2::timestamptz, $3::text, null, $4::text, '0'
         )`,
        [general.work_order_id, generalTimestamp, generalReference, generalFingerprint],
      );
      const generalRun = await database.query<{
        id: string;
        project_id: string | null;
        quantity_produced: string;
        work_order_id: string;
      }>(
        `select id, project_id, quantity_produced, work_order_id
         from public.pcb_production_runs where work_order_id = $1::uuid`,
        [general.work_order_id],
      );
      const generalRunRow = generalRun.rows[0];
      if (!generalRunRow) throw new Error("Task 151 General Stock run is unavailable");
      expect(generalRunRow).toMatchObject({
        project_id: null,
        quantity_produced: "0",
        work_order_id: general.work_order_id,
      });
      const generalMovements = await database.query<{
        product_id: string;
        project_id: string | null;
        quantity_after: string;
        quantity_before: string;
        quantity_delta: string;
        source_type: string;
      }>(
        `select product_id, project_id, quantity_before, quantity_delta,
                quantity_after, source_type
         from public.inventory_movements where source_id = $1::uuid
         order by product_id`,
        [generalRunRow.id],
      );
      expect(generalMovements.rows).toHaveLength(2);
      expect(generalMovements.rows.map((row) => [row.product_id, row.quantity_delta]))
        .toEqual(expect.arrayContaining([
          [domain.componentAId, "-6"],
          [domain.componentBId, "-9"],
        ]));
      expect(generalMovements.rows.every((row) =>
        row.source_type === "pcb_production_input" && row.project_id === null &&
        BigInt(row.quantity_before) + BigInt(row.quantity_delta) === BigInt(row.quantity_after)
      )).toBe(true);
      expect((await database.query<{ quantity: string }>(
        "select quantity from public.inventory_balances where product_id = $1::uuid",
        [domain.outputProductId],
      )).rows).toEqual([{ quantity: outputBeforeZero }]);
      expect((await database.query<{ count: number }>(
        `select count(*)::integer as count from public.inventory_movements
         where source_id = $1::uuid and source_type = 'pcb_production_output'`,
        [generalRunRow.id],
      )).rows).toEqual([{ count: 0 }]);

      const finishedGeneral = await queryAs<{
        customer_name_snapshot: string | null;
        document_version: number;
        pdf_id: string;
        project_id: string | null;
        project_name: string | null;
        work_order_id: string;
      }>(
        database,
        admin,
        "select * from public.get_finished_work_order_detail($1::uuid)",
        [general.work_order_id],
      );
      expect(finishedGeneral).toEqual([expect.objectContaining({
        customer_name_snapshot: null,
        document_version: 1,
        pdf_id: expect.any(String),
        project_id: null,
        project_name: null,
        work_order_id: general.work_order_id,
      })]);
      const finishedMaterials = await queryAs<{ product_id: string; quantity: string }>(
        database,
        admin,
        "select product_id, quantity from public.list_finished_work_order_materials($1::uuid)",
        [general.work_order_id],
      );
      expect(finishedMaterials).toEqual(expect.arrayContaining([
        { product_id: domain.componentAId, quantity: "6" },
        { product_id: domain.componentBId, quantity: "9" },
      ]));
      const finishedMovements = await queryAs<{ quantity_delta: string }>(
        database,
        admin,
        "select quantity_delta from public.list_finished_work_order_movements($1::uuid)",
        [general.work_order_id],
      );
      expect(finishedMovements.map((row) => row.quantity_delta).sort()).toEqual(["-6", "-9"]);

      const history = await queryAs<{
        production_run_id: string;
        project_id: string | null;
        quantity_produced: string;
      }>(
        database,
        admin,
        "select production_run_id, project_id, quantity_produced from public.list_pcb_production_history($1::uuid)",
        [domain.cardId],
      );
      expect(history).toHaveLength(3);
      expect(history.map((row) => row.production_run_id)).toEqual([
        generalRunRow.id,
        primaryRunRow.id,
        legacyRunId,
      ]);
      expect(history.map((row) => row.quantity_produced)).toEqual(["0", "8", "1"]);
      expect((await database.query<{
        id: string;
        work_order_id: string | null;
      }>(
        `select id, work_order_id from public.pcb_production_runs
         where id = any($1::uuid[]) order by id`,
        [[legacyRunId, primaryRunRow.id, generalRunRow.id]],
      )).rows).toEqual(expect.arrayContaining([
        { id: legacyRunId, work_order_id: null },
        { id: primaryRunRow.id, work_order_id: primary.work_order_id },
        { id: generalRunRow.id, work_order_id: general.work_order_id },
      ]));

      const finalBalances = await database.query<{ product_id: string; quantity: string }>(
        `select product_id, quantity from public.inventory_balances
         where product_id = any($1::uuid[])`,
        [[domain.outputProductId, domain.componentAId, domain.componentBId, domain.supplementalId]],
      );
      expect(finalBalances.rows).toEqual(expect.arrayContaining([
        { product_id: domain.componentAId, quantity: "72" },
        { product_id: domain.componentBId, quantity: "61" },
        { product_id: domain.supplementalId, quantity: "45" },
        { product_id: domain.outputProductId, quantity: "8" },
      ]));
      for (const terminal of [
        [domain.componentAId, generalRunRow.id, "72"],
        [domain.componentBId, generalRunRow.id, "61"],
        [domain.supplementalId, primaryRunRow.id, "45"],
        [domain.outputProductId, primaryRunRow.id, "8"],
      ] as const) {
        expect((await database.query<{ quantity_after: string }>(
          `select quantity_after from public.inventory_movements
           where product_id = $1::uuid and source_id = $2::uuid`,
          [terminal[0], terminal[1]],
        )).rows).toEqual([{ quantity_after: terminal[2] }]);
      }

      const expectedAudits = await database.query<{
        action_type: string;
        actor_user_id: string;
        entity_id: string;
        id: string;
      }>(
        `select id, action_type, actor_user_id, entity_id
         from public.audit_logs
         where entity_id = any($1::uuid[])
            or after_data->>'work_order_id' = any($2::text[])
         order by created_at, id`,
        [
          [primary.work_order_id, general.work_order_id, primaryRunRow.id, generalRunRow.id],
          [primary.work_order_id, general.work_order_id],
        ],
      );
      expect(expectedAudits.rows.filter((row) => row.action_type === "work_order.created"))
        .toHaveLength(2);
      expect(expectedAudits.rows.filter((row) =>
        row.action_type === "pcb_production.work_order_created"
      )).toHaveLength(2);
      expect(expectedAudits.rows.filter((row) => row.action_type === "work_order.updated"))
        .toHaveLength(4);
      expect(expectedAudits.rows.filter((row) => row.action_type === "work_order.finished"))
        .toHaveLength(2);
      expect(expectedAudits.rows.filter((row) => row.action_type === "pcb_production.completed"))
        .toHaveLength(2);
      expect(expectedAudits.rows.filter((row) =>
        ["work_order.created", "pcb_production.work_order_created"].includes(row.action_type)
      ).every((row) => row.actor_user_id === producer.profileId)).toBe(true);
      expect(expectedAudits.rows.filter((row) => row.action_type === "work_order.updated")
        .every((row) => row.actor_user_id === editor.profileId)).toBe(true);
      expect(expectedAudits.rows.filter((row) =>
        ["work_order.finished", "pcb_production.completed"].includes(row.action_type)
      ).every((row) => row.actor_user_id === finisher.profileId)).toBe(true);

      const archive = await queryAs<Record<string, unknown>>(
        database,
        admin,
        `select * from public.list_audit_log_page(
           100, null, null, null, null, null, null, null, null
         )`,
      );
      const expectedAuditIds = new Set(expectedAudits.rows.map((row) => row.id));
      const archiveFlow = archive.filter((row) => expectedAuditIds.has(String(row.audit_log_id)));
      expect(archiveFlow).toHaveLength(expectedAudits.rows.length);
      for (const row of archiveFlow) {
        expect(Object.keys(row).sort()).toEqual([
          "action_type",
          "actor_full_name",
          "actor_user_id",
          "audit_log_id",
          "created_at",
          "entity_id",
          "entity_type",
          "summary",
        ]);
      }

      const workOrderAudit = expectedAudits.rows.find((row) =>
        row.action_type === "work_order.created" &&
        row.entity_id === primary.work_order_id
      );
      const productionAudit = expectedAudits.rows.find((row) =>
        row.action_type === "pcb_production.completed" &&
        row.entity_id === primaryRunRow.id
      );
      const inventoryAudit = (await database.query<{ id: string }>(
        `select id from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'inventory.manual_adjusted'
         order by created_at, id limit 1`,
        [domain.componentAId],
      )).rows[0];
      if (!workOrderAudit || !productionAudit || !inventoryAudit) {
        throw new Error("Task 151 Archive context fixtures are unavailable");
      }
      const workOrderDetail = await queryAs<Record<string, unknown>>(
        database,
        admin,
        "select * from public.get_audit_log_detail($1::uuid)",
        [workOrderAudit.id],
      );
      expect(workOrderDetail).toEqual([expect.objectContaining({
        context_id: primary.work_order_id,
        context_kind: "work_order",
        detail_authorized: true,
        target_view_authorized: true,
      })]);
      const inventoryDetail = await queryAs<Record<string, unknown>>(
        database,
        admin,
        "select * from public.get_audit_log_detail($1::uuid)",
        [inventoryAudit.id],
      );
      expect(inventoryDetail).toEqual([expect.objectContaining({
        context_id: domain.componentAId,
        context_kind: "product",
        detail_authorized: true,
        target_view_authorized: true,
      })]);
      const productionDetail = await queryAs<Record<string, unknown>>(
        database,
        admin,
        "select * from public.get_audit_log_detail($1::uuid)",
        [productionAudit.id],
      );
      expect(productionDetail).toEqual([expect.objectContaining({
        context_id: null,
        context_kind: null,
        detail_authorized: true,
        target_view_authorized: false,
      })]);

      const integrity = await database.query<{
        contexts: number;
        items: number;
        pdfs: number;
        runs: number;
      }>(
        `select
           (select count(*)::integer from public.pcb_production_work_orders
            where work_order_id = any($1::uuid[])) as contexts,
           (select count(*)::integer from public.work_order_items
            where work_order_id = any($1::uuid[])) as items,
           (select count(*)::integer from public.pcb_production_runs
            where work_order_id = any($1::uuid[])) as runs,
           (select count(*)::integer from public.work_order_pdfs
            where work_order_id = any($1::uuid[])) as pdfs`,
        [[primary.work_order_id, general.work_order_id]],
      );
      expect(integrity.rows).toEqual([{ contexts: 2, items: 6, pdfs: 2, runs: 2 }]);
      expect((await database.query<{ status: string }>(
        "select status from public.projects where id = $1::uuid",
        [domain.projectId],
      )).rows).toEqual([{ status: "planned" }]);
    });
  });
}
