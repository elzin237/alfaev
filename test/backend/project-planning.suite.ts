import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import type { SecurityActor } from "./security-fixtures";
import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityFixtureHarness } from "./security-fixtures";
import { createTestSerialNumber } from "./helpers/serial";

interface ActivityWaitRow {
  wait_event: string | null;
  wait_event_type: string | null;
}

interface ProductRow {
  archived_at: Date | null;
  archived_by_user_id: string | null;
  brand_id: string | null;
  category: string;
  created_at: Date;
  created_by_user_id: string;
  id: string;
  is_active: boolean;
  name: string;
  product_kind: "component" | "pcb_finished_good";
  serial_number: string;
  updated_at: Date;
  updated_by_user_id: string;
}

interface ProjectRow {
  cancelled_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  created_by_user_id: string;
  customer_name: string;
  delivery_date: string;
  id: string;
  name: string;
  start_date: string;
  status: "planned" | "in_progress" | "on_hold" | "completed" | "cancelled";
  updated_at: Date;
  updated_by_user_id: string;
}

interface ProjectProductRow {
  created_at: Date;
  created_by_user_id: string;
  id: string;
  name: string;
  project_id: string;
  updated_at: Date;
  updated_by_user_id: string;
}

interface ProjectProductComponentRow {
  created_at: Date;
  created_by_user_id: string;
  id: string;
  product_id: string;
  project_product_id: string;
  required_quantity: string;
  updated_at: Date;
  updated_by_user_id: string;
}

interface ProductCommitmentRow {
  product_id: string;
  physical_quantity: string;
  committed_to_projects: string;
  available_after_commitments: string;
}

interface ProjectCommitmentRow {
  project_id: string;
  project_name: string;
  planned_requirement: string;
  actual_project_consumption: string;
  outstanding_commitment: string;
}

async function callPlanningAs<Row extends QueryResultRow>(
  database: PoolClient,
  actor: SecurityActor | null,
  statement: string,
  values: unknown[] = [],
): Promise<Row[]> {
  await database.query("savepoint planning_actor_call");
  try {
    await database.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
      [actor?.authUserId ?? ""],
    );
    await database.query(actor ? "set local role authenticated" : "set local role anon");
    const result = await database.query<Row>(statement, values);
    await database.query("reset role");
    await database.query("release savepoint planning_actor_call");
    return result.rows;
  } catch (error) {
    await database.query("rollback to savepoint planning_actor_call");
    await database.query("release savepoint planning_actor_call");
    throw error;
  }
}

async function createPlanningRows(database: PoolClient, actorId: string): Promise<{
  projectIds: string[];
  groupIds: string[];
  productIds: string[];
}> {
  const projectIds = Array.from({ length: 5 }, () => randomUUID());
  const groupIds = projectIds.map(() => randomUUID());
  const productIds = Array.from({ length: 3 }, () => randomUUID());
  const serials = await database.query<{ serial_number: string }>(
    "select public.allocate_product_serial_number() as serial_number from pg_catalog.generate_series(1, 3)",
  );
  for (const [index, status] of [
    "planned", "in_progress", "on_hold", "completed", "cancelled",
  ].entries()) {
    await database.query(
      "insert into public.projects (id, name, customer_name, status, start_date, delivery_date, completed_at, cancelled_at, created_by_user_id, updated_by_user_id) values ($1, $2, 'Planning Customer', $3, '2026-09-01', '2026-09-30', $4, $5, $6, $6)",
      [
        projectIds[index],
        "Planning " + status + " " + randomUUID(),
        status,
        status === "completed" ? "2026-09-30T10:00:00Z" : null,
        status === "cancelled" ? "2026-09-29T10:00:00Z" : null,
        actorId,
      ],
    );
    await database.query(
      "insert into public.project_products (id, project_id, name, created_by_user_id, updated_by_user_id) values ($1, $2, $3, $4, $4)",
      [groupIds[index], projectIds[index], "Group " + index, actorId],
    );
  }
  for (const [index, productId] of productIds.entries()) {
    await database.query(
        "insert into public.products (id, serial_number, name, category, product_kind, is_active, archived_at, archived_by_user_id, created_by_user_id, updated_by_user_id) values ($1, $2, $3, 'Planning', $4, $5, $6, $7, $8, $8)",
      [
        productId,
        serials.rows[index]?.serial_number,
        index === 0 ? "Literal 100%_\\ Part" : "Planning Choice " + index,
        index === 1 ? "pcb_finished_good" : "component",
        index !== 2,
        index === 2 ? new Date() : null,
        index === 2 ? actorId : null,
        actorId,
      ],
    );
  }
  return { projectIds, groupIds, productIds };
}

async function insertCommitmentMovement(
  database: PoolClient,
  actorId: string,
  productId: string,
  projectId: string | null,
  sourceType: string,
  quantityDelta: number,
): Promise<void> {
  const before = quantityDelta < 0 ? 1000 : 0;
  await database.query(
    "insert into public.inventory_movements (product_id, movement_type, quantity_delta, quantity_before, quantity_after, source_type, source_id, project_id, actor_user_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      productId, sourceType === "manual_adjustment" ? "manual_remove" : sourceType,
      quantityDelta, before, before + quantityDelta, sourceType,
      randomUUID(), projectId, actorId,
    ],
  );
}

