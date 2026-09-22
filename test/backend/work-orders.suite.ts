import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

interface WorkOrderRow {
  customer_name_snapshot: string;
  description: string;
  finished_at: Date | null;
  finished_by_user_id: string | null;
  id: string;
  project_id: string;
  status: "draft" | "finished";
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
            .toMatchObject({ data_type: "uuid", is_nullable: "NO" });
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
              "allocate_work_order_number", "create_work_order",
              "update_work_order", "delete_draft_work_order", "finish_work_order",
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
}
