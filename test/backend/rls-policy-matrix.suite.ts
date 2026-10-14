import { randomUUID } from "node:crypto";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";
import { createTestSerialNumber } from "./helpers/serial";

const directSelectTables = [
  "brands",
  "calendar_entries",
  "documentation_records",
  "fixed_assets",
  "inventory_balances",
  "inventory_movements",
  "pcb_bom_items",
  "pcb_bom_versions",
  "pcb_cards",
  "pcb_production_runs",
  "procurement_requests",
  "product_suppliers",
  "products",
  "project_product_components",
  "project_products",
  "projects",
  "suppliers",
  "user_permission_revisions",
  "user_profiles",
  "work_order_items",
  "work_order_pdfs",
  "work_orders",
] as const;

const trustedOnlyTables = [
  "audit_logs",
  "inventory_source_allocations",
  "inventory_source_lots",
  "pcb_production_work_orders",
  "permission_definitions",
  "user_permissions",
  "work_order_number_counters",
] as const;

const applicationTables = [...directSelectTables, ...trustedOnlyTables].sort();

interface TableSecurityRow extends QueryResultRow {
  force_rls: boolean;
  rls: boolean;
  table_name: string;
}

interface TableGrantRow extends QueryResultRow {
  grantee: string;
  privilege_type: string;
  table_name: string;
}

interface PolicyRow extends QueryResultRow {
  command: string;
  policy_name: string;
  roles: string[];
  table_name: string;
  using_expression: string | null;
  with_check_expression: string | null;
}

async function setActor(database: PoolClient, actor: SecurityActor | null) {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor?.authUserId ?? ""],
  );
  await database.query(actor ? "set local role authenticated" : "set local role anon");
}

async function setPermissions(
  database: PoolClient,
  fixture: SecurityFixtureHarness,
  actor: SecurityActor,
  permissions: readonly string[],
) {
  await database.query(
    "delete from public.user_permissions where user_id = $1::uuid",
    [actor.profileId],
  );
  if (permissions.length === 0) return;
  await database.query(
    `insert into public.user_permissions (
       user_id, permission_definition_id, granted_by_user_id
     )
     select $1::uuid, definition.id, $2::uuid
     from public.permission_definitions as definition
     where definition.key = any($3::text[])`,
    [actor.profileId, fixture.actors.admin.profileId, permissions],
  );
}

async function readVisibleCount(
  database: PoolClient,
  actor: SecurityActor | null,
  query: string,
  parameters: readonly unknown[] = [],
): Promise<number> {
  await database.query("savepoint rls_matrix_read");
  await setActor(database, actor);
  try {
    const result = await database.query<{ count: string }>(query, [...parameters]);
    return Number(result.rows[0]?.count ?? "0");
  } catch (error) {
    await database.query("rollback to savepoint rls_matrix_read");
    expect(error).toMatchObject({ code: "42501" });
    return 0;
  } finally {
    await database.query("reset role");
    await database.query("release savepoint rls_matrix_read");
  }
}

async function expectDirectWriteDenied(
  database: PoolClient,
  actor: SecurityActor,
  query: string,
  parameters: readonly unknown[] = [],
) {
  await database.query("savepoint rls_matrix_write");
  await setActor(database, actor);
  try {
    await expect(database.query(query, [...parameters])).rejects.toMatchObject({
      code: "42501",
    });
  } finally {
    await database.query("rollback to savepoint rls_matrix_write");
    await database.query("release savepoint rls_matrix_write");
    await database.query("reset role");
  }
}

export function registerRlsPolicyMatrixTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 145 full RLS policy matrix", () => {
    it("keeps every public application table behind RLS with no browser write grant", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const tables = await database.query<TableSecurityRow>(
          `select
             relation.relname as table_name,
             relation.relrowsecurity as rls,
             relation.relforcerowsecurity as force_rls
           from pg_catalog.pg_class as relation
           join pg_catalog.pg_namespace as namespace
             on namespace.oid = relation.relnamespace
           where namespace.nspname = 'public'
             and relation.relkind in ('r', 'p')
           order by relation.relname`,
        );
        expect(tables.rows.map((row) => row.table_name)).toEqual(applicationTables);
        expect(tables.rows.every((row) => row.rls)).toBe(true);
        expect(tables.rows.every((row) => !row.force_rls)).toBe(true);

        const grants = await database.query<TableGrantRow>(
          `select table_name, grantee, privilege_type
           from information_schema.role_table_grants
           where table_schema = 'public'
             and grantee in ('PUBLIC', 'anon', 'authenticated')
           order by table_name, grantee, privilege_type`,
        );
        expect(grants.rows.some((row) =>
          row.grantee === "PUBLIC" || row.grantee === "anon"
        )).toBe(false);
        expect(grants.rows.some((row) =>
          ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
            .includes(row.privilege_type)
        )).toBe(false);
        expect(grants.rows).toEqual(directSelectTables.map((tableName) => ({
          grantee: "authenticated",
          privilege_type: "SELECT",
          table_name: tableName,
        })));

        const policies = await database.query<PolicyRow>(
          `select
             policy.tablename as table_name,
             policy.policyname as policy_name,
             policy.cmd as command,
             pg_catalog.to_jsonb(policy.roles) as roles,
             policy.qual as using_expression,
             policy.with_check as with_check_expression
           from pg_catalog.pg_policies as policy
           where policy.schemaname = 'public'
           order by policy.tablename, policy.policyname`,
        );
        expect(policies.rows.map((row) => row.table_name)).toEqual(
          [...directSelectTables].sort(),
        );
        for (const policy of policies.rows) {
          expect(policy.command).toBe("SELECT");
          expect(policy.roles).toEqual(["authenticated"]);
          expect(policy.using_expression).not.toBeNull();
          expect(policy.with_check_expression).toBeNull();
        }
        for (const tableName of trustedOnlyTables) {
          expect(policies.rows.some((policy) => policy.table_name === tableName))
            .toBe(false);
        }
      });
    });

    it("keeps SECURITY DEFINER and allocator/helper execution boundaries hardened", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const functions = await database.query<{
          anonymous_execute: boolean;
          arguments: string;
          authenticated_execute: boolean;
          function_name: string;
          function_owner: string;
          public_execute: boolean;
          result_type: string;
          settings: string[] | null;
          volatility: string;
        }>(
          `select
             routine.proname as function_name,
             pg_catalog.pg_get_userbyid(routine.proowner) as function_owner,
             pg_catalog.pg_get_function_identity_arguments(routine.oid) as arguments,
             pg_catalog.pg_get_function_result(routine.oid) as result_type,
             routine.provolatile as volatility,
             routine.proconfig as settings,
             pg_catalog.has_function_privilege(
               'anon', routine.oid, 'execute'
             ) as anonymous_execute,
             pg_catalog.has_function_privilege(
               'authenticated', routine.oid, 'execute'
             ) as authenticated_execute,
             pg_catalog.has_function_privilege(
               'public', routine.oid, 'execute'
             ) as public_execute
           from pg_catalog.pg_proc as routine
           join pg_catalog.pg_namespace as namespace
             on namespace.oid = routine.pronamespace
           where namespace.nspname = 'public'
             and routine.prosecdef
           order by routine.proname,
             pg_catalog.pg_get_function_identity_arguments(routine.oid)`,
        );

        const rlsEventTriggerHelpers = functions.rows.filter((routine) =>
          routine.function_name === "rls_auto_enable"
          && routine.arguments === ""
          && routine.result_type === "event_trigger"
        );
        expect(rlsEventTriggerHelpers.length).toBeLessThanOrEqual(1);

        const applicationFunctions = functions.rows.filter(
          (routine) => !rlsEventTriggerHelpers.includes(routine),
        );
        expect(applicationFunctions).toHaveLength(141);
        const publicOrAnonymous = applicationFunctions.filter(
          (routine) => routine.public_execute || routine.anonymous_execute,
        );
        expect(publicOrAnonymous).toEqual([]);
        for (const routine of applicationFunctions) {
          expect(routine.settings).toEqual(['search_path=""']);
          expect(routine.public_execute).toBe(false);
          expect(routine.anonymous_execute).toBe(false);
        }

        if (rlsEventTriggerHelpers.length === 1) {
          expect(rlsEventTriggerHelpers[0]).toMatchObject({
            anonymous_execute: true,
            authenticated_execute: true,
            function_name: "rls_auto_enable",
            function_owner: "postgres",
            public_execute: true,
            result_type: "event_trigger",
            settings: ["search_path=pg_catalog"],
            volatility: "v",
          });

          const eventTrigger = await database.query<{
            enabled: string;
            event: string;
            event_owner: string;
            function_identity: string;
            tags: string[];
          }>(
            `select
               event.evtevent as event,
               event.evtenabled as enabled,
               pg_catalog.pg_get_userbyid(event.evtowner) as event_owner,
               event.evtfoid::pg_catalog.regprocedure::text as function_identity,
               event.evttags as tags
             from pg_catalog.pg_event_trigger as event
             where event.evtname = 'ensure_rls'`,
          );
          expect(eventTrigger.rows).toEqual([{
            enabled: "O",
            event: "ddl_command_end",
            event_owner: "postgres",
            function_identity: "rls_auto_enable()",
            tags: ["CREATE TABLE", "CREATE TABLE AS", "SELECT INTO"],
          }]);

          await database.query("savepoint direct_rls_event_trigger_call");
          await database.query("set local role authenticated");
          await expect(
            database.query("select public.rls_auto_enable()"),
          ).rejects.toMatchObject({ code: "0A000" });
          await database.query("rollback to savepoint direct_rls_event_trigger_call");
          await database.query("reset role");
        }

        for (const internalName of [
          "allocate_product_serial_number",
          "allocate_work_order_number",
          "allocate_work_order_number_for_year",
          "append_audit_log",
          "apply_inventory_delta",
          "check_inventory_source_lot_allocation_accounting",
          "check_inventory_source_lot_balance",
          "produce_pcb",
          "set_documentation_pdf_reference_admin",
        ]) {
          const matches = applicationFunctions.filter(
            (routine) => routine.function_name === internalName,
          );
          expect(matches.length).toBeGreaterThan(0);
          expect(matches.every((routine) => !routine.authenticated_execute)).toBe(true);
        }

        const sequences = await database.query<{
          grantee: string | null;
          privilege_type: string | null;
          sequence_name: string;
        }>(
          `select
             sequence.relname as sequence_name,
             grant_row.grantee,
             grant_row.privilege_type
           from pg_catalog.pg_class as sequence
           join pg_catalog.pg_namespace as namespace
             on namespace.oid = sequence.relnamespace
           left join information_schema.role_usage_grants as grant_row
             on grant_row.object_schema = namespace.nspname
            and grant_row.object_name = sequence.relname
            and grant_row.grantee in ('PUBLIC', 'anon', 'authenticated')
           where namespace.nspname = 'public'
             and sequence.relkind = 'S'`,
        );
        expect(sequences.rows).toEqual([{
          grantee: null,
          privilege_type: null,
          sequence_name: "product_serial_number_seq",
        }]);
      });
    });

    it("enforces anonymous, inactive, Admin, permitted, and cross-module read isolation on seeded rows", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const adminId = fixture.actors.admin.profileId;
        const brandId = randomUUID();
        const supplierId = randomUUID();
        const productId = randomUUID();
        const outputProductId = randomUUID();
        const projectId = randomUUID();
        const procurementId = randomUUID();
        const workOrderId = randomUUID();
        const pcbCardId = randomUUID();
        const calendarId = randomUUID();
        const auditId = randomUUID();
        const workOrderNumber = `RN-2097-${String(
          Number.parseInt(randomUUID().replace(/\D/g, "").slice(0, 4) || "1", 10),
        ).padStart(4, "0")}`;

        await database.query(
          `insert into public.brands (
             id, name, created_by_user_id, updated_by_user_id
           ) values ($1::uuid, 'Task 145 Brand', $2::uuid, $2::uuid)`,
          [brandId, adminId],
        );
        await database.query(
          `insert into public.suppliers (
             id, name, catalog_number, country, created_by_user_id, updated_by_user_id
           ) values ($1::uuid, 'Task 145 Supplier', 'TASK145-CAT', 'BA', $2::uuid, $2::uuid)`,
          [supplierId, adminId],
        );
        await database.query(
          `insert into public.products (
             id, serial_number, name, category, brand_id, product_kind,
             created_by_user_id, updated_by_user_id
           ) values
             ($1::uuid, $2::text, 'Task 145 Product', 'Component', $3::uuid,
              'component', $4::uuid, $4::uuid),
             ($5::uuid, $6::text, 'Task 145 PCB Output', 'PCB', null,
              'pcb_finished_good', $4::uuid, $4::uuid)`,
          [
            productId,
            createTestSerialNumber(),
            brandId,
            adminId,
            outputProductId,
            createTestSerialNumber(),
          ],
        );
        await database.query(
          `insert into public.projects (
             id, name, customer_name, status, start_date, delivery_date,
             created_by_user_id, updated_by_user_id
           ) values (
             $1::uuid, 'Task 145 Project', 'Task 145 Customer', 'planned',
             '2097-01-01'::date, '2097-02-01'::date, $2::uuid, $2::uuid
           )`,
          [projectId, adminId],
        );
        await database.query(
          `insert into public.procurement_requests (
             id, product_id, requested_name, supplier_id,
             requested_quantity, delivered_quantity, status,
             created_by_user_id, updated_by_user_id
           ) values (
             $1::uuid, $2::uuid, 'Task 145 Request', $3::uuid,
             2, 0, 'active', $4::uuid, $4::uuid
           )`,
          [procurementId, productId, supplierId, adminId],
        );
        await database.query(
          `insert into public.work_orders (
             id, work_order_number, project_id, customer_name_snapshot,
             description, status, created_by_user_id, updated_by_user_id
           ) values (
             $1::uuid, $2::text, $3::uuid, 'Task 145 Customer',
             'Task 145 Work Order', 'draft', $4::uuid, $4::uuid
           )`,
          [workOrderId, workOrderNumber, projectId, adminId],
        );
        await database.query(
          `insert into public.pcb_cards (
             id, name, output_product_id, created_by_user_id, updated_by_user_id
           ) values ($1::uuid, 'Task 145 PCB', $2::uuid, $3::uuid, $3::uuid)`,
          [pcbCardId, outputProductId, adminId],
        );
        await database.query(
          `insert into public.calendar_entries (
             id, entry_type, title, start_date, end_date,
             created_by_user_id, updated_by_user_id
           ) values (
             $1::uuid, 'event', 'Task 145 Event', current_date, current_date,
             $2::uuid, $2::uuid
           )`,
          [calendarId, adminId],
        );
        await database.query(
          `insert into public.audit_logs (
             id, actor_user_id, action_type, entity_type, entity_id, summary
           ) values (
             $1::uuid, $2::uuid, 'task145.checked', 'project', $3::uuid,
             'Task 145 audit fixture'
           )`,
          [auditId, adminId, projectId],
        );

        const actor = fixture.actors.unpermitted;
        const inactive = fixture.actors.inactive;
        const counts = {
          audit: ["select pg_catalog.count(*)::text as count from public.audit_logs where id = $1::uuid", auditId],
          brand: ["select pg_catalog.count(*)::text as count from public.brands where id = $1::uuid", brandId],
          calendar: ["select pg_catalog.count(*)::text as count from public.calendar_entries where id = $1::uuid", calendarId],
          inventory: ["select pg_catalog.count(*)::text as count from public.inventory_balances where product_id = $1::uuid", productId],
          pcb: ["select pg_catalog.count(*)::text as count from public.pcb_cards where id = $1::uuid", pcbCardId],
          procurement: ["select pg_catalog.count(*)::text as count from public.procurement_requests where id = $1::uuid", procurementId],
          product: ["select pg_catalog.count(*)::text as count from public.products where id = $1::uuid", productId],
          project: ["select pg_catalog.count(*)::text as count from public.projects where id = $1::uuid", projectId],
          supplier: ["select pg_catalog.count(*)::text as count from public.suppliers where id = $1::uuid", supplierId],
          workOrder: ["select pg_catalog.count(*)::text as count from public.work_orders where id = $1::uuid", workOrderId],
        } as const;
        const read = async (
          selectedActor: SecurityActor | null,
          key: keyof typeof counts,
        ) => readVisibleCount(
          database,
          selectedActor,
          counts[key][0],
          [counts[key][1]],
        );

        for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
          expect(await read(null, key)).toBe(0);
        }

        await setPermissions(database, fixture, actor, []);
        for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
          expect(await read(actor, key)).toBe(key === "calendar" ? 1 : 0);
        }
        expect(await readVisibleCount(
          database,
          actor,
          "select pg_catalog.count(*)::text as count from public.user_profiles where id = $1::uuid",
          [actor.profileId],
        )).toBe(1);
        expect(await readVisibleCount(
          database,
          actor,
          "select pg_catalog.count(*)::text as count from public.user_profiles where id = $1::uuid",
          [adminId],
        )).toBe(0);

        await setPermissions(database, fixture, inactive, [
          "projects.view", "inventory.view", "work_orders.view", "pcb.view",
        ]);
        for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
          expect(await read(inactive, key)).toBe(0);
        }
        expect(await readVisibleCount(
          database,
          inactive,
          "select pg_catalog.count(*)::text as count from public.user_profiles where id = $1::uuid",
          [inactive.profileId],
        )).toBe(1);

        for (const [permission, visible] of [
          ["dashboard.view", ["calendar"]],
          ["projects.view", ["project", "calendar"]],
          ["procurement.view", ["procurement", "calendar"]],
          ["suppliers.view", ["supplier", "calendar"]],
          ["inventory.view", ["brand", "product", "inventory", "calendar"]],
          ["pcb.view", ["pcb", "calendar"]],
          ["pcb.produce", ["calendar"]],
          ["work_orders.view", ["workOrder", "calendar"]],
          ["archive.view", ["calendar"]],
        ] as const) {
          await setPermissions(database, fixture, actor, [permission]);
          for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
            expect(await read(actor, key)).toBe(visible.includes(key as never) ? 1 : 0);
          }
        }

        for (const key of [
          "brand", "calendar", "inventory", "pcb", "procurement", "product",
          "project", "supplier", "workOrder",
        ] as const) {
          expect(await read(fixture.actors.admin, key)).toBe(1);
        }
        expect(await read(fixture.actors.admin, "audit")).toBe(0);
      });
    });

    it("denies direct browser writes even to Admin and preserves trusted-only state", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const admin = fixture.actors.admin;
        const productId = randomUUID();
        await database.query(
          `insert into public.products (
             id, serial_number, name, category, product_kind,
             created_by_user_id, updated_by_user_id
           ) values (
             $1::uuid, $2::text, 'Task 145 Immutable Product', 'Component',
             'component', $3::uuid, $3::uuid
           )`,
          [productId, createTestSerialNumber(), admin.profileId],
        );

        await expectDirectWriteDenied(
          database,
          admin,
          "update public.products set name = 'Forged' where id = $1::uuid",
          [productId],
        );
        await expectDirectWriteDenied(
          database,
          admin,
          "update public.inventory_balances set quantity = 999 where product_id = $1::uuid",
          [productId],
        );
        await expectDirectWriteDenied(
          database,
          admin,
          `insert into public.audit_logs (
             actor_user_id, action_type, entity_type, summary
           ) values ($1::uuid, 'forged', 'product', 'Forged audit')`,
          [admin.profileId],
        );
        await expectDirectWriteDenied(
          database,
          admin,
          "delete from public.calendar_entries",
        );
        await expectDirectWriteDenied(
          database,
          admin,
          "update public.work_order_number_counters set last_value = last_value + 1",
        );

        const preserved = await database.query<{
          name: string;
          quantity: string;
        }>(
          `select product.name, balance.quantity::text as quantity
           from public.products as product
           join public.inventory_balances as balance
             on balance.product_id = product.id
           where product.id = $1::uuid`,
          [productId],
        );
        expect(preserved.rows).toEqual([{
          name: "Task 145 Immutable Product",
          quantity: "0",
        }]);
        const forgedAudit = await database.query<{ count: string }>(
          "select pg_catalog.count(*)::text as count from public.audit_logs where action_type = 'forged'",
        );
        expect(forgedAudit.rows).toEqual([{ count: "0" }]);
      });
    });

    it("keeps both application PDF buckets private and browser-write guarded", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const buckets = await database.query<{
          allowed_mime_types: string[] | null;
          file_size_limit: string | null;
          id: string;
          public: boolean;
        }>(
          `select id, public, file_size_limit::text, allowed_mime_types
           from storage.buckets
           where id in ('documentation-pdfs', 'work-order-pdfs')
           order by id`,
        );
        expect(buckets.rows).toEqual([
          {
            allowed_mime_types: ["application/pdf"],
            file_size_limit: "10485760",
            id: "documentation-pdfs",
            public: false,
          },
          {
            allowed_mime_types: ["application/pdf"],
            file_size_limit: "10485760",
            id: "work-order-pdfs",
            public: false,
          },
        ]);

        const policies = await database.query<{
          command: string;
          permissive: string;
          policy_name: string;
          roles: string[];
        }>(
          `select
             policyname as policy_name,
             permissive,
             pg_catalog.to_jsonb(roles) as roles,
             cmd as command
           from pg_catalog.pg_policies
           where schemaname = 'storage'
             and tablename = 'objects'
             and (
               policyname like 'documentation_pdf_objects_%'
               or policyname like 'work_order_pdf_objects_%'
             )
           order by policyname`,
        );
        expect(policies.rows).toEqual([
          {
            command: "ALL",
            permissive: "RESTRICTIVE",
            policy_name: "documentation_pdf_objects_no_direct_client_access",
            roles: ["anon", "authenticated"],
          },
          {
            command: "DELETE",
            permissive: "RESTRICTIVE",
            policy_name: "work_order_pdf_objects_delete_guard",
            roles: ["anon", "authenticated"],
          },
          {
            command: "INSERT",
            permissive: "RESTRICTIVE",
            policy_name: "work_order_pdf_objects_insert_guard",
            roles: ["anon", "authenticated"],
          },
          {
            command: "SELECT",
            permissive: "RESTRICTIVE",
            policy_name: "work_order_pdf_objects_select_guard_anon",
            roles: ["anon"],
          },
          {
            command: "SELECT",
            permissive: "RESTRICTIVE",
            policy_name: "work_order_pdf_objects_select_guard_authenticated",
            roles: ["authenticated"],
          },
          {
            command: "SELECT",
            permissive: "PERMISSIVE",
            policy_name: "work_order_pdf_objects_select_referenced",
            roles: ["authenticated"],
          },
          {
            command: "UPDATE",
            permissive: "RESTRICTIVE",
            policy_name: "work_order_pdf_objects_update_guard",
            roles: ["anon", "authenticated"],
          },
        ]);
      });
    });
  });
}
