import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import { createTestSerialNumber } from "./helpers/serial";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const migrationNames = [
  "20261005100000_create_pcb_production_work_order_context.sql",
  "20261005103000_add_trusted_pcb_production_work_order_creation.sql",
  "20261005110000_add_pcb_production_work_order_finish.sql",
] as const;

function migration(name: typeof migrationNames[number]) {
  return readFileSync(resolve(process.cwd(), "supabase/migrations", name), "utf8");
}

interface RuntimeFixture {
  bomVersionId: string;
  cardId: string;
  componentIds: string[];
  outputProductId: string;
  projectId: string | null;
}

async function createRuntimeFixture(
  database: PoolClient,
  actorId: string,
  options: { emptyBom?: boolean; includeProject?: boolean } = {},
): Promise<RuntimeFixture> {
  const outputProductId = randomUUID();
  const componentIds = options.emptyBom ? [] : [randomUUID(), randomUUID()];
  for (const [index, productId] of [outputProductId, ...componentIds].entries()) {
    await database.query(
      `insert into public.products (
         id, serial_number, name, category, product_kind,
         created_by_user_id, updated_by_user_id
       ) values ($1::uuid, $2::text, $3::text, 'PCB', $4::text, $5::uuid, $5::uuid)`,
      [
        productId,
        createTestSerialNumber(),
        `PCB production Work Order runtime Product ${index}`,
        index === 0 ? "pcb_finished_good" : "component",
        actorId,
      ],
    );
  }

  const cardId = randomUUID();
  await database.query(
    `insert into public.pcb_cards (
       id, name, output_product_id, created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::text, $3::uuid, $4::uuid, $4::uuid)`,
    [cardId, `Runtime PCB ${cardId}`, outputProductId, actorId],
  );
  const bomVersionId = (await database.query<{ id: string }>(
    `insert into public.pcb_bom_versions (
       pcb_card_id, version_number, created_by_user_id
     ) values ($1::uuid, 1, $2::uuid) returning id`,
    [cardId, actorId],
  )).rows[0]!.id;
  if (componentIds.length > 0) {
    await database.query(
      `insert into public.pcb_bom_items (
         bom_version_id, component_product_id, quantity_per_card
       ) values ($1::uuid, $2::uuid, 2), ($1::uuid, $3::uuid, 3)`,
      [bomVersionId, componentIds[0], componentIds[1]],
    );
    await database.query(
      `update public.inventory_balances
       set quantity = 100
       where product_id = any($1::uuid[])`,
      [componentIds],
    );
  }
  await database.query(
    `update public.inventory_balances set quantity = 5 where product_id = $1::uuid`,
    [outputProductId],
  );

  let projectId: string | null = null;
  if (options.includeProject) {
    projectId = randomUUID();
    await database.query(
      `insert into public.projects (
         id, name, customer_name, status, start_date, delivery_date,
         created_by_user_id, updated_by_user_id
       ) values (
         $1::uuid, $2::text, $3::text, 'planned',
         '2026-10-05'::date, '2026-11-05'::date, $4::uuid, $4::uuid
       )`,
      [projectId, `Runtime Project ${projectId}`, `Runtime Customer ${projectId}`, actorId],
    );
  }

  return { bomVersionId, cardId, componentIds, outputProductId, projectId };
}

async function setPermissions(
  database: PoolClient,
  actor: SecurityActor,
  grantedBy: string,
  keys: string[],
): Promise<void> {
  await database.query(
    `delete from public.user_permissions as permission
     using public.permission_definitions as definition
     where permission.permission_definition_id = definition.id
       and permission.user_id = $1::uuid
       and (definition.key like 'pcb.%' or definition.key like 'work_orders.%')`,
    [actor.profileId],
  );
  if (keys.length === 0) return;
  await database.query(
    `insert into public.user_permissions (
       user_id, permission_definition_id, granted_by_user_id
     )
     select $1::uuid, definition.id, $2::uuid
     from public.permission_definitions as definition
     where definition.key = any($3::text[])`,
    [actor.profileId, grantedBy, keys],
  );
}

async function queryAs<Row extends QueryResultRow>(
  database: PoolClient,
  actor: SecurityActor | null,
  sql: string,
  parameters: unknown[],
): Promise<Row[]> {
  await database.query("savepoint pcb_production_work_order_rpc");
  try {
    if (actor) {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");
    } else {
      await database.query("set local role anon");
    }
    const rows = (await database.query<Row>(sql, parameters)).rows;
    await database.query("reset role");
    await database.query("release savepoint pcb_production_work_order_rpc");
    return rows;
  } catch (error) {
    await database.query("rollback to savepoint pcb_production_work_order_rpc");
    throw error;
  }
}

