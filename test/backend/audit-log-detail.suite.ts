import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";
import { createTestSerialNumber } from "./helpers/serial";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261001120000_add_audit_log_detail_read.sql",
);

interface DetailRow extends QueryResultRow {
  audit_log_id: string;
  actor_user_id: string;
  actor_full_name: string;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  created_at: Date;
  before_data: unknown;
  after_data: unknown;
  metadata: unknown;
  detail_authorized: boolean;
  target_view_authorized: boolean;
  context_kind: string | null;
  context_id: string | null;
}

async function setActor(database: PoolClient, actor: SecurityActor | null) {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor?.authUserId ?? ""],
  );
  await database.query(actor ? "set local role authenticated" : "set local role anon");
}

async function callDetail(
  database: PoolClient,
  actor: SecurityActor,
  auditLogId: string,
): Promise<DetailRow> {
  await setActor(database, actor);
  try {
    return (await database.query<DetailRow>(
      "select * from public.get_audit_log_detail($1::uuid)",
      [auditLogId],
    )).rows[0]!;
  } finally {
    await database.query("reset role");
  }
}

async function expectRejected(
  database: PoolClient,
  actor: SecurityActor | null,
  auditLogId: string | null,
  code: string,
) {
  await database.query("savepoint rejected_task138_call");
  await setActor(database, actor);
  try {
    await expect(database.query(
      "select * from public.get_audit_log_detail($1::uuid)",
      [auditLogId],
    )).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback to savepoint rejected_task138_call");
    await database.query("release savepoint rejected_task138_call");
    await database.query("reset role");
  }
}

async function grantPermission(
  database: PoolClient,
  fixture: SecurityFixtureHarness,
  actor: SecurityActor,
  permission: string,
) {
  await database.query(
    `insert into public.user_permissions (
       user_id, permission_definition_id, granted_by_user_id
     )
     select $1::uuid, definition.id, $2::uuid
     from public.permission_definitions as definition
     where definition.key = $3::text
     on conflict (user_id, permission_definition_id) do nothing`,
    [actor.profileId, fixture.actors.admin.profileId, permission],
  );
}

async function revokePermission(
  database: PoolClient,
  actor: SecurityActor,
  permission: string,
) {
  await database.query(
    `delete from public.user_permissions as granted
     using public.permission_definitions as definition
     where granted.user_id = $1::uuid
       and granted.permission_definition_id = definition.id
       and definition.key = $2::text`,
    [actor.profileId, permission],
  );
}

async function expectActorLacksPermission(
  database: PoolClient,
  actor: SecurityActor,
  permission: string,
) {
  const result = await database.query<{ has_permission: boolean }>(
    `select exists (
       select 1
       from public.user_permissions as granted
       join public.permission_definitions as definition
         on definition.id = granted.permission_definition_id
       where granted.user_id = $1::uuid
         and definition.key = $2::text
     ) as has_permission`,
    [actor.profileId, permission],
  );
  expect(result.rows[0]?.has_permission).toBe(false);
}

async function insertAudit(
  database: PoolClient,
  actorId: string,
  entityType: string,
  entityId: string | null = randomUUID(),
) {
  const id = randomUUID();
  await database.query(
    `insert into public.audit_logs (
       id, actor_user_id, action_type, entity_type, entity_id, summary,
       before_data, after_data, metadata, created_at
     ) values (
       $1::uuid, $2::uuid, 'task138.checked', $3::text, $4::uuid,
       $5::text, '{"before":"safe"}'::jsonb,
       '{"after":"safe"}'::jsonb, '{"source":"task138"}'::jsonb,
       '2098-01-01T00:00:00Z'::timestamptz
     )`,
    [id, actorId, entityType, entityId, `Task 138 ${entityType}`],
  );
  return id;
}

