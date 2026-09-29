import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { expectPermissionDenied } from "./helpers/assertions";
import { createTestSerialNumber } from "./helpers/serial";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

interface WorkOrderRow {
  customer_name_snapshot: string | null;
  description: string | null;
  finished_at: Date | null;
  finished_by_user_id: string | null;
  id: string;
  project_id: string | null;
  status: "draft" | "finished";
  work_order_number: string;
}

interface CreatedDraftWorkOrderRow {
  work_order_id: string;
  work_order_number: string;
}

interface WorkOrderListRow {
  created_at: Date;
  customer_name_snapshot: string | null;
  project_id: string | null;
  project_name: string | null;
  status: "draft" | "finished";
  work_order_id: string;
  work_order_number: string;
}

interface WorkOrderDetailRow {
  created_at: Date;
  customer_name_snapshot: string | null;
  description: string | null;
  project_id: string | null;
  project_name: string | null;
  status: "draft" | "finished";
  updated_at: Date;
  work_order_id: string;
  work_order_number: string;
}

interface WorkOrderProjectChoiceRow {
  customer_name: string;
  name: string;
  project_id: string;
  status: "in_progress" | "on_hold" | "planned";
}

interface UpdatedDraftWorkOrderRow {
  updated_at: string;
  work_order_id: string;
}

interface ResolvedWorkOrderProductRow {
  name: string;
  product_id: string;
  serial_number: string;
}

interface WorkOrderMaterialInventoryRow {
  current_inventory: string;
  product_id: string;
}

interface SavedDraftWorkOrderRow {
  updated_at: string;
  work_order_id: string;
}

interface DraftWorkOrderMaterialRow {
  current_inventory: string;
  product_id: string;
  product_name: string;
  quantity: string;
  serial_number: string;
}

interface DeletedDraftWorkOrderRow {
  work_order_id: string;
  work_order_number: string;
}

async function actAs(
  database: PoolClient,
  actor: SecurityActor,
  role: "authenticated" | "anon" = "authenticated",
): Promise<void> {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor.authUserId],
  );
  await database.query(`set local role ${role}`);
}

async function expectRejected(
  database: PoolClient,
  operation: () => Promise<unknown>,
  code: string,
  message?: string,
): Promise<void> {
  await database.query("savepoint rejected_work_order_operation");
  await expect(operation()).rejects.toMatchObject(
    message ? { code, message } : { code },
  );
  await database.query("rollback to savepoint rejected_work_order_operation");
}

async function createProject(
  database: PoolClient,
  actorId: string,
): Promise<string> {
  const id = randomUUID();
  await database.query(
    `insert into public.projects (
       id, name, customer_name, start_date, delivery_date,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, $3::text, '2026-09-21'::date,
       '2026-09-30'::date, $4::uuid, $4::uuid
     )`,
    [id, `Work Order Project ${id}`, `Customer ${id}`, actorId],
  );
  return id;
}

async function createWorkOrderReadProject(
  database: PoolClient,
  values: {
    actorId: string;
    customerName: string;
    name: string;
    status: "cancelled" | "completed" | "in_progress" | "on_hold" | "planned";
  },
): Promise<string> {
  const id = randomUUID();
  await database.query(
    `insert into public.projects (
       id, name, customer_name, status, start_date, delivery_date,
       created_by_user_id, updated_by_user_id, completed_at, cancelled_at
     ) values (
       $1::uuid, $2::text, $3::text, $4::text, '2026-09-21'::date,
       '2026-09-30'::date, $5::uuid, $5::uuid,
       $6::timestamptz, $7::timestamptz
     )`,
    [
      id,
      values.name,
      values.customerName,
      values.status,
      values.actorId,
      values.status === "completed" ? "2026-09-30T12:00:00Z" : null,
      values.status === "cancelled" ? "2026-09-25T12:00:00Z" : null,
    ],
  );
  return id;
}

async function createWorkOrderItemProduct(
  database: PoolClient,
  actorId: string,
): Promise<string> {
  const id = randomUUID();
  await database.query(
    `insert into public.products (
       id, serial_number, name, category, product_kind,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, $3::text, 'Work Order', 'component',
       $4::uuid, $4::uuid
     )`,
    [id, createTestSerialNumber(), `Work Order Product ${id}`, actorId],
  );
  return id;
}

async function findUnusedWorkOrderYear(
  database: PoolClient,
): Promise<number> {
  const year = (await database.query<{ business_year: number }>(
    `select candidate.business_year
     from pg_catalog.generate_series(6000, 8999) as candidate(business_year)
     where not exists (
       select 1
       from public.work_order_number_counters as counter
       where counter.business_year = candidate.business_year
     )
       and not exists (
         select 1
         from public.work_orders as work_order
         where work_order.work_order_number like
           'RN-' || candidate.business_year::text || '-%'
       )
     order by candidate.business_year
     limit 1`,
  )).rows[0]?.business_year;
  if (!year) {
    throw new Error("No isolated Work Order fixture year is available");
  }
  return year;
}

async function findUnusedLeadingZeroProductSerial(
  database: PoolClient,
): Promise<string> {
  const serialNumber = (await database.query<{ serial_number: string }>(
    `select pg_catalog.lpad(candidate::text, 7, '0') as serial_number
     from pg_catalog.generate_series(1, 999999) as candidate
     where not exists (
       select 1 from public.products as product
       where product.serial_number = pg_catalog.lpad(candidate::text, 7, '0')
     )
     order by candidate
     limit 1`,
  )).rows[0]?.serial_number;
  if (!serialNumber) {
    throw new Error("No unused leading-zero Product Serial Number is available");
  }
  return serialNumber;
}

async function findMissingProductSerial(
  database: PoolClient,
): Promise<string> {
  const serialNumber = (await database.query<{ serial_number: string }>(
    `select candidate::text as serial_number
     from pg_catalog.generate_series(9999999, 1000000, -1) as candidate
     where not exists (
       select 1 from public.products as product
       where product.serial_number = candidate::text
     )
     limit 1`,
  )).rows[0]?.serial_number;
  if (!serialNumber) {
    throw new Error("No missing Product Serial Number is available");
  }
  return serialNumber;
}

async function insertWorkOrder(
  database: PoolClient,
  values: {
    actorId: string;
    number: string;
    projectId: string;
    status?: "draft" | "finished";
  },
): Promise<string> {
  const id = randomUUID();
  const finished = values.status === "finished";
  await database.query(
    `insert into public.work_orders (
       id, work_order_number, project_id, customer_name_snapshot,
       description, status, created_by_user_id, updated_by_user_id,
       finished_at, finished_by_user_id
     ) values (
       $1::uuid, $2::text, $3::uuid, 'Snapshot Customer',
       'Assembly work', $4::text, $5::uuid, $5::uuid,
       $6::timestamptz, $7::uuid
     )`,
    [
      id,
      values.number,
      values.projectId,
      values.status ?? "draft",
      values.actorId,
      finished ? "2026-09-21T12:00:00Z" : null,
      finished ? values.actorId : null,
    ],
  );
  return id;
}

async function createDraftWorkOrder(
  database: PoolClient,
): Promise<CreatedDraftWorkOrderRow> {
  return (await database.query<CreatedDraftWorkOrderRow>(
    `select work_order_id, work_order_number
     from public.create_draft_work_order()`,
  )).rows[0]!;
}

async function listWorkOrders(
  database: PoolClient,
): Promise<WorkOrderListRow[]> {
  return (await database.query<WorkOrderListRow>(
    "select * from public.list_work_orders()",
  )).rows;
}

async function getWorkOrderDetail(
  database: PoolClient,
  workOrderId: string | null,
): Promise<WorkOrderDetailRow[]> {
  return (await database.query<WorkOrderDetailRow>(
    "select * from public.get_work_order_detail($1::uuid)",
    [workOrderId],
  )).rows;
}

async function listWorkOrderProjectChoices(
  database: PoolClient,
): Promise<WorkOrderProjectChoiceRow[]> {
  return (await database.query<WorkOrderProjectChoiceRow>(
    "select * from public.list_work_order_project_choices()",
  )).rows;
}

async function updateDraftWorkOrder(
  database: PoolClient,
  values: {
    description: string | null;
    expectedUpdatedAt: string | null;
    projectId: string | null;
    workOrderId: string | null;
  },
): Promise<UpdatedDraftWorkOrderRow> {
  return (await database.query<UpdatedDraftWorkOrderRow>(
    `select updated.work_order_id, updated.updated_at::text as updated_at
     from public.update_draft_work_order(
       $1::uuid, $2::uuid, $3::text, $4::timestamptz
     ) as updated`,
    [
      values.workOrderId,
      values.projectId,
      values.description,
      values.expectedUpdatedAt,
    ],
  )).rows[0]!;
}

async function resolveWorkOrderProductBarcode(
  database: PoolClient,
  workOrderId: string | null,
  serialNumber: string | null,
): Promise<ResolvedWorkOrderProductRow[]> {
  return (await database.query<ResolvedWorkOrderProductRow>(
    `select product_id, serial_number, name
     from public.resolve_work_order_product_barcode($1::uuid, $2::text)`,
    [workOrderId, serialNumber],
  )).rows;
}

async function getWorkOrderMaterialInventory(
  database: PoolClient,
  workOrderId: string | null,
  productId: string | null,
): Promise<WorkOrderMaterialInventoryRow[]> {
  return (await database.query<WorkOrderMaterialInventoryRow>(
    `select product_id, current_inventory
     from public.get_work_order_material_inventory($1::uuid, $2::uuid)`,
    [workOrderId, productId],
  )).rows;
}

async function saveDraftWorkOrder(
  database: PoolClient,
  values: {
    description: string | null;
    expectedUpdatedAt: string | null;
    items: unknown;
    projectId: string | null;
    workOrderId: string | null;
  },
): Promise<SavedDraftWorkOrderRow> {
  return (await database.query<SavedDraftWorkOrderRow>(
    `select saved.work_order_id, saved.updated_at::text as updated_at
     from public.save_draft_work_order(
       $1::uuid, $2::uuid, $3::text, $4::jsonb, $5::timestamptz
     ) as saved`,
    [
      values.workOrderId,
      values.projectId,
      values.description,
      values.items === null ? null : JSON.stringify(values.items),
      values.expectedUpdatedAt,
    ],
  )).rows[0]!;
}

async function listDraftWorkOrderMaterials(
  database: PoolClient,
  workOrderId: string | null,
): Promise<DraftWorkOrderMaterialRow[]> {
  return (await database.query<DraftWorkOrderMaterialRow>(
    `select product_id, serial_number, product_name,
            quantity::text as quantity,
            current_inventory::text as current_inventory
     from public.list_draft_work_order_materials($1::uuid)`,
    [workOrderId],
  )).rows;
}

async function deleteDraftWorkOrder(
  database: PoolClient,
  workOrderId: string | null,
  expectedUpdatedAt: string | null,
): Promise<DeletedDraftWorkOrderRow> {
  return (await database.query<DeletedDraftWorkOrderRow>(
    `select deleted.work_order_id, deleted.work_order_number
     from public.delete_draft_work_order($1::uuid, $2::timestamptz) as deleted`,
    [workOrderId, expectedUpdatedAt],
  )).rows[0]!;
}

