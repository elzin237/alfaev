import { randomUUID } from "node:crypto";

import type { PoolClient, QueryResultRow } from "pg";
import { expect, it } from "vitest";

import {
  createSupplierSourceFixture,
  getWorkOrderAllocationFingerprint,
} from "./helpers/inventory-provenance";
import type { SecurityFixtureHarness } from "./security-fixtures";

interface ActorRef {
  authUserId: string;
  profileId: string;
}

interface ProductRef {
  productId: string;
  serialNumber: string;
}

interface WorkOrderRef {
  workOrderId: string;
  workOrderNumber: string;
}

interface FinishResult {
  finished_at: string;
  project_completed: boolean;
  project_id: string;
  work_order_id: string;
  work_order_number: string;
  work_order_pdf_id: string;
}

async function queryAs<Row extends QueryResultRow>(
  database: PoolClient,
  actor: ActorRef | null,
  sql: string,
  parameters: readonly unknown[] = [],
): Promise<Row[]> {
  await database.query("savepoint task152_actor_query");
  try {
    await database.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
      [actor?.authUserId ?? ""],
    );
    await database.query(actor ? "set local role authenticated" : "set local role anon");
    const result = await database.query<Row>(sql, [...parameters]);
    await database.query("reset role");
    await database.query("release savepoint task152_actor_query");
    return result.rows;
  } catch (error) {
    await database.query("rollback to savepoint task152_actor_query");
    await database.query("release savepoint task152_actor_query");
    throw error;
  }
}

async function expectRejected(
  database: PoolClient,
  actor: ActorRef | null,
  sql: string,
  parameters: readonly unknown[],
  code: string,
): Promise<void> {
  await expect(queryAs(database, actor, sql, parameters)).rejects.toMatchObject({ code });
}

async function grantPermissions(
  database: PoolClient,
  actor: ActorRef,
  grantedByUserId: string,
  keys: readonly string[],
): Promise<void> {
  await database.query(
    `insert into public.user_permissions (
       user_id, permission_definition_id, granted_by_user_id
     )
     select $1::uuid, definition.id, $2::uuid
     from public.permission_definitions as definition
     where definition.key = any($3::text[])`,
    [actor.profileId, grantedByUserId, keys],
  );
}

async function createProduct(
  database: PoolClient,
  admin: ActorRef,
  name: string,
): Promise<ProductRef> {
  const rows = await queryAs<{
    product_id: string;
    serial_number: string;
  }>(
    database,
    admin,
    `select * from public.create_product($1::text, $2::text, null::uuid)`,
    [name, "Task 152 Integration"],
  );
  const row = rows[0];
  if (!row) throw new Error("Task 152 Product creation returned no row");
  return { productId: row.product_id, serialNumber: row.serial_number };
}

async function createProject(
  database: PoolClient,
  actor: ActorRef,
  name: string,
  customer: string,
): Promise<string> {
  const rows = await queryAs<{ project_id: string }>(
    database,
    actor,
    `select public.create_project(
       $1::text, $2::text, '2026-10-06'::date, '2026-12-18'::date
     ) as project_id`,
    [name, customer],
  );
  const projectId = rows[0]?.project_id;
  if (!projectId) throw new Error("Task 152 Project creation returned no ID");
  return projectId;
}

async function addProjectRequirement(
  database: PoolClient,
  actor: ActorRef,
  projectId: string,
  productId: string,
  quantity: string,
  label: string,
): Promise<{ componentId: string; projectProductId: string }> {
  const group = await queryAs<{ project_product_id: string }>(
    database,
    actor,
    `select public.create_project_product($1::uuid, $2::text)
       as project_product_id`,
    [projectId, label],
  );
  const projectProductId = group[0]?.project_product_id;
  if (!projectProductId) throw new Error("Task 152 Project Product creation failed");
  const component = await queryAs<{ component_id: string }>(
    database,
    actor,
    `select public.create_project_product_component(
       $1::uuid, $2::uuid, $3::bigint
     ) as component_id`,
    [projectProductId, productId, quantity],
  );
  const componentId = component[0]?.component_id;
  if (!componentId) throw new Error("Task 152 requirement creation failed");
  return { componentId, projectProductId };
}