async function expectRpcRejected(
  database: PoolClient,
  actor: SecurityActor | null,
  sql: string,
  parameters: unknown[],
  code: string,
): Promise<void> {
  await expect(queryAs(database, actor, sql, parameters)).rejects.toMatchObject({ code });
}

async function createProductionWorkOrder(
  database: PoolClient,
  actor: SecurityActor,
  fixture: RuntimeFixture,
  plannedQuantity: string,
  requestId = randomUUID(),
) {
  const rows = await queryAs<{ work_order_id: string; work_order_number: string }>(
    database,
    actor,
    `select * from public.create_pcb_production_work_order(
       $1::uuid, $2::text, $3::uuid, $4::uuid
     )`,
    [fixture.cardId, plannedQuantity, fixture.projectId, requestId],
  );
  return { ...rows[0]!, requestId };
}

export function registerPcbProductionWorkOrderTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("PCB production via Work Order migrations", () => {
    it("creates a protected frozen context and history-preserving run link", () => {
      const sql = migration(migrationNames[0]);
      expect(sql).toContain("create table public.pcb_production_work_orders");
      expect(sql).toContain("creation_request_id uuid not null");
      expect(sql).toContain("unique (creation_request_id)");
      expect(sql).toContain("check (planned_quantity > 0)");
      expect(sql).toContain("add column work_order_id uuid");
      expect(sql).toContain("check (quantity_produced >= 0)");
      expect(sql).toContain("inventory_movements_pcb_production_output_run_key");
      expect(sql).toContain("alter table public.pcb_production_work_orders enable row level security");
      expect(sql).toContain("on delete restrict");
      expect(sql).toContain("where work_order_id is not null");
      expect(sql).toContain("using errcode = 'PCB11'");
      expect(sql).toContain("using errcode = 'PCB12'");
      expect(sql).toContain("from public.pcb_production_work_orders as production\n              where production.work_order_id = other_work_order.id");
    });

    it("allows only canonical Draft deletion and blocks generic production-plan edits", () => {
      const sql = migration(migrationNames[0]);
      expect(sql).toContain("delete from public.pcb_production_work_orders as production");
      expect(sql).toContain("delete from public.work_order_items as item");
      expect(sql).toContain("delete from public.work_orders as work_order");
      expect(sql).toContain("p_action_type => 'work_order.deleted'");
      expect(sql).toContain("raise exception 'PCB production Work Order plan is immutable'");
      expect(sql).toContain("public.has_permission('work_orders.delete_draft')");
      expect(sql).not.toContain("delete from public.pcb_production_runs");
      expect(sql).not.toContain("delete from public.inventory_movements");
    });

    it("excludes frozen PCB production Drafts from generic Project commitment allocation", () => {
      const sql = migration(migrationNames[0]);
      expect(sql).toContain("from public.pcb_production_work_orders as production\n              where production.work_order_id = other_work_order.id");
      expect(sql).toContain("and not exists (");
      expect(sql).toContain("other_work_order.status = 'draft'");
    });

    it("uses an idempotent creation boundary and retires immediate browser production", () => {
      const sql = migration(migrationNames[1]);
      expect(sql).toContain("revoke execute\n  on function public.produce_pcb(uuid, text, uuid)\n  from authenticated");
      expect(sql).toContain("create function public.create_pcb_production_work_order(");
      expect(sql).toContain("p_creation_request_id uuid");
      expect(sql).toContain("pg_catalog.pg_advisory_xact_lock");
      expect(sql).toContain("where production.creation_request_id = p_creation_request_id");
      expect(sql).toContain("using errcode = 'PCB13'");
      expect(sql).toContain("public.allocate_work_order_number()");
      expect(sql).toContain("'PCB production — ' || card_record.name");
      expect(sql).toContain("item.quantity_per_card::numeric * planned_quantity_value::numeric");
      expect(sql).toContain("PCB production Work Order ' || allocated_number");
      expect(sql).toContain("p_action_type => 'work_order.created'");
      expect(sql).toContain("'pcb_production.work_order_created'");
      expect(sql).not.toContain("apply_inventory_delta(");
      expect(sql).not.toContain("insert into public.pcb_production_runs");
      expect(sql).not.toContain("insert into public.inventory_movements");
    });

    it("validates active creation inputs without requiring Work Order or Project view permissions", () => {
      const sql = migration(migrationNames[1]);
      expect(sql).toContain("public.has_permission('pcb.produce')");
      expect(sql).not.toContain("public.has_permission('work_orders.create')");
      expect(sql).not.toContain("public.has_permission('projects.view')");
      expect(sql).toContain("project.status in ('planned', 'in_progress', 'on_hold')");
      expect(sql).toContain("if not card_record.is_active then");
      expect(sql).toContain("product_record.product_kind <> 'pcb_finished_good'");
      expect(sql).toContain("product_record.product_kind not in ('component', 'pcb_finished_good')");
    });

    it("provides a narrow Work Order-view context projection", () => {
      const sql = migration(migrationNames[1]);
      expect(sql).toContain("create function public.get_pcb_production_work_order_context(");
      expect(sql).toContain("public.has_permission('work_orders.view')");
      expect(sql).toContain("production.planned_quantity::text");
      expect(sql).toContain("run.quantity_produced::text");
      expect(sql).toContain("left join public.pcb_production_runs as run");
      expect(sql).not.toContain("output_product.brand_id");
    });

    it("keeps ordinary Finish overloads and adds exact actual-good specialization", () => {
      const sql = migration(migrationNames[2]);
      expect(sql).toContain("public.preflight_finish_pcb_production_work_order(");
      expect(sql).toContain("p_actual_good_quantity text");
      expect(sql).toContain("actual_good_value > context_record.planned_quantity");
      expect(sql).toContain("actual_good_text := '0'");
      expect(sql).toContain("public.has_permission('work_orders.finish')");
      expect(sql).not.toContain("public.has_permission('pcb.produce')");
      expect(sql).toContain("on function public.finish_work_order(uuid, timestamptz, text, text, text)");
      expect(sql).not.toContain("create or replace function public.finish_work_order(\n  p_work_order_id uuid,\n  p_expected_updated_at timestamptz,\n  p_pdf_storage_reference text,\n  p_pdf_content_hash text\n)");
    });

    it("serializes the specialized Finish through Work Order, Project, Product, and balance locks", () => {
      const sql = migration(migrationNames[2]);
      const workOrderLock = sql.indexOf("where work_order.id = p_work_order_id\n  for update");
      const projectLock = sql.indexOf("where project.id = current_work_order.project_id\n    for update");
      const productLock = sql.indexOf("order by product.id\n    for share");
      const balanceLock = sql.indexOf("order by balance.product_id\n    for update");
      expect(workOrderLock).toBeGreaterThan(-1);
      expect(projectLock).toBeGreaterThan(workOrderLock);
      expect(productLock).toBeGreaterThan(projectLock);
      expect(balanceLock).toBeGreaterThan(productLock);
    });

    it("posts planned inputs, conditionally posts actual output, and never completes Project", () => {
      const sql = migration(migrationNames[2]);
      expect(sql).toContain("p_quantity_delta => -material_record.quantity");
      expect(sql).toContain("if actual_good_value > 0 then");
      expect(sql).toContain("p_quantity_delta => actual_good_value");
      expect(sql).toContain("insert into public.pcb_production_runs as run");
      expect(sql).toContain("work_order_id\n  ) values");
      expect(sql).toContain("p_source_id => created_run_id");
      expect(sql).toContain("status = 'finished'");
      expect(sql).toContain("insert into public.work_order_pdfs as inserted");
      expect(sql).toContain("'work_order.finished'");
      expect(sql).toContain("'pcb_production.completed'");
      expect(sql).not.toContain("p_action_type => 'project.completed'");
      expect(sql).not.toContain("update public.projects");
    });

    it("represents zero actual output as history without a zero movement", () => {
      const sql = migration(migrationNames[2]);
      expect(sql).toContain("if actual_good_value > 0 then");
      expect(sql).toContain("quantity_produced,\n    status");
      expect(sql).toContain("actual_good_value,\n    'completed'");
      expect(sql).not.toContain("p_quantity_delta => 0");
    });

    it("keeps the official PDF snapshot authoritative and exact", () => {
      const sql = migration(migrationNames[2]);
      expect(sql).toContain("create function public.get_work_order_pdf_snapshot(");
      expect(sql).toContain("production_planned_quantity text");
      expect(sql).toContain("production_actual_good_quantity text");
      expect(sql).toContain("preflight.planned_quantity::text");
      expect(sql).toContain("preflight.actual_good_quantity::text");
      expect(sql).toContain("with trusted_preflight as materialized");
    });

    it("keeps Finished reads compatible with General Stock and PCB ledger rows", () => {
      const sql = migration(migrationNames[2]);
      expect(sql).toContain("left join public.projects as project");
      expect(sql).toContain("movement.source_type in ('pcb_production_input', 'pcb_production_output')");
      expect(sql).toContain("run.work_order_id = p_work_order_id");
      expect(sql).toContain("movement.quantity_delta::text");
    });

    it("hardens every trusted boundary and does not broaden direct table access", () => {
      for (const name of migrationNames) {
        const sql = migration(name);
        expect(sql).not.toContain("grant insert");
        expect(sql).not.toContain("grant update");
        expect(sql).not.toContain("grant delete");
      }
      expect(migration(migrationNames[1])).toContain("security definer\nset search_path = ''");
      expect(migration(migrationNames[2])).toContain("security definer\nset search_path = ''");
      expect(migration(migrationNames[0])).toContain("from public, anon, authenticated");
      expect(migration(migrationNames[1])).toContain("to authenticated");
      expect(migration(migrationNames[2])).toContain("to authenticated");
    });

    describe.skipIf(process.env.PCB_PRODUCTION_WORK_ORDER_MIGRATIONS !== "1")(
      "migration-dependent runtime campaign",
      () => {
        it("deploys the protected structure and intended trusted ACL boundary", async () => {
          const fixture = requireHarness();
          await fixture.withRollbackDatabaseTransaction(async (database) => {
            const structure = (await database.query<{
              context_rls: boolean;
              context_table: string | null;
              legacy_authenticated: boolean;
              creation_authenticated: boolean;
              finish_authenticated: boolean;
              inventory_authenticated: boolean;
              output_index: string | null;
              run_work_order_nullable: boolean;
            }>(
              `select
                 pg_catalog.to_regclass('public.pcb_production_work_orders')::text as context_table,
                 (select class.relrowsecurity from pg_catalog.pg_class as class
                  where class.oid = 'public.pcb_production_work_orders'::pg_catalog.regclass) as context_rls,
                 pg_catalog.has_function_privilege('authenticated', 'public.produce_pcb(uuid,text,uuid)', 'EXECUTE') as legacy_authenticated,
                 pg_catalog.has_function_privilege('authenticated', 'public.create_pcb_production_work_order(uuid,text,uuid,uuid)', 'EXECUTE') as creation_authenticated,
                 pg_catalog.has_function_privilege('authenticated', 'public.finish_work_order(uuid,timestamptz,text,text,text)', 'EXECUTE') as finish_authenticated,
                 pg_catalog.has_function_privilege('authenticated', 'public.apply_inventory_delta(uuid,bigint,text,text,text,uuid,uuid,uuid)', 'EXECUTE') as inventory_authenticated,
                 pg_catalog.to_regclass('public.inventory_movements_pcb_production_output_run_key')::text as output_index,
                 (select column_info.is_nullable = 'YES'
                  from information_schema.columns as column_info
                  where column_info.table_schema = 'public'
                    and column_info.table_name = 'pcb_production_runs'
                    and column_info.column_name = 'work_order_id') as run_work_order_nullable`,
            )).rows[0]!;
            expect(structure).toMatchObject({
              context_rls: true,
              context_table: "pcb_production_work_orders",
              creation_authenticated: true,
              finish_authenticated: true,
              inventory_authenticated: false,
              legacy_authenticated: false,
              output_index: "inventory_movements_pcb_production_output_run_key",
              run_work_order_nullable: true,
            });
            const grants = (await database.query<{ privilege_type: string }>(
              `select grant_info.privilege_type
               from information_schema.role_table_grants as grant_info
               where grant_info.table_schema = 'public'
                 and grant_info.table_name = 'pcb_production_work_orders'
                 and grant_info.grantee = 'authenticated'`,
            )).rows;
            expect(grants).toEqual([]);
          });
        });

        it("routes deployed Edge requests through JWT and safe input validation", async () => {
          const fixture = requireHarness();
          const anonymous = await fixture.anonymousClient.functions.invoke("finish-work-order", {
            body: {},
          });
          expect(anonymous.data).toBeNull();
          expect(anonymous.error).not.toBeNull();

          const malformed = await fixture.actors.admin.client.functions.invoke("finish-work-order", {
            body: {
              actual_good_quantity: "8",
              expected_updated_at: "not-a-timestamp",
              work_order_id: "not-a-uuid",
            },
          });
          expect(malformed.data).toBeNull();
          expect(malformed.error).not.toBeNull();
          expect(malformed.error?.message).not.toContain("service_role");
          expect(malformed.error?.message).not.toContain("SUPABASE_SECRET_KEY");
        });

        it("creates an exact frozen plan idempotently and deletes only Draft state", async () => {
          const fixture = requireHarness();
          await fixture.withRollbackDatabaseTransaction(async (database) => {
            const admin = fixture.actors.admin;
            const producer = fixture.actors.supplierCreator;
            const unauthorized = fixture.actors.unpermitted;
            const runtime = await createRuntimeFixture(database, admin.profileId, {
              includeProject: true,
            });
            await setPermissions(database, producer, admin.profileId, ["pcb.produce"]);
            await setPermissions(database, unauthorized, admin.profileId, []);
            await expectRpcRejected(
              database,
              unauthorized,
              "select * from public.create_pcb_production_work_order($1::uuid, '10', $2::uuid, $3::uuid)",
              [runtime.cardId, runtime.projectId, randomUUID()],
              "42501",
            );

            const requestId = randomUUID();
            const created = await createProductionWorkOrder(
              database,
              producer,
              runtime,
              "00010",
              requestId,
            );
            expect(created.work_order_number).toMatch(/^RN-\d{4}-\d{4}$/);
            const replay = await createProductionWorkOrder(
              database,
              producer,
              runtime,
              "10",
              requestId,
            );
            expect(replay.work_order_id).toBe(created.work_order_id);
            await expectRpcRejected(
              database,
              producer,
              "select * from public.create_pcb_production_work_order($1::uuid, '11', $2::uuid, $3::uuid)",
              [runtime.cardId, runtime.projectId, requestId],
              "PCB13",
            );
            const another = await createProductionWorkOrder(database, producer, runtime, "10");
            expect(another.work_order_id).not.toBe(created.work_order_id);

            const frozen = (await database.query<{
              bom_version_id: string;
              pcb_card_id: string;
              planned_quantity: string;
            }>(
              `select pcb_card_id, bom_version_id, planned_quantity
               from public.pcb_production_work_orders where work_order_id = $1::uuid`,
              [created.work_order_id],
            )).rows[0]!;
            expect(frozen).toEqual({
              bom_version_id: runtime.bomVersionId,
              pcb_card_id: runtime.cardId,
              planned_quantity: "10",
            });
            const materials = (await database.query<{ product_id: string; quantity: string }>(
              `select product_id, quantity from public.work_order_items
               where work_order_id = $1::uuid order by product_id`,
              [created.work_order_id],
            )).rows;
            expect(new Map(materials.map((row) => [row.product_id, row.quantity]))).toEqual(
              new Map([[runtime.componentIds[0]!, "20"], [runtime.componentIds[1]!, "30"]]),
            );
            expect((await database.query(
              "select id from public.pcb_production_runs where work_order_id = $1::uuid",
              [created.work_order_id],
            )).rowCount).toBe(0);
            expect((await database.query(
              `select id from public.inventory_movements
               where source_type in ('pcb_production_input', 'pcb_production_output')
                 and source_id in (select id from public.pcb_production_runs where work_order_id = $1::uuid)`,
              [created.work_order_id],
            )).rowCount).toBe(0);

            await database.query("savepoint frozen_material_update");
            await expect(database.query(
              `update public.work_order_items set quantity = quantity + 1
               where work_order_id = $1::uuid`,
              [created.work_order_id],
            )).rejects.toMatchObject({ code: "PCB12" });
            await database.query("rollback to savepoint frozen_material_update");

            const expectedUpdatedAt = (await database.query<{ updated_at: string }>(
              "select updated_at::text as updated_at from public.work_orders where id = $1::uuid",
              [created.work_order_id],
            )).rows[0]!.updated_at;
            await setPermissions(database, producer, admin.profileId, [
              "pcb.produce",
              "work_orders.delete_draft",
            ]);
            await queryAs(
              database,
              producer,
              "select * from public.delete_draft_work_order($1::uuid, $2::timestamptz)",
              [created.work_order_id, expectedUpdatedAt],
            );
            expect((await database.query(
              "select id from public.work_orders where id = $1::uuid",
              [created.work_order_id],
            )).rowCount).toBe(0);
            expect((await database.query(
              "select work_order_id from public.pcb_production_work_orders where work_order_id = $1::uuid",
              [created.work_order_id],
            )).rowCount).toBe(0);
            expect((await database.query(
              "select id from public.work_order_items where work_order_id = $1::uuid",
              [created.work_order_id],
            )).rowCount).toBe(0);
          });
        });

        it("accepts General Stock and empty BOM creation with exact quantity validation", async () => {
          const fixture = requireHarness();
          await fixture.withRollbackDatabaseTransaction(async (database) => {
            const admin = fixture.actors.admin;
            const runtime = await createRuntimeFixture(database, admin.profileId, { emptyBom: true });
            const created = await createProductionWorkOrder(database, admin, runtime, "00010");
            expect((await database.query<{ project_id: string | null }>(
              "select project_id from public.work_orders where id = $1::uuid",
              [created.work_order_id],
            )).rows[0]!.project_id).toBeNull();
            expect((await database.query(
              "select id from public.work_order_items where work_order_id = $1::uuid",
              [created.work_order_id],
            )).rowCount).toBe(0);
            expect((await database.query<{ planned_quantity: string }>(
              "select planned_quantity from public.pcb_production_work_orders where work_order_id = $1::uuid",
              [created.work_order_id],
            )).rows[0]!.planned_quantity).toBe("10");
            for (const invalid of ["0", "-1", "1.5", "1e2", "9223372036854775808"]) {
              await expectRpcRejected(
                database,
                admin,
                "select * from public.create_pcb_production_work_order($1::uuid, $2::text, null, $3::uuid)",
                [runtime.cardId, invalid, randomUUID()],
                "22023",
              );
            }
          });
        });

        it("finishes planned 10 / actual 8 atomically and posts exactly the specialized ledger", async () => {
          const fixture = requireHarness();
          await fixture.withRollbackDatabaseTransaction(async (database) => {
            const admin = fixture.actors.admin;
            const runtime = await createRuntimeFixture(database, admin.profileId, {
              includeProject: true,
            });
            const created = await createProductionWorkOrder(database, admin, runtime, "10");
            const updatedAt = (await database.query<{ updated_at: string }>(
              "select updated_at::text as updated_at from public.work_orders where id = $1::uuid",
              [created.work_order_id],
            )).rows[0]!.updated_at;
            const storageReference = `final/${created.work_order_id}/${randomUUID()}.pdf`;
            await database.query(
              `insert into storage.objects (bucket_id, name, metadata)
               values ('work-order-pdfs', $1::text,
                 pg_catalog.jsonb_build_object('mimetype', 'application/pdf'))`,
              [storageReference],
            );
            const result = await queryAs<{ project_completed: boolean; work_order_id: string }>(
              database,
              admin,
              `select * from public.finish_work_order(
                 $1::uuid, $2::timestamptz, $3::text, $4::text, $5::text
               )`,
              [created.work_order_id, updatedAt, storageReference, "a".repeat(64), "0008"],
            );
            expect(result[0]).toMatchObject({
              project_completed: false,
              work_order_id: created.work_order_id,
            });
            const balances = (await database.query<{ product_id: string; quantity: string }>(
              `select product_id, quantity from public.inventory_balances
               where product_id = any($1::uuid[])`,
              [[runtime.outputProductId, ...runtime.componentIds]],
            )).rows;
            expect(new Map(balances.map((row) => [row.product_id, row.quantity]))).toEqual(
              new Map([
                [runtime.outputProductId, "13"],
                [runtime.componentIds[0]!, "80"],
                [runtime.componentIds[1]!, "70"],
              ]),
            );
            const run = (await database.query<{ id: string; quantity_produced: string; work_order_id: string }>(
              `select id, quantity_produced, work_order_id
               from public.pcb_production_runs where work_order_id = $1::uuid`,
              [created.work_order_id],
            )).rows[0]!;
            expect(run).toMatchObject({ quantity_produced: "8", work_order_id: created.work_order_id });
            const movements = (await database.query<{
              movement_type: string;
              quantity_delta: string;
              source_id: string;
              source_type: string;
            }>(
              `select movement_type, source_type, source_id, quantity_delta
               from public.inventory_movements where source_id = $1::uuid
               order by quantity_delta`,
              [run.id],
            )).rows;
            expect(movements).toHaveLength(3);
            expect(movements.filter((row) => row.source_type === "pcb_production_input")
              .map((row) => row.quantity_delta).sort()).toEqual(["-20", "-30"]);
            expect(movements.filter((row) => row.source_type === "pcb_production_output"))
              .toEqual([expect.objectContaining({
                movement_type: "pcb_production_output",
                quantity_delta: "8",
                source_id: run.id,
              })]);
            expect((await database.query(
              "select id from public.work_order_pdfs where work_order_id = $1::uuid",
              [created.work_order_id],
            )).rowCount).toBe(1);
            expect((await database.query<{ status: string }>(
              "select status from public.work_orders where id = $1::uuid",
              [created.work_order_id],
            )).rows[0]!.status).toBe("finished");
            expect((await database.query<{ status: string }>(
              "select status from public.projects where id = $1::uuid",
              [runtime.projectId],
            )).rows[0]!.status).toBe("planned");
            expect((await database.query(
              `select id from public.audit_logs
               where entity_id in ($1::uuid, $2::uuid)
                 and action_type in ('work_order.finished', 'pcb_production.completed')`,
              [created.work_order_id, run.id],
            )).rowCount).toBe(2);
            await expectRpcRejected(
              database,
              admin,
              "select * from public.finish_work_order($1::uuid, $2::timestamptz, $3::text, null, '8')",
              [created.work_order_id, updatedAt, storageReference],
              "WOR02",
            );
            expect((await database.query(
              "select id from public.pcb_production_runs where work_order_id = $1::uuid",
              [created.work_order_id],
            )).rowCount).toBe(1);
          });
        });

        it("requires Finish authority, validates exact actual quantities, and records actual zero", async () => {
          const fixture = requireHarness();
          await fixture.withRollbackDatabaseTransaction(async (database) => {
            const admin = fixture.actors.admin;
            const producer = fixture.actors.supplierCreator;
            const finisher = fixture.actors.supplierViewer;
            const runtime = await createRuntimeFixture(database, admin.profileId);
            await setPermissions(database, producer, admin.profileId, ["pcb.produce"]);
            await setPermissions(database, finisher, admin.profileId, ["work_orders.finish"]);
            const created = await createProductionWorkOrder(database, producer, runtime, "10");
            const updatedAt = (await database.query<{ updated_at: string }>(
              "select updated_at::text as updated_at from public.work_orders where id = $1::uuid",
              [created.work_order_id],
            )).rows[0]!.updated_at;
            const storageReference = `final/${created.work_order_id}/${randomUUID()}.pdf`;
            await database.query(
              `insert into storage.objects (bucket_id, name, metadata)
               values ('work-order-pdfs', $1::text,
                 pg_catalog.jsonb_build_object('mimetype', 'application/pdf'))`,
              [storageReference],
            );
            await expectRpcRejected(
              database,
              producer,
              "select * from public.finish_work_order($1::uuid, $2::timestamptz, $3::text, null, '0')",
              [created.work_order_id, updatedAt, storageReference],
              "42501",
            );
            for (const invalid of ["11", "-1", "1.5", "1e2", "9223372036854775808"]) {
              await expectRpcRejected(
                database,
                finisher,
                "select * from public.preflight_finish_pcb_production_work_order($1::uuid, $2::timestamptz, $3::text)",
                [created.work_order_id, updatedAt, invalid],
                "22023",
              );
            }

            await queryAs(
              database,
              finisher,
              "select * from public.finish_work_order($1::uuid, $2::timestamptz, $3::text, null, '0000')",
              [created.work_order_id, updatedAt, storageReference],
            );
            const run = (await database.query<{ id: string; quantity_produced: string }>(
              "select id, quantity_produced from public.pcb_production_runs where work_order_id = $1::uuid",
              [created.work_order_id],
            )).rows[0]!;
            expect(run.quantity_produced).toBe("0");
            const movements = (await database.query<{ source_type: string }>(
              "select source_type from public.inventory_movements where source_id = $1::uuid order by source_type",
              [run.id],
            )).rows;
            expect(movements).toEqual([
              { source_type: "pcb_production_input" },
              { source_type: "pcb_production_input" },
            ]);
            expect((await database.query<{ quantity: string }>(
              "select quantity from public.inventory_balances where product_id = $1::uuid",
              [runtime.outputProductId],
            )).rows[0]!.quantity).toBe("5");
            const inputBalances = (await database.query<{ product_id: string; quantity: string }>(
              `select product_id, quantity from public.inventory_balances
               where product_id = any($1::uuid[])`,
              [runtime.componentIds],
            )).rows;
            expect(new Map(inputBalances.map((row) => [row.product_id, row.quantity]))).toEqual(
              new Map([[runtime.componentIds[0]!, "80"], [runtime.componentIds[1]!, "70"]]),
            );
          });
        });

        it("finishes an empty-BOM General Stock order without fabricating input movements", async () => {
          const fixture = requireHarness();
          await fixture.withRollbackDatabaseTransaction(async (database) => {
            const admin = fixture.actors.admin;
            const runtime = await createRuntimeFixture(database, admin.profileId, { emptyBom: true });
            const created = await createProductionWorkOrder(database, admin, runtime, "10");
            const updatedAt = (await database.query<{ updated_at: string }>(
              "select updated_at::text as updated_at from public.work_orders where id = $1::uuid",
              [created.work_order_id],
            )).rows[0]!.updated_at;
            const storageReference = `final/${created.work_order_id}/${randomUUID()}.pdf`;
            await database.query(
              `insert into storage.objects (bucket_id, name, metadata)
               values ('work-order-pdfs', $1::text,
                 pg_catalog.jsonb_build_object('mimetype', 'application/pdf'))`,
              [storageReference],
            );
            await queryAs(
              database,
              admin,
              "select * from public.finish_work_order($1::uuid, $2::timestamptz, $3::text, null, '10')",
              [created.work_order_id, updatedAt, storageReference],
            );
            const run = (await database.query<{ id: string }>(
              "select id from public.pcb_production_runs where work_order_id = $1::uuid",
              [created.work_order_id],
            )).rows[0]!;
            const movements = (await database.query<{ quantity_delta: string; source_type: string }>(
              "select source_type, quantity_delta from public.inventory_movements where source_id = $1::uuid",
              [run.id],
            )).rows;
            expect(movements).toEqual([{ source_type: "pcb_production_output", quantity_delta: "10" }]);
            expect((await database.query<{ quantity: string }>(
              "select quantity from public.inventory_balances where product_id = $1::uuid",
              [runtime.outputProductId],
            )).rows[0]!.quantity).toBe("15");
          });
        });

        it("records zero actual output without a zero movement and rolls back a late audit failure", async () => {
          const fixture = requireHarness();
          await fixture.withRollbackDatabaseTransaction(async (database) => {
            const admin = fixture.actors.admin;
            const runtime = await createRuntimeFixture(database, admin.profileId);
            const created = await createProductionWorkOrder(database, admin, runtime, "10");
            const updatedAt = (await database.query<{ updated_at: string }>(
              "select updated_at::text as updated_at from public.work_orders where id = $1::uuid",
              [created.work_order_id],
            )).rows[0]!.updated_at;
            const storageReference = `final/${created.work_order_id}/${randomUUID()}.pdf`;
            await database.query(
              `insert into storage.objects (bucket_id, name, metadata)
               values ('work-order-pdfs', $1::text,
                 pg_catalog.jsonb_build_object('mimetype', 'application/pdf'))`,
              [storageReference],
            );
            await database.query(
              `create function pg_temp.reject_pcb_production_completion_audit()
               returns trigger language plpgsql set search_path = ''
               as $test_function$
               begin
                 if new.action_type = 'pcb_production.completed' then
                   raise exception 'Forced PCB completion audit failure' using errcode = 'TST21';
                 end if;
                 return new;
               end;
               $test_function$`,
            );
            await database.query(
              `create trigger reject_pcb_production_completion_audit_test
               before insert on public.audit_logs for each row
               execute function pg_temp.reject_pcb_production_completion_audit()`,
            );
            const beforeBalances = (await database.query(
              `select product_id, quantity from public.inventory_balances
               where product_id = any($1::uuid[]) order by product_id`,
              [[runtime.outputProductId, ...runtime.componentIds]],
            )).rows;
            await expectRpcRejected(
              database,
              admin,
              "select * from public.finish_work_order($1::uuid, $2::timestamptz, $3::text, null, '0')",
              [created.work_order_id, updatedAt, storageReference],
              "TST21",
            );
            expect((await database.query(
              `select product_id, quantity from public.inventory_balances
               where product_id = any($1::uuid[]) order by product_id`,
              [[runtime.outputProductId, ...runtime.componentIds]],
            )).rows).toEqual(beforeBalances);
            expect((await database.query(
              "select id from public.pcb_production_runs where work_order_id = $1::uuid",
              [created.work_order_id],
            )).rowCount).toBe(0);
            expect((await database.query(
              "select id from public.work_order_pdfs where work_order_id = $1::uuid",
              [created.work_order_id],
            )).rowCount).toBe(0);
            expect((await database.query<{ status: string }>(
              "select status from public.work_orders where id = $1::uuid",
              [created.work_order_id],
            )).rows[0]!.status).toBe("draft");
          });
        });

        it("leaves no committed runtime campaign fixtures on shared development", async () => {
          const fixture = requireHarness();
          await fixture.withRollbackDatabaseTransaction(async (database) => {
            const residue = (await database.query<{
              cards: string;
              products: string;
              projects: string;
              work_orders: string;
            }>(
              `select
                 (select pg_catalog.count(*) from public.pcb_cards as card
                  where card.name like 'Runtime PCB %')::text as cards,
                 (select pg_catalog.count(*) from public.products as product
                  where product.name like 'PCB production Work Order runtime Product %')::text as products,
                 (select pg_catalog.count(*) from public.projects as project
                  where project.name like 'Runtime Project %')::text as projects,
                 (select pg_catalog.count(*) from public.work_orders as work_order
                  where work_order.description like 'PCB production — Runtime PCB %')::text as work_orders`,
            )).rows[0]!;
            expect(residue).toEqual({ cards: "0", products: "0", projects: "0", work_orders: "0" });
          });
        });
      },
    );
  });
}