async function setOnlyWorkOrderPermission(
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
       and definition.key like 'work_orders.%'`,
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

export function registerWorkOrderSchemaTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe.skipIf(process.env.TASK101_MIGRATION !== "1")(
    "Task 101 WorkOrder schema and status protection (requires deployed migration)",
    () => {
      it("enforces the canonical schema, foreign keys, constraints, and no side effects", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const projectId = await createProject(database, actorId);
          const before = (await database.query<{
            audits: string; balances: string; movements: string;
          }>(
            `select
               (select count(*)::text from public.audit_logs) as audits,
               (select count(*)::text from public.inventory_balances) as balances,
               (select count(*)::text from public.inventory_movements) as movements`,
          )).rows[0];

          const fixtureYear = await findUnusedWorkOrderYear(database);
          const firstNumber = `RN-${fixtureYear}-0001`;

          const firstId = await insertWorkOrder(database, {
            actorId, number: firstNumber, projectId,
          });
          const secondId = await insertWorkOrder(database, {
            actorId, number: `RN-${fixtureYear}-0002`, projectId,
          });
          const finishedId = await insertWorkOrder(database, {
            actorId,
            number: `RN-${fixtureYear}-0003`,
            projectId,
            status: "finished",
          });
          const rows = (await database.query<WorkOrderRow>(
            `select id, work_order_number, project_id, customer_name_snapshot,
                    description, status, finished_at, finished_by_user_id
             from public.work_orders
             where id = any($1::uuid[])
             order by work_order_number`,
            [[firstId, secondId, finishedId]],
          )).rows;
          expect(rows).toHaveLength(3);
          expect(rows.filter((row) => row.project_id === projectId)).toHaveLength(3);
          expect(rows.find((row) => row.id === firstId)).toMatchObject({
            finished_at: null,
            finished_by_user_id: null,
            status: "draft",
          });
          expect(rows.find((row) => row.id === finishedId)).toMatchObject({
            finished_at: expect.any(Date),
            finished_by_user_id: actorId,
            status: "finished",
          });

          const malformedNumbers = [
            "", "RN-2026-001", "RN-2026-00001", "RN-26-0001",
            "rn-2026-0001", "RN-202A-0001", "RN-2026-00A1",
            " RN-2026-0004", "RN-2026-0004 ", "RN-2026-0004\n",
          ];
          for (const number of malformedNumbers) {
            await expectRejected(
              database,
              () => insertWorkOrder(database, { actorId, number, projectId }),
              "23514",
            );
          }
          await expectRejected(
            database,
            () => insertWorkOrder(database, {
              actorId, number: firstNumber, projectId,
            }),
            "23505",
          );

          const invalidRows: ReadonlyArray<{
            customer: string;
            description: string;
            finishedAt: string | null;
            finishedBy: string | null;
            label: string;
            status: string;
          }> = [
            { label: "blank_customer", customer: " ", description: "Work", status: "draft", finishedAt: null, finishedBy: null },
            { label: "untrimmed_customer", customer: " Customer ", description: "Work", status: "draft", finishedAt: null, finishedBy: null },
            { label: "blank_description", customer: "Customer", description: " ", status: "draft", finishedAt: null, finishedBy: null },
            { label: "untrimmed_description", customer: "Customer", description: " Work ", status: "draft", finishedAt: null, finishedBy: null },
            { label: "invalid_status", customer: "Customer", description: "Work", status: "cancelled", finishedAt: null, finishedBy: null },
            { label: "draft_with_at", customer: "Customer", description: "Work", status: "draft", finishedAt: "2026-09-21T12:00:00Z", finishedBy: null },
            { label: "draft_with_actor", customer: "Customer", description: "Work", status: "draft", finishedAt: null, finishedBy: actorId },
            { label: "draft_with_finish_metadata", customer: "Customer", description: "Work", status: "draft", finishedAt: "2026-09-21T12:00:00Z", finishedBy: actorId },
            { label: "finished_without_metadata", customer: "Customer", description: "Work", status: "finished", finishedAt: null, finishedBy: null },
            { label: "finished_without_actor", customer: "Customer", description: "Work", status: "finished", finishedAt: "2026-09-21T12:00:00Z", finishedBy: null },
            { label: "finished_without_at", customer: "Customer", description: "Work", status: "finished", finishedAt: null, finishedBy: actorId },
          ];
          for (const invalid of invalidRows) {
            await expectRejected(database, () => database.query(
              `insert into public.work_orders (
                 work_order_number, project_id, customer_name_snapshot,
                 description, status, created_by_user_id, updated_by_user_id,
                 finished_at, finished_by_user_id
               ) values (
                 $1::text, $2::uuid, $3::text, $4::text, $5::text,
                 $6::uuid, $6::uuid, $7::timestamptz, $8::uuid
               )`,
              [
                `RN-2027-${String(invalidRows.indexOf(invalid) + 1).padStart(4, "0")}`,
                projectId, invalid.customer, invalid.description, invalid.status,
                actorId, invalid.finishedAt, invalid.finishedBy,
              ],
            ), "23514");
          }
          await expectRejected(
            database,
            () => insertWorkOrder(database, {
              actorId, number: "RN-2028-0001", projectId: randomUUID(),
            }),
            "23503",
          );

          const columns = (await database.query<{
            character_maximum_length: number | null;
            column_default: string | null;
            column_name: string;
            data_type: string;
            is_nullable: string;
          }>(
            `select column_name, data_type, is_nullable, column_default,
                    character_maximum_length
             from information_schema.columns
             where table_schema = 'public' and table_name = 'work_orders'
             order by ordinal_position`,
          )).rows;
          expect(columns.map((column) => column.column_name)).toEqual([
            "id", "work_order_number", "project_id", "customer_name_snapshot",
            "description", "status", "created_at", "created_by_user_id",
            "updated_at", "updated_by_user_id", "finished_at",
            "finished_by_user_id",
          ]);
          expect(columns.find((column) => column.column_name === "project_id"))
            .toMatchObject({
              data_type: "uuid",
              is_nullable: process.env.TASK103_MIGRATION === "1" ? "YES" : "NO",
            });
          expect(columns.find((column) => column.column_name === "status"))
            .toMatchObject({ column_default: "'draft'::text", is_nullable: "NO" });
          expect(columns.find((column) => column.column_name === "description"))
            .toMatchObject({ character_maximum_length: null, data_type: "text" });

          const foreignKeys = (await database.query<{
            constraint_name: string; delete_rule: string;
          }>(
            `select rc.constraint_name, rc.delete_rule
             from information_schema.referential_constraints as rc
             where rc.constraint_schema = 'public'
               and rc.constraint_name like 'work_orders_%_fkey'
             order by rc.constraint_name`,
          )).rows;
          expect(foreignKeys).toEqual([
            { constraint_name: "work_orders_created_by_user_id_fkey", delete_rule: "RESTRICT" },
            { constraint_name: "work_orders_finished_by_user_id_fkey", delete_rule: "RESTRICT" },
            { constraint_name: "work_orders_project_id_fkey", delete_rule: "RESTRICT" },
            { constraint_name: "work_orders_updated_by_user_id_fkey", delete_rule: "RESTRICT" },
          ]);
          const projectUnique = await database.query<{ count: number }>(
            `select count(*)::integer as count
             from pg_catalog.pg_constraint as pc
             join pg_catalog.pg_class as class on class.oid = pc.conrelid
             join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
             where namespace.nspname = 'public' and class.relname = 'work_orders'
               and pc.contype in ('p', 'u')
               and pg_catalog.pg_get_constraintdef(pc.oid) like '%(project_id)%'`,
          );
          expect(projectUnique.rows).toEqual([{ count: 0 }]);
          const indexes = (await database.query<{ indexname: string }>(
            `select indexname
             from pg_catalog.pg_indexes
             where schemaname = 'public' and tablename = 'work_orders'
             order by indexname`,
          )).rows.map((row) => row.indexname);
          expect(indexes).toEqual([
            "work_orders_pkey",
            "work_orders_project_id_idx",
            "work_orders_status_idx",
            "work_orders_work_order_number_key",
          ]);
          expect((await database.query(
            `select
               (select count(*)::text from public.audit_logs) as audits,
               (select count(*)::text from public.inventory_balances) as balances,
               (select count(*)::text from public.inventory_movements) as movements`,
          )).rows[0]).toEqual(before);
        });
      });

      it("allows Draft maintenance but locks the number and every Finished mutation", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const projectId = await createProject(database, actorId);
          const draftId = await insertWorkOrder(database, {
            actorId, number: "RN-2030-0001", projectId,
          });
          const deletableDraftId = await insertWorkOrder(database, {
            actorId, number: "RN-2030-0002", projectId,
          });

          await database.query(
            `update public.work_orders
             set description = 'Updated Draft work', updated_by_user_id = $1::uuid,
                 updated_at = '2026-09-21T13:00:00Z'::timestamptz
             where id = $2::uuid`,
            [actorId, draftId],
          );
          await expectRejected(database, () => database.query(
            "update public.work_orders set work_order_number = 'RN-2030-0099' where id = $1",
            [draftId],
          ), "WOR01");
          await database.query(
            `update public.work_orders
             set status = 'finished', finished_at = '2026-09-21T14:00:00Z',
                 finished_by_user_id = $1::uuid, updated_at = '2026-09-21T14:00:00Z',
                 updated_by_user_id = $1::uuid
             where id = $2::uuid`,
            [actorId, draftId],
          );
          expect((await database.query<WorkOrderRow>(
            `select id, work_order_number, project_id, customer_name_snapshot,
                    description, status, finished_at, finished_by_user_id
             from public.work_orders where id = $1`,
            [draftId],
          )).rows[0]).toMatchObject({
            description: "Updated Draft work",
            finished_at: expect.any(Date),
            finished_by_user_id: actorId,
            status: "finished",
            work_order_number: "RN-2030-0001",
          });
          await expectRejected(database, () => database.query(
            "update public.work_orders set description = description where id = $1", [draftId],
          ), "WOR02");
          await expectRejected(database, () => database.query(
            `update public.work_orders
             set status = 'draft', finished_at = null, finished_by_user_id = null
             where id = $1`,
            [draftId],
          ), "WOR02");
          await expectRejected(database, () => database.query(
            "delete from public.work_orders where id = $1", [draftId],
          ), "WOR02");
          await database.query(
            "delete from public.work_orders where id = $1", [deletableDraftId],
          );
          expect((await database.query<{ count: string }>(
            "select count(*) from public.work_orders where id = $1", [deletableDraftId],
          )).rows[0]?.count).toBe("0");
        });
      });

      it("limits reads to Work Order viewers and denies every direct client write", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const projectId = await createProject(database, actorId);
          const workOrderIds = [
            await insertWorkOrder(database, {
              actorId, number: "RN-2031-0001", projectId,
            }),
            await insertWorkOrder(database, {
              actorId, number: "RN-2031-0002", projectId, status: "finished",
            }),
          ];

          await actAs(database, fixture.actors.admin);
          expect((await database.query<{ id: string }>(
            "select id from public.work_orders where id = any($1::uuid[])",
            [workOrderIds],
          )).rows).toHaveLength(2);
          await database.query("reset role");

          const delegated = fixture.actors.unpermitted;
          for (const permissionKey of [
            "work_orders.view",
            "work_orders.create",
            "work_orders.edit_draft",
            "work_orders.finish",
            "work_orders.delete_draft",
            null,
          ] as const) {
            await setOnlyWorkOrderPermission(
              database, delegated, actorId, permissionKey,
            );
            await actAs(database, delegated);
            const visible = (await database.query<{ id: string }>(
              "select id from public.work_orders where id = any($1::uuid[])",
              [workOrderIds],
            )).rows;
            await database.query("reset role");
            expect(visible).toHaveLength(permissionKey === "work_orders.view" ? 2 : 0);
          }

          await setOnlyWorkOrderPermission(
            database, fixture.actors.inactive, actorId, "work_orders.view",
          );
          await actAs(database, fixture.actors.inactive);
          expect((await database.query(
            "select id from public.work_orders where id = any($1::uuid[])",
            [workOrderIds],
          )).rows).toEqual([]);
          await database.query("reset role");

          await actAs(database, fixture.actors.admin);
          await expectRejected(database, () => database.query(
            `insert into public.work_orders (
               work_order_number, project_id, customer_name_snapshot,
               description, created_by_user_id, updated_by_user_id
             ) values ('RN-2031-0003', $1, 'Customer', 'Work', $2, $2)`,
            [projectId, actorId],
          ), "42501");
          await expectRejected(database, () => database.query(
            "update public.work_orders set description = 'Forbidden' where id = $1",
            [workOrderIds[0]],
          ), "42501");
          await expectRejected(database, () => database.query(
            "delete from public.work_orders where id = $1", [workOrderIds[0]],
          ), "42501");
          await database.query("reset role");

          const security = (await database.query<{
            authenticated_delete: boolean;
            authenticated_insert: boolean;
            authenticated_select: boolean;
            authenticated_update: boolean;
            policy_expression: string;
            row_security: boolean;
          }>(
            `select
               class.relrowsecurity as row_security,
               pg_catalog.has_table_privilege('authenticated', class.oid, 'select')
                 as authenticated_select,
               pg_catalog.has_table_privilege('authenticated', class.oid, 'insert')
                 as authenticated_insert,
               pg_catalog.has_table_privilege('authenticated', class.oid, 'update')
                 as authenticated_update,
               pg_catalog.has_table_privilege('authenticated', class.oid, 'delete')
                 as authenticated_delete,
               pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
                 as policy_expression
             from pg_catalog.pg_class as class
             join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
             join pg_catalog.pg_policy as policy on policy.polrelid = class.oid
               and policy.polname = 'work_orders_select_authorized'
             where namespace.nspname = 'public' and class.relname = 'work_orders'`,
          )).rows;
          expect(security).toHaveLength(1);
          expect(security[0]).toMatchObject({
            authenticated_delete: false,
            authenticated_insert: false,
            authenticated_select: true,
            authenticated_update: false,
            row_security: true,
          });
          expect(security[0]?.policy_expression).toContain("current_user_is_admin()");
          expect(security[0]?.policy_expression)
            .toContain("has_permission('work_orders.view'::text)");

          const helperSecurity = (await database.query<{
            authenticated_execute: boolean; public_execute: boolean;
            security_definer: boolean; settings: string[];
          }>(
            `select routine.prosecdef as security_definer,
                    routine.proconfig as settings,
                    pg_catalog.has_function_privilege(
                      'authenticated', routine.oid, 'execute'
                    ) as authenticated_execute,
                    exists (
                      select 1 from pg_catalog.aclexplode(routine.proacl) as privilege
                      where privilege.grantee = 0
                        and privilege.privilege_type = 'EXECUTE'
                    ) as public_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
             where namespace.nspname = 'public'
               and routine.proname = 'enforce_work_order_lifecycle'`,
          )).rows;
          expect(helperSecurity).toEqual([{
            authenticated_execute: false,
            public_execute: false,
            security_definer: false,
            settings: ['search_path=""'],
          }]);

          const prematureObjects = (await database.query<{ count: number }>(
            `select ((
               select count(*)
               from pg_catalog.pg_proc as routine
               join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
               where namespace.nspname = 'public'
                 and routine.proname = any($1::text[])
             ) + (
               select count(*)
               from information_schema.sequences
               where sequence_schema = 'public'
                 and sequence_name like '%work_order%'
             ))::integer as count`,
            [[
              "create_work_order", "update_work_order",
              "finish_work_order",
            ]],
          )).rows;
          expect(prematureObjects).toEqual([{ count: 0 }]);
        });

        const anonymousRead = await fixture.anonymousClient
          .from("work_orders").select("id").limit(1);
        expectPermissionDenied(anonymousRead.error);
      });
    },
  );

  describe.skipIf(process.env.TASK102_MIGRATION !== "1")(
    "Task 102 yearly Work Order number allocator (requires deployed migration)",
    () => {
      it("derives the business year in Europe/Sarajevo and allocates sequentially", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const domainBefore = (await database.query<{
            audits: string;
            balances: string;
            movements: string;
            projects: string;
            work_orders: string;
          }>(
            `select
               (select count(*)::text from public.audit_logs) as audits,
               (select count(*)::text from public.inventory_balances) as balances,
               (select count(*)::text from public.inventory_movements) as movements,
               (select count(*)::text from public.projects) as projects,
               (select count(*)::text from public.work_orders) as work_orders`,
          )).rows[0];
          const boundary = (await database.query<{
            after_boundary: number;
            before_boundary: number;
          }>(
            `select
               pg_catalog.date_part(
                 'year',
                 pg_catalog.timezone(
                   'Europe/Sarajevo',
                   '2025-12-31 22:59:59+00'::timestamptz
                 )
               )::integer as before_boundary,
               pg_catalog.date_part(
                 'year',
                 pg_catalog.timezone(
                   'Europe/Sarajevo',
                   '2025-12-31 23:00:00+00'::timestamptz
                 )
               )::integer as after_boundary`,
          )).rows[0];
          expect(boundary).toEqual({
            after_boundary: 2026,
            before_boundary: 2025,
          });

          const businessYear = (await database.query<{ business_year: number }>(
            `select pg_catalog.date_part(
               'year',
               pg_catalog.timezone(
                 'Europe/Sarajevo',
                 pg_catalog.clock_timestamp()
               )
             )::integer as business_year`,
          )).rows[0]!.business_year;
          await database.query(
            "delete from public.work_order_number_counters where business_year = $1",
            [businessYear],
          );

          const allocations = (await database.query<{ number: string }>(
            `select public.allocate_work_order_number() as number
             from pg_catalog.generate_series(1, 3)`,
          )).rows.map((row) => row.number);
          expect(allocations).toEqual([
            `RN-${businessYear}-0001`,
            `RN-${businessYear}-0002`,
            `RN-${businessYear}-0003`,
          ]);
          expect((await database.query<{ last_value: number }>(
            `select last_value
             from public.work_order_number_counters
             where business_year = $1`,
            [businessYear],
          )).rows).toEqual([{ last_value: 3 }]);

          const definition = (await database.query<{ definition: string }>(
            `select pg_catalog.pg_get_functiondef(
               'public.allocate_work_order_number()'::pg_catalog.regprocedure
             ) as definition`,
          )).rows[0]!.definition;
          expect(definition).toContain("Europe/Sarajevo");
          expect(definition).toContain("clock_timestamp()");
          expect(definition).toContain("timezone(");
          expect((await database.query(
            `select
               (select count(*)::text from public.audit_logs) as audits,
               (select count(*)::text from public.inventory_balances) as balances,
               (select count(*)::text from public.inventory_movements) as movements,
               (select count(*)::text from public.projects) as projects,
               (select count(*)::text from public.work_orders) as work_orders`,
          )).rows[0]).toEqual(domainBefore);
        });
      });

      it("keeps yearly counters independent and fails safely after 9999", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const firstYear = 8111;
          const secondYear = 8112;
          await database.query(
            `delete from public.work_order_number_counters
             where business_year = any($1::integer[])`,
            [[firstYear, secondYear]],
          );

          const first = (await database.query<{ number: string }>(
            "select public.allocate_work_order_number_for_year($1) as number",
            [firstYear],
          )).rows[0]!.number;
          const second = (await database.query<{ number: string }>(
            "select public.allocate_work_order_number_for_year($1) as number",
            [firstYear],
          )).rows[0]!.number;
          const independent = (await database.query<{ number: string }>(
            "select public.allocate_work_order_number_for_year($1) as number",
            [secondYear],
          )).rows[0]!.number;
          expect([first, second, independent]).toEqual([
            "RN-8111-0001",
            "RN-8111-0002",
            "RN-8112-0001",
          ]);

          await database.query(
            `update public.work_order_number_counters
             set last_value = 9998
             where business_year = $1`,
            [firstYear],
          );
          expect((await database.query<{ number: string }>(
            "select public.allocate_work_order_number_for_year($1) as number",
            [firstYear],
          )).rows).toEqual([{ number: "RN-8111-9999" }]);
          await expectRejected(
            database,
            () => database.query(
              "select public.allocate_work_order_number_for_year($1)",
              [firstYear],
            ),
            "WOR03",
          );
          expect((await database.query<{ last_value: number }>(
            `select last_value
             from public.work_order_number_counters
             where business_year = $1`,
            [firstYear],
          )).rows).toEqual([{ last_value: 9999 }]);
        });
      });

      it("allocates unique same-year numbers through concurrent connections", async () => {
        const fixture = requireHarness();
        await fixture.withDatabaseClients(4, async (clients) => {
          const coordinator = clients[0]!;
          const isolatedYear = (await coordinator.query<{ business_year: number }>(
            `select candidate.business_year
             from pg_catalog.generate_series(6000, 8999) as candidate(business_year)
             where not exists (
               select 1
               from public.work_order_number_counters as counter
               where counter.business_year = candidate.business_year
             )
               and not exists (
                 select 1
                 from public.work_orders as work_order
                 where work_order.work_order_number like
                   'RN-' || candidate.business_year::text || '-%'
               )
             order by candidate.business_year
             limit 1`,
          )).rows[0]?.business_year;
          if (!isolatedYear) {
            throw new Error("No isolated Work Order counter year is available");
          }

          try {
            const allocations = await Promise.all(clients.map(async (database) => {
              return (await database.query<{ number: string }>(
                "select public.allocate_work_order_number_for_year($1) as number",
                [isolatedYear],
              )).rows[0]!.number;
            }));
            expect(new Set(allocations).size).toBe(allocations.length);
            expect(allocations.every((number) =>
              new RegExp(`^RN-${isolatedYear}-[0-9]{4}$`).test(number),
            )).toBe(true);
            expect(allocations.map((number) => number.slice(-4)).sort()).toEqual([
              "0001", "0002", "0003", "0004",
            ]);
            expect((await coordinator.query<{ last_value: number }>(
              `select last_value
               from public.work_order_number_counters
               where business_year = $1`,
              [isolatedYear],
            )).rows).toEqual([{ last_value: allocations.length }]);
          } finally {
            await coordinator.query(
              `delete from public.work_order_number_counters
               where business_year = $1
                 and not exists (
                   select 1
                   from public.work_orders as work_order
                   where work_order.work_order_number like
                     'RN-' || $1::integer::text || '-%'
                 )`,
              [isolatedYear],
            );
          }
        });
      });

      it("does not reclaim an allocated Work Order number after Draft deletion", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const projectId = await createProject(database, actorId);
          const businessYear = 8333;
          await database.query(
            "delete from public.work_order_number_counters where business_year = $1",
            [businessYear],
          );
          const first = (await database.query<{ number: string }>(
            "select public.allocate_work_order_number_for_year($1) as number",
            [businessYear],
          )).rows[0]!.number;
          const draftId = await insertWorkOrder(database, {
            actorId,
            number: first,
            projectId,
          });
          await database.query(
            "delete from public.work_orders where id = $1::uuid",
            [draftId],
          );
          const second = (await database.query<{ number: string }>(
            "select public.allocate_work_order_number_for_year($1) as number",
            [businessYear],
          )).rows[0]!.number;
          expect(first).toBe("RN-8333-0001");
          expect(second).toBe("RN-8333-0002");
        });
      });

      it("keeps allocator and counter storage unavailable to browser roles", async () => {
        const fixture = requireHarness();
        for (const client of [
          fixture.anonymousClient,
          fixture.actors.admin.client,
          fixture.actors.unpermitted.client,
        ]) {
          expectPermissionDenied(
            (await client.rpc("allocate_work_order_number")).error,
          );
          expectPermissionDenied((await client.rpc(
            "allocate_work_order_number_for_year",
            { p_business_year: 2026 },
          )).error);
          expectPermissionDenied((await client
            .from("work_order_number_counters")
            .insert({ business_year: 2026, last_value: 1 })).error);
          expectPermissionDenied((await client
            .from("work_order_number_counters")
            .update({ last_value: 1 })
            .eq("business_year", 2026)).error);
          expectPermissionDenied((await client
            .from("work_order_number_counters")
            .delete()
            .eq("business_year", 2026)).error);
        }

        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const functions = (await database.query<{
            anonymous_execute: boolean;
            authenticated_execute: boolean;
            name: string;
            security_definer: boolean;
            settings: string[];
          }>(
            `select
               routine.proname as name,
               routine.prosecdef as security_definer,
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
               and routine.proname = any($1::text[])
             order by routine.proname`,
            [[
              "allocate_work_order_number",
              "allocate_work_order_number_for_year",
            ]],
          )).rows;
          expect(functions).toEqual([
            {
              anonymous_execute: false,
              authenticated_execute: false,
              name: "allocate_work_order_number",
              security_definer: true,
              settings: ['search_path=""'],
            },
            {
              anonymous_execute: false,
              authenticated_execute: false,
              name: "allocate_work_order_number_for_year",
              security_definer: true,
              settings: ['search_path=""'],
            },
          ]);

          expect((await database.query<{
            anonymous_delete: boolean;
            anonymous_insert: boolean;
            anonymous_select: boolean;
            anonymous_update: boolean;
            authenticated_delete: boolean;
            authenticated_insert: boolean;
            authenticated_select: boolean;
            authenticated_update: boolean;
            row_security: boolean;
          }>(
            `select
               class.relrowsecurity as row_security,
               pg_catalog.has_table_privilege(
                 'authenticated', class.oid, 'select'
               ) as authenticated_select,
               pg_catalog.has_table_privilege(
                 'authenticated', class.oid, 'insert'
               ) as authenticated_insert,
               pg_catalog.has_table_privilege(
                 'authenticated', class.oid, 'update'
               ) as authenticated_update,
               pg_catalog.has_table_privilege(
                 'authenticated', class.oid, 'delete'
               ) as authenticated_delete,
               pg_catalog.has_table_privilege(
                 'anon', class.oid, 'select'
               ) as anonymous_select,
               pg_catalog.has_table_privilege(
                 'anon', class.oid, 'insert'
               ) as anonymous_insert,
               pg_catalog.has_table_privilege(
                 'anon', class.oid, 'update'
               ) as anonymous_update,
               pg_catalog.has_table_privilege(
                 'anon', class.oid, 'delete'
               ) as anonymous_delete
             from pg_catalog.pg_class as class
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = class.relnamespace
             where namespace.nspname = 'public'
               and class.relname = 'work_order_number_counters'`,
          )).rows).toEqual([{
            anonymous_delete: false,
            anonymous_insert: false,
            anonymous_select: false,
            anonymous_update: false,
            authenticated_delete: false,
            authenticated_insert: false,
            authenticated_select: false,
            authenticated_update: false,
            row_security: true,
          }]);
        });
      });
    },
  );

  describe.skipIf(process.env.TASK103_MIGRATION !== "1")(
    "Task 103 trusted Draft Work Order creation (requires deployed migration)",
    () => {
      it("creates numbered incomplete Drafts with server-owned metadata and one audit each", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const sideEffectsBefore = (await database.query<{
            balances: string;
            movements: string;
            projects: string;
          }>(
            `select
               (select count(*)::text from public.inventory_balances) as balances,
               (select count(*)::text from public.inventory_movements) as movements,
               (select count(*)::text from public.projects) as projects`,
          )).rows[0]!;

          await actAs(database, actor);
          const first = await createDraftWorkOrder(database);
          const second = await createDraftWorkOrder(database);
          await database.query("reset role");

          expect(first.work_order_id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          );
          expect(first.work_order_number).toMatch(/^RN-[0-9]{4}-[0-9]{4}$/);
          expect(second.work_order_number).toMatch(/^RN-[0-9]{4}-[0-9]{4}$/);
          expect(second.work_order_number).not.toBe(first.work_order_number);

          const rows = (await database.query<{
            created_at: Date;
            created_by_user_id: string;
            customer_name_snapshot: string | null;
            description: string | null;
            finished_at: Date | null;
            finished_by_user_id: string | null;
            id: string;
            project_id: string | null;
            status: string;
            updated_at: Date;
            updated_by_user_id: string;
            work_order_number: string;
          }>(
            `select id, work_order_number, project_id, customer_name_snapshot,
                    description, status, created_at, created_by_user_id,
                    updated_at, updated_by_user_id, finished_at,
                    finished_by_user_id
             from public.work_orders
             where id = any($1::uuid[])
             order by work_order_number`,
            [[first.work_order_id, second.work_order_id]],
          )).rows;
          expect(rows).toHaveLength(2);
          for (const row of rows) {
            expect(row).toMatchObject({
              created_by_user_id: actor.profileId,
              customer_name_snapshot: null,
              description: null,
              finished_at: null,
              finished_by_user_id: null,
              project_id: null,
              status: "draft",
              updated_by_user_id: actor.profileId,
            });
            expect(row.created_at.getTime()).toBe(row.updated_at.getTime());
          }

          const audits = (await database.query<{
            action_type: string;
            actor_user_id: string;
            after_data: Record<string, unknown>;
            entity_id: string;
            entity_type: string;
          }>(
            `select action_type, actor_user_id, entity_type, entity_id, after_data
             from public.audit_logs
             where entity_type = 'work_order'
               and entity_id = any($1::uuid[])
             order by after_data ->> 'work_order_number'`,
            [[first.work_order_id, second.work_order_id]],
          )).rows;
          expect(audits).toHaveLength(2);
          for (const audit of audits) {
            const created = rows.find((row) => row.id === audit.entity_id)!;
            expect(audit).toMatchObject({
              action_type: "work_order.created",
              actor_user_id: actor.profileId,
              entity_type: "work_order",
            });
            expect(audit.after_data).toEqual({
              status: "draft",
              work_order_id: created.id,
              work_order_number: created.work_order_number,
            });
          }

          expect((await database.query(
            `select
               (select count(*)::text from public.inventory_balances) as balances,
               (select count(*)::text from public.inventory_movements) as movements,
               (select count(*)::text from public.projects) as projects`,
          )).rows[0]).toEqual(sideEffectsBefore);
        });
      });

      it("allows only active Admin or work_orders.create", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const delegated = fixture.actors.unpermitted;
          const before = (await database.query<{ audits: string; work_orders: string }>(
            `select
               (select count(*)::text from public.audit_logs
                where entity_type = 'work_order') as audits,
               (select count(*)::text from public.work_orders) as work_orders`,
          )).rows[0]!;

          for (const permissionKey of [
            null,
            "work_orders.view",
            "work_orders.edit_draft",
            "work_orders.finish",
            "work_orders.delete_draft",
          ] as const) {
            await setOnlyWorkOrderPermission(
              database,
              delegated,
              actorId,
              permissionKey,
            );
            await actAs(database, delegated);
            await expectRejected(
              database,
              () => createDraftWorkOrder(database),
              "42501",
            );
            await database.query("reset role");
          }

          await actAs(database, fixture.actors.brandManager);
          await expectRejected(
            database,
            () => createDraftWorkOrder(database),
            "42501",
          );
          await database.query("reset role");

          await setOnlyWorkOrderPermission(
            database,
            fixture.actors.inactive,
            actorId,
            "work_orders.create",
          );
          await actAs(database, fixture.actors.inactive);
          await expectRejected(
            database,
            () => createDraftWorkOrder(database),
            "42501",
          );
          await database.query("reset role");

          expect((await database.query(
            `select
               (select count(*)::text from public.audit_logs
                where entity_type = 'work_order') as audits,
               (select count(*)::text from public.work_orders) as work_orders`,
          )).rows[0]).toEqual(before);

          await actAs(database, fixture.actors.admin);
          const adminCreated = await createDraftWorkOrder(database);
          await database.query("reset role");
          expect(adminCreated.work_order_number).toMatch(/^RN-[0-9]{4}-[0-9]{4}$/);

          await setOnlyWorkOrderPermission(
            database,
            delegated,
            actorId,
            "work_orders.create",
          );
          await actAs(database, delegated);
          const created = await createDraftWorkOrder(database);
          await database.query("reset role");
          expect(created.work_order_number).toMatch(/^RN-[0-9]{4}-[0-9]{4}$/);
          expect((await database.query<{ created_by_user_id: string }>(
            `select created_by_user_id from public.work_orders
             where id = $1::uuid`,
            [created.work_order_id],
          )).rows).toEqual([{ created_by_user_id: delegated.profileId }]);
        });

        const anonymous = await fixture.anonymousClient.rpc(
          "create_draft_work_order",
        );
        expectPermissionDenied(anonymous.error);
      });

      it("allows incomplete Drafts but requires complete, normalized Finished content", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const projectId = await createProject(database, actor.profileId);
          const draftId = randomUUID();
          await database.query(
            `insert into public.work_orders (
               id, work_order_number, created_by_user_id, updated_by_user_id
             ) values ($1::uuid, 'RN-8000-0001', $2::uuid, $2::uuid)`,
            [draftId, actor.profileId],
          );
          expect((await database.query(
            `select project_id, customer_name_snapshot, description, status
             from public.work_orders where id = $1::uuid`,
            [draftId],
          )).rows).toEqual([{
            customer_name_snapshot: null,
            description: null,
            project_id: null,
            status: "draft",
          }]);

          for (const [number, customer, description] of [
            ["RN-8000-0002", " ", null],
            ["RN-8000-0003", " Customer ", null],
            ["RN-8000-0004", null, " "],
            ["RN-8000-0005", null, " Work "],
          ] as const) {
            await expectRejected(
              database,
              () => database.query(
                `insert into public.work_orders (
                   work_order_number, customer_name_snapshot, description,
                   created_by_user_id, updated_by_user_id
                 ) values ($1::text, $2::text, $3::text, $4::uuid, $4::uuid)`,
                [number, customer, description, actor.profileId],
              ),
              "23514",
            );
          }

          for (const [number, missingField] of [
            ["RN-8000-0006", "project"],
            ["RN-8000-0007", "customer"],
            ["RN-8000-0008", "description"],
          ] as const) {
            await expectRejected(
              database,
              () => database.query(
                `insert into public.work_orders (
                   work_order_number, project_id, customer_name_snapshot,
                   description, status, created_by_user_id, updated_by_user_id,
                   finished_at, finished_by_user_id
                 ) values (
                   $1::text,
                   case when $2::text = 'project' then null else $3::uuid end,
                   case when $2::text = 'customer' then null else 'Customer' end,
                   case when $2::text = 'description' then null else 'Work' end,
                   'finished', $4::uuid, $4::uuid,
                   pg_catalog.clock_timestamp(), $4::uuid
                 )`,
                [number, missingField, projectId, actor.profileId],
              ),
              "23514",
            );
          }

          const validFinishedId = await insertWorkOrder(database, {
            actorId: actor.profileId,
            number: "RN-8000-0009",
            projectId,
            status: "finished",
          });
          expect((await database.query<{ status: string }>(
            "select status from public.work_orders where id = $1::uuid",
            [validFinishedId],
          )).rows).toEqual([{ status: "finished" }]);

          const columns = (await database.query<{
            column_name: string;
            is_nullable: string;
          }>(
            `select column_name, is_nullable
             from information_schema.columns
             where table_schema = 'public'
               and table_name = 'work_orders'
               and column_name in (
                 'project_id', 'customer_name_snapshot', 'description'
               )
             order by column_name`,
          )).rows;
          expect(columns).toEqual([
            { column_name: "customer_name_snapshot", is_nullable: "YES" },
            { column_name: "description", is_nullable: "YES" },
            { column_name: "project_id", is_nullable: "YES" },
          ]);
          expect((await database.query<{ definition: string }>(
            `select pg_catalog.pg_get_constraintdef(pc.oid) as definition
             from pg_catalog.pg_constraint as pc
             join pg_catalog.pg_class as relation on relation.oid = pc.conrelid
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = relation.relnamespace
             where namespace.nspname = 'public'
               and relation.relname = 'work_orders'
               and pc.conname = 'work_orders_finished_content_complete'`,
          )).rows).toHaveLength(1);
        });
      });

      it("rolls back allocation and audit if the Draft insert fails", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const projectId = await createProject(database, actor.profileId);
          const businessYear = (await database.query<{ business_year: number }>(
            `select pg_catalog.date_part(
               'year',
               pg_catalog.timezone(
                 'Europe/Sarajevo',
                 pg_catalog.clock_timestamp()
               )
             )::integer as business_year`,
          )).rows[0]!.business_year;
          await database.query(
            "delete from public.work_order_number_counters where business_year = $1",
            [businessYear],
          );
          const conflictingNumber = `RN-${businessYear}-0001`;
          const conflictExists = (await database.query<{ exists: boolean }>(
            `select exists (
               select 1
               from public.work_orders
               where work_order_number = $1::text
             ) as exists`,
            [conflictingNumber],
          )).rows[0]!.exists;
          if (!conflictExists) {
            await insertWorkOrder(database, {
              actorId: actor.profileId,
              number: conflictingNumber,
              projectId,
            });
          }
          const auditBefore = (await database.query<{ count: string }>(
            `select count(*) from public.audit_logs
             where entity_type = 'work_order'`,
          )).rows[0]!.count;

          await actAs(database, actor);
          await expectRejected(
            database,
            () => createDraftWorkOrder(database),
            "23505",
          );
          await database.query("reset role");

          expect((await database.query(
            `select business_year, last_value
             from public.work_order_number_counters
             where business_year = $1`,
            [businessYear],
          )).rows).toEqual([]);
          expect((await database.query<{ count: string }>(
            `select count(*) from public.audit_logs
             where entity_type = 'work_order'`,
          )).rows[0]!.count).toBe(auditBefore);
          expect((await database.query<{ count: string }>(
            `select count(*) from public.work_orders
             where work_order_number = $1::text`,
            [conflictingNumber],
          )).rows).toEqual([{ count: "1" }]);
        });
      });

      it("exposes only the trusted authenticated RPC and preserves direct-write denial", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const rpc = (await database.query<{
            arguments: string;
            anonymous_execute: boolean;
            authenticated_execute: boolean;
            public_execute: boolean;
            result: string;
            security_definer: boolean;
            settings: string[];
          }>(
            `select
               pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
               pg_catalog.pg_get_function_result(routine.oid) as result,
               routine.prosecdef as security_definer,
               routine.proconfig as settings,
               exists (
                 select 1
                 from pg_catalog.aclexplode(routine.proacl) as privilege
                 where privilege.grantee = 0
                   and privilege.privilege_type = 'EXECUTE'
               ) as public_execute,
               pg_catalog.has_function_privilege(
                 'anon', routine.oid, 'execute'
               ) as anonymous_execute,
               pg_catalog.has_function_privilege(
                 'authenticated', routine.oid, 'execute'
               ) as authenticated_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             where namespace.nspname = 'public'
               and routine.proname = 'create_draft_work_order'`,
          )).rows;
          expect(rpc).toEqual([{
            anonymous_execute: false,
            arguments: "",
            authenticated_execute: true,
            public_execute: false,
            result: "TABLE(work_order_id uuid, work_order_number text)",
            security_definer: true,
            settings: ['search_path=""'],
          }]);

          await actAs(database, fixture.actors.admin);
          await expectRejected(
            database,
            () => database.query(
              `insert into public.work_orders (
                 work_order_number, created_by_user_id, updated_by_user_id
               ) values (
                 'RN-9000-0001', $1::uuid, $1::uuid
               )`,
              [fixture.actors.admin.profileId],
            ),
            "42501",
          );
          await expectRejected(
            database,
            () => database.query(
              `update public.work_order_items
               set quantity = quantity where work_order_id = $1::uuid`,
              [randomUUID()],
            ),
            "42501",
          );
          await expectRejected(
            database,
            () => database.query(
              `delete from public.work_order_items
               where work_order_id = $1::uuid`,
              [randomUUID()],
            ),
            "42501",
          );
          await database.query("reset role");
        });

        expectPermissionDenied((await fixture.actors.admin.client.rpc(
          "allocate_work_order_number",
        )).error);
      });

      it.todo(
        "proves committed concurrent authorized Draft creation on a disposable database",
      );
    },
  );

  describe.skipIf(process.env.TASK104A_MIGRATION !== "1")(
    "Task 104A trusted Work Order list read boundary (requires deployed migration)",
    () => {
      it("returns the exact list projection, incomplete Drafts, historical Projects, and deterministic ordering", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const projectId = "00000000-0000-4000-8000-000000008100";
          const incompleteId = "00000000-0000-4000-8000-000000008101";
          const populatedId = "00000000-0000-4000-8000-000000008102";
          const finishedId = "00000000-0000-4000-8000-000000008103";

          await database.query(
            `insert into public.projects (
               id, name, customer_name, status, start_date, delivery_date,
               completed_at, created_by_user_id, updated_by_user_id
             ) values (
               $1::uuid, 'Historical Project', 'Project Customer', 'completed',
               '2026-09-01'::date, '2026-09-20'::date,
               '2026-09-20T12:00:00Z'::timestamptz, $2::uuid, $2::uuid
             )`,
            [projectId, actor.profileId],
          );
          await database.query(
            `insert into public.work_orders (
               id, work_order_number, project_id, customer_name_snapshot,
               description, status, created_at, created_by_user_id,
               updated_at, updated_by_user_id, finished_at,
               finished_by_user_id
             ) values
               (
                 $1::uuid, 'RN-8100-0001', null, null, null, 'draft',
                 '2026-09-21T09:00:00Z'::timestamptz, $4::uuid,
                 '2026-09-21T09:00:00Z'::timestamptz, $4::uuid, null, null
               ),
               (
                 $2::uuid, 'RN-8100-0002', $5::uuid, 'Snapshot Customer',
                 'Draft work', 'draft',
                 '2026-09-21T10:00:00Z'::timestamptz, $4::uuid,
                 '2026-09-21T10:00:00Z'::timestamptz, $4::uuid, null, null
               ),
               (
                 $3::uuid, 'RN-8100-0003', $5::uuid, 'Snapshot Customer',
                 'Finished work', 'finished',
                 '2026-09-21T10:00:00Z'::timestamptz, $4::uuid,
                 '2026-09-21T11:00:00Z'::timestamptz, $4::uuid,
                 '2026-09-21T11:00:00Z'::timestamptz, $4::uuid
               )`,
            [
              incompleteId,
              populatedId,
              finishedId,
              actor.profileId,
              projectId,
            ],
          );
          const sideEffectsBefore = (await database.query<{
            audits: string;
            balances: string;
            movements: string;
          }>(
            `select
               (select count(*)::text from public.audit_logs) as audits,
               (select count(*)::text from public.inventory_balances) as balances,
               (select count(*)::text from public.inventory_movements) as movements`,
          )).rows[0]!;

          await actAs(database, actor);
          const rows = await listWorkOrders(database);
          await database.query("reset role");

          const fixtureRows = rows.filter((row) => [
            incompleteId,
            populatedId,
            finishedId,
          ].includes(row.work_order_id));
          expect(fixtureRows.map((row) => row.work_order_id)).toEqual([
            finishedId,
            populatedId,
            incompleteId,
          ]);
          expect(Object.keys(fixtureRows[0]!)).toEqual([
            "work_order_id",
            "work_order_number",
            "status",
            "project_id",
            "project_name",
            "customer_name_snapshot",
            "created_at",
          ]);
          expect(fixtureRows[0]).toMatchObject({
            customer_name_snapshot: "Snapshot Customer",
            project_id: projectId,
            project_name: "Historical Project",
            status: "finished",
            work_order_id: finishedId,
            work_order_number: "RN-8100-0003",
          });
          expect(fixtureRows[0]!.created_at.toISOString())
            .toBe("2026-09-21T10:00:00.000Z");
          expect(fixtureRows[2]).toMatchObject({
            customer_name_snapshot: null,
            project_id: null,
            project_name: null,
            status: "draft",
            work_order_id: incompleteId,
            work_order_number: "RN-8100-0001",
          });
          expect((await database.query(
            `select
               (select count(*)::text from public.audit_logs) as audits,
               (select count(*)::text from public.inventory_balances) as balances,
               (select count(*)::text from public.inventory_movements) as movements`,
          )).rows[0]).toEqual(sideEffectsBefore);
        });
      });

      it("lets work_orders.view resolve Project name without granting Project reads", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.unpermitted;
          const adminId = fixture.actors.admin.profileId;
          const projectId = await createProject(database, adminId);
          const workOrderId = await insertWorkOrder(database, {
            actorId: adminId,
            number: "RN-8101-0001",
            projectId,
          });
          const projectName = (await database.query<{ name: string }>(
            "select name from public.projects where id = $1::uuid",
            [projectId],
          )).rows[0]!.name;
          await setOnlyWorkOrderPermission(
            database,
            actor,
            adminId,
            "work_orders.view",
          );

          await actAs(database, actor);
          expect((await database.query<{ allowed: boolean }>(
            "select public.has_permission('projects.view') as allowed",
          )).rows).toEqual([{ allowed: false }]);
          expect((await database.query(
            "select id from public.projects where id = $1::uuid",
            [projectId],
          )).rows).toEqual([]);
          const rows = await listWorkOrders(database);
          await database.query("reset role");

          expect(rows.find((row) => row.work_order_id === workOrderId))
            .toMatchObject({
              project_id: projectId,
              project_name: projectName,
              work_order_id: workOrderId,
            });
        });
      });

      it("denies callers without active work_orders.view authority", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const delegated = fixture.actors.unpermitted;

          for (const permissionKey of [
            null,
            "work_orders.create",
            "work_orders.edit_draft",
            "work_orders.finish",
            "work_orders.delete_draft",
          ] as const) {
            await setOnlyWorkOrderPermission(
              database,
              delegated,
              actorId,
              permissionKey,
            );
            await actAs(database, delegated);
            await expectRejected(
              database,
              () => listWorkOrders(database),
              "42501",
            );
            await database.query("reset role");
          }

          await setOnlyWorkOrderPermission(
            database,
            fixture.actors.inactive,
            actorId,
            "work_orders.view",
          );
          await actAs(database, fixture.actors.inactive);
          await expectRejected(
            database,
            () => listWorkOrders(database),
            "42501",
          );
          await database.query("reset role");
        });

        expectPermissionDenied((await fixture.anonymousClient.rpc(
          "list_work_orders",
        )).error);
      });

      it("uses the hardened authenticated-only read contract without changing table RLS", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const rpc = (await database.query<{
            anonymous_execute: boolean;
            arguments: string;
            authenticated_execute: boolean;
            language: string;
            public_execute: boolean;
            result: string;
            security_definer: boolean;
            settings: string[];
            volatility: string;
          }>(
            `select
               pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
               pg_catalog.pg_get_function_result(routine.oid) as result,
               language.lanname as language,
               routine.provolatile as volatility,
               routine.prosecdef as security_definer,
               routine.proconfig as settings,
               exists (
                 select 1
                 from pg_catalog.aclexplode(routine.proacl) as privilege
                 where privilege.grantee = 0
                   and privilege.privilege_type = 'EXECUTE'
               ) as public_execute,
               pg_catalog.has_function_privilege(
                 'anon', routine.oid, 'execute'
               ) as anonymous_execute,
               pg_catalog.has_function_privilege(
                 'authenticated', routine.oid, 'execute'
               ) as authenticated_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             join pg_catalog.pg_language as language
               on language.oid = routine.prolang
             where namespace.nspname = 'public'
               and routine.proname = 'list_work_orders'`,
          )).rows;
          expect(rpc).toEqual([{
            anonymous_execute: false,
            arguments: "",
            authenticated_execute: true,
            language: "plpgsql",
            public_execute: false,
            result: "TABLE(work_order_id uuid, work_order_number text, status text, project_id uuid, project_name text, customer_name_snapshot text, created_at timestamp with time zone)",
            security_definer: true,
            settings: ['search_path=""'],
            volatility: "s",
          }]);

          const policies = (await database.query<{
            policy_expression: string;
            policy_name: string;
          }>(
            `select policy.polname as policy_name,
                    pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
                      as policy_expression
             from pg_catalog.pg_policy as policy
             join pg_catalog.pg_class as relation
               on relation.oid = policy.polrelid
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = relation.relnamespace
             where namespace.nspname = 'public'
               and relation.relname in ('projects', 'work_orders')
             order by relation.relname, policy.polname`,
          )).rows;
          expect(policies).toEqual([
            {
              policy_expression: "(current_user_is_admin() OR has_permission('projects.view'::text))",
              policy_name: "projects_select_authorized",
            },
            {
              policy_expression: "(current_user_is_admin() OR has_permission('work_orders.view'::text))",
              policy_name: "work_orders_select_authorized",
            },
          ]);
        });
      });
    },
  );

  describe.skipIf(process.env.TASK106_MIGRATION !== "1")(
    "Task 106 WorkOrderItem schema and parent-state protection (requires deployed migration)",
    () => {
      it("creates the canonical schema, constraints, foreign keys, and justified indexes", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const columns = (await database.query<{
            column_default: string | null;
            column_name: string;
            data_type: string;
            is_nullable: "NO" | "YES";
          }>(
            `select column_name, data_type, is_nullable, column_default
             from information_schema.columns
             where table_schema = 'public'
               and table_name = 'work_order_items'
             order by ordinal_position`,
          )).rows;
          expect(columns).toEqual([
            {
              column_default: "gen_random_uuid()",
              column_name: "id",
              data_type: "uuid",
              is_nullable: "NO",
            },
            {
              column_default: null,
              column_name: "work_order_id",
              data_type: "uuid",
              is_nullable: "NO",
            },
            {
              column_default: null,
              column_name: "product_id",
              data_type: "uuid",
              is_nullable: "NO",
            },
            {
              column_default: null,
              column_name: "quantity",
              data_type: "bigint",
              is_nullable: "NO",
            },
            {
              column_default: "now()",
              column_name: "added_at",
              data_type: "timestamp with time zone",
              is_nullable: "NO",
            },
            {
              column_default: null,
              column_name: "added_by_user_id",
              data_type: "uuid",
              is_nullable: "NO",
            },
          ]);

          const foreignKeys = (await database.query<{
            constraint_name: string;
            delete_action: string;
            target_table: string;
          }>(
            `select constraint_row.conname as constraint_name,
                    target.relname as target_table,
                    case constraint_row.confdeltype
                      when 'r' then 'RESTRICT'
                      else constraint_row.confdeltype::text
                    end as delete_action
             from pg_catalog.pg_constraint as constraint_row
             join pg_catalog.pg_class as source
               on source.oid = constraint_row.conrelid
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = source.relnamespace
             join pg_catalog.pg_class as target
               on target.oid = constraint_row.confrelid
             where namespace.nspname = 'public'
               and source.relname = 'work_order_items'
               and constraint_row.contype = 'f'
             order by constraint_row.conname`,
          )).rows;
          expect(foreignKeys).toEqual([
            {
              constraint_name: "work_order_items_added_by_user_id_fkey",
              delete_action: "RESTRICT",
              target_table: "user_profiles",
            },
            {
              constraint_name: "work_order_items_product_id_fkey",
              delete_action: "RESTRICT",
              target_table: "products",
            },
            {
              constraint_name: "work_order_items_work_order_id_fkey",
              delete_action: "RESTRICT",
              target_table: "work_orders",
            },
          ]);

          const constraints = (await database.query<{
            definition: string;
            name: string;
            type: string;
          }>(
            `select constraint_row.conname as name,
                    constraint_row.contype as type,
                    pg_catalog.pg_get_constraintdef(constraint_row.oid) as definition
             from pg_catalog.pg_constraint as constraint_row
             join pg_catalog.pg_class as relation
               on relation.oid = constraint_row.conrelid
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = relation.relnamespace
             where namespace.nspname = 'public'
               and relation.relname = 'work_order_items'
               and constraint_row.contype in ('c', 'u')
             order by constraint_row.conname`,
          )).rows;
          expect(constraints).toEqual([
            {
              definition: "CHECK ((quantity > 0))",
              name: "work_order_items_quantity_positive",
              type: "c",
            },
            {
              definition: "UNIQUE (work_order_id, product_id)",
              name: "work_order_items_work_order_product_key",
              type: "u",
            },
          ]);
          expect((await database.query<{ index_name: string }>(
            `select indexname as index_name
             from pg_catalog.pg_indexes
             where schemaname = 'public'
               and tablename = 'work_order_items'
             order by indexname`,
          )).rows).toEqual([
            { index_name: "work_order_items_pkey" },
            { index_name: "work_order_items_product_id_idx" },
            { index_name: "work_order_items_work_order_product_key" },
          ]);

          const actorId = fixture.actors.admin.profileId;
          const projectId = await createProject(database, actorId);
          const workOrderId = await insertWorkOrder(database, {
            actorId,
            number: "RN-8200-0001",
            projectId,
          });
          const productId = await createWorkOrderItemProduct(database, actorId);
          const inserted = (await database.query<{
            added_at: Date;
            id: string;
            quantity: string;
          }>(
            `insert into public.work_order_items (
               work_order_id, product_id, quantity, added_by_user_id
             ) values ($1, $2, 1, $3)
             returning id, quantity, added_at`,
            [workOrderId, productId, actorId],
          )).rows[0]!;
          expect(inserted).toMatchObject({
            added_at: expect.any(Date),
            id: expect.any(String),
            quantity: "1",
          });
          await expectRejected(
            database,
            () => database.query(
              `insert into public.work_order_items
                 (work_order_id, product_id, quantity, added_by_user_id)
               values ($1, $2, 1, $3)`,
              [workOrderId, productId, actorId],
            ),
            "23505",
          );
          for (const quantity of [0, -1]) {
            const anotherProductId = await createWorkOrderItemProduct(database, actorId);
            await expectRejected(
              database,
              () => database.query(
                `insert into public.work_order_items
                   (work_order_id, product_id, quantity, added_by_user_id)
                 values ($1, $2, $3, $4)`,
                [workOrderId, anotherProductId, quantity, actorId],
              ),
              "23514",
            );
          }
        });
      });

      it("allows trusted Draft item changes without domain side effects", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const projectId = await createProject(database, actorId);
          const workOrderId = await insertWorkOrder(database, {
            actorId,
            number: "RN-8201-0001",
            projectId,
          });
          const productId = await createWorkOrderItemProduct(database, actorId);
          const before = (await database.query<{
            audits: string;
            balance_quantity: string;
            movements: string;
            project: Record<string, unknown>;
            project_components: string;
            project_products: string;
            work_order_status: string;
          }>(
            `select
               (select count(*)::text from public.audit_logs) as audits,
               (select quantity::text from public.inventory_balances
                where product_id = $1) as balance_quantity,
               (select count(*)::text from public.inventory_movements) as movements,
               (select pg_catalog.to_jsonb(project) from public.projects as project
                where project.id = $2) as project,
               (select count(*)::text from public.project_product_components
                where project_product_id in (
                  select id from public.project_products where project_id = $2
                )) as project_components,
               (select count(*)::text from public.project_products
                where project_id = $2) as project_products,
               (select status from public.work_orders where id = $3) as work_order_status`,
            [productId, projectId, workOrderId],
          )).rows[0]!;

          const itemId = (await database.query<{ id: string }>(
            `insert into public.work_order_items
               (work_order_id, product_id, quantity, added_by_user_id)
             values ($1, $2, 2, $3)
             returning id`,
            [workOrderId, productId, actorId],
          )).rows[0]!.id;
          expect((await database.query<{ quantity: string }>(
            `update public.work_order_items
             set quantity = 3
             where id = $1
             returning quantity`,
            [itemId],
          )).rows).toEqual([{ quantity: "3" }]);
          expect((await database.query(
            "delete from public.work_order_items where id = $1 returning id",
            [itemId],
          )).rowCount).toBe(1);

          const after = (await database.query(
            `select
               (select count(*)::text from public.audit_logs) as audits,
               (select quantity::text from public.inventory_balances
                where product_id = $1) as balance_quantity,
               (select count(*)::text from public.inventory_movements) as movements,
               (select pg_catalog.to_jsonb(project) from public.projects as project
                where project.id = $2) as project,
               (select count(*)::text from public.project_product_components
                where project_product_id in (
                  select id from public.project_products where project_id = $2
                )) as project_components,
               (select count(*)::text from public.project_products
                where project_id = $2) as project_products,
               (select status from public.work_orders where id = $3) as work_order_status`,
            [productId, projectId, workOrderId],
          )).rows[0];
          expect(after).toEqual(before);
        });
      });

      it("rejects every item mutation involving a Finished Work Order with WOR04", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const projectId = await createProject(database, actorId);
          const draftId = await insertWorkOrder(database, {
            actorId,
            number: "RN-8202-0001",
            projectId,
          });
          const finishedId = await insertWorkOrder(database, {
            actorId,
            number: "RN-8202-0002",
            projectId,
          });
          const firstProductId = await createWorkOrderItemProduct(database, actorId);
          const secondProductId = await createWorkOrderItemProduct(database, actorId);
          const itemId = (await database.query<{ id: string }>(
            `insert into public.work_order_items
               (work_order_id, product_id, quantity, added_by_user_id)
             values ($1, $2, 1, $3)
             returning id`,
            [finishedId, firstProductId, actorId],
          )).rows[0]!.id;
          await database.query(
            `update public.work_orders
             set status = 'finished',
                 finished_at = pg_catalog.now(),
                 finished_by_user_id = $2,
                 updated_at = pg_catalog.now(),
                 updated_by_user_id = $2
             where id = $1`,
            [finishedId, actorId],
          );

          for (const operation of [
            () => database.query(
              `insert into public.work_order_items
                 (work_order_id, product_id, quantity, added_by_user_id)
               values ($1, $2, 1, $3)`,
              [finishedId, secondProductId, actorId],
            ),
            () => database.query(
              "update public.work_order_items set quantity = 2 where id = $1",
              [itemId],
            ),
            () => database.query(
              "delete from public.work_order_items where id = $1",
              [itemId],
            ),
            () => database.query(
              "update public.work_order_items set work_order_id = $2 where id = $1",
              [itemId, draftId],
            ),
          ]) {
            await expectRejected(
              database,
              operation,
              "WOR04",
              "Finished Work Order items are immutable",
            );
          }

          const draftItemId = (await database.query<{ id: string }>(
            `insert into public.work_order_items
               (work_order_id, product_id, quantity, added_by_user_id)
             values ($1, $2, 1, $3)
             returning id`,
            [draftId, secondProductId, actorId],
          )).rows[0]!.id;
          await expectRejected(
            database,
            () => database.query(
              "update public.work_order_items set work_order_id = $2 where id = $1",
              [draftItemId, finishedId],
            ),
            "WOR04",
            "Finished Work Order items are immutable",
          );
          expect((await database.query<{ work_order_id: string }>(
            "select work_order_id from public.work_order_items where id = $1",
            [draftItemId],
          )).rows).toEqual([{ work_order_id: draftId }]);
        });
      });

      it("enforces the read boundary, direct-write denial, and hardened trigger contract", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const projectId = await createProject(database, actorId);
          const workOrderId = await insertWorkOrder(database, {
            actorId,
            number: "RN-8203-0001",
            projectId,
          });
          const productId = await createWorkOrderItemProduct(database, actorId);
          const itemId = (await database.query<{ id: string }>(
            `insert into public.work_order_items
               (work_order_id, product_id, quantity, added_by_user_id)
             values ($1, $2, 1, $3)
             returning id`,
            [workOrderId, productId, actorId],
          )).rows[0]!.id;

          await actAs(database, fixture.actors.admin);
          expect((await database.query(
            "select id from public.work_order_items where id = $1",
            [itemId],
          )).rows).toEqual([{ id: itemId }]);
          await database.query("reset role");

          await setOnlyWorkOrderPermission(
            database,
            fixture.actors.unpermitted,
            actorId,
            "work_orders.view",
          );
          await actAs(database, fixture.actors.unpermitted);
          expect((await database.query<{
            inventory_view: boolean;
            projects_view: boolean;
          }>(
            `select public.has_permission('inventory.view') as inventory_view,
                    public.has_permission('projects.view') as projects_view`,
          )).rows).toEqual([{
            inventory_view: false,
            projects_view: false,
          }]);
          expect((await database.query(
            "select id from public.work_order_items where id = $1",
            [itemId],
          )).rows).toEqual([{ id: itemId }]);
          await database.query("reset role");

          for (const [actor, permission] of [
            [fixture.actors.productCreator, null],
            [fixture.actors.supplierCreator, "inventory.view"],
            [fixture.actors.inactive, "work_orders.view"],
          ] as const) {
            await setOnlyWorkOrderPermission(database, actor, actorId, permission);
            await actAs(database, actor);
            expect((await database.query(
              "select id from public.work_order_items where id = $1",
              [itemId],
            )).rows).toEqual([]);
            await database.query("reset role");
          }

          const tableSecurity = (await database.query<{
            authenticated_delete: boolean;
            authenticated_insert: boolean;
            authenticated_select: boolean;
            authenticated_update: boolean;
            policy_expression: string;
            row_security: boolean;
          }>(
            `select relation.relrowsecurity as row_security,
                    pg_catalog.has_table_privilege(
                      'authenticated', relation.oid, 'select'
                    ) as authenticated_select,
                    pg_catalog.has_table_privilege(
                      'authenticated', relation.oid, 'insert'
                    ) as authenticated_insert,
                    pg_catalog.has_table_privilege(
                      'authenticated', relation.oid, 'update'
                    ) as authenticated_update,
                    pg_catalog.has_table_privilege(
                      'authenticated', relation.oid, 'delete'
                    ) as authenticated_delete,
                    pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
                      as policy_expression
             from pg_catalog.pg_class as relation
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = relation.relnamespace
             join pg_catalog.pg_policy as policy
               on policy.polrelid = relation.oid
             where namespace.nspname = 'public'
               and relation.relname = 'work_order_items'
               and policy.polname = 'work_order_items_select_authorized'`,
          )).rows;
          expect(tableSecurity).toEqual([{
            authenticated_delete: false,
            authenticated_insert: false,
            authenticated_select: true,
            authenticated_update: false,
            policy_expression: "(current_user_is_admin() OR has_permission('work_orders.view'::text))",
            row_security: true,
          }]);

          const helper = (await database.query<{
            anon_execute: boolean;
            authenticated_execute: boolean;
            public_execute: boolean;
            security_definer: boolean;
            settings: string[];
            volatility: string;
          }>(
            `select routine.prosecdef as security_definer,
                    routine.proconfig as settings,
                    routine.provolatile as volatility,
                    pg_catalog.has_function_privilege(
                      'anon', routine.oid, 'execute'
                    ) as anon_execute,
                    pg_catalog.has_function_privilege(
                      'authenticated', routine.oid, 'execute'
                    ) as authenticated_execute,
                    exists (
                      select 1
                      from pg_catalog.aclexplode(routine.proacl) as privilege
                      where privilege.grantee = 0
                        and privilege.privilege_type = 'EXECUTE'
                    ) as public_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             where namespace.nspname = 'public'
               and routine.proname = 'enforce_work_order_item_parent_draft'`,
          )).rows;
          expect(helper).toEqual([{
            anon_execute: false,
            authenticated_execute: false,
            public_execute: false,
            security_definer: true,
            settings: ['search_path=""'],
            volatility: "v",
          }]);
          const triggerDefinition = (await database.query<{ definition: string }>(
            `select pg_catalog.pg_get_triggerdef(trigger.oid) as definition
             from pg_catalog.pg_trigger as trigger
             join pg_catalog.pg_class as relation
               on relation.oid = trigger.tgrelid
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = relation.relnamespace
             where namespace.nspname = 'public'
               and relation.relname = 'work_order_items'
               and trigger.tgname = 'work_order_items_enforce_parent_draft'
               and not trigger.tgisinternal`,
          )).rows[0]!.definition;
          expect(triggerDefinition).toContain("BEFORE INSERT OR DELETE OR UPDATE");
          expect(triggerDefinition).toContain("FOR EACH ROW");
        });

        expectPermissionDenied((await fixture.anonymousClient
          .from("work_order_items").select("id").limit(1)).error);
        const directInsert = await fixture.actors.admin.client
          .from("work_order_items").insert({
            added_by_user_id: fixture.actors.admin.profileId,
            product_id: randomUUID(),
            quantity: 1,
            work_order_id: randomUUID(),
          });
        expectPermissionDenied(directInsert.error);
        expectPermissionDenied((await fixture.actors.admin.client
          .from("work_order_items").update({ quantity: 2 })
          .eq("id", randomUUID())).error);
        expectPermissionDenied((await fixture.actors.admin.client
          .from("work_order_items").delete()
          .eq("id", randomUUID())).error);
      });

      it("serializes item mutation and finishing through the parent Work Order lock", async () => {
        const fixture = requireHarness();
        const actorId = fixture.actors.admin.profileId;
        const projectId = randomUUID();
        const workOrderId = randomUUID();
        const productId = randomUUID();
        const applicationName = `work-order-item-lock-${randomUUID()}`;
        await fixture.withDatabaseClients(3, async (clients) => {
          const itemWriter = clients[0];
          const finisher = clients[1];
          const observer = clients[2];
          if (!itemWriter || !finisher || !observer) {
            throw new Error("Work Order item concurrency clients unavailable");
          }
          let setupCommitted = false;
          let waitingFinish: Promise<unknown> | undefined;
          let waitingInsert: Promise<unknown> | undefined;
          const waitForLock = async (name: string) => {
            for (let attempt = 0; attempt < 100; attempt += 1) {
              const activity = await observer.query<{
                wait_event_type: string | null;
              }>(
                `select wait_event_type
                 from pg_catalog.pg_stat_activity
                 where application_name = $1`,
                [name],
              );
              if (activity.rows[0]?.wait_event_type === "Lock") return;
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
            throw new Error(`Expected PostgreSQL lock wait for ${name}`);
          };

          try {
            await observer.query("begin");
            await observer.query(
              `insert into public.projects (
                 id, name, customer_name, start_date, delivery_date,
                 created_by_user_id, updated_by_user_id
               ) values (
                 $1, 'Item concurrency Project', 'Customer', '2026-09-21',
                 '2026-09-30', $2, $2
               )`,
              [projectId, actorId],
            );
            await observer.query(
              `insert into public.products (
                 id, serial_number, name, category, product_kind,
                 created_by_user_id, updated_by_user_id
               ) values ($1, $2, 'Item concurrency Product', 'Work Order',
                 'component', $3, $3)`,
              [productId, createTestSerialNumber(), actorId],
            );
            await observer.query(
              `insert into public.work_orders (
                 id, work_order_number, project_id, customer_name_snapshot,
                 description, created_by_user_id, updated_by_user_id
               ) values ($1, 'RN-8204-0001', $2, 'Customer', 'Assembly', $3, $3)`,
              [workOrderId, projectId, actorId],
            );
            await observer.query("commit");
            setupCommitted = true;

            // Item mutation owns the parent lock; Finish must wait.
            await itemWriter.query("begin");
            await itemWriter.query(
              `insert into public.work_order_items
                 (work_order_id, product_id, quantity, added_by_user_id)
               values ($1, $2, 1, $3)`,
              [workOrderId, productId, actorId],
            );
            await finisher.query("begin");
            await finisher.query(
              "select pg_catalog.set_config('application_name', $1, true)",
              [applicationName],
            );
            waitingFinish = finisher.query(
              `update public.work_orders
               set status = 'finished', finished_at = pg_catalog.now(),
                   finished_by_user_id = $2, updated_at = pg_catalog.now(),
                   updated_by_user_id = $2
               where id = $1`,
              [workOrderId, actorId],
            );
            await waitForLock(applicationName);
            await itemWriter.query("rollback");
            await waitingFinish;
            waitingFinish = undefined;
            await finisher.query("rollback");

            // Finish owns the parent lock; item mutation must wait until the
            // status decision ends. Roll back to keep shared dev removable.
            await finisher.query("begin");
            await finisher.query(
              `update public.work_orders
               set status = 'finished', finished_at = pg_catalog.now(),
                   finished_by_user_id = $2, updated_at = pg_catalog.now(),
                   updated_by_user_id = $2
               where id = $1`,
              [workOrderId, actorId],
            );
            await itemWriter.query("begin");
            await itemWriter.query(
              "select pg_catalog.set_config('application_name', $1, true)",
              [`${applicationName}-item`],
            );
            waitingInsert = itemWriter.query(
              `insert into public.work_order_items
                 (work_order_id, product_id, quantity, added_by_user_id)
               values ($1, $2, 1, $3)`,
              [workOrderId, productId, actorId],
            );
            await waitForLock(`${applicationName}-item`);
            await finisher.query("rollback");
            await waitingInsert;
            waitingInsert = undefined;
            await itemWriter.query("rollback");
          } finally {
            if (waitingFinish) {
              await itemWriter.query("rollback");
              await waitingFinish.catch(() => undefined);
              await finisher.query("rollback");
            } else if (waitingInsert) {
              await finisher.query("rollback");
              await waitingInsert.catch(() => undefined);
              await itemWriter.query("rollback");
            } else {
              await itemWriter.query("rollback");
              await finisher.query("rollback");
            }
            if (setupCommitted) {
              await observer.query(
                "delete from public.work_order_items where work_order_id = $1",
                [workOrderId],
              );
              await observer.query("delete from public.work_orders where id = $1", [workOrderId]);
              await observer.query(
                "delete from public.inventory_balances where product_id = $1",
                [productId],
              );
              await observer.query("delete from public.products where id = $1", [productId]);
              await observer.query("delete from public.projects where id = $1", [projectId]);
            } else {
              await observer.query("rollback");
            }
          }
        });
      });

      it.todo(
        "committed Finish winning the item-mutation race requires a disposable database because Finished Work Orders are intentionally undeletable",
      );
    },
  );

  describe.skipIf(process.env.TASK107A_MIGRATION !== "1")(
    "Task 107A trusted Work Order detail and Project choices (requires deployed migration)",
    () => {
      it("returns authoritative detail including incomplete and historical Project states", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const fixtureYear = await findUnusedWorkOrderYear(database);
          const plannedProjectId = await createWorkOrderReadProject(database, {
            actorId,
            customerName: "Detail Customer",
            name: "Detail Project",
            status: "planned",
          });
          const completedProjectId = await createWorkOrderReadProject(database, {
            actorId,
            customerName: "Completed Customer",
            name: "Completed Historical Project",
            status: "completed",
          });
          const cancelledProjectId = await createWorkOrderReadProject(database, {
            actorId,
            customerName: "Cancelled Customer",
            name: "Cancelled Historical Project",
            status: "cancelled",
          });
          const populatedId = await insertWorkOrder(database, {
            actorId,
            number: `RN-${fixtureYear}-0001`,
            projectId: plannedProjectId,
          });
          const incompleteId = randomUUID();
          await database.query(
            `insert into public.work_orders (
               id, work_order_number, status,
               created_by_user_id, updated_by_user_id
             ) values ($1, $2, 'draft', $3, $3)`,
            [incompleteId, `RN-${fixtureYear}-0002`, actorId],
          );
          const completedLinkedId = await insertWorkOrder(database, {
            actorId,
            number: `RN-${fixtureYear}-0003`,
            projectId: completedProjectId,
          });
          const cancelledLinkedId = await insertWorkOrder(database, {
            actorId,
            number: `RN-${fixtureYear}-0004`,
            projectId: cancelledProjectId,
          });
          const workOrderIds = [
            populatedId,
            incompleteId,
            completedLinkedId,
            cancelledLinkedId,
          ];
          const projectIds = [
            plannedProjectId,
            completedProjectId,
            cancelledProjectId,
          ];
          const sideEffectsBefore = (await database.query(
            `select
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(work_order)
                  order by work_order.id)
                from public.work_orders as work_order
                where work_order.id = any($1::uuid[])) as work_orders,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(project)
                  order by project.id)
                from public.projects as project
                where project.id = any($2::uuid[])) as projects,
               (select count(*)::text from public.work_order_items
                where work_order_id = any($1::uuid[])) as items,
               (select count(*)::text from public.project_products
                where project_id = any($2::uuid[])) as project_products,
               (select count(*)::text from public.inventory_balances) as balances,
               (select count(*)::text from public.inventory_movements) as movements,
               (select count(*)::text from public.audit_logs) as audits`,
            [workOrderIds, projectIds],
          )).rows[0];

          await actAs(database, fixture.actors.admin);
          const populated = await getWorkOrderDetail(database, populatedId);
          expect(populated).toHaveLength(1);
          expect(Object.keys(populated[0]!)).toEqual([
            "work_order_id",
            "work_order_number",
            "status",
            "project_id",
            "project_name",
            "customer_name_snapshot",
            "description",
            "created_at",
            "updated_at",
          ]);
          expect(populated[0]).toMatchObject({
            created_at: expect.any(Date),
            customer_name_snapshot: "Snapshot Customer",
            description: "Assembly work",
            project_id: plannedProjectId,
            project_name: "Detail Project",
            status: "draft",
            updated_at: expect.any(Date),
            work_order_id: populatedId,
            work_order_number: `RN-${fixtureYear}-0001`,
          });
          expect((await getWorkOrderDetail(database, incompleteId))[0])
            .toMatchObject({
              customer_name_snapshot: null,
              description: null,
              project_id: null,
              project_name: null,
              status: "draft",
              work_order_id: incompleteId,
            });
          expect((await getWorkOrderDetail(database, completedLinkedId))[0])
            .toMatchObject({
              project_id: completedProjectId,
              project_name: "Completed Historical Project",
            });
          expect((await getWorkOrderDetail(database, cancelledLinkedId))[0])
            .toMatchObject({
              project_id: cancelledProjectId,
              project_name: "Cancelled Historical Project",
            });
          expect(await getWorkOrderDetail(database, randomUUID())).toEqual([]);
          await expectRejected(
            database,
            () => getWorkOrderDetail(database, null),
            "22023",
            "Work Order ID is required",
          );
          await database.query("reset role");

          const viewer = fixture.actors.unpermitted;
          await setOnlyWorkOrderPermission(
            database,
            viewer,
            actorId,
            "work_orders.view",
          );
          await actAs(database, viewer);
          expect((await database.query<{ projects_view: boolean }>(
            "select public.has_permission('projects.view') as projects_view",
          )).rows).toEqual([{ projects_view: false }]);
          expect((await database.query(
            "select id from public.projects where id = $1",
            [plannedProjectId],
          )).rows).toEqual([]);
          expect(await getWorkOrderDetail(database, populatedId))
            .toMatchObject([{
              project_id: plannedProjectId,
              project_name: "Detail Project",
              work_order_id: populatedId,
            }]);
          await database.query("reset role");

          const sideEffectsAfter = (await database.query(
            `select
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(work_order)
                  order by work_order.id)
                from public.work_orders as work_order
                where work_order.id = any($1::uuid[])) as work_orders,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(project)
                  order by project.id)
                from public.projects as project
                where project.id = any($2::uuid[])) as projects,
               (select count(*)::text from public.work_order_items
                where work_order_id = any($1::uuid[])) as items,
               (select count(*)::text from public.project_products
                where project_id = any($2::uuid[])) as project_products,
               (select count(*)::text from public.inventory_balances) as balances,
               (select count(*)::text from public.inventory_movements) as movements,
               (select count(*)::text from public.audit_logs) as audits`,
            [workOrderIds, projectIds],
          )).rows[0];
          expect(sideEffectsAfter).toEqual(sideEffectsBefore);
        });
      });

      it("denies Work Order detail without active view authority", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const adminId = fixture.actors.admin.profileId;
          const actor = fixture.actors.unpermitted;
          for (const permission of [
            null,
            "work_orders.create",
            "work_orders.edit_draft",
            "work_orders.finish",
            "work_orders.delete_draft",
          ] as const) {
            await setOnlyWorkOrderPermission(database, actor, adminId, permission);
            await actAs(database, actor);
            await expectRejected(
              database,
              () => getWorkOrderDetail(database, randomUUID()),
              "42501",
              "Access denied",
            );
            await database.query("reset role");
          }

          await setOnlyWorkOrderPermission(
            database,
            fixture.actors.inactive,
            adminId,
            "work_orders.view",
          );
          await actAs(database, fixture.actors.inactive);
          await expectRejected(
            database,
            () => getWorkOrderDetail(database, randomUUID()),
            "42501",
            "Access denied",
          );
          await database.query("reset role");
        });

        expectPermissionDenied((await fixture.anonymousClient.rpc(
          "get_work_order_detail",
          { p_work_order_id: randomUUID() },
        )).error);
      });

      it("returns only open Project choices to authorized Draft editors", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const openProjects = await Promise.all([
            createWorkOrderReadProject(database, {
              actorId,
              customerName: "Lower Customer",
              name: "alpha choice",
              status: "planned",
            }),
            createWorkOrderReadProject(database, {
              actorId,
              customerName: "Upper Customer",
              name: "ALPHA CHOICE",
              status: "in_progress",
            }),
            createWorkOrderReadProject(database, {
              actorId,
              customerName: "Bravo Customer",
              name: "Bravo choice",
              status: "on_hold",
            }),
          ]);
          const completedId = await createWorkOrderReadProject(database, {
            actorId,
            customerName: "Completed Customer",
            name: "Completed choice",
            status: "completed",
          });
          const cancelledId = await createWorkOrderReadProject(database, {
            actorId,
            customerName: "Cancelled Customer",
            name: "Cancelled choice",
            status: "cancelled",
          });
          const fixtureIds = [...openProjects, completedId, cancelledId];
          const sideEffectsBefore = (await database.query(
            `select
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(project)
                  order by project.id)
                from public.projects as project
                where project.id = any($1::uuid[])) as projects,
               (select count(*)::text from public.work_orders) as work_orders,
               (select count(*)::text from public.work_order_items) as items,
               (select count(*)::text from public.project_products
                where project_id = any($1::uuid[])) as project_products,
               (select count(*)::text from public.inventory_balances) as balances,
               (select count(*)::text from public.inventory_movements) as movements,
               (select count(*)::text from public.audit_logs) as audits`,
            [fixtureIds],
          )).rows[0];

          await actAs(database, fixture.actors.admin);
          const adminChoices = (await listWorkOrderProjectChoices(database))
            .filter((choice) => fixtureIds.includes(choice.project_id));
          const expectedOpenIds = [...openProjects].sort((left, right) => {
            const names = new Map([
              [openProjects[0], "alpha choice"],
              [openProjects[1], "ALPHA CHOICE"],
              [openProjects[2], "Bravo choice"],
            ]);
            const nameOrder = names.get(left)!.toLocaleLowerCase()
              .localeCompare(names.get(right)!.toLocaleLowerCase());
            return nameOrder || left.localeCompare(right);
          });
          expect(adminChoices.map((choice) => choice.project_id))
            .toEqual(expectedOpenIds);
          expect(adminChoices.map((choice) => choice.status).sort())
            .toEqual(["in_progress", "on_hold", "planned"]);
          expect(adminChoices.some((choice) =>
            [completedId, cancelledId].includes(choice.project_id))).toBe(false);
          expect(Object.keys(adminChoices[0]!)).toEqual([
            "project_id",
            "name",
            "customer_name",
            "status",
          ]);
          await database.query("reset role");

          const editor = fixture.actors.unpermitted;
          await setOnlyWorkOrderPermission(
            database,
            editor,
            actorId,
            "work_orders.edit_draft",
          );
          await actAs(database, editor);
          expect((await database.query<{ projects_view: boolean }>(
            "select public.has_permission('projects.view') as projects_view",
          )).rows).toEqual([{ projects_view: false }]);
          expect((await database.query(
            "select id from public.projects where id = any($1::uuid[])",
            [fixtureIds],
          )).rows).toEqual([]);
          expect((await listWorkOrderProjectChoices(database))
            .filter((choice) => fixtureIds.includes(choice.project_id)))
            .toEqual(adminChoices);
          await database.query("reset role");

          for (const permission of [
            "work_orders.view",
            "work_orders.create",
            "work_orders.finish",
            "work_orders.delete_draft",
            null,
          ] as const) {
            await setOnlyWorkOrderPermission(database, editor, actorId, permission);
            await actAs(database, editor);
            await expectRejected(
              database,
              () => listWorkOrderProjectChoices(database),
              "42501",
              "Access denied",
            );
            await database.query("reset role");
          }

          await setOnlyWorkOrderPermission(
            database,
            fixture.actors.inactive,
            actorId,
            "work_orders.edit_draft",
          );
          await actAs(database, fixture.actors.inactive);
          await expectRejected(
            database,
            () => listWorkOrderProjectChoices(database),
            "42501",
            "Access denied",
          );
          await database.query("reset role");

          const sideEffectsAfter = (await database.query(
            `select
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(project)
                  order by project.id)
                from public.projects as project
                where project.id = any($1::uuid[])) as projects,
               (select count(*)::text from public.work_orders) as work_orders,
               (select count(*)::text from public.work_order_items) as items,
               (select count(*)::text from public.project_products
                where project_id = any($1::uuid[])) as project_products,
               (select count(*)::text from public.inventory_balances) as balances,
               (select count(*)::text from public.inventory_movements) as movements,
               (select count(*)::text from public.audit_logs) as audits`,
            [fixtureIds],
          )).rows[0];
          expect(sideEffectsAfter).toEqual(sideEffectsBefore);
        });

        expectPermissionDenied((await fixture.anonymousClient.rpc(
          "list_work_order_project_choices",
        )).error);
      });

      it("uses hardened authenticated-only RPCs without broadening table RLS", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const functions = (await database.query<{
            arguments: string;
            authenticated_execute: boolean;
            language: string;
            name: string;
            anon_execute: boolean;
            public_execute: boolean;
            result: string;
            security_definer: boolean;
            settings: string[];
            volatility: string;
          }>(
            `select routine.proname as name,
                    pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
                    pg_catalog.pg_get_function_result(routine.oid) as result,
                    language.lanname as language,
                    routine.provolatile as volatility,
                    routine.prosecdef as security_definer,
                    routine.proconfig as settings,
                    pg_catalog.has_function_privilege(
                      'anon', routine.oid, 'execute'
                    ) as anon_execute,
                    pg_catalog.has_function_privilege(
                      'authenticated', routine.oid, 'execute'
                    ) as authenticated_execute,
                    exists (
                      select 1
                      from pg_catalog.aclexplode(routine.proacl) as privilege
                      where privilege.grantee = 0
                        and privilege.privilege_type = 'EXECUTE'
                    ) as public_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             join pg_catalog.pg_language as language
               on language.oid = routine.prolang
             where namespace.nspname = 'public'
               and routine.proname = any($1::text[])
             order by routine.proname`,
            [["get_work_order_detail", "list_work_order_project_choices"]],
          )).rows;
          expect(functions).toEqual([
            {
              anon_execute: false,
              arguments: "p_work_order_id uuid",
              authenticated_execute: true,
              language: "plpgsql",
              name: "get_work_order_detail",
              public_execute: false,
              result: "TABLE(work_order_id uuid, work_order_number text, status text, project_id uuid, project_name text, customer_name_snapshot text, description text, created_at timestamp with time zone, updated_at timestamp with time zone)",
              security_definer: true,
              settings: ['search_path=""'],
              volatility: "s",
            },
            {
              anon_execute: false,
              arguments: "",
              authenticated_execute: true,
              language: "plpgsql",
              name: "list_work_order_project_choices",
              public_execute: false,
              result: "TABLE(project_id uuid, name text, customer_name text, status text)",
              security_definer: true,
              settings: ['search_path=""'],
              volatility: "s",
            },
          ]);

          const policies = (await database.query<{
            policy_expression: string;
            policy_name: string;
          }>(
            `select policy.polname as policy_name,
                    pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
                      as policy_expression
             from pg_catalog.pg_policy as policy
             join pg_catalog.pg_class as relation
               on relation.oid = policy.polrelid
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = relation.relnamespace
             where namespace.nspname = 'public'
               and relation.relname in ('projects', 'work_orders')
             order by relation.relname, policy.polname`,
          )).rows;
          expect(policies).toEqual([
            {
              policy_expression: "(current_user_is_admin() OR has_permission('projects.view'::text))",
              policy_name: "projects_select_authorized",
            },
            {
              policy_expression: "(current_user_is_admin() OR has_permission('work_orders.view'::text))",
              policy_name: "work_orders_select_authorized",
            },
          ]);

          const tablePrivileges = (await database.query<{
            can_delete: boolean;
            can_insert: boolean;
            can_select: boolean;
            can_update: boolean;
            table_name: string;
          }>(
            `select relation.relname as table_name,
                    pg_catalog.has_table_privilege(
                      'authenticated', relation.oid, 'select'
                    ) as can_select,
                    pg_catalog.has_table_privilege(
                      'authenticated', relation.oid, 'insert'
                    ) as can_insert,
                    pg_catalog.has_table_privilege(
                      'authenticated', relation.oid, 'update'
                    ) as can_update,
                    pg_catalog.has_table_privilege(
                      'authenticated', relation.oid, 'delete'
                    ) as can_delete
             from pg_catalog.pg_class as relation
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = relation.relnamespace
             where namespace.nspname = 'public'
               and relation.relname in ('projects', 'work_orders')
             order by relation.relname`,
          )).rows;
          expect(tablePrivileges).toEqual([
            {
              can_delete: false,
              can_insert: false,
              can_select: true,
              can_update: false,
              table_name: "projects",
            },
            {
              can_delete: false,
              can_insert: false,
              can_select: true,
              can_update: false,
              table_name: "work_orders",
            },
          ]);
        });
      });
    },
  );

  describe.skipIf(process.env.TASK108_MIGRATION !== "1")(
    "Task 108 trusted Draft Work Order update (requires deployed migration)",
    () => {
      it("allows Admin and edit-draft authority to save normalized trusted header data", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const editor = fixture.actors.unpermitted;
          const fixtureYear = await findUnusedWorkOrderYear(database);
          const projectId = await createWorkOrderReadProject(database, {
            actorId: admin.profileId,
            customerName: "Trusted Customer",
            name: "Trusted Draft Project",
            status: "planned",
          });
          const workOrderId = randomUUID();
          await database.query(
            `insert into public.work_orders (
               id, work_order_number, status,
               created_by_user_id, updated_by_user_id
             ) values ($1, $2, 'draft', $3, $3)`,
            [workOrderId, `RN-${fixtureYear}-0001`, admin.profileId],
          );
          const original = (await database.query<{
            created_at: Date;
            created_by_user_id: string;
            updated_at: string;
          }>(
            `select created_at, created_by_user_id,
                    updated_at::text as updated_at
             from public.work_orders where id = $1`,
            [workOrderId],
          )).rows[0]!;
          const sideEffectsBefore = (await database.query(
            `select
               (select count(*)::text from public.work_order_items
                where work_order_id = $1) as items,
               (select count(*)::text from public.inventory_movements) as movements,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(balance)
                  order by balance.product_id)
                from public.inventory_balances as balance) as balances,
               (select pg_catalog.to_jsonb(project)
                from public.projects as project where project.id = $2) as project`,
            [workOrderId, projectId],
          )).rows[0];

          await actAs(database, admin);
          const adminSave = await updateDraftWorkOrder(database, {
            description: "  Initial description  ",
            expectedUpdatedAt: original.updated_at,
            projectId,
            workOrderId,
          });
          await database.query("reset role");
          expect(adminSave.work_order_id).toBe(workOrderId);
          expect(adminSave.updated_at).not.toBe(original.updated_at);

          await setOnlyWorkOrderPermission(
            database,
            editor,
            admin.profileId,
            "work_orders.edit_draft",
          );
          await actAs(database, editor);
          expect((await database.query<{ can_view: boolean }>(
            "select public.has_permission('work_orders.view') as can_view",
          )).rows).toEqual([{ can_view: false }]);
          const editorSave = await updateDraftWorkOrder(database, {
            description: "  Updated description  ",
            expectedUpdatedAt: adminSave.updated_at,
            projectId,
            workOrderId,
          });
          await database.query("reset role");

          expect((await database.query(
            `select work_order_number, project_id, customer_name_snapshot,
                    description, status, created_at, created_by_user_id,
                    updated_at::text as updated_at, updated_by_user_id, finished_at,
                    finished_by_user_id
             from public.work_orders where id = $1`,
            [workOrderId],
          )).rows).toEqual([{
            created_at: original.created_at,
            created_by_user_id: original.created_by_user_id,
            customer_name_snapshot: "Trusted Customer",
            description: "Updated description",
            finished_at: null,
            finished_by_user_id: null,
            project_id: projectId,
            status: "draft",
            updated_at: editorSave.updated_at,
            updated_by_user_id: editor.profileId,
            work_order_number: `RN-${fixtureYear}-0001`,
          }]);

          const audits = (await database.query<{
            action_type: string;
            actor_user_id: string;
            after_data: Record<string, unknown>;
            before_data: Record<string, unknown>;
            entity_id: string;
            entity_type: string;
            summary: string;
          }>(
            `select actor_user_id, action_type, entity_type, entity_id,
                    summary, before_data, after_data
             from public.audit_logs
             where entity_id = $1 and action_type = 'work_order.updated'
             order by after_data ->> 'description'`,
            [workOrderId],
          )).rows;
          expect(audits).toEqual([
            {
              action_type: "work_order.updated",
              actor_user_id: admin.profileId,
              after_data: {
                customer_name_snapshot: "Trusted Customer",
                description: "Initial description",
                project_id: projectId,
              },
              before_data: {
                customer_name_snapshot: null,
                description: null,
                project_id: null,
              },
              entity_id: workOrderId,
              entity_type: "work_order",
              summary: `Updated Work Order RN-${fixtureYear}-0001`,
            },
            {
              action_type: "work_order.updated",
              actor_user_id: editor.profileId,
              after_data: {
                customer_name_snapshot: "Trusted Customer",
                description: "Updated description",
                project_id: projectId,
              },
              before_data: {
                customer_name_snapshot: "Trusted Customer",
                description: "Initial description",
                project_id: projectId,
              },
              entity_id: workOrderId,
              entity_type: "work_order",
              summary: `Updated Work Order RN-${fixtureYear}-0001`,
            },
          ]);
          expect((await database.query(
            `select
               (select count(*)::text from public.work_order_items
                where work_order_id = $1) as items,
               (select count(*)::text from public.inventory_movements) as movements,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(balance)
                  order by balance.product_id)
                from public.inventory_balances as balance) as balances,
               (select pg_catalog.to_jsonb(project)
                from public.projects as project where project.id = $2) as project`,
            [workOrderId, projectId],
          )).rows[0]).toEqual(sideEffectsBefore);
        });
      });

      it("supports incomplete Draft saves, clearing, no-ops, and stale rejection", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const fixtureYear = await findUnusedWorkOrderYear(database);
          const projectId = await createWorkOrderReadProject(database, {
            actorId: actor.profileId,
            customerName: "Snapshot Customer",
            name: "No-op Project",
            status: "in_progress",
          });
          const workOrderId = await insertWorkOrder(database, {
            actorId: actor.profileId,
            number: `RN-${fixtureYear}-0001`,
            projectId,
          });
          const beforeNoOp = (await database.query<{
            updated_at: string;
            updated_by_user_id: string;
          }>(
            `select updated_at::text as updated_at, updated_by_user_id
             from public.work_orders where id = $1`,
            [workOrderId],
          )).rows[0]!;
          const auditBefore = (await database.query<{ count: string }>(
            `select count(*) from public.audit_logs
             where entity_id = $1 and action_type = 'work_order.updated'`,
            [workOrderId],
          )).rows[0]!.count;

          await actAs(database, actor);
          const noOp = await updateDraftWorkOrder(database, {
            description: "  Assembly work  ",
            expectedUpdatedAt: beforeNoOp.updated_at,
            projectId,
            workOrderId,
          });
          expect(noOp).toEqual({
            updated_at: beforeNoOp.updated_at,
            work_order_id: workOrderId,
          });

          const changed = await updateDraftWorkOrder(database, {
            description: "Changed once",
            expectedUpdatedAt: noOp.updated_at,
            projectId,
            workOrderId,
          });
          await expectRejected(
            database,
            () => updateDraftWorkOrder(database, {
              description: "Changed once",
              expectedUpdatedAt: noOp.updated_at,
              projectId,
              workOrderId,
            }),
            "WOR05",
            "Work Order Draft has changed. Reload and try again.",
          );

          const cleared = await updateDraftWorkOrder(database, {
            description: "   ",
            expectedUpdatedAt: changed.updated_at,
            projectId: null,
            workOrderId,
          });
          await database.query("reset role");

          expect((await database.query(
            `select project_id, customer_name_snapshot, description,
                    updated_at::text as updated_at, updated_by_user_id
             from public.work_orders where id = $1`,
            [workOrderId],
          )).rows).toEqual([{
            customer_name_snapshot: null,
            description: null,
            project_id: null,
            updated_at: cleared.updated_at,
            updated_by_user_id: actor.profileId,
          }]);
          expect((await database.query<{ count: string }>(
            `select count(*) from public.audit_logs
             where entity_id = $1 and action_type = 'work_order.updated'`,
            [workOrderId],
          )).rows).toEqual([{ count: String(Number(auditBefore) + 2) }]);
          expect((await database.query(
            `select updated_at, updated_by_user_id
             from public.work_orders where id = $1`,
            [workOrderId],
          )).rows[0]).not.toEqual(beforeNoOp);
        });
      });

      it("enforces Project eligibility while preserving an existing historical Project", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const fixtureYear = await findUnusedWorkOrderYear(database);
          const existingCompletedId = await createWorkOrderReadProject(database, {
            actorId: actor.profileId,
            customerName: "Refreshed Historical Customer",
            name: "Existing Completed Project",
            status: "completed",
          });
          const otherCompletedId = await createWorkOrderReadProject(database, {
            actorId: actor.profileId,
            customerName: "Other Completed Customer",
            name: "Other Completed Project",
            status: "completed",
          });
          const cancelledId = await createWorkOrderReadProject(database, {
            actorId: actor.profileId,
            customerName: "Cancelled Customer",
            name: "Cancelled Project",
            status: "cancelled",
          });
          const openId = await createWorkOrderReadProject(database, {
            actorId: actor.profileId,
            customerName: "Open Customer",
            name: "Open Project",
            status: "on_hold",
          });
          const inProgressId = await createWorkOrderReadProject(database, {
            actorId: actor.profileId,
            customerName: "In Progress Customer",
            name: "In Progress Project",
            status: "in_progress",
          });
          const workOrderId = await insertWorkOrder(database, {
            actorId: actor.profileId,
            number: `RN-${fixtureYear}-0001`,
            projectId: existingCompletedId,
          });
          const cancelledWorkOrderId = await insertWorkOrder(database, {
            actorId: actor.profileId,
            number: `RN-${fixtureYear}-0002`,
            projectId: cancelledId,
          });
          const initial = (await database.query<{ updated_at: string }>(
            `select updated_at::text as updated_at
             from public.work_orders where id = $1`,
            [workOrderId],
          )).rows[0]!;
          const cancelledInitial = (await database.query<{
            updated_at: string;
          }>(
            `select updated_at::text as updated_at
             from public.work_orders where id = $1`,
            [cancelledWorkOrderId],
          )).rows[0]!;

          await actAs(database, actor);
          const retained = await updateDraftWorkOrder(database, {
            description: "Historical Project retained",
            expectedUpdatedAt: initial.updated_at,
            projectId: existingCompletedId,
            workOrderId,
          });
          expect((await database.query(
            `select project_id, customer_name_snapshot, description
             from public.work_orders where id = $1`,
            [workOrderId],
          )).rows).toEqual([{
            customer_name_snapshot: "Refreshed Historical Customer",
            description: "Historical Project retained",
            project_id: existingCompletedId,
          }]);
          await updateDraftWorkOrder(database, {
            description: "Cancelled Project retained",
            expectedUpdatedAt: cancelledInitial.updated_at,
            projectId: cancelledId,
            workOrderId: cancelledWorkOrderId,
          });
          expect((await database.query(
            `select project_id, customer_name_snapshot, description
             from public.work_orders where id = $1`,
            [cancelledWorkOrderId],
          )).rows).toEqual([{
            customer_name_snapshot: "Cancelled Customer",
            description: "Cancelled Project retained",
            project_id: cancelledId,
          }]);

          for (const ineligibleId of [otherCompletedId, cancelledId]) {
            await expectRejected(
              database,
              () => updateDraftWorkOrder(database, {
                description: "Rejected replacement",
                expectedUpdatedAt: retained.updated_at,
                projectId: ineligibleId,
                workOrderId,
              }),
              "22023",
              "Selected Project is unavailable for Work Order Draft",
            );
          }
          await expectRejected(
            database,
            () => updateDraftWorkOrder(database, {
              description: "Missing replacement",
              expectedUpdatedAt: retained.updated_at,
              projectId: randomUUID(),
              workOrderId,
            }),
            "P0002",
            "Project not found",
          );

          const inProgressReplacement = await updateDraftWorkOrder(database, {
            description: "In-progress replacement",
            expectedUpdatedAt: retained.updated_at,
            projectId: inProgressId,
            workOrderId,
          });
          const replaced = await updateDraftWorkOrder(database, {
            description: "Open replacement",
            expectedUpdatedAt: inProgressReplacement.updated_at,
            projectId: openId,
            workOrderId,
          });
          const cleared = await updateDraftWorkOrder(database, {
            description: null,
            expectedUpdatedAt: replaced.updated_at,
            projectId: null,
            workOrderId,
          });
          await database.query("reset role");
          expect((await database.query(
            `select project_id, customer_name_snapshot, description,
                    updated_at::text as updated_at
             from public.work_orders where id = $1`,
            [workOrderId],
          )).rows).toEqual([{
            customer_name_snapshot: null,
            description: null,
            project_id: null,
            updated_at: cleared.updated_at,
          }]);
          expect((await database.query<{ count: string }>(
            `select count(*) from public.audit_logs
             where entity_id = $1 and action_type = 'work_order.updated'`,
            [workOrderId],
          )).rows).toEqual([{ count: "4" }]);
          expect((await database.query<{ count: string }>(
            `select count(*) from public.audit_logs
             where entity_id = $1 and action_type = 'work_order.updated'`,
            [cancelledWorkOrderId],
          )).rows).toEqual([{ count: "1" }]);
        });
      });

      it("rejects invalid lifecycle, identity, and permission cases without mutation or audit", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const fixtureYear = await findUnusedWorkOrderYear(database);
          const projectId = await createProject(database, admin.profileId);
          const draftId = await insertWorkOrder(database, {
            actorId: admin.profileId,
            number: `RN-${fixtureYear}-0001`,
            projectId,
          });
          const finishedId = await insertWorkOrder(database, {
            actorId: admin.profileId,
            number: `RN-${fixtureYear}-0002`,
            projectId,
            status: "finished",
          });
          const draftBefore = (await database.query<WorkOrderRow & {
            updated_by_user_id: string;
          }>(
            "select * from public.work_orders where id = $1",
            [draftId],
          )).rows[0]!;
          const draftExpectedUpdatedAt = (await database.query<{
            updated_at: string;
          }>(
            `select updated_at::text as updated_at
             from public.work_orders where id = $1`,
            [draftId],
          )).rows[0]!.updated_at;
          const auditBefore = (await database.query<{ count: string }>(
            `select count(*) from public.audit_logs
             where entity_id = any($1::uuid[])
               and action_type = 'work_order.updated'`,
            [[draftId, finishedId]],
          )).rows[0]!.count;

          await actAs(database, admin);
          await expectRejected(
            database,
            () => updateDraftWorkOrder(database, {
              description: "Changed",
              expectedUpdatedAt: null,
              projectId,
              workOrderId: draftId,
            }),
            "22023",
            "Expected Work Order update timestamp is required",
          );
          await expectRejected(
            database,
            () => updateDraftWorkOrder(database, {
              description: null,
              expectedUpdatedAt: draftExpectedUpdatedAt,
              projectId: null,
              workOrderId: null,
            }),
            "22023",
            "Work Order ID is required",
          );
          await expectRejected(
            database,
            () => updateDraftWorkOrder(database, {
              description: "Changed",
              expectedUpdatedAt: draftExpectedUpdatedAt,
              projectId,
              workOrderId: randomUUID(),
            }),
            "P0002",
            "Work Order not found",
          );
          const finishedUpdatedAt = (await database.query<{
            updated_at: string;
          }>(
            `select updated_at::text as updated_at
             from public.work_orders where id = $1`,
            [finishedId],
          )).rows[0]!.updated_at;
          await expectRejected(
            database,
            () => updateDraftWorkOrder(database, {
              description: "Changed",
              expectedUpdatedAt: finishedUpdatedAt,
              projectId,
              workOrderId: finishedId,
            }),
            "WOR02",
            "Finished Work Orders cannot be modified",
          );
          await database.query("reset role");

          const deniedActor = fixture.actors.unpermitted;
          for (const permission of [
            null,
            "work_orders.view",
            "work_orders.create",
            "work_orders.finish",
            "work_orders.delete_draft",
          ] as const) {
            await setOnlyWorkOrderPermission(
              database,
              deniedActor,
              admin.profileId,
              permission,
            );
            await actAs(database, deniedActor);
            await expectRejected(
              database,
              () => updateDraftWorkOrder(database, {
                description: "Denied",
                expectedUpdatedAt: draftExpectedUpdatedAt,
                projectId,
                workOrderId: draftId,
              }),
              "42501",
              "Access denied",
            );
            await database.query("reset role");
          }

          await setOnlyWorkOrderPermission(
            database,
            fixture.actors.inactive,
            admin.profileId,
            "work_orders.edit_draft",
          );
          await actAs(database, fixture.actors.inactive);
          await expectRejected(
            database,
            () => updateDraftWorkOrder(database, {
              description: "Denied inactive",
              expectedUpdatedAt: draftExpectedUpdatedAt,
              projectId,
              workOrderId: draftId,
            }),
            "42501",
            "Access denied",
          );
          await database.query("reset role");

          expect((await database.query(
            "select * from public.work_orders where id = $1",
            [draftId],
          )).rows).toEqual([draftBefore]);
          expect((await database.query<{ count: string }>(
            `select count(*) from public.audit_logs
             where entity_id = any($1::uuid[])
               and action_type = 'work_order.updated'`,
            [[draftId, finishedId]],
          )).rows[0]!.count).toBe(auditBefore);
        });

        expectPermissionDenied((await fixture.anonymousClient.rpc(
          "update_draft_work_order",
          {
            p_description: null,
            p_expected_updated_at: new Date().toISOString(),
            p_project_id: null,
            p_work_order_id: randomUUID(),
          },
        )).error);
      });

      it("rolls back the Draft mutation when its immutable audit append fails", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const fixtureYear = await findUnusedWorkOrderYear(database);
          const projectId = await createProject(database, actor.profileId);
          const workOrderId = await insertWorkOrder(database, {
            actorId: actor.profileId,
            number: `RN-${fixtureYear}-0001`,
            projectId,
          });
          const before = (await database.query(
            "select * from public.work_orders where id = $1",
            [workOrderId],
          )).rows[0];
          const expectedUpdatedAt = (await database.query<{
            updated_at: string;
          }>(
            `select updated_at::text as updated_at
             from public.work_orders where id = $1`,
            [workOrderId],
          )).rows[0]!.updated_at;
          await database.query(
            `create function pg_temp.reject_work_order_update_audit()
             returns trigger language plpgsql set search_path = ''
             as $test_function$
             begin
               if new.action_type = 'work_order.updated' then
                 raise exception 'Simulated Work Order audit failure'
                   using errcode = 'TST08';
               end if;
               return new;
             end;
             $test_function$`,
          );
          await database.query(
            `create trigger reject_work_order_update_audit_test
             before insert on public.audit_logs for each row
             execute function pg_temp.reject_work_order_update_audit()`,
          );

          await actAs(database, actor);
          await expectRejected(
            database,
            () => updateDraftWorkOrder(database, {
              description: "Must roll back",
              expectedUpdatedAt,
              projectId,
              workOrderId,
            }),
            "TST08",
            "Simulated Work Order audit failure",
          );
          await database.query("reset role");

          expect((await database.query(
            "select * from public.work_orders where id = $1",
            [workOrderId],
          )).rows).toEqual([before]);
          expect((await database.query(
            `select id from public.audit_logs
             where entity_id = $1 and action_type = 'work_order.updated'`,
            [workOrderId],
          )).rows).toEqual([]);
        });
      });

      it("serializes stale Draft decisions through the Work Order row lock", async () => {
        const fixture = requireHarness();
        const actor = fixture.actors.admin;
        const projectId = randomUUID();
        const workOrderId = randomUUID();
        const applicationName = `draft-update-lock-${randomUUID()}`;
        await fixture.withDatabaseClients(3, async (clients) => {
          const winner = clients[0];
          const staleUpdater = clients[1];
          const observer = clients[2];
          if (!winner || !staleUpdater || !observer) {
            throw new Error("Draft update concurrency clients unavailable");
          }
          let setupCommitted = false;
          let waitingOutcome: Promise<
            | { error: unknown; ok: false }
            | { ok: true; value: UpdatedDraftWorkOrderRow }
          > | undefined;
          const initialUpdatedAt = "2026-09-21 10:00:00+00";
          const winnerUpdatedAt = "2026-09-21 10:01:00+00";

          const waitForLock = async () => {
            for (let attempt = 0; attempt < 100; attempt += 1) {
              const activity = await observer.query<{
                wait_event_type: string | null;
              }>(
                `select wait_event_type
                 from pg_catalog.pg_stat_activity
                 where application_name = $1`,
                [applicationName],
              );
              if (activity.rows[0]?.wait_event_type === "Lock") return;
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
            throw new Error("Expected stale Draft update to wait on a row lock");
          };

          try {
            const fixtureYear = await findUnusedWorkOrderYear(observer);
            await observer.query("begin");
            await observer.query(
              `insert into public.projects (
                 id, name, customer_name, start_date, delivery_date,
                 created_by_user_id, updated_by_user_id
               ) values (
                 $1, 'Draft lock Project', 'Draft lock Customer',
                 '2026-09-21', '2026-09-30', $2, $2
               )`,
              [projectId, actor.profileId],
            );
            await observer.query(
              `insert into public.work_orders (
                 id, work_order_number, project_id, customer_name_snapshot,
                 description, status, created_at, created_by_user_id,
                 updated_at, updated_by_user_id
               ) values (
                 $1, $2, $3, 'Draft lock Customer', 'Original', 'draft',
                 $4, $5, $4, $5
               )`,
              [
                workOrderId,
                `RN-${fixtureYear}-0001`,
                projectId,
                initialUpdatedAt,
                actor.profileId,
              ],
            );
            await observer.query("commit");
            setupCommitted = true;

            await winner.query("begin");
            await winner.query(
              "select id from public.work_orders where id = $1 for update",
              [workOrderId],
            );

            await staleUpdater.query("begin");
            await staleUpdater.query(
              "select pg_catalog.set_config('application_name', $1, true)",
              [applicationName],
            );
            await actAs(staleUpdater, actor);
            waitingOutcome = updateDraftWorkOrder(staleUpdater, {
              description: "Stale contender",
              expectedUpdatedAt: initialUpdatedAt,
              projectId,
              workOrderId,
            }).then(
              (value) => ({ ok: true as const, value }),
              (error: unknown) => ({ error, ok: false as const }),
            );
            await waitForLock();

            await winner.query(
              `update public.work_orders
               set description = 'Concurrent winner', updated_at = $2,
                   updated_by_user_id = $3
               where id = $1`,
              [workOrderId, winnerUpdatedAt, actor.profileId],
            );
            await winner.query("commit");
            expect(await waitingOutcome).toMatchObject({
              error: {
                code: "WOR05",
                message: "Work Order Draft has changed. Reload and try again.",
              },
              ok: false,
            });
            waitingOutcome = undefined;
            await staleUpdater.query("rollback");

            expect((await observer.query(
              `select description, updated_at::text as updated_at
               from public.work_orders where id = $1`,
              [workOrderId],
            )).rows).toEqual([{
              description: "Concurrent winner",
              updated_at: winnerUpdatedAt,
            }]);
            expect((await observer.query(
              `select id from public.audit_logs
               where entity_id = $1 and action_type = 'work_order.updated'`,
              [workOrderId],
            )).rows).toEqual([]);
          } finally {
            await winner.query("rollback").catch(() => undefined);
            if (waitingOutcome) {
              await waitingOutcome;
            }
            await staleUpdater.query("rollback").catch(() => undefined);
            if (setupCommitted) {
              await observer.query(
                "delete from public.work_orders where id = $1",
                [workOrderId],
              );
              await observer.query(
                "delete from public.projects where id = $1",
                [projectId],
              );
            } else {
              await observer.query("rollback").catch(() => undefined);
            }
          }
        });
      });

      it("uses hardened authenticated-only execution and preserves direct-write denial", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const functionRow = (await database.query<{
            arguments: string;
            authenticated_execute: boolean;
            definition: string;
            language: string;
            anon_execute: boolean;
            public_execute: boolean;
            result: string;
            security_definer: boolean;
            settings: string[];
            volatility: string;
          }>(
            `select pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
                    pg_catalog.pg_get_function_result(routine.oid) as result,
                    pg_catalog.pg_get_functiondef(routine.oid) as definition,
                    language.lanname as language,
                    routine.provolatile as volatility,
                    routine.prosecdef as security_definer,
                    routine.proconfig as settings,
                    pg_catalog.has_function_privilege(
                      'anon', routine.oid, 'execute'
                    ) as anon_execute,
                    pg_catalog.has_function_privilege(
                      'authenticated', routine.oid, 'execute'
                    ) as authenticated_execute,
                    exists (
                      select 1 from pg_catalog.aclexplode(routine.proacl) as privilege
                      where privilege.grantee = 0
                        and privilege.privilege_type = 'EXECUTE'
                    ) as public_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             join pg_catalog.pg_language as language
               on language.oid = routine.prolang
             where namespace.nspname = 'public'
               and routine.proname = 'update_draft_work_order'`,
          )).rows[0]!;
          expect(functionRow).toMatchObject({
            anon_execute: false,
            arguments: "p_work_order_id uuid, p_project_id uuid, p_description text, p_expected_updated_at timestamp with time zone",
            authenticated_execute: true,
            language: "plpgsql",
            public_execute: false,
            result: "TABLE(work_order_id uuid, updated_at timestamp with time zone)",
            security_definer: true,
            settings: ['search_path=""'],
            volatility: "v",
          });
          const normalizedDefinition = functionRow.definition.toLowerCase();
          expect(normalizedDefinition).toContain("for update");
          expect(normalizedDefinition).toContain("for share");
          expect(normalizedDefinition).toContain("append_audit_log");
          expect(normalizedDefinition).not.toContain("inventory_balances");
          expect(normalizedDefinition).not.toContain("inventory_movements");
          expect(normalizedDefinition).not.toContain("work_order_items");

          const actor = fixture.actors.unpermitted;
          await setOnlyWorkOrderPermission(
            database,
            actor,
            fixture.actors.admin.profileId,
            "work_orders.edit_draft",
          );
          await actAs(database, actor);
          await expectRejected(
            database,
            () => database.query(
              `update public.work_orders set description = 'Direct write'
               where id = $1`,
              [randomUUID()],
            ),
            "42501",
          );
          await database.query("reset role");
        });
      });
    },
  );

  describe.skipIf(process.env.TASK111A_MIGRATION !== "1")(
    "Task 111A trusted Work Order barcode Product resolver (requires deployed migration)",
    () => {
      async function createResolverProduct(
        database: PoolClient,
        values: {
          actorId: string;
          active?: boolean;
          kind: "component" | "pcb_finished_good";
          serialNumber: string;
        },
      ): Promise<{ id: string; name: string }> {
        const id = randomUUID();
        const name = `Barcode Product ${id}`;
        const active = values.active ?? true;
        await database.query(
          `insert into public.products (
             id, serial_number, name, category, product_kind, is_active,
             created_by_user_id, updated_by_user_id,
             archived_at, archived_by_user_id
           ) values (
             $1::uuid, $2::text, $3::text, 'Work Order', $4::text, $5::boolean,
             $6::uuid, $6::uuid,
             case when $5::boolean then null else pg_catalog.clock_timestamp() end,
             case when $5::boolean then null else $6::uuid end
           )`,
          [id, values.serialNumber, name, values.kind, active, values.actorId],
        );
        return { id, name };
      }

      async function createIncompleteDraft(
        database: PoolClient,
        actorId: string,
      ): Promise<string> {
        const id = randomUUID();
        const year = await findUnusedWorkOrderYear(database);
        await database.query(
          `insert into public.work_orders (
             id, work_order_number, status,
             created_by_user_id, updated_by_user_id
           ) values ($1::uuid, $2::text, 'draft', $3::uuid, $3::uuid)`,
          [id, `RN-${year}-0001`, actorId],
        );
        return id;
      }

      async function setResolverPermission(
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
               definition.key like 'work_orders.%'
               or definition.key like 'inventory.%'
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

      it("authorizes only Admin or edit-draft actors without granting Product SELECT", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const editor = fixture.actors.unpermitted;
          const workOrderId = await createIncompleteDraft(database, admin.profileId);
          const serialNumber = await findUnusedLeadingZeroProductSerial(database);
          const product = await createResolverProduct(database, {
            actorId: admin.profileId,
            kind: "component",
            serialNumber,
          });

          await actAs(database, admin);
          expect(await resolveWorkOrderProductBarcode(
            database, workOrderId, serialNumber,
          )).toEqual([{
            name: product.name,
            product_id: product.id,
            serial_number: serialNumber,
          }]);
          await database.query("reset role");

          await setResolverPermission(
            database, editor, admin.profileId, "work_orders.edit_draft",
          );
          await actAs(database, editor);
          expect(await resolveWorkOrderProductBarcode(
            database, workOrderId, serialNumber,
          )).toHaveLength(1);
          expect((await database.query(
            "select id from public.products where id = $1::uuid",
            [product.id],
          )).rows).toEqual([]);
          await database.query("reset role");

          for (const permissionKey of [
            "work_orders.view",
            "inventory.view",
            "work_orders.create",
            "inventory.products.edit",
            null,
          ]) {
            await setResolverPermission(
              database, editor, admin.profileId, permissionKey,
            );
            await actAs(database, editor);
            await expectRejected(
              database,
              () => resolveWorkOrderProductBarcode(
                database, workOrderId, serialNumber,
              ),
              "42501",
              "Access denied",
            );
            await database.query("reset role");
          }

          await setResolverPermission(
            database,
            fixture.actors.inactive,
            admin.profileId,
            "work_orders.edit_draft",
          );
          await actAs(database, fixture.actors.inactive);
          await expectRejected(
            database,
            () => resolveWorkOrderProductBarcode(
              database, workOrderId, serialNumber,
            ),
            "42501",
            "Access denied",
          );
          await database.query("reset role");
        });

        expectPermissionDenied((await fixture.anonymousClient.rpc(
          "resolve_work_order_product_barcode",
          { p_serial_number: "0000001", p_work_order_id: randomUUID() },
        )).error);
      });

      it("enforces Draft context and exact seven-digit serial validation", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const draftId = await createIncompleteDraft(database, actor.profileId);
          const serialNumber = await findUnusedLeadingZeroProductSerial(database);
          const projectId = await createProject(database, actor.profileId);
          const year = await findUnusedWorkOrderYear(database);
          const finishedId = await insertWorkOrder(database, {
            actorId: actor.profileId,
            number: `RN-${year}-0001`,
            projectId,
            status: "finished",
          });
          await createResolverProduct(database, {
            actorId: actor.profileId,
            kind: "component",
            serialNumber,
          });
          await actAs(database, actor);

          expect(await resolveWorkOrderProductBarcode(
            database, draftId, serialNumber,
          )).toHaveLength(1);
          await expectRejected(
            database,
            () => resolveWorkOrderProductBarcode(database, null, serialNumber),
            "22023",
            "Work Order ID is required",
          );
          for (const validSerial of ["0000001", "0000123", "1234567"]) {
            await expectRejected(
              database,
              () => resolveWorkOrderProductBarcode(
                database, randomUUID(), validSerial,
              ),
              "P0002",
              "Work Order not found",
            );
          }
          await expectRejected(
            database,
            () => resolveWorkOrderProductBarcode(
              database, finishedId, serialNumber,
            ),
            "WOR02",
          );
          for (const invalidSerial of [
            null, "123", "12345678", "ABC0123", "12 3456", " 0000001",
          ]) {
            await expectRejected(
              database,
              () => resolveWorkOrderProductBarcode(
                database, draftId, invalidSerial,
              ),
              "22023",
              "Enter a 7-digit Serial Number",
            );
          }
          await database.query("reset role");
        });
      });

      it("returns only eligible Product identity and distinguishes unavailable Products", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const workOrderId = await createIncompleteDraft(database, actor.profileId);
          const componentSerial = await findUnusedLeadingZeroProductSerial(database);
          const component = await createResolverProduct(database, {
            actorId: actor.profileId,
            kind: "component",
            serialNumber: componentSerial,
          });
          const finishedGoodSerial = await findUnusedLeadingZeroProductSerial(database);
          const finishedGood = await createResolverProduct(database, {
            actorId: actor.profileId,
            kind: "pcb_finished_good",
            serialNumber: finishedGoodSerial,
          });
          const archivedSerial = await findUnusedLeadingZeroProductSerial(database);
          await createResolverProduct(database, {
            active: false,
            actorId: actor.profileId,
            kind: "component",
            serialNumber: archivedSerial,
          });
          const missingSerial = await findMissingProductSerial(database);
          const before = (await database.query(
            `select
               (select pg_catalog.to_jsonb(work_order)
                from public.work_orders as work_order where id = $1) as work_order,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(product)
                order by product.id) from public.products as product
                where product.serial_number = any($2::text[]))
                 as products,
               (select count(*)::text from public.work_order_items
                where work_order_id = $1) as items,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(balance)
                  order by balance.product_id)
                from public.inventory_balances as balance
                join public.products as product on product.id = balance.product_id
                where product.serial_number = any($2::text[])) as balances,
               (select count(*)::text from public.inventory_movements) as movements,
               (select count(*)::text from public.audit_logs) as audits,
               (select count(*)::text from public.projects) as projects,
               (select count(*)::text from public.project_products)
                 as project_products,
               (select count(*)::text from public.project_product_components)
                 as project_product_components,
               (select count(*)::text from public.pcb_cards) as pcb_cards,
               (select count(*)::text from public.pcb_bom_versions)
                 as pcb_bom_versions,
               (select count(*)::text from public.pcb_bom_items) as pcb_bom_items,
               (select count(*)::text from public.pcb_production_runs)
                 as pcb_production_runs`,
            [workOrderId, [componentSerial, finishedGoodSerial, archivedSerial]],
          )).rows[0];

          await actAs(database, actor);
          const componentResult = await resolveWorkOrderProductBarcode(
            database, workOrderId, componentSerial,
          );
          expect(componentResult).toEqual([{
            name: component.name,
            product_id: component.id,
            serial_number: componentSerial,
          }]);
          expect(Object.keys(componentResult[0]!).sort()).toEqual([
            "name", "product_id", "serial_number",
          ]);
          expect(await resolveWorkOrderProductBarcode(
            database, workOrderId, finishedGoodSerial,
          )).toEqual([{
            name: finishedGood.name,
            product_id: finishedGood.id,
            serial_number: finishedGoodSerial,
          }]);
          await expectRejected(
            database,
            () => resolveWorkOrderProductBarcode(
              database, workOrderId, missingSerial,
            ),
            "P0002",
            "Product not found",
          );
          await expectRejected(
            database,
            () => resolveWorkOrderProductBarcode(
              database, workOrderId, archivedSerial,
            ),
            "PRD05",
            "Product is unavailable for Work Order",
          );
          await database.query("reset role");

          const after = (await database.query(
            `select
               (select pg_catalog.to_jsonb(work_order)
                from public.work_orders as work_order where id = $1) as work_order,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(product)
                order by product.id) from public.products as product
                where product.serial_number = any($2::text[]))
                 as products,
               (select count(*)::text from public.work_order_items
                where work_order_id = $1) as items,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(balance)
                  order by balance.product_id)
                from public.inventory_balances as balance
                join public.products as product on product.id = balance.product_id
                where product.serial_number = any($2::text[])) as balances,
               (select count(*)::text from public.inventory_movements) as movements,
               (select count(*)::text from public.audit_logs) as audits,
               (select count(*)::text from public.projects) as projects,
               (select count(*)::text from public.project_products)
                 as project_products,
               (select count(*)::text from public.project_product_components)
                 as project_product_components,
               (select count(*)::text from public.pcb_cards) as pcb_cards,
               (select count(*)::text from public.pcb_bom_versions)
                 as pcb_bom_versions,
               (select count(*)::text from public.pcb_bom_items) as pcb_bom_items,
               (select count(*)::text from public.pcb_production_runs)
                 as pcb_production_runs`,
            [workOrderId, [componentSerial, finishedGoodSerial, archivedSerial]],
          )).rows[0];
          expect(after).toEqual(before);
        });
      });

      it("uses hardened stable authenticated-only execution and preserves Product RLS", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const functionRow = (await database.query<{
            arguments: string;
            authenticated_execute: boolean;
            definition: string;
            language: string;
            anon_execute: boolean;
            public_execute: boolean;
            result: string;
            security_definer: boolean;
            settings: string[];
            volatility: string;
          }>(
            `select pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
                    pg_catalog.pg_get_function_result(routine.oid) as result,
                    pg_catalog.pg_get_functiondef(routine.oid) as definition,
                    language.lanname as language,
                    routine.provolatile as volatility,
                    routine.prosecdef as security_definer,
                    routine.proconfig as settings,
                    pg_catalog.has_function_privilege(
                      'anon', routine.oid, 'execute'
                    ) as anon_execute,
                    pg_catalog.has_function_privilege(
                      'authenticated', routine.oid, 'execute'
                    ) as authenticated_execute,
                    exists (
                      select 1 from pg_catalog.aclexplode(routine.proacl) as privilege
                      where privilege.grantee = 0
                        and privilege.privilege_type = 'EXECUTE'
                    ) as public_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             join pg_catalog.pg_language as language
               on language.oid = routine.prolang
             where namespace.nspname = 'public'
               and routine.proname = 'resolve_work_order_product_barcode'`,
          )).rows[0]!;
          expect(functionRow).toMatchObject({
            anon_execute: false,
            arguments: "p_work_order_id uuid, p_serial_number text",
            authenticated_execute: true,
            language: "plpgsql",
            public_execute: false,
            result: "TABLE(product_id uuid, serial_number text, name text)",
            security_definer: true,
            settings: ['search_path=""'],
            volatility: "s",
          });
          const definition = functionRow.definition.toLowerCase();
          expect(definition).not.toMatch(/\b(insert|update|delete)\b/);
          expect(definition).not.toContain("audit_logs");
          expect(definition).not.toContain("inventory_balances");
          expect(definition).not.toContain("inventory_movements");
          expect(definition).not.toContain("work_order_items");
          expect(definition).not.toContain("for update");
          expect(definition).not.toContain("for share");

          const productPolicies = (await database.query<{
            policy_expression: string;
            policy_name: string;
          }>(
            `select policy.polname as policy_name,
                    pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
                      as policy_expression
             from pg_catalog.pg_policy as policy
             join pg_catalog.pg_class as relation
               on relation.oid = policy.polrelid
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = relation.relnamespace
             where namespace.nspname = 'public'
               and relation.relname = 'products'
             order by policy.polname`,
          )).rows;
          expect(productPolicies).toEqual([{
            policy_expression: "(current_user_is_admin() OR has_permission('inventory.view'::text))",
            policy_name: "products_select_inventory_readers",
          }]);
        });
      });
    },
  );

  describe.skipIf(process.env.TASK112A_MIGRATION !== "1")(
    "Task 112A trusted Work Order material Inventory read (requires deployed migration)",
    () => {
      async function createMaterialProduct(
        database: PoolClient,
        values: {
          actorId: string;
          active?: boolean;
          kind: "component" | "pcb_finished_good";
          quantity: bigint;
        },
      ): Promise<string> {
        const id = randomUUID();
        const active = values.active ?? true;
        await database.query(
          `insert into public.products (
             id, serial_number, name, category, product_kind, is_active,
             created_by_user_id, updated_by_user_id,
             archived_at, archived_by_user_id
           ) values (
             $1::uuid, $2::text, $3::text, 'Work Order', $4::text, $5::boolean,
             $6::uuid, $6::uuid,
             case when $5::boolean then null else pg_catalog.clock_timestamp() end,
             case when $5::boolean then null else $6::uuid end
           )`,
          [
            id,
            createTestSerialNumber(),
            `Material Product ${id}`,
            values.kind,
            active,
            values.actorId,
          ],
        );
        await database.query(
          `update public.inventory_balances
           set quantity = $2::bigint, updated_at = pg_catalog.clock_timestamp()
           where product_id = $1::uuid`,
          [id, values.quantity.toString()],
        );
        return id;
      }

      async function createMaterialDraft(
        database: PoolClient,
        actorId: string,
      ): Promise<string> {
        const id = randomUUID();
        const year = await findUnusedWorkOrderYear(database);
        await database.query(
          `insert into public.work_orders (
             id, work_order_number, status,
             created_by_user_id, updated_by_user_id
           ) values ($1::uuid, $2::text, 'draft', $3::uuid, $3::uuid)`,
          [id, `RN-${year}-0001`, actorId],
        );
        return id;
      }

      async function setMaterialInventoryPermission(
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
               definition.key like 'work_orders.%'
               or definition.key like 'inventory.%'
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

      it("authorizes only Admin or edit-draft actors without granting general Inventory reads", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const editor = fixture.actors.unpermitted;
          const workOrderId = await createMaterialDraft(database, admin.profileId);
          const productId = await createMaterialProduct(database, {
            actorId: admin.profileId,
            kind: "component",
            quantity: 0n,
          });

          await actAs(database, admin);
          expect(await getWorkOrderMaterialInventory(
            database, workOrderId, productId,
          )).toEqual([{ current_inventory: "0", product_id: productId }]);
          await database.query("reset role");

          await setMaterialInventoryPermission(
            database, editor, admin.profileId, "work_orders.edit_draft",
          );
          await actAs(database, editor);
          expect(await getWorkOrderMaterialInventory(
            database, workOrderId, productId,
          )).toEqual([{ current_inventory: "0", product_id: productId }]);
          expect((await database.query(
            "select product_id from public.inventory_balances",
          )).rows).toEqual([]);
          expect((await database.query(
            "select id from public.products where id = $1::uuid",
            [productId],
          )).rows).toEqual([]);
          await database.query("reset role");

          for (const permissionKey of [
            "work_orders.view",
            "inventory.view",
            "work_orders.create",
            "inventory.products.edit",
            null,
          ]) {
            await setMaterialInventoryPermission(
              database, editor, admin.profileId, permissionKey,
            );
            await actAs(database, editor);
            await expectRejected(
              database,
              () => getWorkOrderMaterialInventory(
                database, workOrderId, productId,
              ),
              "42501",
              "Access denied",
            );
            await database.query("reset role");
          }

          await setMaterialInventoryPermission(
            database,
            fixture.actors.inactive,
            admin.profileId,
            "work_orders.edit_draft",
          );
          await actAs(database, fixture.actors.inactive);
          await expectRejected(
            database,
            () => getWorkOrderMaterialInventory(
              database, workOrderId, productId,
            ),
            "42501",
            "Access denied",
          );
          await database.query("reset role");
        });

        expectPermissionDenied((await fixture.anonymousClient.rpc(
          "get_work_order_material_inventory",
          { p_product_id: randomUUID(), p_work_order_id: randomUUID() },
        )).error);
      });

      it("enforces Draft and active Product context with the established safe errors", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const draftId = await createMaterialDraft(database, actor.profileId);
          const componentId = await createMaterialProduct(database, {
            actorId: actor.profileId,
            kind: "component",
            quantity: 0n,
          });
          const finishedGoodId = await createMaterialProduct(database, {
            actorId: actor.profileId,
            kind: "pcb_finished_good",
            quantity: 17n,
          });
          const archivedId = await createMaterialProduct(database, {
            active: false,
            actorId: actor.profileId,
            kind: "component",
            quantity: 5n,
          });
          const missingBalanceProductId = await createMaterialProduct(database, {
            actorId: actor.profileId,
            kind: "component",
            quantity: 0n,
          });
          await database.query(
            "delete from public.inventory_balances where product_id = $1::uuid",
            [missingBalanceProductId],
          );
          const projectId = await createProject(database, actor.profileId);
          const year = await findUnusedWorkOrderYear(database);
          const finishedId = await insertWorkOrder(database, {
            actorId: actor.profileId,
            number: `RN-${year}-0001`,
            projectId,
            status: "finished",
          });

          await actAs(database, actor);
          expect(await getWorkOrderMaterialInventory(
            database, draftId, componentId,
          )).toEqual([{ current_inventory: "0", product_id: componentId }]);
          expect(await getWorkOrderMaterialInventory(
            database, draftId, finishedGoodId,
          )).toEqual([{ current_inventory: "17", product_id: finishedGoodId }]);
          await expectRejected(
            database,
            () => getWorkOrderMaterialInventory(database, null, componentId),
            "22023",
            "Work Order ID is required",
          );
          await expectRejected(
            database,
            () => getWorkOrderMaterialInventory(database, draftId, null),
            "22023",
            "Product ID is required",
          );
          await expectRejected(
            database,
            () => getWorkOrderMaterialInventory(
              database, randomUUID(), componentId,
            ),
            "P0002",
            "Work Order not found",
          );
          await expectRejected(
            database,
            () => getWorkOrderMaterialInventory(
              database, finishedId, componentId,
            ),
            "WOR02",
          );
          await expectRejected(
            database,
            () => getWorkOrderMaterialInventory(
              database, draftId, randomUUID(),
            ),
            "P0002",
            "Product not found",
          );
          await expectRejected(
            database,
            () => getWorkOrderMaterialInventory(
              database, draftId, archivedId,
            ),
            "PRD05",
            "Product is unavailable for Work Order",
          );
          await expectRejected(
            database,
            () => getWorkOrderMaterialInventory(
              database, draftId, missingBalanceProductId,
            ),
            "IVB01",
            "Inventory balance not found",
          );
          await database.query("reset role");
        });
      });

      it("returns physical Inventory exactly without subtracting Project commitments or mutating state", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const workOrderId = await createMaterialDraft(database, actor.profileId);
          const productId = await createMaterialProduct(database, {
            actorId: actor.profileId,
            kind: "component",
            quantity: 17n,
          });
          const projectId = await createProject(database, actor.profileId);
          const projectProductId = randomUUID();
          await database.query(
            `insert into public.project_products (
               id, project_id, name, created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::uuid, 'Committed assembly', $3::uuid, $3::uuid)`,
            [projectProductId, projectId, actor.profileId],
          );
          await database.query(
            `insert into public.project_product_components (
               project_product_id, product_id, required_quantity,
               created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::uuid, 100, $3::uuid, $3::uuid)`,
            [projectProductId, productId, actor.profileId],
          );
          const before = (await database.query(
            `select
               (select pg_catalog.to_jsonb(work_order)
                from public.work_orders as work_order where id = $1) as work_order,
               (select pg_catalog.to_jsonb(product)
                from public.products as product where id = $2) as product,
               (select pg_catalog.to_jsonb(balance)
                from public.inventory_balances as balance
                where balance.product_id = $2) as balance,
               (select count(*)::text from public.work_order_items
                where work_order_id = $1) as items,
               (select count(*)::text from public.inventory_movements) as movements,
               (select count(*)::text from public.audit_logs) as audits,
               (select pg_catalog.to_jsonb(project)
                from public.projects as project where id = $3) as project,
               (select pg_catalog.to_jsonb(project_product)
                from public.project_products as project_product
                where id = $4) as project_product,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(component)
                  order by component.id)
                from public.project_product_components as component
                where component.project_product_id = $4) as components,
               (select count(*)::text from public.pcb_cards) as pcb_cards,
               (select count(*)::text from public.pcb_bom_versions)
                 as pcb_bom_versions,
               (select count(*)::text from public.pcb_bom_items) as pcb_bom_items,
               (select count(*)::text from public.pcb_production_runs)
                 as pcb_production_runs`,
            [workOrderId, productId, projectId, projectProductId],
          )).rows[0];

          await actAs(database, actor);
          const result = await getWorkOrderMaterialInventory(
            database, workOrderId, productId,
          );
          expect(result).toEqual([{
            current_inventory: "17",
            product_id: productId,
          }]);
          expect(Object.keys(result[0]!).sort()).toEqual([
            "current_inventory", "product_id",
          ]);
          await database.query("reset role");

          const after = (await database.query(
            `select
               (select pg_catalog.to_jsonb(work_order)
                from public.work_orders as work_order where id = $1) as work_order,
               (select pg_catalog.to_jsonb(product)
                from public.products as product where id = $2) as product,
               (select pg_catalog.to_jsonb(balance)
                from public.inventory_balances as balance
                where balance.product_id = $2) as balance,
               (select count(*)::text from public.work_order_items
                where work_order_id = $1) as items,
               (select count(*)::text from public.inventory_movements) as movements,
               (select count(*)::text from public.audit_logs) as audits,
               (select pg_catalog.to_jsonb(project)
                from public.projects as project where id = $3) as project,
               (select pg_catalog.to_jsonb(project_product)
                from public.project_products as project_product
                where id = $4) as project_product,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(component)
                  order by component.id)
                from public.project_product_components as component
                where component.project_product_id = $4) as components,
               (select count(*)::text from public.pcb_cards) as pcb_cards,
               (select count(*)::text from public.pcb_bom_versions)
                 as pcb_bom_versions,
               (select count(*)::text from public.pcb_bom_items) as pcb_bom_items,
               (select count(*)::text from public.pcb_production_runs)
                 as pcb_production_runs`,
            [workOrderId, productId, projectId, projectProductId],
          )).rows[0];
          expect(after).toEqual(before);
        });
      });

      it("uses hardened authenticated-only execution and preserves Product and Inventory RLS", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const functionRow = (await database.query<{
            arguments: string;
            authenticated_execute: boolean;
            definition: string;
            language: string;
            anon_execute: boolean;
            public_execute: boolean;
            result: string;
            security_definer: boolean;
            settings: string[];
            volatility: string;
          }>(
            `select pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
                    pg_catalog.pg_get_function_result(routine.oid) as result,
                    pg_catalog.pg_get_functiondef(routine.oid) as definition,
                    language.lanname as language,
                    routine.provolatile as volatility,
                    routine.prosecdef as security_definer,
                    routine.proconfig as settings,
                    pg_catalog.has_function_privilege(
                      'anon', routine.oid, 'execute'
                    ) as anon_execute,
                    pg_catalog.has_function_privilege(
                      'authenticated', routine.oid, 'execute'
                    ) as authenticated_execute,
                    exists (
                      select 1 from pg_catalog.aclexplode(routine.proacl) as privilege
                      where privilege.grantee = 0
                        and privilege.privilege_type = 'EXECUTE'
                    ) as public_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             join pg_catalog.pg_language as language
               on language.oid = routine.prolang
             where namespace.nspname = 'public'
               and routine.proname = 'get_work_order_material_inventory'`,
          )).rows[0]!;
          expect(functionRow).toMatchObject({
            anon_execute: false,
            arguments: "p_work_order_id uuid, p_product_id uuid",
            authenticated_execute: true,
            language: "plpgsql",
            public_execute: false,
            result: "TABLE(product_id uuid, current_inventory bigint)",
            security_definer: true,
            settings: ['search_path=""'],
            volatility: "s",
          });
          const definition = functionRow.definition.toLowerCase();
          expect(definition).not.toMatch(/\b(insert|update|delete)\b/);
          expect(definition).not.toContain("for update");
          expect(definition).not.toContain("for share");
          expect(definition).not.toContain("inventory_movements");
          expect(definition).not.toContain("work_order_items");
          expect(definition).not.toContain("audit_logs");
          expect(definition).not.toContain("project_products");
          expect(definition).not.toContain("commitment");

          const policies = (await database.query<{
            policy_expression: string;
            policy_name: string;
            table_name: string;
          }>(
            `select relation.relname as table_name,
                    policy.polname as policy_name,
                    pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
                      as policy_expression
             from pg_catalog.pg_policy as policy
             join pg_catalog.pg_class as relation
               on relation.oid = policy.polrelid
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = relation.relnamespace
             where namespace.nspname = 'public'
               and relation.relname in ('inventory_balances', 'products')
             order by relation.relname, policy.polname`,
          )).rows;
          expect(policies).toEqual([
            {
              policy_expression: "(current_user_is_admin() OR has_permission('inventory.view'::text))",
              policy_name: "inventory_balances_select_inventory_readers",
              table_name: "inventory_balances",
            },
            {
              policy_expression: "(current_user_is_admin() OR has_permission('inventory.view'::text))",
              policy_name: "products_select_inventory_readers",
              table_name: "products",
            },
          ]);
        });
      });
    },
  );

  describe.skipIf(process.env.TASK114A_MIGRATION !== "1")(
    "Task 114A atomic Draft persistence and material read (requires deployed migration)",
    () => {
      async function createPersistenceProduct(
        database: PoolClient,
        values: {
          active?: boolean;
          actorId: string;
          kind?: "component" | "pcb_finished_good";
          name?: string;
          quantity?: bigint;
        },
      ): Promise<{ id: string; name: string; serialNumber: string }> {
        const id = randomUUID();
        const active = values.active ?? true;
        const name = values.name ?? `Persisted Material ${id}`;
        const serialNumber = createTestSerialNumber();
        await database.query(
          `insert into public.products (
             id, serial_number, name, category, product_kind, is_active,
             created_by_user_id, updated_by_user_id,
             archived_at, archived_by_user_id
           ) values (
             $1::uuid, $2::text, $3::text, 'Work Order', $4::text, $5::boolean,
             $6::uuid, $6::uuid,
             case when $5::boolean then null else pg_catalog.clock_timestamp() end,
             case when $5::boolean then null else $6::uuid end
           )`,
          [
            id,
            serialNumber,
            name,
            values.kind ?? "component",
            active,
            values.actorId,
          ],
        );
        await database.query(
          `update public.inventory_balances
           set quantity = $2::bigint, updated_at = pg_catalog.clock_timestamp()
           where product_id = $1::uuid`,
          [id, (values.quantity ?? 0n).toString()],
        );
        return { id, name, serialNumber };
      }

      async function createPersistenceDraft(
        database: PoolClient,
        values: {
          actorId: string;
          description?: string | null;
          projectId?: string | null;
          status?: "draft" | "finished";
          suffix?: number;
        },
      ): Promise<{ id: string; updatedAt: string }> {
        const id = randomUUID();
        const year = await findUnusedWorkOrderYear(database);
        const status = values.status ?? "draft";
        const projectId = values.projectId ?? null;
        const customerName = projectId ? "Snapshot Customer" : null;
        await database.query(
          `insert into public.work_orders (
             id, work_order_number, project_id, customer_name_snapshot,
             description, status, created_by_user_id, updated_by_user_id,
             finished_at, finished_by_user_id
           ) values (
             $1::uuid, $2::text, $3::uuid, $4::text,
             $5::text, $6::text, $7::uuid, $7::uuid,
             case when $6::text = 'finished' then pg_catalog.clock_timestamp() end,
             case when $6::text = 'finished' then $7::uuid end
           )`,
          [
            id,
            `RN-${year}-${String(values.suffix ?? 1).padStart(4, "0")}`,
            projectId,
            customerName,
            values.description ?? null,
            status,
            values.actorId,
          ],
        );
        const updatedAt = (await database.query<{ updated_at: string }>(
          `select updated_at::text as updated_at
           from public.work_orders where id = $1::uuid`,
          [id],
        )).rows[0]!.updated_at;
        return { id, updatedAt };
      }

      async function grantOnlyPersistencePermission(
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
               definition.key like 'work_orders.%'
               or definition.key like 'inventory.%'
               or definition.key like 'projects.%'
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

      it("authorizes atomic saves and narrow reads through their exact independent boundaries", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const actor = fixture.actors.unpermitted;
          const projectId = await createProject(database, admin.profileId);
          const draft = await createPersistenceDraft(database, {
            actorId: admin.profileId,
          });
          const product = await createPersistenceProduct(database, {
            actorId: admin.profileId,
            quantity: 12n,
          });

          await actAs(database, admin);
          const adminSave = await saveDraftWorkOrder(database, {
            description: "  Initial assembly  ",
            expectedUpdatedAt: draft.updatedAt,
            items: [{ product_id: product.id, quantity: "2" }],
            projectId,
            workOrderId: draft.id,
          });
          expect(adminSave.work_order_id).toBe(draft.id);
          expect(await listDraftWorkOrderMaterials(database, draft.id)).toEqual([{
            current_inventory: "12",
            product_id: product.id,
            product_name: product.name,
            quantity: "2",
            serial_number: product.serialNumber,
          }]);
          await database.query("reset role");

          await grantOnlyPersistencePermission(
            database, actor, admin.profileId, "work_orders.edit_draft",
          );
          await actAs(database, actor);
          const editorSave = await saveDraftWorkOrder(database, {
            description: "Initial assembly",
            expectedUpdatedAt: adminSave.updated_at,
            items: [{ product_id: product.id, quantity: "3" }],
            projectId,
            workOrderId: draft.id,
          });
          expect(editorSave.updated_at).not.toBe(adminSave.updated_at);
          expect(await listDraftWorkOrderMaterials(database, draft.id)).toHaveLength(1);
          expect((await database.query(
            "select id from public.products where id = $1::uuid",
            [product.id],
          )).rows).toEqual([]);
          expect((await database.query(
            `select product_id from public.inventory_balances
             where product_id = $1::uuid`,
            [product.id],
          )).rows).toEqual([]);
          await database.query("reset role");

          for (const permission of [
            "work_orders.view",
            "work_orders.create",
            "work_orders.finish",
            "work_orders.delete_draft",
            null,
          ] as const) {
            await grantOnlyPersistencePermission(
              database, actor, admin.profileId, permission,
            );
            await actAs(database, actor);
            await expectRejected(
              database,
              () => saveDraftWorkOrder(database, {
                description: "Denied",
                expectedUpdatedAt: editorSave.updated_at,
                items: [{ product_id: product.id, quantity: "3" }],
                projectId,
                workOrderId: draft.id,
              }),
              "42501",
              "Access denied",
            );
            if (permission === "work_orders.view") {
              expect(await listDraftWorkOrderMaterials(database, draft.id)).toHaveLength(1);
            } else {
              await expectRejected(
                database,
                () => listDraftWorkOrderMaterials(database, draft.id),
                "42501",
                "Access denied",
              );
            }
            await database.query("reset role");
          }

          await grantOnlyPersistencePermission(
            database,
            fixture.actors.inactive,
            admin.profileId,
            "work_orders.edit_draft",
          );
          await actAs(database, fixture.actors.inactive);
          await expectRejected(
            database,
            () => saveDraftWorkOrder(database, {
              description: null,
              expectedUpdatedAt: editorSave.updated_at,
              items: [],
              projectId: null,
              workOrderId: draft.id,
            }),
            "42501",
            "Access denied",
          );
          await expectRejected(
            database,
            () => listDraftWorkOrderMaterials(database, draft.id),
            "42501",
            "Access denied",
          );
          await database.query("reset role");
        });

        expectPermissionDenied((await fixture.anonymousClient.rpc(
          "save_draft_work_order",
          {
            p_description: null,
            p_expected_updated_at: new Date().toISOString(),
            p_items: [],
            p_project_id: null,
            p_work_order_id: randomUUID(),
          },
        )).error);
        expectPermissionDenied((await fixture.anonymousClient.rpc(
          "list_draft_work_order_materials",
          { p_work_order_id: randomUUID() },
        )).error);
      });

      it("strictly validates lifecycle, optimistic version, and the exact desired-items JSON contract", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const projectId = await createProject(database, actor.profileId);
          const draft = await createPersistenceDraft(database, {
            actorId: actor.profileId,
          });
          const finished = await createPersistenceDraft(database, {
            actorId: actor.profileId,
            description: "Finished",
            projectId,
            status: "finished",
            suffix: 2,
          });
          const product = await createPersistenceProduct(database, {
            actorId: actor.profileId,
          });
          const valid = [{ product_id: product.id, quantity: "1" }];
          await actAs(database, actor);

          await expectRejected(database, () => saveDraftWorkOrder(database, {
            description: null, expectedUpdatedAt: draft.updatedAt,
            items: [], projectId: null, workOrderId: null,
          }), "22023", "Work Order ID is required");
          await expectRejected(database, () => saveDraftWorkOrder(database, {
            description: null, expectedUpdatedAt: null,
            items: [], projectId: null, workOrderId: draft.id,
          }), "22023", "Expected Work Order update timestamp is required");
          await expectRejected(database, () => saveDraftWorkOrder(database, {
            description: null, expectedUpdatedAt: draft.updatedAt,
            items: [], projectId: null, workOrderId: randomUUID(),
          }), "P0002", "Work Order not found");
          await expectRejected(database, () => saveDraftWorkOrder(database, {
            description: "No", expectedUpdatedAt: finished.updatedAt,
            items: [], projectId, workOrderId: finished.id,
          }), "WOR02");
          await expectRejected(database, () => saveDraftWorkOrder(database, {
            description: "No", expectedUpdatedAt: "2000-01-01T00:00:00Z",
            items: valid, projectId: null, workOrderId: draft.id,
          }), "WOR05");

          const invalidItems: unknown[] = [
            null,
            {},
            ["not-an-object"],
            [{ quantity: "1" }],
            [{ product_id: "not-a-uuid", quantity: "1" }],
            [{ product_id: product.id }],
            [{ product_id: product.id, quantity: 1 }],
            [{ product_id: product.id, quantity: "0" }],
            [{ product_id: product.id, quantity: "-1" }],
            [{ product_id: product.id, quantity: "1.5" }],
            [{ product_id: product.id, quantity: "1e3" }],
            [{ product_id: product.id, quantity: "abc" }],
            [{ product_id: product.id, quantity: "9223372036854775808" }],
            [
              { product_id: product.id, quantity: "1" },
              { product_id: product.id, quantity: "2" },
            ],
            [{ product_id: product.id, quantity: "1", id: randomUUID() }],
            [{ product_id: product.id, quantity: "1", added_at: "forged" }],
            [{
              product_id: product.id,
              quantity: "1",
              added_by_user_id: actor.profileId,
            }],
          ];
          for (const items of invalidItems) {
            await expectRejected(
              database,
              () => saveDraftWorkOrder(database, {
                description: null,
                expectedUpdatedAt: draft.updatedAt,
                items,
                projectId: null,
                workOrderId: draft.id,
              }),
              "22023",
            );
          }

          const empty = await saveDraftWorkOrder(database, {
            description: null,
            expectedUpdatedAt: draft.updatedAt,
            items: [],
            projectId: null,
            workOrderId: draft.id,
          });
          expect(empty.updated_at).toBe(draft.updatedAt);
          expect((await database.query(
            "select id from public.work_order_items where work_order_id = $1::uuid",
            [draft.id],
          )).rows).toEqual([]);
          await database.query("reset role");
        });
      });

      it("preserves Task 108 Project, Customer, and Description normalization semantics", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const plannedId = await createWorkOrderReadProject(database, {
            actorId: actor.profileId,
            customerName: "Planned Customer",
            name: "Planned Project",
            status: "planned",
          });
          const inProgressId = await createWorkOrderReadProject(database, {
            actorId: actor.profileId,
            customerName: "In-progress Customer",
            name: "In-progress Project",
            status: "in_progress",
          });
          const onHoldId = await createWorkOrderReadProject(database, {
            actorId: actor.profileId,
            customerName: "On-hold Customer",
            name: "On-hold Project",
            status: "on_hold",
          });
          const completedId = await createWorkOrderReadProject(database, {
            actorId: actor.profileId,
            customerName: "Completed Customer",
            name: "Completed Project",
            status: "completed",
          });
          const cancelledId = await createWorkOrderReadProject(database, {
            actorId: actor.profileId,
            customerName: "Cancelled Customer",
            name: "Cancelled Project",
            status: "cancelled",
          });
          const draft = await createPersistenceDraft(database, {
            actorId: actor.profileId,
          });

          await actAs(database, actor);
          const planned = await saveDraftWorkOrder(database, {
            description: "  Trimmed description  ",
            expectedUpdatedAt: draft.updatedAt,
            items: [],
            projectId: plannedId,
            workOrderId: draft.id,
          });
          const inProgress = await saveDraftWorkOrder(database, {
            description: "Trimmed description",
            expectedUpdatedAt: planned.updated_at,
            items: [],
            projectId: inProgressId,
            workOrderId: draft.id,
          });
          const onHold = await saveDraftWorkOrder(database, {
            description: "Trimmed description",
            expectedUpdatedAt: inProgress.updated_at,
            items: [],
            projectId: onHoldId,
            workOrderId: draft.id,
          });
          for (const unavailableProjectId of [completedId, cancelledId]) {
            await expectRejected(database, () => saveDraftWorkOrder(database, {
              description: "Rejected replacement",
              expectedUpdatedAt: onHold.updated_at,
              items: [],
              projectId: unavailableProjectId,
              workOrderId: draft.id,
            }), "22023", "Selected Project is unavailable for Work Order Draft");
          }
          await database.query("reset role");

          expect((await database.query(
            `select project_id, customer_name_snapshot, description
             from public.work_orders where id = $1::uuid`,
            [draft.id],
          )).rows).toEqual([{
            customer_name_snapshot: "On-hold Customer",
            description: "Trimmed description",
            project_id: onHoldId,
          }]);

          for (const historicalProjectId of [completedId, cancelledId]) {
            const historicalDraft = await createPersistenceDraft(database, {
              actorId: actor.profileId,
              description: "Historical",
              projectId: historicalProjectId,
            });
            await actAs(database, actor);
            const retained = await saveDraftWorkOrder(database, {
              description: "  Refreshed historical  ",
              expectedUpdatedAt: historicalDraft.updatedAt,
              items: [],
              projectId: historicalProjectId,
              workOrderId: historicalDraft.id,
            });
            const cleared = await saveDraftWorkOrder(database, {
              description: "   ",
              expectedUpdatedAt: retained.updated_at,
              items: [],
              projectId: null,
              workOrderId: historicalDraft.id,
            });
            expect(cleared.updated_at).not.toBe(retained.updated_at);
            await database.query("reset role");
            expect((await database.query(
              `select project_id, customer_name_snapshot, description
               from public.work_orders where id = $1::uuid`,
              [historicalDraft.id],
            )).rows).toEqual([{
              customer_name_snapshot: null,
              description: null,
              project_id: null,
            }]);
          }
        });
      });

      it("diffs desired materials, preserves add metadata, supports archived history, and audits once", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const draft = await createPersistenceDraft(database, {
            actorId: actor.profileId,
          });
          const retained = await createPersistenceProduct(database, {
            actorId: actor.profileId,
            quantity: 4n,
          });
          const removed = await createPersistenceProduct(database, {
            actorId: actor.profileId,
            kind: "pcb_finished_good",
            quantity: 5n,
          });
          const added = await createPersistenceProduct(database, {
            actorId: actor.profileId,
            quantity: 6n,
          });
          const archivedNew = await createPersistenceProduct(database, {
            active: false,
            actorId: actor.profileId,
          });
          await actAs(database, actor);
          const first = await saveDraftWorkOrder(database, {
            description: "  Build  ",
            expectedUpdatedAt: draft.updatedAt,
            items: [
              { product_id: retained.id, quantity: "1" },
              { product_id: removed.id, quantity: "2" },
            ],
            projectId: null,
            workOrderId: draft.id,
          });
          await database.query("reset role");

          const originalRows = (await database.query<{
            added_at: string;
            added_by_user_id: string;
            id: string;
            product_id: string;
            quantity: string;
          }>(
            `select id, product_id, quantity::text as quantity,
                    added_at::text as added_at, added_by_user_id
             from public.work_order_items
             where work_order_id = $1::uuid order by product_id`,
            [draft.id],
          )).rows;
          await database.query(
            `update public.products
             set is_active = false,
                 archived_at = pg_catalog.clock_timestamp(),
                 archived_by_user_id = $2::uuid,
                 updated_at = pg_catalog.clock_timestamp(),
                 updated_by_user_id = $2::uuid
             where id = $1::uuid`,
            [retained.id, actor.profileId],
          );

          await actAs(database, actor);
          const noOp = await saveDraftWorkOrder(database, {
            description: "Build",
            expectedUpdatedAt: first.updated_at,
            items: [
              { product_id: retained.id, quantity: "1" },
              { product_id: removed.id, quantity: "2" },
            ],
            projectId: null,
            workOrderId: draft.id,
          });
          expect(noOp.updated_at).toBe(first.updated_at);

          const mixed = await saveDraftWorkOrder(database, {
            description: "Build",
            expectedUpdatedAt: noOp.updated_at,
            items: [
              { product_id: retained.id, quantity: "9223372036854775807" },
              { product_id: added.id, quantity: "3" },
            ],
            projectId: null,
            workOrderId: draft.id,
          });
          expect(mixed.updated_at).not.toBe(noOp.updated_at);
          await expectRejected(database, () => saveDraftWorkOrder(database, {
            description: "Build",
            expectedUpdatedAt: mixed.updated_at,
            items: [
              { product_id: retained.id, quantity: "9223372036854775807" },
              { product_id: added.id, quantity: "3" },
              { product_id: archivedNew.id, quantity: "1" },
            ],
            projectId: null,
            workOrderId: draft.id,
          }), "PRD05", "Product is unavailable for Work Order");
          await expectRejected(database, () => saveDraftWorkOrder(database, {
            description: "Build",
            expectedUpdatedAt: mixed.updated_at,
            items: [
              { product_id: retained.id, quantity: "9223372036854775807" },
              { product_id: added.id, quantity: "3" },
              { product_id: randomUUID(), quantity: "1" },
            ],
            projectId: null,
            workOrderId: draft.id,
          }), "PRD05", "Product is unavailable for Work Order");
          await database.query("reset role");

          const rows = (await database.query<{
            added_at: string;
            added_by_user_id: string;
            id: string;
            product_id: string;
            quantity: string;
          }>(
            `select id, product_id, quantity::text as quantity,
                    added_at::text as added_at, added_by_user_id
             from public.work_order_items
             where work_order_id = $1::uuid order by product_id`,
            [draft.id],
          )).rows;
          const retainedBefore = originalRows.find(
            (row) => row.product_id === retained.id,
          )!;
          const retainedAfter = rows.find(
            (row) => row.product_id === retained.id,
          )!;
          expect(retainedAfter).toEqual({
            ...retainedBefore,
            quantity: "9223372036854775807",
          });
          expect(rows.some((row) => row.product_id === removed.id)).toBe(false);
          expect(rows.find((row) => row.product_id === added.id)).toMatchObject({
            added_by_user_id: actor.profileId,
            quantity: "3",
          });

          const audits = (await database.query<{
            after_data: {
              materials: Array<{ product_id: string; quantity: number | string }>;
            };
            before_data: {
              materials: Array<{ product_id: string; quantity: number | string }>;
            };
          }>(
            `select before_data, after_data
             from public.audit_logs
             where entity_id = $1::uuid
               and action_type = 'work_order.updated'
             order by created_at, id`,
            [draft.id],
          )).rows;
          expect(audits).toHaveLength(2);
          expect(audits[1]!.before_data.materials.map((item) => item.product_id))
            .toEqual([...audits[1]!.before_data.materials]
              .map((item) => item.product_id).sort());
          expect(audits[1]!.after_data.materials.map((item) => item.product_id))
            .toEqual([...audits[1]!.after_data.materials]
              .map((item) => item.product_id).sort());
          for (const audit of audits) {
            for (const material of [
              ...audit.before_data.materials,
              ...audit.after_data.materials,
            ]) {
              expect(Object.keys(material).sort()).toEqual([
                "product_id", "quantity",
              ]);
            }
          }

          await actAs(database, actor);
          const cleared = await saveDraftWorkOrder(database, {
            description: "Build",
            expectedUpdatedAt: mixed.updated_at,
            items: [],
            projectId: null,
            workOrderId: draft.id,
          });
          expect(cleared.updated_at).not.toBe(mixed.updated_at);
          await database.query("reset role");
          expect((await database.query(
            "select id from public.work_order_items where work_order_id = $1::uuid",
            [draft.id],
          )).rows).toEqual([]);
        });
      });

      it("keeps header, materials, version, and audit atomic across invalid and failed saves", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const projectId = await createProject(database, actor.profileId);
          const draft = await createPersistenceDraft(database, {
            actorId: actor.profileId,
          });
          const product = await createPersistenceProduct(database, {
            actorId: actor.profileId,
          });
          const before = (await database.query(
            "select * from public.work_orders where id = $1::uuid",
            [draft.id],
          )).rows[0];
          await actAs(database, actor);
          await expectRejected(database, () => saveDraftWorkOrder(database, {
            description: "Must roll back",
            expectedUpdatedAt: draft.updatedAt,
            items: [{ product_id: product.id, quantity: "0" }],
            projectId,
            workOrderId: draft.id,
          }), "22023");
          await expectRejected(database, () => saveDraftWorkOrder(database, {
            description: "Must roll back",
            expectedUpdatedAt: draft.updatedAt,
            items: [{ product_id: product.id, quantity: "1" }],
            projectId: randomUUID(),
            workOrderId: draft.id,
          }), "P0002", "Project not found");
          await database.query("reset role");

          expect((await database.query(
            "select * from public.work_orders where id = $1::uuid",
            [draft.id],
          )).rows[0]).toEqual(before);
          expect((await database.query(
            "select id from public.work_order_items where work_order_id = $1::uuid",
            [draft.id],
          )).rows).toEqual([]);

          await database.query(
            `create function pg_temp.reject_atomic_draft_save_audit()
             returns trigger language plpgsql set search_path = ''
             as $test_function$
             begin
               if new.action_type = 'work_order.updated' then
                 raise exception 'Simulated atomic Draft audit failure'
                   using errcode = 'TST14';
               end if;
               return new;
             end;
             $test_function$`,
          );
          await database.query(
            `create trigger reject_atomic_draft_save_audit_test
             before insert on public.audit_logs for each row
             execute function pg_temp.reject_atomic_draft_save_audit()`,
          );
          await actAs(database, actor);
          await expectRejected(database, () => saveDraftWorkOrder(database, {
            description: "Must roll back",
            expectedUpdatedAt: draft.updatedAt,
            items: [{ product_id: product.id, quantity: "1" }],
            projectId,
            workOrderId: draft.id,
          }), "TST14", "Simulated atomic Draft audit failure");
          await database.query("reset role");

          expect((await database.query(
            "select * from public.work_orders where id = $1::uuid",
            [draft.id],
          )).rows[0]).toEqual(before);
          expect((await database.query(
            "select id from public.work_order_items where work_order_id = $1::uuid",
            [draft.id],
          )).rows).toEqual([]);
          expect((await database.query(
            `select id from public.audit_logs
             where entity_id = $1::uuid and action_type = 'work_order.updated'`,
            [draft.id],
          )).rows).toEqual([]);
        });
      });

      it("serializes stale saves and new-Product archival races through stable parent/Product locks", async () => {
        const fixture = requireHarness();
        const actor = fixture.actors.admin;
        const workOrderId = randomUUID();
        const productId = randomUUID();
        const saveFirstProductId = randomUUID();
        const initialUpdatedAt = "2026-09-28 12:00:00+00";
        const winnerUpdatedAt = "2026-09-28 12:01:00+00";
        const staleApplication = `task-114a-stale-${randomUUID()}`;
        const archiveApplication = `task-114a-archive-${randomUUID()}`;
        const saveFirstApplication = `task-114a-save-first-${randomUUID()}`;
        await fixture.withDatabaseClients(3, async (clients) => {
          const blocker = clients[0];
          const contender = clients[1];
          const observer = clients[2];
          if (!blocker || !contender || !observer) {
            throw new Error("Task 114A concurrency clients unavailable");
          }
          let setupCommitted = false;
          let pending:
            | Promise<{ error: unknown; ok: false } | { ok: true; value: SavedDraftWorkOrderRow }>
            | undefined;

          const waitForLock = async (applicationName: string) => {
            for (let attempt = 0; attempt < 100; attempt += 1) {
              const activity = await observer.query<{
                wait_event_type: string | null;
              }>(
                `select wait_event_type
                 from pg_catalog.pg_stat_activity
                 where application_name = $1::text`,
                [applicationName],
              );
              if (activity.rows[0]?.wait_event_type === "Lock") return;
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
            throw new Error(`Expected ${applicationName} to wait on a lock`);
          };

          try {
            const fixtureYear = await findUnusedWorkOrderYear(observer);
            await observer.query("begin");
            await observer.query(
              `insert into public.work_orders (
                 id, work_order_number, description, status,
                 created_at, created_by_user_id, updated_at, updated_by_user_id
               ) values (
                 $1::uuid, $2::text, 'Original', 'draft',
                 $3::timestamptz, $4::uuid, $3::timestamptz, $4::uuid
               )`,
              [
                workOrderId,
                `RN-${fixtureYear}-0001`,
                initialUpdatedAt,
                actor.profileId,
              ],
            );
            await observer.query(
              `insert into public.products (
                 id, serial_number, name, category, product_kind,
                 created_by_user_id, updated_by_user_id
               ) values
                 (
                   $1::uuid, $2::text, 'Task 114A race Product',
                   'Work Order', 'component', $5::uuid, $5::uuid
                 ),
                 (
                   $3::uuid, $4::text, 'Task 114A save-first Product',
                   'Work Order', 'component', $5::uuid, $5::uuid
                 )`,
              [
                productId,
                createTestSerialNumber(),
                saveFirstProductId,
                createTestSerialNumber(),
                actor.profileId,
              ],
            );
            await observer.query("commit");
            setupCommitted = true;

            await blocker.query("begin");
            await blocker.query(
              "select id from public.work_orders where id = $1::uuid for update",
              [workOrderId],
            );
            await contender.query("begin");
            await contender.query(
              "select pg_catalog.set_config('application_name', $1, true)",
              [staleApplication],
            );
            await actAs(contender, actor);
            pending = saveDraftWorkOrder(contender, {
              description: "Stale contender",
              expectedUpdatedAt: initialUpdatedAt,
              items: [],
              projectId: null,
              workOrderId,
            }).then(
              (value) => ({ ok: true as const, value }),
              (error: unknown) => ({ error, ok: false as const }),
            );
            await waitForLock(staleApplication);
            await blocker.query(
              `update public.work_orders
               set description = 'Winner', updated_at = $2::timestamptz,
                   updated_by_user_id = $3::uuid
               where id = $1::uuid`,
              [workOrderId, winnerUpdatedAt, actor.profileId],
            );
            await blocker.query("commit");
            expect(await pending).toMatchObject({
              error: {
                code: "WOR05",
                message: "Work Order Draft has changed. Reload and try again.",
              },
              ok: false,
            });
            pending = undefined;
            await contender.query("rollback");

            await blocker.query("begin");
            await blocker.query(
              "select id from public.products where id = $1::uuid for update",
              [productId],
            );
            await blocker.query(
              `update public.products
               set is_active = false,
                   archived_at = pg_catalog.clock_timestamp(),
                   archived_by_user_id = $2::uuid,
                   updated_at = pg_catalog.clock_timestamp(),
                   updated_by_user_id = $2::uuid
               where id = $1::uuid`,
              [productId, actor.profileId],
            );
            await contender.query("begin");
            await contender.query(
              "select pg_catalog.set_config('application_name', $1, true)",
              [archiveApplication],
            );
            await actAs(contender, actor);
            pending = saveDraftWorkOrder(contender, {
              description: "Winner",
              expectedUpdatedAt: winnerUpdatedAt,
              items: [{ product_id: productId, quantity: "1" }],
              projectId: null,
              workOrderId,
            }).then(
              (value) => ({ ok: true as const, value }),
              (error: unknown) => ({ error, ok: false as const }),
            );
            await waitForLock(archiveApplication);
            await blocker.query("commit");
            expect(await pending).toMatchObject({
              error: {
                code: "PRD05",
                message: "Product is unavailable for Work Order",
              },
              ok: false,
            });
            pending = undefined;
            await contender.query("rollback");

            expect((await observer.query(
              `select description, updated_at::text as updated_at
               from public.work_orders where id = $1::uuid`,
              [workOrderId],
            )).rows).toEqual([{
              description: "Winner",
              updated_at: winnerUpdatedAt,
            }]);
            expect((await observer.query(
              `select id from public.work_order_items
               where work_order_id = $1::uuid`,
              [workOrderId],
            )).rows).toEqual([]);
            expect((await observer.query(
              `select id from public.audit_logs
               where entity_id = $1::uuid
                 and action_type = 'work_order.updated'`,
              [workOrderId],
            )).rows).toEqual([]);
            expect((await observer.query<{ quantity: string }>(
              `select quantity::text as quantity
               from public.inventory_balances where product_id = $1::uuid`,
              [productId],
            )).rows).toEqual([{ quantity: "0" }]);

            // Complementary order: the save validates and holds FOR SHARE first.
            // The archive must wait until the save transaction ends. Roll back the
            // save so this committed-concurrency test leaves no immutable audit.
            await contender.query("begin");
            await actAs(contender, actor);
            const saveFirst = await saveDraftWorkOrder(contender, {
              description: "Winner",
              expectedUpdatedAt: winnerUpdatedAt,
              items: [{ product_id: saveFirstProductId, quantity: "1" }],
              projectId: null,
              workOrderId,
            });
            expect(saveFirst.updated_at).not.toBe(winnerUpdatedAt);

            await blocker.query("begin");
            await blocker.query(
              "select pg_catalog.set_config('application_name', $1, true)",
              [saveFirstApplication],
            );
            const pendingArchive = blocker.query(
              `update public.products
               set is_active = false,
                   archived_at = pg_catalog.clock_timestamp(),
                   archived_by_user_id = $2::uuid,
                   updated_at = pg_catalog.clock_timestamp(),
                   updated_by_user_id = $2::uuid
               where id = $1::uuid`,
              [saveFirstProductId, actor.profileId],
            );
            await waitForLock(saveFirstApplication);
            await contender.query("rollback");
            await pendingArchive;
            await blocker.query("rollback");

            expect((await observer.query(
              `select id from public.work_order_items
               where work_order_id = $1::uuid`,
              [workOrderId],
            )).rows).toEqual([]);
            expect((await observer.query(
              `select id from public.audit_logs
               where entity_id = $1::uuid
                 and action_type = 'work_order.updated'`,
              [workOrderId],
            )).rows).toEqual([]);
            expect((await observer.query<{ is_active: boolean }>(
              `select is_active from public.products where id = $1::uuid`,
              [saveFirstProductId],
            )).rows).toEqual([{ is_active: true }]);
          } finally {
            await blocker.query("rollback").catch(() => undefined);
            if (pending) await pending;
            await contender.query("rollback").catch(() => undefined);
            if (setupCommitted) {
              await observer.query(
                "delete from public.work_orders where id = $1::uuid",
                [workOrderId],
              );
              await observer.query(
                `delete from public.inventory_balances
                 where product_id = any($1::uuid[])`,
                [[productId, saveFirstProductId]],
              );
              await observer.query(
                "delete from public.products where id = any($1::uuid[])",
                [[productId, saveFirstProductId]],
              );
              expect((await observer.query<{ count: string }>(
                `select (
                   (select pg_catalog.count(*) from public.work_orders
                    where id = $1::uuid)
                   +
                   (select pg_catalog.count(*) from public.work_order_items
                    where work_order_id = $1::uuid)
                   +
                   (select pg_catalog.count(*) from public.products
                    where id = any($2::uuid[]))
                   +
                   (select pg_catalog.count(*) from public.inventory_balances
                    where product_id = any($2::uuid[]))
                   +
                   (select pg_catalog.count(*) from public.audit_logs
                    where entity_id = $1::uuid)
                 )::text as count`,
                [workOrderId, [productId, saveFirstProductId]],
              )).rows).toEqual([{ count: "0" }]);
            } else {
              await observer.query("rollback").catch(() => undefined);
            }
          }
        });
      });

      it("returns exact persisted material history and rejects invalid Draft-read contexts", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.admin;
          const draft = await createPersistenceDraft(database, {
            actorId: actor.profileId,
          });
          const first = await createPersistenceProduct(database, {
            actorId: actor.profileId,
            name: "First historical input",
            quantity: 9223372036854775807n,
          });
          const second = await createPersistenceProduct(database, {
            actorId: actor.profileId,
            name: "Second input",
            quantity: 9n,
          });
          const projectId = await createProject(database, actor.profileId);
          const projectProductId = randomUUID();
          await database.query(
            `insert into public.project_products (
               id, project_id, name, created_by_user_id, updated_by_user_id
             ) values (
               $1::uuid, $2::uuid, 'Task 114A commitment', $3::uuid, $3::uuid
             )`,
            [projectProductId, projectId, actor.profileId],
          );
          await database.query(
            `insert into public.project_product_components (
               project_product_id, product_id, required_quantity,
               created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::uuid, 100, $3::uuid, $3::uuid)`,
            [projectProductId, first.id, actor.profileId],
          );
          await database.query(
            `insert into public.work_order_items (
               work_order_id, product_id, quantity, added_at, added_by_user_id
             ) values
               ($1, $2, 9223372036854775807, '2026-09-28T10:00:00Z', $4),
               ($1, $3, 2, '2026-09-28T10:01:00Z', $4)`,
            [draft.id, first.id, second.id, actor.profileId],
          );
          await database.query(
            `update public.products
             set is_active = false,
                 archived_at = pg_catalog.clock_timestamp(),
                 archived_by_user_id = $2::uuid,
                 updated_at = pg_catalog.clock_timestamp(),
                 updated_by_user_id = $2::uuid
             where id = $1::uuid`,
            [first.id, actor.profileId],
          );

          await actAs(database, actor);
          const rows = await listDraftWorkOrderMaterials(database, draft.id);
          expect(rows).toEqual([
            {
              current_inventory: "9223372036854775807",
              product_id: first.id,
              product_name: first.name,
              quantity: "9223372036854775807",
              serial_number: first.serialNumber,
            },
            {
              current_inventory: "9",
              product_id: second.id,
              product_name: second.name,
              quantity: "2",
              serial_number: second.serialNumber,
            },
          ]);
          expect(Object.keys(rows[0]!).sort()).toEqual([
            "current_inventory",
            "product_id",
            "product_name",
            "quantity",
            "serial_number",
          ]);
          await expectRejected(
            database,
            () => listDraftWorkOrderMaterials(database, null),
            "22023",
            "Work Order ID is required",
          );
          await expectRejected(
            database,
            () => listDraftWorkOrderMaterials(database, randomUUID()),
            "P0002",
            "Work Order not found",
          );
          await database.query("reset role");

          await database.query(
            "delete from public.inventory_balances where product_id = $1::uuid",
            [second.id],
          );
          await actAs(database, actor);
          await expectRejected(
            database,
            () => listDraftWorkOrderMaterials(database, draft.id),
            "IVB01",
            "Inventory balance not found",
          );
          await database.query("reset role");

          await database.query(
            `update public.work_orders
             set status = 'finished',
                 project_id = $2::uuid,
                 customer_name_snapshot = 'Finished Customer',
                 description = 'Finished Description',
                 finished_at = pg_catalog.clock_timestamp(),
                 finished_by_user_id = $3::uuid
             where id = $1::uuid`,
            [draft.id, projectId, actor.profileId],
          );
          await actAs(database, actor);
          await expectRejected(
            database,
            () => listDraftWorkOrderMaterials(database, draft.id),
            "WOR02",
          );
          await database.query("reset role");
        });
      });

      it("hardens both RPCs, leaves table RLS/direct writes intact, and has zero Inventory side effects", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const functions = (await database.query<{
            arguments: string;
            authenticated_execute: boolean;
            definition: string;
            language: string;
            name: string;
            anon_execute: boolean;
            public_execute: boolean;
            result: string;
            security_definer: boolean;
            settings: string[];
            volatility: string;
          }>(
            `select routine.proname as name,
                    pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
                    pg_catalog.pg_get_function_result(routine.oid) as result,
                    pg_catalog.pg_get_functiondef(routine.oid) as definition,
                    language.lanname as language,
                    routine.provolatile as volatility,
                    routine.prosecdef as security_definer,
                    routine.proconfig as settings,
                    pg_catalog.has_function_privilege(
                      'anon', routine.oid, 'execute'
                    ) as anon_execute,
                    pg_catalog.has_function_privilege(
                      'authenticated', routine.oid, 'execute'
                    ) as authenticated_execute,
                    exists (
                      select 1 from pg_catalog.aclexplode(routine.proacl) as privilege
                      where privilege.grantee = 0
                        and privilege.privilege_type = 'EXECUTE'
                    ) as public_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             join pg_catalog.pg_language as language
               on language.oid = routine.prolang
             where namespace.nspname = 'public'
               and routine.proname in (
                 'save_draft_work_order',
                 'list_draft_work_order_materials'
               )
             order by routine.proname`,
          )).rows;
          expect(functions.map((routine) => ({
            authenticated_execute: routine.authenticated_execute,
            language: routine.language,
            name: routine.name,
            anon_execute: routine.anon_execute,
            public_execute: routine.public_execute,
            security_definer: routine.security_definer,
            settings: routine.settings,
            volatility: routine.volatility,
          }))).toEqual([
            {
              anon_execute: false,
              authenticated_execute: true,
              language: "plpgsql",
              name: "list_draft_work_order_materials",
              public_execute: false,
              security_definer: true,
              settings: ['search_path=""'],
              volatility: "s",
            },
            {
              anon_execute: false,
              authenticated_execute: true,
              language: "plpgsql",
              name: "save_draft_work_order",
              public_execute: false,
              security_definer: true,
              settings: ['search_path=""'],
              volatility: "v",
            },
          ]);
          expect(functions.find((routine) => routine.name === "save_draft_work_order"))
            .toMatchObject({
              arguments: "p_work_order_id uuid, p_project_id uuid, p_description text, p_items jsonb, p_expected_updated_at timestamp with time zone",
              result: "TABLE(work_order_id uuid, updated_at timestamp with time zone)",
            });
          expect(functions.find(
            (routine) => routine.name === "list_draft_work_order_materials",
          )).toMatchObject({
            arguments: "p_work_order_id uuid",
            result: "TABLE(product_id uuid, serial_number text, product_name text, quantity bigint, current_inventory bigint)",
          });
          const saveDefinition = functions.find(
            (routine) => routine.name === "save_draft_work_order",
          )!.definition.toLowerCase();
          expect(saveDefinition).toContain("for update");
          expect(saveDefinition).toContain("for share");
          expect(saveDefinition).toContain("append_audit_log");
          expect(saveDefinition).not.toContain("update public.inventory_balances");
          expect(saveDefinition).not.toContain("inventory_movements");
          expect(saveDefinition).not.toContain("project_product");
          const readDefinition = functions.find(
            (routine) => routine.name === "list_draft_work_order_materials",
          )!.definition.toLowerCase();
          expect(readDefinition).not.toMatch(/\b(insert|update|delete)\b/);
          expect(readDefinition).not.toContain("inventory_movements");

          const policies = (await database.query<{
            policy_expression: string;
            policy_name: string;
            table_name: string;
          }>(
            `select relation.relname as table_name,
                    policy.polname as policy_name,
                    pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
                      as policy_expression
             from pg_catalog.pg_policy as policy
             join pg_catalog.pg_class as relation
               on relation.oid = policy.polrelid
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = relation.relnamespace
             where namespace.nspname = 'public'
               and relation.relname in (
                 'inventory_balances', 'products', 'work_order_items'
               )
             order by relation.relname, policy.polname`,
          )).rows;
          expect(policies).toEqual([
            {
              policy_expression: "(current_user_is_admin() OR has_permission('inventory.view'::text))",
              policy_name: "inventory_balances_select_inventory_readers",
              table_name: "inventory_balances",
            },
            {
              policy_expression: "(current_user_is_admin() OR has_permission('inventory.view'::text))",
              policy_name: "products_select_inventory_readers",
              table_name: "products",
            },
            {
              policy_expression: "(current_user_is_admin() OR has_permission('work_orders.view'::text))",
              policy_name: "work_order_items_select_authorized",
              table_name: "work_order_items",
            },
          ]);

          const actor = fixture.actors.unpermitted;
          await grantOnlyPersistencePermission(
            database, actor, fixture.actors.admin.profileId,
            "work_orders.edit_draft",
          );
          await actAs(database, actor);
          await expectRejected(
            database,
            () => database.query(
              `insert into public.work_order_items (
                 work_order_id, product_id, quantity, added_by_user_id
               ) values ($1, $2, 1, $3)`,
              [randomUUID(), randomUUID(), actor.profileId],
            ),
            "42501",
          );
          await database.query("reset role");

          expect((await database.query<{ count: string }>(
            `select count(*) from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             where namespace.nspname = 'public'
               and routine.proname = 'update_draft_work_order'`,
          )).rows).toEqual([{ count: "1" }]);
        });
      });
    },
  );

  describe.skipIf(process.env.TASK115A_MIGRATION !== "1")(
    "Task 115A trusted Draft Work Order deletion (requires deployed migration)",
    () => {
      async function createDeletionDraft(
        database: PoolClient,
        actorId: string,
      ): Promise<{ id: string; number: string; updatedAt: string }> {
        const id = randomUUID();
        const year = await findUnusedWorkOrderYear(database);
        const number = `RN-${year}-0001`;
        await database.query(
          `insert into public.work_orders (
             id, work_order_number, status,
             created_by_user_id, updated_by_user_id
           ) values ($1::uuid, $2::text, 'draft', $3::uuid, $3::uuid)`,
          [id, number, actorId],
        );
        const updatedAt = (await database.query<{ updated_at: string }>(
          `select updated_at::text as updated_at
           from public.work_orders where id = $1::uuid`,
          [id],
        )).rows[0]!.updated_at;
        return { id, number, updatedAt };
      }

      it("authorizes only active Admin or work_orders.delete_draft", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const actor = fixture.actors.unpermitted;
          const adminDraft = await createDeletionDraft(database, admin.profileId);
          await actAs(database, admin);
          await expect(deleteDraftWorkOrder(
            database, adminDraft.id, adminDraft.updatedAt,
          )).resolves.toEqual({
            work_order_id: adminDraft.id,
            work_order_number: adminDraft.number,
          });
          await database.query("reset role");

          const delegatedDraft = await createDeletionDraft(database, admin.profileId);
          const delegatedProductId = await createWorkOrderItemProduct(
            database, admin.profileId,
          );
          await database.query(
            `insert into public.work_order_items (
               work_order_id, product_id, quantity, added_by_user_id
             ) values ($1::uuid, $2::uuid, 1, $3::uuid)`,
            [delegatedDraft.id, delegatedProductId, admin.profileId],
          );
          await setOnlyWorkOrderPermission(
            database, actor, admin.profileId, "work_orders.delete_draft",
          );
          await actAs(database, actor);
          expect((await database.query(
            "select id from public.work_orders where id = $1::uuid",
            [delegatedDraft.id],
          )).rows).toEqual([]);
          await expect(deleteDraftWorkOrder(
            database, delegatedDraft.id, delegatedDraft.updatedAt,
          )).resolves.toEqual({
            work_order_id: delegatedDraft.id,
            work_order_number: delegatedDraft.number,
          });
          await database.query("reset role");

          const deniedDraft = await createDeletionDraft(database, admin.profileId);
          for (const permission of [
            "work_orders.view",
            "work_orders.edit_draft",
            "work_orders.create",
            "work_orders.finish",
            "inventory.view",
            null,
          ] as const) {
            await setOnlyWorkOrderPermission(
              database, actor, admin.profileId, permission,
            );
            await actAs(database, actor);
            await expectRejected(
              database,
              () => deleteDraftWorkOrder(
                database, deniedDraft.id, deniedDraft.updatedAt,
              ),
              "42501",
              "Access denied",
            );
            await database.query("reset role");
          }

          await setOnlyWorkOrderPermission(
            database,
            fixture.actors.inactive,
            admin.profileId,
            "work_orders.delete_draft",
          );
          await actAs(database, fixture.actors.inactive);
          await expectRejected(
            database,
            () => deleteDraftWorkOrder(
              database, deniedDraft.id, deniedDraft.updatedAt,
            ),
            "42501",
            "Access denied",
          );
          await database.query("reset role");

          expect((await database.query(
            "select id from public.work_orders where id = $1::uuid",
            [deniedDraft.id],
          )).rows).toHaveLength(1);
          expect((await database.query(
            `select id from public.audit_logs
             where entity_id = $1::uuid and action_type = 'work_order.deleted'`,
            [deniedDraft.id],
          )).rows).toEqual([]);
        });

        expectPermissionDenied((await fixture.anonymousClient.rpc(
          "delete_draft_work_order",
          {
            p_expected_updated_at: new Date().toISOString(),
            p_work_order_id: randomUUID(),
          },
        )).error);
      });

      it("validates inputs, lifecycle, exact optimistic version, and Finished defense", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const draft = await createDeletionDraft(database, admin.profileId);
          const projectId = await createProject(database, admin.profileId);
          const finishedDraft = await createDeletionDraft(
            database, admin.profileId,
          );
          const finishedId = finishedDraft.id;
          const finishedProductId = await createWorkOrderItemProduct(
            database, admin.profileId,
          );
          await database.query(
            `insert into public.work_order_items (
               work_order_id, product_id, quantity, added_by_user_id
             ) values ($1::uuid, $2::uuid, 4, $3::uuid)`,
            [finishedId, finishedProductId, admin.profileId],
          );
          await database.query(
            `update public.work_orders
             set project_id = $2::uuid,
                 customer_name_snapshot = 'Finished Customer',
                 description = 'Finished work',
                 status = 'finished',
                 finished_at = pg_catalog.now(),
                 finished_by_user_id = $3::uuid
             where id = $1::uuid`,
            [finishedId, projectId, admin.profileId],
          );
          const finishedUpdatedAt = (await database.query<{ updated_at: string }>(
            `select updated_at::text as updated_at from public.work_orders
             where id = $1::uuid`,
            [finishedId],
          )).rows[0]!.updated_at;

          await actAs(database, admin);
          await expectRejected(
            database,
            () => deleteDraftWorkOrder(database, null, draft.updatedAt),
            "22023",
            "Work Order ID is required",
          );
          await expectRejected(
            database,
            () => deleteDraftWorkOrder(database, draft.id, null),
            "22023",
            "Expected Work Order update timestamp is required",
          );
          await expectRejected(
            database,
            () => deleteDraftWorkOrder(database, randomUUID(), draft.updatedAt),
            "P0002",
            "Work Order not found",
          );
          await expectRejected(
            database,
            () => deleteDraftWorkOrder(database, finishedId, finishedUpdatedAt),
            "WOR02",
            "Finished Work Orders cannot be deleted",
          );
          await expectRejected(
            database,
            () => deleteDraftWorkOrder(
              database, draft.id, "2000-01-01T00:00:00Z",
            ),
            "WOR05",
            "Work Order Draft has changed. Reload and try again.",
          );
          await database.query("reset role");

          await expectRejected(
            database,
            () => database.query(
              "delete from public.work_orders where id = $1::uuid",
              [finishedId],
            ),
            "WOR02",
            "Finished Work Orders cannot be deleted",
          );
          expect((await database.query(
            "select id from public.work_orders where id = $1::uuid",
            [finishedId],
          )).rows).toHaveLength(1);
          expect((await database.query(
            `select id from public.work_order_items
             where work_order_id = $1::uuid`,
            [finishedId],
          )).rows).toHaveLength(1);
          expect((await database.query(
            `select id from public.audit_logs
             where entity_id = $1::uuid and action_type = 'work_order.deleted'`,
            [finishedId],
          )).rows).toEqual([]);
        });
      });

      it("deletes only the target Draft and its items with one deterministic audit", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const target = await createDeletionDraft(database, admin.profileId);
          const unrelated = await createDeletionDraft(database, admin.profileId);
          const linkedProjectId = await createProject(database, admin.profileId);
          await database.query(
            `update public.work_orders
             set project_id = $2::uuid,
                 customer_name_snapshot = 'Deletion Snapshot Customer'
             where id = $1::uuid`,
            [target.id, linkedProjectId],
          );
          const firstProductId = await createWorkOrderItemProduct(
            database, admin.profileId,
          );
          const secondProductId = await createWorkOrderItemProduct(
            database, admin.profileId,
          );
          await database.query(
            `insert into public.work_order_items (
               work_order_id, product_id, quantity, added_by_user_id
             ) values
               ($1::uuid, $3::uuid, 7, $5::uuid),
               ($1::uuid, $2::uuid, 3, $5::uuid),
               ($4::uuid, $2::uuid, 11, $5::uuid)`,
            [
              target.id,
              firstProductId,
              secondProductId,
              unrelated.id,
              admin.profileId,
            ],
          );
          const auditCountBefore = Number((await database.query<{ count: string }>(
            "select pg_catalog.count(*)::text as count from public.audit_logs",
          )).rows[0]!.count);

          const before = (await database.query<{
            balances: string;
            movements: string;
            pcb_bom_items: string;
            pcb_bom_versions: string;
            pcb_cards: string;
            pcb_production_runs: string;
            project_components: string;
            project_products: string;
            products: string;
            project_state: unknown;
          }>(
            `select
               (select pg_catalog.count(*)::text from public.inventory_balances)
                 as balances,
               (select pg_catalog.count(*)::text from public.inventory_movements)
                 as movements,
               (select pg_catalog.count(*)::text from public.pcb_bom_items)
                 as pcb_bom_items,
               (select pg_catalog.count(*)::text from public.pcb_bom_versions)
                 as pcb_bom_versions,
               (select pg_catalog.count(*)::text from public.pcb_cards) as pcb_cards,
               (select pg_catalog.count(*)::text from public.pcb_production_runs)
                 as pcb_production_runs,
               (select pg_catalog.count(*)::text
                  from public.project_product_components) as project_components,
               (select pg_catalog.count(*)::text from public.project_products)
                 as project_products,
               (select pg_catalog.count(*)::text from public.products) as products,
               (select pg_catalog.to_jsonb(project_row)
                  from (
                    select name, customer_name, start_date, delivery_date,
                           status, completed_at, cancelled_at, updated_at
                    from public.projects
                    where id = $1::uuid
                  ) as project_row) as project_state`,
            [linkedProjectId],
          )).rows[0];

          await actAs(database, admin);
          await expect(deleteDraftWorkOrder(
            database, target.id, target.updatedAt,
          )).resolves.toEqual({
            work_order_id: target.id,
            work_order_number: target.number,
          });
          await database.query("reset role");

          expect((await database.query(
            "select id from public.work_orders where id = $1::uuid",
            [target.id],
          )).rows).toEqual([]);
          expect((await database.query(
            "select id from public.work_order_items where work_order_id = $1::uuid",
            [target.id],
          )).rows).toEqual([]);
          expect((await database.query(
            "select id from public.work_orders where id = $1::uuid",
            [unrelated.id],
          )).rows).toHaveLength(1);
          expect((await database.query(
            "select product_id, quantity::text as quantity from public.work_order_items where work_order_id = $1::uuid",
            [unrelated.id],
          )).rows).toEqual([{ product_id: firstProductId, quantity: "11" }]);

          const audits = (await database.query<{
            action_type: string;
            actor_user_id: string;
            after_data: unknown;
            before_data: Record<string, unknown>;
            entity_id: string;
            entity_type: string;
            summary: string;
          }>(
            `select actor_user_id, action_type, entity_type, entity_id,
                    summary, before_data, after_data
             from public.audit_logs
             where entity_id = $1::uuid and action_type = 'work_order.deleted'`,
            [target.id],
          )).rows;
          expect(audits).toHaveLength(1);
          expect(Number((await database.query<{ count: string }>(
            "select pg_catalog.count(*)::text as count from public.audit_logs",
          )).rows[0]!.count)).toBe(auditCountBefore + 1);
          expect(audits[0]).toMatchObject({
            action_type: "work_order.deleted",
            actor_user_id: admin.profileId,
            after_data: null,
            entity_id: target.id,
            entity_type: "work_order",
            summary: `Deleted Work Order ${target.number}`,
          });
          expect(audits[0]!.before_data).toEqual({
            customer_name_snapshot: "Deletion Snapshot Customer",
            description: null,
            materials: [
              { product_id: firstProductId, quantity: 3 },
              { product_id: secondProductId, quantity: 7 },
            ].sort((left, right) => left.product_id.localeCompare(right.product_id)),
            project_id: linkedProjectId,
            status: "draft",
            work_order_id: target.id,
            work_order_number: target.number,
          });
          expect(Object.keys(
            (audits[0]!.before_data.materials as Record<string, unknown>[])[0]!,
          ).sort()).toEqual(["product_id", "quantity"]);
          expect((await database.query<{
            balances: string;
            movements: string;
            pcb_bom_items: string;
            pcb_bom_versions: string;
            pcb_cards: string;
            pcb_production_runs: string;
            project_components: string;
            project_products: string;
            products: string;
            project_state: unknown;
          }>(
            `select
               (select pg_catalog.count(*)::text from public.inventory_balances)
                 as balances,
               (select pg_catalog.count(*)::text from public.inventory_movements)
                 as movements,
               (select pg_catalog.count(*)::text from public.pcb_bom_items)
                 as pcb_bom_items,
               (select pg_catalog.count(*)::text from public.pcb_bom_versions)
                 as pcb_bom_versions,
               (select pg_catalog.count(*)::text from public.pcb_cards) as pcb_cards,
               (select pg_catalog.count(*)::text from public.pcb_production_runs)
                 as pcb_production_runs,
               (select pg_catalog.count(*)::text
                  from public.project_product_components) as project_components,
               (select pg_catalog.count(*)::text from public.project_products)
                 as project_products,
               (select pg_catalog.count(*)::text from public.products) as products,
               (select pg_catalog.to_jsonb(project_row)
                  from (
                    select name, customer_name, start_date, delivery_date,
                           status, completed_at, cancelled_at, updated_at
                    from public.projects
                    where id = $1::uuid
                  ) as project_row) as project_state`,
            [linkedProjectId],
          )).rows[0]).toEqual(before);
        });
      });

      it("never reclaims a deleted Work Order number or changes allocator semantics", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const year = await findUnusedWorkOrderYear(database);
          const firstNumber = (await database.query<{ number: string }>(
            `select public.allocate_work_order_number_for_year($1::integer)
               as number`,
            [year],
          )).rows[0]!.number;
          const id = randomUUID();
          await database.query(
            `insert into public.work_orders (
               id, work_order_number, status,
               created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::text, 'draft', $3::uuid, $3::uuid)`,
            [id, firstNumber, admin.profileId],
          );
          const updatedAt = (await database.query<{ updated_at: string }>(
            "select updated_at::text as updated_at from public.work_orders where id = $1::uuid",
            [id],
          )).rows[0]!.updated_at;
          await actAs(database, admin);
          await deleteDraftWorkOrder(database, id, updatedAt);
          await database.query("reset role");

          const secondNumber = (await database.query<{ number: string }>(
            `select public.allocate_work_order_number_for_year($1::integer)
               as number`,
            [year],
          )).rows[0]!.number;
          expect(firstNumber).toBe(`RN-${year}-0001`);
          expect(secondNumber).toBe(`RN-${year}-0002`);
          expect((await database.query(
            `select business_year, last_value
             from public.work_order_number_counters where business_year = $1`,
            [year],
          )).rows).toEqual([{ business_year: year, last_value: 2 }]);
        });
      });

      it("rolls back child and parent deletion when the audit append fails", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const draft = await createDeletionDraft(database, admin.profileId);
          const productId = await createWorkOrderItemProduct(database, admin.profileId);
          await database.query(
            `insert into public.work_order_items (
               work_order_id, product_id, quantity, added_by_user_id
             ) values ($1::uuid, $2::uuid, 5, $3::uuid)`,
            [draft.id, productId, admin.profileId],
          );
          await database.query(
            `create function public.task115a_reject_deletion_audit()
             returns trigger language plpgsql set search_path = '' as $body$
             begin
               if new.action_type = 'work_order.deleted' then
                 raise exception 'Forced deletion audit failure';
               end if;
               return new;
             end;
             $body$`,
          );
          await database.query(
            `create trigger task115a_reject_deletion_audit
             before insert on public.audit_logs
             for each row execute function public.task115a_reject_deletion_audit()`,
          );
          const allocatorBefore = (await database.query(
            `select business_year, last_value
             from public.work_order_number_counters
             order by business_year`,
          )).rows;

          await actAs(database, admin);
          await expectRejected(
            database,
            () => deleteDraftWorkOrder(database, draft.id, draft.updatedAt),
            "P0001",
            "Forced deletion audit failure",
          );
          await database.query("reset role");

          expect((await database.query(
            "select id from public.work_orders where id = $1::uuid",
            [draft.id],
          )).rows).toHaveLength(1);
          expect((await database.query(
            "select id from public.work_order_items where work_order_id = $1::uuid",
            [draft.id],
          )).rows).toHaveLength(1);
          expect((await database.query(
            `select id from public.audit_logs
             where entity_id = $1::uuid and action_type = 'work_order.deleted'`,
            [draft.id],
          )).rows).toEqual([]);
          expect((await database.query(
            `select business_year, last_value
             from public.work_order_number_counters
             order by business_year`,
          )).rows).toEqual(allocatorBefore);
        });
      });

      it("serializes a save winner before a stale delete on the parent row lock", async () => {
        const fixture = requireHarness();
        const actor = fixture.actors.admin;
        const workOrderId = randomUUID();
        const applicationName = `task-115a-delete-${randomUUID()}`;
        const initialUpdatedAt = "2026-09-29 10:00:00+00";
        const winnerUpdatedAt = "2026-09-29 10:01:00+00";
        await fixture.withDatabaseClients(3, async (clients) => {
          const winner = clients[0];
          const deleter = clients[1];
          const observer = clients[2];
          if (!winner || !deleter || !observer) {
            throw new Error("Task 115A concurrency clients unavailable");
          }
          let setupCommitted = false;
          let pending: Promise<
            | { error: unknown; ok: false }
            | { ok: true; value: DeletedDraftWorkOrderRow }
          > | undefined;
          try {
            const year = await findUnusedWorkOrderYear(observer);
            await observer.query(
              `insert into public.work_orders (
                 id, work_order_number, description, status,
                 created_at, created_by_user_id, updated_at, updated_by_user_id
               ) values (
                 $1::uuid, $2::text, 'Original', 'draft',
                 $3::timestamptz, $4::uuid, $3::timestamptz, $4::uuid
               )`,
              [workOrderId, `RN-${year}-0001`, initialUpdatedAt, actor.profileId],
            );
            setupCommitted = true;

            await winner.query("begin");
            await winner.query(
              "select id from public.work_orders where id = $1::uuid for update",
              [workOrderId],
            );
            await deleter.query("begin");
            await deleter.query(
              "select pg_catalog.set_config('application_name', $1, true)",
              [applicationName],
            );
            await actAs(deleter, actor);
            pending = deleteDraftWorkOrder(
              deleter, workOrderId, initialUpdatedAt,
            ).then(
              (value) => ({ ok: true as const, value }),
              (error: unknown) => ({ error, ok: false as const }),
            );
            for (let attempt = 0; attempt < 100; attempt += 1) {
              const row = (await observer.query<{ wait_event_type: string | null }>(
                `select wait_event_type from pg_catalog.pg_stat_activity
                 where application_name = $1::text`,
                [applicationName],
              )).rows[0];
              if (row?.wait_event_type === "Lock") break;
              if (attempt === 99) throw new Error("Expected delete to wait on Work Order lock");
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
            await winner.query(
              `update public.work_orders
               set description = 'Save winner', updated_at = $2::timestamptz,
                   updated_by_user_id = $3::uuid
               where id = $1::uuid`,
              [workOrderId, winnerUpdatedAt, actor.profileId],
            );
            await winner.query("commit");
            expect(await pending).toMatchObject({
              error: { code: "WOR05" },
              ok: false,
            });
            pending = undefined;
            await deleter.query("rollback");
            expect((await observer.query(
              `select description, updated_at::text as updated_at
               from public.work_orders where id = $1::uuid`,
              [workOrderId],
            )).rows).toEqual([{
              description: "Save winner",
              updated_at: winnerUpdatedAt,
            }]);
            expect((await observer.query(
              `select id from public.audit_logs
               where entity_id = $1::uuid and action_type = 'work_order.deleted'`,
              [workOrderId],
            )).rows).toEqual([]);
          } finally {
            await winner.query("rollback").catch(() => undefined);
            if (pending) await pending;
            await deleter.query("rollback").catch(() => undefined);
            if (setupCommitted) {
              await observer.query(
                "delete from public.work_orders where id = $1::uuid",
                [workOrderId],
              );
            }
          }
        });
      });

      it("holds the parent lock so a concurrent Draft save cannot slip through deletion", async () => {
        const fixture = requireHarness();
        const actor = fixture.actors.admin;
        const workOrderId = randomUUID();
        const applicationName = `task-115a-save-${randomUUID()}`;
        const initialUpdatedAt = "2026-09-29 11:00:00+00";
        await fixture.withDatabaseClients(3, async (clients) => {
          const deleter = clients[0];
          const saver = clients[1];
          const observer = clients[2];
          if (!deleter || !saver || !observer) {
            throw new Error("Task 115A concurrency clients unavailable");
          }
          let setupCommitted = false;
          let pending: Promise<
            | { error: unknown; ok: false }
            | { ok: true; value: SavedDraftWorkOrderRow }
          > | undefined;
          try {
            const year = await findUnusedWorkOrderYear(observer);
            await observer.query(
              `insert into public.work_orders (
                 id, work_order_number, description, status,
                 created_at, created_by_user_id, updated_at, updated_by_user_id
               ) values (
                 $1::uuid, $2::text, 'Original', 'draft',
                 $3::timestamptz, $4::uuid, $3::timestamptz, $4::uuid
               )`,
              [workOrderId, `RN-${year}-0001`, initialUpdatedAt, actor.profileId],
            );
            setupCommitted = true;

            await deleter.query("begin");
            await actAs(deleter, actor);
            await expect(deleteDraftWorkOrder(
              deleter, workOrderId, initialUpdatedAt,
            )).resolves.toMatchObject({ work_order_id: workOrderId });

            await saver.query("begin");
            await saver.query(
              "select pg_catalog.set_config('application_name', $1, true)",
              [applicationName],
            );
            await actAs(saver, actor);
            pending = saveDraftWorkOrder(saver, {
              description: "Waiting save",
              expectedUpdatedAt: initialUpdatedAt,
              items: [],
              projectId: null,
              workOrderId,
            }).then(
              (value) => ({ ok: true as const, value }),
              (error: unknown) => ({ error, ok: false as const }),
            );
            for (let attempt = 0; attempt < 100; attempt += 1) {
              const row = (await observer.query<{ wait_event_type: string | null }>(
                `select wait_event_type from pg_catalog.pg_stat_activity
                 where application_name = $1::text`,
                [applicationName],
              )).rows[0];
              if (row?.wait_event_type === "Lock") break;
              if (attempt === 99) {
                throw new Error("Expected save to wait on Work Order delete lock");
              }
              await new Promise((resolve) => setTimeout(resolve, 20));
            }

            await deleter.query("rollback");
            expect(await pending).toMatchObject({
              ok: true,
              value: { work_order_id: workOrderId },
            });
            pending = undefined;
            await saver.query("rollback");

            expect((await observer.query(
              `select description, updated_at::text as updated_at
               from public.work_orders where id = $1::uuid`,
              [workOrderId],
            )).rows).toEqual([{
              description: "Original",
              updated_at: initialUpdatedAt,
            }]);
            expect((await observer.query(
              `select id from public.audit_logs
               where entity_id = $1::uuid and action_type = 'work_order.deleted'`,
              [workOrderId],
            )).rows).toEqual([]);
          } finally {
            await deleter.query("rollback").catch(() => undefined);
            if (pending) await pending;
            await saver.query("rollback").catch(() => undefined);
            if (setupCommitted) {
              await observer.query(
                "delete from public.work_orders where id = $1::uuid",
                [workOrderId],
              );
            }
          }
        });
      });

      it("hardens the RPC and preserves direct browser deletion denial", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const routine = (await database.query<{
            anon_execute: boolean;
            arguments: string;
            authenticated_execute: boolean;
            definition: string;
            language: string;
            public_execute: boolean;
            result: string;
            security_definer: boolean;
            settings: string[];
            volatility: string;
          }>(
            `select pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
                    pg_catalog.pg_get_function_result(routine.oid) as result,
                    pg_catalog.pg_get_functiondef(routine.oid) as definition,
                    language.lanname as language,
                    routine.provolatile as volatility,
                    routine.prosecdef as security_definer,
                    routine.proconfig as settings,
                    pg_catalog.has_function_privilege(
                      'anon', routine.oid, 'execute'
                    ) as anon_execute,
                    pg_catalog.has_function_privilege(
                      'authenticated', routine.oid, 'execute'
                    ) as authenticated_execute,
                    exists (
                      select 1 from pg_catalog.aclexplode(routine.proacl) as privilege
                      where privilege.grantee = 0
                        and privilege.privilege_type = 'EXECUTE'
                    ) as public_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             join pg_catalog.pg_language as language
               on language.oid = routine.prolang
             where namespace.nspname = 'public'
               and routine.proname = 'delete_draft_work_order'`,
          )).rows[0]!;
          expect(routine).toMatchObject({
            anon_execute: false,
            arguments: "p_work_order_id uuid, p_expected_updated_at timestamp with time zone",
            authenticated_execute: true,
            language: "plpgsql",
            public_execute: false,
            result: "TABLE(work_order_id uuid, work_order_number text)",
            security_definer: true,
            settings: ['search_path=""'],
            volatility: "v",
          });
          const definition = routine.definition.toLowerCase();
          expect(definition).toContain("for update");
          expect(definition).toContain("work_orders.delete_draft");
          expect(definition).toContain("append_audit_log");
          expect(definition).not.toContain("inventory_balances");
          expect(definition).not.toContain("inventory_movements");
          expect(definition).not.toContain("work_order_number_counters");

          const tableDeletePrivileges = (await database.query<{
            authenticated_delete: boolean;
            table_name: string;
          }>(
            `select relation.relname as table_name,
                    pg_catalog.has_table_privilege(
                      'authenticated', relation.oid, 'delete'
                    ) as authenticated_delete
             from pg_catalog.pg_class as relation
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = relation.relnamespace
             where namespace.nspname = 'public'
               and relation.relname in ('work_orders', 'work_order_items')
             order by relation.relname`,
          )).rows;
          expect(tableDeletePrivileges).toEqual([
            { authenticated_delete: false, table_name: "work_order_items" },
            { authenticated_delete: false, table_name: "work_orders" },
          ]);
        });

        const directParentDelete = await fixture.actors.admin.client
          .from("work_orders").delete().eq("id", randomUUID());
        expectPermissionDenied(directParentDelete.error);
        const directItemDelete = await fixture.actors.admin.client
          .from("work_order_items").delete().eq("id", randomUUID());
        expectPermissionDenied(directItemDelete.error);
      });

      it.todo(
        "committed delete winner makes a waiting save fail without leaving immutable shared-dev fixtures; run on the disposable concurrency target",
      );
    },
  );

  describe.skipIf(process.env.TASK115A_MIGRATION !== "1")(
    "Task 116 Work Order Draft security regression",
    () => {
      async function setOnlyTask116Permission(
        database: PoolClient,
        actor: SecurityActor,
        adminProfileId: string,
        permissionKey: string,
      ): Promise<void> {
        await database.query(
          `delete from public.user_permissions as permission
           using public.permission_definitions as definition
           where permission.permission_definition_id = definition.id
             and permission.user_id = $1::uuid
             and (
               definition.key like 'work_orders.%'
               or definition.key like 'inventory.%'
               or definition.key like 'projects.%'
             )`,
          [actor.profileId],
        );
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

      it("keeps Work Order actions and cross-domain table authority independent", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const actor = fixture.actors.unpermitted;
          const projectId = await createProject(database, admin.profileId);
          const productId = await createWorkOrderItemProduct(
            database,
            admin.profileId,
          );
          const year = await findUnusedWorkOrderYear(database);
          const workOrderId = await insertWorkOrder(database, {
            actorId: admin.profileId,
            number: `RN-${year}-0001`,
            projectId,
          });
          const expectedUpdatedAt = (await database.query<{
            updated_at: string;
          }>(
            `select updated_at::text as updated_at
             from public.work_orders where id = $1::uuid`,
            [workOrderId],
          )).rows[0]!.updated_at;
          const before = (await database.query(
            `select
               (select pg_catalog.to_jsonb(work_order)
                  from public.work_orders as work_order
                  where work_order.id = $1::uuid) as work_order,
               (select pg_catalog.count(*)::text from public.audit_logs
                  where entity_id = $1::uuid) as audits,
               (select pg_catalog.to_jsonb(product)
                  from public.products as product
                  where product.id = $2::uuid) as product,
               (select pg_catalog.to_jsonb(balance)
                  from public.inventory_balances as balance
                  where balance.product_id = $2::uuid) as balance,
               (select pg_catalog.to_jsonb(project)
                  from public.projects as project
                  where project.id = $3::uuid) as project`,
            [workOrderId, productId, projectId],
          )).rows[0];

          for (const permissionKey of ["inventory.view", "projects.view"]) {
            await setOnlyTask116Permission(
              database,
              actor,
              admin.profileId,
              permissionKey,
            );
            await actAs(database, actor);
            await expectRejected(
              database,
              () => createDraftWorkOrder(database),
              "42501",
              "Access denied",
            );
            await expectRejected(
              database,
              () => updateDraftWorkOrder(database, {
                description: "Denied cross-domain edit",
                expectedUpdatedAt,
                projectId,
                workOrderId,
              }),
              "42501",
              "Access denied",
            );
            await expectRejected(
              database,
              () => saveDraftWorkOrder(database, {
                description: "Denied cross-domain save",
                expectedUpdatedAt,
                items: [{ product_id: productId, quantity: "1" }],
                projectId,
                workOrderId,
              }),
              "42501",
              "Access denied",
            );
            await expectRejected(
              database,
              () => deleteDraftWorkOrder(
                database,
                workOrderId,
                expectedUpdatedAt,
              ),
              "42501",
              "Access denied",
            );
            await database.query("reset role");
          }

          for (const permissionKey of [
            "work_orders.view",
            "work_orders.create",
            "work_orders.edit_draft",
            "work_orders.finish",
            "work_orders.delete_draft",
          ]) {
            await setOnlyTask116Permission(
              database,
              actor,
              admin.profileId,
              permissionKey,
            );
            await actAs(database, actor);
            expect((await database.query(
              "select id from public.products where id = $1::uuid",
              [productId],
            )).rows).toEqual([]);
            expect((await database.query(
              `select product_id from public.inventory_balances
               where product_id = $1::uuid`,
              [productId],
            )).rows).toEqual([]);
            expect((await database.query(
              "select id from public.projects where id = $1::uuid",
              [projectId],
            )).rows).toEqual([]);
            await expectRejected(
              database,
              () => database.query(
                "update public.products set name = name where id = $1::uuid",
                [productId],
              ),
              "42501",
            );
            await expectRejected(
              database,
              () => database.query(
                `update public.inventory_balances set quantity = quantity
                 where product_id = $1::uuid`,
                [productId],
              ),
              "42501",
            );
            await expectRejected(
              database,
              () => database.query(
                "update public.projects set name = name where id = $1::uuid",
                [projectId],
              ),
              "42501",
            );
            await database.query("reset role");
          }

          expect((await database.query(
            `select
               (select pg_catalog.to_jsonb(work_order)
                  from public.work_orders as work_order
                  where work_order.id = $1::uuid) as work_order,
               (select pg_catalog.count(*)::text from public.audit_logs
                  where entity_id = $1::uuid) as audits,
               (select pg_catalog.to_jsonb(product)
                  from public.products as product
                  where product.id = $2::uuid) as product,
               (select pg_catalog.to_jsonb(balance)
                  from public.inventory_balances as balance
                  where balance.product_id = $2::uuid) as balance,
               (select pg_catalog.to_jsonb(project)
                  from public.projects as project
                  where project.id = $3::uuid) as project`,
            [workOrderId, productId, projectId],
          )).rows[0]).toEqual(before);
        });
      });

      it("keeps a complete multi-Draft lifecycle non-allocating and Inventory-neutral", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const projectId = await createProject(database, admin.profileId);
          const productId = await createWorkOrderItemProduct(
            database,
            admin.profileId,
          );
          await database.query(
            `update public.inventory_balances
             set quantity = 7, updated_at = pg_catalog.clock_timestamp()
             where product_id = $1::uuid`,
            [productId],
          );
          const projectProductId = randomUUID();
          await database.query(
            `insert into public.project_products (
               id, project_id, name, created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::uuid, $3::text, $4::uuid, $4::uuid)`,
            [
              projectProductId,
              projectId,
              "Task 116 planned assembly",
              admin.profileId,
            ],
          );
          await database.query(
            `insert into public.project_product_components (
               project_product_id, product_id, required_quantity,
               created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::uuid, 5, $3::uuid, $3::uuid)`,
            [projectProductId, productId, admin.profileId],
          );
          const before = (await database.query(
            `select
               (select pg_catalog.to_jsonb(product)
                  from public.products as product
                  where product.id = $1::uuid) as product,
               (select pg_catalog.to_jsonb(balance)
                  from public.inventory_balances as balance
                  where balance.product_id = $1::uuid) as balance,
               (select pg_catalog.count(*)::text
                  from public.inventory_movements as movement
                  where movement.product_id = $1::uuid) as movements,
               (select pg_catalog.to_jsonb(project)
                  from public.projects as project
                  where project.id = $2::uuid) as project,
               (select pg_catalog.to_jsonb(project_product)
                  from public.project_products as project_product
                  where project_product.id = $3::uuid) as project_product,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(component)
                  order by component.id)
                  from public.project_product_components as component
                  where component.project_product_id = $3::uuid) as components,
               (select pg_catalog.count(*)::text from public.product_suppliers
                  where product_id = $1::uuid) as product_suppliers,
               (select pg_catalog.count(*)::text from public.procurement_requests
                  where product_id = $1::uuid) as procurement_requests,
               (select pg_catalog.count(*)::text from public.pcb_cards
                  where output_product_id = $1::uuid) as pcb_cards,
               (select pg_catalog.count(*)::text from public.pcb_bom_items
                  where component_product_id = $1::uuid) as pcb_bom_items,
               (select pg_catalog.count(*)::text from public.audit_logs
                  where entity_type = 'work_order_item') as item_audits`,
            [productId, projectId, projectProductId],
          )).rows[0];

          await actAs(database, admin);
          const first = await createDraftWorkOrder(database);
          const second = await createDraftWorkOrder(database);
          expect(first.work_order_number).toMatch(/^RN-[0-9]{4}-[0-9]{4}$/);
          expect(second.work_order_number).toMatch(/^RN-[0-9]{4}-[0-9]{4}$/);
          expect(second.work_order_number).not.toBe(first.work_order_number);

          for (const draft of [first, second]) {
            const initialUpdatedAt = (await database.query<{
              updated_at: string;
            }>(
              `select updated_at::text as updated_at
               from public.work_orders where id = $1::uuid`,
              [draft.work_order_id],
            )).rows[0]!.updated_at;
            const serialNumber = (await database.query<{
              serial_number: string;
            }>(
              "select serial_number from public.products where id = $1::uuid",
              [productId],
            )).rows[0]!.serial_number;
            expect(await resolveWorkOrderProductBarcode(
              database,
              draft.work_order_id,
              serialNumber,
            )).toHaveLength(1);
            expect(await getWorkOrderMaterialInventory(
              database,
              draft.work_order_id,
              productId,
            )).toEqual([{ current_inventory: "7", product_id: productId }]);
            const saved = await saveDraftWorkOrder(database, {
              description: "Task 116 Draft",
              expectedUpdatedAt: initialUpdatedAt,
              items: [{ product_id: productId, quantity: "4" }],
              projectId,
              workOrderId: draft.work_order_id,
            });
            expect(await listDraftWorkOrderMaterials(
              database,
              draft.work_order_id,
            )).toMatchObject([{
              current_inventory: "7",
              product_id: productId,
              quantity: "4",
            }]);
            await deleteDraftWorkOrder(
              database,
              draft.work_order_id,
              saved.updated_at,
            );
          }
          await database.query("reset role");

          expect((await database.query(
            `select
               (select pg_catalog.to_jsonb(product)
                  from public.products as product
                  where product.id = $1::uuid) as product,
               (select pg_catalog.to_jsonb(balance)
                  from public.inventory_balances as balance
                  where balance.product_id = $1::uuid) as balance,
               (select pg_catalog.count(*)::text
                  from public.inventory_movements as movement
                  where movement.product_id = $1::uuid) as movements,
               (select pg_catalog.to_jsonb(project)
                  from public.projects as project
                  where project.id = $2::uuid) as project,
               (select pg_catalog.to_jsonb(project_product)
                  from public.project_products as project_product
                  where project_product.id = $3::uuid) as project_product,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(component)
                  order by component.id)
                  from public.project_product_components as component
                  where component.project_product_id = $3::uuid) as components,
               (select pg_catalog.count(*)::text from public.product_suppliers
                  where product_id = $1::uuid) as product_suppliers,
               (select pg_catalog.count(*)::text from public.procurement_requests
                  where product_id = $1::uuid) as procurement_requests,
               (select pg_catalog.count(*)::text from public.pcb_cards
                  where output_product_id = $1::uuid) as pcb_cards,
               (select pg_catalog.count(*)::text from public.pcb_bom_items
                  where component_product_id = $1::uuid) as pcb_bom_items,
               (select pg_catalog.count(*)::text from public.audit_logs
                  where entity_type = 'work_order_item') as item_audits`,
            [productId, projectId, projectProductId],
          )).rows[0]).toEqual(before);
          expect((await database.query(
            `select id from public.work_orders
             where id = any($1::uuid[])`,
            [[first.work_order_id, second.work_order_id]],
          )).rows).toEqual([]);
          expect((await database.query(
            `select id from public.work_order_items
             where work_order_id = any($1::uuid[])`,
            [[first.work_order_id, second.work_order_id]],
          )).rows).toEqual([]);
          expect((await database.query<{
            action_type: string;
            count: string;
          }>(
            `select action_type, pg_catalog.count(*)::text as count
             from public.audit_logs
             where entity_id = any($1::uuid[])
             group by action_type
             order by action_type`,
            [[first.work_order_id, second.work_order_id]],
          )).rows).toEqual([
            { action_type: "work_order.created", count: "2" },
            { action_type: "work_order.deleted", count: "2" },
            { action_type: "work_order.updated", count: "2" },
          ]);
        });
      });
    },
  );
}