export function registerAuditLogDetailTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 138 Archive detail (static)", () => {
    it("defines one hardened detail boundary with exact redaction signals", () => {
      const sql = readFileSync(migrationPath, "utf8");
      expect(sql).toContain("create function public.get_audit_log_detail(p_audit_log_id uuid)");
      for (const field of [
        "audit_log_id uuid", "actor_user_id uuid", "actor_full_name text",
        "action_type text", "entity_type text", "entity_id uuid", "summary text",
        "created_at timestamptz", "before_data jsonb", "after_data jsonb",
        "metadata jsonb", "detail_authorized boolean",
        "target_view_authorized boolean", "context_kind text", "context_id uuid",
      ]) expect(sql).toContain(field);
      expect(sql).toContain("case when can_view_detail then audit_record.before_data::jsonb else null end");
      expect(sql).toContain("case when can_view_detail then audit_record.after_data::jsonb else null end");
      expect(sql).toContain("case when can_view_detail then audit_record.metadata::jsonb else null end");
      expect(sql).not.toMatch(/actor\.(email|auth_user_id|birthday|is_admin|is_active)/);
      expect(sql).toContain("stable\nsecurity definer\nset search_path = ''");
      expect(sql).toContain("from public, anon, authenticated;");
      expect(sql).toContain("to authenticated;");
    });

    it("maps every current producer conservatively and keeps sensitive families Admin-only", () => {
      const sql = readFileSync(migrationPath, "utf8");
      const mappings: Record<string, string> = {
        project: "projects.view",
        project_product: "projects.view",
        project_product_component: "projects.view",
        procurement_request: "procurement.view",
        supplier: "suppliers.view",
        brand: "inventory.view",
        product: "inventory.view",
        product_inventory: "inventory.view",
        pcb_card: "pcb.view",
        pcb_bom_version: "pcb.view",
        pcb_production_run: "pcb.view",
        work_order: "work_orders.view",
      };
      for (const [entityType, permission] of Object.entries(mappings)) {
        expect(sql).toContain(`when '${entityType}' then public.has_permission('${permission}')`);
      }
      expect(sql).toContain(
        `when 'product_supplier' then (\n      public.has_permission('inventory.view')\n      or public.has_permission('suppliers.view')\n    )`,
      );
      expect(sql).toContain("when 'calendar_entry' then public.current_active_user_profile_id() is not null");
      for (const sensitiveType of ["user_profile", "documentation_record", "fixed_asset"] ) {
        expect(sql).not.toContain(`when '${sensitiveType}' then public.has_permission`);
      }
      expect(sql).toContain("else false");
    });

    it("allows context only for proven exact routes with current-target existence checks", () => {
      const sql = readFileSync(migrationPath, "utf8");
      const contextSql = sql.slice(sql.indexOf("if can_view_detail"));
      for (const [entityType, table] of [
        ["project", "projects"], ["supplier", "suppliers"],
        ["product", "products"], ["product_inventory", "products"],
        ["pcb_card", "pcb_cards"],
        ["work_order", "work_orders"], ["user_profile", "user_profiles"],
      ]) {
        expect(contextSql).toContain(`when '${entityType}' then`);
        expect(contextSql).toContain(`select 1 from public.${table} as target`);
      }
      expect(contextSql).toContain(
        `when 'product_inventory' then\n        if exists (\n          select 1 from public.products as target\n          where target.id = audit_record.entity_id`,
      );
      for (const entityType of [
        "product_supplier",
        "pcb_bom_version",
        "pcb_production_run",
        "project_product",
        "project_product_component",
        "calendar_entry",
      ]) {
        expect(contextSql).not.toContain(`when '${entityType}' then`);
      }
      expect(contextSql).not.toMatch(/before_data.*context|after_data.*context|metadata.*context/);
    });
  });

  describe.skipIf(process.env.TASK138_MIGRATION !== "1")(
    "Task 138 Archive detail (requires deployed migration)",
    () => {
      it("enforces Archive authorization, inputs, and narrow output", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const id = await insertAudit(database, fixture.actors.admin.profileId, "project");
          const adminDetail = await callDetail(database, fixture.actors.admin, id);
          expect(adminDetail.detail_authorized).toBe(true);
          expect(Object.keys(adminDetail).sort()).toEqual([
            "action_type", "actor_full_name", "actor_user_id", "after_data",
            "audit_log_id", "before_data", "context_id", "context_kind",
            "created_at", "detail_authorized", "entity_id", "entity_type",
            "metadata", "summary", "target_view_authorized",
          ]);
          const archiveOnly = fixture.actors.unpermitted;
          await expectRejected(database, archiveOnly, id, "42501");
          await expectActorLacksPermission(database, archiveOnly, "projects.view");
          await grantPermission(database, fixture, archiveOnly, "archive.view");
          expect((await callDetail(database, archiveOnly, id)))
            .toMatchObject({
              audit_log_id: id,
              detail_authorized: false,
              target_view_authorized: false,
              before_data: null,
              after_data: null,
              metadata: null,
            });
          await expectRejected(database, fixture.actors.permitted, id, "42501");
          await grantPermission(database, fixture, fixture.actors.inactive, "archive.view");
          await database.query(
            "update public.user_profiles set is_admin = true where id = $1::uuid",
            [fixture.actors.inactive.profileId],
          );
          await expectRejected(database, fixture.actors.inactive, id, "42501");
          await expectRejected(database, null, id, "42501");
          await expectRejected(database, fixture.actors.admin, null, "22023");
          await expectRejected(database, fixture.actors.admin, randomUUID(), "P0002");
        });
      });

      it("applies module permissions, Admin-only families, Calendar, and unknown fallback", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const archiveOnly = fixture.actors.unpermitted;
          await grantPermission(database, fixture, archiveOnly, "archive.view");
          const matrix = [
            [["project"], "projects.view"],
            [["supplier"], "suppliers.view"],
            [["product"], "inventory.view"],
            [["pcb_card", "pcb_bom_version", "pcb_production_run"], "pcb.view"],
            [["work_order"], "work_orders.view"],
            [["procurement_request"], "procurement.view"],
          ] as const;
          for (const [entityTypes, permission] of matrix) {
            await expectActorLacksPermission(database, archiveOnly, permission);
            const ids = await Promise.all(entityTypes.map((entityType) =>
              insertAudit(database, fixture.actors.admin.profileId, entityType)
            ));
            for (const id of ids) {
              expect((await callDetail(database, archiveOnly, id)).detail_authorized)
                .toBe(false);
            }
            await grantPermission(database, fixture, archiveOnly, permission);
            for (const id of ids) {
              expect((await callDetail(database, archiveOnly, id)))
                .toMatchObject({
                  detail_authorized: true,
                  before_data: { before: "safe" },
                  after_data: { after: "safe" },
                  metadata: { source: "task138" },
                });
            }
          }

          const calendarId = await insertAudit(
            database, fixture.actors.admin.profileId, "calendar_entry",
          );
          expect((await callDetail(database, archiveOnly, calendarId)).detail_authorized)
            .toBe(true);
          for (const entityType of [
            "user_profile", "documentation_record", "fixed_asset", "future_unknown",
          ]) {
            const id = await insertAudit(database, fixture.actors.admin.profileId, entityType);
            expect((await callDetail(database, archiveOnly, id)))
              .toMatchObject({
                detail_authorized: false,
                target_view_authorized: false,
                before_data: null,
                after_data: null,
                metadata: null,
              });
            expect((await callDetail(database, fixture.actors.admin, id)).detail_authorized)
              .toBe(true);
          }
        });
      });

      it("uses either canonical ProductSupplier read permission without cross-authorizing Product or Supplier", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.unpermitted;
          await grantPermission(database, fixture, actor, "archive.view");
          const productSupplierAudit = await insertAudit(
            database,
            fixture.actors.admin.profileId,
            "product_supplier",
          );

          expect(await callDetail(database, fixture.actors.admin, productSupplierAudit))
            .toMatchObject({
              detail_authorized: true,
              target_view_authorized: false,
              context_kind: null,
              context_id: null,
            });
          await expectActorLacksPermission(database, actor, "inventory.view");
          await expectActorLacksPermission(database, actor, "suppliers.view");
          expect(await callDetail(database, actor, productSupplierAudit))
            .toMatchObject({
              detail_authorized: false,
              target_view_authorized: false,
              before_data: null,
              after_data: null,
              metadata: null,
              context_kind: null,
              context_id: null,
            });

          await grantPermission(database, fixture, actor, "inventory.view");
          expect(await callDetail(database, actor, productSupplierAudit))
            .toMatchObject({
              detail_authorized: true,
              before_data: { before: "safe" },
              after_data: { after: "safe" },
              metadata: { source: "task138" },
              target_view_authorized: false,
              context_kind: null,
              context_id: null,
            });
          const supplierAudit = await insertAudit(
            database,
            fixture.actors.admin.profileId,
            "supplier",
          );
          expect((await callDetail(database, actor, supplierAudit)).detail_authorized)
            .toBe(false);

          await revokePermission(database, actor, "inventory.view");
          await expectActorLacksPermission(database, actor, "inventory.view");
          await grantPermission(database, fixture, actor, "suppliers.view");
          expect(await callDetail(database, actor, productSupplierAudit))
            .toMatchObject({
              detail_authorized: true,
              before_data: { before: "safe" },
              after_data: { after: "safe" },
              metadata: { source: "task138" },
              target_view_authorized: false,
              context_kind: null,
              context_id: null,
            });
          const productAudit = await insertAudit(
            database,
            fixture.actors.admin.profileId,
            "product",
          );
          expect((await callDetail(database, actor, productAudit)).detail_authorized)
            .toBe(false);

          const userAudit = await insertAudit(
            database,
            fixture.actors.admin.profileId,
            "user_profile",
            fixture.actors.unpermitted.profileId,
          );
          expect(await callDetail(database, actor, userAudit)).toMatchObject({
            detail_authorized: false,
            target_view_authorized: false,
            before_data: null,
            after_data: null,
            metadata: null,
          });
        });
      });

      it("derives ProductInventory context directly from an existing Product ID", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const productId = randomUUID();
          await database.query(
            `insert into public.products (
               id, serial_number, name, category, product_kind,
               created_by_user_id, updated_by_user_id
             ) values (
               $1::uuid, $2::text, 'Task 138 Inventory Product', 'Task 138',
               'component', $3::uuid, $3::uuid
             )`,
            [
              productId,
              createTestSerialNumber(),
              fixture.actors.admin.profileId,
            ],
          );
          const existingTargetAudit = await insertAudit(
            database,
            fixture.actors.admin.profileId,
            "product_inventory",
            productId,
          );
          const missingProductId = randomUUID();
          const missingTargetAudit = await insertAudit(
            database,
            fixture.actors.admin.profileId,
            "product_inventory",
            missingProductId,
          );

          expect(await callDetail(database, fixture.actors.admin, existingTargetAudit))
            .toMatchObject({
              detail_authorized: true,
              target_view_authorized: true,
              context_kind: "product",
              context_id: productId,
            });

          const actor = fixture.actors.unpermitted;
          await grantPermission(database, fixture, actor, "archive.view");
          await expectActorLacksPermission(database, actor, "inventory.view");
          expect(await callDetail(database, actor, existingTargetAudit))
            .toMatchObject({
              detail_authorized: false,
              target_view_authorized: false,
              before_data: null,
              after_data: null,
              metadata: null,
              context_kind: null,
              context_id: null,
            });

          await grantPermission(database, fixture, actor, "inventory.view");
          expect(await callDetail(database, actor, existingTargetAudit))
            .toMatchObject({
              detail_authorized: true,
              before_data: { before: "safe" },
              after_data: { after: "safe" },
              metadata: { source: "task138" },
              target_view_authorized: true,
              context_kind: "product",
              context_id: productId,
            });
          expect(await callDetail(database, actor, missingTargetAudit))
            .toMatchObject({
              detail_authorized: true,
              before_data: { before: "safe" },
              after_data: { after: "safe" },
              metadata: { source: "task138" },
              target_view_authorized: false,
              context_kind: null,
              context_id: null,
            });
        });
      });

      it("returns only server-approved existing context and preserves missing-target history", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const projectId = randomUUID();
          const supplierId = randomUUID();
          const productId = randomUUID();
          const outputProductId = randomUUID();
          const pcbCardId = randomUUID();
          const workOrderId = randomUUID();
          const productSerial = createTestSerialNumber();
          let outputSerial = createTestSerialNumber();
          while (outputSerial === productSerial) outputSerial = createTestSerialNumber();
          const workOrderNumber = (await database.query<{ work_order_number: string }>(
            `select 'RN-2099-' || pg_catalog.lpad(candidate::text, 4, '0') as work_order_number
             from pg_catalog.generate_series(0, 9999) as candidate
             where not exists (
               select 1 from public.work_orders as work_order
               where work_order.work_order_number =
                 'RN-2099-' || pg_catalog.lpad(candidate::text, 4, '0')
             )
             order by candidate
             limit 1`,
          )).rows[0]!.work_order_number;

          await database.query(
            `insert into public.projects (
               id, name, customer_name, start_date, delivery_date,
               created_by_user_id, updated_by_user_id
             ) values (
               $1::uuid, 'Task 138 Context Project', 'Task 138 Customer',
               '2099-01-01'::date, '2099-01-02'::date, $2::uuid, $2::uuid
             )`,
            [projectId, actorId],
          );
          await database.query(
            `insert into public.suppliers (
               id, name, catalog_number, country, created_by_user_id, updated_by_user_id
             ) values (
               $1::uuid, $2::text, 'TASK138-CAT', 'Bosnia and Herzegovina', $3::uuid, $3::uuid
             )`,
            [supplierId, `Task 138 Context Supplier ${randomUUID()}`, actorId],
          );
          await database.query(
            `insert into public.products (
               id, serial_number, name, category, product_kind,
               created_by_user_id, updated_by_user_id
             ) values
               ($1::uuid, $2::text, 'Task 138 Context Product', 'Task 138',
                'component', $5::uuid, $5::uuid),
               ($3::uuid, $4::text, 'Task 138 Context PCB Output', 'PCB',
                'pcb_finished_good', $5::uuid, $5::uuid)`,
            [productId, productSerial, outputProductId, outputSerial, actorId],
          );
          await database.query(
            `insert into public.pcb_cards (
               id, name, output_product_id, created_by_user_id, updated_by_user_id
             ) values (
               $1::uuid, 'Task 138 Context PCB', $2::uuid, $3::uuid, $3::uuid
             )`,
            [pcbCardId, outputProductId, actorId],
          );
          await database.query(
            `insert into public.work_orders (
               id, work_order_number, project_id, customer_name_snapshot,
               description, created_by_user_id, updated_by_user_id
             ) values (
               $1::uuid, $2::text, $3::uuid, 'Task 138 Customer',
               'Task 138 Context Work Order', $4::uuid, $4::uuid
             )`,
            [workOrderId, workOrderNumber, projectId, actorId],
          );

          for (const [entityType, entityId, contextKind] of [
            ["project", projectId, "project"],
            ["supplier", supplierId, "supplier"],
            ["product", productId, "product"],
            ["pcb_card", pcbCardId, "pcb_card"],
            ["work_order", workOrderId, "work_order"],
          ] as const) {
            const auditId = await insertAudit(database, actorId, entityType, entityId);
            expect(await callDetail(database, fixture.actors.admin, auditId))
              .toMatchObject({
                detail_authorized: true,
                target_view_authorized: true,
                context_kind: contextKind,
                context_id: entityId,
              });
          }

          const existingUserAudit = await insertAudit(
            database,
            actorId,
            "user_profile",
            fixture.actors.permitted.profileId,
          );
          expect(await callDetail(database, fixture.actors.admin, existingUserAudit))
            .toMatchObject({
              detail_authorized: true,
              target_view_authorized: true,
              context_kind: "user_profile",
              context_id: fixture.actors.permitted.profileId,
            });

          const missingProjectAudit = await insertAudit(
            database, actorId, "project", randomUUID(),
          );
          await grantPermission(database, fixture, fixture.actors.permitted, "archive.view");
          await grantPermission(database, fixture, fixture.actors.permitted, "projects.view");
          expect(await callDetail(database, fixture.actors.permitted, missingProjectAudit))
            .toMatchObject({
              detail_authorized: true,
              target_view_authorized: false,
              context_kind: null,
              context_id: null,
            });
        });
      });

      it("has hardened ACLs and no read side effects", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const id = await insertAudit(database, fixture.actors.admin.profileId, "project");
          const before = (await database.query<{ count: string }>(
            "select count(*)::text as count from public.audit_logs",
          )).rows[0]!.count;
          await callDetail(database, fixture.actors.admin, id);
          const after = (await database.query<{ count: string }>(
            "select count(*)::text as count from public.audit_logs",
          )).rows[0]!.count;
          expect(after).toBe(before);

          const metadata = await database.query<{
            proname: string;
            prosecdef: boolean;
            provolatile: string;
            config: string[] | null;
            public_execute: boolean;
            anon_execute: boolean;
            authenticated_execute: boolean;
          }>(
            `select procedure.proname, procedure.prosecdef, procedure.provolatile,
                    procedure.proconfig as config,
                    pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE') as public_execute,
                    pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE') as anon_execute,
                    pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as authenticated_execute
             from pg_catalog.pg_proc as procedure
             join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'public'
               and procedure.proname in ('can_view_audit_target', 'get_audit_log_detail')
             order by procedure.proname`,
          );
          expect(metadata.rows).toHaveLength(2);
          expect(metadata.rows.find((row) => row.proname === "can_view_audit_target"))
            .toMatchObject({
              prosecdef: true,
              provolatile: "s",
              config: ["search_path=\"\""],
              public_execute: false,
              anon_execute: false,
              authenticated_execute: false,
            });
          expect(metadata.rows.find((row) => row.proname === "get_audit_log_detail"))
            .toMatchObject({
              prosecdef: true,
              provolatile: "s",
              config: ["search_path=\"\""],
              public_execute: false,
              anon_execute: false,
              authenticated_execute: true,
            });

          await database.query("savepoint task138_internal_helper_denied");
          await setActor(database, fixture.actors.admin);
          try {
            let helperError: unknown;
            try {
              await database.query(
                "select public.can_view_audit_target('project'::text)",
              );
            } catch (error) {
              helperError = error;
            }
            expect(helperError).toMatchObject({ code: "42501" });
          } finally {
            await database.query("rollback to savepoint task138_internal_helper_denied");
            await database.query("release savepoint task138_internal_helper_denied");
            await database.query("reset role");
          }
        });
      });
    },
  );
}
