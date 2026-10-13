import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityFixtureHarness } from "./security-fixtures";

interface CreatedAuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown>;
  entity_id: string;
  entity_type: string;
  metadata: Record<string, unknown>;
}

interface CountResultRow {
  count: number;
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

export function registerProcurementCreationTests(requireHarness: () => SecurityFixtureHarness): void {
  const legacyCreationTest = it.skip;

  legacyCreationTest("creates existing-Product Procurement requests through the legacy supplied-request contract", async () => {
    const fixture = requireHarness();
    const admin = fixture.actors.admin;
    const creator = fixture.actors.productCreator;
    const viewerOnly = fixture.actors.permitted;
    const editOnly = fixture.actors.supplierEditor;
    const statusOnly = fixture.actors.supplierArchiver;
    const resolveOnly = fixture.actors.supplierCreator;
    const productIds = [randomUUID(), randomUUID(), randomUUID()];
    const supplierIds = [randomUUID(), randomUUID()];

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select actor.profile_id, definition.id, $6::uuid
         from (
           values
             ($1::uuid, 'procurement.create'::text),
             ($2::uuid, 'procurement.view'::text),
             ($3::uuid, 'procurement.edit'::text),
             ($4::uuid, 'procurement.change_status'::text),
             ($5::uuid, 'procurement.resolve'::text)
         ) as actor(profile_id, permission_key)
         join public.permission_definitions as definition
           on definition.key = actor.permission_key`,
        [
          creator.profileId,
          viewerOnly.profileId,
          editOnly.profileId,
          statusOnly.profileId,
          resolveOnly.profileId,
          admin.profileId,
        ],
      );
      await database.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values
           ($1, 'Active Request Supplier', 'BiH', $3, $3),
           ($2, 'Archived Request Supplier', 'BiH', $3, $3)`,
        [supplierIds[0], supplierIds[1], admin.profileId],
      );
      const serials = await database.query<{ serial_number: string }>(
        `select public.allocate_product_serial_number() as serial_number
         from pg_catalog.generate_series(1, 3)`,
      );
      if (serials.rows.length !== 3) {
        throw new Error("Procurement Product serial fixtures are unavailable");
      }
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values
           ($1, $4, 'Authoritative Product Name', 'Component', 'component', $7, $7),
           ($2, $5, $8, 'Component', 'component', $7, $7),
           ($3, $6, 'Archived Request Product', 'Component', 'component', $7, $7)`,
        [
          ...productIds,
          ...serials.rows.map((row) => row.serial_number),
          admin.profileId,
          "Choice 100%_\\ Product",
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
        [admin.profileId, productIds[2]],
      );
      await database.query(
        `update public.suppliers
         set is_active = false,
             archived_at = pg_catalog.clock_timestamp(),
             archived_by_user_id = $1,
             updated_at = pg_catalog.clock_timestamp(),
             updated_by_user_id = $1
         where id = $2`,
        [admin.profileId, supplierIds[1]],
      );

      const inventoryBefore = await database.query<{
        balances: string;
        movements: string;
        quantities: string;
      }>(
        `select
           (select count(*)::text from public.inventory_balances) as balances,
           (select count(*)::text from public.inventory_movements) as movements,
           (
             select pg_catalog.string_agg(
               balance.product_id::text || ':' || balance.quantity::text,
               ',' order by balance.product_id
             )
             from public.inventory_balances as balance
           ) as quantities`,
      );
      const endpointsBefore = await database.query<Record<string, unknown>>(
        `select 'product' as kind, product.id, product.name,
                product.is_active, product.updated_at
         from public.products as product
         where product.id = any($1::uuid[])
         union all
         select 'supplier' as kind, supplier.id, supplier.name,
                supplier.is_active, supplier.updated_at
         from public.suppliers as supplier
         where supplier.id = any($2::uuid[])
         order by kind, id`,
        [productIds, supplierIds],
      );

      async function createAs(
        authUserId: string,
        productId: string,
        supplierId: string,
        quantity: number,
      ): Promise<string> {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<{ request_id: string }>(
          `select public.create_procurement_request_for_product(
             $1, $2, $3
           ) as request_id`,
          [productId, supplierId, quantity],
        );
        await database.query("reset role");
        const requestId = result.rows[0]?.request_id;
        if (!requestId) throw new Error("Procurement creation returned no ID");
        return requestId;
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [creator.authUserId],
      );
      await database.query("set local role authenticated");
      const independentAuthority = await database.query<{
        can_create: boolean;
        can_view: boolean;
      }>(
        `select
           public.has_permission('procurement.create') as can_create,
           public.has_permission('procurement.view') as can_view`,
      );
      await database.query("reset role");
      expect(independentAuthority.rows).toEqual([{
        can_create: true,
        can_view: false,
      }]);

      const adminRequestId = await createAs(
        admin.authUserId,
        productIds[0]!,
        supplierIds[0]!,
        6,
      );
      const creatorRequestId = await createAs(
        creator.authUserId,
        productIds[0]!,
        supplierIds[0]!,
        9,
      );
      const createdRequests = await database.query<ProcurementRequestRow>(
        `select * from public.procurement_requests
         where id = any($1::uuid[])
         order by id`,
        [[adminRequestId, creatorRequestId]],
      );
      expect(createdRequests.rows).toHaveLength(2);
      expect(createdRequests.rows.find((row) => row.id === adminRequestId))
        .toMatchObject({
          created_by_user_id: admin.profileId,
          delivered_quantity: "0",
          product_id: productIds[0],
          requested_name: "Authoritative Product Name",
          requested_quantity: "6",
          resolved_at: null,
          resolved_by_user_id: null,
          status: "active",
          supplier_id: supplierIds[0],
          updated_by_user_id: admin.profileId,
        });
      expect(createdRequests.rows.find((row) => row.id === creatorRequestId))
        .toMatchObject({
          created_by_user_id: creator.profileId,
          requested_name: "Authoritative Product Name",
          requested_quantity: "9",
          updated_by_user_id: creator.profileId,
        });
      for (const row of createdRequests.rows) {
        expect(row.created_at).toEqual(row.updated_at);
      }
      const audits = await database.query<CreatedAuditRow>(
        `select action_type, actor_user_id, after_data, entity_id,
                entity_type, metadata
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type = 'procurement.created'
         order by entity_id`,
        [[adminRequestId, creatorRequestId]],
      );
      expect(audits.rows).toHaveLength(2);
      expect(audits.rows.find((audit) => audit.entity_id === creatorRequestId))
        .toMatchObject({
          action_type: "procurement.created",
          actor_user_id: creator.profileId,
          entity_type: "procurement_request",
          after_data: {
            product_id: productIds[0],
            requested_name: "Authoritative Product Name",
            supplier_id: supplierIds[0],
            requested_quantity: 9,
            delivered_quantity: 0,
            status: "active",
          },
        });

      const deniedActors = [
        viewerOnly,
        editOnly,
        statusOnly,
        resolveOnly,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ];
      for (const [index, actor] of deniedActors.entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_procurement_create_${index}`);
        await expect(database.query(
          `select public.create_procurement_request_for_product($1, $2, 1)`,
          [productIds[0], supplierIds[0]],
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_procurement_create_${index}`);
        await database.query("reset role");
      }
      await database.query("set local role anon");
      await database.query("savepoint anonymous_procurement_create");
      await expect(database.query(
        `select public.create_procurement_request_for_product($1, $2, 1)`,
        [productIds[0], supplierIds[0]],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_procurement_create");
      await database.query("reset role");

      const rejectedInputs = [
        { productId: randomUUID(), supplierId: supplierIds[0], quantity: 1, code: "PRQ03" },
        { productId: productIds[2], supplierId: supplierIds[0], quantity: 1, code: "PRQ03" },
        { productId: productIds[0], supplierId: randomUUID(), quantity: 1, code: "PRQ04" },
        { productId: productIds[0], supplierId: supplierIds[1], quantity: 1, code: "PRQ04" },
        { productId: productIds[0], supplierId: supplierIds[0], quantity: 0, code: "22023" },
        { productId: productIds[0], supplierId: supplierIds[0], quantity: -1, code: "22023" },
      ];
      for (const [index, rejected] of rejectedInputs.entries()) {
        const before = await database.query<CountResultRow>(
          `select (
             select count(*)::integer from public.procurement_requests
           ) + (
             select count(*)::integer from public.audit_logs
             where action_type = 'procurement.created'
           ) as count`,
        );
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint rejected_procurement_input_${index}`);
        await expect(database.query(
          `select public.create_procurement_request_for_product($1, $2, $3)`,
          [rejected.productId, rejected.supplierId, rejected.quantity],
        )).rejects.toMatchObject({ code: rejected.code });
        await database.query(`rollback to savepoint rejected_procurement_input_${index}`);
        await database.query("reset role");
        const after = await database.query<CountResultRow>(
          `select (
             select count(*)::integer from public.procurement_requests
           ) + (
             select count(*)::integer from public.audit_logs
             where action_type = 'procurement.created'
           ) as count`,
        );
        expect(after.rows).toEqual(before.rows);
      }

      async function readProductChoices(authUserId: string, search: string | null) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<Record<string, unknown>>(
          "select * from public.search_procurement_product_choices($1)",
          [search],
        );
        await database.query("reset role");
        return result.rows;
      }

