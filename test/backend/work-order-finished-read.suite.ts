import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { createTestSerialNumber } from "./helpers/serial";
import type { SecurityFixtureHarness } from "./security-fixtures";
import {
  actAs,
  createPreflightFixture,
  expectRejected,
  setOnlyRelevantPermission,
} from "./work-order-finish-preflight.suite";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260930110000_add_finished_work_order_reads.sql",
);

async function readDetail(database: PoolClient, workOrderId: string | null) {
  return (await database.query(
    `select *
     from public.get_finished_work_order_detail($1::uuid)`,
    [workOrderId],
  )).rows;
}

async function readMaterials(database: PoolClient, workOrderId: string | null) {
  return (await database.query(
    `select *
     from public.list_finished_work_order_materials($1::uuid)`,
    [workOrderId],
  )).rows;
}

async function readMovements(database: PoolClient, workOrderId: string | null) {
  return (await database.query(
    `select *
     from public.list_finished_work_order_movements($1::uuid)`,
    [workOrderId],
  )).rows;
}

async function finishReadFixture(
  database: PoolClient,
  harness: SecurityFixtureHarness,
) {
  const admin = harness.actors.admin;
  const state = await createPreflightFixture(database, admin.profileId, {
    itemQuantity: "9007199254740993",
    physicalQuantity: "9007199254740993",
    requiredQuantity: "9007199254740993",
  });
  const finishedAt = "2026-09-30 11:00:00.123456+00";
  await database.query(
    `update public.work_orders
     set status = 'finished',
         finished_at = $2::timestamptz,
         finished_by_user_id = $3::uuid,
         updated_at = $2::timestamptz,
         updated_by_user_id = $3::uuid
     where id = $1::uuid`,
    [state.workOrderId, finishedAt, harness.actors.inactive.profileId],
  );
  const pdfPath = `final/${state.workOrderId}/${randomUUID()}.pdf`;
  await database.query(
    `insert into storage.objects (bucket_id, name, metadata)
     values (
       'work-order-pdfs', $1::text,
       pg_catalog.jsonb_build_object('mimetype', 'application/pdf')
     )`,
    [pdfPath],
  );
  const pdfId = (await database.query<{ id: string }>(
    `insert into public.work_order_pdfs (
       work_order_id, storage_reference, generated_at,
       generated_by_user_id, document_version
     ) values (
       $1::uuid, $2::text, $3::timestamptz, $4::uuid, 1
     ) returning id`,
    [state.workOrderId, pdfPath, finishedAt, admin.profileId],
  )).rows[0]!.id;
  const movementId = randomUUID();
  await database.query(
    `insert into public.inventory_movements (
       id, product_id, movement_type,
       quantity_delta, quantity_before, quantity_after,
       source_type, source_id, project_id, actor_user_id, created_at
     ) values (
       $1::uuid, $2::uuid, 'work_order',
       -9007199254740993, 9007199254740993, 0,
       'work_order', $3::uuid, $4::uuid, $5::uuid, $6::timestamptz
     )`,
    [
      movementId,
      state.productId,
      state.workOrderId,
      state.projectId,
      admin.profileId,
      finishedAt,
    ],
  );
  await database.query(
    `insert into public.inventory_movements (
       product_id, movement_type,
       quantity_delta, quantity_before, quantity_after,
       source_type, source_id, actor_user_id
     ) values (
       $1::uuid, 'manual_add', 1, 0, 1,
       'manual_adjustment', $2::uuid, $3::uuid
     )`,
    [state.productId, randomUUID(), admin.profileId],
  );
  await database.query(
    `update public.products
     set is_active = false,
         archived_at = pg_catalog.clock_timestamp(),
         archived_by_user_id = $2::uuid,
         updated_at = pg_catalog.clock_timestamp(),
         updated_by_user_id = $2::uuid
     where id = $1::uuid`,
    [state.productId, admin.profileId],
  );
  return { ...state, finishedAt, movementId, pdfId };
}

export function registerFinishedWorkOrderReadTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 125 Finished Work Order trusted reads (static)", () => {
    it("defines only narrow authenticated read RPCs without direct mutation or broad RLS changes", () => {
      const sql = readFileSync(migrationPath, "utf8");
      expect(sql).toContain("create function public.get_finished_work_order_detail(");
      expect(sql).toContain("create function public.list_finished_work_order_materials(");
      expect(sql).toContain("create function public.list_finished_work_order_movements(");
      expect(sql.match(/security definer/g)).toHaveLength(3);
      expect(sql.match(/set search_path = ''/g)).toHaveLength(3);
      expect(sql.match(/grant execute/g)).toHaveLength(3);
      expect(sql).toContain("public.has_permission('work_orders.view')");
      expect(sql).toContain("movement.source_type = 'work_order'");
      expect(sql).toContain("movement.source_id = p_work_order_id");
      expect(sql).toContain("item.quantity::text");
      expect(sql).toContain("movement.quantity_delta::text");
      expect(sql).not.toMatch(/alter\s+table\s+public\.(projects|products|inventory_movements|work_orders)/i);
      expect(sql).not.toMatch(/\b(insert|update|delete)\s+(into|public\.)/i);
      expect(sql).not.toContain("storage_reference");
      expect(sql).not.toContain("finisher.email");
    });
  });

  describe.skipIf(process.env.TASK125_MIGRATION !== "1")(
    "Task 125 Finished Work Order trusted reads (requires deployed migration)",
    () => {
      it("authorizes Admin/view-only, preserves archived history, and returns exact narrow rows", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const viewer = fixture.actors.unpermitted;
          const state = await finishReadFixture(database, fixture);

          await actAs(database, admin);
          const adminDetail = await readDetail(database, state.workOrderId);
          expect(adminDetail).toHaveLength(1);
          expect(Object.keys(adminDetail[0]!).sort()).toEqual([
            "created_at",
            "customer_name_snapshot",
            "description",
            "document_version",
            "finished_at",
            "finished_by_full_name",
            "finished_by_user_id",
            "generated_at",
            "pdf_id",
            "project_id",
            "project_name",
            "work_order_id",
            "work_order_number",
          ]);
          expect(adminDetail[0]).toMatchObject({
            document_version: 1,
            finished_by_full_name: expect.any(String),
            finished_by_user_id: fixture.actors.inactive.profileId,
            pdf_id: state.pdfId,
            work_order_id: state.workOrderId,
            work_order_number: state.workOrderNumber,
          });
          const materials = await readMaterials(database, state.workOrderId);
          expect(materials).toEqual([expect.objectContaining({
            product_id: state.productId,
            quantity: "9007199254740993",
          })]);
          expect(Object.keys(materials[0]!).sort()).toEqual([
            "product_id",
            "product_name",
            "quantity",
            "serial_number",
          ]);
          const movements = await readMovements(database, state.workOrderId);
          expect(movements).toEqual([expect.objectContaining({
            movement_id: state.movementId,
            product_id: state.productId,
            quantity_after: "0",
            quantity_before: "9007199254740993",
            quantity_delta: "-9007199254740993",
          })]);
          await database.query("reset role");

          await setOnlyRelevantPermission(
            database,
            viewer,
            admin.profileId,
            "work_orders.view",
          );
          await actAs(database, viewer);
          expect(await readDetail(database, state.workOrderId)).toHaveLength(1);
          expect(await readMaterials(database, state.workOrderId)).toHaveLength(1);
          expect(await readMovements(database, state.workOrderId)).toHaveLength(1);
          await expect(database.query(
            "select id from public.projects where id = $1::uuid",
            [state.projectId],
          )).resolves.toMatchObject({ rows: [] });
          await expect(database.query(
            "select id from public.inventory_movements where source_id = $1::uuid",
            [state.workOrderId],
          )).resolves.toMatchObject({ rows: [] });
          await database.query("reset role");
        });
      });

      it("denies non-viewers/inactive/anonymous and rejects Draft, missing, and null IDs safely", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const actor = fixture.actors.unpermitted;
          const draft = await createPreflightFixture(database, admin.profileId);
          const finished = await finishReadFixture(database, fixture);

          for (const permission of [
            null,
            "work_orders.finish",
            "work_orders.edit_draft",
          ] as const) {
            await setOnlyRelevantPermission(database, actor, admin.profileId, permission);
            await actAs(database, actor);
            await expectRejected(
              database,
              () => readDetail(database, finished.workOrderId),
              "42501",
            );
            await database.query("reset role");
          }

          await setOnlyRelevantPermission(
            database,
            fixture.actors.inactive,
            admin.profileId,
            "work_orders.view",
          );
          await actAs(database, fixture.actors.inactive);
          await expectRejected(
            database,
            () => readMaterials(database, finished.workOrderId),
            "42501",
          );
          await database.query("reset role");

          await database.query(
            "select pg_catalog.set_config('request.jwt.claim.sub', '', true)",
          );
          await database.query("set local role anon");
          await expectRejected(
            database,
            () => readMovements(database, finished.workOrderId),
            "42501",
          );
          await database.query("reset role");

          await actAs(database, admin);
          for (const read of [readDetail, readMaterials, readMovements]) {
            await expectRejected(database, () => read(database, null), "22023");
            await expectRejected(database, () => read(database, randomUUID()), "P0002");
            await expectRejected(database, () => read(database, draft.workOrderId), "WOR10");
          }
          await database.query("reset role");
        });
      });

      it("is STABLE SECURITY DEFINER with empty search_path and authenticated-only EXECUTE", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const rows = (await database.query<{
            name: string;
            proconfig: string[];
            prosecdef: boolean;
            provolatile: string;
            public_execute: boolean;
            anon_execute: boolean;
            authenticated_execute: boolean;
          }>(
            `select
               procedure.proname as name,
               procedure.proconfig,
               procedure.prosecdef,
               procedure.provolatile,
               pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE') as public_execute,
               pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE') as anon_execute,
               pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as authenticated_execute
             from pg_catalog.pg_proc as procedure
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'public'
               and procedure.proname = any($1::text[])
             order by procedure.proname`,
            [[
              "get_finished_work_order_detail",
              "list_finished_work_order_materials",
              "list_finished_work_order_movements",
            ]],
          )).rows;
          expect(rows).toHaveLength(3);
          for (const row of rows) {
            expect(row).toMatchObject({
              anon_execute: false,
              authenticated_execute: true,
              proconfig: ["search_path=\"\""],
              prosecdef: true,
              provolatile: "s",
              public_execute: false,
            });
          }
        });
      });
    },
  );
}
