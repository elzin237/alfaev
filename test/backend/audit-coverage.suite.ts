import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

interface AuditContract {
  signature: string;
  actions: readonly string[];
  entityTypes: readonly string[];
  delegates?: readonly string[];
  directInsert?: boolean;
}

interface FunctionDefinitionRow {
  definition: string;
  is_security_definer: boolean;
  search_path: string[] | null;
}

interface CountRow {
  count: number;
}

const auditedMutations: readonly AuditContract[] = [
  {
    signature: "public.create_user_profile_admin(uuid,text,text,date,boolean)",
    actions: ["user.created"], entityTypes: ["user_profile"],
  },
  {
    signature: "public.update_user_profile_admin(uuid,text,text,date)",
    actions: ["user.updated"], entityTypes: ["user_profile"],
  },
  {
    signature: "public.set_user_active_state_admin(uuid,boolean)",
    actions: ["user.reactivated", "user.deactivated"],
    entityTypes: ["user_profile"],
  },
  {
    signature: "public.set_user_admin_status_admin(uuid,boolean)",
    actions: ["user.promoted_to_admin", "user.demoted_from_admin"],
    entityTypes: ["user_profile"],
  },
  {
    signature: "public.set_user_permission_admin(uuid,text,boolean)",
    actions: ["permission.granted", "permission.revoked"],
    entityTypes: ["user_profile"],
  },
  {
    signature: "public.save_user_permissions_admin(uuid,text[],text[])",
    actions: [], entityTypes: [],
    delegates: ["public.set_user_permission_admin"],
  },
  { signature: "public.create_brand(text)", actions: ["brand.created"], entityTypes: ["brand"] },
  { signature: "public.update_brand(uuid,text)", actions: ["brand.updated"], entityTypes: ["brand"] },
  { signature: "public.archive_brand(uuid)", actions: ["brand.archived"], entityTypes: ["brand"] },
  {
    signature: "public.create_supplier(text,text,text,text,text,text,text)",
    actions: ["supplier.created"], entityTypes: ["supplier"],
  },
  {
    signature: "public.update_supplier(uuid,text,text,text,text,text,text,text)",
    actions: ["supplier.updated"], entityTypes: ["supplier"],
  },
  { signature: "public.archive_supplier(uuid)", actions: ["supplier.archived"], entityTypes: ["supplier"] },
  {
    signature: "public.create_product(text,text,uuid)",
    actions: ["product.created"], entityTypes: ["product"],
  },
  {
    signature: "public.update_product(uuid,text,text,uuid)",
    actions: ["product.updated"], entityTypes: ["product"],
  },
  { signature: "public.archive_product(uuid)", actions: ["product.archived"], entityTypes: ["product"] },
  {
    signature: "public.bulk_import_components(jsonb)",
    actions: ["product.bulk_imported"], entityTypes: ["product"],
  },
  {
    signature: "public.create_product_supplier(uuid,uuid)",
    actions: ["product_supplier.created"], entityTypes: ["product_supplier"],
  },
  {
    signature: "public.archive_product_supplier(uuid)",
    actions: ["product_supplier.archived"], entityTypes: ["product_supplier"],
  },
  {
    signature: "public.manual_adjust_inventory(uuid,text,bigint,text,uuid)",
    actions: ["inventory.manual_adjusted"], entityTypes: ["product_inventory"],
    delegates: ["public.apply_inventory_delta"],
  },
  {
    signature: "public.create_project(text,text,date,date)",
    actions: ["project.created"], entityTypes: ["project"],
  },
  {
    signature: "public.update_project(uuid,text,text,date,date,text)",
    actions: ["project.updated"], entityTypes: ["project"],
  },
  { signature: "public.cancel_project(uuid)", actions: ["project.cancelled"], entityTypes: ["project"] },
  { signature: "public.reopen_project(uuid)", actions: ["project.reopened"], entityTypes: ["project"] },
  {
    signature: "public.create_project_product(uuid,text)",
    actions: ["project_product.created"], entityTypes: ["project_product"],
  },
  {
    signature: "public.update_project_product(uuid,text)",
    actions: ["project_product.updated"], entityTypes: ["project_product"],
  },
  {
    signature: "public.remove_project_product(uuid)",
    actions: ["project_product.removed"], entityTypes: ["project_product"],
  },
  {
    signature: "public.create_project_product_component(uuid,uuid,bigint)",
    actions: ["project_product_component.created"],
    entityTypes: ["project_product_component"],
  },
  {
    signature: "public.update_project_product_component(uuid,uuid,bigint)",
    actions: ["project_product_component.updated"],
    entityTypes: ["project_product_component"],
  },
  {
    signature: "public.remove_project_product_component(uuid)",
    actions: ["project_product_component.removed"],
    entityTypes: ["project_product_component"],
  },
  {
    signature: "public.create_procurement_request_for_product(uuid,bigint)",
    actions: ["procurement.created"], entityTypes: ["procurement_request"],
  },
  {
    signature: "public.create_procurement_request_for_new_component(text,bigint)",
    actions: ["procurement.created"], entityTypes: ["procurement_request"],
  },
  {
    signature: "public.update_procurement_delivered_quantity(uuid,bigint)",
    actions: ["procurement.delivery_updated"], entityTypes: ["procurement_request"],
  },
  {
    signature: "public.resolve_procurement_request(uuid)",
    actions: ["procurement.resolved"], entityTypes: ["procurement_request"],
  },
  {
    signature: "public.create_product_from_procurement_request(uuid,text,text,uuid)",
    actions: ["procurement.product_linked"], entityTypes: ["procurement_request"],
    delegates: ["public.create_product", "public.create_product_supplier"],
  },
  {
    signature: "public.create_documentation_record(text,text,date,numeric)",
    actions: ["documentation.created"], entityTypes: ["documentation_record"],
  },
  {
    signature: "public.update_documentation_record(uuid,text,text,date,numeric)",
    actions: ["documentation.updated"], entityTypes: ["documentation_record"],
  },
  {
    signature: "public.archive_documentation_record(uuid)",
    actions: ["documentation.archived"], entityTypes: ["documentation_record"],
  },
  {
    signature: "public.set_documentation_pdf_reference_admin(uuid,text,text,uuid)",
    actions: [
      "documentation.pdf_attached",
      "documentation.pdf_replaced",
      "documentation.pdf_removed",
    ],
    entityTypes: ["documentation_record"], directInsert: true,
  },
  {
    signature: "public.create_fixed_asset(text,text,date,bigint)",
    actions: ["fixed_asset.created"], entityTypes: ["fixed_asset"],
  },
  {
    signature: "public.update_fixed_asset(uuid,text,text,date,bigint)",
    actions: ["fixed_asset.updated"], entityTypes: ["fixed_asset"],
  },
  {
    signature: "public.archive_fixed_asset(uuid)",
    actions: ["fixed_asset.archived"], entityTypes: ["fixed_asset"],
  },
  {
    signature: "public.create_pcb_card(text)",
    actions: ["product.created", "pcb_card.created"],
    entityTypes: ["product", "pcb_card"],
  },
  {
    signature: "public.save_initial_pcb_bom(uuid,jsonb)",
    actions: ["pcb_bom.created", "pcb_bom.updated", "pcb_bom.version_created"],
    entityTypes: ["pcb_bom_version"],
  },
  {
    signature: "public.produce_pcb(uuid,text,uuid)",
    actions: ["pcb_production.completed"], entityTypes: ["pcb_production_run"],
    delegates: ["public.apply_inventory_delta"],
  },
  {
    signature: "public.create_draft_work_order()",
    actions: ["work_order.created"], entityTypes: ["work_order"],
    delegates: ["public.allocate_work_order_number"],
  },
  {
    signature: "public.update_draft_work_order(uuid,uuid,text,timestamptz)",
    actions: ["work_order.updated"], entityTypes: ["work_order"],
  },
  {
    signature: "public.save_draft_work_order(uuid,uuid,text,jsonb,timestamptz)",
    actions: ["work_order.updated"], entityTypes: ["work_order"],
  },
  {
    signature: "public.delete_draft_work_order(uuid,timestamptz)",
    actions: ["work_order.deleted"], entityTypes: ["work_order"],
  },
  {
    signature: "public.finish_work_order(uuid,timestamptz,text,text,text)",
    actions: [], entityTypes: [],
    delegates: ["public.finish_generic_work_order_internal"],
  },
  {
    signature: "public.finish_generic_work_order_internal(uuid,timestamptz,text,text)",
    actions: ["work_order.finished", "project.completed"],
    entityTypes: ["work_order", "project"],
    delegates: ["public.apply_inventory_delta"],
  },
  {
    signature: "public.finish_work_order(uuid,timestamptz,text,text,text,text)",
    actions: [], entityTypes: [],
    delegates: ["public.finish_pcb_work_order_internal"],
  },
  {
    signature: "public.finish_pcb_work_order_internal(uuid,timestamptz,text,text,text)",
    actions: ["work_order.finished", "pcb_production.completed"],
    entityTypes: ["work_order", "pcb_production_run"],
    delegates: ["public.apply_inventory_delta"],
  },
  {
    signature: "public.create_calendar_entry(text,text,date,date,text,uuid)",
    actions: ["calendar.created"], entityTypes: ["calendar_entry"],
  },
  {
    signature: "public.update_calendar_entry(uuid,text,text,date,date,text,uuid,timestamptz)",
    actions: ["calendar.updated"], entityTypes: ["calendar_entry"],
  },
  {
    signature: "public.delete_calendar_entry(uuid,timestamptz)",
    actions: ["calendar.deleted"], entityTypes: ["calendar_entry"],
  },
] as const;

