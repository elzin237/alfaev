import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { expectPermissionDenied } from "./helpers/assertions";
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
): Promise<void> {
  await database.query("savepoint rejected_work_order_operation");
  await expect(operation()).rejects.toMatchObject({ code });
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

          const firstId = await insertWorkOrder(database, {
            actorId, number: "RN-2026-0001", projectId,
          });
          const secondId = await insertWorkOrder(database, {
            actorId, number: "RN-2026-0002", projectId,
          });
          const finishedId = await insertWorkOrder(database, {
            actorId, number: "RN-2026-0003", projectId, status: "finished",
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
              actorId, number: "RN-2026-0001", projectId,
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
          await insertWorkOrder(database, {
            actorId: actor.profileId,
            number: `RN-${businessYear}-0001`,
            projectId,
          });
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
            [`RN-${businessYear}-0001`],
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
}
