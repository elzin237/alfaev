import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityFixtureHarness } from "./security-fixtures";
import { createTestSerialNumber } from "./helpers/serial";

interface CountResultRow {
  count: number;
}

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

interface InventoryBalanceRow {
  product_id: string;
  quantity: string;
  updated_at: Date;
}

interface ProductSupplierRow {
  archived_at: Date | null;
  archived_by_user_id: string | null;
  catalog_number: string | null;
  created_at: Date;
  created_by_user_id: string;
  id: string;
  is_active: boolean;
  product_id: string;
  supplier_id: string;
  updated_at: Date;
  updated_by_user_id: string;
}

export function registerProcurementLifecycleTests(requireHarness: () => SecurityFixtureHarness): void {
  it("updates Procurement Delivered Quantity through change-status authority without Inventory effects", async () => {
    const fixture = requireHarness();
    const admin = fixture.actors.admin;
    const statusChanger = fixture.actors.productEditor;
    const viewerOnly = fixture.actors.permitted;
    const editorOnly = fixture.actors.supplierEditor;
    const creatorOnly = fixture.actors.productCreator;
    const resolverOnly = fixture.actors.supplierCreator;
    const supplierId = randomUUID();
    const productId = randomUUID();
    const activeRequestId = randomUUID();
    const resolvedRequestId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select actor.profile_id, definition.id, $6::uuid
         from (
           values
             ($1::uuid, 'procurement.change_status'::text),
             ($2::uuid, 'procurement.view'::text),
             ($3::uuid, 'procurement.edit'::text),
             ($4::uuid, 'procurement.create'::text),
             ($5::uuid, 'procurement.resolve'::text)
         ) as actor(profile_id, permission_key)
         join public.permission_definitions as definition
           on definition.key = actor.permission_key`,
        [
          statusChanger.profileId,
          viewerOnly.profileId,
          editorOnly.profileId,
          creatorOnly.profileId,
          resolverOnly.profileId,
          admin.profileId,
        ],
      );
      await database.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values ($1, 'Delivery Update Supplier', 'BiH', $2, $2)`,
        [supplierId, admin.profileId],
      );
      const serial = await database.query<{ serial_number: string }>(
        "select public.allocate_product_serial_number() as serial_number",
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'Delivery Product', 'Component', 'component', $3, $3)`,
        [productId, serial.rows[0]?.serial_number, admin.profileId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_at, created_by_user_id,
           updated_at, updated_by_user_id, resolved_at, resolved_by_user_id
         ) values
           ($1, $3, 'Immutable Delivery Snapshot', $4, 10, 0, 'active',
            '2026-09-15T08:00:00Z', $5, '2000-01-01T00:00:00Z', $5,
            null, null),
           ($2, $3, 'Resolved Delivery Snapshot', $4, 10, 5, 'resolved',
            '2026-09-15T08:00:00Z', $5, '2026-09-15T09:00:00Z', $5,
            '2026-09-15T09:00:00Z', $5)`,
        [
          activeRequestId,
          resolvedRequestId,
          productId,
          supplierId,
          admin.profileId,
        ],
      );

      const inventoryBefore = await database.query<Record<string, unknown>>(
        `select
           (select pg_catalog.string_agg(
             balance.product_id::text || ':' || balance.quantity::text,
             ',' order by balance.product_id
           ) from public.inventory_balances as balance) as balances,
           (select count(*)::text from public.inventory_movements) as movements`,
      );

      async function updateAs(
        authUserId: string,
        requestId: string,
        deliveredQuantity: number,
      ): Promise<string> {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<{ request_id: string }>(
          `select public.update_procurement_delivered_quantity(
             $1::uuid, $2::bigint
           ) as request_id`,
          [requestId, deliveredQuantity],
        );
        await database.query("reset role");
        const updatedRequestId = result.rows[0]?.request_id;
        if (!updatedRequestId) throw new Error("Delivery update returned no ID");
        return updatedRequestId;
      }

      async function readRequest() {
        const result = await database.query<ProcurementRequestRow>(
          "select * from public.procurement_requests where id = $1::uuid",
          [activeRequestId],
        );
        const request = result.rows[0];
        if (!request) throw new Error("Delivery request fixture is missing");
        return request;
      }

      async function countDeliveryAudits(): Promise<number> {
        const result = await database.query<CountResultRow>(
          `select count(*)::integer as count
           from public.audit_logs
           where entity_id = $1::uuid
             and action_type = 'procurement.delivery_updated'`,
          [activeRequestId],
        );
        return result.rows[0]?.count ?? -1;
      }

      async function readBadgeCount(): Promise<string> {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [admin.authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<{ count: string }>(
          `select public.get_procurement_sidebar_badge_count()::text as count`,
        );
        await database.query("reset role");
        return result.rows[0]?.count ?? "missing";
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [statusChanger.authUserId],
      );
      await database.query("set local role authenticated");
      const independentAuthority = await database.query<{
        can_change: boolean;
        can_view: boolean;
      }>(
        `select
           public.has_permission('procurement.change_status') as can_change,
           public.has_permission('procurement.view') as can_view`,
      );
      await database.query("reset role");
      expect(independentAuthority.rows).toEqual([{
        can_change: true,
        can_view: false,
      }]);

      const badgeBefore = await readBadgeCount();
      expect(await updateAs(admin.authUserId, activeRequestId, 1))
        .toBe(activeRequestId);
      expect(await readRequest()).toMatchObject({
        delivered_quantity: "1",
        requested_quantity: "10",
        status: "partly_delivered",
        updated_by_user_id: admin.profileId,
      });
      expect((await readRequest()).updated_at.toISOString())
        .not.toBe("2000-01-01T00:00:00.000Z");
      expect(await countDeliveryAudits()).toBe(1);

      expect(await updateAs(statusChanger.authUserId, activeRequestId, 4))
        .toBe(activeRequestId);
      expect(await readRequest()).toMatchObject({
        delivered_quantity: "4",
        status: "partly_delivered",
        updated_by_user_id: statusChanger.profileId,
      });
      expect(await countDeliveryAudits()).toBe(2);

      await updateAs(statusChanger.authUserId, activeRequestId, 0);
      expect(await readRequest()).toMatchObject({
        delivered_quantity: "0",
        status: "active",
      });
      expect(await countDeliveryAudits()).toBe(3);

      await updateAs(statusChanger.authUserId, activeRequestId, 10);
      expect(await readRequest()).toMatchObject({
        delivered_quantity: "10",
        resolved_at: null,
        resolved_by_user_id: null,
        status: "partly_delivered",
      });
      expect(await countDeliveryAudits()).toBe(4);

      await updateAs(statusChanger.authUserId, activeRequestId, 3);
      const beforeNoOp = await readRequest();
      expect(beforeNoOp).toMatchObject({
        delivered_quantity: "3",
        status: "partly_delivered",
      });
      expect(await countDeliveryAudits()).toBe(5);
      expect(await updateAs(statusChanger.authUserId, activeRequestId, 3))
        .toBe(activeRequestId);
      expect(await readRequest()).toEqual(beforeNoOp);
      expect(await countDeliveryAudits()).toBe(5);
      expect(await readBadgeCount()).toBe(badgeBefore);

      const deliveryAudits = await database.query<{
        action_type: string;
        actor_user_id: string;
        after_data: Record<string, unknown>;
        before_data: Record<string, unknown>;
      }>(
        `select action_type, actor_user_id, before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'procurement.delivery_updated'`,
        [activeRequestId],
      );
      expect(deliveryAudits.rows).toHaveLength(5);
      expect(deliveryAudits.rows).toContainEqual(expect.objectContaining({
        action_type: "procurement.delivery_updated",
        actor_user_id: admin.profileId,
        before_data: {
          delivered_quantity: 0,
          remaining_quantity: 10,
          requested_quantity: 10,
          status: "active",
        },
        after_data: {
          delivered_quantity: 1,
          remaining_quantity: 9,
          requested_quantity: 10,
          status: "partly_delivered",
        },
      }));

      const deniedState = await readRequest();
      const deniedAuditCount = await countDeliveryAudits();
      for (const [index, actor] of [
        editorOnly,
        viewerOnly,
        creatorOnly,
        resolverOnly,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ].entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_delivery_update_${index}`);
        await expect(database.query(
          `select public.update_procurement_delivered_quantity($1::uuid, 2)`,
          [activeRequestId],
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_delivery_update_${index}`);
        await database.query("reset role");
      }
      await database.query("set local role anon");
      await database.query("savepoint anonymous_delivery_update");
      await expect(database.query(
        `select public.update_procurement_delivered_quantity($1::uuid, 2)`,
        [activeRequestId],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_delivery_update");
      await database.query("reset role");
      expect(await readRequest()).toEqual(deniedState);
      expect(await countDeliveryAudits()).toBe(deniedAuditCount);

      for (const [index, invalid] of [
        { requestId: null, quantity: 0, code: "22023" },
        { requestId: activeRequestId, quantity: null, code: "22023" },
        { requestId: activeRequestId, quantity: -1, code: "22023" },
        { requestId: activeRequestId, quantity: 11, code: "22023" },
        { requestId: randomUUID(), quantity: 0, code: "P0002" },
        { requestId: resolvedRequestId, quantity: 4, code: "PRQ02" },
      ].entries()) {
        const before = await database.query<ProcurementRequestRow>(
          `select * from public.procurement_requests
           where id = any($1::uuid[]) order by id`,
          [[activeRequestId, resolvedRequestId]],
        );
        const auditCount = await countDeliveryAudits();
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint invalid_delivery_update_${index}`);
        await expect(database.query(
          `select public.update_procurement_delivered_quantity(
             $1::uuid, $2::bigint
           )`,
          [invalid.requestId, invalid.quantity],
        )).rejects.toMatchObject({ code: invalid.code });
        await database.query(`rollback to savepoint invalid_delivery_update_${index}`);
        await database.query("reset role");
        expect((await database.query<ProcurementRequestRow>(
          `select * from public.procurement_requests
           where id = any($1::uuid[]) order by id`,
          [[activeRequestId, resolvedRequestId]],
        )).rows).toEqual(before.rows);
        expect(await countDeliveryAudits()).toBe(auditCount);
      }

      await database.query("savepoint immutable_delivery_snapshot");
      await expect(database.query(
        `update public.procurement_requests
         set requested_name = 'Changed Snapshot'
         where id = $1::uuid`,
        [activeRequestId],
      )).rejects.toMatchObject({ code: "PRQ01" });
      await database.query("rollback to savepoint immutable_delivery_snapshot");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [statusChanger.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint direct_delivery_update");
      await expect(database.query(
        `update public.procurement_requests
         set delivered_quantity = 2, status = 'partly_delivered'
         where id = $1::uuid`,
        [activeRequestId],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint direct_delivery_update");
      await database.query("reset role");

      await database.query(
        `create function public.test_reject_procurement_delivery_audit()
         returns trigger
         language plpgsql
         set search_path = ''
         as $test_function$
         begin
           if new.action_type = 'procurement.delivery_updated' then
             raise exception 'Test delivery audit rejection'
               using errcode = 'TST01';
           end if;

           return new;
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_reject_procurement_delivery_audit
         before insert on public.audit_logs
         for each row
         execute function public.test_reject_procurement_delivery_audit()`,
      );
      const beforeAuditFailure = await readRequest();
      const auditCountBeforeFailure = await countDeliveryAudits();
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint failed_delivery_audit");
      await expect(database.query(
        `select public.update_procurement_delivered_quantity($1::uuid, 4)`,
        [activeRequestId],
      )).rejects.toMatchObject({ code: "TST01" });
      await database.query("rollback to savepoint failed_delivery_audit");
      await database.query("reset role");
      expect(await readRequest()).toEqual(beforeAuditFailure);
      expect(await countDeliveryAudits()).toBe(auditCountBeforeFailure);

      const finalRequest = await readRequest();
      expect(finalRequest).toMatchObject({
        created_by_user_id: admin.profileId,
        delivered_quantity: "3",
        product_id: productId,
        requested_name: "Immutable Delivery Snapshot",
        requested_quantity: "10",
        resolved_at: null,
        resolved_by_user_id: null,
        status: "partly_delivered",
        supplier_id: supplierId,
        updated_by_user_id: statusChanger.profileId,
      });
      const inventoryAfter = await database.query<Record<string, unknown>>(
        `select
           (select pg_catalog.string_agg(
             balance.product_id::text || ':' || balance.quantity::text,
             ',' order by balance.product_id
           ) from public.inventory_balances as balance) as balances,
           (select count(*)::text from public.inventory_movements) as movements`,
      );
      expect(inventoryAfter.rows).toEqual(inventoryBefore.rows);

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        definition: string;
        identity_arguments: string;
        security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.prosecdef as security_definer,
           routine.proconfig as settings,
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
           and routine.proname = 'update_procurement_delivered_quantity'`,
      );
      expect(functionSecurity.rows).toHaveLength(1);
      expect(functionSecurity.rows[0]).toMatchObject({
        anonymous_execute: false,
        authenticated_execute: true,
        identity_arguments: "p_request_id uuid, p_delivered_quantity bigint",
        security_definer: true,
        settings: ["search_path=\"\""],
      });
      const definition = functionSecurity.rows[0]?.definition ?? "";
      expect(definition.toLowerCase()).toContain("for update");
      expect(definition.match(/procurement\.change_status/g)).toHaveLength(2);
      expect(definition).not.toContain("p_status");
      expect(definition).not.toContain("p_requested_quantity");
      expect(definition).not.toContain("apply_inventory_delta");
      expect(definition).not.toContain("manual_adjust_inventory");
    });

    expectPermissionDenied((await viewerOnly.client.rpc(
      "update_procurement_delivered_quantity",
      { p_request_id: activeRequestId, p_delivered_quantity: 1 },
    )).error);
    expectPermissionDenied((await fixture.anonymousClient.rpc(
      "update_procurement_delivered_quantity",
      { p_request_id: activeRequestId, p_delivered_quantity: 1 },
    )).error);
  });
  it("resolves Procurement requests terminally through independent resolve authority without Inventory effects", async () => {
    const fixture = requireHarness();
    const admin = fixture.actors.admin;
    const resolver = fixture.actors.supplierCreator;
    const statusChanger = fixture.actors.productEditor;
    const editor = fixture.actors.supplierEditor;
    const creator = fixture.actors.productCreator;
    const viewer = fixture.actors.permitted;
    const supplierId = randomUUID();
    const productId = randomUUID();
    const activeRequestId = randomUUID();
    const partialRequestId = randomUUID();
    const fullRequestId = randomUUID();
    const resolvedRequestId = randomUUID();
    const auditFailureRequestId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select actor.profile_id, definition.id, $6::uuid
         from (
           values
             ($1::uuid, 'procurement.resolve'::text),
             ($2::uuid, 'procurement.change_status'::text),
             ($3::uuid, 'procurement.edit'::text),
             ($4::uuid, 'procurement.create'::text),
             ($5::uuid, 'procurement.view'::text)
         ) as actor(profile_id, permission_key)
         join public.permission_definitions as definition
           on definition.key = actor.permission_key`,
        [
          resolver.profileId,
          statusChanger.profileId,
          editor.profileId,
          creator.profileId,
          viewer.profileId,
          admin.profileId,
        ],
      );
      await database.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values ($1, 'Resolve Supplier', 'BiH', $2, $2)`,
        [supplierId, admin.profileId],
      );
      const serial = await database.query<{ serial_number: string }>(
        "select public.allocate_product_serial_number() as serial_number",
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'Resolve Product', 'Component', 'component', $3, $3)`,
        [productId, serial.rows[0]?.serial_number, admin.profileId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_at, created_by_user_id,
           updated_at, updated_by_user_id, resolved_at, resolved_by_user_id
         ) values
           ($1, $6, 'Active Resolve Snapshot', $7, 10, 0, 'active',
            '2026-09-15T08:00:00Z', $8, '2000-01-01T00:00:00Z', $8,
            null, null),
           ($2, $6, 'Partial Resolve Snapshot', $7, 10, 4, 'partly_delivered',
            '2026-09-15T08:01:00Z', $8, '2000-01-01T00:00:00Z', $8,
            null, null),
           ($3, $6, 'Full Resolve Snapshot', $7, 10, 10, 'partly_delivered',
            '2026-09-15T08:02:00Z', $8, '2000-01-01T00:00:00Z', $8,
            null, null),
           ($4, $6, 'Already Resolved Snapshot', $7, 10, 5, 'resolved',
            '2026-09-15T08:03:00Z', $8, '2026-09-15T09:00:00Z', $8,
            '2026-09-15T09:00:00Z', $8),
           ($5, $6, 'Audit Failure Snapshot', $7, 10, 2, 'partly_delivered',
            '2026-09-15T08:04:00Z', $8, '2000-01-01T00:00:00Z', $8,
            null, null)`,
        [
          activeRequestId,
          partialRequestId,
          fullRequestId,
          resolvedRequestId,
          auditFailureRequestId,
          productId,
          supplierId,
          admin.profileId,
        ],
      );

      const inventoryBefore = await database.query<Record<string, unknown>>(
        `select
           (select pg_catalog.string_agg(
             balance.product_id::text || ':' || balance.quantity::text,
             ',' order by balance.product_id
           ) from public.inventory_balances as balance) as balances,
           (select count(*)::text from public.inventory_movements) as movements`,
      );

      async function resolveAs(authUserId: string, requestId: string) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<{ request_id: string }>(
          `select public.resolve_procurement_request($1::uuid) as request_id`,
          [requestId],
        );
        await database.query("reset role");
        return result.rows[0]?.request_id;
      }

      async function readRequest(requestId: string) {
        const result = await database.query<ProcurementRequestRow>(
          "select * from public.procurement_requests where id = $1::uuid",
          [requestId],
        );
        const row = result.rows[0];
        if (!row) throw new Error("Resolve request fixture is missing");
        return row;
      }

      async function countResolveAudits(requestId: string) {
        const result = await database.query<CountResultRow>(
          `select count(*)::integer as count
           from public.audit_logs
           where entity_id = $1::uuid
             and action_type = 'procurement.resolved'`,
          [requestId],
        );
        return result.rows[0]?.count ?? -1;
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [resolver.authUserId],
      );
      await database.query("set local role authenticated");
      const independentAuthority = await database.query<{
        can_resolve: boolean;
        can_view: boolean;
      }>(
        `select
           public.has_permission('procurement.resolve') as can_resolve,
           public.has_permission('procurement.view') as can_view`,
      );
      await database.query("reset role");
      expect(independentAuthority.rows).toEqual([{
        can_resolve: true,
        can_view: false,
      }]);

      for (const [requestId, actor, deliveredQuantity] of [
        [activeRequestId, admin, "0"],
        [partialRequestId, resolver, "4"],
        [fullRequestId, resolver, "10"],
      ] as const) {
        const before = await readRequest(requestId);
        expect(await resolveAs(actor.authUserId, requestId)).toBe(requestId);
        const after = await readRequest(requestId);

        expect(after).toMatchObject({
          created_at: before.created_at,
          created_by_user_id: before.created_by_user_id,
          delivered_quantity: deliveredQuantity,
          product_id: before.product_id,
          requested_name: before.requested_name,
          requested_quantity: before.requested_quantity,
          resolved_by_user_id: actor.profileId,
          status: "resolved",
          supplier_id: before.supplier_id,
          updated_by_user_id: actor.profileId,
        });
        expect(after.resolved_at).toBeInstanceOf(Date);
        expect(after.updated_at).toEqual(after.resolved_at);
        expect(await countResolveAudits(requestId)).toBe(1);
      }

      const audit = await database.query<{
        action_type: string;
        actor_user_id: string;
        after_data: Record<string, unknown>;
        before_data: Record<string, unknown>;
      }>(
        `select action_type, actor_user_id, before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'procurement.resolved'`,
        [partialRequestId],
      );
      expect(audit.rows).toEqual([expect.objectContaining({
        action_type: "procurement.resolved",
        actor_user_id: resolver.profileId,
        before_data: expect.objectContaining({
          delivered_quantity: 4,
          remaining_quantity: 6,
          requested_quantity: 10,
          status: "partly_delivered",
        }),
        after_data: expect.objectContaining({
          delivered_quantity: 4,
          remaining_quantity: 6,
          requested_quantity: 10,
          resolved_by_user_id: resolver.profileId,
          status: "resolved",
        }),
      })]);

      const deniedRequest = await readRequest(auditFailureRequestId);
      for (const [index, actor] of [
        statusChanger,
        editor,
        creator,
        viewer,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ].entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_procurement_resolve_${index}`);
        await expect(database.query(
          "select public.resolve_procurement_request($1::uuid)",
          [auditFailureRequestId],
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_procurement_resolve_${index}`);
        await database.query("reset role");
      }
      await database.query("set local role anon");
      await database.query("savepoint anonymous_procurement_resolve");
      await expect(database.query(
        "select public.resolve_procurement_request($1::uuid)",
        [auditFailureRequestId],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_procurement_resolve");
      await database.query("reset role");
      expect(await readRequest(auditFailureRequestId)).toEqual(deniedRequest);
      expect(await countResolveAudits(auditFailureRequestId)).toBe(0);

      for (const [index, requestId, code] of [
        [0, resolvedRequestId, "PRQ02"],
        [1, randomUUID(), "P0002"],
      ] as const) {
        const before = await readRequest(resolvedRequestId);
        const auditCount = await countResolveAudits(resolvedRequestId);
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint invalid_procurement_resolve_${index}`);
        await expect(database.query(
          "select public.resolve_procurement_request($1::uuid)",
          [requestId],
        )).rejects.toMatchObject({ code });
        await database.query(`rollback to savepoint invalid_procurement_resolve_${index}`);
        await database.query("reset role");
        expect(await readRequest(resolvedRequestId)).toEqual(before);
        expect(await countResolveAudits(resolvedRequestId)).toBe(auditCount);
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint resolved_delivery_regression");
      await expect(database.query(
        `select public.update_procurement_delivered_quantity($1::uuid, 1)`,
        [activeRequestId],
      )).rejects.toMatchObject({ code: "PRQ02" });
      await database.query("rollback to savepoint resolved_delivery_regression");

      await database.query("savepoint direct_procurement_resolve_update");
      await expect(database.query(
        `update public.procurement_requests
         set status = 'resolved', resolved_at = pg_catalog.now(),
             resolved_by_user_id = $2::uuid
         where id = $1::uuid`,
        [auditFailureRequestId, admin.profileId],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint direct_procurement_resolve_update");
      await database.query("reset role");

      await database.query(
        `create function public.test_reject_procurement_resolve_audit()
         returns trigger
         language plpgsql
         set search_path = ''
         as $test_function$
         begin
           if new.action_type = 'procurement.resolved' then
             raise exception 'Test resolve audit rejection'
               using errcode = 'TST01';
           end if;

           return new;
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_reject_procurement_resolve_audit
         before insert on public.audit_logs
         for each row
         execute function public.test_reject_procurement_resolve_audit()`,
      );
      const beforeAuditFailure = await readRequest(auditFailureRequestId);
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint failed_procurement_resolve_audit");
      await expect(database.query(
        "select public.resolve_procurement_request($1::uuid)",
        [auditFailureRequestId],
      )).rejects.toMatchObject({ code: "TST01" });
      await database.query("rollback to savepoint failed_procurement_resolve_audit");
      await database.query("reset role");
      expect(await readRequest(auditFailureRequestId)).toEqual(beforeAuditFailure);
      expect(await countResolveAudits(auditFailureRequestId)).toBe(0);

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      const historicalRead = await database.query<{ id: string }>(
        `select id from public.procurement_requests
         where id = $1::uuid and status = 'resolved'`,
        [activeRequestId],
      );
      await database.query("reset role");
      expect(historicalRead.rows).toEqual([{ id: activeRequestId }]);

      const inventoryAfter = await database.query<Record<string, unknown>>(
        `select
           (select pg_catalog.string_agg(
             balance.product_id::text || ':' || balance.quantity::text,
             ',' order by balance.product_id
           ) from public.inventory_balances as balance) as balances,
           (select count(*)::text from public.inventory_movements) as movements`,
      );
      expect(inventoryAfter.rows).toEqual(inventoryBefore.rows);

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        definition: string;
        identity_arguments: string;
        security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.prosecdef as security_definer,
           routine.proconfig as settings,
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
           and routine.proname = 'resolve_procurement_request'`,
      );
      expect(functionSecurity.rows).toHaveLength(1);
      expect(functionSecurity.rows[0]).toMatchObject({
        anonymous_execute: false,
        authenticated_execute: true,
        identity_arguments: "p_request_id uuid",
        security_definer: true,
        settings: ["search_path=\"\""],
      });
      const definition = functionSecurity.rows[0]?.definition ?? "";
      expect(definition.toLowerCase()).toContain("for update");
      expect(definition.match(/'procurement\.resolve'/g)).toHaveLength(2);
      expect(definition).not.toContain("procurement.view");
      expect(definition).not.toContain("apply_inventory_delta");
      expect(definition).not.toContain("manual_adjust_inventory");

      const reopenFunctions = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname like '%procurement%reopen%'`,
      );
      expect(reopenFunctions.rows).toEqual([{ count: 0 }]);
    });
  });
  it("creates and links a component from an eligible Procurement request as one Admin-only transaction", async () => {
    const fixture = requireHarness();
    const admin = fixture.actors.admin;
    const activeBrandId = randomUUID();
    const archivedBrandId = randomUUID();
    const activeSupplierId = randomUUID();
    const archivedSupplierId = randomUUID();
    const activeRequestId = randomUUID();
    const partialRequestId = randomUUID();
    const deniedRequestId = randomUUID();
    const linkedRequestId = randomUUID();
    const resolvedRequestId = randomUUID();
    const archivedSupplierRequestId = randomUUID();
    const productSupplierFailureRequestId = randomUUID();
    const auditFailureRequestId = randomUUID();
    const existingProductId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select actor.profile_id, definition.id, $6::uuid
         from (
           values
             ($1::uuid, 'procurement.view'::text),
             ($2::uuid, 'procurement.create'::text),
             ($3::uuid, 'procurement.edit'::text),
             ($4::uuid, 'procurement.change_status'::text),
             ($5::uuid, 'procurement.resolve'::text)
         ) as actor(profile_id, permission_key)
         join public.permission_definitions as definition
           on definition.key = actor.permission_key
         on conflict do nothing`,
        [
          fixture.actors.permitted.profileId,
          fixture.actors.productCreator.profileId,
          fixture.actors.supplierEditor.profileId,
          fixture.actors.productEditor.profileId,
          fixture.actors.supplierCreator.profileId,
          admin.profileId,
        ],
      );
      await database.query(
        `insert into public.brands (
           id, name, is_active, created_by_user_id, updated_by_user_id,
           archived_at, archived_by_user_id
         ) values
           ($1, 'Procurement Product Brand', true, $3, $3, null, null),
           ($2, 'Archived Procurement Product Brand', false, $3, $3,
            pg_catalog.now(), $3)`,
        [activeBrandId, archivedBrandId, admin.profileId],
      );
      await database.query(
        `insert into public.suppliers (
           id, name, country, is_active, created_by_user_id,
           updated_by_user_id, archived_at, archived_by_user_id
         ) values
           ($1, 'Procurement Product Supplier', 'BiH', true, $3, $3,
            null, null),
           ($2, 'Archived Procurement Product Supplier', 'BiH', false,
            $3, $3, pg_catalog.now(), $3)`,
        [activeSupplierId, archivedSupplierId, admin.profileId],
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'Existing Linked Product', 'Components',
           'component', $3, $3)`,
        [existingProductId, createTestSerialNumber(), admin.profileId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_at, created_by_user_id,
           updated_at, updated_by_user_id, resolved_at, resolved_by_user_id
         ) values
           ($1, null, 'Original Active Snapshot', $9, 12, 0, 'active',
            '2026-09-15T10:00:00Z', $11, '2000-01-01T00:00:00Z', $11,
            null, null),
           ($2, null, 'Original Partial Snapshot', $9, 10, 4,
            'partly_delivered', '2026-09-15T10:01:00Z', $11,
            '2000-01-01T00:00:00Z', $11, null, null),
           ($3, null, 'Denied Snapshot', $9, 8, 0, 'active',
            '2026-09-15T10:02:00Z', $11, '2000-01-01T00:00:00Z', $11,
            null, null),
           ($4, $10, 'Already Linked Snapshot', $9, 7, 0, 'active',
            '2026-09-15T10:03:00Z', $11, '2000-01-01T00:00:00Z', $11,
            null, null),
           ($5, null, 'Resolved Snapshot', $9, 6, 2, 'resolved',
            '2026-09-15T10:04:00Z', $11, '2026-09-15T11:00:00Z', $11,
            '2026-09-15T11:00:00Z', $11),
           ($6, null, 'Archived Supplier Snapshot', $12, 5, 0, 'active',
            '2026-09-15T10:05:00Z', $11, '2000-01-01T00:00:00Z', $11,
            null, null),
           ($7, null, 'Link Failure Snapshot', $9, 4, 0, 'active',
            '2026-09-15T10:06:00Z', $11, '2000-01-01T00:00:00Z', $11,
            null, null),
           ($8, null, 'Audit Failure Snapshot', $9, 3, 0, 'active',
            '2026-09-15T10:07:00Z', $11, '2000-01-01T00:00:00Z', $11,
            null, null)`,
        [
          activeRequestId,
          partialRequestId,
          deniedRequestId,
          linkedRequestId,
          resolvedRequestId,
          archivedSupplierRequestId,
          productSupplierFailureRequestId,
          auditFailureRequestId,
          activeSupplierId,
          existingProductId,
          admin.profileId,
          archivedSupplierId,
        ],
      );

      async function createFromRequest(
        authUserId: string,
        requestId: string,
        name: string,
        category: string,
        brandId: string | null,
        catalogNumber: string | null,
      ) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<{
          product_id: string;
          serial_number: string;
        }>(
          `select * from public.create_product_from_procurement_request(
             $1::uuid, $2::text, $3::text, $4::uuid, $5::text
           )`,
          [requestId, name, category, brandId, catalogNumber],
        );
        await database.query("reset role");
        const row = result.rows[0];
        if (!row) throw new Error("Procurement Product creation returned no row");
        return row;
      }

      async function requestState(requestId: string) {
        const result = await database.query<ProcurementRequestRow>(
          "select * from public.procurement_requests where id = $1::uuid",
          [requestId],
        );
        const row = result.rows[0];
        if (!row) throw new Error("Procurement Product request fixture is missing");
        return row;
      }

      const activeBefore = await requestState(activeRequestId);
      const inventoryBefore = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.inventory_movements",
      );
      const created = await createFromRequest(
        admin.authUserId,
        activeRequestId,
        "  Replacement Alfa Component  ",
        "  Power Electronics  ",
        activeBrandId,
        "  CaT-083  ",
      );
      expect(created.serial_number).toMatch(/^[0-9]{7}$/);

      const product = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [created.product_id],
      );
      expect(product.rows).toEqual([expect.objectContaining({
        brand_id: activeBrandId,
        category: "Power Electronics",
        created_by_user_id: admin.profileId,
        is_active: true,
        name: "Replacement Alfa Component",
        product_kind: "component",
        serial_number: created.serial_number,
        updated_by_user_id: admin.profileId,
      })]);
      expect(product.rows[0]?.name).not.toBe(activeBefore.requested_name);

      const relation = await database.query<ProductSupplierRow>(
        `select * from public.product_suppliers
         where product_id = $1::uuid`,
        [created.product_id],
      );
      expect(relation.rows).toEqual([expect.objectContaining({
        catalog_number: "CaT-083",
        created_by_user_id: admin.profileId,
        is_active: true,
        supplier_id: activeSupplierId,
        updated_by_user_id: admin.profileId,
      })]);
      const balance = await database.query<InventoryBalanceRow>(
        "select * from public.inventory_balances where product_id = $1::uuid",
        [created.product_id],
      );
      expect(balance.rows).toEqual([expect.objectContaining({
        product_id: created.product_id,
        quantity: "0",
      })]);
      expect((await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.inventory_movements where product_id = $1::uuid`,
        [created.product_id],
      )).rows).toEqual([{ count: 0 }]);

      const activeAfter = await requestState(activeRequestId);
      expect(activeAfter).toMatchObject({
        created_at: activeBefore.created_at,
        created_by_user_id: activeBefore.created_by_user_id,
        delivered_quantity: activeBefore.delivered_quantity,
        product_id: created.product_id,
        requested_name: activeBefore.requested_name,
        requested_quantity: activeBefore.requested_quantity,
        resolved_at: activeBefore.resolved_at,
        resolved_by_user_id: activeBefore.resolved_by_user_id,
        status: activeBefore.status,
        supplier_id: activeBefore.supplier_id,
        updated_by_user_id: admin.profileId,
      });
      expect(activeAfter.updated_at.getTime()).toBeGreaterThan(
        activeBefore.updated_at.getTime(),
      );

      const audit = await database.query<{
        action_type: string;
        actor_user_id: string;
        after_data: Record<string, unknown>;
        before_data: Record<string, unknown> | null;
        entity_id: string;
      }>(
        `select action_type, actor_user_id, before_data, after_data, entity_id
         from public.audit_logs
         where entity_id = any($1::uuid[])
         order by action_type`,
        [[created.product_id, relation.rows[0]?.id, activeRequestId]],
      );
      expect(audit.rows.map((row) => row.action_type)).toEqual([
        "procurement.product_linked",
        "product_supplier.created",
        "product.created",
      ]);
      expect(audit.rows.every((row) => row.actor_user_id === admin.profileId))
        .toBe(true);
      expect(audit.rows.find((row) =>
        row.action_type === "procurement.product_linked"
      )).toEqual(expect.objectContaining({
        after_data: expect.objectContaining({
          product_id: created.product_id,
          product_serial_number: created.serial_number,
          supplier_id: activeSupplierId,
        }),
        before_data: expect.objectContaining({ product_id: null }),
        entity_id: activeRequestId,
      }));

      const partialBefore = await requestState(partialRequestId);
      const createdWithoutOptionalValues = await createFromRequest(
        admin.authUserId,
        partialRequestId,
        "Snapshot-independent Name",
        "Components",
        null,
        "   ",
      );
      expect((await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [createdWithoutOptionalValues.product_id],
      )).rows[0]).toMatchObject({ brand_id: null, product_kind: "component" });
      expect((await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where product_id = $1::uuid",
        [createdWithoutOptionalValues.product_id],
      )).rows[0]).toMatchObject({
        catalog_number: null,
        supplier_id: activeSupplierId,
      });
      expect(await requestState(partialRequestId)).toMatchObject({
        delivered_quantity: partialBefore.delivered_quantity,
        product_id: createdWithoutOptionalValues.product_id,
        requested_name: partialBefore.requested_name,
        requested_quantity: partialBefore.requested_quantity,
        status: "partly_delivered",
        supplier_id: partialBefore.supplier_id,
      });

      const deniedBefore = await requestState(deniedRequestId);
      for (const [index, actor] of [
        fixture.actors.permitted,
        fixture.actors.productCreator,
        fixture.actors.supplierEditor,
        fixture.actors.productEditor,
        fixture.actors.supplierCreator,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ].entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_procurement_product_${index}`);
        await expect(database.query(
          `select * from public.create_product_from_procurement_request(
             $1::uuid, 'Denied Product', 'Components', null, null
           )`,
          [deniedRequestId],
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(
          `rollback to savepoint denied_procurement_product_${index}`,
        );
        await database.query("reset role");
      }
      await database.query("set local role anon");
      await database.query("savepoint anonymous_procurement_product");
      await expect(database.query(
        `select * from public.create_product_from_procurement_request(
           $1::uuid, 'Anonymous Product', 'Components', null, null
         )`,
        [deniedRequestId],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_procurement_product");
      await database.query("reset role");
      expect(await requestState(deniedRequestId)).toEqual(deniedBefore);

      for (const [index, values, code] of [
        [0, [randomUUID(), "Missing Request", "Components", null, null], "P0002"],
        [1, [linkedRequestId, "Linked Request", "Components", null, null], "PRQ05"],
        [2, [resolvedRequestId, "Resolved Request", "Components", null, null], "PRQ02"],
        [3, [archivedSupplierRequestId, "Archived Supplier", "Components", null, null], "PRQ04"],
        [4, [deniedRequestId, "Missing Brand", "Components", randomUUID(), null], "PRD04"],
        [5, [deniedRequestId, "Archived Brand", "Components", archivedBrandId, null], "PRD04"],
        [6, [deniedRequestId, "   ", "Components", null, null], "22023"],
        [7, [deniedRequestId, "Valid Name", "   ", null, null], "22023"],
      ] as const) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint invalid_procurement_product_${index}`);
        await expect(database.query(
          `select * from public.create_product_from_procurement_request(
             $1::uuid, $2::text, $3::text, $4::uuid, $5::text
           )`,
          [...values],
        )).rejects.toMatchObject({ code });
        await database.query(
          `rollback to savepoint invalid_procurement_product_${index}`,
        );
        await database.query("reset role");
      }

      await database.query(
        `create function public.test_reject_procurement_product_supplier()
         returns trigger language plpgsql set search_path = ''
         as $test_function$
         begin
           raise exception 'Test ProductSupplier rejection'
             using errcode = 'TST02';
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_reject_procurement_product_supplier
         before insert on public.product_suppliers
         for each row execute function
           public.test_reject_procurement_product_supplier()`,
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint failed_procurement_product_supplier");
      await expect(database.query(
        `select * from public.create_product_from_procurement_request(
           $1::uuid, 'Must Roll Back Product', 'Components', null, null
         )`,
        [productSupplierFailureRequestId],
      )).rejects.toMatchObject({ code: "TST02" });
      await database.query(
        "rollback to savepoint failed_procurement_product_supplier",
      );
      await database.query("reset role");
      expect((await requestState(productSupplierFailureRequestId)).product_id)
        .toBeNull();
      expect((await database.query<CountResultRow>(
        `select count(*)::integer as count from public.products
         where name = 'Must Roll Back Product'`,
      )).rows).toEqual([{ count: 0 }]);
      expect((await database.query<CountResultRow>(
        `select count(*)::integer as count from public.audit_logs
         where summary like '%Must Roll Back Product%'`,
      )).rows).toEqual([{ count: 0 }]);
      await database.query("drop trigger test_reject_procurement_product_supplier on public.product_suppliers");
      await database.query("drop function public.test_reject_procurement_product_supplier()");

      await database.query(
        `create function public.test_reject_procurement_product_link_audit()
         returns trigger language plpgsql set search_path = ''
         as $test_function$
         begin
           if new.action_type = 'procurement.product_linked' then
             raise exception 'Test Procurement Product audit rejection'
               using errcode = 'TST01';
           end if;
           return new;
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_reject_procurement_product_link_audit
         before insert on public.audit_logs
         for each row execute function
           public.test_reject_procurement_product_link_audit()`,
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint failed_procurement_product_audit");
      await expect(database.query(
        `select * from public.create_product_from_procurement_request(
           $1::uuid, 'Audit Rollback Product', 'Components', null, null
         )`,
        [auditFailureRequestId],
      )).rejects.toMatchObject({ code: "TST01" });
      await database.query("rollback to savepoint failed_procurement_product_audit");
      await database.query("reset role");
      expect((await requestState(auditFailureRequestId)).product_id).toBeNull();
      expect((await database.query<CountResultRow>(
        `select count(*)::integer as count from public.products
         where name = 'Audit Rollback Product'`,
      )).rows).toEqual([{ count: 0 }]);

      const inventoryAfter = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.inventory_movements",
      );
      expect(inventoryAfter.rows).toEqual(inventoryBefore.rows);

      const security = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        definition: string;
        identity_arguments: string;
        security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.prosecdef as security_definer,
           routine.proconfig as settings,
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
           and routine.proname = 'create_product_from_procurement_request'`,
      );
      expect(security.rows).toHaveLength(1);
      expect(security.rows[0]).toMatchObject({
        anonymous_execute: false,
        authenticated_execute: true,
        identity_arguments:
          "p_request_id uuid, p_name text, p_category text, p_brand_id uuid, p_catalog_number text",
        security_definer: true,
        settings: ["search_path=\"\""],
      });
      const definition = security.rows[0]?.definition ?? "";
      expect(definition.toLowerCase()).toContain("for update");
      expect(definition.match(/current_user_is_admin\(\)/g)).toHaveLength(2);
      expect(definition).toContain("public.create_product(");
      expect(definition).toContain("public.create_product_supplier(");
      expect(definition).toContain("procurement.product_linked");
      expect(definition).not.toContain("procurement.view");
      expect(definition).not.toContain("apply_inventory_delta");
    });
  });
}

