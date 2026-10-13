import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { expect, it } from "vitest";

import type {
  SecurityActor,
  SecurityFixtureHarness,
} from "./security-fixtures";

interface AuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown>;
  before_data: Record<string, unknown> | null;
  entity_id: string;
  entity_type: string;
  id: string;
  summary: string;
}

interface ProcurementRow {
  created_by_user_id: string;
  delivered_quantity: string;
  id: string;
  product_id: string | null;
  requested_name: string;
  requested_quantity: string;
  resolved_at: Date | null;
  resolved_by_user_id: string | null;
  status: "active" | "partly_delivered" | "resolved";
  supplier_id: string;
  updated_at: Date;
  updated_by_user_id: string;
}

interface CountSnapshot {
  balances: number;
  movements: number;
  products: number;
}

async function setAuthenticatedActor(
  database: PoolClient,
  actor: Pick<SecurityActor, "authUserId">,
): Promise<void> {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor.authUserId],
  );
  await database.query("set local role authenticated");
}

async function expectActorFailure(
  database: PoolClient,
  actor: Pick<SecurityActor, "authUserId">,
  savepoint: string,
  query: string,
  parameters: readonly unknown[],
  code: string,
): Promise<void> {
  await setAuthenticatedActor(database, actor);
  await database.query(`savepoint ${savepoint}`);
  await expect(database.query(query, [...parameters])).rejects.toMatchObject({ code });
  await database.query(`rollback to savepoint ${savepoint}`);
  await database.query("reset role");
}

async function readCounts(database: PoolClient): Promise<CountSnapshot> {
  const result = await database.query<CountSnapshot>(
    `select
       (select count(*)::integer from public.products) as products,
       (select count(*)::integer from public.inventory_balances) as balances,
       (select count(*)::integer from public.inventory_movements) as movements`,
  );
  const row = result.rows[0];
  if (!row) throw new Error("Task 150 count snapshot is unavailable");
  return row;
}