export function registerProjectPlanningTests(requireHarness: () => SecurityFixtureHarness): void {
  describe("Project requirement Inventory context", () => {
    it("distinguishes an empty group from a real Product with zero commitments", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const { projectIds, groupIds, productIds } = await createPlanningRows(
          database, fixture.actors.admin.profileId,
        );
        await database.query(
          "update public.inventory_balances set quantity = 10 where product_id = $1",
          [productIds[0]],
        );
        await database.query(
          "insert into public.project_product_components (project_product_id, product_id, required_quantity, created_by_user_id, updated_by_user_id) values ($1, $2, 5, $3, $3)",
          [groupIds[3], productIds[0], fixture.actors.admin.profileId],
        );

        const emptyGroup = await callPlanningAs<Record<string, unknown>>(
          database,
          fixture.actors.admin,
          "select * from public.get_project_planning($1)",
          [projectIds[0]],
        );
        expect(emptyGroup).toEqual([expect.objectContaining({
          product_id: null,
          category: null,
          brand_name: null,
          physical_quantity: null,
          committed_to_projects: null,
          available_after_commitments: null,
        })]);

        const zeroCommitment = await callPlanningAs<Record<string, unknown>>(
          database,
          fixture.actors.admin,
          "select * from public.get_project_planning($1)",
          [projectIds[3]],
        );
        expect(zeroCommitment).toEqual([expect.objectContaining({
          product_id: productIds[0],
          physical_quantity: "10",
          committed_to_projects: "0",
          available_after_commitments: "10",
        })]);
      });
    });

    it("returns one permission-aware canonical Inventory projection without widening Product access", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const { projectIds, groupIds, productIds } = await createPlanningRows(
          database, fixture.actors.admin.profileId,
        );
        const brandId = randomUUID();
        await database.query(
          "insert into public.brands (id, name, created_by_user_id, updated_by_user_id) values ($1, 'Planning Brand', $2, $2)",
          [brandId, fixture.actors.admin.profileId],
        );
        await database.query(
          "update public.products set brand_id = $2 where id = $1",
          [productIds[0], brandId],
        );
        await database.query(
          "update public.inventory_balances set quantity = 10 where product_id = $1",
          [productIds[0]],
        );
        await database.query(
          "insert into public.project_product_components (project_product_id, product_id, required_quantity, created_by_user_id, updated_by_user_id) values ($1, $2, 16, $3, $3)",
          [groupIds[0], productIds[0], fixture.actors.admin.profileId],
        );

        const projectOnly = await callPlanningAs<Record<string, unknown>>(
          database,
          fixture.actors.permitted,
          "select * from public.get_project_planning($1)",
          [projectIds[0]],
        );
        expect(projectOnly).toHaveLength(1);
        expect(projectOnly[0]).toMatchObject({
          product_id: productIds[0],
          category: null,
          brand_name: null,
          physical_quantity: null,
          committed_to_projects: null,
          available_after_commitments: null,
        });
        expect(await callPlanningAs<{ id: string }>(
          database,
          fixture.actors.permitted,
          "select id from public.products where id = $1",
          [productIds[0]],
        )).toEqual([]);

        await database.query(
          "insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id) values ($1, $2, $3)",
          [
            fixture.actors.permitted.profileId,
            fixture.permissionDefinitionIds.inventoryView,
            fixture.actors.admin.profileId,
          ],
        );
        const authorized = await callPlanningAs<Record<string, unknown>>(
          database,
          fixture.actors.permitted,
          "select * from public.get_project_planning($1)",
          [projectIds[0]],
        );
        expect(authorized).toEqual([expect.objectContaining({
          product_id: productIds[0],
          category: "Planning",
          brand_name: "Planning Brand",
          physical_quantity: "10",
          committed_to_projects: "16",
          available_after_commitments: "-6",
        })]);
        expect(Object.keys(authorized[0] ?? {}).sort()).toEqual([
          "available_after_commitments", "brand_name", "category",
          "committed_to_projects", "component_id", "physical_quantity",
          "product_id", "product_kind", "product_name", "project_product_id",
          "project_product_name", "required_quantity", "serial_number",
        ]);
      });
    });
  });

  it("enforces the Project planning schema, references, quantities, and non-mutating baseline", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const projectId = randomUUID();
      const projectProductIds = [randomUUID(), randomUUID()];
      const productIds = [randomUUID(), randomUUID()];
      const componentIds = [randomUUID(), randomUUID(), randomUUID()];
      const serials = await database.query<{ serial_number: string }>(
        `select public.allocate_product_serial_number() as serial_number
         from pg_catalog.generate_series(1, 2)`,
      );

      await database.query(
        `insert into public.projects (
           id, name, customer_name, start_date, delivery_date,
           created_by_user_id, updated_by_user_id
         ) values (
           $1, 'Planning Schema Project', 'Planning Customer',
           '2026-09-01', '2026-09-30', $2, $2
         )`,
        [projectId, actorId],
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values
           ($1, $3, 'Planning Component', 'Component', 'component', $5, $5),
           ($2, $4, 'Planning PCB', 'PCB', 'pcb_finished_good', $5, $5)`,
        [
          productIds[0],
          productIds[1],
          serials.rows[0]?.serial_number,
          serials.rows[1]?.serial_number,
          actorId,
        ],
      );

      const projectsBefore = await database.query<ProjectRow>(
        `select *, start_date::text as start_date,
                delivery_date::text as delivery_date
         from public.projects
         where id = $1`,
        [projectId],
      );
      const productsBefore = await database.query<ProductRow>(
        `select * from public.products
         where id = any($1::uuid[])
         order by id`,
        [productIds],
      );
      const inventoryBefore = await database.query<{
        balances: number;
        movements: number;
        total_quantity: string;
      }>(
        `select
           (select count(*)::integer
            from public.inventory_balances
            where product_id = any($1::uuid[])) as balances,
           (select count(*)::integer
            from public.inventory_movements
            where product_id = any($1::uuid[])) as movements,
           (select coalesce(sum(quantity), 0::numeric)::text
            from public.inventory_balances
            where product_id = any($1::uuid[])) as total_quantity`,
        [productIds],
      );

      await database.query(
        `insert into public.project_products (
           id, project_id, name, created_by_user_id, updated_by_user_id
         ) values
           ($1, $3, 'B24', $4, $4),
           ($2, $3, 'B24', $4, $4)`,
        [projectProductIds[0], projectProductIds[1], projectId, actorId],
      );
      await database.query(
        `insert into public.project_product_components (
           id, project_product_id, product_id, required_quantity,
           created_by_user_id, updated_by_user_id
         ) values
           ($1, $4, $6, 12, $8, $8),
           ($2, $4, $7, 3, $8, $8),
           ($3, $5, $6, 4, $8, $8)`,
        [
          componentIds[0],
          componentIds[1],
          componentIds[2],
          projectProductIds[0],
          projectProductIds[1],
          productIds[0],
          productIds[1],
          actorId,
        ],
      );

      const projectProducts = await database.query<ProjectProductRow>(
        `select * from public.project_products
         where id = any($1::uuid[])
         order by id`,
        [projectProductIds],
      );
      const components = await database.query<ProjectProductComponentRow>(
        `select * from public.project_product_components
         where id = any($1::uuid[])
         order by id`,
        [componentIds],
      );
      expect(projectProducts.rows).toHaveLength(2);
      expect(projectProducts.rows.every((row) => row.name === "B24")).toBe(true);
      expect(components.rows.map((row) => row.required_quantity).sort())
        .toEqual(["12", "3", "4"]);
      expect(components.rows.some((row) => row.product_id === productIds[0]))
        .toBe(true);
      expect(components.rows.some((row) => row.product_id === productIds[1]))
        .toBe(true);

      expect(await database.query<ProjectRow>(
        `select *, start_date::text as start_date,
                delivery_date::text as delivery_date
         from public.projects
         where id = $1`,
        [projectId],
      )).toEqual(projectsBefore);
      expect(await database.query<ProductRow>(
        `select * from public.products
         where id = any($1::uuid[])
         order by id`,
        [productIds],
      )).toEqual(productsBefore);
      expect(await database.query<{
        balances: number;
        movements: number;
        total_quantity: string;
      }>(
        `select
           (select count(*)::integer
            from public.inventory_balances
            where product_id = any($1::uuid[])) as balances,
           (select count(*)::integer
            from public.inventory_movements
            where product_id = any($1::uuid[])) as movements,
           (select coalesce(sum(quantity), 0::numeric)::text
            from public.inventory_balances
            where product_id = any($1::uuid[])) as total_quantity`,
        [productIds],
      )).toEqual(inventoryBefore);

      const invalidProjectProducts = [
        { label: "empty_name", projectId, name: "", actorId },
        { label: "whitespace_name", projectId, name: "   ", actorId },
        { label: "untrimmed_name", projectId, name: " B25 ", actorId },
        {
          label: "missing_project",
          projectId: randomUUID(),
          name: "Missing Project",
          actorId,
        },
        {
          label: "invalid_created_actor",
          projectId,
          name: "Invalid Created Actor",
          actorId: randomUUID(),
        },
      ];
      for (const invalid of invalidProjectProducts) {
        await database.query(`savepoint project_product_${invalid.label}`);
        await expect(database.query(
          `insert into public.project_products (
             project_id, name, created_by_user_id, updated_by_user_id
           ) values ($1, $2, $3, $4)`,
          [invalid.projectId, invalid.name, invalid.actorId, actorId],
        )).rejects.toMatchObject({
          code: invalid.label.includes("name") ? "23514" : "23503",
        });
        await database.query(`rollback to savepoint project_product_${invalid.label}`);
      }
      await database.query("savepoint project_product_invalid_updated_actor");
      await expect(database.query(
        `insert into public.project_products (
           project_id, name, created_by_user_id, updated_by_user_id
         ) values ($1, 'Invalid Updated Actor', $2, $3)`,
        [projectId, actorId, randomUUID()],
      )).rejects.toMatchObject({ code: "23503" });
      await database.query("rollback to savepoint project_product_invalid_updated_actor");

      for (const [label, quantity] of [["zero", 0], ["negative", -1]] as const) {
        await database.query(`savepoint component_quantity_${label}`);
        await expect(database.query(
          `insert into public.project_product_components (
             project_product_id, product_id, required_quantity,
             created_by_user_id, updated_by_user_id
           ) values ($1, $2, $3, $4, $4)`,
          [projectProductIds[1], productIds[1], quantity, actorId],
        )).rejects.toMatchObject({ code: "23514" });
        await database.query(`rollback to savepoint component_quantity_${label}`);
      }

      const invalidComponents = [
        {
          label: "duplicate_pair",
          projectProductId: projectProductIds[0],
          productId: productIds[0],
          actorId,
          code: "23505",
        },
        {
          label: "missing_project_product",
          projectProductId: randomUUID(),
          productId: productIds[0],
          actorId,
          code: "23503",
        },
        {
          label: "missing_product",
          projectProductId: projectProductIds[1],
          productId: randomUUID(),
          actorId,
          code: "23503",
        },
        {
          label: "invalid_created_actor",
          projectProductId: projectProductIds[1],
          productId: productIds[1],
          actorId: randomUUID(),
          code: "23503",
        },
      ];
      for (const invalid of invalidComponents) {
        await database.query(`savepoint project_component_${invalid.label}`);
        await expect(database.query(
          `insert into public.project_product_components (
             project_product_id, product_id, required_quantity,
             created_by_user_id, updated_by_user_id
           ) values ($1, $2, 1, $3, $4)`,
          [
            invalid.projectProductId,
            invalid.productId,
            invalid.actorId,
            actorId,
          ],
        )).rejects.toMatchObject({ code: invalid.code });
        await database.query(`rollback to savepoint project_component_${invalid.label}`);
      }
      await database.query("savepoint component_invalid_updated_actor");
      await expect(database.query(
        `insert into public.project_product_components (
           project_product_id, product_id, required_quantity,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 1, $3, $4)`,
        [projectProductIds[1], productIds[1], actorId, randomUUID()],
      )).rejects.toMatchObject({ code: "23503" });
      await database.query("rollback to savepoint component_invalid_updated_actor");

      await database.query(
        `update public.products
         set is_active = false,
             updated_at = now(),
             updated_by_user_id = $2,
             archived_at = now(),
             archived_by_user_id = $2
         where id = $1`,
        [productIds[1], actorId],
      );
      const archivedReference = await database.query<{
        is_active: boolean;
        product_id: string;
      }>(
        `select product.id as product_id, product.is_active
         from public.project_product_components as component
         join public.products as product on product.id = component.product_id
         where component.id = $1`,
        [componentIds[1]],
      );
      expect(archivedReference.rows).toEqual([{
        is_active: false,
        product_id: productIds[1],
      }]);

      const foreignKeys = await database.query<{
        constraint_name: string;
        delete_rule: string;
      }>(
        `select constraint_name, delete_rule
         from information_schema.referential_constraints
         where constraint_schema = 'public'
           and constraint_name = any($1::text[])
         order by constraint_name`,
        [[
          "project_products_project_id_fkey",
          "project_products_created_by_user_id_fkey",
          "project_products_updated_by_user_id_fkey",
          "project_product_components_project_product_id_fkey",
          "project_product_components_product_id_fkey",
          "project_product_components_created_by_user_id_fkey",
          "project_product_components_updated_by_user_id_fkey",
        ]],
      );
      expect(foreignKeys.rows).toHaveLength(7);
      expect(foreignKeys.rows.every((foreignKey) =>
        foreignKey.delete_rule === "RESTRICT"
      )).toBe(true);

      const columns = await database.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        table_name: string;
      }>(
        `select table_name, column_name, data_type, is_nullable
         from information_schema.columns
         where table_schema = 'public'
           and table_name = any($1::text[])
         order by table_name, ordinal_position`,
        [["project_products", "project_product_components"]],
      );
      expect(columns.rows.filter((column) => column.table_name === "project_products")
        .map((column) => column.column_name)).toEqual([
          "id",
          "project_id",
          "name",
          "created_at",
          "created_by_user_id",
          "updated_at",
          "updated_by_user_id",
        ]);
      expect(columns.rows.find((column) =>
        column.table_name === "project_product_components"
        && column.column_name === "required_quantity"
      )).toMatchObject({ data_type: "bigint", is_nullable: "NO" });

      const indexes = await database.query<{
        indexdef: string;
        indexname: string;
      }>(
        `select indexname, indexdef
         from pg_catalog.pg_indexes
         where schemaname = 'public'
           and tablename = any($1::text[])
         order by indexname`,
        [["project_products", "project_product_components"]],
      );
      expect(indexes.rows.find((index) =>
        index.indexname === "project_products_project_id_idx"
      )?.indexdef).toContain("(project_id)");
      expect(indexes.rows.find((index) =>
        index.indexname === "project_product_components_product_id_idx"
      )?.indexdef).toContain("(product_id)");
      expect(indexes.rows.find((index) =>
        index.indexname ===
          "project_product_components_project_product_product_key"
      )?.indexdef).toContain(
        "UNIQUE INDEX project_product_components_project_product_product_key",
      );
      expect(indexes.rows.find((index) =>
        index.indexname ===
          "project_product_components_project_product_product_key"
      )?.indexdef).toContain("(project_product_id, product_id)");

      const prematurePersistence = await database.query<{ object_name: string }>(
        `select relation.relname as object_name
         from pg_catalog.pg_class as relation
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = relation.relnamespace
         where namespace.nspname = 'public'
           and relation.relname like '%project_commitment%'`,
      );
      expect(prematurePersistence.rows).toEqual([]);
    });
  });
  it("limits Project planning reads to active Project viewers and denies every direct client write", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const projectIds = [randomUUID(), randomUUID(), randomUUID()];
      const projectProductIds = [randomUUID(), randomUUID(), randomUUID()];
      const componentIds = [randomUUID(), randomUUID(), randomUUID()];
      const productId = randomUUID();
      const serial = await database.query<{ serial_number: string }>(
        "select public.allocate_product_serial_number() as serial_number",
      );

      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           completed_at, cancelled_at, created_by_user_id, updated_by_user_id
         ) values
           ($1, 'Planning Read Planned', 'Customer', 'planned',
            '2026-09-01', '2026-09-30', null, null, $4, $4),
           ($2, 'Planning Read Completed', 'Customer', 'completed',
            '2026-09-01', '2026-09-30', '2026-09-30T10:00:00Z', null, $4, $4),
           ($3, 'Planning Read Cancelled', 'Customer', 'cancelled',
            '2026-09-01', '2026-09-30', null, '2026-09-20T10:00:00Z', $4, $4)`,
        [...projectIds, actorId],
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'Planning Read Product', 'Component', 'component', $3, $3)`,
        [productId, serial.rows[0]?.serial_number, actorId],
      );
      await database.query(
        `insert into public.project_products (
           id, project_id, name, created_by_user_id, updated_by_user_id
         ) values
           ($1, $4, 'Planned Group', $7, $7),
           ($2, $5, 'Completed Group', $7, $7),
           ($3, $6, 'Cancelled Group', $7, $7)`,
        [...projectProductIds, ...projectIds, actorId],
      );
      await database.query(
        `insert into public.project_product_components (
           id, project_product_id, product_id, required_quantity,
           created_by_user_id, updated_by_user_id
         ) values
           ($1, $4, $7, 1, $8, $8),
           ($2, $5, $7, 2, $8, $8),
           ($3, $6, $7, 3, $8, $8)`,
        [...componentIds, ...projectProductIds, productId, actorId],
      );

      for (const actor of [fixture.actors.admin, fixture.actors.permitted]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visibleProjectProducts = await database.query<{ id: string }>(
          `select id from public.project_products
           where id = any($1::uuid[])
           order by id`,
          [projectProductIds],
        );
        const visibleComponents = await database.query<{ id: string }>(
          `select id from public.project_product_components
           where id = any($1::uuid[])
           order by id`,
          [componentIds],
        );
        await database.query("reset role");
        expect(visibleProjectProducts.rows.map((row) => row.id))
          .toEqual([...projectProductIds].sort());
        expect(visibleComponents.rows.map((row) => row.id))
          .toEqual([...componentIds].sort());
      }

      for (const actor of [fixture.actors.unpermitted, fixture.actors.inactive]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hiddenProjectProducts = await database.query<{ id: string }>(
          `select id from public.project_products
           where id = any($1::uuid[])`,
          [projectProductIds],
        );
        const hiddenComponents = await database.query<{ id: string }>(
          `select id from public.project_product_components
           where id = any($1::uuid[])`,
          [componentIds],
        );
        await database.query("reset role");
        expect(hiddenProjectProducts.rows).toEqual([]);
        expect(hiddenComponents.rows).toEqual([]);
      }

      const security = await database.query<{
        authenticated_delete: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        policy_expression: string;
        row_security: boolean;
        table_name: string;
      }>(
        `select
           relation.relname as table_name,
           relation.relrowsecurity as row_security,
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
           and relation.relname = any($1::text[])
         order by relation.relname`,
        [["project_products", "project_product_components"]],
      );
      expect(security.rows).toHaveLength(2);
      for (const tableSecurity of security.rows) {
        expect(tableSecurity).toMatchObject({
          authenticated_delete: false,
          authenticated_insert: false,
          authenticated_select: true,
          authenticated_update: false,
          row_security: true,
        });
        expect(tableSecurity.policy_expression).toContain(
          "current_user_is_admin()",
        );
        expect(tableSecurity.policy_expression).toContain(
          "has_permission('projects.view'::text)",
        );
      }

      await database.query("set local role anon");
      await database.query("savepoint anonymous_project_planning_reads");
      await expect(database.query("select id from public.project_products limit 1"))
        .rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_project_planning_reads");
      await database.query("savepoint anonymous_project_component_reads");
      await expect(database.query(
        "select id from public.project_product_components limit 1",
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_project_component_reads");
      await database.query("reset role");
    });

    const adminClient = fixture.actors.admin.client;
    const projectProductInsert = await adminClient.from("project_products").insert({
      project_id: randomUUID(),
      name: "Forbidden Direct Planning Group",
      created_by_user_id: fixture.actors.admin.profileId,
      updated_by_user_id: fixture.actors.admin.profileId,
    });
    const projectProductUpdate = await adminClient
      .from("project_products")
      .update({ name: "Forbidden Direct Update" })
      .eq("id", randomUUID());
    const projectProductDelete = await adminClient
      .from("project_products")
      .delete()
      .eq("id", randomUUID());
    const componentInsert = await adminClient
      .from("project_product_components")
      .insert({
        project_product_id: randomUUID(),
        product_id: randomUUID(),
        required_quantity: 1,
        created_by_user_id: fixture.actors.admin.profileId,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
    const componentUpdate = await adminClient
      .from("project_product_components")
      .update({ required_quantity: 2 })
      .eq("id", randomUUID());
    const componentDelete = await adminClient
      .from("project_product_components")
      .delete()
      .eq("id", randomUUID());
    for (const error of [
      projectProductInsert.error,
      projectProductUpdate.error,
      projectProductDelete.error,
      componentInsert.error,
      componentUpdate.error,
      componentDelete.error,
    ]) {
      expectPermissionDenied(error);
    }

    for (const table of ["project_products", "project_product_components"] as const) {
      const anonymousRead = await fixture.anonymousClient
        .from(table)
        .select("id")
        .limit(1);
      expectPermissionDenied(anonymousRead.error);
    }
  });
  it("mutates open Project plans atomically with trusted actors, audit, and no physical stock changes", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { projectIds, groupIds, productIds } = await createPlanningRows(
        database, fixture.actors.admin.profileId,
      );
      const delegated = fixture.actors.productCreator;
      await database.query(
        "insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id) select $1, id, $2 from public.permission_definitions where key = 'projects.edit'",
        [delegated.profileId, fixture.actors.admin.profileId],
      );
      expect(await callPlanningAs<{ can_edit: boolean; can_view: boolean }>(
        database, delegated,
        "select public.has_permission('projects.edit') as can_edit, public.has_permission('projects.view') as can_view",
      )).toEqual([{ can_edit: true, can_view: false }]);

      const inventoryBefore = await database.query<{
        product_id: string; quantity: string;
      }>(
        "select product_id, quantity from public.inventory_balances where product_id = any($1::uuid[]) order by product_id",
        [productIds],
      );
      const productsBefore = await database.query<ProductRow>(
        "select * from public.products where id = any($1::uuid[]) order by id",
        [productIds],
      );
      const projectsBefore = await database.query<ProjectRow>(
        "select *, start_date::text as start_date, delivery_date::text as delivery_date from public.projects where id = any($1::uuid[]) order by id",
        [projectIds],
      );

      const created = await callPlanningAs<{ id: string }>(
        database, delegated,
        "select public.create_project_product($1, $2) as id",
        [projectIds[0], "  B24  "],
      );
      const duplicateName = await callPlanningAs<{ id: string }>(
        database, fixture.actors.admin,
        "select public.create_project_product($1, $2) as id",
        [projectIds[0], "B24"],
      );
      expect(created[0]?.id).toEqual(expect.any(String));
      expect(duplicateName[0]?.id).not.toBe(created[0]?.id);
      const createdId = created[0]?.id;
      const createdRow = await database.query<ProjectProductRow>(
        "select * from public.project_products where id = $1", [createdId],
      );
      expect(createdRow.rows[0]).toMatchObject({
        name: "B24",
        project_id: projectIds[0],
        created_by_user_id: delegated.profileId,
        updated_by_user_id: delegated.profileId,
      });

      const updated = await callPlanningAs<{ id: string }>(
        database, delegated, "select public.update_project_product($1, $2) as id",
        [createdId, "  B25  "],
      );
      expect(updated).toEqual([{ id: createdId }]);
      const editedRow = await database.query<ProjectProductRow>(
        "select * from public.project_products where id = $1", [createdId],
      );
      expect(editedRow.rows[0]?.name).toBe("B25");
      await callPlanningAs(
        database, delegated, "select public.update_project_product($1, $2)",
        [createdId, " B25 "],
      );
      const afterNoop = await database.query<ProjectProductRow>(
        "select * from public.project_products where id = $1", [createdId],
      );
      expect(afterNoop.rows).toEqual(editedRow.rows);

      const component = await callPlanningAs<{ id: string }>(
        database, delegated,
        "select public.create_project_product_component($1, $2, $3) as id",
        [createdId, productIds[0], 12],
      );
      const pcb = await callPlanningAs<{ id: string }>(
        database, fixture.actors.admin,
        "select public.create_project_product_component($1, $2, $3) as id",
        [createdId, productIds[1], 3],
      );
      const anotherGroup = await callPlanningAs<{ id: string }>(
        database, delegated,
        "select public.create_project_product_component($1, $2, $3) as id",
        [groupIds[0], productIds[0], 5],
      );
      expect([component[0]?.id, pcb[0]?.id, anotherGroup[0]?.id]
        .every(Boolean)).toBe(true);

      await expect(callPlanningAs(
        database, fixture.actors.admin,
        "select public.remove_project_product($1)", [createdId],
      )).rejects.toMatchObject({ code: "PPL03" });
      await callPlanningAs(
        database, delegated,
        "select public.update_project_product_component($1, $2, $3)",
        [component[0]?.id, productIds[0], 15],
      );
      const editedComponent = await database.query<ProjectProductComponentRow>(
        "select * from public.project_product_components where id = $1",
        [component[0]?.id],
      );
      expect(editedComponent.rows[0]).toMatchObject({
        product_id: productIds[0],
        required_quantity: "15",
        updated_by_user_id: delegated.profileId,
      });
      await callPlanningAs(
        database, delegated,
        "select public.update_project_product_component($1, $2, $3)",
        [component[0]?.id, productIds[0], 15],
      );
      const afterComponentNoop = await database.query<ProjectProductComponentRow>(
        "select * from public.project_product_components where id = $1",
        [component[0]?.id],
      );
      expect(afterComponentNoop.rows).toEqual(editedComponent.rows);
      await callPlanningAs(
        database, delegated,
        "select public.update_project_product_component($1, $2, $3)",
        [component[0]?.id, productIds[1], 15],
      ).then(
        () => { throw new Error("Duplicate Product reference should have failed"); },
        (error: unknown) => { expect(error).toMatchObject({ code: "PPL02" }); },
      );

      await callPlanningAs(
        database, delegated,
        "select public.remove_project_product_component($1)", [pcb[0]?.id],
      );
      await callPlanningAs(
        database, delegated,
        "select public.update_project_product_component($1, $2, $3)",
        [component[0]?.id, productIds[1], 17],
      );
      expect((await database.query<ProjectProductComponentRow>(
        "select * from public.project_product_components where id = $1",
        [component[0]?.id],
      )).rows[0]).toMatchObject({
        project_product_id: createdId,
        product_id: productIds[1],
        required_quantity: "17",
      });
      await callPlanningAs(
        database, fixture.actors.admin,
        "select public.remove_project_product_component($1)", [component[0]?.id],
      );
      await callPlanningAs(
        database, delegated,
        "select public.remove_project_product($1)", [createdId],
      );
      expect((await database.query(
        "select id from public.project_products where id = $1", [createdId],
      )).rows).toEqual([]);

      const audit = await database.query<{
        action_type: string; actor_user_id: string; before_data: Record<string, unknown> | null;
        after_data: Record<string, unknown> | null; entity_id: string;
      }>(
        "select action_type, actor_user_id, entity_id, before_data, after_data from public.audit_logs where entity_id = any($1::uuid[]) order by created_at, id",
        [[createdId, duplicateName[0]?.id, component[0]?.id, pcb[0]?.id, anotherGroup[0]?.id]],
      );
      const eventCounts = new Map<string, number>();
      for (const entry of audit.rows) {
        eventCounts.set(entry.action_type, (eventCounts.get(entry.action_type) ?? 0) + 1);
        expect(entry.actor_user_id).toBe(
          entry.entity_id === pcb[0]?.id
            && entry.action_type === "project_product_component.created"
          || entry.entity_id === component[0]?.id
            && entry.action_type === "project_product_component.removed"
          || entry.entity_id === duplicateName[0]?.id
            ? fixture.actors.admin.profileId : delegated.profileId,
        );
      }
      expect(Object.fromEntries(eventCounts)).toEqual({
        "project_product.created": 2,
        "project_product.updated": 1,
        "project_product_component.created": 3,
        "project_product_component.updated": 2,
        "project_product_component.removed": 2,
        "project_product.removed": 1,
      });
      expect(audit.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          entity_id: component[0]?.id,
          action_type: "project_product_component.updated",
          before_data: expect.objectContaining({ required_quantity: 12 }),
          after_data: expect.objectContaining({ required_quantity: 15 }),
        }),
      ]));
      // Exercise the same six authorized operations as Admin, independently
      // of the delegated projects.edit actor used above.
      const adminGroup = await callPlanningAs<{ id: string }>(
        database, fixture.actors.admin,
        "select public.create_project_product($1, 'Admin Group') as id",
        [projectIds[1]],
      );
      await callPlanningAs(
        database, fixture.actors.admin,
        "select public.update_project_product($1, 'Admin Edited Group')",
        [adminGroup[0]?.id],
      );
      const adminComponent = await callPlanningAs<{ id: string }>(
        database, fixture.actors.admin,
        "select public.create_project_product_component($1, $2, 2) as id",
        [adminGroup[0]?.id, productIds[0]],
      );
      await callPlanningAs(
        database, fixture.actors.admin,
        "select public.update_project_product_component($1, $2, 4)",
        [adminComponent[0]?.id, productIds[0]],
      );
      await callPlanningAs(
        database, fixture.actors.admin,
        "select public.remove_project_product_component($1)",
        [adminComponent[0]?.id],
      );
      await callPlanningAs(
        database, fixture.actors.admin,
        "select public.remove_project_product($1)",
        [adminGroup[0]?.id],
      );
      expect(await database.query<ProductRow>(
        "select * from public.products where id = any($1::uuid[]) order by id",
        [productIds],
      )).toEqual(productsBefore);
      expect(await database.query<ProjectRow>(
        "select *, start_date::text as start_date, delivery_date::text as delivery_date from public.projects where id = any($1::uuid[]) order by id",
        [projectIds],
      )).toEqual(projectsBefore);
      expect(await database.query(
        "select product_id, quantity from public.inventory_balances where product_id = any($1::uuid[]) order by product_id",
        [productIds],
      )).toEqual(inventoryBefore);
      expect((await database.query<{ count: number }>(
        "select count(*)::integer as count from public.inventory_movements where product_id = any($1::uuid[])",
        [productIds],
      )).rows).toEqual([{ count: 0 }]);
    });
  });
  it("denies unauthorized, closed, invalid, or duplicate Project planning mutations without audit", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { projectIds, groupIds, productIds } = await createPlanningRows(
        database, fixture.actors.admin.profileId,
      );
      const componentId = randomUUID();
      await database.query(
        "insert into public.project_product_components (id, project_product_id, product_id, required_quantity, created_by_user_id, updated_by_user_id) values ($1, $2, $3, 8, $4, $4)",
        [componentId, groupIds[0], productIds[0], fixture.actors.admin.profileId],
      );
      const archiveOnly = fixture.actors.productCreator;
      const createOnly = fixture.actors.productEditor;
      const editor = fixture.actors.supplierEditor;
      await database.query(
        "insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id) select grants.actor_id, definition.id, $3 from unnest($1::uuid[], $2::text[]) as grants(actor_id, permission_key) join public.permission_definitions as definition on definition.key = grants.permission_key",
        [
          [archiveOnly.profileId, createOnly.profileId, editor.profileId],
          ["projects.archive", "projects.create", "projects.edit"],
          fixture.actors.admin.profileId,
        ],
      );
      const cases: Array<{ sql: string; args: unknown[] }> = [
        { sql: "select public.create_project_product($1, 'Denied')", args: [projectIds[0]] },
        { sql: "select public.update_project_product($1, 'Denied')", args: [groupIds[0]] },
        { sql: "select public.remove_project_product($1)", args: [groupIds[1]] },
        { sql: "select public.create_project_product_component($1, $2, 1)", args: [groupIds[0], productIds[1]] },
        { sql: "select public.update_project_product_component($1, $2, 2)", args: [componentId, productIds[0]] },
        { sql: "select public.remove_project_product_component($1)", args: [componentId] },
      ];
      for (const actor of [
        fixture.actors.permitted,
        archiveOnly,
        createOnly,
        fixture.actors.brandManager,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        null,
      ]) {
        for (const testCase of cases) {
          await expect(callPlanningAs(
            database, actor, testCase.sql, testCase.args,
          )).rejects.toMatchObject({ code: "42501" });
        }
      }
      for (const index of [3, 4]) {
        const closedComponentId = randomUUID();
        await database.query(
          "insert into public.project_product_components (id, project_product_id, product_id, required_quantity, created_by_user_id, updated_by_user_id) values ($1, $2, $3, 1, $4, $4)",
          [closedComponentId, groupIds[index], productIds[0], fixture.actors.admin.profileId],
        );
        for (const actor of [fixture.actors.admin, editor]) {
          const closedCases: Array<{ sql: string; args: unknown[] }> = [
            { sql: "select public.create_project_product($1, 'Closed')", args: [projectIds[index]] },
            { sql: "select public.update_project_product($1, 'Closed')", args: [groupIds[index]] },
            { sql: "select public.remove_project_product($1)", args: [groupIds[index]] },
            { sql: "select public.create_project_product_component($1, $2, 1)", args: [groupIds[index], productIds[0]] },
          ];
          closedCases.push(
            { sql: "select public.update_project_product_component($1, $2, 2)", args: [closedComponentId, productIds[0]] },
            { sql: "select public.remove_project_product_component($1)", args: [closedComponentId] },
          );
          for (const testCase of closedCases) {
            await expect(callPlanningAs(
              database, actor, testCase.sql, testCase.args,
            )).rejects.toMatchObject({ code: "PPL01" });
          }
        }
      }

      const admin = fixture.actors.admin;
      const createdGroupIds: string[] = [];
      for (const index of [0, 1, 2]) {
        const result = await callPlanningAs<{ id: string }>(
          database, index === 0 ? editor : admin,
          "select public.create_project_product($1, 'Open') as id",
          [projectIds[index]],
        );
        expect(result[0]?.id).toEqual(expect.any(String));
        createdGroupIds.push(result[0]!.id);
      }
      const invalid: Array<{ sql: string; args: unknown[]; code: string }> = [
        { sql: "select public.create_project_product($1, '   ')", args: [projectIds[0]], code: "22023" },
        { sql: "select public.update_project_product($1, '')", args: [groupIds[0]], code: "22023" },
        { sql: "select public.create_project_product(null::uuid, 'X')", args: [], code: "22023" },
        { sql: "select public.create_project_product($1, 'X')", args: [randomUUID()], code: "P0002" },
        { sql: "select public.create_project_product_component($1, $2, 0)", args: [groupIds[0], productIds[1]], code: "22023" },
        { sql: "select public.create_project_product_component($1, $2, -1)", args: [groupIds[0], productIds[1]], code: "22023" },
        { sql: "select public.create_project_product_component($1, $2, 1)", args: [groupIds[0], productIds[2]], code: "PPL04" },
        { sql: "select public.create_project_product_component($1, $2, 1)", args: [groupIds[0], randomUUID()], code: "PPL04" },
        { sql: "select public.create_project_product_component($1, $2, 1)", args: [groupIds[0], productIds[0]], code: "PPL02" },
        { sql: "select public.update_project_product_component($1, $2, 0)", args: [componentId, productIds[0]], code: "22023" },
        { sql: "select public.update_project_product_component($1, $2, -1)", args: [componentId, productIds[0]], code: "22023" },
        { sql: "select public.update_project_product_component($1, $2, 2)", args: [componentId, productIds[2]], code: "PPL04" },
      ];
      for (const testCase of invalid) {
        await expect(callPlanningAs(
          database, admin, testCase.sql, testCase.args,
        )).rejects.toMatchObject({ code: testCase.code });
      }
      // Archiving after the original requirement does not invalidate unchanged
      // historical Product references during a meaningful quantity edit.
      await database.query(
        "update public.products set is_active = false, archived_at = now(), archived_by_user_id = $2, updated_at = now(), updated_by_user_id = $2 where id = $1",
        [productIds[0], admin.profileId],
      );
      await callPlanningAs(
        database, editor,
        "select public.update_project_product_component($1, $2, 9)",
        [componentId, productIds[0]],
      );
      await expect(callPlanningAs(
        database, admin,
        "select public.create_project_product_component($1, $2, 1)",
        [groupIds[1], productIds[0]],
      )).rejects.toMatchObject({ code: "PPL04" });

      expect((await database.query<ProjectProductComponentRow>(
        "select * from public.project_product_components where id = $1", [componentId],
      )).rows[0]).toMatchObject({
        product_id: productIds[0], required_quantity: "9",
        updated_by_user_id: editor.profileId,
      });
      const events = await database.query<{ action_type: string; count: number }>(
        "select action_type, count(*)::integer as count from public.audit_logs where entity_id = any($1::uuid[]) group by action_type order by action_type",
        [[...createdGroupIds, componentId]],
      );
      expect(events.rows).toEqual([
        { action_type: "project_product_component.updated", count: 1 },
        { action_type: "project_product.created", count: 3 },
      ]);
      expect((await database.query<{ count: number }>(
        "select count(*)::integer as count from public.inventory_movements where product_id = any($1::uuid[])",
        [productIds],
      )).rows).toEqual([{ count: 0 }]);
    });
  });
  it("offers only active narrow Product choices to Project editors without Inventory read access", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { productIds } = await createPlanningRows(
        database, fixture.actors.admin.profileId,
      );
      const editor = fixture.actors.productCreator;
      await database.query(
        "insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id) select $1, id, $2 from public.permission_definitions where key = 'projects.edit'",
        [editor.profileId, fixture.actors.admin.profileId],
      );
      expect(await callPlanningAs<{ can_view: boolean; can_inventory: boolean }>(
        database, editor,
        "select public.has_permission('projects.view') as can_view, public.has_permission('inventory.view') as can_inventory",
      )).toEqual([{ can_view: false, can_inventory: false }]);
      const rows = await callPlanningAs<{
        product_id: string; serial_number: string;
        name: string; product_kind: string;
      }>(
        database, editor, "select * from public.search_project_component_product_choices()",
      );
      expect(rows.filter((row) => productIds.includes(row.product_id))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            product_id: productIds[0], product_kind: "component",
          }),
          expect.objectContaining({
            product_id: productIds[1], product_kind: "pcb_finished_good",
          }),
        ]),
      );
      expect(rows.some((row) => row.product_id === productIds[2])).toBe(false);
      expect(rows.every((row) => Object.keys(row).sort().join(",") ===
        "name,product_id,product_kind,serial_number")).toBe(true);
      const serial = rows.find((row) => row.product_id === productIds[1])?.serial_number;
      expect((await callPlanningAs<{ product_id: string }>(
        database, editor,
        "select * from public.search_project_component_product_choices($1)",
        [serial?.slice(0, 5)],
      )).some((row) => row.product_id === productIds[1])).toBe(true);
      for (const literal of ["%", "_", "\\"]) {
        const matched = await callPlanningAs<{ product_id: string }>(
          database, editor,
          "select * from public.search_project_component_product_choices($1)",
          [literal],
        );
        expect(matched.filter((row) => productIds.includes(row.product_id))
          .map((row) => row.product_id)).toEqual([productIds[0]]);
      }
      expect((await callPlanningAs<{ product_id: string }>(
        database, fixture.actors.admin,
        "select * from public.search_project_component_product_choices('choice 1')",
      )).some((row) => row.product_id === productIds[1])).toBe(true);
      for (const actor of [
        fixture.actors.permitted, fixture.actors.inactive, null,
      ]) {
        await expect(callPlanningAs(
          database, actor,
          "select * from public.search_project_component_product_choices()",
        )).rejects.toMatchObject({ code: "42501" });
      }

      const security = await database.query<{
        anonymous_execute: boolean; authenticated_execute: boolean;
        is_definer: boolean; settings: string[]; name: string;
      }>(
        "select routine.proname as name, routine.prosecdef as is_definer, routine.proconfig as settings, pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute, pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute from pg_catalog.pg_proc as routine join pg_catalog.pg_namespace as ns on ns.oid = routine.pronamespace where ns.nspname = 'public' and routine.proname = any($1::text[]) order by routine.proname",
        [[
          "current_project_planning_mutation_actor_id",
          "lock_open_project_for_planning",
          "create_project_product",
          "update_project_product",
          "remove_project_product",
          "create_project_product_component",
          "update_project_product_component",
          "remove_project_product_component",
          "search_project_component_product_choices",
        ]],
      );
      expect(security.rows).toHaveLength(9);
      for (const row of security.rows) {
        expect(row).toMatchObject({
          anonymous_execute: false,
          is_definer: true,
          settings: ["search_path=\"\""],
        });
        expect(row.authenticated_execute).toBe(
          !["current_project_planning_mutation_actor_id",
            "lock_open_project_for_planning"].includes(row.name),
        );
      }
      for (const table of ["project_products", "project_product_components"]) {
        const direct = await database.query<{
          can_insert: boolean; can_update: boolean; can_delete: boolean;
        }>(
          "select pg_catalog.has_table_privilege('authenticated', $1::text, 'insert') as can_insert, pg_catalog.has_table_privilege('authenticated', $1::text, 'update') as can_update, pg_catalog.has_table_privilege('authenticated', $1::text, 'delete') as can_delete",
          ["public." + table],
        );
        expect(direct.rows).toEqual([{
          can_insert: false, can_update: false, can_delete: false,
        }]);
      }
    });
  });
  it("reads only narrow historical Product identity through the Project planning boundary", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { projectIds, groupIds, productIds } = await createPlanningRows(
        database, fixture.actors.admin.profileId,
      );
      const requirementIds = [randomUUID(), randomUUID(), randomUUID()];
      for (const [index, requirementId] of requirementIds.entries()) {
        await database.query(
          "insert into public.project_product_components (id, project_product_id, product_id, required_quantity, created_by_user_id, updated_by_user_id) values ($1, $2, $3, $4, $5, $5)",
          [
            requirementId,
            groupIds[index + 2],
            productIds[index],
            index + 1,
            fixture.actors.admin.profileId,
          ],
        );
      }
      for (const actor of [fixture.actors.admin, fixture.actors.permitted]) {
        const open = await callPlanningAs<{
          project_product_id: string; project_product_name: string;
          component_id: string | null; product_id: string | null;
          serial_number: string | null; product_name: string | null;
          product_kind: string | null; required_quantity: string | null;
        }>(
          database, actor, "select * from public.get_project_planning($1)",
          [projectIds[0]],
        );
        expect(open).toEqual([{
          project_product_id: groupIds[0],
          project_product_name: "Group 0",
          component_id: null,
          product_id: null,
          serial_number: null,
          product_name: null,
          product_kind: null,
          required_quantity: null,
          category: null,
          brand_name: null,
          physical_quantity: null,
          committed_to_projects: null,
          available_after_commitments: null,
        }]);
        for (const index of [3, 4]) {
          const historical = await callPlanningAs<{
            product_id: string; required_quantity: string;
          }>(
            database, actor, "select * from public.get_project_planning($1)",
            [projectIds[index]],
          );
          expect(historical).toHaveLength(1);
          expect(historical[0]).toMatchObject({
            product_id: productIds[index - 2],
            required_quantity: String(index - 1),
          });
          expect(Object.keys(historical[0] ?? {}).sort()).toEqual([
            "available_after_commitments", "brand_name", "category",
            "committed_to_projects",
            "component_id",
            "physical_quantity",
            "product_id", "product_kind", "product_name",
            "project_product_id", "project_product_name", "required_quantity",
            "serial_number",
          ]);
        }
      }
      const directProduct = await callPlanningAs<{ id: string }>(
        database, fixture.actors.permitted,
        "select id from public.products where id = $1", [productIds[2]],
      );
      expect(directProduct).toEqual([]);
      for (const actor of [
        fixture.actors.unpermitted, fixture.actors.inactive, null,
      ]) {
        await expect(callPlanningAs(
          database, actor, "select * from public.get_project_planning($1)",
          [projectIds[4]],
        )).rejects.toMatchObject({ code: "42501" });
      }
      const security = await database.query<{
        anon_execute: boolean; authenticated_execute: boolean;
        is_definer: boolean; settings: string[];
      }>(
        "select routine.prosecdef as is_definer, routine.proconfig as settings, pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anon_execute, pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute from pg_catalog.pg_proc as routine join pg_catalog.pg_namespace as ns on ns.oid = routine.pronamespace where ns.nspname = 'public' and routine.proname = 'get_project_planning'",
      );
      expect(security.rows).toEqual([{
        anon_execute: false,
        authenticated_execute: true,
        is_definer: true,
        settings: ["search_path=\"\""],
      }]);
      const productRls = await database.query<{ policy: string }>(
        "select pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) as policy from pg_catalog.pg_policy as pol where pol.polrelid = 'public.products'::regclass order by pol.polname",
      );
      expect(productRls.rows.every((row) => !row.policy.includes("projects.view"))).toBe(true);
    });
  });
  it("isolates Project commitments before aggregation and ignores unrelated physical movements", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { projectIds, groupIds, productIds } = await createPlanningRows(
        database, fixture.actors.admin.profileId,
      );
      await database.query(
        "update public.inventory_balances set quantity = 100 where product_id = $1",
        [productIds[0]],
      );
      for (const groupId of [groupIds[0], groupIds[1]]) {
        await database.query(
          "insert into public.project_product_components (project_product_id, product_id, required_quantity, created_by_user_id, updated_by_user_id) values ($1, $2, 50, $3, $3)",
          [groupId, productIds[0], fixture.actors.admin.profileId],
        );
      }
      const beforeConsumption = await callPlanningAs<ProductCommitmentRow>(
        database, fixture.actors.admin,
        "select * from public.get_inventory_project_commitments()",
      );
      expect(beforeConsumption.find((row) => row.product_id === productIds[0]))
        .toMatchObject({
          physical_quantity: "100",
          committed_to_projects: "100",
          available_after_commitments: "0",
        });

      await insertCommitmentMovement(
        database, fixture.actors.admin.profileId,
        productIds[0]!, projectIds[0]!, "work_order", -50,
      );
      await insertCommitmentMovement(
        database, fixture.actors.admin.profileId,
        productIds[0]!, projectIds[0]!, "manual_adjustment", -10,
      );
      await insertCommitmentMovement(
        database, fixture.actors.admin.profileId,
        productIds[0]!, projectIds[0]!, "pcb_production_output", 20,
      );
      await insertCommitmentMovement(
        database, fixture.actors.admin.profileId,
        productIds[0]!, projectIds[2]!, "work_order", -30,
      );
      await insertCommitmentMovement(
        database, fixture.actors.admin.profileId,
        productIds[0]!, null, "work_order", -10,
      );
      await insertCommitmentMovement(
        database, fixture.actors.admin.profileId,
        productIds[1]!, projectIds[0]!, "pcb_production_input", -30,
      );

      const afterConsumption = await callPlanningAs<ProductCommitmentRow>(
        database, fixture.actors.admin,
        "select * from public.get_inventory_project_commitments()",
      );
      expect(afterConsumption.find((row) => row.product_id === productIds[0]))
        .toMatchObject({
          physical_quantity: "100",
          committed_to_projects: "50",
          available_after_commitments: "50",
        });
      expect(afterConsumption.find((row) => row.product_id === productIds[2]))
        .toMatchObject({
          physical_quantity: "0",
          committed_to_projects: "0",
          available_after_commitments: "0",
        });
      expect(new Set(afterConsumption.map((row) => row.product_id)).size)
        .toBe(afterConsumption.length);
      const attribution = await callPlanningAs<ProjectCommitmentRow>(
        database, fixture.actors.admin,
        "select * from public.get_product_project_commitments($1)",
        [productIds[0]],
      );
      expect(attribution).toEqual([{
        project_id: projectIds[1],
        project_name: expect.any(String),
        planned_requirement: "50",
        actual_project_consumption: "0",
        outstanding_commitment: "50",
      }]);
      expect(Object.keys(afterConsumption[0] ?? {}).sort()).toEqual([
        "available_after_commitments", "committed_to_projects",
        "physical_quantity", "product_id",
      ]);
      expect(Object.keys(attribution[0] ?? {}).sort()).toEqual([
        "actual_project_consumption", "outstanding_commitment",
        "planned_requirement", "project_id", "project_name",
      ]);
    });
  });
  it("handles shortage, partial/over-consumption, closed/reopened Projects and archived Products", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { projectIds, groupIds, productIds } = await createPlanningRows(
        database, fixture.actors.admin.profileId,
      );
      const actorId = fixture.actors.admin.profileId;
      await database.query(
        "update public.inventory_balances set quantity = 100 where product_id = $1",
        [productIds[0]],
      );
      const secondGroupId = randomUUID();
      await database.query(
        "insert into public.project_products (id, project_id, name, created_by_user_id, updated_by_user_id) values ($1, $2, 'Second Group', $3, $3)",
        [secondGroupId, projectIds[0], actorId],
      );
      for (const [groupId, productId, quantity] of [
        [groupIds[0], productIds[0], 50],
        [secondGroupId, productIds[0], 20],
        [groupIds[1], productIds[0], 50],
        [groupIds[3], productIds[0], 100],
        [groupIds[4], productIds[0], 100],
        [groupIds[2], productIds[2], 25],
        [groupIds[2], productIds[1], 10],
      ] as const) {
        await database.query(
          "insert into public.project_product_components (project_product_id, product_id, required_quantity, created_by_user_id, updated_by_user_id) values ($1, $2, $3, $4, $4)",
          [groupId, productId, quantity, actorId],
        );
      }
      const readProduct = async (productId: string) => {
        const rows = await callPlanningAs<ProductCommitmentRow>(
          database, fixture.actors.admin,
          "select * from public.get_inventory_project_commitments()",
        );
        return rows.find((row) => row.product_id === productId);
      };
      expect(await readProduct(productIds[0]!)).toMatchObject({
        physical_quantity: "100",
        committed_to_projects: "120",
        available_after_commitments: "-20",
      });
      await insertCommitmentMovement(
        database, actorId, productIds[0]!, projectIds[0]!,
        "pcb_production_input", -30,
      );
      expect(await callPlanningAs<ProjectCommitmentRow>(
        database, fixture.actors.admin,
        "select * from public.get_product_project_commitments($1)",
        [productIds[0]],
      )).toEqual(expect.arrayContaining([expect.objectContaining({
        project_id: projectIds[0],
        planned_requirement: "70",
        actual_project_consumption: "30",
        outstanding_commitment: "40",
      })]));
      await insertCommitmentMovement(
        database, actorId, productIds[0]!, projectIds[0]!,
        "work_order", -50,
      );
      expect(await readProduct(productIds[0]!)).toMatchObject({
        committed_to_projects: "50",
        available_after_commitments: "50",
      });

      // A finished PCB issued through a Work Order is a different Product row;
      // do not expand it back into raw PCB input consumption a second time.
      await insertCommitmentMovement(
        database, actorId, productIds[2]!, projectIds[2]!,
        "pcb_production_input", -5,
      );
      await insertCommitmentMovement(
        database, actorId, productIds[1]!, projectIds[2]!,
        "work_order", -3,
      );
      expect(await readProduct(productIds[2]!)).toMatchObject({
        physical_quantity: "0",
        committed_to_projects: "20",
        available_after_commitments: "-20",
      });
      expect(await readProduct(productIds[1]!)).toMatchObject({
        committed_to_projects: "7",
        available_after_commitments: "-7",
      });

      await database.query(
        "update public.projects set status = 'in_progress', completed_at = null where id = $1",
        [projectIds[3]],
      );
      await insertCommitmentMovement(
        database, actorId, productIds[0]!, projectIds[3]!,
        "work_order", -30,
      );
      expect(await readProduct(productIds[0]!)).toMatchObject({
        committed_to_projects: "120",
        available_after_commitments: "-20",
      });
      const attribution = await callPlanningAs<ProjectCommitmentRow>(
        database, fixture.actors.admin,
        "select * from public.get_product_project_commitments($1)",
        [productIds[0]],
      );
      expect(attribution).toHaveLength(2);
      expect(attribution.find((row) => row.project_id === projectIds[3]))
        .toMatchObject({
          planned_requirement: "100",
          actual_project_consumption: "30",
          outstanding_commitment: "70",
        });
      expect(attribution.every((row) => row.project_id !== projectIds[4]))
        .toBe(true);
    });
  });
  it("restricts commitment reads to Inventory viewers and has no mutation or audit side effects", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { projectIds, groupIds, productIds } = await createPlanningRows(
        database, fixture.actors.admin.profileId,
      );
      const requirementId = randomUUID();
      await database.query(
        "insert into public.project_product_components (id, project_product_id, product_id, required_quantity, created_by_user_id, updated_by_user_id) values ($1, $2, $3, 5, $4, $4)",
        [requirementId, groupIds[0], productIds[0], fixture.actors.admin.profileId],
      );
      await database.query(
        "insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id) select $1, definition.id, $2 from public.permission_definitions as definition where definition.key = 'projects.edit'",
        [fixture.actors.productEditor.profileId, fixture.actors.admin.profileId],
      );
      const snapshot = async () => {
        const tracked = await database.query<{
          project: Record<string, unknown>; product: Record<string, unknown>;
          group_row: Record<string, unknown>;
          requirement: Record<string, unknown>;
          balance: Record<string, unknown>;
          movement_count: string; audit_count: string;
        }>(
          "select (select to_jsonb(project) from public.projects as project where project.id = $1) as project, (select to_jsonb(product) from public.products as product where product.id = $2) as product, (select to_jsonb(item) from public.project_products as item where item.id = $3) as group_row, (select to_jsonb(component) from public.project_product_components as component where component.id = $4) as requirement, (select to_jsonb(balance) from public.inventory_balances as balance where balance.product_id = $2) as balance, (select count(*) from public.inventory_movements) as movement_count, (select count(*) from public.audit_logs) as audit_count",
          [projectIds[0], productIds[0], groupIds[0], requirementId],
        );
        return tracked.rows[0];
      };
      const before = await snapshot();

      for (const actor of [
        fixture.actors.admin, fixture.actors.brandManager,
      ]) {
        const products = await callPlanningAs<ProductCommitmentRow>(
          database, actor,
          "select * from public.get_inventory_project_commitments()",
        );
        expect(products.find((row) => row.product_id === productIds[0]))
          .toMatchObject({ committed_to_projects: "5" });
        const attribution = await callPlanningAs<ProjectCommitmentRow>(
          database, actor,
          "select * from public.get_product_project_commitments($1)",
          [productIds[0]],
        );
        expect(attribution).toEqual([{
          project_id: projectIds[0],
          project_name: expect.any(String),
          planned_requirement: "5",
          actual_project_consumption: "0",
          outstanding_commitment: "5",
        }]);
      }
      expect(await callPlanningAs<{ id: string }>(
        database, fixture.actors.brandManager,
        "select id from public.projects where id = $1", [projectIds[0]],
      )).toEqual([]);
      for (const actor of [
        fixture.actors.permitted, fixture.actors.productEditor,
        fixture.actors.unpermitted, fixture.actors.inactive, null,
      ]) {
        await expect(callPlanningAs(
          database, actor,
          "select * from public.get_inventory_project_commitments()",
        )).rejects.toMatchObject({ code: "42501" });
        await expect(callPlanningAs(
          database, actor,
          "select * from public.get_product_project_commitments($1)",
          [productIds[0]],
        )).rejects.toMatchObject({ code: "42501" });
      }
      await expect(callPlanningAs(
        database, fixture.actors.brandManager,
        "select * from public.calculate_open_project_commitments()",
      )).rejects.toMatchObject({ code: "42501" });

      const security = await database.query<{
        name: string; definer: boolean; settings: string[];
        anon_execute: boolean; authenticated_execute: boolean;
      }>(
        "select routine.proname as name, routine.prosecdef as definer, routine.proconfig as settings, pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anon_execute, pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute from pg_catalog.pg_proc as routine join pg_catalog.pg_namespace as ns on ns.oid = routine.pronamespace where ns.nspname = 'public' and routine.proname = any($1::text[]) order by routine.proname",
        [["calculate_open_project_commitments", "get_inventory_project_commitments", "get_product_project_commitments"]],
      );
      expect(security.rows).toHaveLength(3);
      for (const row of security.rows) {
        expect(row.settings).toEqual(["search_path=\"\""]);
        expect(row.anon_execute).toBe(false);
        expect(row.authenticated_execute).toBe(
          row.name !== "calculate_open_project_commitments",
        );
        expect(row.definer).toBe(row.name !== "calculate_open_project_commitments");
      }
      expect(await snapshot()).toEqual(before);
    });
  });
  it("rolls back Project planning creation when its immutable audit append fails", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { projectIds, groupIds, productIds } = await createPlanningRows(
        database, fixture.actors.admin.profileId,
      );
      const auditBefore = (await database.query<{ count: number }>(
        "select count(*)::integer as count from public.audit_logs where action_type like 'project_product%'",
      )).rows;
      await database.query(
        "create function public.test_reject_project_planning_audit() returns trigger language plpgsql set search_path = '' as $test_function$ begin if new.action_type in ('project_product.created', 'project_product_component.created') then raise exception 'Test audit rejection' using errcode = 'TST01'; end if; return new; end; $test_function$",
      );
      await database.query(
        "create trigger test_reject_project_planning_audit before insert on public.audit_logs for each row execute function public.test_reject_project_planning_audit()",
      );
      await expect(callPlanningAs(
        database, fixture.actors.admin,
        "select public.create_project_product($1, 'Audit Rejected')",
        [projectIds[0]],
      )).rejects.toMatchObject({ code: "TST01" });
      await expect(callPlanningAs(
        database, fixture.actors.admin,
        "select public.create_project_product_component($1, $2, 8)",
        [groupIds[0], productIds[0]],
      )).rejects.toMatchObject({ code: "TST01" });
      expect((await database.query<{ count: number }>(
        "select count(*)::integer as count from public.project_products where project_id = $1 and name = 'Audit Rejected'",
        [projectIds[0]],
      )).rows).toEqual([{ count: 0 }]);
      expect((await database.query<{ count: number }>(
        "select count(*)::integer as count from public.project_product_components where project_product_id = $1",
        [groupIds[0]],
      )).rows).toEqual([{ count: 0 }]);
      expect((await database.query<{ count: number }>(
        "select count(*)::integer as count from public.audit_logs where action_type like 'project_product%'",
      )).rows).toEqual(auditBefore);
      expect((await database.query<{ count: number }>(
        "select count(*)::integer as count from public.inventory_movements where product_id = any($1::uuid[])",
        [productIds],
      )).rows).toEqual([{ count: 0 }]);
    });
  });
  it("serializes competing duplicate requirements and leaves one audited row", async () => {
    const fixture = requireHarness();
    const projectId = randomUUID();
    const groupId = randomUUID();
    const productId = randomUUID();
    const applicationName = "alfaev-planning-wait-" + randomUUID();
    await fixture.withDatabaseClients(3, async (clients) => {
      const first = clients[0];
      const second = clients[1];
      const observer = clients[2];
      if (!first || !second || !observer) {
        throw new Error("Project planning concurrency clients unavailable");
      }
      await observer.query("begin");
      await observer.query(
        "insert into public.projects (id, name, customer_name, start_date, delivery_date, created_by_user_id, updated_by_user_id) values ($1, 'Concurrency Project', 'Customer', '2026-09-01', '2026-09-30', $2, $2)",
        [projectId, fixture.actors.admin.profileId],
      );
      await observer.query(
        "insert into public.project_products (id, project_id, name, created_by_user_id, updated_by_user_id) values ($1, $2, 'Concurrent Group', $3, $3)",
        [groupId, projectId, fixture.actors.admin.profileId],
      );
      await observer.query(
        "insert into public.products (id, serial_number, name, category, product_kind, created_by_user_id, updated_by_user_id) values ($1, $2, 'Concurrent Component', 'Planning', 'component', $3, $3)",
        [productId, createTestSerialNumber(), fixture.actors.admin.profileId],
      );
      await observer.query("commit");
      try {
        await first.query("begin");
        await first.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await first.query("set local role authenticated");
        const firstResult = await first.query<{ id: string }>(
          "select public.create_project_product_component($1, $2, 2) as id",
          [groupId, productId],
        );
        expect(firstResult.rows[0]?.id).toEqual(expect.any(String));

        await second.query("begin");
        await second.query(
          "select pg_catalog.set_config('application_name', $1::text, true)",
          [applicationName],
        );
        await second.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await second.query("set local role authenticated");
        const competing = second.query(
          "select public.create_project_product_component($1, $2, 3)",
          [groupId, productId],
        ).then(
          () => null,
          (error: unknown) => error,
        );

        let lockObserved = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = await observer.query<ActivityWaitRow>(
            "select wait_event_type, wait_event from pg_catalog.pg_stat_activity where application_name = $1",
            [applicationName],
          );
          if (activity.rows[0]?.wait_event_type === "Lock") {
            lockObserved = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(lockObserved).toBe(true);
        await first.query("commit");
        expect(await competing).toMatchObject({ code: "PPL02" });
        await second.query("rollback");
        const result = await observer.query<{
          audit_count: number; movement_count: number;
          quantity: string; relation_count: number;
        }>(
          "select (select count(*)::integer from public.project_product_components where project_product_id = $1 and product_id = $2) as relation_count, (select count(*)::integer from public.audit_logs where action_type = 'project_product_component.created' and entity_id in (select id from public.project_product_components where project_product_id = $1 and product_id = $2)) as audit_count, (select count(*)::integer from public.inventory_movements where product_id = $2) as movement_count, (select quantity::text from public.inventory_balances where product_id = $2) as quantity",
          [groupId, productId],
        );
        expect(result.rows).toEqual([{
          audit_count: 1, movement_count: 0, quantity: "0", relation_count: 1,
        }]);
      } finally {
        await first.query("rollback");
        await second.query("rollback");
        await observer.query("begin");
        await observer.query("set local session_replication_role = replica");
        await observer.query(
          "delete from public.audit_logs where action_type = 'project_product_component.created' and entity_id in (select id from public.project_product_components where project_product_id = $1)",
          [groupId],
        );
        await observer.query(
          "delete from public.project_product_components where project_product_id = $1",
          [groupId],
        );
        await observer.query("delete from public.project_products where id = $1", [groupId]);
        await observer.query("delete from public.inventory_balances where product_id = $1", [productId]);
        await observer.query("delete from public.products where id = $1", [productId]);
        await observer.query("delete from public.projects where id = $1", [projectId]);
        await observer.query("commit");
      }
    });
  });

}