const internalMutationFunctions = [
  "public.append_audit_log(text,text,text,uuid,jsonb,jsonb,jsonb)",
  "public.touch_user_permission_revision(uuid)",
  "public.initialize_product_inventory_balance()",
  "public.apply_inventory_delta(uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text)",
  "public.allocate_product_serial_number()",
  "public.allocate_work_order_number_for_year(integer)",
  "public.allocate_work_order_number()",
  "public.validate_inventory_movement_reversal_product()",
] as const;

const normalizedNoOpContracts = [
  ["public.update_user_profile_admin(uuid,text,text,date)", "return target_profile.id;"],
  ["public.set_user_active_state_admin(uuid,boolean)", "target_profile.is_active = p_is_active"],
  ["public.set_user_admin_status_admin(uuid,boolean)", "target_profile.is_admin = p_is_admin"],
  ["public.set_user_permission_admin(uuid,text,boolean)", "if changed_rows = 0 then"],
  ["public.update_brand(uuid,text)", "return current_brand.id;"],
  ["public.update_supplier(uuid,text,text,text,text,text,text,text)", "return current_supplier.id;"],
  ["public.update_product(uuid,text,text,uuid)", "return current_product.id;"],
  ["public.update_project(uuid,text,text,date,date,text)", "return current_project.id;"],
  ["public.update_project_product(uuid,text)", "return v_current.id;"],
  ["public.update_project_product_component(uuid,uuid,bigint)", "return v_current.id;"],
  ["public.update_procurement_delivered_quantity(uuid,bigint)", "return p_request_id;"],
  ["public.update_documentation_record(uuid,text,text,date,numeric)", "return current_record.id;"],
  ["public.update_fixed_asset(uuid,text,text,date,bigint)", "return current_asset.id;"],
  ["public.save_initial_pcb_bom(uuid,jsonb)", "previous_items is not distinct from next_items"],
  ["public.update_draft_work_order(uuid,uuid,text,timestamptz)", "return query"],
  ["public.save_draft_work_order(uuid,uuid,text,jsonb,timestamptz)", "if not header_changed and not materials_changed then"],
  ["public.update_calendar_entry(uuid,text,text,date,date,text,uuid,timestamptz)", "return query select current_entry.id, current_entry.updated_at;"],
] as const;

