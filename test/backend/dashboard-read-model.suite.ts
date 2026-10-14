import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";
import { createTestSerialNumber } from "./helpers/serial";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261001130000_add_permission_aware_dashboard_read_model.sql",
);

type JsonObject = Record<string, unknown>;

interface DashboardRow extends QueryResultRow {
  model: JsonObject;
}

async function setActor(database: PoolClient, actor: SecurityActor | null) {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor?.authUserId ?? ""],
  );
  await database.query(actor ? "set local role authenticated" : "set local role anon");
}

async function callDashboard(
  database: PoolClient,
  actor: SecurityActor,
): Promise<JsonObject> {
  await setActor(database, actor);
  try {
    const result = await database.query<DashboardRow>(
      "select public.get_dashboard_read_model() as model",
    );
    return result.rows[0]!.model;
  } finally {
    await database.query("reset role");
  }
}

async function expectDashboardDenied(
  database: PoolClient,
  actor: SecurityActor | null,
) {
  await database.query("savepoint rejected_dashboard_call");
  await setActor(database, actor);
  try {
    await expect(database.query(
      "select public.get_dashboard_read_model()",
    )).rejects.toMatchObject({ code: "42501" });
  } finally {
    await database.query("rollback to savepoint rejected_dashboard_call");
    await database.query("release savepoint rejected_dashboard_call");
    await database.query("reset role");
  }
}

async function expectNoDirectRows(
  database: PoolClient,
  actor: SecurityActor,
  query: string,
  parameters: readonly unknown[] = [],
) {
  await database.query("savepoint direct_dashboard_source_read");
  await setActor(database, actor);
  try {
    const result = await database.query<{ count: string }>(query, [...parameters]);
    expect(result.rows).toEqual([{ count: "0" }]);
  } catch (error) {
    await database.query("rollback to savepoint direct_dashboard_source_read");
    expect(error).toMatchObject({ code: "42501" });
  } finally {
    await database.query("reset role");
    await database.query("release savepoint direct_dashboard_source_read");
  }
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

  const granted = await database.query<{ key: string }>(
    `select definition.key
     from public.user_permissions as permission
     join public.permission_definitions as definition
       on definition.id = permission.permission_definition_id
     where permission.user_id = $1::uuid
       and definition.key = any($2::text[])
     order by definition.key`,
    [actor.profileId, permissions],
  );
  expect(granted.rows.map((row) => row.key)).toEqual([...permissions].sort());
}

function expectExactKeys(value: unknown, keys: readonly string[]) {
  expect(value).not.toBeNull();
  expect(typeof value).toBe("object");
  expect(Object.keys(value as JsonObject).sort()).toEqual([...keys].sort());
}

const dashboardSnapshotTables = [
  "audit_logs",
  "calendar_entries",
  "inventory_balances",
  "inventory_movements",
  "procurement_requests",
  "products",
  "projects",
  "user_permissions",
  "user_profiles",
  "work_orders",
] as const;

async function readDashboardSnapshots(database: PoolClient) {
  const snapshots: Record<string, string> = {};
  for (const tableName of dashboardSnapshotTables) {
    const result = await database.query<{ snapshot: string }>(
      `select coalesce(
         pg_catalog.string_agg(
           pg_catalog.to_jsonb(snapshot_row)::text,
           E'\\n'
           order by pg_catalog.to_jsonb(snapshot_row)::text
         ),
         ''
       ) as snapshot
       from public.${tableName} as snapshot_row`,
    );
    snapshots[tableName] = result.rows[0]?.snapshot ?? "";
  }
  return snapshots;
}

