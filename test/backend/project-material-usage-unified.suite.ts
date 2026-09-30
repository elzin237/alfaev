import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import { createTestSerialNumber } from "./helpers/serial";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260930140000_add_unified_project_material_usage_read.sql",
);

interface UnifiedUsageFixture {
  archivedInputId: string;
  draftWorkOrderId: string;
  generalOutputId: string;
  linkedOutputId: string;
  linkedPcbMovementId: string;
  linkedRunId: string;
  otherProjectId: string;
  projectId: string;
  workOrderId: string;
  workOrderMovementIds: string[];
  workOrderNumber: string;
}

async function callUsageAs<Row extends QueryResultRow>(
  database: PoolClient,
  actor: SecurityActor | null,
  projectId: string | null,
): Promise<Row[]> {
  await database.query("savepoint unified_project_usage_call");
  try {
    await database.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
      [actor?.authUserId ?? ""],
    );
    await database.query(actor ? "set local role authenticated" : "set local role anon");
    const rows = (await database.query<Row>(
      "select * from public.list_project_material_usage($1::uuid)",
      [projectId],
    )).rows;
    await database.query("reset role");
    await database.query("release savepoint unified_project_usage_call");
    return rows;
  } catch (error) {
    await database.query("rollback to savepoint unified_project_usage_call");
    await database.query("release savepoint unified_project_usage_call");
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

async function setOnlyUsagePermission(
  database: PoolClient,
  actor: SecurityActor,
  adminProfileId: string,
  permissionKey: string | null,
): Promise<void> {
  await database.query(
    `delete from public.user_permissions as permission
     using public.permission_definitions as definition
     where permission.permission_definition_id = definition.id
       and permission.user_id = $1::uuid
       and (
         definition.key like 'projects.%'
         or definition.key like 'work_orders.%'
         or definition.key like 'inventory.%'
         or definition.key like 'pcb.%'
       )`,
    [actor.profileId],
  );
  if (!permissionKey) return;
  await database.query(
    `insert into public.user_permissions (
       user_id, permission_definition_id, granted_by_user_id
     )
     select $1::uuid, definition.id, $2::uuid
     from public.permission_definitions as definition
     where definition.key = $3::text`,
    [actor.profileId, adminProfileId, permissionKey],
  );
}

async function allocateWorkOrderNumbers(
  database: PoolClient,
  count: number,
): Promise<string[]> {
  const year = (await database.query<{ business_year: number }>(
    `select candidate.business_year
     from pg_catalog.generate_series(6000, 6999) as candidate(business_year)
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
    const value = (await database.query<{ value: string }>(
      "select public.allocate_work_order_number_for_year($1::integer) as value",
      [year],
    )).rows[0]?.value;
    if (!value) throw new Error("Work Order number allocation failed");
    numbers.push(value);
  }
  return numbers;
}

async function insertMovement(
  database: PoolClient,
  values: unknown[],
): Promise<void> {
  await database.query(
    `insert into public.inventory_movements (
       id, product_id, movement_type, quantity_delta,
       quantity_before, quantity_after, reason, source_type, source_id,
       project_id, actor_user_id, created_at, reversal_of_movement_id
     ) values (
       $1::uuid, $2::uuid, $3::text, $4::bigint,
       $5::bigint, $6::bigint, $7::text, $8::text, $9::uuid,
       $10::uuid, $11::uuid, $12::timestamptz, $13::uuid
     )`,
    values,
  );
}

async function createUnifiedUsageFixture(
  database: PoolClient,
  actorId: string,
): Promise<UnifiedUsageFixture> {
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const archivedInputId = randomUUID();
  const noiseProductId = randomUUID();
  const linkedOutputId = randomUUID();
  const generalOutputId = randomUUID();
  const otherOutputId = randomUUID();
  const productIds = [
    archivedInputId,
    noiseProductId,
    linkedOutputId,
    generalOutputId,
    otherOutputId,
  ];
  const serials = productIds.map(() => createTestSerialNumber());
  const workOrderId = randomUUID();
  const draftWorkOrderId = randomUUID();
  const workOrderNumbers = await allocateWorkOrderNumbers(database, 2);

  await database.query(
    `insert into public.projects (
       id, name, customer_name, start_date, delivery_date,
       created_by_user_id, updated_by_user_id
     ) values
       ($1::uuid, 'Unified Usage Project', 'Unified Customer',
        '2026-09-01', '2026-12-31', $3::uuid, $3::uuid),
       ($2::uuid, 'Other Unified Project', 'Other Customer',
        '2026-09-01', '2026-12-31', $3::uuid, $3::uuid)`,
    [projectId, otherProjectId, actorId],
  );

  for (let index = 0; index < productIds.length; index += 1) {
    await database.query(
      `insert into public.products (
         id, serial_number, name, category, product_kind,
         created_by_user_id, updated_by_user_id
       ) values ($1::uuid, $2::text, $3::text, 'Task 130', $4::text, $5::uuid, $5::uuid)`,
      [
        productIds[index],
        serials[index],
        index === 0 ? "Archived Project PCB Input" : `Task 130 Product ${index}`,
        index >= 2 ? "pcb_finished_good" : "component",
        actorId,
      ],
    );
  }

  const projectPlanA = randomUUID();
  const projectPlanB = randomUUID();
  await database.query(
    `insert into public.project_products (
       id, project_id, name, created_by_user_id, updated_by_user_id
     ) values
       ($1::uuid, $3::uuid, 'Project A PCB inputs', $5::uuid, $5::uuid),
       ($2::uuid, $4::uuid, 'Project B PCB inputs', $5::uuid, $5::uuid)`,
    [projectPlanA, projectPlanB, projectId, otherProjectId, actorId],
  );
  await database.query(
    `insert into public.project_product_components (
       project_product_id, product_id, required_quantity,
       created_by_user_id, updated_by_user_id
     ) values
       ($1::uuid, $3::uuid, 9223372036854775807, $4::uuid, $4::uuid),
       ($2::uuid, $3::uuid, 10, $4::uuid, $4::uuid)`,
    [projectPlanA, projectPlanB, archivedInputId, actorId],
  );

  const linkedCardId = randomUUID();
  const generalCardId = randomUUID();
  const otherCardId = randomUUID();
  await database.query(
    `insert into public.pcb_cards (
       id, name, output_product_id, created_by_user_id, updated_by_user_id
     ) values
       ($1::uuid, 'Linked Controller PCB', $4::uuid, $7::uuid, $7::uuid),
       ($2::uuid, 'General Stock PCB', $5::uuid, $7::uuid, $7::uuid),
       ($3::uuid, 'Other Project PCB', $6::uuid, $7::uuid, $7::uuid)`,
    [
      linkedCardId, generalCardId, otherCardId,
      linkedOutputId, generalOutputId, otherOutputId, actorId,
    ],
  );
  const linkedVersionId = randomUUID();
  const generalVersionId = randomUUID();
  const otherVersionId = randomUUID();
  await database.query(
    `insert into public.pcb_bom_versions (
       id, pcb_card_id, version_number, created_by_user_id
     ) values
       ($1::uuid, $4::uuid, 1, $7::uuid),
       ($2::uuid, $5::uuid, 1, $7::uuid),
       ($3::uuid, $6::uuid, 1, $7::uuid)`,
    [
      linkedVersionId, generalVersionId, otherVersionId,
      linkedCardId, generalCardId, otherCardId, actorId,
    ],
  );
  const linkedRunId = randomUUID();
  const generalRunId = randomUUID();
  const otherRunId = randomUUID();
  await database.query(
    `insert into public.pcb_production_runs (
       id, pcb_card_id, bom_version_id, project_id,
       quantity_produced, produced_by_user_id, completed_at
     ) values
       ($1::uuid, $4::uuid, $7::uuid, $10::uuid, 1, $12::uuid, '2026-09-30T13:00:00Z'),
       ($2::uuid, $5::uuid, $8::uuid, null, 1, $12::uuid, '2026-09-30T11:00:00Z'),
       ($3::uuid, $6::uuid, $9::uuid, $11::uuid, 1, $12::uuid, '2026-09-30T10:00:00Z')`,
    [
      linkedRunId, generalRunId, otherRunId,
      linkedCardId, generalCardId, otherCardId,
      linkedVersionId, generalVersionId, otherVersionId,
      projectId, otherProjectId, actorId,
    ],
  );

  await database.query(
    `insert into public.work_orders (
       id, work_order_number, project_id, customer_name_snapshot, description,
       status, finished_at, finished_by_user_id,
       created_by_user_id, updated_by_user_id
     ) values
       ($1::uuid, $3::text, $5::uuid, 'Unified Customer', 'Uses two finished PCBs',
        'draft', null, null, $6::uuid, $6::uuid),
       ($2::uuid, $4::text, $5::uuid, 'Unified Customer', 'Draft activity',
        'draft', null, null, $6::uuid, $6::uuid)`,
    [workOrderId, draftWorkOrderId, workOrderNumbers[0], workOrderNumbers[1], projectId, actorId],
  );
  await database.query(
    `insert into public.work_order_items (
       work_order_id, product_id, quantity, added_by_user_id
     ) values
       ($1::uuid, $2::uuid, 1, $5::uuid),
       ($1::uuid, $3::uuid, 2, $5::uuid),
       ($4::uuid, $6::uuid, 1, $5::uuid)`,
    [workOrderId, linkedOutputId, generalOutputId, draftWorkOrderId, actorId, noiseProductId],
  );
  await database.query(
    `update public.work_orders
     set status = 'finished',
         finished_at = '2026-09-30T14:00:00Z',
         finished_by_user_id = $2::uuid,
         updated_at = '2026-09-30T14:00:00Z',
         updated_by_user_id = $2::uuid
     where id = $1::uuid`,
    [workOrderId, actorId],
  );

  const commonTime = "2026-09-30T15:00:00.123456Z";
  const linkedPcbMovementId = "30000000-0000-4000-8000-000000000001";
  const linkedWorkOrderMovementId = "50000000-0000-4000-8000-000000000001";
  const generalWorkOrderMovementId = "40000000-0000-4000-8000-000000000001";
  const movementRows: unknown[][] = [
    [linkedPcbMovementId, archivedInputId, "pcb_production_input", "-9007199254740993", "9007199254740993", "0", null, "pcb_production_input", linkedRunId, projectId, actorId, commonTime, null],
    [linkedWorkOrderMovementId, linkedOutputId, "work_order", "-1", "5", "4", null, "work_order", workOrderId, projectId, actorId, commonTime, null],
    [generalWorkOrderMovementId, generalOutputId, "work_order", "-2", "5", "3", null, "work_order", workOrderId, projectId, actorId, commonTime, null],
    [randomUUID(), archivedInputId, "pcb_production_input", "-11", "11", "0", null, "pcb_production_input", generalRunId, null, actorId, "2026-09-30T12:00:00Z", null],
    [randomUUID(), archivedInputId, "pcb_production_input", "-3", "3", "0", null, "pcb_production_input", otherRunId, otherProjectId, actorId, "2026-09-30T12:01:00Z", null],
    [randomUUID(), noiseProductId, "pcb_production_input", "-4", "4", "0", null, "pcb_production_input", otherRunId, projectId, actorId, "2026-09-30T12:02:00Z", null],
    [randomUUID(), noiseProductId, "pcb_production_input", "2", "0", "2", null, "pcb_production_input", linkedRunId, projectId, actorId, "2026-09-30T12:03:00Z", null],
    [randomUUID(), linkedOutputId, "pcb_production_output", "1", "0", "1", null, "pcb_production_output", linkedRunId, projectId, actorId, "2026-09-30T12:04:00Z", null],
    [randomUUID(), noiseProductId, "work_order", "-1", "1", "0", null, "work_order", draftWorkOrderId, projectId, actorId, "2026-09-30T12:05:00Z", null],
    [randomUUID(), noiseProductId, "manual_remove", "-1", "1", "0", null, "manual_adjustment", randomUUID(), projectId, actorId, "2026-09-30T12:06:00Z", null],
    [randomUUID(), linkedOutputId, "work_order", "1", "4", "5", null, "work_order", workOrderId, projectId, actorId, "2026-09-30T12:07:00Z", null],
  ];
  for (const row of movementRows) await insertMovement(database, row);

  const reversibleMovementId = randomUUID();
  await insertMovement(database, [
    reversibleMovementId, noiseProductId, "manual_add", "2", "0", "2", null,
    "manual_adjustment", randomUUID(), projectId, actorId, "2026-09-30T12:08:00Z", null,
  ]);
  await insertMovement(database, [
    randomUUID(), noiseProductId, "correction_reversal", "-2", "2", "0",
    "Task 130 correction fixture", "correction_reversal", randomUUID(), projectId,
    actorId, "2026-09-30T12:09:00Z", reversibleMovementId,
  ]);

  await database.query(
    `update public.products
     set is_active = false,
         archived_at = pg_catalog.clock_timestamp(),
         archived_by_user_id = $2::uuid,
         updated_at = pg_catalog.clock_timestamp(),
         updated_by_user_id = $2::uuid
     where id = $1::uuid`,
    [archivedInputId, actorId],
  );

  return {
    archivedInputId,
    draftWorkOrderId,
    generalOutputId,
    linkedOutputId,
    linkedPcbMovementId,
    linkedRunId,
    otherProjectId,
    projectId,
    workOrderId,
    workOrderMovementIds: [linkedWorkOrderMovementId, generalWorkOrderMovementId],
    workOrderNumber: workOrderNumbers[0]!,
  };
}

export function registerUnifiedProjectMaterialUsageTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 130 unified Project material usage (static)", () => {
    it("defines one narrow Project-owned read over authoritative physical movements", () => {
      const sql = readFileSync(migrationPath, "utf8");
      expect(sql).toContain("create function public.list_project_material_usage(");
      expect(sql).toContain("language plpgsql");
      expect(sql).toContain("stable");
      expect(sql).toContain("security definer");
      expect(sql).toContain("set search_path = ''");
      expect(sql).toContain("public.has_permission('projects.view')");
      for (const permission of ["pcb.view", "work_orders.view", "inventory.view"]) {
        expect(sql).not.toContain(`public.has_permission('${permission}')`);
      }
      expect(sql).toContain("movement.movement_type = 'work_order'");
      expect(sql).toContain("work_order.status = 'finished'");
      expect(sql).toContain("movement.movement_type = 'pcb_production_input'");
      expect(sql).toContain("movement.source_type = 'pcb_production_input'");
      expect(sql).toContain("production_run.project_id = p_project_id");
      expect(sql).toContain("production_run.status = 'completed'");
      expect(sql).toContain("movement.quantity_delta < 0");
      expect(sql).toContain("union all");
      expect(sql).toContain("order by usage.consumed_at desc, usage.movement_id desc");
      expect(sql).not.toContain("public.pcb_bom_items");
      expect(sql).not.toContain("public.pcb_bom_versions");
      expect(sql).not.toMatch(/\b(insert|update|delete)\s+(into|public\.)/i);
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain("to authenticated");
    });
  });

  describe.skipIf(process.env.TASK130_MIGRATION !== "1")(
    "Task 130 unified Project material usage (requires deployed migration)",
    () => {
      it("enforces only the Project read boundary and safe input errors", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const state = await createUnifiedUsageFixture(database, fixture.actors.admin.profileId);
          await expect(callUsageAs(database, fixture.actors.admin, state.projectId))
            .resolves.toHaveLength(3);

          const viewer = fixture.actors.unpermitted;
          await setOnlyUsagePermission(database, viewer, fixture.actors.admin.profileId, "projects.view");
          await expect(callUsageAs(database, viewer, state.projectId)).resolves.toHaveLength(3);
          for (const permission of ["pcb.view", "work_orders.view", "inventory.view", "pcb.produce"]) {
            await setOnlyUsagePermission(database, viewer, fixture.actors.admin.profileId, permission);
            await expectUsageRejected(database, viewer, state.projectId, "42501");
          }
          await setOnlyUsagePermission(database, viewer, fixture.actors.admin.profileId, null);
          await expectUsageRejected(database, viewer, state.projectId, "42501");
          await setOnlyUsagePermission(database, fixture.actors.inactive, fixture.actors.admin.profileId, "projects.view");
          await expectUsageRejected(database, fixture.actors.inactive, state.projectId, "42501");
          await expectUsageRejected(database, null, state.projectId, "42501");
          await expectUsageRejected(database, fixture.actors.admin, null, "22023");
          await expectUsageRejected(database, fixture.actors.admin, randomUUID(), "P0002");
        });
      });

      it("merges valid Work Order and Project-linked PCB input events without expansion", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const state = await createUnifiedUsageFixture(database, fixture.actors.admin.profileId);
          const rows = await callUsageAs<Record<string, unknown>>(
            database,
            fixture.actors.admin,
            state.projectId,
          );
          expect(rows).toHaveLength(3);
          expect(Object.keys(rows[0]!).sort()).toEqual([
            "consumed_at", "movement_id", "product_id", "product_name", "project_id",
            "quantity", "serial_number", "source_id", "source_label", "source_type",
          ]);
          expect(rows.map((row) => row.movement_id)).toEqual([
            state.workOrderMovementIds[0],
            state.workOrderMovementIds[1],
            state.linkedPcbMovementId,
          ]);
          expect(rows.filter((row) => row.source_type === "pcb_production")).toEqual([
            expect.objectContaining({
              movement_id: state.linkedPcbMovementId,
              product_id: state.archivedInputId,
              product_name: "Archived Project PCB Input",
              quantity: "9007199254740993",
              source_id: state.linkedRunId,
              source_label: "Linked Controller PCB",
            }),
          ]);
          expect(rows.filter((row) => row.source_type === "work_order")).toEqual([
            expect.objectContaining({
              product_id: state.linkedOutputId,
              quantity: "1",
              source_id: state.workOrderId,
              source_label: state.workOrderNumber,
            }),
            expect.objectContaining({
              product_id: state.generalOutputId,
              quantity: "2",
              source_id: state.workOrderId,
              source_label: state.workOrderNumber,
            }),
          ]);
          expect(rows.filter((row) => row.product_id === state.archivedInputId)).toHaveLength(1);
          expect(rows.some((row) => row.source_id === state.draftWorkOrderId)).toBe(false);
        });
      });

      it("keeps the existing commitment model exact for linked, general, and other-Project PCB use", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const state = await createUnifiedUsageFixture(database, fixture.actors.admin.profileId);
          const commitments = (await database.query<{
            actual_project_consumption: string;
            outstanding_commitment: string;
            project_id: string;
          }>(
            `select
               project_id,
               actual_project_consumption::text,
               outstanding_commitment::text
             from public.calculate_open_project_commitments($1::uuid)
             where project_id = any($2::uuid[])
             order by project_id`,
            [state.archivedInputId, [state.projectId, state.otherProjectId]],
          )).rows;
          const byProject = new Map(commitments.map((row) => [row.project_id, row]));
          expect(byProject.get(state.projectId)).toMatchObject({
            actual_project_consumption: "9007199254740993",
            outstanding_commitment: "9214364837600034814",
          });
          expect(byProject.get(state.otherProjectId)).toMatchObject({
            actual_project_consumption: "3",
            outstanding_commitment: "7",
          });
        });
      });

      it("is read-only and deploys with authenticated-only trusted-read metadata", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const state = await createUnifiedUsageFixture(database, fixture.actors.admin.profileId);
          const snapshotSql = `select
            (select count(*)::text from public.inventory_balances) as balances,
            (select count(*)::text from public.inventory_movements) as movements,
            (select count(*)::text from public.projects) as projects,
            (select count(*)::text from public.work_orders) as work_orders,
            (select count(*)::text from public.pcb_production_runs) as production_runs,
            (select count(*)::text from public.audit_logs) as audits`;
          const before = (await database.query(snapshotSql)).rows[0];
          await callUsageAs(database, fixture.actors.admin, state.projectId);
          expect((await database.query(snapshotSql)).rows[0]).toEqual(before);

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
               pg_catalog.has_function_privilege('anon', procedure.oid, 'execute') as anon_execute,
               pg_catalog.has_function_privilege('authenticated', procedure.oid, 'execute') as authenticated_execute,
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
               and procedure.proname = 'list_project_material_usage'
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