async function getFunctionDefinition(
  database: PoolClient,
  signature: string,
): Promise<FunctionDefinitionRow> {
  const result = await database.query<FunctionDefinitionRow>(
    `select
       pg_catalog.pg_get_functiondef($1::regprocedure::oid) as definition,
       procedure.prosecdef as is_security_definer,
       procedure.proconfig as search_path
     from pg_catalog.pg_proc as procedure
     where procedure.oid = $1::regprocedure::oid`,
    [signature],
  );

  if (!result.rows[0]) throw new Error(`Missing deployed function ${signature}`);
  return result.rows[0];
}

async function setActor(database: PoolClient, actor: SecurityActor | null) {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor?.authUserId ?? ""],
  );
  await database.query(actor ? "set local role authenticated" : "set local role anon");
}

export function registerAuditCoverageTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 139 Audit coverage review", () => {
    it("maps every implemented meaningful mutation boundary to its final audit producer", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        for (const contract of auditedMutations) {
          const metadata = await getFunctionDefinition(database, contract.signature);
          const definition = metadata.definition.toLowerCase();

          expect(metadata.is_security_definer, contract.signature).toBe(true);
          expect(metadata.search_path, contract.signature).toContain("search_path=\"\"");

          for (const action of contract.actions) {
            expect(definition, `${contract.signature} -> ${action}`).toContain(action);
          }
          for (const entityType of contract.entityTypes) {
            expect(definition, `${contract.signature} -> ${entityType}`).toContain(entityType);
          }
          for (const delegate of contract.delegates ?? []) {
            expect(definition, `${contract.signature} -> ${delegate}`).toContain(delegate);
          }

          if (contract.directInsert) {
            expect(definition).toContain("insert into public.audit_logs");
          } else if (contract.actions.length > 0) {
            expect(definition).toContain("public.append_audit_log");
          }
        }
      });
    });

    it("keeps technical mutation primitives private and owned by audited operations", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        for (const signature of internalMutationFunctions) {
          const privileges = await database.query<{
            anon_execute: boolean;
            authenticated_execute: boolean;
            public_execute: boolean;
          }>(
            `select
               pg_catalog.has_function_privilege('anon', $1, 'EXECUTE') as anon_execute,
               pg_catalog.has_function_privilege('authenticated', $1, 'EXECUTE') as authenticated_execute,
               pg_catalog.has_function_privilege('public', $1, 'EXECUTE') as public_execute`,
            [signature],
          );
          expect(privileges.rows[0], signature).toEqual({
            anon_execute: false,
            authenticated_execute: false,
            public_execute: false,
          });
        }

        const reversalDefinition = await getFunctionDefinition(
          database,
          "public.validate_inventory_movement_reversal_product()",
        );
        expect(reversalDefinition.definition).not.toContain("append_audit_log");
        expect(reversalDefinition.definition).not.toContain("insert into public.audit_logs");
      });
    });

    it("places normalized no-op exits before audit production", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        for (const [signature, noOpMarker] of normalizedNoOpContracts) {
          const { definition } = await getFunctionDefinition(database, signature);
          const normalizedDefinition = definition.toLowerCase();
          const noOpIndex = normalizedDefinition.indexOf(noOpMarker.toLowerCase());
          const auditIndex = normalizedDefinition.indexOf("append_audit_log");

          expect(noOpIndex, `${signature} no-op guard`).toBeGreaterThan(-1);
          expect(auditIndex, `${signature} audit producer`).toBeGreaterThan(noOpIndex);
        }
      });
    });

    it("proves actor attribution, no-op silence, rollback atomicity, and denied-write silence", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        await setActor(database, fixture.actors.admin);
        const created = await database.query<{
          calendar_entry_id: string;
          calendar_entry_updated_at: string;
        }>(
          `select calendar_entry_id,
                  calendar_entry_updated_at::text as calendar_entry_updated_at
           from public.create_calendar_entry(
             'event', $1::text, '2026-10-20'::date, '2026-10-20'::date,
             null, null
           )`,
          [`Task 139 ${randomUUID()}`],
        );
        await database.query("reset role");

        const entry = created.rows[0]!;
        const audit = await database.query<{
          action_type: string;
          actor_user_id: string;
          after_data: Record<string, unknown>;
          before_data: Record<string, unknown> | null;
          entity_id: string;
          entity_type: string;
          summary: string;
        }>(
          `select actor_user_id, action_type, entity_type, entity_id,
                  summary, before_data, after_data
           from public.audit_logs
           where entity_id = $1::uuid`,
          [entry.calendar_entry_id],
        );
        expect(audit.rows).toEqual([
          expect.objectContaining({
            action_type: "calendar.created",
            actor_user_id: fixture.actors.admin.profileId,
            before_data: null,
            entity_id: entry.calendar_entry_id,
            entity_type: "calendar_entry",
          }),
        ]);
        expect(audit.rows[0]?.after_data).toMatchObject({
          entry_type: "event",
          start_date: "2026-10-20",
          end_date: "2026-10-20",
        });

        await setActor(database, fixture.actors.admin);
        await database.query(
          `select * from public.update_calendar_entry(
             $1::uuid, 'event', $2::text, '2026-10-20'::date,
             '2026-10-20'::date, null, null, $3::timestamptz
           )`,
          [
            entry.calendar_entry_id,
            audit.rows[0]?.after_data.title,
            entry.calendar_entry_updated_at,
          ],
        );
        await database.query("reset role");
        const noOpAudit = await database.query<CountRow>(
          `select count(*)::integer as count
           from public.audit_logs
           where entity_id = $1::uuid`,
          [entry.calendar_entry_id],
        );
        expect(noOpAudit.rows).toEqual([{ count: 1 }]);

        await database.query("savepoint task139_atomicity");
        await setActor(database, fixture.actors.admin);
        await database.query(
          `select * from public.update_calendar_entry(
             $1::uuid, 'event', $2::text, '2026-10-20'::date,
             '2026-10-21'::date, 'temporary', null, $3::timestamptz
           )`,
          [entry.calendar_entry_id, audit.rows[0]?.after_data.title, entry.calendar_entry_updated_at],
        );
        await database.query("reset role");
        await database.query("rollback to savepoint task139_atomicity");
        await database.query("release savepoint task139_atomicity");

        const rolledBack = await database.query<CountRow>(
          `select count(*)::integer as count
           from public.audit_logs
           where entity_id = $1::uuid`,
          [entry.calendar_entry_id],
        );
        expect(rolledBack.rows).toEqual([{ count: 1 }]);

        const auditCountBeforeDenied = await database.query<CountRow>(
          "select count(*)::integer as count from public.audit_logs",
        );
        await database.query("savepoint task139_denied");
        await setActor(database, fixture.actors.unpermitted);
        await expect(database.query(
          `select * from public.create_calendar_entry(
             'event', 'Denied Task 139', '2026-10-20'::date,
             '2026-10-20'::date, null, null
           )`,
        )).rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint task139_denied");
        await database.query("release savepoint task139_denied");
        const auditCountAfterDenied = await database.query<CountRow>(
          "select count(*)::integer as count from public.audit_logs",
        );
        expect(auditCountAfterDenied.rows).toEqual(auditCountBeforeDenied.rows);
      });
    });

    it("keeps AuditLog append and direct table mutation unavailable to browser roles", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const privileges = await database.query<{
          append_authenticated: boolean;
          delete_authenticated: boolean;
          insert_authenticated: boolean;
          update_authenticated: boolean;
        }>(
          `select
             pg_catalog.has_function_privilege(
               'authenticated',
               'public.append_audit_log(text,text,text,uuid,jsonb,jsonb,jsonb)',
               'EXECUTE'
             ) as append_authenticated,
             pg_catalog.has_table_privilege('authenticated', 'public.audit_logs', 'INSERT')
               as insert_authenticated,
             pg_catalog.has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE')
               as update_authenticated,
             pg_catalog.has_table_privilege('authenticated', 'public.audit_logs', 'DELETE')
               as delete_authenticated`,
        );
        expect(privileges.rows).toEqual([{
          append_authenticated: false,
          delete_authenticated: false,
          insert_authenticated: false,
          update_authenticated: false,
        }]);

        const immutableTrigger = await database.query<CountRow>(
          `select count(*)::integer as count
           from pg_catalog.pg_trigger as trigger
           join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
           join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
           where namespace.nspname = 'public'
             and relation.relname = 'audit_logs'
             and not trigger.tgisinternal
             and trigger.tgenabled <> 'D'`,
        );
        expect(immutableTrigger.rows[0]?.count).toBeGreaterThan(0);
      });
    });
  });
}
