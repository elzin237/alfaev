import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { expectPermissionDenied } from "./helpers/assertions";
import { createTestSerialNumber } from "./helpers/serial";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

interface FinishPreflightRow {
  available_quantity: string;
  customer_name_snapshot: string;
  description: string;
  inventory_sufficient: boolean;
  item_count: string;
  missing_quantity: string;
  product_id: string;
  product_name: string;
  project_id: string;
  project_name: string;
  required_quantity: string;
  serial_number: string;
  updated_at: string;
  work_order_id: string;
  work_order_number: string;
}

interface PreflightFixture {
  productId: string;
  projectId: string | null;
  updatedAt: string;
  workOrderId: string;
  workOrderNumber: string;
}

export async function actAs(
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

export async function expectRejected(
  database: PoolClient,
  operation: () => Promise<unknown>,
  code: string,
  message?: string,
): Promise<void> {
  await database.query("savepoint rejected_finish_preflight");
  await expect(operation()).rejects.toMatchObject(
    message ? { code, message } : { code },
  );
  await database.query("rollback to savepoint rejected_finish_preflight");
}

export async function setOnlyRelevantPermission(
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

async function findUnusedWorkOrderYear(database: PoolClient): Promise<number> {
  const result = await database.query<{ business_year: number }>(
    `select candidate.business_year
     from pg_catalog.generate_series(9000, 9999) as candidate(business_year)
     where not exists (
       select 1 from public.work_orders as work_order
       where work_order.work_order_number like
         'RN-' || candidate.business_year::text || '-%'
     )
     order by candidate.business_year
     limit 1`,
  );
  const year = result.rows[0]?.business_year;
  if (!year) throw new Error("No isolated preflight Work Order year available");
  return year;
}

async function addRequirement(
  database: PoolClient,
  actorId: string,
  projectId: string,
  productId: string,
  quantity: string,
): Promise<void> {
  const projectProductId = randomUUID();
  await database.query(
    `insert into public.project_products (
       id, project_id, name, created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::uuid, $3::text, $4::uuid, $4::uuid)`,
    [projectProductId, projectId, `Preflight group ${projectProductId}`, actorId],
  );
  await database.query(
    `insert into public.project_product_components (
       project_product_id, product_id, required_quantity,
       created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::uuid, $3::bigint, $4::uuid, $4::uuid)`,
    [projectProductId, productId, quantity, actorId],
  );
}

export async function createPreflightFixture(
  database: PoolClient,
  actorId: string,
  options: {
    customer?: string | null;
    description?: string | null;
    includeItem?: boolean;
    includeProject?: boolean;
    itemQuantity?: string;
    physicalQuantity?: string;
    productKind?: "component" | "pcb_finished_good";
    projectStatus?: "cancelled" | "completed" | "in_progress" | "on_hold" | "planned";
    requiredQuantity?: string;
  } = {},
): Promise<PreflightFixture> {
  const includeProject = options.includeProject ?? true;
  const projectStatus = options.projectStatus ?? "planned";
  const projectId = includeProject ? randomUUID() : null;
  if (projectId) {
    await database.query(
      `insert into public.projects (
         id, name, customer_name, status, start_date, delivery_date,
         created_by_user_id, updated_by_user_id, completed_at, cancelled_at
       ) values (
         $1::uuid, $2::text, $3::text, $4::text,
         '2026-09-29'::date, '2026-10-29'::date,
         $5::uuid, $5::uuid, $6::timestamptz, $7::timestamptz
       )`,
      [
        projectId,
        `Preflight Project ${projectId}`,
        `Preflight Customer ${projectId}`,
        projectStatus,
        actorId,
        projectStatus === "completed" ? "2026-10-29T12:00:00Z" : null,
        projectStatus === "cancelled" ? "2026-10-20T12:00:00Z" : null,
      ],
    );
  }

  const productId = randomUUID();
  await database.query(
    `insert into public.products (
       id, serial_number, name, category, product_kind,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, $3::text, 'Work Order', $4::text,
       $5::uuid, $5::uuid
     )`,
    [
      productId,
      createTestSerialNumber(),
      `Preflight Product ${productId}`,
      options.productKind ?? "component",
      actorId,
    ],
  );
  await database.query(
    `update public.inventory_balances
     set quantity = $2::bigint, updated_at = pg_catalog.clock_timestamp()
     where product_id = $1::uuid`,
    [productId, options.physicalQuantity ?? "10"],
  );
  if (projectId) {
    await addRequirement(
      database,
      actorId,
      projectId,
      productId,
      options.requiredQuantity ?? "10",
    );
  }

  const workOrderId = randomUUID();
  const workOrderNumber = `RN-${await findUnusedWorkOrderYear(database)}-0001`;
  const updatedAt = "2026-09-29 12:34:56.123456+00";
  await database.query(
    `insert into public.work_orders (
       id, work_order_number, project_id, customer_name_snapshot,
       description, created_at, created_by_user_id,
       updated_at, updated_by_user_id
     ) values (
       $1::uuid, $2::text, $3::uuid, $4::text, $5::text,
       $6::timestamptz, $7::uuid, $6::timestamptz, $7::uuid
     )`,
    [
      workOrderId,
      workOrderNumber,
      projectId,
      options.customer === undefined
        ? (projectId ? `Preflight Customer ${projectId}` : null)
        : options.customer,
      options.description === undefined ? "Preflight assembly" : options.description,
      updatedAt,
      actorId,
    ],
  );
  if (options.includeItem ?? true) {
    await database.query(
      `insert into public.work_order_items (
         work_order_id, product_id, quantity, added_by_user_id
       ) values ($1::uuid, $2::uuid, $3::bigint, $4::uuid)`,
      [workOrderId, productId, options.itemQuantity ?? "4", actorId],
    );
  }
  return { productId, projectId, updatedAt, workOrderId, workOrderNumber };
}

async function preflightFinishWorkOrder(
  database: PoolClient,
  workOrderId: string | null,
  expectedUpdatedAt: string | null,
): Promise<FinishPreflightRow[]> {
  return (await database.query<FinishPreflightRow>(
    `select
       preflight.work_order_id,
       preflight.work_order_number,
       preflight.project_id,
       preflight.project_name,
       preflight.customer_name_snapshot,
       preflight.description,
       preflight.updated_at::text as updated_at,
       preflight.item_count::text as item_count,
       preflight.inventory_sufficient,
       preflight.product_id,
       preflight.serial_number,
       preflight.product_name,
       preflight.required_quantity::text as required_quantity,
       preflight.available_quantity::text as available_quantity,
       preflight.missing_quantity::text as missing_quantity
     from public.preflight_finish_work_order(
       $1::uuid, $2::timestamptz
     ) as preflight`,
    [workOrderId, expectedUpdatedAt],
  )).rows;
}

async function waitForLockWait(
  observer: PoolClient,
  applicationName: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
  throw new Error(`Expected ${applicationName} to wait on a row lock`);
}

async function cleanupCommittedPreflightData(
  database: PoolClient,
  values: {
    productIds: string[];
    projectIds: string[];
    workOrderIds: string[];
  },
): Promise<void> {
  await database.query("begin");
  try {
    await database.query(
      "delete from public.work_order_items where work_order_id = any($1::uuid[])",
      [values.workOrderIds],
    );
    await database.query(
      "delete from public.work_orders where id = any($1::uuid[])",
      [values.workOrderIds],
    );
    await database.query(
      `delete from public.project_product_components
       where project_product_id in (
         select project_product.id
         from public.project_products as project_product
         where project_product.project_id = any($1::uuid[])
       )`,
      [values.projectIds],
    );
    await database.query(
      "delete from public.project_products where project_id = any($1::uuid[])",
      [values.projectIds],
    );
    await database.query(
      "delete from public.inventory_balances where product_id = any($1::uuid[])",
      [values.productIds],
    );
    await database.query(
      "delete from public.products where id = any($1::uuid[])",
      [values.productIds],
    );
    await database.query(
      "delete from public.projects where id = any($1::uuid[])",
      [values.projectIds],
    );
    await database.query("commit");
  } catch (error) {
    await database.query("rollback");
    throw error;
  }
}

export function registerWorkOrderFinishPreflightTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe.skipIf(process.env.TASK117_MIGRATION !== "1")(
    "Task 117 Work Order Finish preflight (requires deployed migration)",
    () => {
      it("enforces the exact Finish authority and trusted narrow function metadata", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const actor = fixture.actors.unpermitted;
          const state = await createPreflightFixture(database, admin.profileId);

          await actAs(database, admin);
          expect(await preflightFinishWorkOrder(
            database, state.workOrderId, state.updatedAt,
          )).toHaveLength(1);
          await database.query("reset role");

          await setOnlyRelevantPermission(
            database, actor, admin.profileId, "work_orders.finish",
          );
          await actAs(database, actor);
          const permitted = await preflightFinishWorkOrder(
            database, state.workOrderId, state.updatedAt,
          );
          expect(permitted[0]).toMatchObject({
            project_id: state.projectId,
            work_order_id: state.workOrderId,
          });
          expect((await database.query(
            "select id from public.projects where id = $1::uuid",
            [state.projectId],
          )).rows).toEqual([]);
          await database.query("reset role");

          for (const permissionKey of [
            null,
            "work_orders.view",
            "work_orders.edit_draft",
            "work_orders.create",
            "work_orders.delete_draft",
            "inventory.view",
            "projects.view",
          ]) {
            await setOnlyRelevantPermission(
              database, actor, admin.profileId, permissionKey,
            );
            await actAs(database, actor);
            await expectRejected(
              database,
              () => preflightFinishWorkOrder(
                database, state.workOrderId, state.updatedAt,
              ),
              "42501",
              "Access denied",
            );
            await database.query("reset role");
          }

          await setOnlyRelevantPermission(
            database,
            fixture.actors.inactive,
            admin.profileId,
            "work_orders.finish",
          );
          await actAs(database, fixture.actors.inactive);
          await expectRejected(
            database,
            () => preflightFinishWorkOrder(
              database, state.workOrderId, state.updatedAt,
            ),
            "42501",
          );
          await database.query("reset role");

          const metadata = (await database.query<{
            anon_execute: boolean;
            arguments: string;
            authenticated_execute: boolean;
            definition: string;
            language: string;
            public_execute: boolean;
            result: string;
            security_definer: boolean;
            settings: string[] | null;
            volatility: string;
          }>(
            `select
               pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
               pg_catalog.pg_get_function_result(routine.oid) as result,
               language.lanname as language,
               routine.provolatile as volatility,
               routine.prosecdef as security_definer,
               routine.proconfig as settings,
               pg_catalog.pg_get_functiondef(routine.oid) as definition,
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
               and routine.proname = 'preflight_finish_work_order'`,
          )).rows[0]!;
          expect(metadata).toMatchObject({
            anon_execute: false,
            arguments: "p_work_order_id uuid, p_expected_updated_at timestamp with time zone",
            authenticated_execute: true,
            language: "plpgsql",
            public_execute: false,
            security_definer: true,
            settings: ['search_path=""'],
            volatility: "v",
          });
          expect(metadata.result).toBe(
            "TABLE(work_order_id uuid, work_order_number text, project_id uuid, project_name text, customer_name_snapshot text, description text, updated_at timestamp with time zone, item_count bigint, inventory_sufficient boolean, product_id uuid, serial_number text, product_name text, required_quantity bigint, available_quantity bigint, missing_quantity bigint)",
          );
          const definition = metadata.definition.toLowerCase();
          expect(definition).toContain("for update");
          expect(definition).toContain("for share");
          expect(definition).toContain("for update of balance");
          expect(definition).not.toContain("for share of balance");
          expect(definition).not.toContain("insert into public.");
          expect(definition).not.toContain("delete from public.");
          expect(definition).not.toContain("update public.");
          expect(definition).not.toContain("append_audit_log");
          expect(definition).not.toContain("apply_inventory_delta");
        });

        const anonymous = await fixture.anonymousClient.rpc(
          "preflight_finish_work_order",
          {
            p_expected_updated_at: "2026-09-29T12:34:56.123456Z",
            p_work_order_id: randomUUID(),
          },
        );
        expectPermissionDenied(anonymous.error);
      });

      it("rejects invalid identity, stale/lifecycle, incomplete content, and unavailable Projects without mutation", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const valid = await createPreflightFixture(database, admin.profileId);
          await actAs(database, admin);
          await expectRejected(
            database,
            () => preflightFinishWorkOrder(database, null, valid.updatedAt),
            "22023",
          );
          await expectRejected(
            database,
            () => preflightFinishWorkOrder(database, valid.workOrderId, null),
            "22023",
          );
          await expectRejected(
            database,
            () => preflightFinishWorkOrder(
              database, randomUUID(), valid.updatedAt,
            ),
            "P0002",
          );
          await expectRejected(
            database,
            () => preflightFinishWorkOrder(
              database,
              valid.workOrderId,
              "2026-09-29 12:34:56.123455+00",
            ),
            "WOR05",
            "Work Order Draft has changed. Reload and try again.",
          );
          await database.query("reset role");

          const incompleteStates = [
            await createPreflightFixture(database, admin.profileId, {
              includeProject: false,
            }),
            await createPreflightFixture(database, admin.profileId, {
              customer: null,
            }),
            await createPreflightFixture(database, admin.profileId, {
              description: null,
            }),
            await createPreflightFixture(database, admin.profileId, {
              includeItem: false,
            }),
          ];
          await actAs(database, admin);
          for (const state of incompleteStates) {
            await expectRejected(
              database,
              () => preflightFinishWorkOrder(
                database, state.workOrderId, state.updatedAt,
              ),
              "WOR07",
              "Work Order is incomplete for Finish",
            );
          }
          await database.query("reset role");

          for (const status of ["planned", "in_progress", "on_hold"] as const) {
            const open = await createPreflightFixture(database, admin.profileId, {
              projectStatus: status,
            });
            await actAs(database, admin);
            expect(await preflightFinishWorkOrder(
              database, open.workOrderId, open.updatedAt,
            )).toHaveLength(1);
            await database.query("reset role");
          }
          for (const status of ["completed", "cancelled"] as const) {
            const closed = await createPreflightFixture(database, admin.profileId, {
              projectStatus: status,
            });
            await actAs(database, admin);
            await expectRejected(
              database,
              () => preflightFinishWorkOrder(
                database, closed.workOrderId, closed.updatedAt,
              ),
              "WOR08",
              "Project is unavailable for Work Order Finish",
            );
            await database.query("reset role");
          }

          await database.query(
            `update public.work_orders
             set status = 'finished',
                 finished_at = pg_catalog.clock_timestamp(),
                 finished_by_user_id = $2::uuid
             where id = $1::uuid`,
            [valid.workOrderId, admin.profileId],
          );
          await actAs(database, admin);
          await expectRejected(
            database,
            () => preflightFinishWorkOrder(
              database, valid.workOrderId, valid.updatedAt,
            ),
            "WOR02",
          );
        });
      });

      it("revalidates current planning, other Drafts, physical consumption, and Product lifecycle", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const state = await createPreflightFixture(database, admin.profileId, {
            itemQuantity: "4",
            physicalQuantity: "20",
            requiredQuantity: "6",
          });
          await addRequirement(
            database,
            admin.profileId,
            state.projectId!,
            state.productId,
            "4",
          );
          const otherProject = await createPreflightFixture(
            database,
            admin.profileId,
            { itemQuantity: "100", requiredQuantity: "100" },
          );
          const otherDraftId = randomUUID();
          await database.query(
            `insert into public.work_orders (
               id, work_order_number, project_id, customer_name_snapshot,
               description, created_by_user_id, updated_by_user_id
             ) values (
               $1::uuid, $2::text, $3::uuid, 'Customer', 'Other Draft',
               $4::uuid, $4::uuid
             )`,
            [
              otherDraftId,
              `RN-${await findUnusedWorkOrderYear(database)}-0001`,
              state.projectId,
              admin.profileId,
            ],
          );
          await database.query(
            `insert into public.work_order_items (
               work_order_id, product_id, quantity, added_by_user_id
             ) values ($1::uuid, $2::uuid, 3, $3::uuid)`,
            [otherDraftId, state.productId, admin.profileId],
          );
          const excludedOtherProjectDraftId = randomUUID();
          const excludedFinishedId = randomUUID();
          await database.query(
            `insert into public.work_orders (
               id, work_order_number, project_id, customer_name_snapshot,
               description, created_by_user_id, updated_by_user_id
             ) values
               ($1::uuid, $2::text, $3::uuid, 'Other Customer',
                'Other Project Draft', $4::uuid, $4::uuid),
               ($5::uuid, $6::text, $7::uuid, 'Customer',
                'Finished Work Order', $4::uuid, $4::uuid)`,
            [
              excludedOtherProjectDraftId,
              `RN-${await findUnusedWorkOrderYear(database)}-0001`,
              otherProject.projectId,
              admin.profileId,
              excludedFinishedId,
              `RN-${await findUnusedWorkOrderYear(database)}-0002`,
              state.projectId,
            ],
          );
          await database.query(
            `insert into public.work_order_items (
               work_order_id, product_id, quantity, added_by_user_id
             ) values
               ($1::uuid, $3::uuid, 100, $4::uuid),
               ($2::uuid, $3::uuid, 100, $4::uuid)`,
            [
              excludedOtherProjectDraftId,
              excludedFinishedId,
              state.productId,
              admin.profileId,
            ],
          );
          await database.query(
            `update public.work_orders
             set status = 'finished',
                 finished_at = pg_catalog.clock_timestamp(),
                 finished_by_user_id = $2::uuid
             where id = $1::uuid`,
            [excludedFinishedId, admin.profileId],
          );
          await database.query(
            `insert into public.inventory_movements (
               product_id, movement_type, quantity_delta, quantity_before,
               quantity_after, source_type, source_id, project_id,
               actor_user_id
             ) values
               ($1::uuid, 'work_order_finished', -3, 20, 17,
                'work_order', $2::uuid, $3::uuid, $4::uuid),
               ($1::uuid, 'work_order_finished', -10, 20, 10,
                'work_order', $5::uuid, $6::uuid, $4::uuid)`,
            [
              state.productId,
              randomUUID(),
              state.projectId,
              admin.profileId,
              randomUUID(),
              otherProject.projectId,
            ],
          );

          await actAs(database, admin);
          expect(await preflightFinishWorkOrder(
            database, state.workOrderId, state.updatedAt,
          )).toHaveLength(1);
          await database.query("reset role");

          await database.query(
            `update public.project_product_components as component
             set required_quantity = component.required_quantity - 1
             where component.product_id = $1::uuid
               and component.project_product_id in (
                 select project_product.id
                 from public.project_products as project_product
                 where project_product.project_id = $2::uuid
               )`,
            [state.productId, state.projectId],
          );
          const before = (await database.query(
            `select
               pg_catalog.to_jsonb(work_order) as work_order,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item) order by item.id)
                from public.work_order_items as item
                where item.work_order_id = work_order.id) as items,
               (select pg_catalog.count(*)::text
                from public.audit_logs as audit
                where audit.entity_id = work_order.id) as audits,
               (select pg_catalog.to_jsonb(balance)
                from public.inventory_balances as balance
                where balance.product_id = $2::uuid) as balance
             from public.work_orders as work_order
             where work_order.id = $1::uuid`,
            [state.workOrderId, state.productId],
          )).rows[0];
          await actAs(database, admin);
          await expectRejected(
            database,
            () => preflightFinishWorkOrder(
              database, state.workOrderId, state.updatedAt,
            ),
            "WOR06",
            "Draft materials exceed the remaining Project requirement",
          );
          await database.query("reset role");
          expect((await database.query(
            `select
               pg_catalog.to_jsonb(work_order) as work_order,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item) order by item.id)
                from public.work_order_items as item
                where item.work_order_id = work_order.id) as items,
               (select pg_catalog.count(*)::text
                from public.audit_logs as audit
                where audit.entity_id = work_order.id) as audits,
               (select pg_catalog.to_jsonb(balance)
                from public.inventory_balances as balance
                where balance.product_id = $2::uuid) as balance
             from public.work_orders as work_order
             where work_order.id = $1::uuid`,
            [state.workOrderId, state.productId],
          )).rows[0]).toEqual(before);

          await database.query(
            `update public.project_product_components as component
             set required_quantity = component.required_quantity + 1
             where component.product_id = $1::uuid
               and component.project_product_id in (
                 select project_product.id
                 from public.project_products as project_product
                 where project_product.project_id = $2::uuid
               )`,
            [state.productId, state.projectId],
          );
          await database.query(
            `update public.products
             set is_active = false,
                 archived_at = pg_catalog.clock_timestamp(),
                 archived_by_user_id = $2::uuid
             where id = $1::uuid`,
            [state.productId, admin.profileId],
          );
          await actAs(database, admin);
          await expectRejected(
            database,
            () => preflightFinishWorkOrder(
              database, state.workOrderId, state.updatedAt,
            ),
            "PRD05",
            "Product is unavailable for Work Order",
          );
        });
      });

      it("returns exact deterministic physical-stock shortages through the approved narrow projection without side effects", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const admin = fixture.actors.admin;
          const state = await createPreflightFixture(database, admin.profileId, {
            itemQuantity: "10",
            physicalQuantity: "20",
            requiredQuantity: "100",
          });
          const secondProductId = randomUUID();
          await database.query(
            `insert into public.products (
               id, serial_number, name, category, product_kind,
               created_by_user_id, updated_by_user_id
             ) values (
               $1::uuid, $2::text, 'Second Preflight Product',
               'Work Order', 'pcb_finished_good', $3::uuid, $3::uuid
             )`,
            [secondProductId, createTestSerialNumber(), admin.profileId],
          );
          await database.query(
            `update public.inventory_balances
             set quantity = 2
             where product_id = $1::uuid`,
            [secondProductId],
          );
          await addRequirement(
            database,
            admin.profileId,
            state.projectId!,
            secondProductId,
            "10",
          );
          await database.query(
            `insert into public.work_order_items (
               work_order_id, product_id, quantity, added_by_user_id
             ) values ($1::uuid, $2::uuid, 5, $3::uuid)`,
            [state.workOrderId, secondProductId, admin.profileId],
          );
          const before = (await database.query(
            `select
               (select pg_catalog.to_jsonb(work_order)
                from public.work_orders as work_order
                where work_order.id = $1::uuid) as work_order,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item) order by item.id)
                from public.work_order_items as item
                where item.work_order_id = $1::uuid) as items,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(balance)
                order by balance.product_id)
                from public.inventory_balances as balance
                where balance.product_id = any($2::uuid[])) as balances,
               (select pg_catalog.count(*)::text
                from public.inventory_movements as movement
                where movement.product_id = any($2::uuid[])) as movements,
               (select pg_catalog.count(*)::text
                from public.audit_logs as audit
                where audit.entity_id = $1::uuid) as audits`,
            [state.workOrderId, [state.productId, secondProductId]],
          )).rows[0];

          await actAs(database, admin);
          const rows = await preflightFinishWorkOrder(
            database, state.workOrderId, state.updatedAt,
          );
          await database.query("reset role");
          expect(rows).toHaveLength(2);
          expect(rows.map((row) => row.serial_number))
            .toEqual([...rows.map((row) => row.serial_number)].sort());
          expect(rows.every((row) => row.item_count === "2")).toBe(true);
          expect(rows.every((row) => row.inventory_sufficient === false)).toBe(true);
          expect(rows.find((row) => row.product_id === state.productId))
            .toMatchObject({
              available_quantity: "20",
              missing_quantity: "0",
              required_quantity: "10",
              updated_at: state.updatedAt,
              work_order_id: state.workOrderId,
              work_order_number: state.workOrderNumber,
            });
          expect(rows.find((row) => row.product_id === secondProductId))
            .toMatchObject({
              available_quantity: "2",
              missing_quantity: "3",
              product_name: "Second Preflight Product",
              required_quantity: "5",
            });
          expect(Object.keys(rows[0]!).sort()).toEqual([
            "available_quantity",
            "customer_name_snapshot",
            "description",
            "inventory_sufficient",
            "item_count",
            "missing_quantity",
            "product_id",
            "product_name",
            "project_id",
            "project_name",
            "required_quantity",
            "serial_number",
            "updated_at",
            "work_order_id",
            "work_order_number",
          ]);
          expect((await database.query(
            `select
               (select pg_catalog.to_jsonb(work_order)
                from public.work_orders as work_order
                where work_order.id = $1::uuid) as work_order,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item) order by item.id)
                from public.work_order_items as item
                where item.work_order_id = $1::uuid) as items,
               (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(balance)
                order by balance.product_id)
                from public.inventory_balances as balance
                where balance.product_id = any($2::uuid[])) as balances,
               (select pg_catalog.count(*)::text
                from public.inventory_movements as movement
                where movement.product_id = any($2::uuid[])) as movements,
               (select pg_catalog.count(*)::text
                from public.audit_logs as audit
                where audit.entity_id = $1::uuid) as audits`,
            [state.workOrderId, [state.productId, secondProductId]],
          )).rows[0]).toEqual(before);

          await database.query(
            "delete from public.inventory_balances where product_id = $1::uuid",
            [secondProductId],
          );
          await actAs(database, admin);
          await expectRejected(
            database,
            () => preflightFinishWorkOrder(
              database, state.workOrderId, state.updatedAt,
            ),
            "IVB01",
            "Inventory balance not found",
          );
          await database.query("reset role");

          const maximum = await createPreflightFixture(database, admin.profileId, {
            itemQuantity: "9223372036854775807",
            physicalQuantity: "9223372036854775807",
            requiredQuantity: "9223372036854775807",
          });
          await actAs(database, admin);
          expect(await preflightFinishWorkOrder(
            database, maximum.workOrderId, maximum.updatedAt,
          )).toMatchObject([{
            available_quantity: "9223372036854775807",
            inventory_sufficient: true,
            missing_quantity: "0",
            required_quantity: "9223372036854775807",
          }]);
        });
      });

      it("serializes preflight on the Work Order parent lock without persistent race fixtures", async () => {
        const fixture = requireHarness();
        const admin = fixture.actors.admin;
        const applicationName = `finish-preflight-lock-${randomUUID()}`;
        await fixture.withDatabaseClients(3, async ([blocker, waiter, observer]) => {
          if (!blocker || !waiter || !observer) {
            throw new Error("Finish preflight concurrency clients unavailable");
          }
          let state: PreflightFixture | undefined;
          let waitingPreflight: Promise<FinishPreflightRow[]> | undefined;
          try {
            await observer.query("begin");
            state = await createPreflightFixture(observer, admin.profileId);
            await observer.query("commit");

            await blocker.query("begin");
            await blocker.query(
              `select 1 from public.work_orders as work_order
               where work_order.id = $1::uuid
               for update`,
              [state.workOrderId],
            );

            await waiter.query("begin");
            await waiter.query(
              "select pg_catalog.set_config('application_name', $1::text, true)",
              [applicationName],
            );
            await actAs(waiter, admin);
            waitingPreflight = preflightFinishWorkOrder(
              waiter,
              state.workOrderId,
              state.updatedAt,
            );
            await waitForLockWait(observer, applicationName);

            await blocker.query("rollback");
            expect(await waitingPreflight).toHaveLength(1);
            waitingPreflight = undefined;
            await waiter.query("rollback");
          } finally {
            await blocker.query("rollback").catch(() => undefined);
            await waiter.query("rollback").catch(() => undefined);
            await waitingPreflight?.catch(() => undefined);
            if (state) {
              await cleanupCommittedPreflightData(observer, {
                productIds: [state.productId],
                projectIds: [state.projectId!],
                workOrderIds: [state.workOrderId],
              });
            }
          }
        });
      });

      it("holds the balance UPDATE lock against trusted Inventory mutation and rolls all test effects back", async () => {
        const fixture = requireHarness();
        const admin = fixture.actors.admin;
        const applicationName = `finish-preflight-inventory-${randomUUID()}`;
        await fixture.withDatabaseClients(3, async ([preflight, mutation, observer]) => {
          if (!preflight || !mutation || !observer) {
            throw new Error("Finish preflight Inventory clients unavailable");
          }
          let state: PreflightFixture | undefined;
          let waitingMutation: Promise<unknown> | undefined;
          try {
            await observer.query("begin");
            state = await createPreflightFixture(observer, admin.profileId);
            await observer.query("commit");

            await preflight.query("begin");
            await actAs(preflight, admin);
            expect(await preflightFinishWorkOrder(
              preflight,
              state.workOrderId,
              state.updatedAt,
            )).toHaveLength(1);

            await mutation.query("begin");
            await mutation.query(
              "select pg_catalog.set_config('application_name', $1::text, true)",
              [applicationName],
            );
            await mutation.query(
              "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
              [admin.authUserId],
            );
            waitingMutation = mutation.query(
              `select movement_id, quantity_before, quantity_after
               from public.apply_inventory_delta(
                 $1::uuid, -1, 'task117_lock_test', null,
                 'task117_lock_test', $2::uuid, $3::uuid, null
               )`,
              [state.productId, state.workOrderId, state.projectId],
            );
            await waitForLockWait(observer, applicationName);

            expect((await observer.query<{ quantity: string }>(
              `select quantity::text as quantity
               from public.inventory_balances
               where product_id = $1::uuid`,
              [state.productId],
            )).rows).toEqual([{ quantity: "10" }]);
            await preflight.query("rollback");
            await expect(waitingMutation).resolves.toMatchObject({
              rows: [{ quantity_after: "9", quantity_before: "10" }],
            });
            waitingMutation = undefined;
            await mutation.query("rollback");

            expect((await observer.query(
              `select
                 (select quantity::text from public.inventory_balances
                  where product_id = $1::uuid) as quantity,
                 (select pg_catalog.count(*)::text
                  from public.inventory_movements
                  where product_id = $1::uuid) as movements,
                 (select pg_catalog.count(*)::text
                  from public.audit_logs
                  where entity_id = $2::uuid) as audits`,
              [state.productId, state.workOrderId],
            )).rows).toEqual([{ audits: "0", movements: "0", quantity: "10" }]);
          } finally {
            await preflight.query("rollback").catch(() => undefined);
            await mutation.query("rollback").catch(() => undefined);
            await waitingMutation?.catch(() => undefined);
            if (state) {
              await cleanupCommittedPreflightData(observer, {
                productIds: [state.productId],
                projectIds: [state.projectId!],
                workOrderIds: [state.workOrderId],
              });
            }
          }
        });
      });

      it("serializes different-Project preflights sharing one Product on the same deterministic balance lock", async () => {
        const fixture = requireHarness();
        const admin = fixture.actors.admin;
        const applicationName = `finish-preflight-shared-${randomUUID()}`;
        await fixture.withDatabaseClients(3, async ([first, second, observer]) => {
          if (!first || !second || !observer) {
            throw new Error("Shared-Product preflight clients unavailable");
          }
          let firstState: PreflightFixture | undefined;
          let secondState: PreflightFixture | undefined;
          let waitingSecond: Promise<FinishPreflightRow[]> | undefined;
          try {
            await observer.query("begin");
            firstState = await createPreflightFixture(observer, admin.profileId);
            const secondProjectId = randomUUID();
            await observer.query(
              `insert into public.projects (
                 id, name, customer_name, start_date, delivery_date,
                 created_by_user_id, updated_by_user_id
               ) values (
                 $1::uuid, 'Second preflight Project', 'Second Customer',
                 '2026-09-29', '2026-10-29', $2::uuid, $2::uuid
               )`,
              [secondProjectId, admin.profileId],
            );
            await addRequirement(
              observer,
              admin.profileId,
              secondProjectId,
              firstState.productId,
              "10",
            );
            const secondWorkOrderId = randomUUID();
            const secondUpdatedAt = "2026-09-29 12:34:57.123456+00";
            await observer.query(
              `insert into public.work_orders (
                 id, work_order_number, project_id, customer_name_snapshot,
                 description, created_at, created_by_user_id,
                 updated_at, updated_by_user_id
               ) values (
                 $1::uuid, $2::text, $3::uuid, 'Second Customer',
                 'Second preflight assembly', $4::timestamptz, $5::uuid,
                 $4::timestamptz, $5::uuid
               )`,
              [
                secondWorkOrderId,
                `RN-${await findUnusedWorkOrderYear(observer)}-0001`,
                secondProjectId,
                secondUpdatedAt,
                admin.profileId,
              ],
            );
            await observer.query(
              `insert into public.work_order_items (
                 work_order_id, product_id, quantity, added_by_user_id
               ) values ($1::uuid, $2::uuid, 4, $3::uuid)`,
              [secondWorkOrderId, firstState.productId, admin.profileId],
            );
            secondState = {
              productId: firstState.productId,
              projectId: secondProjectId,
              updatedAt: secondUpdatedAt,
              workOrderId: secondWorkOrderId,
              workOrderNumber: "",
            };
            await observer.query("commit");

            await first.query("begin");
            await actAs(first, admin);
            expect(await preflightFinishWorkOrder(
              first,
              firstState.workOrderId,
              firstState.updatedAt,
            )).toHaveLength(1);

            await second.query("begin");
            await second.query(
              "select pg_catalog.set_config('application_name', $1::text, true)",
              [applicationName],
            );
            await actAs(second, admin);
            waitingSecond = preflightFinishWorkOrder(
              second,
              secondState.workOrderId,
              secondState.updatedAt,
            );
            await waitForLockWait(observer, applicationName);

            await first.query("rollback");
            expect(await waitingSecond).toHaveLength(1);
            waitingSecond = undefined;
            await second.query("rollback");

            expect((await observer.query(
              `select
                 (select quantity::text from public.inventory_balances
                  where product_id = $1::uuid) as quantity,
                 (select pg_catalog.count(*)::text from public.inventory_movements
                  where product_id = $1::uuid) as movements`,
              [firstState.productId],
            )).rows).toEqual([{ movements: "0", quantity: "10" }]);
          } finally {
            await first.query("rollback").catch(() => undefined);
            await second.query("rollback").catch(() => undefined);
            await waitingSecond?.catch(() => undefined);
            if (firstState && secondState) {
              await cleanupCommittedPreflightData(observer, {
                productIds: [firstState.productId],
                projectIds: [firstState.projectId!, secondState.projectId!],
                workOrderIds: [firstState.workOrderId, secondState.workOrderId],
              });
            }
          }
        });
      });

      it.todo(
        "serializes a committed Save winner against preflight without leaving immutable work_order.updated audit history (disposable database)",
      );
      it.todo(
        "serializes a committed Delete winner against preflight without leaving immutable work_order.deleted audit history (disposable database)",
      );
      it.todo(
        "serializes committed Project planning changes against preflight without leaving immutable planning audit history (disposable database)",
      );
    },
  );
}
