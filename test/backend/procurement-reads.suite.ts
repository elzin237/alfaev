import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityFixtureHarness } from "./security-fixtures";

interface ProcurementRequestRow {
  created_at: Date;
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

export function registerProcurementReadsTests(requireHarness: () => SecurityFixtureHarness): void {
  it("enforces the canonical ProcurementRequest schema, lifecycle, snapshot, and historical foreign keys", async () => {
    const fixture = requireHarness();
    const actorId = fixture.actors.admin.profileId;
    const supplierId = randomUUID();
    const productId = randomUUID();
    const requestIds = Array.from({ length: 7 }, () => randomUUID());

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const serial = await database.query<{ serial_number: string }>(
        `select public.allocate_product_serial_number() as serial_number`,
      );
      await database.query(
        `insert into public.suppliers (
           id, name, catalog_number, country, created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'PROC-READ-CAT', 'BiH', $3, $3)`,
        [supplierId, `Procurement Supplier ${supplierId}`, actorId],
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'Procurement Product', 'Component', 'component', $3, $3)`,
        [productId, serial.rows[0]?.serial_number, actorId],
      );
      const inventoryBefore = await database.query<{
        balances: number;
        movements: number;
      }>(
        `select
           (select count(*)::integer from public.inventory_balances)
             as balances,
           (select count(*)::integer from public.inventory_movements)
             as movements`,
      );

      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'Default Active Snapshot', $3, 5, $4, $4)`,
        [requestIds[0], productId, supplierId, actorId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           created_by_user_id, updated_by_user_id
         ) values ($1, null, 'Brand New Snapshot', $2, 3, $3, $3)`,
        [requestIds[1], supplierId, actorId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_by_user_id, updated_by_user_id
         ) values
           ($1, $3, 'Partial Snapshot', $4, 5, 2, 'partly_delivered', $5, $5),
           ($2, $3, 'Fully Delivered Unresolved Snapshot', $4, 5, 5,
            'partly_delivered', $5, $5)`,
        [requestIds[2], requestIds[3], productId, supplierId, actorId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_by_user_id, updated_by_user_id,
           resolved_at, resolved_by_user_id
         ) values
           ($1, $4, 'Resolved Zero Snapshot', $5, 5, 0, 'resolved', $6, $6,
            '2026-09-15T08:00:00Z', $6),
           ($2, $4, 'Resolved Partial Snapshot', $5, 5, 2, 'resolved', $6, $6,
            '2026-09-15T08:01:00Z', $6),
           ($3, $4, 'Resolved Full Snapshot', $5, 5, 5, 'resolved', $6, $6,
            '2026-09-15T08:02:00Z', $6)`,
        [requestIds[4], requestIds[5], requestIds[6], productId, supplierId, actorId],
      );

      const rows = await database.query<ProcurementRequestRow>(
        `select * from public.procurement_requests
         where id = any($1::uuid[]) order by id`,
        [requestIds],
      );
      expect(rows.rows).toHaveLength(7);
      expect(rows.rows.find((row) => row.id === requestIds[0])).toMatchObject({
        delivered_quantity: "0",
        product_id: productId,
        requested_name: "Default Active Snapshot",
        requested_quantity: "5",
        resolved_at: null,
        resolved_by_user_id: null,
        status: "active",
        supplier_id: supplierId,
      });
      expect(rows.rows.find((row) => row.id === requestIds[1])?.product_id)
        .toBeNull();
      expect(rows.rows.find((row) => row.id === requestIds[3])).toMatchObject({
        delivered_quantity: "5",
        requested_quantity: "5",
        status: "partly_delivered",
      });
      expect(rows.rows.filter((row) => row.status === "resolved")
        .map((row) => row.delivered_quantity).sort()).toEqual(["0", "2", "5"]);

      const invalidChecks: ReadonlyArray<{
        createdBy?: string;
        delivered: number;
        expectedCode: string;
        label: string;
        name: string;
        product?: string | null;
        requested: number;
        resolvedAt?: string | null;
        resolvedBy?: string | null;
        status: string;
        supplier?: string;
        updatedBy?: string;
      }> = [
        { label: "empty_name", name: "", requested: 1, delivered: 0, status: "active", expectedCode: "23514" },
        { label: "blank_name", name: "   ", requested: 1, delivered: 0, status: "active", expectedCode: "23514" },
        { label: "untrimmed_name", name: " Snapshot ", requested: 1, delivered: 0, status: "active", expectedCode: "23514" },
        { label: "zero_requested", name: "Snapshot", requested: 0, delivered: 0, status: "active", expectedCode: "23514" },
        { label: "negative_requested", name: "Snapshot", requested: -1, delivered: 0, status: "active", expectedCode: "23514" },
        { label: "negative_delivered", name: "Snapshot", requested: 1, delivered: -1, status: "partly_delivered", expectedCode: "23514" },
        { label: "excess_delivered", name: "Snapshot", requested: 1, delivered: 2, status: "partly_delivered", expectedCode: "23514" },
        { label: "invalid_status", name: "Snapshot", requested: 1, delivered: 0, status: "pending", expectedCode: "23514" },
        { label: "active_delivered", name: "Snapshot", requested: 2, delivered: 1, status: "active", expectedCode: "23514" },
        { label: "partial_zero", name: "Snapshot", requested: 2, delivered: 0, status: "partly_delivered", expectedCode: "23514" },
        { label: "resolved_without_at", name: "Snapshot", requested: 2, delivered: 0, status: "resolved", resolvedBy: actorId, expectedCode: "23514" },
        { label: "resolved_without_actor", name: "Snapshot", requested: 2, delivered: 0, status: "resolved", resolvedAt: "2026-09-15T08:00:00Z", expectedCode: "23514" },
        { label: "active_with_at", name: "Snapshot", requested: 2, delivered: 0, status: "active", resolvedAt: "2026-09-15T08:00:00Z", expectedCode: "23514" },
        { label: "active_with_actor", name: "Snapshot", requested: 2, delivered: 0, status: "active", resolvedBy: actorId, expectedCode: "23514" },
        { label: "partial_with_at", name: "Snapshot", requested: 2, delivered: 1, status: "partly_delivered", resolvedAt: "2026-09-15T08:00:00Z", expectedCode: "23514" },
        { label: "partial_with_actor", name: "Snapshot", requested: 2, delivered: 1, status: "partly_delivered", resolvedBy: actorId, expectedCode: "23514" },
        { label: "missing_supplier", name: "Snapshot", requested: 1, delivered: 0, status: "active", supplier: randomUUID(), expectedCode: "23503" },
        { label: "missing_product", name: "Snapshot", requested: 1, delivered: 0, status: "active", product: randomUUID(), expectedCode: "23503" },
        { label: "missing_creator", name: "Snapshot", requested: 1, delivered: 0, status: "active", createdBy: randomUUID(), expectedCode: "23503" },
        { label: "missing_updater", name: "Snapshot", requested: 1, delivered: 0, status: "active", updatedBy: randomUUID(), expectedCode: "23503" },
        { label: "missing_resolver", name: "Snapshot", requested: 1, delivered: 0, status: "resolved", resolvedAt: "2026-09-15T08:00:00Z", resolvedBy: randomUUID(), expectedCode: "23503" },
      ];

      for (const invalid of invalidChecks) {
        await database.query(`savepoint procurement_${invalid.label}`);
        await expect(database.query(
          `insert into public.procurement_requests (
             product_id, requested_name, supplier_id, requested_quantity,
             delivered_quantity, status, created_by_user_id,
             updated_by_user_id, resolved_at, resolved_by_user_id
           ) values (
             $1::uuid, $2::text, $3::uuid, $4::bigint, $5::bigint, $6::text,
             $7::uuid, $8::uuid, $9::timestamptz, $10::uuid
           )`,
          [
            invalid.product === undefined ? productId : invalid.product,
            invalid.name,
            invalid.supplier ?? supplierId,
            invalid.requested,
            invalid.delivered,
            invalid.status,
            invalid.createdBy ?? actorId,
            invalid.updatedBy ?? actorId,
            invalid.resolvedAt ?? null,
            invalid.resolvedBy ?? null,
          ],
        )).rejects.toMatchObject({ code: invalid.expectedCode });
        await database.query(`rollback to savepoint procurement_${invalid.label}`);
      }

      await database.query("savepoint immutable_procurement_snapshot");
      await expect(database.query(
        `update public.procurement_requests
         set requested_name = 'Changed Snapshot'
         where id = $1`,
        [requestIds[0]],
      )).rejects.toMatchObject({ code: "PRQ01" });
      await database.query("rollback to savepoint immutable_procurement_snapshot");

      await database.query(
        `update public.procurement_requests
         set product_id = $1, updated_at = pg_catalog.clock_timestamp(),
             updated_by_user_id = $2
         where id = $3`,
        [productId, actorId, requestIds[1]],
      );
      expect((await database.query<{ product_id: string }>(
        `select product_id from public.procurement_requests where id = $1`,
        [requestIds[1]],
      )).rows).toEqual([{ product_id: productId }]);

      await database.query("savepoint immutable_resolved_procurement");
      await expect(database.query(
        `update public.procurement_requests
         set status = 'active', resolved_at = null,
             resolved_by_user_id = null
         where id = $1`,
        [requestIds[4]],
      )).rejects.toMatchObject({ code: "PRQ02" });
      await database.query("rollback to savepoint immutable_resolved_procurement");

      await database.query(
        `update public.products
         set is_active = false,
             archived_at = pg_catalog.clock_timestamp(),
             archived_by_user_id = $1,
             updated_at = pg_catalog.clock_timestamp(),
             updated_by_user_id = $1
         where id = $2`,
        [actorId, productId],
      );
      await database.query(
        `update public.suppliers
         set is_active = false,
             archived_at = pg_catalog.clock_timestamp(),
             archived_by_user_id = $1,
             updated_at = pg_catalog.clock_timestamp(),
             updated_by_user_id = $1
         where id = $2`,
        [actorId, supplierId],
      );
      const historical = await database.query<{
        product_id: string;
        supplier_id: string;
      }>(
        `select product_id, supplier_id
         from public.procurement_requests where id = $1`,
        [requestIds[0]],
      );
      expect(historical.rows).toEqual([{
        product_id: productId,
        supplier_id: supplierId,
      }]);

      const inventoryAfter = await database.query<{
        balances: number;
        movements: number;
      }>(
        `select
           (select count(*)::integer from public.inventory_balances)
             as balances,
           (select count(*)::integer from public.inventory_movements)
             as movements`,
      );
      expect(inventoryAfter.rows).toEqual(inventoryBefore.rows);

      const columns = await database.query<{
        column_default: string | null;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'procurement_requests'
         order by ordinal_position`,
      );
      expect(columns.rows.map((column) => column.column_name)).toEqual([
        "id",
        "product_id",
        "requested_name",
        "supplier_id",
        "requested_quantity",
        "delivered_quantity",
        "status",
        "created_at",
        "created_by_user_id",
        "updated_at",
        "updated_by_user_id",
        "resolved_at",
        "resolved_by_user_id",
      ]);
      expect(columns.rows.find((column) =>
        column.column_name === "requested_quantity"
      )).toMatchObject({ data_type: "bigint", is_nullable: "NO" });
      expect(columns.rows.find((column) =>
        column.column_name === "delivered_quantity"
      )).toMatchObject({
        column_default: "0",
        data_type: "bigint",
        is_nullable: "NO",
      });
      expect(columns.rows.find((column) => column.column_name === "status"))
        .toMatchObject({ column_default: "'active'::text", is_nullable: "NO" });

      const foreignKeys = await database.query<{
        delete_action: string;
        name: string;
      }>(
        `select constraint_row.conname as name,
                constraint_row.confdeltype::text as delete_action
         from pg_catalog.pg_constraint as constraint_row
         where constraint_row.conrelid =
               'public.procurement_requests'::pg_catalog.regclass
           and constraint_row.contype = 'f'
         order by constraint_row.conname`,
      );
      expect(foreignKeys.rows).toEqual([
        { delete_action: "r", name: "procurement_requests_created_by_user_id_fkey" },
        { delete_action: "r", name: "procurement_requests_product_id_fkey" },
        { delete_action: "r", name: "procurement_requests_resolved_by_user_id_fkey" },
        { delete_action: "r", name: "procurement_requests_supplier_id_fkey" },
        { delete_action: "r", name: "procurement_requests_updated_by_user_id_fkey" },
      ]);

      const indexes = await database.query<{ indexname: string }>(
        `select indexname from pg_catalog.pg_indexes
         where schemaname = 'public'
           and tablename = 'procurement_requests'
         order by indexname`,
      );
      expect(indexes.rows.map((index) => index.indexname)).toEqual([
        "procurement_requests_pkey",
        "procurement_requests_product_id_idx",
        "procurement_requests_requested_name_search_trgm_idx",
        "procurement_requests_status_idx",
        "procurement_requests_supplier_id_idx",
        "procurement_requests_unresolved_updated_at_id_idx",
      ]);
    });
  });
  it("limits ProcurementRequest reads to active viewers and denies all direct client writes", async () => {
    const fixture = requireHarness();
    const supplierId = randomUUID();
    const requestIds = [randomUUID(), randomUUID()];
    const viewer = fixture.actors.productCreator;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.suppliers (
           id, name, catalog_number, country, created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'PROC-READ-DETAIL-CAT', 'BiH', $3, $3)`,
        [
          supplierId,
          `Procurement Read Supplier ${supplierId}`,
          fixture.actors.admin.profileId,
        ],
      );
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select $1, definition.id, $2
         from public.permission_definitions as definition
         where definition.key = 'procurement.view'`,
        [viewer.profileId, fixture.actors.admin.profileId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_by_user_id,
           updated_by_user_id, resolved_at, resolved_by_user_id
         ) values
           ($1, 'Readable Active Request', $3, 5, 0, 'active', $4, $4,
            null, null),
           ($2, 'Readable Resolved Request', $3, 5, 2, 'resolved', $4, $4,
            '2026-09-15T08:00:00Z', $4)`,
        [requestIds[0], requestIds[1], supplierId, fixture.actors.admin.profileId],
      );

      for (const actor of [fixture.actors.admin, viewer]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ id: string; status: string }>(
          `select id, status from public.procurement_requests
           where id = any($1::uuid[]) order by status`,
          [requestIds],
        );
        await database.query("reset role");
        expect(visible.rows).toEqual([
          { id: requestIds[0], status: "active" },
          { id: requestIds[1], status: "resolved" },
        ]);
      }

      for (const actor of [
        fixture.actors.permitted,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ id: string }>(
          `select id from public.procurement_requests
           where id = any($1::uuid[])`,
          [requestIds],
        );
        await database.query("reset role");
        expect(hidden.rows).toEqual([]);
      }

      const security = await database.query<{
        authenticated_delete: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        policy_expression: string;
        row_security: boolean;
      }>(
        `select
           class.relrowsecurity as row_security,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'select'
           ) as authenticated_select,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'insert'
           ) as authenticated_insert,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'update'
           ) as authenticated_update,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'delete'
           ) as authenticated_delete,
           pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
             as policy_expression
         from pg_catalog.pg_class as class
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = class.relnamespace
         join pg_catalog.pg_policy as policy
           on policy.polrelid = class.oid
          and policy.polname = 'procurement_requests_select_authorized'
         where namespace.nspname = 'public'
           and class.relname = 'procurement_requests'`,
      );
      expect(security.rows).toHaveLength(1);
      expect(security.rows[0]).toMatchObject({
        authenticated_delete: false,
        authenticated_insert: false,
        authenticated_select: true,
        authenticated_update: false,
        row_security: true,
      });
      expect(security.rows[0]?.policy_expression).toContain(
        "current_user_is_admin()",
      );
      expect(security.rows[0]?.policy_expression).toContain(
        "has_permission('procurement.view'::text)",
      );

      const prematureFunctions = await database.query<{ name: string }>(
        `select routine.proname as name
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = any($1::text[])
         order by routine.proname`,
        [[
          "create_existing_product_procurement_request",
          "create_new_component_procurement_request",
          "update_procurement_delivery",
        ]],
      );
      expect(prematureFunctions.rows).toEqual([]);
    });

    const directInsert = await fixture.actors.admin.client
      .from("procurement_requests")
      .insert({
        requested_name: "Forbidden Direct Request",
        supplier_id: supplierId,
        requested_quantity: 1,
        created_by_user_id: fixture.actors.admin.profileId,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
    const directUpdate = await fixture.actors.admin.client
      .from("procurement_requests")
      .update({ requested_quantity: 2 })
      .eq("id", requestIds[0]);
    const directDelete = await fixture.actors.admin.client
      .from("procurement_requests")
      .delete()
      .eq("id", requestIds[0]);
    expectPermissionDenied(directInsert.error);
    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);

    const anonymousRead = await fixture.anonymousClient
      .from("procurement_requests")
      .select("id")
      .limit(1);
    expectPermissionDenied(anonymousRead.error);
  });
  it("counts unresolved ProcurementRequest rows only for authorized active viewers", async () => {
    const fixture = requireHarness();
    const supplierId = randomUUID();
    const requestIds = Array.from({ length: 4 }, () => randomUUID());
    const viewer = fixture.actors.productCreator;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query("delete from public.procurement_requests");
      await database.query(
        `insert into public.suppliers (
           id, name, catalog_number, country, created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'PROC-BADGE-CAT', 'BiH', $3, $3)`,
        [
          supplierId,
          `Procurement Badge Supplier ${supplierId}`,
          fixture.actors.admin.profileId,
        ],
      );
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select $1, definition.id, $2
         from public.permission_definitions as definition
         where definition.key = 'procurement.view'`,
        [viewer.profileId, fixture.actors.admin.profileId],
      );
      const inventoryBefore = await database.query<{
        balances: number;
        movements: number;
      }>(
        `select
           (select count(*)::integer from public.inventory_balances)
             as balances,
           (select count(*)::integer from public.inventory_movements)
             as movements`,
      );

      async function readCount(authUserId: string): Promise<string> {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<{ badge_count: string }>(
          `select public.get_procurement_sidebar_badge_count()
             as badge_count`,
        );
        await database.query("reset role");
        const count = result.rows[0]?.badge_count;

        if (count === undefined) {
          throw new Error("Procurement badge RPC returned no count");
        }

        return count;
      }

      expect(await readCount(fixture.actors.admin.authUserId)).toBe("0");

      await database.query(
        `insert into public.procurement_requests (
           id, requested_name, supplier_id, requested_quantity,
           created_by_user_id, updated_by_user_id
         ) values ($1, 'One Thousand Pieces', $2, 1000, $3, $3)`,
        [requestIds[0], supplierId, fixture.actors.admin.profileId],
      );
      expect(await readCount(fixture.actors.admin.authUserId)).toBe("1");

      await database.query(
        `insert into public.procurement_requests (
           id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_by_user_id, updated_by_user_id
         ) values (
           $1, 'Partly Delivered Pieces', $2, 1000, 999,
           'partly_delivered', $3, $3
         )`,
        [requestIds[1], supplierId, fixture.actors.admin.profileId],
      );
      expect(await readCount(fixture.actors.admin.authUserId)).toBe("2");

      await database.query(
        `insert into public.procurement_requests (
           id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_by_user_id, updated_by_user_id,
           resolved_at, resolved_by_user_id
         ) values (
           $1, 'Resolved Pieces', $2, 5000, 5000, 'resolved', $3, $3,
           pg_catalog.clock_timestamp(), $3
         )`,
        [requestIds[2], supplierId, fixture.actors.admin.profileId],
      );
      expect(await readCount(fixture.actors.admin.authUserId)).toBe("2");

      await database.query(
        `insert into public.procurement_requests (
           id, requested_name, supplier_id, requested_quantity,
           created_by_user_id, updated_by_user_id
         ) values ($1, 'Another Active Row', $2, 1, $3, $3)`,
        [requestIds[3], supplierId, fixture.actors.admin.profileId],
      );
      expect(await readCount(fixture.actors.admin.authUserId)).toBe("3");
      expect(await readCount(viewer.authUserId)).toBe("3");

      const requestsBefore = await database.query<ProcurementRequestRow>(
        `select * from public.procurement_requests order by id`,
      );
      for (const [index, actor] of [
        fixture.actors.permitted,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ].entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_procurement_badge_${index}`);
        await expect(database.query(
          "select public.get_procurement_sidebar_badge_count()",
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_procurement_badge_${index}`);
        await database.query("reset role");
      }

      await database.query("set local role anon");
      await database.query("savepoint anonymous_procurement_badge");
      await expect(database.query(
        "select public.get_procurement_sidebar_badge_count()",
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_procurement_badge");
      await database.query("reset role");

      const requestsAfter = await database.query<ProcurementRequestRow>(
        `select * from public.procurement_requests order by id`,
      );
      const inventoryAfter = await database.query<{
        balances: number;
        movements: number;
      }>(
        `select
           (select count(*)::integer from public.inventory_balances)
             as balances,
           (select count(*)::integer from public.inventory_movements)
             as movements`,
      );
      expect(requestsAfter.rows).toEqual(requestsBefore.rows);
      expect(inventoryAfter.rows).toEqual(inventoryBefore.rows);

      const security = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        definition: string;
        identity_arguments: string;
        security_definer: boolean;
        settings: string[];
        volatility: string;
      }>(
        `select
           routine.prosecdef as security_definer,
           routine.proconfig as settings,
           routine.provolatile::text as volatility,
           pg_catalog.pg_get_function_identity_arguments(routine.oid)
             as identity_arguments,
           pg_catalog.pg_get_functiondef(routine.oid) as definition,
           pg_catalog.has_function_privilege(
             'anon', routine.oid, 'execute'
           ) as anonymous_execute,
           pg_catalog.has_function_privilege(
             'authenticated', routine.oid, 'execute'
           ) as authenticated_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'get_procurement_sidebar_badge_count'`,
      );
      expect(security.rows).toHaveLength(1);
      expect(security.rows[0]).toMatchObject({
        anonymous_execute: false,
        authenticated_execute: true,
        identity_arguments: "",
        security_definer: true,
        settings: ["search_path=\"\""],
        volatility: "s",
      });
      expect(security.rows[0]?.definition).toContain("count(*)");
      expect(security.rows[0]?.definition).toContain("'active'");
      expect(security.rows[0]?.definition).toContain(
        "'partly_delivered'",
      );
      expect(security.rows[0]?.definition).not.toContain("requested_quantity");
      expect(security.rows[0]?.definition).not.toContain("delivered_quantity");
    });

    expectPermissionDenied((await fixture.actors.unpermitted.client.rpc(
      "get_procurement_sidebar_badge_count",
    )).error);
    expectPermissionDenied((await fixture.actors.inactive.client.rpc(
      "get_procurement_sidebar_badge_count",
    )).error);
    expectPermissionDenied((await fixture.anonymousClient.rpc(
      "get_procurement_sidebar_badge_count",
    )).error);
  });
  it("serves the Procurement list and Supplier filters through narrow authorized projections", async () => {
    const fixture = requireHarness();
    const viewer = fixture.actors.productCreator;
    const actorId = fixture.actors.admin.profileId;
    const supplierIds = [randomUUID(), randomUUID()];
    const productIds = [randomUUID(), randomUUID()];
    const requestIds = Array.from({ length: 5 }, () => randomUUID());

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query("delete from public.procurement_requests");
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select $1, definition.id, $2
         from public.permission_definitions as definition
         where definition.key = 'procurement.view'`,
        [viewer.profileId, actorId],
      );
      await database.query(
        `insert into public.suppliers (
           id, name, catalog_number, country, created_by_user_id, updated_by_user_id
         ) values
           ($1, $2, 'PROC-ARCHIVED-CAT', 'BiH', $5, $5),
           ($3, $4, 'PROC-ACTIVE-CAT', 'BiH', $5, $5)`,
        [
          supplierIds[0],
          `Archived Procurement Supplier ${supplierIds[0]}`,
          supplierIds[1],
          `Active Procurement Supplier ${supplierIds[1]}`,
          actorId,
        ],
      );
      const serials = await database.query<{ serial_number: string }>(
        `select public.allocate_product_serial_number() as serial_number
         from pg_catalog.generate_series(1, 2)`,
      );
      const archivedSerial = serials.rows[0]?.serial_number;
      const activeSerial = serials.rows[1]?.serial_number;
      if (!archivedSerial || !activeSerial) {
        throw new Error("Product serial fixture allocation failed");
      }
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values
           ($1, $2, 'Archived Product', 'Component', 'component', $5, $5),
           ($3, $4, 'Active Product', 'Component', 'component', $5, $5)`,
        [productIds[0], archivedSerial, productIds[1], activeSerial, actorId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_at, created_by_user_id,
           updated_by_user_id, resolved_at, resolved_by_user_id
         ) values
           ($1, $6, $11, $8, 1000, 0, 'active',
            '2026-09-15T10:05:00Z', $10, $10, null, null),
           ($2, null, 'Unlinked Snapshot', $9, 2, 0, 'active',
            '2026-09-15T10:00:00Z', $10, $10, null, null),
           ($3, $7, 'Partly Delivered Snapshot', $9, 10, 4,
            'partly_delivered', '2026-09-15T10:04:00Z', $10, $10,
            null, null),
           ($4, $6, 'Resolved Historical Snapshot', $8, 20, 7, 'resolved',
            '2026-09-15T10:06:00Z', $10, $10,
            '2026-09-15T10:07:00Z', $10),
           ($5, $7, 'Resolved Active Endpoint Snapshot', $9, 5, 5,
            'resolved', '2026-09-15T09:59:00Z', $10, $10,
            '2026-09-15T10:08:00Z', $10)`,
        [
          ...requestIds,
          ...productIds,
          ...supplierIds,
          actorId,
          "Literal 100%_\\ Request",
        ],
      );
      await database.query(
        `update public.products
         set is_active = false,
             archived_at = pg_catalog.clock_timestamp(),
             archived_by_user_id = $1,
             updated_at = pg_catalog.clock_timestamp(),
             updated_by_user_id = $1
         where id = $2`,
        [actorId, productIds[0]],
      );
      await database.query(
        `update public.suppliers
         set is_active = false,
             archived_at = pg_catalog.clock_timestamp(),
             archived_by_user_id = $1,
             updated_at = pg_catalog.clock_timestamp(),
             updated_by_user_id = $1
         where id = $2`,
        [actorId, supplierIds[0]],
      );

      const sideEffectsBefore = await database.query<{
        audits: string;
        balances: string;
        movements: string;
        requests: string;
      }>(
        `select
           (select count(*)::text from public.audit_logs) as audits,
           (select count(*)::text from public.inventory_balances) as balances,
           (select count(*)::text from public.inventory_movements) as movements,
           (select count(*)::text from public.procurement_requests) as requests`,
      );

      async function readList(
        authUserId: string,
        search: string | null = null,
        status: string | null = null,
        supplierId: string | null = null,
      ) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<Record<string, unknown>>(
          `select * from public.search_procurement_requests($1, $2, $3)`,
          [search, status, supplierId],
        );
        await database.query("reset role");
        return result.rows;
      }

      const approvedFields = [
        "request_id",
        "product_id",
        "product_serial_number",
        "requested_name",
        "supplier_id",
        "supplier_name",
        "requested_quantity",
        "delivered_quantity",
        "status",
        "created_at",
        "created_by_user_id",
        "created_by_full_name",
      ];
      const adminRows = await readList(fixture.actors.admin.authUserId);
      const viewerRows = await readList(viewer.authUserId);
      expect(viewerRows).toEqual(adminRows);
      expect(viewerRows.map((row) => row.request_id)).toEqual([
        requestIds[0],
        requestIds[1],
        requestIds[2],
        requestIds[3],
        requestIds[4],
      ]);
      expect(viewerRows.every((row) =>
        JSON.stringify(Object.keys(row).sort()) ===
          JSON.stringify([...approvedFields].sort())
      )).toBe(true);
      expect(viewerRows[0]).toMatchObject({
        created_by_full_name: "Security fixture admin",
        product_serial_number: archivedSerial,
        supplier_name: `Archived Procurement Supplier ${supplierIds[0]}`,
      });
      expect(viewerRows[1]).toMatchObject({
        product_id: null,
        product_serial_number: null,
      });

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [viewer.authUserId],
      );
      await database.query("set local role authenticated");
      const unrelatedAccess = await database.query<{
        inventory_view: boolean;
        suppliers_view: boolean;
      }>(
        `select
           public.has_permission('inventory.view') as inventory_view,
           public.has_permission('suppliers.view') as suppliers_view`,
      );
      await database.query("reset role");
      expect(unrelatedAccess.rows).toEqual([{
        inventory_view: false,
        suppliers_view: false,
      }]);

      expect((await readList(viewer.authUserId, "snapshot"))).toHaveLength(4);
      expect((await readList(viewer.authUserId, archivedSerial))
        .map((row) => row.request_id)).toEqual([requestIds[0], requestIds[3]]);
      expect((await readList(viewer.authUserId, "%"))
        .map((row) => row.request_id)).toEqual([requestIds[0]]);
      expect((await readList(viewer.authUserId, "_"))
        .map((row) => row.request_id)).toEqual([requestIds[0]]);
      expect((await readList(viewer.authUserId, "\\"))
        .map((row) => row.request_id)).toEqual([requestIds[0]]);
      expect((await readList(viewer.authUserId, "LITERAL 100"))
        .map((row) => row.request_id)).toEqual([requestIds[0]]);
      expect((await readList(viewer.authUserId, null, "partly_delivered"))
        .map((row) => row.request_id)).toEqual([requestIds[2]]);
      expect((await readList(viewer.authUserId, null, "resolved"))
        .map((row) => row.request_id)).toEqual([requestIds[3], requestIds[4]]);
      expect((await readList(viewer.authUserId, null, null, supplierIds[0]))
        .map((row) => row.request_id)).toEqual([requestIds[0], requestIds[3]]);
      expect(await readList(viewer.authUserId, "   ")).toEqual(viewerRows);

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [viewer.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint invalid_procurement_list_status");
      await expect(database.query(
        "select * from public.search_procurement_requests(null, 'unknown', null)",
      )).rejects.toMatchObject({ code: "22023" });
      await database.query("rollback to savepoint invalid_procurement_list_status");
      await database.query("reset role");

      for (const [index, actor] of [
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ].entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_procurement_list_${index}`);
        await expect(database.query(
          "select * from public.search_procurement_requests(null, null, null)",
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_procurement_list_${index}`);
        await database.query("reset role");
      }
      await database.query("set local role anon");
      await database.query("savepoint anonymous_procurement_list");
      await expect(database.query(
        "select * from public.search_procurement_requests(null, null, null)",
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_procurement_list");
      await database.query("reset role");

      async function readSupplierOptions(authUserId: string) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<Record<string, unknown>>(
          "select * from public.list_procurement_supplier_options()",
        );
        await database.query("reset role");
        return result.rows;
      }

      const supplierOptions = await readSupplierOptions(viewer.authUserId);
      expect(supplierOptions).toHaveLength(2);
      expect(new Set(supplierOptions.map((row) => row.supplier_id))).toEqual(
        new Set(supplierIds),
      );
      expect(supplierOptions.every((row) =>
        Object.keys(row).sort().join(",") === "supplier_id,supplier_name"
      )).toBe(true);
      expect(supplierOptions).toContainEqual({
        supplier_id: supplierIds[0],
        supplier_name: `Archived Procurement Supplier ${supplierIds[0]}`,
      });

      for (const [index, actor] of [
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ].entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_procurement_options_${index}`);
        await expect(database.query(
          "select * from public.list_procurement_supplier_options()",
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_procurement_options_${index}`);
        await database.query("reset role");
      }
      await database.query("set local role anon");
      await database.query("savepoint anonymous_procurement_options");
      await expect(database.query(
        "select * from public.list_procurement_supplier_options()",
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_procurement_options");
      await database.query("reset role");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [viewer.authUserId],
      );
      await database.query("set local role authenticated");
      const badge = await database.query<{ count: string }>(
        "select public.get_procurement_sidebar_badge_count()::text as count",
      );
      await database.query("reset role");
      expect(badge.rows).toEqual([{ count: "3" }]);

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        identity_arguments: string;
        name: string;
        security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.proname as name,
           routine.prosecdef as security_definer,
           routine.proconfig as settings,
           pg_catalog.pg_get_function_identity_arguments(routine.oid)
             as identity_arguments,
           pg_catalog.has_function_privilege(
             'anon', routine.oid, 'execute'
           ) as anonymous_execute,
           pg_catalog.has_function_privilege(
             'authenticated', routine.oid, 'execute'
           ) as authenticated_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = any($1::text[])
         order by routine.proname`,
        [[
          "list_procurement_supplier_options",
          "search_procurement_requests",
        ]],
      );
      expect(functionSecurity.rows).toEqual([
        {
          anonymous_execute: false,
          authenticated_execute: true,
          identity_arguments: "",
          name: "list_procurement_supplier_options",
          security_definer: true,
          settings: ["search_path=\"\""],
        },
        {
          anonymous_execute: false,
          authenticated_execute: true,
          identity_arguments:
            "p_search text, p_status text, p_supplier_id uuid",
          name: "search_procurement_requests",
          security_definer: true,
          settings: ["search_path=\"\""],
        },
      ]);

      const sideEffectsAfter = await database.query<{
        audits: string;
        balances: string;
        movements: string;
        requests: string;
      }>(
        `select
           (select count(*)::text from public.audit_logs) as audits,
           (select count(*)::text from public.inventory_balances) as balances,
           (select count(*)::text from public.inventory_movements) as movements,
           (select count(*)::text from public.procurement_requests) as requests`,
      );
      expect(sideEffectsAfter.rows).toEqual(sideEffectsBefore.rows);
    });

    expectPermissionDenied((await fixture.actors.unpermitted.client.rpc(
      "search_procurement_requests",
      { p_search: null, p_status: null, p_supplier_id: null },
    )).error);
    expectPermissionDenied((await fixture.actors.inactive.client.rpc(
      "list_procurement_supplier_options",
    )).error);
    expectPermissionDenied((await fixture.anonymousClient.rpc(
      "search_procurement_requests",
      { p_search: null, p_status: null, p_supplier_id: null },
    )).error);
  });

}
