import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import { createTestSerialNumber } from "./helpers/serial";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";
import { setOnlyRelevantPermission } from "./work-order-finish-preflight.suite";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260930130000_add_project_work_order_material_usage_read.sql",
);

interface UsageFixture {
  archivedProductId: string;
  draftWorkOrderId: string;
  newestMovementId: string;
  olderMovementId: string;
  otherProjectId: string;
  positiveMovementId: string;
  projectId: string;
  workOrderId: string;
  workOrderNumber: string;
}

async function callUsageAs<Row extends QueryResultRow>(
  database: PoolClient,
  actor: SecurityActor | null,
  projectId: string | null,
): Promise<Row[]> {
  await database.query("savepoint project_usage_call");
  try {
    await database.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
      [actor?.authUserId ?? ""],
    );
    await database.query(actor ? "set local role authenticated" : "set local role anon");
    const result = await database.query<Row>(
      "select * from public.list_project_work_order_material_usage($1::uuid)",
      [projectId],
    );
    await database.query("reset role");
    await database.query("release savepoint project_usage_call");
    return result.rows;
  } catch (error) {
    await database.query("rollback to savepoint project_usage_call");
    await database.query("release savepoint project_usage_call");
    throw error;
  }
}

async function expectUsageRejected(
  database: PoolClient,
  actor: SecurityActor | null,
  projectId: string | null,
  code: string,
): Promise<void> {
  await expect(callUsageAs(database, actor, projectId)).rejects.toMatchObject({ code });
}

async function nextWorkOrderNumbers(
  database: PoolClient,
  count: number,
): Promise<string[]> {
  const year = (await database.query<{ business_year: number }>(
    `select candidate.business_year
     from pg_catalog.generate_series(7000, 8999) as candidate(business_year)
     where not exists (
       select 1 from public.work_order_number_counters as counter
       where counter.business_year = candidate.business_year
     )
       and not exists (
         select 1 from public.work_orders as work_order
         where work_order.work_order_number like
           'RN-' || candidate.business_year::text || '-%'
       )
     order by candidate.business_year
     limit 1`,
  )).rows[0]?.business_year;
  if (!year) throw new Error("No isolated Work Order year is available");

  const numbers: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const number = (await database.query<{ value: string }>(
      "select public.allocate_work_order_number_for_year($1::integer) as value",
      [year],
    )).rows[0]?.value;
    if (!number) throw new Error("Work Order number allocation failed");
    numbers.push(number);
  }
  return numbers;
}