async function adjustInventory(
  database: PoolClient,
  admin: ActorRef,
  productId: string,
  adjustmentType: "add" | "remove",
  quantity: string,
  reason: string,
) {
  const source = adjustmentType === "add"
    ? await createSupplierSourceFixture(database, admin, productId, {
      catalogNumber: `TASK152-${productId}-${randomUUID()}`,
    })
    : null;
  const rows = await queryAs<{
    movement_id: string;
    quantity_after: string;
    quantity_before: string;
  }>(
    database,
    admin,
    `select
       adjusted.movement_id,
       adjusted.quantity_before::text as quantity_before,
       adjusted.quantity_after::text as quantity_after
     from public.manual_adjust_inventory(
       $1::uuid, $2::text, $3::bigint, $4::text, $5::uuid
     ) as adjusted`,
    [productId, adjustmentType, quantity, reason, source?.productSupplierId ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error("Task 152 Inventory adjustment returned no row");
  return row;
}

async function createDraft(
  database: PoolClient,
  creator: ActorRef,
): Promise<WorkOrderRef> {
  const rows = await queryAs<{
    work_order_id: string;
    work_order_number: string;
  }>(database, creator, "select * from public.create_draft_work_order()");
  const row = rows[0];
  if (!row) throw new Error("Task 152 Draft creation returned no row");
  return { workOrderId: row.work_order_id, workOrderNumber: row.work_order_number };
}

async function workOrderTimestamp(database: PoolClient, workOrderId: string) {
  const row = (await database.query<{ updated_at: string }>(
    `select updated_at::text as updated_at
     from public.work_orders where id = $1::uuid`,
    [workOrderId],
  )).rows[0];
  if (!row) throw new Error("Task 152 Work Order timestamp is unavailable");
  return row.updated_at;
}

async function saveDraft(
  database: PoolClient,
  editor: ActorRef,
  values: {
    description: string;
    expectedUpdatedAt: string;
    items: Array<{ product_id: string; quantity: string }>;
    projectId: string;
    workOrderId: string;
  },
) {
  const rows = await queryAs<{ updated_at: string; work_order_id: string }>(
    database,
    editor,
    `select saved.work_order_id, saved.updated_at::text as updated_at
     from public.save_draft_work_order(
       $1::uuid, $2::uuid, $3::text, $4::jsonb, $5::timestamptz
     ) as saved`,
    [
      values.workOrderId,
      values.projectId,
      values.description,
      JSON.stringify(values.items),
      values.expectedUpdatedAt,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Task 152 Draft save returned no row");
  return row;
}

async function addPdfCandidate(database: PoolClient, workOrderId: string) {
  const reference = `final/${workOrderId}/${randomUUID()}.pdf`;
  await database.query(
    `insert into storage.objects (bucket_id, name, metadata)
     values (
       'work-order-pdfs', $1::text,
       pg_catalog.jsonb_build_object('mimetype', 'application/pdf')
     )`,
    [reference],
  );
  return reference;
}

async function finishWorkOrder(
  database: PoolClient,
  finisher: ActorRef,
  workOrderId: string,
  expectedUpdatedAt: string,
  storageReference: string,
): Promise<FinishResult> {
  const rows = await queryAs<FinishResult>(
    database,
    finisher,
    `select
       finished.work_order_id,
       finished.work_order_number,
       finished.finished_at::text as finished_at,
       finished.project_id,
       finished.project_completed,
       finished.work_order_pdf_id
     from public.finish_work_order(
       $1::uuid, $2::timestamptz, $3::text, $4::text, $5::text
     ) as finished`,
    [
      workOrderId,
      expectedUpdatedAt,
      storageReference,
      "a".repeat(64),
      await getWorkOrderAllocationFingerprint(database, workOrderId),
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Task 152 Finish returned no row");
  return row;
}

export function registerProjectWorkOrderPdfE2eTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  it("validates Project to generic Work Order to PDF as one rollback-safe lifecycle", async () => {
    const fixture = requireHarness();
    const admin = fixture.actors.admin;
    const projectActor = await fixture.createTemporaryProfile(
      "task-152-project-actor", undefined, admin.profileId,
    );
    const creator = await fixture.createTemporaryProfile(
      "task-152-creator", undefined, admin.profileId,
    );
    const editor = await fixture.createTemporaryProfile(
      "task-152-editor", undefined, admin.profileId,
    );
    const finisher = await fixture.createTemporaryProfile(
      "task-152-finisher", undefined, admin.profileId,
    );
    const viewer = await fixture.createTemporaryProfile(
      "task-152-viewer", undefined, admin.profileId,
    );
    const negative = await fixture.createTemporaryProfile(
      "task-152-negative", undefined, admin.profileId,
    );

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await grantPermissions(database, projectActor, admin.profileId, [
        "projects.create", "projects.edit", "projects.view",
      ]);
      await grantPermissions(database, creator, admin.profileId, ["work_orders.create"]);
      await grantPermissions(database, editor, admin.profileId, ["work_orders.edit_draft"]);
      await grantPermissions(database, finisher, admin.profileId, ["work_orders.finish"]);
      await grantPermissions(database, viewer, admin.profileId, [
        "work_orders.view", "projects.view", "archive.view",
      ]);

      const projectName = `Task 152 Project ${randomUUID()}`;
      const otherProjectName = `Task 152 Isolated Project ${randomUUID()}`;
      const projectId = await createProject(
        database, projectActor, projectName, "Task 152 Customer",
      );
      const otherProjectId = await createProject(
        database, projectActor, otherProjectName, "Other Customer",
      );

      const productA = await createProduct(database, admin, `Task 152 A ${randomUUID()}`);
      const productB = await createProduct(database, admin, `Task 152 B ${randomUUID()}`);
      const productC = await createProduct(database, admin, `Task 152 C ${randomUUID()}`);
      const productD = await createProduct(database, admin, `Task 152 D ${randomUUID()}`);
      const archivedProduct = await createProduct(
        database, admin, `Task 152 Archived ${randomUUID()}`,
      );
      await queryAs(database, admin, "select public.archive_product($1::uuid)", [
        archivedProduct.productId,
      ]);

      const requirementA = await addProjectRequirement(
        database, projectActor, projectId, productA.productId, "5", "Planned A",
      );
      const requirementD = await addProjectRequirement(
        database, projectActor, projectId, productD.productId, "5", "Planned D",
      );
      await addProjectRequirement(
        database, projectActor, otherProjectId, productA.productId, "100", "Other A",
      );

      expect(await queryAs(
        database,
        projectActor,
        "select id from public.projects where id = $1::uuid",
        [projectId],
      )).toEqual([{ id: projectId }]);
      expect(await queryAs(
        database,
        negative,
        "select id from public.projects where id = $1::uuid",
        [projectId],
      )).toEqual([]);
      const projectRow = (await database.query<{
        created_by_user_id: string;
        customer_name: string;
        status: string;
        updated_by_user_id: string;
      }>(
        `select created_by_user_id, customer_name, status, updated_by_user_id
         from public.projects where id = $1::uuid`,
        [projectId],
      )).rows[0];
      expect(projectRow).toEqual({
        created_by_user_id: projectActor.profileId,
        customer_name: "Task 152 Customer",
        status: "planned",
        updated_by_user_id: projectActor.profileId,
      });

      expect(await adjustInventory(
        database, admin, productA.productId, "add", "20", "Task 152 initial A",
      )).toMatchObject({ quantity_before: "0", quantity_after: "20" });
      expect(await adjustInventory(
        database, admin, productB.productId, "add", "15", "Task 152 initial B",
      )).toMatchObject({ quantity_before: "0", quantity_after: "15" });
      expect(await adjustInventory(
        database, admin, productC.productId, "add", "5", "Task 152 initial C",
      )).toMatchObject({ quantity_before: "0", quantity_after: "5" });
      expect(await adjustInventory(
        database, admin, productD.productId, "add", "10", "Task 152 initial D",
      )).toMatchObject({ quantity_before: "0", quantity_after: "10" });

      const balancesBefore = await database.query<{ product_id: string; quantity: string }>(
        `select product_id, quantity::text as quantity
         from public.inventory_balances
         where product_id = any($1::uuid[])
         order by product_id`,
        [[productA.productId, productB.productId, productC.productId, productD.productId]],
      );
      expect(new Map(balancesBefore.rows.map((row) => [row.product_id, row.quantity])))
        .toEqual(new Map([
          [productA.productId, "20"], [productB.productId, "15"],
          [productC.productId, "5"], [productD.productId, "10"],
        ]));

      await expectRejected(
        database, negative, "select * from public.create_draft_work_order()", [], "42501",
      );
      await expectRejected(
        database, projectActor, "select * from public.create_draft_work_order()", [], "42501",
      );
      const primary = await createDraft(database, creator);
      const sibling = await createDraft(database, creator);
      const rollbackCandidate = await createDraft(database, creator);
      expect(primary.workOrderNumber).toMatch(/^RN-[0-9]{4}-[0-9]{4}$/);

      const primaryCreatedAt = await workOrderTimestamp(database, primary.workOrderId);
      const siblingCreatedAt = await workOrderTimestamp(database, sibling.workOrderId);
      const rollbackCreatedAt = await workOrderTimestamp(database, rollbackCandidate.workOrderId);
      expect((await database.query(
        `select status, project_id, customer_name_snapshot, description,
                finished_at, finished_by_user_id, created_by_user_id
         from public.work_orders where id = $1::uuid`,
        [primary.workOrderId],
      )).rows).toEqual([{
        status: "draft",
        project_id: null,
        customer_name_snapshot: null,
        description: null,
        finished_at: null,
        finished_by_user_id: null,
        created_by_user_id: creator.profileId,
      }]);
      expect((await database.query<{ count: number }>(
        `select count(*)::integer as count from public.work_order_items
         where work_order_id = $1::uuid`,
        [primary.workOrderId],
      )).rows).toEqual([{ count: 0 }]);

      await expectRejected(
        database,
        creator,
        `select * from public.save_draft_work_order(
           $1::uuid, $2::uuid, 'Denied'::text, '[]'::jsonb, $3::timestamptz
         )`,
        [primary.workOrderId, projectId, primaryCreatedAt],
        "42501",
      );

      for (const product of [productA, productB, productC]) {
        const rows = await queryAs<{
          name: string;
          product_id: string;
          serial_number: string;
        }>(
          database,
          editor,
          `select * from public.resolve_work_order_product_barcode(
             $1::uuid, $2::text
           )`,
          [primary.workOrderId, product.serialNumber],
        );
        expect(rows[0]).toMatchObject({
          product_id: product.productId,
          serial_number: product.serialNumber,
        });
      }
      await expectRejected(
        database,
        editor,
        `select * from public.resolve_work_order_product_barcode(
           $1::uuid, $2::text
         )`,
        [primary.workOrderId, archivedProduct.serialNumber],
        "PRD05",
      );

      const primaryItems = [
        { product_id: productA.productId, quantity: "8" },
        { product_id: productB.productId, quantity: "3" },
        { product_id: productC.productId, quantity: "2" },
      ];
      for (const [payload, code] of [
        [[primaryItems[0], primaryItems[0]], "22023"],
        [[{ product_id: productA.productId, quantity: "0" }], "22023"],
        [[{ product_id: productA.productId, quantity: "1e2" }], "22023"],
        [[{ product_id: archivedProduct.productId, quantity: "1" }], "PRD05"],
        [[{ product_id: randomUUID(), quantity: "1" }], "PRD05"],
      ] as const) {
        await expectRejected(
          database,
          editor,
          `select * from public.save_draft_work_order(
             $1::uuid, $2::uuid, 'Task 152 field work'::text,
             $3::jsonb, $4::timestamptz
           )`,
          [primary.workOrderId, projectId, JSON.stringify(payload), primaryCreatedAt],
          code,
        );
      }

      const primarySaved = await saveDraft(database, editor, {
        workOrderId: primary.workOrderId,
        projectId,
        description: "  Task 152 field work  ",
        items: primaryItems,
        expectedUpdatedAt: primaryCreatedAt,
      });
      expect(primarySaved.updated_at).not.toBe(primaryCreatedAt);
      expect((await database.query(
        `select project_id, customer_name_snapshot, description, status,
                updated_by_user_id
         from public.work_orders where id = $1::uuid`,
        [primary.workOrderId],
      )).rows).toEqual([{
        project_id: projectId,
        customer_name_snapshot: "Task 152 Customer",
        description: "Task 152 field work",
        status: "draft",
        updated_by_user_id: editor.profileId,
      }]);
      expect((await database.query<{ product_id: string; quantity: string }>(
        `select product_id, quantity::text as quantity
         from public.work_order_items where work_order_id = $1::uuid
         order by product_id`,
        [primary.workOrderId],
      )).rows).toEqual([...primaryItems]
        .sort((left, right) => left.product_id.localeCompare(right.product_id)));

      const updateAuditCount = async () => (await database.query<{ count: number }>(
        `select count(*)::integer as count from public.audit_logs
         where entity_id = $1::uuid and action_type = 'work_order.updated'`,
        [primary.workOrderId],
      )).rows[0]?.count;
      expect(await updateAuditCount()).toBe(1);
      const noOp = await saveDraft(database, editor, {
        workOrderId: primary.workOrderId,
        projectId,
        description: "Task 152 field work",
        items: primaryItems,
        expectedUpdatedAt: primarySaved.updated_at,
      });
      expect(noOp.updated_at).toBe(primarySaved.updated_at);
      expect(await updateAuditCount()).toBe(1);
      await expectRejected(
        database,
        editor,
        `select * from public.save_draft_work_order(
           $1::uuid, $2::uuid, 'Stale overwrite'::text,
           $3::jsonb, $4::timestamptz
         )`,
        [primary.workOrderId, projectId, JSON.stringify(primaryItems), primaryCreatedAt],
        "WOR05",
      );

      const siblingSaved = await saveDraft(database, editor, {
        workOrderId: sibling.workOrderId,
        projectId,
        description: "Task 152 sibling work",
        items: [{ product_id: productD.productId, quantity: "1" }],
        expectedUpdatedAt: siblingCreatedAt,
      });
      const rollbackSaved = await saveDraft(database, editor, {
        workOrderId: rollbackCandidate.workOrderId,
        projectId: otherProjectId,
        description: "Task 152 rollback candidate",
        items: [{ product_id: productB.productId, quantity: "1" }],
        expectedUpdatedAt: rollbackCreatedAt,
      });

      const siblingReference = await addPdfCandidate(database, sibling.workOrderId);
      const siblingFinish = await finishWorkOrder(
        database, finisher, sibling.workOrderId, siblingSaved.updated_at, siblingReference,
      );
      expect(siblingFinish.project_completed).toBe(false);
      expect((await database.query<{ status: string }>(
        "select status from public.projects where id = $1::uuid",
        [projectId],
      )).rows).toEqual([{ status: "planned" }]);

      const rollbackReference = await addPdfCandidate(database, rollbackCandidate.workOrderId);
      const rollbackBaseline = (await database.query<{
        audits: number;
        balance: string;
        movements: number;
        pdfs: number;
        project_status: string;
        status: string;
      }>(
        `select
           (select count(*)::integer from public.audit_logs
            where entity_id in ($1::uuid, $2::uuid)
              and action_type in ('work_order.finished', 'project.completed')) as audits,
           (select quantity::text from public.inventory_balances
            where product_id = $3::uuid) as balance,
           (select count(*)::integer from public.inventory_movements
            where source_type = 'work_order' and source_id = $1::uuid) as movements,
           (select count(*)::integer from public.work_order_pdfs
            where work_order_id = $1::uuid) as pdfs,
           (select status from public.projects where id = $2::uuid) as project_status,
           (select status from public.work_orders where id = $1::uuid) as status`,
        [rollbackCandidate.workOrderId, otherProjectId, productB.productId],
      )).rows[0];
      await database.query(
        `create function public.test_task152_reject_project_completion_audit()
         returns trigger language plpgsql set search_path = '' as $function$
         begin
           if new.action_type = 'project.completed' then
             raise exception 'Rejected Task 152 completion audit'
               using errcode = '22023';
           end if;
           return new;
         end;
         $function$`,
      );
      await database.query(
        `create trigger test_task152_reject_project_completion_audit
         before insert on public.audit_logs for each row
         execute function public.test_task152_reject_project_completion_audit()`,
      );
      await expectRejected(
        database,
        finisher,
        `select * from public.finish_work_order(
           $1::uuid, $2::timestamptz, $3::text, $4::text, $5::text
         )`,
        [
          rollbackCandidate.workOrderId,
          rollbackSaved.updated_at,
          rollbackReference,
          "b".repeat(64),
          await getWorkOrderAllocationFingerprint(database, rollbackCandidate.workOrderId),
        ],
        "22023",
      );
      expect((await database.query(
        `select
           (select count(*)::integer from public.audit_logs
            where entity_id in ($1::uuid, $2::uuid)
              and action_type in ('work_order.finished', 'project.completed')) as audits,
           (select quantity::text from public.inventory_balances
            where product_id = $3::uuid) as balance,
           (select count(*)::integer from public.inventory_movements
            where source_type = 'work_order' and source_id = $1::uuid) as movements,
           (select count(*)::integer from public.work_order_pdfs
            where work_order_id = $1::uuid) as pdfs,
           (select status from public.projects where id = $2::uuid) as project_status,
           (select status from public.work_orders where id = $1::uuid) as status`,
        [rollbackCandidate.workOrderId, otherProjectId, productB.productId],
      )).rows[0]).toEqual(rollbackBaseline);
      await database.query(
        "drop trigger test_task152_reject_project_completion_audit on public.audit_logs",
      );
      await database.query(
        "drop function public.test_task152_reject_project_completion_audit()",
      );

      expect(await adjustInventory(
        database, admin, productC.productId, "remove", "4", "Task 152 shortage",
      )).toMatchObject({ quantity_before: "5", quantity_after: "1" });
      const insufficient = await queryAs<{
        available_quantity: string;
        inventory_sufficient: boolean;
        missing_quantity: string;
        product_id: string;
        required_quantity: string;
      }>(
        database,
        finisher,
        `select product_id, required_quantity::text as required_quantity,
                available_quantity::text as available_quantity,
                missing_quantity::text as missing_quantity, inventory_sufficient
         from public.preflight_finish_work_order($1::uuid, $2::timestamptz)`,
        [primary.workOrderId, primarySaved.updated_at],
      );
      expect(insufficient).toHaveLength(3);
      expect(insufficient.every((row) => !row.inventory_sufficient)).toBe(true);
      expect(insufficient.find((row) => row.product_id === productC.productId))
        .toMatchObject({
          available_quantity: "1", missing_quantity: "1", required_quantity: "2",
        });
      const primaryReference = await addPdfCandidate(database, primary.workOrderId);
      await expectRejected(
        database,
        finisher,
        `select * from public.finish_work_order(
           $1::uuid, $2::timestamptz, $3::text, $4::text, $5::text
         )`,
        [
          primary.workOrderId,
          primarySaved.updated_at,
          primaryReference,
          "a".repeat(64),
          "b".repeat(32),
        ],
        "IVB02",
      );
      expect((await database.query(
        `select
           (select status from public.work_orders where id = $1::uuid) as status,
           (select count(*)::integer from public.inventory_movements
            where source_type = 'work_order' and source_id = $1::uuid) as movements,
           (select count(*)::integer from public.work_order_pdfs
            where work_order_id = $1::uuid) as pdfs,
           (select count(*)::integer from public.audit_logs
            where entity_id = $1::uuid and action_type = 'work_order.finished') as audits`,
        [primary.workOrderId],
      )).rows).toEqual([{ audits: 0, movements: 0, pdfs: 0, status: "draft" }]);
      expect(await adjustInventory(
        database, admin, productC.productId, "add", "4", "Task 152 restore stock",
      )).toMatchObject({ quantity_before: "1", quantity_after: "5" });

      const snapshot = await queryAs<{
        catalog_number: string;
        customer_name_snapshot: string;
        description: string;
        material_position: string;
        product_id: string;
        project_name: string;
        quantity: string;
        product_name: string;
        snapshot_updated_at: string;
        work_order_id: string;
        work_order_number: string;
      }>(
        database,
        finisher,
        `select snapshot.work_order_id, snapshot.work_order_number,
                snapshot.project_name, snapshot.customer_name_snapshot,
                snapshot.description,
                snapshot.snapshot_updated_at::text as snapshot_updated_at,
                snapshot.material_position, snapshot.product_id,
                snapshot.catalog_number, snapshot.product_name, snapshot.quantity
         from public.get_work_order_pdf_snapshot(
           $1::uuid, $2::timestamptz
         ) as snapshot`,
        [primary.workOrderId, primarySaved.updated_at],
      );
      expect(snapshot).toHaveLength(4);
      expect(snapshot.map((row) => row.material_position)).toEqual(["1", "2", "3", "4"]);
      expect(snapshot.every((row) => (
        row.work_order_id === primary.workOrderId
        && row.work_order_number === primary.workOrderNumber
        && row.project_name === projectName
        && row.customer_name_snapshot === "Task 152 Customer"
        && row.description === "Task 152 field work"
        && row.snapshot_updated_at === primarySaved.updated_at
      ))).toBe(true);
      const quantitiesByProduct = new Map<string, bigint>();
      for (const row of snapshot) {
        quantitiesByProduct.set(
          row.product_id,
          (quantitiesByProduct.get(row.product_id) ?? 0n) + BigInt(row.quantity),
        );
        expect(row.catalog_number).toMatch(/^TASK152-/);
        expect(row.product_name).toContain("Task 152");
      }
      expect(new Map([...quantitiesByProduct].map(([productId, quantity]) => [
        productId,
        quantity.toString(),
      ])))
        .toEqual(new Map([
          [productA.productId, "8"],
          [productB.productId, "3"],
          [productC.productId, "2"],
        ]));

      const primaryFinish = await finishWorkOrder(
        database, finisher, primary.workOrderId, primarySaved.updated_at, primaryReference,
      );
      expect(primaryFinish).toMatchObject({
        project_completed: true,
        project_id: projectId,
        work_order_id: primary.workOrderId,
        work_order_number: primary.workOrderNumber,
      });

      const finalBalances = await database.query<{ product_id: string; quantity: string }>(
        `select product_id, quantity::text as quantity
         from public.inventory_balances
         where product_id = any($1::uuid[])
         order by product_id`,
        [[productA.productId, productB.productId, productC.productId, productD.productId]],
      );
      expect(new Map(finalBalances.rows.map((row) => [row.product_id, row.quantity])))
        .toEqual(new Map([
          [productA.productId, "12"], [productB.productId, "12"],
          [productC.productId, "3"], [productD.productId, "9"],
        ]));
      const primaryMovements = await database.query<{
        actor_user_id: string;
        product_id: string;
        project_id: string;
        quantity_after: string;
        quantity_before: string;
        quantity_delta: string;
        source_id: string;
        source_type: string;
      }>(
        `select product_id, quantity_delta::text as quantity_delta,
                quantity_before::text as quantity_before,
                quantity_after::text as quantity_after,
                source_type, source_id, project_id, actor_user_id
         from public.inventory_movements
         where source_type = 'work_order' and source_id = $1::uuid
         order by product_id`,
        [primary.workOrderId],
      );
      expect(primaryMovements.rows).toHaveLength(3);
      for (const movement of primaryMovements.rows) {
        expect(BigInt(movement.quantity_before) + BigInt(movement.quantity_delta))
          .toBe(BigInt(movement.quantity_after));
        expect(movement.source_id).toBe(primary.workOrderId);
        expect(movement.source_type).toBe("work_order");
        expect(movement.project_id).toBe(projectId);
        expect(movement.actor_user_id).toBe(finisher.profileId);
      }
      expect(new Map(primaryMovements.rows.map((row) => [row.product_id, row.quantity_delta])))
        .toEqual(new Map([
          [productA.productId, "-8"],
          [productB.productId, "-3"],
          [productC.productId, "-2"],
        ]));

      const completedProject = (await database.query<{
        completed_at: string;
        status: string;
        updated_at: string;
        updated_by_user_id: string;
      }>(
        `select status, completed_at::text as completed_at,
                updated_at::text as updated_at, updated_by_user_id
         from public.projects where id = $1::uuid`,
        [projectId],
      )).rows[0];
      expect(completedProject).toEqual({
        completed_at: primaryFinish.finished_at,
        status: "completed",
        updated_at: primaryFinish.finished_at,
        updated_by_user_id: finisher.profileId,
      });
      expect((await database.query(
        `select id, required_quantity::text as required_quantity
         from public.project_product_components
         where id = any($1::uuid[]) order by id`,
        [[requirementA.componentId, requirementD.componentId]],
      )).rows).toEqual([
        { id: requirementA.componentId, required_quantity: "5" },
        { id: requirementD.componentId, required_quantity: "5" },
      ].sort((left, right) => left.id.localeCompare(right.id)));
      expect((await database.query(
        `select project_id, planned_requirement::text as planned_requirement,
                actual_project_consumption::text as actual_project_consumption,
                outstanding_commitment::text as outstanding_commitment
         from public.calculate_open_project_commitments($1::uuid)
         order by project_id`,
        [productA.productId],
      )).rows).toEqual([{
        project_id: otherProjectId,
        planned_requirement: "100",
        actual_project_consumption: "0",
        outstanding_commitment: "100",
      }]);

      const usage = await queryAs<{
        product_id: string;
        quantity: string;
        work_order_id: string;
        work_order_number: string;
      }>(
        database,
        projectActor,
        "select product_id, quantity, work_order_id, work_order_number from public.list_project_work_order_material_usage($1::uuid)",
        [projectId],
      );
      expect(usage).toHaveLength(4);
      expect(usage.filter((row) => row.work_order_id === primary.workOrderId))
        .toHaveLength(3);
      expect(usage.find((row) => row.product_id === productB.productId))
        .toMatchObject({ quantity: "3", work_order_number: primary.workOrderNumber });
      expect(await queryAs(
        database,
        projectActor,
        "select * from public.list_project_work_order_material_usage($1::uuid)",
        [otherProjectId],
      )).toEqual([]);

      const pdf = (await database.query<{
        content_hash: string;
        document_version: number;
        generated_at: string;
        generated_by_user_id: string;
        id: string;
        storage_reference: string;
      }>(
        `select id, storage_reference, document_version,
                content_hash, generated_at::text as generated_at,
                generated_by_user_id
         from public.work_order_pdfs where work_order_id = $1::uuid`,
        [primary.workOrderId],
      )).rows[0];
      expect(pdf).toEqual({
        id: primaryFinish.work_order_pdf_id,
        storage_reference: primaryReference,
        document_version: 1,
        content_hash: "a".repeat(64),
        generated_at: primaryFinish.finished_at,
        generated_by_user_id: finisher.profileId,
      });

      const finishedDetail = await queryAs<Record<string, unknown>>(
        database,
        viewer,
        "select * from public.get_finished_work_order_detail($1::uuid)",
        [primary.workOrderId],
      );
      expect(finishedDetail[0]).toMatchObject({
        work_order_id: primary.workOrderId,
        work_order_number: primary.workOrderNumber,
        project_id: projectId,
        project_name: projectName,
        customer_name_snapshot: "Task 152 Customer",
        description: "Task 152 field work",
        finished_by_user_id: finisher.profileId,
        pdf_id: primaryFinish.work_order_pdf_id,
        document_version: 1,
      });
      const finishedMaterials = await queryAs<{
        catalog_number: string;
        product_id: string;
        quantity: string;
      }>(
        database,
        viewer,
        `select product_id, catalog_number, quantity
         from public.list_finished_work_order_materials($1::uuid)`,
        [primary.workOrderId],
      );
      const finishedQuantitiesByProduct = new Map<string, bigint>();
      for (const row of finishedMaterials) {
        finishedQuantitiesByProduct.set(
          row.product_id,
          (finishedQuantitiesByProduct.get(row.product_id) ?? 0n) + BigInt(row.quantity),
        );
        expect(row.catalog_number).toMatch(/^TASK152-/);
      }
      expect(new Map([...finishedQuantitiesByProduct].map(([productId, quantity]) => [
        productId,
        quantity.toString(),
      ])))
        .toEqual(new Map([
          [productA.productId, "8"],
          [productB.productId, "3"],
          [productC.productId, "2"],
        ]));
      expect(await queryAs(
        database,
        viewer,
        `select name from storage.objects
         where bucket_id = 'work-order-pdfs' and name = $1::text`,
        [primaryReference],
      )).toEqual([{ name: primaryReference }]);
      expect(await queryAs(
        database,
        finisher,
        `select name from storage.objects
         where bucket_id = 'work-order-pdfs' and name = $1::text`,
        [primaryReference],
      )).toEqual([]);
      await expectRejected(
        database,
        negative,
        "select * from public.get_finished_work_order_detail($1::uuid)",
        [primary.workOrderId],
        "42501",
      );

      const primaryItemId = (await database.query<{ id: string }>(
        "select id from public.work_order_items where work_order_id = $1::uuid limit 1",
        [primary.workOrderId],
      )).rows[0]!.id;
      const primaryMovementId = (await database.query<{ id: string }>(
        `select id from public.inventory_movements
         where source_type = 'work_order' and source_id = $1::uuid limit 1`,
        [primary.workOrderId],
      )).rows[0]!.id;
      for (const [name, code, operation] of [
        ["task152_header", "WOR02", () => database.query(
          "update public.work_orders set description = 'Changed' where id = $1::uuid",
          [primary.workOrderId],
        )],
        ["task152_number", "WOR02", () => database.query(
          "update public.work_orders set work_order_number = 'RN-7000-0001' where id = $1::uuid",
          [primary.workOrderId],
        )],
        ["task152_delete", "WOR02", () => database.query(
          "delete from public.work_orders where id = $1::uuid", [primary.workOrderId],
        )],
        ["task152_item_update", "WOR04", () => database.query(
          "update public.work_order_items set quantity = quantity + 1 where id = $1::uuid",
          [primaryItemId],
        )],
        ["task152_item_delete", "WOR04", () => database.query(
          "delete from public.work_order_items where id = $1::uuid", [primaryItemId],
        )],
        ["task152_pdf", "WOR09", () => database.query(
          "update public.work_order_pdfs set content_hash = null where id = $1::uuid",
          [primaryFinish.work_order_pdf_id],
        )],
        ["task152_movement", "55000", () => database.query(
          "update public.inventory_movements set reason = 'Changed' where id = $1::uuid",
          [primaryMovementId],
        )],
      ] as const) {
        await database.query(`savepoint ${name}`);
        await expect(operation()).rejects.toMatchObject({ code });
        await database.query(`rollback to savepoint ${name}`);
        await database.query(`release savepoint ${name}`);
      }
      await expectRejected(
        database,
        editor,
        `select * from public.save_draft_work_order(
           $1::uuid, $2::uuid, 'Changed'::text, $3::jsonb, $4::timestamptz
         )`,
        [primary.workOrderId, projectId, JSON.stringify(primaryItems), primaryFinish.finished_at],
        "WOR02",
      );
      await expectRejected(
        database,
        finisher,
        `select * from public.finish_work_order(
           $1::uuid, $2::timestamptz, $3::text, $4::text, $5::text
         )`,
        [
          primary.workOrderId,
          primaryFinish.finished_at,
          primaryReference,
          "a".repeat(64),
          "0".repeat(32),
        ],
        "WOR02",
      );
      expect((await database.query(
        `select
           (select count(*)::integer from public.inventory_movements
            where source_type = 'work_order' and source_id = $1::uuid) as movements,
           (select count(*)::integer from public.work_order_pdfs
            where work_order_id = $1::uuid) as pdfs,
           (select count(*)::integer from public.audit_logs
            where entity_id = $1::uuid and action_type = 'work_order.finished') as audits`,
        [primary.workOrderId],
      )).rows).toEqual([{ audits: 1, movements: 3, pdfs: 1 }]);

      await expectRejected(
        database,
        admin,
        "update public.work_orders set description = description where id = $1::uuid returning id",
        [primary.workOrderId],
        "42501",
      );
      await expectRejected(
        database,
        admin,
        `insert into public.work_order_items (
           work_order_id, product_id, quantity, added_by_user_id
         ) values ($1::uuid, $2::uuid, 1, $3::uuid)`,
        [primary.workOrderId, productD.productId, admin.profileId],
        "42501",
      );
      await expectRejected(
        database,
        admin,
        "update public.inventory_balances set quantity = quantity where product_id = $1::uuid",
        [productA.productId],
        "42501",
      );
      await expectRejected(
        database,
        admin,
        `insert into public.work_order_pdfs (
           work_order_id, storage_reference, generated_by_user_id
         ) values ($1::uuid, $2::text, $3::uuid)`,
        [primary.workOrderId, `final/${primary.workOrderId}/${randomUUID()}.pdf`, admin.profileId],
        "42501",
      );

      const auditSequence = await database.query<{
        action_type: string;
        actor_user_id: string;
        created_at: string;
        entity_id: string;
        id: string;
        summary: string;
      }>(
        `select id, action_type, entity_id, actor_user_id, summary,
                created_at::text as created_at
         from public.audit_logs
         where (entity_id = $1::uuid and action_type = 'project.created')
            or (entity_id = $2::uuid and action_type in (
              'work_order.created', 'work_order.updated', 'work_order.finished'
            ))
            or (entity_id = $1::uuid and action_type = 'project.completed')
         order by created_at, id`,
        [projectId, primary.workOrderId],
      );
      expect(auditSequence.rows.map((row) => row.action_type).sort()).toEqual([
        "project.completed", "project.created", "work_order.created",
        "work_order.finished", "work_order.updated",
      ]);
      expect(new Map(auditSequence.rows.map((row) => [
        row.action_type,
        row.actor_user_id,
      ]))).toEqual(new Map([
        ["project.created", projectActor.profileId],
        ["work_order.created", creator.profileId],
        ["work_order.updated", editor.profileId],
        ["work_order.finished", finisher.profileId],
        ["project.completed", finisher.profileId],
      ]));
      const lifecycleTimes = (await database.query<{
        created_before_updated: boolean;
        finish_matches_project_completion: boolean;
        updated_before_finished: boolean;
      }>(
        `select
           work_order.created_at < $2::timestamptz as created_before_updated,
           $2::timestamptz < work_order.finished_at as updated_before_finished,
           work_order.finished_at = project.completed_at
             as finish_matches_project_completion
         from public.work_orders as work_order
         join public.projects as project on project.id = work_order.project_id
         where work_order.id = $1::uuid`,
        [primary.workOrderId, primarySaved.updated_at],
      )).rows[0];
      expect(lifecycleTimes).toEqual({
        created_before_updated: true,
        finish_matches_project_completion: true,
        updated_before_finished: true,
      });

      const archiveRows = await queryAs<Record<string, unknown>>(
        database,
        viewer,
        `select * from public.list_audit_log_page(
           100, null, null, null, null, null,
           'work_order', null, $1::text
         )`,
        [primary.workOrderNumber],
      );
      expect(archiveRows).toHaveLength(3);
      expect(Object.keys(archiveRows[0]!).sort()).toEqual([
        "action_type", "actor_full_name", "actor_user_id", "audit_log_id",
        "created_at", "entity_id", "entity_type", "summary",
      ]);
      const finishedAudit = auditSequence.rows.find(
        (row) => row.action_type === "work_order.finished",
      );
      const projectCompletedAudit = auditSequence.rows.find(
        (row) => row.action_type === "project.completed",
      );
      expect(finishedAudit).toBeDefined();
      expect(projectCompletedAudit).toBeDefined();
      expect((await queryAs<Record<string, unknown>>(
        database,
        viewer,
        "select * from public.get_audit_log_detail($1::uuid)",
        [finishedAudit!.id],
      ))[0]).toMatchObject({
        detail_authorized: true,
        target_view_authorized: true,
        context_kind: "work_order",
        context_id: primary.workOrderId,
      });
      expect((await queryAs<Record<string, unknown>>(
        database,
        viewer,
        "select * from public.get_audit_log_detail($1::uuid)",
        [projectCompletedAudit!.id],
      ))[0]).toMatchObject({
        detail_authorized: true,
        target_view_authorized: true,
        context_kind: "project",
        context_id: projectId,
      });

      expect((await database.query(
        `select
           exists (
             select 1 from public.work_orders as work_order
             where work_order.id = $1::uuid
               and work_order.project_id = $2::uuid
           ) as work_order_project,
           not exists (
             select 1 from public.work_order_items as item
             left join public.products as product on product.id = item.product_id
             where item.work_order_id = $1::uuid and product.id is null
           ) as item_products,
           not exists (
             select 1 from public.inventory_movements as movement
             where movement.source_type = 'work_order'
               and movement.source_id = $1::uuid
               and (movement.project_id <> $2::uuid or movement.actor_user_id <> $3::uuid)
           ) as movement_context,
           exists (
             select 1 from public.work_order_pdfs as pdf
             where pdf.work_order_id = $1::uuid
           ) as pdf_reference,
           exists (
             select 1 from public.audit_logs as audit
             where audit.entity_id = $1::uuid
               and audit.action_type = 'work_order.finished'
           ) as audit_reference`,
        [primary.workOrderId, projectId, finisher.profileId],
      )).rows).toEqual([{
        audit_reference: true,
        item_products: true,
        movement_context: true,
        pdf_reference: true,
        work_order_project: true,
      }]);
    });
  });
}