export function registerDashboardReadModelTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 140 permission-aware Dashboard read model (static)", () => {
    it("defines one hardened parameter-free JSON aggregation boundary", () => {
      const sql = readFileSync(migrationPath, "utf8");

      expect(sql).toContain("create function public.get_dashboard_read_model()");
      expect(sql).toContain("returns jsonb");
      expect(sql).toContain("language plpgsql\nstable\nsecurity definer\nset search_path = ''");
      expect(sql).toContain("if auth.uid() is null");
      expect(sql).toContain("or public.current_active_user_profile_id() is null");
      expect(sql).toContain("public.has_permission('dashboard.view')");
      expect(sql).toContain("raise exception 'Access denied'");
      expect(sql).toContain("using errcode = '42501'");
      expect(sql).toContain("from public, anon, authenticated;");
      expect(sql).toContain("to authenticated;");
      expect(sql).not.toMatch(/get_dashboard_read_model\s*\([^)]*[a-z_]+/i);
    });

    it("guards every protected source query before access and preserves null sections", () => {
      const sql = readFileSync(migrationPath, "utf8");
      const guards: Array<[string, string]> = [
        ["can_view_projects", "public.projects"],
        ["can_view_work_orders", "public.work_orders"],
        ["can_view_procurement", "public.procurement_requests"],
        ["can_view_inventory", "public.products"],
        ["can_view_activity", "public.audit_logs"],
      ];

      for (const [permissionGuard, source] of guards) {
        const guardAt = sql.indexOf(`if ${permissionGuard} then`);
        const sourceAt = sql.indexOf(`from ${source}`, guardAt);
        const endAt = sql.indexOf("end if;", guardAt);
        expect(guardAt).toBeGreaterThan(-1);
        expect(sourceAt).toBeGreaterThan(guardAt);
        expect(sourceAt).toBeLessThan(endAt);
      }

      for (const variable of [
        "projects_section", "work_orders_section", "procurement_section",
        "inventory_section", "activity_section",
      ]) {
        expect(sql).toContain(`${variable} jsonb := null;`);
      }
    });

    it("locks exact bounded projections and deterministic orderings", () => {
      const sql = readFileSync(migrationPath, "utf8");

      for (const status of [
        "planned", "in_progress", "on_hold", "completed", "cancelled",
      ]) expect(sql).toContain(`project.status = '${status}'`);

      expect(sql).toContain("order by project_list.updated_at desc, project_list.id desc\n          limit 5");
      expect(sql).toContain("order by work_order.updated_at desc, work_order.id desc\n      limit 5");
      expect(sql).toContain("where request_list.status in ('active', 'partly_delivered')");
      expect(sql).toContain("order by request_list.updated_at desc, request_list.id desc\n          limit 5");
      expect(sql).toContain("where product_list.is_active");
      expect(sql).toContain("order by product_list.updated_at desc, product_list.id desc\n          limit 5");
      expect(sql).toContain("order by audit.created_at desc, audit.id desc\n      limit 5");
      expect(sql).toContain("order by\n      candidate.effective_date,\n      candidate.start_date,\n      candidate.kind,\n      candidate.id\n    limit 5");

      expect(sql).toContain("unresolved_request.requested_quantity::text");
      expect(sql).toContain("unresolved_request.delivered_quantity::text");
      expect(sql).toContain("recent_product.quantity::text");
      expect(sql).not.toMatch(/low.?stock|reorder|critical.?stock/i);
    });

    it("filters Activity by source-module authorization before its limit", () => {
      const sql = readFileSync(migrationPath, "utf8");
      const activity = sql.slice(
        sql.indexOf("if can_view_activity then"),
        sql.indexOf("with calendar_candidates"),
      );

      for (const [entityType, guard] of [
        ["project", "can_view_projects"],
        ["project_product", "can_view_projects"],
        ["project_product_component", "can_view_projects"],
        ["procurement_request", "can_view_procurement"],
        ["product", "can_view_inventory"],
        ["brand", "can_view_inventory"],
        ["product_inventory", "can_view_inventory"],
        ["pcb_card", "can_view_pcb"],
        ["pcb_bom_version", "can_view_pcb"],
        ["pcb_production_run", "can_view_pcb"],
        ["work_order", "can_view_work_orders"],
        ["supplier", "can_view_suppliers"],
      ]) expect(activity).toContain(`when '${entityType}' then ${guard}`);

      expect(activity).toContain("can_view_inventory or can_view_suppliers");
      expect(activity).toContain("when 'calendar_entry' then true");
      expect(activity).toContain("else false");
      expect(activity).not.toContain("before_data");
      expect(activity).not.toContain("after_data");
      expect(activity).not.toContain("metadata");
      expect(activity.indexOf("where actor_is_admin")).toBeLessThan(
        activity.indexOf("limit 5"),
      );
    });

    it("derives a minimized upcoming Calendar feed with exact leap-day semantics", () => {
      const sql = readFileSync(migrationPath, "utf8");
      const calendar = sql.slice(sql.indexOf("with calendar_candidates"));

      expect(calendar).toContain("where entry.end_date >= dashboard_date");
      expect(calendar).toContain("greatest(entry.start_date, dashboard_date)");
      expect(calendar).toContain("where birthday.is_active");
      expect(calendar).toContain("and birthday.birthday is not null");
      expect(calendar).toContain("year_value.year_number % 400 = 0");
      expect(calendar).toContain("then null");
      expect(calendar).toContain("pg_catalog.make_date(");
      expect(calendar).toContain("candidate.occurrence_date >= dashboard_date");
      expect(calendar).not.toContain("birthday.birthday::text");
      expect(calendar).not.toMatch(/\bage\s*\(/i);
      expect(calendar).not.toMatch(/email|auth_user_id|is_admin|user_permissions/i);
    });

    it("is a pure read and adds no speculative index or broader grant", () => {
      const sql = readFileSync(migrationPath, "utf8");

      expect(sql).not.toMatch(/\binsert\s+into\b/i);
      expect(sql).not.toMatch(/\bupdate\s+public\./i);
      expect(sql).not.toMatch(/\bdelete\s+from\b/i);
      expect(sql).not.toMatch(/\bcreate\s+index\b/i);
      expect(sql).not.toMatch(/grant\s+select\s+on\s+table/i);
      expect(sql).not.toContain("pg_catalog.coalesce");
      expect(sql).not.toContain("public.inventory_movements");
      expect(sql).not.toContain("public.work_order_items");
      expect(sql).not.toContain("public.work_order_pdfs");
      expect(sql).not.toContain("public.pcb_bom_items");
    });
  });

  describe.skipIf(process.env.TASK140_MIGRATION !== "1")(
    "Task 140 permission-aware Dashboard read model (requires deployed migration)",
    () => {
      it("enforces Dashboard access and active-account authorization", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.unpermitted;
          const inactive = fixture.actors.inactive;

          expect(await callDashboard(database, fixture.actors.admin)).toBeTruthy();

          await setPermissions(database, fixture, actor, ["dashboard.view"]);
          expect(await callDashboard(database, actor)).toBeTruthy();

          await setPermissions(database, fixture, actor, []);
          await expectDashboardDenied(database, actor);

          await setPermissions(database, fixture, inactive, ["dashboard.view"]);
          await expectDashboardDenied(database, inactive);
          await expectDashboardDenied(database, null);
        });
      });

      it("enforces the complete Dashboard section authorization matrix", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.unpermitted;
          const protectedSections = [
            "projects", "work_orders", "procurement", "inventory", "activity",
          ] as const;
          const cases: Array<{
            permissions: string[];
            visible: Array<(typeof protectedSections)[number]>;
          }> = [
            { permissions: [], visible: [] },
            { permissions: ["projects.view"], visible: ["projects"] },
            { permissions: ["work_orders.view"], visible: ["work_orders"] },
            { permissions: ["procurement.view"], visible: ["procurement"] },
            { permissions: ["inventory.view"], visible: ["inventory"] },
            { permissions: ["archive.view"], visible: ["activity"] },
            {
              permissions: ["archive.view", "projects.view"],
              visible: ["projects", "activity"],
            },
            {
              permissions: ["archive.view", "work_orders.view"],
              visible: ["work_orders", "activity"],
            },
            {
              permissions: ["archive.view", "procurement.view"],
              visible: ["procurement", "activity"],
            },
            {
              permissions: ["archive.view", "inventory.view"],
              visible: ["inventory", "activity"],
            },
            { permissions: ["archive.view", "suppliers.view"], visible: ["activity"] },
            { permissions: ["archive.view", "pcb.view"], visible: ["activity"] },
            {
              permissions: [
                "projects.view", "work_orders.view", "procurement.view",
                "inventory.view", "archive.view", "suppliers.view", "pcb.view",
              ],
              visible: [...protectedSections],
            },
          ];

          for (const dashboardCase of cases) {
            await setPermissions(database, fixture, actor, [
              "dashboard.view", ...dashboardCase.permissions,
            ]);
            const model = await callDashboard(database, actor);
            expectExactKeys(model, [
              "projects", "work_orders", "procurement", "inventory", "activity",
              "calendar",
            ]);
            for (const section of protectedSections) {
              expect(model[section] === null).toBe(
                !dashboardCase.visible.includes(section),
              );
            }
            expectExactKeys(model.calendar, ["upcoming"]);
          }

          const admin = await callDashboard(database, fixture.actors.admin);
          for (const section of [...protectedSections, "calendar"] as const) {
            expect(admin[section]).not.toBeNull();
          }
        });
      });

      it("returns bounded minimized sections with exact bigint text and no side effects", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const adminId = fixture.actors.admin.profileId;
          const suffix = randomUUID().slice(0, 8);
          const projectId = randomUUID();
          const finishedProjectId = randomUUID();
          const supplierId = randomUUID();
          const productId = randomUUID();
          const workOrderId = randomUUID();
          const finishedWorkOrderId = randomUUID();
          const requestId = randomUUID();
          const resolvedRequestId = randomUUID();
          const auditId = randomUUID();
          const calendarId = randomUUID();
          const serial = createTestSerialNumber();
          const workOrderNumber = `RN-2099-${String(
            Number.parseInt(randomUUID().replace(/\D/g, "").slice(0, 4) || "1", 10) % 10_000,
          ).padStart(4, "0")}`;

          await database.query(
            `insert into public.projects (
               id, name, customer_name, status, start_date, delivery_date,
               created_at, created_by_user_id, updated_at, updated_by_user_id
             ) values (
               $1::uuid, $2::text, 'Dashboard Customer', 'planned',
               '2099-01-01'::date, '2099-02-01'::date,
               '2099-01-01T00:00:00Z'::timestamptz, $3::uuid,
               '2099-01-02T00:00:00Z'::timestamptz, $3::uuid
             )`,
            [projectId, `Dashboard Project ${suffix}`, adminId],
          );
          await database.query(
            `insert into public.projects (
               id, name, customer_name, status, start_date, delivery_date,
               created_at, created_by_user_id, updated_at, updated_by_user_id,
               completed_at
             ) values (
               $1::uuid, $2::text, 'Dashboard Customer', 'completed',
               '2098-01-01'::date, '2098-02-01'::date,
               '2098-01-01T00:00:00Z'::timestamptz, $3::uuid,
               '2098-01-02T00:00:00Z'::timestamptz, $3::uuid,
               '2098-01-02T00:00:00Z'::timestamptz
             )`,
            [finishedProjectId, `Dashboard Finished Project ${suffix}`, adminId],
          );
          await database.query(
            `insert into public.work_orders (
               id, work_order_number, project_id, customer_name_snapshot,
               description, status, created_at, created_by_user_id,
               updated_at, updated_by_user_id
             ) values (
               $1::uuid, $2::text, $3::uuid, 'Dashboard Customer',
               'Dashboard work', 'draft',
               '2099-01-03T00:00:00Z'::timestamptz, $4::uuid,
               '2099-01-04T00:00:00Z'::timestamptz, $4::uuid
             )`,
            [workOrderId, workOrderNumber, projectId, adminId],
          );
          await database.query(
            `insert into public.work_orders (
               id, work_order_number, project_id, customer_name_snapshot,
               description, status, created_at, created_by_user_id,
               updated_at, updated_by_user_id, finished_at, finished_by_user_id
             ) values (
               $1::uuid, $2::text, $3::uuid, 'Dashboard Customer',
               'Finished dashboard work', 'finished',
               '2098-01-03T00:00:00Z'::timestamptz, $4::uuid,
               '2098-01-04T00:00:00Z'::timestamptz, $4::uuid,
               '2098-01-04T00:00:00Z'::timestamptz, $4::uuid
             )`,
            [
              finishedWorkOrderId,
              `RN-2098-${String((Number.parseInt(workOrderNumber.slice(-4), 10) + 1) % 10_000).padStart(4, "0")}`,
              finishedProjectId,
              adminId,
            ],
          );
          await database.query(
            `insert into public.suppliers (
               id, name, catalog_number, country, created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::text, 'DASHBOARD-CAT', 'BA', $3::uuid, $3::uuid)`,
            [supplierId, `Dashboard Supplier ${suffix}`, adminId],
          );
          await database.query(
            `insert into public.products (
               id, serial_number, name, category, product_kind,
               created_at, created_by_user_id, updated_at, updated_by_user_id
             ) values (
               $1::uuid, $2::text, 'Dashboard Product', 'Test', 'component',
               '2099-01-05T00:00:00Z'::timestamptz, $3::uuid,
               '2099-01-06T00:00:00Z'::timestamptz, $3::uuid
             )`,
            [productId, serial, adminId],
          );
          await database.query(
            `update public.inventory_balances
             set quantity = 9223372036854775807,
                 updated_at = '2099-01-06T00:00:00Z'::timestamptz
             where product_id = $1::uuid`,
            [productId],
          );
          await database.query(
            `insert into public.procurement_requests (
               id, product_id, requested_name, supplier_id,
               requested_quantity, delivered_quantity, status,
               created_at, created_by_user_id, updated_at, updated_by_user_id
             ) values (
               $1::uuid, $2::uuid, 'Dashboard Product', $3::uuid,
               9223372036854775807, 1, 'partly_delivered',
               '2099-01-07T00:00:00Z'::timestamptz, $4::uuid,
               '2099-01-08T00:00:00Z'::timestamptz, $4::uuid
             )`,
            [requestId, productId, supplierId, adminId],
          );
          await database.query(
            `insert into public.procurement_requests (
               id, product_id, requested_name, supplier_id,
               requested_quantity, delivered_quantity, status,
               created_at, created_by_user_id, updated_at, updated_by_user_id,
               resolved_at, resolved_by_user_id
             ) values (
               $1::uuid, $2::uuid, 'Resolved Dashboard Product', $3::uuid,
               2, 0, 'resolved',
               '2099-01-09T00:00:00Z'::timestamptz, $4::uuid,
               '2099-01-10T00:00:00Z'::timestamptz, $4::uuid,
               '2099-01-10T00:00:00Z'::timestamptz, $4::uuid
             )`,
            [resolvedRequestId, productId, supplierId, adminId],
          );
          await database.query(
            `insert into public.audit_logs (
               id, actor_user_id, action_type, entity_type, entity_id,
               summary, created_at
             ) values (
               $1::uuid, $2::uuid, 'dashboard.checked', 'project', $3::uuid,
               'Dashboard test activity',
               '2099-01-09T00:00:00Z'::timestamptz
             )`,
            [auditId, adminId, projectId],
          );
          await database.query(
            `insert into public.calendar_entries (
               id, entry_type, title, start_date, end_date,
               created_by_user_id, updated_by_user_id
             ) values (
               $1::uuid, 'event', 'Dashboard event', current_date, current_date,
               $2::uuid, $2::uuid
             )`,
            [calendarId, adminId],
          );

          const before = await readDashboardSnapshots(database);
          const model = await callDashboard(database, fixture.actors.admin);
          expect(await readDashboardSnapshots(database)).toEqual(before);

          expectExactKeys(model, [
            "projects", "work_orders", "procurement", "inventory", "activity",
            "calendar",
          ]);
          const projects = model.projects as JsonObject;
          const workOrders = model.work_orders as JsonObject;
          const procurement = model.procurement as JsonObject;
          const inventory = model.inventory as JsonObject;
          const activity = model.activity as JsonObject;
          const calendar = model.calendar as JsonObject;

          expect((projects.recent as unknown[]).length).toBeLessThanOrEqual(5);
          expect((workOrders.recent as unknown[]).length).toBeLessThanOrEqual(5);
          expect((procurement.unresolved as unknown[]).length).toBeLessThanOrEqual(5);
          expect((inventory.recent as unknown[]).length).toBeLessThanOrEqual(5);
          expect((activity.recent as unknown[]).length).toBeLessThanOrEqual(5);
          expect((calendar.upcoming as unknown[]).length).toBeLessThanOrEqual(5);

          const expectedStatusCounts = await database.query<Record<string, string>>(
            `select
               pg_catalog.count(*) filter (where status = 'planned')::text as planned,
               pg_catalog.count(*) filter (where status = 'in_progress')::text as in_progress,
               pg_catalog.count(*) filter (where status = 'on_hold')::text as on_hold,
               pg_catalog.count(*) filter (where status = 'completed')::text as completed,
               pg_catalog.count(*) filter (where status = 'cancelled')::text as cancelled
             from public.projects`,
          );
          expect(projects.status_counts).toEqual(Object.fromEntries(
            Object.entries(expectedStatusCounts.rows[0]!).map(([key, value]) => [
              key, Number(value),
            ]),
          ));
          expectExactKeys((projects.recent as JsonObject[])[0], [
            "id", "name", "customer_name", "status", "delivery_date", "updated_at",
          ]);

          const product = (inventory.recent as JsonObject[]).find(
            (row) => row.product_id === productId,
          );
          expect(product?.quantity).toBe("9223372036854775807");
          expectExactKeys(product, [
            "product_id", "serial_number", "name", "category", "quantity",
            "updated_at",
          ]);

          const request = (procurement.unresolved as JsonObject[]).find(
            (row) => row.id === requestId,
          );
          expect(request).toMatchObject({
            requested_quantity: "9223372036854775807",
            delivered_quantity: "1",
            remaining_quantity: "9223372036854775806",
          });
          expect((procurement.unresolved as JsonObject[]).some(
            (row) => row.id === resolvedRequestId,
          )).toBe(false);
          const unresolvedCount = await database.query<{ count: string }>(
            `select pg_catalog.count(*)::text as count
             from public.procurement_requests
             where status in ('active', 'partly_delivered')`,
          );
          expect(procurement.unresolved_count).toBe(Number(unresolvedCount.rows[0]!.count));
          expectExactKeys(request, [
            "id", "requested_name", "status", "requested_quantity",
            "delivered_quantity", "remaining_quantity", "product_serial_number",
            "created_at", "updated_at",
          ]);

          expectExactKeys((workOrders.recent as JsonObject[])[0], [
            "id", "work_order_number", "status", "project_id",
            "customer_name_snapshot", "created_at", "updated_at", "finished_at",
          ]);
          expect((workOrders.recent as JsonObject[]).some(
            (row) => row.id === workOrderId && row.status === "draft",
          )).toBe(true);
          expect((workOrders.recent as JsonObject[]).some(
            (row) => row.id === finishedWorkOrderId && row.status === "finished",
          )).toBe(true);
          expectExactKeys((activity.recent as JsonObject[])[0], [
            "audit_log_id", "actor_user_id", "actor_full_name", "action_type",
            "entity_type", "entity_id", "summary", "created_at",
          ]);

          const dashboardOnlyActor = fixture.actors.unpermitted;
          await setPermissions(database, fixture, dashboardOnlyActor, ["dashboard.view"]);
          for (const [query, parameters] of [
            ["select pg_catalog.count(*)::text as count from public.projects where id = $1::uuid", [projectId]],
            ["select pg_catalog.count(*)::text as count from public.work_orders where id = $1::uuid", [workOrderId]],
            ["select pg_catalog.count(*)::text as count from public.procurement_requests where id = $1::uuid", [requestId]],
            ["select pg_catalog.count(*)::text as count from public.products where id = $1::uuid", [productId]],
            ["select pg_catalog.count(*)::text as count from public.audit_logs where id = $1::uuid", [auditId]],
            ["select pg_catalog.count(*)::text as count from public.user_profiles where id = $1::uuid", [adminId]],
          ] as const) {
            await expectNoDirectRows(
              database,
              dashboardOnlyActor,
              query,
              parameters,
            );
          }
        });
      });

      it("filters Activity before LIMIT and excludes sensitive or unknown families", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.unpermitted;
          const adminId = fixture.actors.admin.profileId;
          await setPermissions(database, fixture, actor, [
            "dashboard.view", "archive.view", "projects.view",
          ]);

          for (let index = 0; index < 7; index += 1) {
            await database.query(
              `insert into public.audit_logs (
                 id, actor_user_id, action_type, entity_type, summary, created_at
               ) values (
                 $1::uuid, $2::uuid, 'dashboard.hidden', $3::text,
                 'Hidden Dashboard activity',
                 ('2099-02-01T00:00:00Z'::timestamptz + $4::integer * interval '1 second')
               )`,
              [
                randomUUID(), adminId,
                index % 2 === 0 ? "user_profile" : "unknown_dashboard_type",
                index,
              ],
            );
          }
          for (let index = 0; index < 5; index += 1) {
            await database.query(
              `insert into public.audit_logs (
                 id, actor_user_id, action_type, entity_type, summary, created_at
               ) values (
                 $1::uuid, $2::uuid, 'dashboard.visible', 'project',
                 $3::text,
                 ('2099-01-01T00:00:00Z'::timestamptz + $4::integer * interval '1 second')
               )`,
              [randomUUID(), adminId, `Visible project ${index}`, index],
            );
          }

          const model = await callDashboard(database, actor);
          const rows = (model.activity as JsonObject).recent as JsonObject[];
          expect(rows).toHaveLength(5);
          expect(rows.every((row) => row.entity_type === "project")).toBe(true);
          expect(rows.map((row) => row.summary)).toEqual([
            "Visible project 4", "Visible project 3", "Visible project 2",
            "Visible project 1", "Visible project 0",
          ]);
          for (const row of rows) {
            expectExactKeys(row, [
              "audit_log_id", "actor_user_id", "actor_full_name", "action_type",
              "entity_type", "entity_id", "summary", "created_at",
            ]);
          }
        });
      });

      it("enforces the complete non-admin Activity module matrix", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actor = fixture.actors.unpermitted;
          const adminId = fixture.actors.admin.profileId;
          const entityTypes = [
            "project", "project_product", "project_product_component",
            "procurement_request", "product", "brand", "product_inventory",
            "product_supplier", "pcb_card", "pcb_bom_version", "pcb_production_run",
            "work_order", "calendar_entry", "supplier", "user_profile",
            "user_permission", "security", "documentation_record", "fixed_asset",
            "unknown_dashboard_type",
          ] as const;

          for (const [index, entityType] of entityTypes.entries()) {
            await database.query(
              `insert into public.audit_logs (
                 id, actor_user_id, action_type, entity_type, summary, created_at
               ) values (
                 $1::uuid, $2::uuid, 'dashboard.matrix', $3::text, $4::text,
                 ('2099-04-01T00:00:00Z'::timestamptz + $5::integer * interval '1 second')
               )`,
              [randomUUID(), adminId, entityType, `Matrix ${entityType}`, index],
            );
          }

          const cases = [
            {
              permission: null,
              allowed: ["calendar_entry"],
            },
            {
              permission: "projects.view",
              allowed: ["project", "project_product", "project_product_component", "calendar_entry"],
            },
            {
              permission: "procurement.view",
              allowed: ["procurement_request", "calendar_entry"],
            },
            {
              permission: "inventory.view",
              allowed: ["product", "brand", "product_inventory", "product_supplier", "calendar_entry"],
            },
            {
              permission: "suppliers.view",
              allowed: ["product_supplier", "supplier", "calendar_entry"],
            },
            {
              permission: "pcb.view",
              allowed: ["pcb_card", "pcb_bom_version", "pcb_production_run", "calendar_entry"],
            },
            {
              permission: "work_orders.view",
              allowed: ["work_order", "calendar_entry"],
            },
          ] as const;

          for (const activityCase of cases) {
            await setPermissions(database, fixture, actor, [
              "dashboard.view",
              "archive.view",
              ...(activityCase.permission ? [activityCase.permission] : []),
            ]);
            const model = await callDashboard(database, actor);
            const rows = (model.activity as JsonObject).recent as JsonObject[];
            expect(rows.length).toBeLessThanOrEqual(5);
            expect(rows.every((row) =>
              activityCase.allowed.includes(row.entity_type as never)
            )).toBe(true);
            for (const allowedType of activityCase.allowed) {
              expect(rows.some((row) => row.entity_type === allowedType)).toBe(true);
            }
            expect(rows.some((row) => [
              "user_profile", "user_permission", "security",
              "documentation_record", "fixed_asset",
              "unknown_dashboard_type",
            ].includes(row.entity_type as string))).toBe(false);
          }

          const admin = await callDashboard(database, fixture.actors.admin);
          const adminRows = (admin.activity as JsonObject).recent as JsonObject[];
          expect(adminRows).toHaveLength(5);
          expect(adminRows.some((row) => [
            "user_profile", "user_permission", "security",
            "documentation_record", "fixed_asset",
            "unknown_dashboard_type",
          ].includes(row.entity_type as string))).toBe(true);
        });
      });

      it("keeps the deployed function ACL narrow and browser source reads permission-bound", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const metadata = await database.query<{
            authenticated_execute: boolean;
            anonymous_execute: boolean;
            public_execute: boolean;
            security_definer: boolean;
            search_path: string;
            volatility: string;
          }>(
            `select
               pg_catalog.has_function_privilege(
                 'authenticated', 'public.get_dashboard_read_model()', 'EXECUTE'
               ) as authenticated_execute,
               pg_catalog.has_function_privilege(
                 'anon', 'public.get_dashboard_read_model()', 'EXECUTE'
               ) as anonymous_execute,
               pg_catalog.has_function_privilege(
                 'public', 'public.get_dashboard_read_model()', 'EXECUTE'
               ) as public_execute,
               routine.prosecdef as security_definer,
               coalesce(
                 (
                   select setting
                   from pg_catalog.unnest(routine.proconfig) as setting
                   where setting like 'search_path=%'
                 ),
                 ''
               ) as search_path,
               routine.provolatile as volatility
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             where namespace.nspname = 'public'
               and routine.proname = 'get_dashboard_read_model'
               and pg_catalog.pg_get_function_identity_arguments(routine.oid) = ''`,
          );

          expect(metadata.rows).toEqual([{
            authenticated_execute: true,
            anonymous_execute: false,
            public_execute: false,
            security_definer: true,
            search_path: "search_path=\"\"",
            volatility: "s",
          }]);

          await setPermissions(database, fixture, fixture.actors.unpermitted, [
            "dashboard.view",
          ]);
          expect(await callDashboard(database, fixture.actors.unpermitted)).toBeTruthy();
        });
      });

      it("keeps leap-day birthdays on the next real February 29", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          await database.query("delete from public.calendar_entries");
          await database.query(
            `update public.user_profiles
             set birthday = '2000-02-29'::date
             where is_active`,
          );
          const ongoingId = randomUUID();
          const futureId = randomUUID();
          const expiredId = randomUUID();
          await database.query(
            `insert into public.calendar_entries (
               id, entry_type, title, start_date, end_date,
               created_by_user_id, updated_by_user_id
             ) values
               ($1::uuid, 'vacation', 'Ongoing range', current_date - 1,
                current_date + 1, $4::uuid, $4::uuid),
               ($2::uuid, 'event', 'Future event', current_date + 1,
                current_date + 1, $4::uuid, $4::uuid),
               ($3::uuid, 'business_trip', 'Expired trip', current_date - 2,
                current_date - 1, $4::uuid, $4::uuid)`,
            [ongoingId, futureId, expiredId, fixture.actors.admin.profileId],
          );

          const model = await callDashboard(database, fixture.actors.admin);
          const rows = (model.calendar as JsonObject).upcoming as JsonObject[];
          expect(rows).toHaveLength(5);
          expect(rows.filter((row) => row.id === ongoingId)).toHaveLength(1);
          expect(rows.filter((row) => row.id === futureId)).toHaveLength(1);
          expect(rows.some((row) => row.id === expiredId)).toBe(false);
          expect(rows.some((row) => row.id === fixture.actors.inactive.profileId)).toBe(false);
          const birthdayRows = rows.filter((row) => row.kind === "birthday");
          expect(birthdayRows).toHaveLength(3);
          for (const row of birthdayRows) {
            expect(row.start_date).toMatch(/-02-29$/);
            expect(row.end_date).toBe(row.start_date);
            expect(row.related_user_id).toBe(row.id);
            expectExactKeys(row, [
              "kind", "id", "title", "start_date", "end_date", "related_user_id",
            ]);
          }
        });
      });
    },
  );
}
