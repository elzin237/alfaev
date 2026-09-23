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
              "delete_draft_work_order", "finish_work_order",
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
}