async function readRequest(
  database: PoolClient,
  requestId: string,
): Promise<ProcurementRow> {
  const result = await database.query<ProcurementRow>(
    `select id, product_id, requested_name, supplier_id,
            requested_quantity, delivered_quantity, status,
            created_by_user_id, updated_at, updated_by_user_id,
            resolved_at, resolved_by_user_id
     from public.procurement_requests
     where id = $1::uuid`,
    [requestId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Task 150 Procurement request is unavailable");
  return row;
}

export function registerProcurementProductInventoryE2eTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  it("validates a historical supplied-request Nabavka to Product, Supplier, Inventory, and Archive lifecycle", async () => {
    const fixture = requireHarness();
    const admin = fixture.actors.admin;
    const worker = await fixture.createTemporaryProfile(
      "task-150-worker",
      undefined,
      admin.profileId,
    );
    const supplierId = randomUUID();
    const requestedName = `Task 150 requested component ${randomUUID()}`;
    const productName = `Task 150 received component ${randomUUID()}`;
    const catalogNumber = `T150-${randomUUID().slice(0, 8)}`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select $1::uuid, definition.id, $2::uuid
         from public.permission_definitions as definition
         where definition.key = 'procurement.create'`,
        [worker.profileId, admin.profileId],
      );
      await database.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values ($1::uuid, $2::text, 'BiH', $3::uuid, $3::uuid)`,
        [supplierId, `Task 150 Supplier ${supplierId}`, admin.profileId],
      );

      await setAuthenticatedActor(database, worker);
      const workerAuthority = await database.query<{
        procurement_create: boolean;
        procurement_view: boolean;
        inventory_view: boolean;
        suppliers_view: boolean;
      }>(
        `select
           public.has_permission('procurement.create') as procurement_create,
           public.has_permission('procurement.view') as procurement_view,
           public.has_permission('inventory.view') as inventory_view,
           public.has_permission('suppliers.view') as suppliers_view`,
      );
      expect(workerAuthority.rows).toEqual([{
        procurement_create: true,
        procurement_view: false,
        inventory_view: false,
        suppliers_view: false,
      }]);
      const directlyVisibleSuppliers = await database.query<{ count: string }>(
        `select count(*)::text as count
         from public.suppliers where id = $1::uuid`,
        [supplierId],
      );
      expect(directlyVisibleSuppliers.rows).toEqual([{ count: "0" }]);
      await database.query("reset role");

      const beforeRequest = await readCounts(database);
      await setAuthenticatedActor(database, worker);
      const createdRequest = await database.query<{ request_id: string }>(
        `select public.create_procurement_request_for_new_component(
           $1::text, $2::bigint
         ) as request_id`,
        [`  ${requestedName}  `, 20],
      );
      await database.query("reset role");
      const requestId = createdRequest.rows[0]?.request_id;
      if (!requestId) throw new Error("Task 150 request creation returned no ID");
      await database.query(
        `update public.procurement_requests
         set supplier_id = $2::uuid
         where id = $1::uuid`,
        [requestId, supplierId],
      );

      expect(await readRequest(database, requestId)).toMatchObject({
        created_by_user_id: worker.profileId,
        delivered_quantity: "0",
        product_id: null,
        requested_name: requestedName,
        requested_quantity: "20",
        resolved_at: null,
        resolved_by_user_id: null,
        status: "active",
        supplier_id: supplierId,
        updated_by_user_id: worker.profileId,
      });
      expect(await readCounts(database)).toEqual(beforeRequest);

      await expectActorFailure(
        database,
        fixture.actors.unpermitted,
        "task150_unpermitted_create",
        `select public.create_procurement_request_for_new_component(
           'Denied request', 1
         )`,
        [],
        "42501",
      );
      await expectActorFailure(
        database,
        worker,
        "task150_direct_request_insert",
        `insert into public.procurement_requests (
           requested_name, supplier_id, requested_quantity,
           created_by_user_id, updated_by_user_id
         ) values ('Bypass request', $1::uuid, 1, $2::uuid, $2::uuid)`,
        [supplierId, worker.profileId],
        "42501",
      );
      await expectActorFailure(
        database,
        fixture.actors.brandManager,
        "task150_inventory_cannot_procure",
        `select public.create_procurement_request_for_new_component(
           'Inventory permission bypass', 1
         )`,
        [],
        "42501",
      );
      await expectActorFailure(
        database,
        worker,
        "task150_users_isolation",
        "select * from public.list_users_admin()",
        [],
        "42501",
      );

      await setAuthenticatedActor(database, admin);
      const reviewed = await database.query<Record<string, unknown>>(
        `select * from public.search_procurement_requests(
           $1::text, 'active'::text, $2::uuid
         )`,
        [requestedName, supplierId],
      );
      await database.query("reset role");
      expect(reviewed.rows).toHaveLength(1);
      expect(Object.keys(reviewed.rows[0] ?? {}).sort()).toEqual([
        "created_at",
        "created_by_full_name",
        "created_by_user_id",
        "delivered_quantity",
        "product_id",
        "product_serial_number",
        "request_id",
        "requested_name",
        "requested_quantity",
        "status",
        "supplier_id",
        "supplier_name",
      ]);
      expect(reviewed.rows[0]).toMatchObject({
        created_by_user_id: worker.profileId,
        delivered_quantity: "0",
        product_id: null,
        product_serial_number: null,
        request_id: requestId,
        requested_name: requestedName,
        requested_quantity: "20",
        status: "active",
        supplier_id: supplierId,
      });

      await expectActorFailure(
        database,
        worker,
        "task150_worker_product_creation",
        `select * from public.create_product_from_procurement_request(
           $1::uuid, 'Denied Product', 'Components', null, null
         )`,
        [requestId],
        "42501",
      );
      await expectActorFailure(
        database,
        fixture.actors.supplierViewer,
        "task150_supplier_view_product_creation",
        `select * from public.create_product_from_procurement_request(
           $1::uuid, 'Denied Product', 'Components', null, null
         )`,
        [requestId],
        "42501",
      );
      await expectActorFailure(
        database,
        worker,
        "task150_worker_direct_product",
        "select * from public.create_product('Denied Product', 'Components', null)",
        [],
        "42501",
      );

      await setAuthenticatedActor(database, admin);
      const createdProduct = await database.query<{
        product_id: string;
        serial_number: string;
      }>(
        `select * from public.create_product_from_procurement_request(
           $1::uuid, $2::text, 'Components'::text, null, $3::text
         )`,
        [requestId, `  ${productName}  `, `  ${catalogNumber}  `],
      );
      await database.query("reset role");
      const product = createdProduct.rows[0];
      if (!product) throw new Error("Task 150 Product creation returned no row");
      expect(product.serial_number).toMatch(/^[0-9]{7}$/);

      expect(await readCounts(database)).toEqual({
        products: beforeRequest.products + 1,
        balances: beforeRequest.balances + 1,
        movements: beforeRequest.movements,
      });
      const productState = await database.query<{
        category: string;
        is_active: boolean;
        name: string;
        product_kind: string;
        serial_count: number;
      }>(
        `select product.name, product.category, product.product_kind,
                product.is_active,
                (select count(*)::integer from public.products as duplicate
                 where duplicate.serial_number = product.serial_number) as serial_count
         from public.products as product where product.id = $1::uuid`,
        [product.product_id],
      );
      expect(productState.rows).toEqual([{
        category: "Components",
        is_active: true,
        name: productName,
        product_kind: "component",
        serial_count: 1,
      }]);

      const relation = await database.query<{
        catalog_number: string;
        created_by_user_id: string;
        id: string;
        is_active: boolean;
        product_id: string;
        supplier_id: string;
      }>(
        `select id, product_id, supplier_id, catalog_number, is_active,
                created_by_user_id
         from public.product_suppliers
         where product_id = $1::uuid`,
        [product.product_id],
      );
      expect(relation.rows).toEqual([{
        catalog_number: catalogNumber,
        created_by_user_id: admin.profileId,
        id: expect.any(String),
        is_active: true,
        product_id: product.product_id,
        supplier_id: supplierId,
      }]);
      expect((await database.query<{ quantity: string }>(
        "select quantity from public.inventory_balances where product_id = $1::uuid",
        [product.product_id],
      )).rows).toEqual([{ quantity: "0" }]);
      expect(await readRequest(database, requestId)).toMatchObject({
        created_by_user_id: worker.profileId,
        delivered_quantity: "0",
        product_id: product.product_id,
        requested_name: requestedName,
        requested_quantity: "20",
        status: "active",
        supplier_id: supplierId,
        updated_by_user_id: admin.profileId,
      });

      await expectActorFailure(
        database,
        worker,
        "task150_worker_supplier_link",
        "select public.create_product_supplier($1::uuid, $2::uuid, 'FORGED')",
        [product.product_id, supplierId],
        "42501",
      );
      const retryCounts = await database.query<{ products: number; relations: number }>(
        `select
           (select count(*)::integer from public.products
            where id = $1::uuid) as products,
           (select count(*)::integer from public.product_suppliers
            where product_id = $1::uuid) as relations`,
        [product.product_id],
      );
      await expectActorFailure(
        database,
        admin,
        "task150_duplicate_product_retry",
        `select * from public.create_product_from_procurement_request(
           $1::uuid, 'Retry Product', 'Components', null, null
         )`,
        [requestId],
        "PRQ05",
      );
      expect((await database.query<{ products: number; relations: number }>(
        `select
           (select count(*)::integer from public.products
            where id = $1::uuid) as products,
           (select count(*)::integer from public.product_suppliers
            where product_id = $1::uuid) as relations`,
        [product.product_id],
      )).rows).toEqual(retryCounts.rows);

      await setAuthenticatedActor(database, admin);
      const adjustment = await database.query<{
        movement_id: string;
        quantity_after: string;
        quantity_before: string;
      }>(
        `select * from public.manual_adjust_inventory(
           $1::uuid, 'add'::text, 12::bigint,
           'Task 150 received stock'::text, $2::uuid
         )`,
        [product.product_id, relation.rows[0]?.id],
      );
      await database.query("reset role");
      expect(adjustment.rows).toEqual([{
        movement_id: expect.any(String),
        quantity_after: "12",
        quantity_before: "0",
      }]);
      expect(await readRequest(database, requestId)).toMatchObject({
        delivered_quantity: "0",
        status: "active",
      });

      await expectActorFailure(
        database,
        worker,
        "task150_worker_inventory_adjustment",
        `select * from public.manual_adjust_inventory(
           $1::uuid, 'add'::text, 1::bigint, 'Denied receipt'::text, $2::uuid
         )`,
        [product.product_id, relation.rows[0]?.id],
        "42501",
      );

      await setAuthenticatedActor(database, admin);
      await database.query(
        "select public.update_procurement_delivered_quantity($1::uuid, 12::bigint)",
        [requestId],
      );
      await database.query("reset role");
      expect(await readRequest(database, requestId)).toMatchObject({
        delivered_quantity: "12",
        status: "partly_delivered",
      });
      expect((await database.query<{ quantity: string }>(
        "select quantity from public.inventory_balances where product_id = $1::uuid",
        [product.product_id],
      )).rows).toEqual([{ quantity: "12" }]);

      await setAuthenticatedActor(database, admin);
      await database.query(
        "select public.update_procurement_delivered_quantity($1::uuid, 20::bigint)",
        [requestId],
      );
      await database.query("reset role");
      const fullDelivery = await readRequest(database, requestId);
      expect(fullDelivery).toMatchObject({
        delivered_quantity: "20",
        resolved_at: null,
        resolved_by_user_id: null,
        status: "partly_delivered",
      });
      const deliveryAuditsBeforeNoOp = await database.query<{ count: number }>(
        `select count(*)::integer as count from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'procurement.delivery_updated'`,
        [requestId],
      );
      await setAuthenticatedActor(database, admin);
      await database.query(
        "select public.update_procurement_delivered_quantity($1::uuid, 20::bigint)",
        [requestId],
      );
      await database.query("reset role");
      expect(await readRequest(database, requestId)).toEqual(fullDelivery);
      expect((await database.query<{ count: number }>(
        `select count(*)::integer as count from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'procurement.delivery_updated'`,
        [requestId],
      )).rows).toEqual(deliveryAuditsBeforeNoOp.rows);

      await setAuthenticatedActor(database, admin);
      await database.query(
        "select public.resolve_procurement_request($1::uuid)",
        [requestId],
      );
      await database.query("reset role");
      expect(await readRequest(database, requestId)).toMatchObject({
        delivered_quantity: "20",
        product_id: product.product_id,
        resolved_at: expect.any(Date),
        resolved_by_user_id: admin.profileId,
        status: "resolved",
        updated_by_user_id: admin.profileId,
      });
      await expectActorFailure(
        database,
        admin,
        "task150_duplicate_resolution",
        "select public.resolve_procurement_request($1::uuid)",
        [requestId],
        "PRQ02",
      );

      await setAuthenticatedActor(database, admin);
      const history = await database.query<Record<string, unknown>>(
        "select * from public.get_inventory_movements_for_product($1::uuid)",
        [product.product_id],
      );
      await database.query("reset role");
      expect(history.rows).toHaveLength(1);
      expect(history.rows[0]).toMatchObject({
        actor_user_id: admin.profileId,
        movement_id: adjustment.rows[0]?.movement_id,
        movement_type: "manual_add",
        project_id: null,
        quantity_after: "12",
        quantity_before: "0",
        quantity_delta: "12",
        reason: "Task 150 received stock",
        reversal_of_movement_id: null,
        source_id: null,
        source_type: "manual_adjustment",
      });

      const audits = await database.query<AuditRow>(
        `select id, action_type, actor_user_id, entity_type, entity_id,
                summary, before_data, after_data
         from public.audit_logs
         where entity_id = any($1::uuid[])
         order by created_at, id`,
        [[requestId, product.product_id, relation.rows[0]?.id]],
      );
      expect(audits.rows).toHaveLength(8);
      expect(audits.rows.map((row) => row.action_type)).toEqual(
        expect.arrayContaining([
          "procurement.created",
          "product.created",
          "product_supplier.created",
          "procurement.product_linked",
          "inventory.manual_adjusted",
          "procurement.resolved",
        ]),
      );
      expect(audits.rows.filter((row) =>
        row.action_type === "procurement.delivery_updated"
      )).toHaveLength(2);
      expect(audits.rows.find((row) => row.action_type === "procurement.created")?.actor_user_id)
        .toBe(worker.profileId);
      expect(audits.rows.filter((row) => row.action_type !== "procurement.created")
        .every((row) => row.actor_user_id === admin.profileId)).toBe(true);

      await setAuthenticatedActor(database, admin);
      const archiveRows = await database.query<Record<string, unknown>>(
        `select * from public.list_audit_log_page(
           100, null, null, null, null, null, null, null, null
         )`,
      );
      await database.query("reset role");
      const flowAuditIds = new Set(audits.rows.map((row) => row.id));
      const flowArchiveRows = archiveRows.rows.filter((row) =>
        flowAuditIds.has(String(row.audit_log_id))
      );
      expect(flowArchiveRows).toHaveLength(8);
      for (const row of flowArchiveRows) {
        expect(Object.keys(row).sort()).toEqual([
          "action_type",
          "actor_full_name",
          "actor_user_id",
          "audit_log_id",
          "created_at",
          "entity_id",
          "entity_type",
          "summary",
        ]);
      }

      for (const audit of audits.rows) {
        await setAuthenticatedActor(database, admin);
        const detail = await database.query<Record<string, unknown>>(
          "select * from public.get_audit_log_detail($1::uuid)",
          [audit.id],
        );
        await database.query("reset role");
        expect(detail.rows[0]).toMatchObject({
          audit_log_id: audit.id,
          detail_authorized: true,
        });
        if (audit.entity_type === "product" || audit.entity_type === "product_inventory") {
          expect(detail.rows[0]).toMatchObject({
            context_id: product.product_id,
            context_kind: "product",
            target_view_authorized: true,
          });
        } else {
          expect(detail.rows[0]).toMatchObject({
            context_id: null,
            context_kind: null,
            target_view_authorized: false,
          });
        }
      }

      const integrity = await database.query<{
        balance_quantity: string;
        movement_count: number;
        relation_count: number;
        request_product_id: string;
        request_supplier_id: string;
      }>(
        `select request.product_id as request_product_id,
                request.supplier_id as request_supplier_id,
                balance.quantity as balance_quantity,
                (select count(*)::integer from public.product_suppliers as link
                 where link.product_id = product.id
                   and link.supplier_id = request.supplier_id) as relation_count,
                (select count(*)::integer from public.inventory_movements as movement
                 where movement.product_id = product.id) as movement_count
         from public.procurement_requests as request
         join public.products as product on product.id = request.product_id
         join public.inventory_balances as balance on balance.product_id = product.id
         where request.id = $1::uuid`,
        [requestId],
      );
      expect(integrity.rows).toEqual([{
        balance_quantity: "12",
        movement_count: 1,
        relation_count: 1,
        request_product_id: product.product_id,
        request_supplier_id: supplierId,
      }]);
    });
  });

  it("rolls back failed Product/Supplier and Inventory boundaries without duplicate retry effects", async () => {
    const fixture = requireHarness();
    const admin = fixture.actors.admin;
    const supplierId = randomUUID();
    const failedRequestId = randomUUID();
    const successfulRequestId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values ($1::uuid, 'Task 150 rollback Supplier', 'BiH', $2::uuid, $2::uuid)`,
        [supplierId, admin.profileId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, requested_name, supplier_id, requested_quantity,
           created_by_user_id, updated_by_user_id
         ) values
           ($1::uuid, 'Task 150 failed Product', $3::uuid, 5, $4::uuid, $4::uuid),
           ($2::uuid, 'Task 150 successful Product', $3::uuid, 5, $4::uuid, $4::uuid)`,
        [failedRequestId, successfulRequestId, supplierId, admin.profileId],
      );

      await database.query(
        `create function public.test_task150_reject_product_supplier()
         returns trigger language plpgsql set search_path = ''
         as $test_function$
         begin
           raise exception 'Task 150 forced ProductSupplier failure'
             using errcode = 'T1501';
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_task150_reject_product_supplier
         before insert on public.product_suppliers
         for each row execute function public.test_task150_reject_product_supplier()`,
      );
      const beforeFailedProduct = await readCounts(database);
      await expectActorFailure(
        database,
        admin,
        "task150_supplier_atomic_failure",
        `select * from public.create_product_from_procurement_request(
           $1::uuid, 'Must Roll Back', 'Components', null, 'T150-FAIL'
         )`,
        [failedRequestId],
        "T1501",
      );
      expect(await readCounts(database)).toEqual(beforeFailedProduct);
      expect((await readRequest(database, failedRequestId)).product_id).toBeNull();
      expect((await database.query<{ count: number }>(
        `select count(*)::integer as count from public.audit_logs
         where summary like '%Must Roll Back%'`,
      )).rows).toEqual([{ count: 0 }]);
      await database.query(
        "drop trigger test_task150_reject_product_supplier on public.product_suppliers",
      );
      await database.query("drop function public.test_task150_reject_product_supplier()");

      await setAuthenticatedActor(database, admin);
      const productResult = await database.query<{ product_id: string }>(
        `select product_id from public.create_product_from_procurement_request(
           $1::uuid, 'Task 150 stock rollback Product', 'Components', null,
           'TASK150-ROLLBACK'
         )`,
        [successfulRequestId],
      );
      await database.query("reset role");
      const productId = productResult.rows[0]?.product_id;
      if (!productId) throw new Error("Task 150 rollback Product is unavailable");
      const productSupplierId = (await database.query<{ id: string }>(
        `select relationship.id
         from public.product_suppliers as relationship
         where relationship.product_id = $1::uuid
           and relationship.is_active
         order by relationship.created_at, relationship.id
         limit 1`,
        [productId],
      )).rows[0]?.id;
      if (!productSupplierId) {
        throw new Error("Task 150 rollback Product supplier source is unavailable");
      }

      await database.query(
        `create function public.test_task150_reject_inventory_audit()
         returns trigger language plpgsql set search_path = ''
         as $test_function$
         begin
           if new.action_type = 'inventory.manual_adjusted' then
             raise exception 'Task 150 forced Inventory audit failure'
               using errcode = 'T1502';
           end if;
           return new;
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_task150_reject_inventory_audit
         before insert on public.audit_logs
         for each row execute function public.test_task150_reject_inventory_audit()`,
      );
      await expectActorFailure(
        database,
        admin,
        "task150_inventory_atomic_failure",
        `select * from public.manual_adjust_inventory(
           $1::uuid, 'add', 12, 'Must roll back stock', $2::uuid
         )`,
        [productId, productSupplierId],
        "T1502",
      );
      expect((await database.query<{ quantity: string }>(
        "select quantity from public.inventory_balances where product_id = $1::uuid",
        [productId],
      )).rows).toEqual([{ quantity: "0" }]);
      expect((await database.query<{ count: number }>(
        "select count(*)::integer as count from public.inventory_movements where product_id = $1::uuid",
        [productId],
      )).rows).toEqual([{ count: 0 }]);
      expect(await readRequest(database, successfulRequestId)).toMatchObject({
        delivered_quantity: "0",
        product_id: productId,
        status: "active",
      });
      await database.query(
        "drop trigger test_task150_reject_inventory_audit on public.audit_logs",
      );
      await database.query("drop function public.test_task150_reject_inventory_audit()");

      await setAuthenticatedActor(database, admin);
      await database.query(
        "select public.update_procurement_delivered_quantity($1::uuid, 5::bigint)",
        [successfulRequestId],
      );
      await database.query("reset role");
      const beforeDeliveryRetry = await readRequest(database, successfulRequestId);
      const auditBeforeRetry = await database.query<{ count: number }>(
        `select count(*)::integer as count from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'procurement.delivery_updated'`,
        [successfulRequestId],
      );
      await setAuthenticatedActor(database, admin);
      await database.query(
        "select public.update_procurement_delivered_quantity($1::uuid, 5::bigint)",
        [successfulRequestId],
      );
      await database.query("reset role");
      expect(await readRequest(database, successfulRequestId)).toEqual(beforeDeliveryRetry);
      expect((await database.query<{ count: number }>(
        `select count(*)::integer as count from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'procurement.delivery_updated'`,
        [successfulRequestId],
      )).rows).toEqual(auditBeforeRetry.rows);
    });
  });
}