async function createUsageFixture(
  database: PoolClient,
  actorId: string,
): Promise<UsageFixture> {
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const productId = randomUUID();
  const archivedProductId = randomUUID();
  const workOrderId = randomUUID();
  const otherWorkOrderId = randomUUID();
  const draftWorkOrderId = randomUUID();
  const numbers = await nextWorkOrderNumbers(database, 3);
  const serials = [createTestSerialNumber(), createTestSerialNumber()];

  await database.query(
    `insert into public.projects (
       id, name, customer_name, start_date, delivery_date,
       created_by_user_id, updated_by_user_id
     ) values
       ($1::uuid, 'Usage Project', 'Usage Customer', '2026-09-01', '2026-12-31', $3::uuid, $3::uuid),
       ($2::uuid, 'Other Usage Project', 'Other Customer', '2026-09-01', '2026-12-31', $3::uuid, $3::uuid)`,
    [projectId, otherProjectId, actorId],
  );
  await database.query(
    `insert into public.products (
       id, serial_number, name, category, product_kind,
       created_by_user_id, updated_by_user_id
     ) values
       ($1::uuid, $3::text, 'Usage Component', 'Component', 'component', $5::uuid, $5::uuid),
       ($2::uuid, $4::text, 'Historical Usage Component', 'Component', 'component', $5::uuid, $5::uuid)`,
    [productId, archivedProductId, serials[0], serials[1], actorId],
  );
  const projectProductId = randomUUID();
  await database.query(
    `insert into public.project_products (
       id, project_id, name, created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::uuid, 'Usage Plan', $3::uuid, $3::uuid)`,
    [projectProductId, projectId, actorId],
  );
  await database.query(
    `insert into public.project_product_components (
       project_product_id, product_id, required_quantity,
       created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::uuid, 9007199254740993, $3::uuid, $3::uuid)`,
    [projectProductId, archivedProductId, actorId],
  );
  await database.query(
    `insert into public.work_orders (
       id, work_order_number, project_id, customer_name_snapshot, description,
       status, finished_at, finished_by_user_id,
       created_by_user_id, updated_by_user_id
     ) values
       ($1::uuid, $4::text, $7::uuid, 'Usage Customer', 'Finished usage',
        'finished', '2026-09-30T12:00:00Z', $9::uuid, $9::uuid, $9::uuid),
       ($2::uuid, $5::text, $8::uuid, 'Other Customer', 'Other finished usage',
        'finished', '2026-09-30T12:00:00Z', $9::uuid, $9::uuid, $9::uuid),
       ($3::uuid, $6::text, $7::uuid, 'Usage Customer', 'Draft usage',
        'draft', null, null, $9::uuid, $9::uuid)`,
    [
      workOrderId, otherWorkOrderId, draftWorkOrderId,
      numbers[0], numbers[1], numbers[2], projectId, otherProjectId, actorId,
    ],
  );
  await database.query(
    `insert into public.work_order_items (
       work_order_id, product_id, quantity, added_by_user_id
     ) values ($1::uuid, $2::uuid, 99, $3::uuid)`,
    [draftWorkOrderId, productId, actorId],
  );

  const olderMovementId = "10000000-0000-4000-8000-000000000001";
  const newestMovementId = "20000000-0000-4000-8000-000000000001";
  const positiveMovementId = "30000000-0000-4000-8000-000000000001";
  const movementTime = "2026-09-30T12:34:56.123456Z";
  const movementRows = [
    [olderMovementId, archivedProductId, "work_order", "-9007199254740993", "9007199254740993", "0", "work_order", workOrderId, projectId, movementTime],
    [newestMovementId, productId, "work_order", "-5", "10", "5", "work_order", workOrderId, projectId, movementTime],
    [positiveMovementId, productId, "work_order", "2", "5", "7", "work_order", workOrderId, projectId, "2026-09-30T12:36:00Z"],
    [randomUUID(), productId, "work_order", "-3", "10", "7", "work_order", otherWorkOrderId, otherProjectId, "2026-09-30T12:35:00Z"],
    [randomUUID(), productId, "work_order", "-2", "10", "8", "work_order", otherWorkOrderId, projectId, "2026-09-30T12:35:01Z"],
    [randomUUID(), productId, "work_order", "-4", "10", "6", "work_order", draftWorkOrderId, projectId, "2026-09-30T12:35:02Z"],
    [randomUUID(), productId, "manual_remove", "-1", "10", "9", "manual_adjustment", randomUUID(), projectId, "2026-09-30T12:35:03Z"],
    [randomUUID(), productId, "pcb_production_input", "-1", "10", "9", "pcb_production_input", randomUUID(), projectId, "2026-09-30T12:35:04Z"],
    [randomUUID(), productId, "pcb_production_output", "1", "9", "10", "pcb_production_output", randomUUID(), projectId, "2026-09-30T12:35:05Z"],
  ];
  for (const row of movementRows) {
    await database.query(
      `insert into public.inventory_movements (
         id, product_id, movement_type, quantity_delta,
         quantity_before, quantity_after, source_type, source_id,
         project_id, actor_user_id, created_at
       ) values (
         $1::uuid, $2::uuid, $3::text, $4::bigint,
         $5::bigint, $6::bigint, $7::text, $8::uuid,
         $9::uuid, $11::uuid, $10::timestamptz
       )`,
      [...row, actorId],
    );
  }

  const originalMovementId = randomUUID();
  await database.query(
    `insert into public.inventory_movements (
       id, product_id, movement_type, quantity_delta,
       quantity_before, quantity_after, source_type, source_id,
       project_id, actor_user_id
     ) values (
       $1::uuid, $2::uuid, 'manual_add', 2, 0, 2,
       'manual_adjustment', $3::uuid, $4::uuid, $5::uuid
     )`,
    [originalMovementId, productId, randomUUID(), projectId, actorId],
  );
  await database.query(
    `insert into public.inventory_movements (
       product_id, movement_type, quantity_delta,
       quantity_before, quantity_after, reason,
       source_type, source_id, project_id, actor_user_id,
       reversal_of_movement_id
     ) values (
       $1::uuid, 'correction_reversal', -2, 2, 0, 'Correct test movement',
       'correction_reversal', $2::uuid, $3::uuid, $4::uuid, $5::uuid
     )`,
    [productId, randomUUID(), projectId, actorId, originalMovementId],
  );
  await database.query(
    `update public.products
     set is_active = false,
         archived_at = pg_catalog.clock_timestamp(),
         archived_by_user_id = $2::uuid,
         updated_at = pg_catalog.clock_timestamp(),
         updated_by_user_id = $2::uuid
     where id = $1::uuid`,
    [archivedProductId, actorId],
  );

  return {
    archivedProductId,
    draftWorkOrderId,
    newestMovementId,
    olderMovementId,
    otherProjectId,
    positiveMovementId,
    projectId,
    workOrderId,
    workOrderNumber: numbers[0]!,
  };
}

export function registerProjectMaterialUsageTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 129 Project Work Order material usage (static)", () => {
    it("defines a narrow Project-authorized read with exact movement attribution", () => {
      const sql = readFileSync(migrationPath, "utf8");
      expect(sql).toContain("create function public.list_project_work_order_material_usage(");
      expect(sql).toContain("language plpgsql");
      expect(sql).toContain("stable");
      expect(sql).toContain("security definer");
      expect(sql).toContain("set search_path = ''");
      expect(sql).toContain("public.has_permission('projects.view')");
      expect(sql).not.toContain("public.has_permission('work_orders.view')");
      expect(sql).not.toContain("public.has_permission('inventory.view')");
      expect(sql).toContain("movement.movement_type = 'work_order'");
      expect(sql).toContain("movement.source_type = 'work_order'");
      expect(sql).toContain("movement.source_id = work_order.id");
      expect(sql).toContain("movement.project_id = p_project_id");
      expect(sql).toContain("work_order.project_id = p_project_id");
      expect(sql).toContain("work_order.status = 'finished'");
      expect(sql).toContain("movement.quantity_delta < 0");
      expect(sql).toContain("(0::numeric - movement.quantity_delta::numeric)::text");
      expect(sql).toContain("order by movement.created_at desc, movement.id desc");
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain("to authenticated");
      expect(sql).not.toMatch(/\b(insert|update|delete)\s+(into|public\.)/i);
      expect(sql).not.toContain("pcb_production_input'")
      expect(sql).not.toContain("correction_reversal'");
    });
  });

  describe.skipIf(process.env.TASK129_MIGRATION !== "1")(
    "Task 129 Project Work Order material usage (requires deployed migration)",
    () => {
      it("enforces Project-read authorization and safe input errors", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const state = await createUsageFixture(database, fixture.actors.admin.profileId);
          await expect(callUsageAs(database, fixture.actors.admin, state.projectId))
            .resolves.toHaveLength(2);

          const viewer = fixture.actors.unpermitted;
          await setOnlyRelevantPermission(database, viewer, fixture.actors.admin.profileId, "projects.view");
          await expect(callUsageAs(database, viewer, state.projectId)).resolves.toHaveLength(2);

          for (const permission of ["work_orders.view", "inventory.view", "work_orders.finish"]) {
            await setOnlyRelevantPermission(database, viewer, fixture.actors.admin.profileId, permission);
            await expectUsageRejected(database, viewer, state.projectId, "42501");
          }
          await setOnlyRelevantPermission(database, viewer, fixture.actors.admin.profileId, null);
          await expectUsageRejected(database, viewer, state.projectId, "42501");

          await setOnlyRelevantPermission(database, fixture.actors.inactive, fixture.actors.admin.profileId, "projects.view");
          await expectUsageRejected(database, fixture.actors.inactive, state.projectId, "42501");
          await expectUsageRejected(database, null, state.projectId, "42501");
          await expectUsageRejected(database, fixture.actors.admin, null, "22023");
          await expectUsageRejected(database, fixture.actors.admin, randomUUID(), "P0002");
        });
      });

      it("returns only Finished same-Project Work Order deductions with exact history", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const state = await createUsageFixture(database, fixture.actors.admin.profileId);
          const before = (await database.query(
            `select
               (select count(*)::text from public.inventory_movements) as movements,
               (select count(*)::text from public.audit_logs) as audits,
               (select count(*)::text from public.work_orders) as work_orders,
               (select coalesce(
                  pg_catalog.jsonb_agg(pg_catalog.to_jsonb(project) order by project.id),
                  '[]'::jsonb
                ) from public.projects as project
                  where project.id = any($1::uuid[])) as projects,
               (select coalesce(
                  pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item) order by item.id),
                  '[]'::jsonb
                ) from public.work_order_items as item
                  where item.work_order_id = any($2::uuid[])) as work_order_items,
               (select coalesce(sum(quantity), 0::numeric)::text from public.inventory_balances) as balance_total`,
            [
              [state.projectId, state.otherProjectId],
              [state.workOrderId, state.draftWorkOrderId],
            ],
          )).rows[0];
          const rows = await callUsageAs<Record<string, unknown>>(
            database,
            fixture.actors.admin,
            state.projectId,
          );

          expect(rows).toHaveLength(2);
          expect(Object.keys(rows[0]!).sort()).toEqual([
            "consumed_at", "movement_id", "product_id", "product_name",
            "project_id", "quantity", "serial_number", "work_order_id",
            "work_order_number",
          ]);
          expect(rows.map((row) => row.movement_id)).toEqual([
            state.newestMovementId,
            state.olderMovementId,
          ]);
          expect(rows[0]).toMatchObject({
            movement_id: state.newestMovementId,
            project_id: state.projectId,
            quantity: "5",
            work_order_id: state.workOrderId,
            work_order_number: state.workOrderNumber,
          });
          expect(rows[1]).toMatchObject({
            movement_id: state.olderMovementId,
            product_id: state.archivedProductId,
            product_name: "Historical Usage Component",
            quantity: "9007199254740993",
          });
          expect(rows.some((row) => row.work_order_id === state.draftWorkOrderId)).toBe(false);
          expect(rows.some((row) => row.movement_id === state.positiveMovementId)).toBe(false);

          const after = (await database.query(
            `select
               (select count(*)::text from public.inventory_movements) as movements,
               (select count(*)::text from public.audit_logs) as audits,
               (select count(*)::text from public.work_orders) as work_orders,
               (select coalesce(
                  pg_catalog.jsonb_agg(pg_catalog.to_jsonb(project) order by project.id),
                  '[]'::jsonb
                ) from public.projects as project
                  where project.id = any($1::uuid[])) as projects,
               (select coalesce(
                  pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item) order by item.id),
                  '[]'::jsonb
                ) from public.work_order_items as item
                  where item.work_order_id = any($2::uuid[])) as work_order_items,
               (select coalesce(sum(quantity), 0::numeric)::text from public.inventory_balances) as balance_total`,
            [
              [state.projectId, state.otherProjectId],
              [state.workOrderId, state.draftWorkOrderId],
            ],
          )).rows[0];
          expect(after).toEqual(before);
        });
      });

      it("keeps the existing commitment consumption attribution consistent", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const state = await createUsageFixture(database, fixture.actors.admin.profileId);
          const usage = await callUsageAs<{ product_id: string; quantity: string }>(
            database,
            fixture.actors.admin,
            state.projectId,
          );
          const usageByProduct = new Map(usage.map((row) => [row.product_id, row.quantity]));
          const commitments = (await database.query<{
            actual_project_consumption: string;
            product_id: string;
            project_id: string;
          }>(
            `select project_id, product_id, actual_project_consumption::text
             from public.calculate_open_project_commitments()
             where project_id = $1::uuid`,
            [state.projectId],
          )).rows;
          expect(commitments).toEqual([{
            actual_project_consumption: "9007199254740993",
            product_id: state.archivedProductId,
            project_id: state.projectId,
          }]);
          expect(usageByProduct.get(state.archivedProductId))
            .toBe(commitments[0]?.actual_project_consumption);
        });
      });

      it("deploys with the reviewed metadata and authenticated-only ACL", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const metadata = (await database.query<{
            anon_execute: boolean;
            authenticated_execute: boolean;
            is_stable: boolean;
            is_security_definer: boolean;
            public_execute: boolean;
            search_path: string[] | null;
          }>(
            `select
               procedure.provolatile = 's' as is_stable,
               procedure.prosecdef as is_security_definer,
               procedure.proconfig as search_path,
               pg_catalog.has_function_privilege(
                 'anon', procedure.oid, 'execute'
               ) as anon_execute,
               pg_catalog.has_function_privilege(
                 'authenticated', procedure.oid, 'execute'
               ) as authenticated_execute,
               exists (
                 select 1
                 from pg_catalog.aclexplode(procedure.proacl) as privilege
                 where privilege.grantee = 0
                   and privilege.privilege_type = 'EXECUTE'
               ) as public_execute
             from pg_catalog.pg_proc as procedure
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'public'
               and procedure.proname = 'list_project_work_order_material_usage'
               and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = 'p_project_id uuid'`,
          )).rows[0];
          expect(metadata).toEqual({
            anon_execute: false,
            authenticated_execute: true,
            is_stable: true,
            is_security_definer: true,
            public_execute: false,
            search_path: ["search_path=\"\""],
          });
        });
      });
    },
  );
}