      const adminProductChoices = await readProductChoices(admin.authUserId, null);
      const creatorProductChoices = await readProductChoices(creator.authUserId, null);
      expect(creatorProductChoices).toEqual(adminProductChoices);
      expect(new Set(creatorProductChoices
        .filter((row) => productIds.some((productId) => productId === row.product_id))
        .map((row) => row.product_id)))
        .toEqual(new Set([productIds[0], productIds[1]]));
      expect(creatorProductChoices.every((row) =>
        Object.keys(row).sort().join(",") === "name,product_id,serial_number"
      )).toBe(true);
      expect((await readProductChoices(creator.authUserId, "authoritative"))
        .map((row) => row.product_id)).toEqual([productIds[0]]);
      expect((await readProductChoices(
        creator.authUserId,
        serials.rows[0]!.serial_number,
      )).map((row) => row.product_id)).toEqual([productIds[0]]);
      for (const literal of ["%", "_", "\\"]) {
        expect((await readProductChoices(creator.authUserId, literal))
          .map((row) => row.product_id)).toEqual([productIds[1]]);
      }

      async function readSupplierChoices(authUserId: string) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<Record<string, unknown>>(
          "select * from public.list_active_procurement_supplier_choices()",
        );
        await database.query("reset role");
        return result.rows;
      }

      expect(await readSupplierChoices(admin.authUserId)).toEqual(
        await readSupplierChoices(creator.authUserId),
      );
      const supplierChoices = await readSupplierChoices(creator.authUserId);
      expect(supplierChoices).toContainEqual({
        supplier_id: supplierIds[0],
        supplier_name: "Active Request Supplier",
      });
      expect(supplierChoices).not.toContainEqual(expect.objectContaining({
        supplier_id: supplierIds[1],
      }));
      expect(supplierChoices.every((row) =>
        Object.keys(row).sort().join(",") === "supplier_id,supplier_name"
      )).toBe(true);

      for (const [index, functionCall] of [
        "select * from public.search_procurement_product_choices(null)",
        "select * from public.list_active_procurement_supplier_choices()",
      ].entries()) {
        for (const [actorIndex, actor] of [viewerOnly, fixture.actors.inactive].entries()) {
          await database.query(
            "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
            [actor.authUserId],
          );
          await database.query("set local role authenticated");
          await database.query(`savepoint denied_creation_choice_${index}_${actorIndex}`);
          await expect(database.query(functionCall))
            .rejects.toMatchObject({ code: "42501" });
          await database.query(`rollback to savepoint denied_creation_choice_${index}_${actorIndex}`);
          await database.query("reset role");
        }
        await database.query("set local role anon");
        await database.query(`savepoint anonymous_creation_choice_${index}`);
        await expect(database.query(functionCall))
          .rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint anonymous_creation_choice_${index}`);
        await database.query("reset role");
      }

      await database.query(
        `create function public.test_reject_procurement_created_audit()
         returns trigger
         language plpgsql
         set search_path = ''
         as $test_function$
         begin
           if new.action_type = 'procurement.created' then
             raise exception 'Test Procurement audit rejection'
               using errcode = 'TST01';
           end if;

           return new;
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_reject_procurement_created_audit
         before insert on public.audit_logs
         for each row
         execute function public.test_reject_procurement_created_audit()`,
      );
      const requestCountBeforeAuditFailure = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.procurement_requests",
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint failed_procurement_audit");
      await expect(database.query(
        `select public.create_procurement_request_for_product($1, $2, 3)`,
        [productIds[0], supplierIds[0]],
      )).rejects.toMatchObject({ code: "TST01" });
      await database.query("rollback to savepoint failed_procurement_audit");
      await database.query("reset role");
      const requestCountAfterAuditFailure = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.procurement_requests",
      );
      expect(requestCountAfterAuditFailure.rows)
        .toEqual(requestCountBeforeAuditFailure.rows);

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        definition: string;
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
           and routine.proname = any($1::text[])
         order by routine.proname`,
        [[
          "create_procurement_request_for_product",
          "list_active_procurement_supplier_choices",
          "search_procurement_product_choices",
        ]],
      );
      expect(functionSecurity.rows).toHaveLength(3);
      for (const security of functionSecurity.rows) {
        expect(security).toMatchObject({
          anonymous_execute: false,
          authenticated_execute: true,
          security_definer: true,
          settings: ["search_path=\"\""],
        });
        expect(security.definition).toContain("procurement.create");
      }
      const creationSecurity = functionSecurity.rows.find((row) =>
        row.name === "create_procurement_request_for_product"
      );
      expect(creationSecurity?.identity_arguments).toBe(
        "p_product_id uuid, p_supplier_id uuid, p_requested_quantity bigint",
      );
      expect(creationSecurity?.definition.toLowerCase()).toContain("for share");
      expect(creationSecurity?.definition).not.toContain("p_requested_name");
      expect(creationSecurity?.definition).not.toContain("inventory_balances");
      expect(creationSecurity?.definition).not.toContain("inventory_movements");

      const inventoryAfter = await database.query<{
        balances: string;
        movements: string;
        quantities: string;
      }>(
        `select
           (select count(*)::text from public.inventory_balances) as balances,
           (select count(*)::text from public.inventory_movements) as movements,
           (
             select pg_catalog.string_agg(
               balance.product_id::text || ':' || balance.quantity::text,
               ',' order by balance.product_id
             )
             from public.inventory_balances as balance
           ) as quantities`,
      );
      const endpointsAfter = await database.query<Record<string, unknown>>(
        `select 'product' as kind, product.id, product.name,
                product.is_active, product.updated_at
         from public.products as product
         where product.id = any($1::uuid[])
         union all
         select 'supplier' as kind, supplier.id, supplier.name,
                supplier.is_active, supplier.updated_at
         from public.suppliers as supplier
         where supplier.id = any($2::uuid[])
         order by kind, id`,
        [productIds, supplierIds],
      );
      expect(inventoryAfter.rows).toEqual(inventoryBefore.rows);
      expect(endpointsAfter.rows).toEqual(endpointsBefore.rows);
    });

    expectPermissionDenied((await viewerOnly.client.rpc(
      "create_procurement_request_for_product",
      {
        p_product_id: productIds[0],
        p_supplier_id: supplierIds[0],
        p_requested_quantity: 1,
      },
    )).error);
    expectPermissionDenied((await fixture.anonymousClient.rpc(
      "search_procurement_product_choices",
      { p_search: null },
    )).error);
  });
  legacyCreationTest("creates unlinked brand-new component Procurement requests through the legacy supplied-request contract", async () => {
    const fixture = requireHarness();
    const admin = fixture.actors.admin;
    const creator = fixture.actors.productCreator;
    const viewerOnly = fixture.actors.permitted;
    const editOnly = fixture.actors.supplierEditor;
    const statusOnly = fixture.actors.supplierArchiver;
    const resolveOnly = fixture.actors.supplierCreator;
    const supplierIds = [randomUUID(), randomUUID()];
    const productId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select actor.profile_id, definition.id, $6::uuid
         from (
           values
             ($1::uuid, 'procurement.create'::text),
             ($2::uuid, 'procurement.view'::text),
             ($3::uuid, 'procurement.edit'::text),
             ($4::uuid, 'procurement.change_status'::text),
             ($5::uuid, 'procurement.resolve'::text)
         ) as actor(profile_id, permission_key)
         join public.permission_definitions as definition
           on definition.key = actor.permission_key`,
        [
          creator.profileId,
          viewerOnly.profileId,
          editOnly.profileId,
          statusOnly.profileId,
          resolveOnly.profileId,
          admin.profileId,
        ],
      );
      await database.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values
           ($1, 'New Component Supplier', 'BiH', $3, $3),
           ($2, 'Archived New Component Supplier', 'BiH', $3, $3)`,
        [supplierIds[0], supplierIds[1], admin.profileId],
      );
      await database.query(
        `update public.suppliers
         set is_active = false,
             archived_at = pg_catalog.clock_timestamp(),
             archived_by_user_id = $1,
             updated_at = pg_catalog.clock_timestamp(),
             updated_by_user_id = $1
         where id = $2`,
        [admin.profileId, supplierIds[1]],
      );
      const serial = await database.query<{ serial_number: string }>(
        "select public.allocate_product_serial_number() as serial_number",
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'Task 078 Regression Product', 'Component',
                   'component', $3, $3)`,
        [productId, serial.rows[0]?.serial_number, admin.profileId],
      );

      const sideEffectsBefore = await database.query<Record<string, unknown>>(
        `select
           (select count(*)::text from public.products) as products,
           (select count(*)::text from public.product_suppliers) as product_suppliers,
           (select count(*)::text from public.inventory_balances) as balances,
           (select count(*)::text from public.inventory_movements) as movements,
           (select last_value::text from public.product_serial_number_seq) as serial_last_value`,
      );

      async function createAs(
        authUserId: string,
        requestedName: string,
        supplierId: string,
        quantity: number,
      ): Promise<string> {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<{ request_id: string }>(
          `select public.create_procurement_request_for_new_component(
             $1::text, $2::uuid, $3::bigint
           ) as request_id`,
          [requestedName, supplierId, quantity],
        );
        await database.query("reset role");
        const requestId = result.rows[0]?.request_id;
        if (!requestId) throw new Error("New-component request returned no ID");
        return requestId;
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [creator.authUserId],
      );
      await database.query("set local role authenticated");
      const independentAuthority = await database.query<{
        can_create: boolean;
        can_view: boolean;
      }>(
        `select
           public.has_permission('procurement.create') as can_create,
           public.has_permission('procurement.view') as can_view`,
      );
      await database.query("reset role");
      expect(independentAuthority.rows).toEqual([{
        can_create: true,
        can_view: false,
      }]);

      const adminRequestId = await createAs(
        admin.authUserId,
        "  New Component by Admin  ",
        supplierIds[0]!,
        5,
      );
      const creatorRequestId = await createAs(
        creator.authUserId,
        "  Worker New Component  ",
        supplierIds[0]!,
        11,
      );
      const createdRequests = await database.query<ProcurementRequestRow>(
        `select * from public.procurement_requests
         where id = any($1::uuid[])
         order by id`,
        [[adminRequestId, creatorRequestId]],
      );
      expect(createdRequests.rows).toHaveLength(2);
      expect(createdRequests.rows.find((row) => row.id === adminRequestId))
        .toMatchObject({
          created_by_user_id: admin.profileId,
          delivered_quantity: "0",
          product_id: null,
          requested_name: "New Component by Admin",
          requested_quantity: "5",
          resolved_at: null,
          resolved_by_user_id: null,
          status: "active",
          supplier_id: supplierIds[0],
          updated_by_user_id: admin.profileId,
        });
      expect(createdRequests.rows.find((row) => row.id === creatorRequestId))
        .toMatchObject({
          created_by_user_id: creator.profileId,
          product_id: null,
          requested_name: "Worker New Component",
          requested_quantity: "11",
          updated_by_user_id: creator.profileId,
        });
      for (const row of createdRequests.rows) {
        expect(row.created_at).toEqual(row.updated_at);
      }

      const audits = await database.query<CreatedAuditRow>(
        `select action_type, actor_user_id, after_data, entity_id,
                entity_type, metadata
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type = 'procurement.created'`,
        [[adminRequestId, creatorRequestId]],
      );
      expect(audits.rows).toHaveLength(2);
      expect(audits.rows.find((audit) => audit.entity_id === creatorRequestId))
        .toMatchObject({
          action_type: "procurement.created",
          actor_user_id: creator.profileId,
          entity_type: "procurement_request",
          after_data: {
            delivered_quantity: 0,
            product_id: null,
            requested_name: "Worker New Component",
            requested_quantity: 11,
            status: "active",
            supplier_id: supplierIds[0],
          },
        });

      for (const [index, actor] of [
        viewerOnly,
        editOnly,
        statusOnly,
        resolveOnly,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ].entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_new_component_${index}`);
        await expect(database.query(
          `select public.create_procurement_request_for_new_component(
             'Denied', $1::uuid, 1
           )`,
          [supplierIds[0]],
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_new_component_${index}`);
        await database.query("reset role");
      }
      await database.query("set local role anon");
      await database.query("savepoint anonymous_new_component");
      await expect(database.query(
        `select public.create_procurement_request_for_new_component(
           'Denied', $1::uuid, 1
         )`,
        [supplierIds[0]],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_new_component");
      await database.query("reset role");

      const rejectedInputs: Array<{
        code: string;
        name: string | null;
        quantity: number | null;
        supplierId: string | null;
      }> = [
        { name: "", supplierId: supplierIds[0]!, quantity: 1, code: "22023" },
        { name: "   ", supplierId: supplierIds[0]!, quantity: 1, code: "22023" },
        { name: null, supplierId: supplierIds[0]!, quantity: 1, code: "22023" },
        { name: "Missing Supplier", supplierId: null, quantity: 1, code: "22023" },
        { name: "Missing Supplier", supplierId: randomUUID(), quantity: 1, code: "PRQ04" },
        { name: "Archived Supplier", supplierId: supplierIds[1]!, quantity: 1, code: "PRQ04" },
        { name: "Zero", supplierId: supplierIds[0]!, quantity: 0, code: "22023" },
        { name: "Negative", supplierId: supplierIds[0]!, quantity: -1, code: "22023" },
      ];
      for (const [index, rejected] of rejectedInputs.entries()) {
        const before = await database.query<CountResultRow>(
          `select (
             select count(*)::integer from public.procurement_requests
           ) + (
             select count(*)::integer from public.audit_logs
             where action_type = 'procurement.created'
           ) as count`,
        );
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint rejected_new_component_${index}`);
        await expect(database.query(
          `select public.create_procurement_request_for_new_component(
             $1::text, $2::uuid, $3::bigint
           )`,
          [rejected.name, rejected.supplierId, rejected.quantity],
        )).rejects.toMatchObject({ code: rejected.code });
        await database.query(`rollback to savepoint rejected_new_component_${index}`);
        await database.query("reset role");
        const after = await database.query<CountResultRow>(
          `select (
             select count(*)::integer from public.procurement_requests
           ) + (
             select count(*)::integer from public.audit_logs
             where action_type = 'procurement.created'
           ) as count`,
        );
        expect(after.rows).toEqual(before.rows);
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [creator.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint direct_new_component_insert");
      await expect(database.query(
        `insert into public.procurement_requests (
           product_id, requested_name, supplier_id, requested_quantity,
           created_by_user_id, updated_by_user_id
         ) values (null, 'Direct', $1, 1, $2, $2)`,
        [supplierIds[0], creator.profileId],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint direct_new_component_insert");
      await database.query("reset role");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [creator.authUserId],
      );
      await database.query("set local role authenticated");
      const existingProductRequest = await database.query<{ request_id: string }>(
        `select public.create_procurement_request_for_product(
           $1::uuid, $2::uuid, 2
         ) as request_id`,
        [productId, supplierIds[0]],
      );
      await database.query("reset role");
      expect(existingProductRequest.rows[0]?.request_id).toBeTruthy();

      await database.query(
        `create function public.test_reject_new_component_procurement_audit()
         returns trigger
         language plpgsql
         set search_path = ''
         as $test_function$
         begin
           if new.action_type = 'procurement.created'
             and new.after_data ->> 'product_id' is null
           then
             raise exception 'Test new-component audit rejection'
               using errcode = 'TST01';
           end if;

           return new;
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_reject_new_component_procurement_audit
         before insert on public.audit_logs
         for each row
         execute function public.test_reject_new_component_procurement_audit()`,
      );
      const requestCountBeforeFailure = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.procurement_requests",
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint rejected_new_component_audit");
      await expect(database.query(
        `select public.create_procurement_request_for_new_component(
           'Rollback Component', $1::uuid, 3
         )`,
        [supplierIds[0]],
      )).rejects.toMatchObject({ code: "TST01" });
      await database.query("rollback to savepoint rejected_new_component_audit");
      await database.query("reset role");
      expect((await database.query<CountResultRow>(
        "select count(*)::integer as count from public.procurement_requests",
      )).rows).toEqual(requestCountBeforeFailure.rows);

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
           and routine.proname = 'create_procurement_request_for_new_component'`,
      );
      expect(functionSecurity.rows).toHaveLength(1);
      expect(functionSecurity.rows[0]).toMatchObject({
        anonymous_execute: false,
        authenticated_execute: true,
        identity_arguments:
          "p_requested_name text, p_supplier_id uuid, p_requested_quantity bigint",
        security_definer: true,
        settings: ["search_path=\"\""],
      });
      const definition = functionSecurity.rows[0]?.definition ?? "";
      expect(definition.toLowerCase()).toContain("for share");
      expect(definition).toContain("procurement.create");
      expect(definition).not.toContain("allocate_product_serial_number");
      expect(definition).not.toContain("inventory_balances");
      expect(definition).not.toContain("inventory_movements");
      expect(definition).not.toContain("product_suppliers");

      const sideEffectsAfter = await database.query<Record<string, unknown>>(
        `select
           (select count(*)::text from public.products) as products,
           (select count(*)::text from public.product_suppliers) as product_suppliers,
           (select count(*)::text from public.inventory_balances) as balances,
           (select count(*)::text from public.inventory_movements) as movements,
           (select last_value::text from public.product_serial_number_seq) as serial_last_value`,
      );
      expect(sideEffectsAfter.rows).toEqual(sideEffectsBefore.rows);
    });

    expectPermissionDenied((await viewerOnly.client.rpc(
      "create_procurement_request_for_new_component",
      {
        p_requested_name: "Denied",
        p_supplier_id: supplierIds[0],
        p_requested_quantity: 1,
      },
    )).error);
    expectPermissionDenied((await fixture.anonymousClient.rpc(
      "create_procurement_request_for_new_component",
      {
        p_requested_name: "Denied",
        p_supplier_id: supplierIds[0],
        p_requested_quantity: 1,
      },
    )).error);
  });

}