export function registerProcurementProductConcurrencyTests(requireHarness: () => SecurityFixtureHarness): void {
  it("serializes simultaneous Admin Product creation attempts for the same Procurement request", async () => {
    const fixture = requireHarness();
    const requestId = randomUUID();
    const supplierId = randomUUID();

    await fixture.withDatabaseClients(3, async (clients) => {
      const firstAdmin = clients[0];
      const secondAdmin = clients[1];
      const observer = clients[2];
      if (!firstAdmin || !secondAdmin || !observer) {
        throw new Error("Procurement Product concurrency clients are unavailable");
      }

      await observer.query("begin");
      await observer.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values ($1, 'Concurrent Procurement Product Supplier', 'BiH', $2, $2)`,
        [supplierId, fixture.actors.admin.profileId],
      );
      await observer.query(
        `insert into public.procurement_requests (
           id, requested_name, supplier_id, requested_quantity,
           created_by_user_id, updated_by_user_id
         ) values ($1, 'Concurrent Request Snapshot', $2, 10, $3, $3)`,
        [requestId, supplierId, fixture.actors.admin.profileId],
      );
      await observer.query("commit");

      try {
        await firstAdmin.query("begin");
        await firstAdmin.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await firstAdmin.query("set local role authenticated");
        const firstResult = await firstAdmin.query<{
          product_id: string;
          serial_number: string;
        }>(
          `select * from public.create_product_from_procurement_request(
             $1::uuid, 'Concurrent Product', 'Components', null, null
           )`,
          [requestId],
        );
        expect(firstResult.rows).toEqual([{
          product_id: expect.any(String),
          serial_number: expect.stringMatching(/^[0-9]{7}$/),
        }]);

        await secondAdmin.query("begin");
        const secondBackend = await secondAdmin.query<{ pid: number }>(
          "select pg_catalog.pg_backend_pid()::integer as pid",
        );
        const secondBackendPid = secondBackend.rows[0]?.pid;
        if (!secondBackendPid) {
          throw new Error("Concurrent Procurement Product backend PID is unavailable");
        }
        await secondAdmin.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await secondAdmin.query("set local role authenticated");
        const secondResult = secondAdmin.query(
          `select * from public.create_product_from_procurement_request(
             $1::uuid, 'Duplicate Concurrent Product', 'Components', null, null
           )`,
          [requestId],
        ).then(
          () => null,
          (error: unknown) => error,
        );

        let observedRequestLockWait = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = await observer.query<ActivityWaitRow>(
            `select wait_event_type, wait_event
             from pg_catalog.pg_stat_activity
             where pid = $1::integer`,
            [secondBackendPid],
          );
          if (activity.rows[0]?.wait_event_type === "Lock") {
            observedRequestLockWait = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(observedRequestLockWait).toBe(true);

        await firstAdmin.query("commit");
        expect(await secondResult).toMatchObject({ code: "PRQ05" });
        await secondAdmin.query("rollback");

        const finalState = await observer.query<{
          audit_count: number;
          balance_count: number;
          movement_count: number;
          product_count: number;
          product_id: string;
          relation_count: number;
        }>(
          `select
             request.product_id,
             (select count(*)::integer from public.products as product
              where product.id = request.product_id) as product_count,
             (select count(*)::integer from public.product_suppliers as relation
              where relation.product_id = request.product_id
                and relation.supplier_id = request.supplier_id) as relation_count,
             (select count(*)::integer from public.inventory_balances as balance
              where balance.product_id = request.product_id) as balance_count,
             (select count(*)::integer from public.inventory_movements as movement
              where movement.product_id = request.product_id) as movement_count,
             (select count(*)::integer from public.audit_logs as audit
              where audit.action_type in (
                'product.created', 'product_supplier.created',
                'procurement.product_linked'
              ) and (
                audit.entity_id = request.id
                or audit.entity_id = request.product_id
                or audit.entity_id in (
                  select relation.id from public.product_suppliers as relation
                  where relation.product_id = request.product_id
                )
              )) as audit_count
           from public.procurement_requests as request
           where request.id = $1::uuid`,
          [requestId],
        );
        expect(finalState.rows).toEqual([{
          audit_count: 3,
          balance_count: 1,
          movement_count: 0,
          product_count: 1,
          product_id: firstResult.rows[0]?.product_id,
          relation_count: 1,
        }]);
      } finally {
        await firstAdmin.query("rollback");
        await secondAdmin.query("rollback");
        await observer.query("begin");
        await observer.query("set local session_replication_role = replica");
        await observer.query(
          `delete from public.audit_logs
           where entity_id = $1::uuid
              or entity_id in (
                select product_id from public.procurement_requests where id = $1::uuid
              )
              or entity_id in (
                select relation.id from public.product_suppliers as relation
                join public.procurement_requests as request
                  on request.product_id = relation.product_id
                where request.id = $1::uuid
              )`,
          [requestId],
        );
        await observer.query(
          `delete from public.product_suppliers
           where product_id in (
             select product_id from public.procurement_requests where id = $1::uuid
           )`,
          [requestId],
        );
        await observer.query(
          "delete from public.procurement_requests where id = $1::uuid",
          [requestId],
        );
        await observer.query(
          `delete from public.inventory_balances
           where product_id in (
             select id from public.products
             where name = 'Concurrent Product'
           )`,
        );
        await observer.query(
          "delete from public.products where name = 'Concurrent Product'",
        );
        await observer.query(
          "delete from public.suppliers where id = $1::uuid",
          [supplierId],
        );
        await observer.query("commit");
      }
    });
  });

}
