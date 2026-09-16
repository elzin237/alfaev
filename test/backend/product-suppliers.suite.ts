import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { expect, it } from "vitest";
import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityFixtureHarness } from "./security-fixtures";
import { createTestSerialNumber } from "./helpers/serial";

interface CountResultRow {
  count: number;
}

interface ProductAuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown> | null;
  before_data: Record<string, unknown> | null;
  entity_id: string;
  entity_type: string;
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

interface ProductSupplierReadRow {
  catalog_number: string | null;
  relationship_id: string;
  relationship_is_active: boolean;
  supplier_id: string;
  supplier_is_active: boolean;
  supplier_name: string;
}

interface ProductSupplierChoiceRow {
  supplier_id: string;
  supplier_name: string;
}

interface SupplierProductReadRow {
  catalog_number: string | null;
  product_id: string;
  product_is_active: boolean;
  product_name: string;
  product_serial_number: string;
  relationship_id: string;
  relationship_is_active: boolean;
}

interface SupplierProductChoiceRow {
  product_id: string;
  product_name: string;
  product_serial_number: string;
}

async function createProductSupplierEndpoints(
  database: PoolClient,
  actorId: string,
  options: { productActive?: boolean; supplierActive?: boolean } = {},
): Promise<{ productId: string; supplierId: string }> {
  const productId = randomUUID();
  const supplierId = randomUUID();
  const productActive = options.productActive ?? true;
  const supplierActive = options.supplierActive ?? true;

  await database.query(
    `insert into public.products (
       id,
       serial_number,
       name,
       category,
       product_kind,
       is_active,
       created_by_user_id,
       updated_by_user_id,
       archived_at,
       archived_by_user_id
     )
     values (
       $1::uuid,
       $2::text,
       $3::text,
       'Components',
       'component',
       $4::boolean,
       $5::uuid,
       $5::uuid,
       case when $4::boolean then null else pg_catalog.now() end,
       case when $4::boolean then null else $5::uuid end
     )`,
    [
      productId,
      createTestSerialNumber(),
      `ProductSupplier Endpoint ${randomUUID()}`,
      productActive,
      actorId,
    ],
  );
  await database.query(
    `insert into public.suppliers (
       id,
       name,
       country,
       is_active,
       created_by_user_id,
       updated_by_user_id,
       archived_at,
       archived_by_user_id
     )
     values (
       $1::uuid,
       $2::text,
       'Germany',
       $3::boolean,
       $4::uuid,
       $4::uuid,
       case when $3::boolean then null else pg_catalog.now() end,
       case when $3::boolean then null else $4::uuid end
     )`,
    [
      supplierId,
      `ProductSupplier Endpoint ${randomUUID()}`,
      supplierActive,
      actorId,
    ],
  );

  return { productId, supplierId };
}

export function registerProductSuppliersTests(requireHarness: () => SecurityFixtureHarness): void {
  it("enforces ProductSupplier schema, duplicate, FK, and lifecycle invariants", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const productOneId = randomUUID();
      const productTwoId = randomUUID();
      const supplierId = randomUUID();
      const nullCatalogRelationId = randomUUID();
      const catalogRelationId = randomUUID();
      const differentCatalogRelationId = randomUUID();
      const sharedCatalogRelationId = randomUUID();
      const productOneSerial = createTestSerialNumber();
      let productTwoSerial = createTestSerialNumber();

      while (productTwoSerial === productOneSerial) {
        productTwoSerial = createTestSerialNumber();
      }

      await database.query(
        `insert into public.suppliers (
           id,
           name,
           country,
           created_by_user_id,
           updated_by_user_id
         )
         values ($1::uuid, $2::text, 'Germany', $3::uuid, $3::uuid)`,
        [supplierId, `ProductSupplier Test ${randomUUID()}`, actorId],
      );
      await database.query(
        `insert into public.products (
           id,
           serial_number,
           name,
           category,
           product_kind,
           created_by_user_id,
           updated_by_user_id
         )
         values
           ($1::uuid, $2::text, 'Linked Product One', 'Components',
            'component', $5::uuid, $5::uuid),
           ($3::uuid, $4::text, 'Linked Product Two', 'Components',
            'component', $5::uuid, $5::uuid)`,
        [
          productOneId,
          productOneSerial,
          productTwoId,
          productTwoSerial,
          actorId,
        ],
      );
      await database.query(
        `insert into public.product_suppliers (
           id,
           product_id,
           supplier_id,
           catalog_number,
           created_by_user_id,
           updated_by_user_id
         )
         values
           ($1::uuid, $5::uuid, $7::uuid, null, $8::uuid, $8::uuid),
           ($2::uuid, $5::uuid, $7::uuid, 'Cat-AbC', $8::uuid, $8::uuid),
           ($3::uuid, $5::uuid, $7::uuid, 'CAT-OTHER', $8::uuid, $8::uuid),
           ($4::uuid, $6::uuid, $7::uuid, 'Cat-AbC', $8::uuid, $8::uuid)`,
        [
          nullCatalogRelationId,
          catalogRelationId,
          differentCatalogRelationId,
          sharedCatalogRelationId,
          productOneId,
          productTwoId,
          supplierId,
          actorId,
        ],
      );

      const validRows = await database.query<ProductSupplierRow>(
        `select *
         from public.product_suppliers
         where id = any($1::uuid[])
         order by id`,
        [[
          nullCatalogRelationId,
          catalogRelationId,
          differentCatalogRelationId,
          sharedCatalogRelationId,
        ]],
      );
      const nullCatalog = validRows.rows.find(
        (row) => row.id === nullCatalogRelationId,
      );
      const preservedCase = validRows.rows.find(
        (row) => row.id === catalogRelationId,
      );

      expect(validRows.rows).toHaveLength(4);
      expect(nullCatalog).toMatchObject({
        archived_at: null,
        archived_by_user_id: null,
        catalog_number: null,
        is_active: true,
        product_id: productOneId,
        supplier_id: supplierId,
      });
      expect(nullCatalog?.created_at).toEqual(nullCatalog?.updated_at);
      expect(preservedCase?.catalog_number).toBe("Cat-AbC");

      for (const catalogNumber of [null, "Cat-AbC"] as const) {
        await database.query("savepoint duplicate_product_supplier");
        await expect(
          database.query(
            `insert into public.product_suppliers (
               product_id,
               supplier_id,
               catalog_number,
               created_by_user_id,
               updated_by_user_id
             )
             values ($1::uuid, $2::uuid, $3::text, $4::uuid, $4::uuid)`,
            [productOneId, supplierId, catalogNumber, actorId],
          ),
        ).rejects.toMatchObject({ code: "23505" });
        await database.query("rollback to savepoint duplicate_product_supplier");
      }

      for (const catalogNumber of ["", "   ", " Untrimmed"] as const) {
        await database.query("savepoint invalid_product_supplier_catalog");
        await expect(
          database.query(
            `insert into public.product_suppliers (
               product_id,
               supplier_id,
               catalog_number,
               created_by_user_id,
               updated_by_user_id
             )
             values ($1::uuid, $2::uuid, $3::text, $4::uuid, $4::uuid)`,
            [productTwoId, supplierId, catalogNumber, actorId],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await database.query("rollback to savepoint invalid_product_supplier_catalog");
      }

      for (const [isActive, archivedAt, archivedBy] of [
        [true, new Date(), actorId],
        [false, null, null],
      ] as const) {
        await database.query("savepoint invalid_product_supplier_lifecycle");
        await expect(
          database.query(
            `insert into public.product_suppliers (
               product_id,
               supplier_id,
               catalog_number,
               is_active,
               created_by_user_id,
               updated_by_user_id,
               archived_at,
               archived_by_user_id
             )
             values ($1::uuid, $2::uuid, $3::text, $4::boolean,
                     $5::uuid, $5::uuid, $6::timestamptz, $7::uuid)`,
            [
              productTwoId,
              supplierId,
              `STATE-${randomUUID()}`,
              isActive,
              actorId,
              archivedAt,
              archivedBy,
            ],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await database.query("rollback to savepoint invalid_product_supplier_lifecycle");
      }

      await database.query(
        `update public.product_suppliers
         set is_active = false,
             updated_at = pg_catalog.now(),
             updated_by_user_id = $2::uuid,
             archived_at = pg_catalog.now(),
             archived_by_user_id = $2::uuid
         where id = $1::uuid`,
        [catalogRelationId, actorId],
      );
      const archivedBefore = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [catalogRelationId],
      );

      expect(archivedBefore.rows[0]).toMatchObject({
        archived_by_user_id: actorId,
        catalog_number: "Cat-AbC",
        is_active: false,
      });
      expect(archivedBefore.rows[0]?.archived_at).toBeInstanceOf(Date);

      await database.query("savepoint immutable_archived_product_supplier");
      await expect(
        database.query(
          `update public.product_suppliers
           set catalog_number = 'FORBIDDEN'
           where id = $1::uuid`,
          [catalogRelationId],
        ),
      ).rejects.toMatchObject({ code: "PSR01" });
      await database.query("rollback to savepoint immutable_archived_product_supplier");

      const archivedAfter = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [catalogRelationId],
      );
      expect(archivedAfter.rows).toEqual(archivedBefore.rows);

      await database.query("savepoint referenced_product_delete");
      await expect(
        database.query(
          "delete from public.products where id = $1::uuid",
          [productOneId],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await database.query("rollback to savepoint referenced_product_delete");

      await database.query("savepoint referenced_supplier_delete");
      await expect(
        database.query(
          "delete from public.suppliers where id = $1::uuid",
          [supplierId],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await database.query("rollback to savepoint referenced_supplier_delete");

      const tableSecurity = await database.query<{
        authenticated_delete: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        row_security: boolean;
      }>(
        `select
           table_info.relrowsecurity as row_security,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'select') as authenticated_select,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'insert') as authenticated_insert,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'update') as authenticated_update,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'delete') as authenticated_delete
         from pg_catalog.pg_class as table_info
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = table_info.relnamespace
         where namespace.nspname = 'public'
           and table_info.relname = 'product_suppliers'`,
      );
      const duplicateConstraint = await database.query<{
        nulls_not_distinct: boolean;
      }>(
        `select index_info.indnullsnotdistinct as nulls_not_distinct
         from pg_catalog.pg_index as index_info
         join pg_catalog.pg_class as index_object
           on index_object.oid = index_info.indexrelid
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = index_object.relnamespace
         where namespace.nspname = 'public'
           and index_object.relname = 'product_suppliers_product_supplier_catalog_key'`,
      );
      const lifecycleFunction = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        settings: string[];
      }>(
        `select
           routine.proconfig as settings,
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'enforce_product_supplier_lifecycle_immutability'`,
      );
      const unsupportedMutationFunctions = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'delete_product_supplier',
             'restore_product_supplier',
             'reactivate_product_supplier',
             'unarchive_product_supplier'
           )`,
      );

      expect(tableSecurity.rows).toEqual([
        {
          authenticated_delete: false,
          authenticated_insert: false,
          authenticated_select: true,
          authenticated_update: false,
          row_security: true,
        },
      ]);
      expect(duplicateConstraint.rows).toEqual([{ nulls_not_distinct: true }]);
      expect(lifecycleFunction.rows).toEqual([
        {
          anonymous_execute: false,
          authenticated_execute: false,
          settings: ["search_path=\"\""],
        },
      ]);
      expect(unsupportedMutationFunctions.rows).toEqual([{ count: 0 }]);
    });
  });
  it("allows either ProductSupplier view permission and denies all direct client writes", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const productId = randomUUID();
      const supplierId = randomUUID();
      const activeRelationId = randomUUID();
      const archivedRelationId = randomUUID();

      await database.query(
        `insert into public.suppliers (
           id,
           name,
           country,
           created_by_user_id,
           updated_by_user_id
         )
         values ($1::uuid, $2::text, 'Germany', $3::uuid, $3::uuid)`,
        [supplierId, `RLS Supplier ${randomUUID()}`, actorId],
      );
      await database.query(
        `insert into public.products (
           id,
           serial_number,
           name,
           category,
           product_kind,
           created_by_user_id,
           updated_by_user_id
         )
         values ($1::uuid, $2::text, 'RLS Product', 'Components',
                 'component', $3::uuid, $3::uuid)`,
        [productId, createTestSerialNumber(), actorId],
      );
      await database.query(
        `insert into public.product_suppliers (
           id,
           product_id,
           supplier_id,
           catalog_number,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $3::uuid, $4::uuid, 'ACTIVE', true,
            $5::uuid, $5::uuid, null, null),
           ($2::uuid, $3::uuid, $4::uuid, 'ARCHIVED', false,
            $5::uuid, $5::uuid, pg_catalog.now(), $5::uuid)`,
        [activeRelationId, archivedRelationId, productId, supplierId, actorId],
      );

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.brandManager,
        fixture.actors.supplierViewer,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ id: string }>(
          `select id
           from public.product_suppliers
           where id = any($1::uuid[])
           order by id`,
          [[activeRelationId, archivedRelationId]],
        );
        await database.query("reset role");

        expect(visible.rows.map((row) => row.id).sort()).toEqual(
          [activeRelationId, archivedRelationId].sort(),
        );
      }

      for (const actor of [
        fixture.actors.productCreator,
        fixture.actors.productEditor,
        fixture.actors.supplierEditor,
        fixture.actors.unpermitted,
        fixture.actors.inactiveBrandManager,
        fixture.actors.inactiveSupplierManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ id: string }>(
          `select id
           from public.product_suppliers
           where id = any($1::uuid[])`,
          [[activeRelationId, archivedRelationId]],
        );
        await database.query("reset role");

        expect(hidden.rows).toEqual([]);
      }

      await database.query("savepoint anonymous_product_supplier_read");
      await database.query("set local role anon");
      await expect(
        database.query("select id from public.product_suppliers limit 1"),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_product_supplier_read");
      await database.query("reset role");
    });

    const client = fixture.actors.supplierViewer.client;
    const directInsert = await client.from("product_suppliers").insert({
      product_id: randomUUID(),
      supplier_id: randomUUID(),
      catalog_number: "DIRECT",
      created_by_user_id: fixture.actors.supplierViewer.profileId,
      updated_by_user_id: fixture.actors.supplierViewer.profileId,
    });
    const directUpdate = await client
      .from("product_suppliers")
      .update({ catalog_number: "FORBIDDEN" })
      .eq("id", randomUUID());
    const directDelete = await client
      .from("product_suppliers")
      .delete()
      .eq("id", randomUUID());

    expectPermissionDenied(directInsert.error);
    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);
  });
  it("exposes only minimal trusted ProductSupplier reads without broadening Supplier RLS", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const endpoints = await createProductSupplierEndpoints(database, actorId);
      const archivedSupplierId = randomUUID();
      const activeRelationId = randomUUID();
      const archivedRelationId = randomUUID();
      const activeSupplierName = `Active Choice ${randomUUID()}`;
      const archivedSupplierName = `Archived History ${randomUUID()}`;

      await database.query(
        `update public.suppliers
         set name = $2::text
         where id = $1::uuid`,
        [endpoints.supplierId, activeSupplierName],
      );
      await database.query(
        `insert into public.suppliers (
           id,
           name,
           country,
           contact_person_name,
           contact_phone,
           contact_email,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values (
           $1::uuid,
           $2::text,
           'Secret Country',
           'Secret Contact',
           '+000000000',
           'secret@example.com',
           false,
           $3::uuid,
           $3::uuid,
           pg_catalog.now(),
           $3::uuid
         )`,
        [archivedSupplierId, archivedSupplierName, actorId],
      );
      await database.query(
        `insert into public.product_suppliers (
           id,
           product_id,
           supplier_id,
           catalog_number,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $3::uuid, $4::uuid, 'ACTIVE-CAT', true,
            $6::uuid, $6::uuid, null, null),
           ($2::uuid, $3::uuid, $5::uuid, null, false,
            $6::uuid, $6::uuid, pg_catalog.now(), $6::uuid)`,
        [
          activeRelationId,
          archivedRelationId,
          endpoints.productId,
          endpoints.supplierId,
          archivedSupplierId,
          actorId,
        ],
      );

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.brandManager,
        fixture.actors.supplierViewer,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const rows = await database.query<ProductSupplierReadRow>(
          `select *
           from public.get_product_suppliers_for_product($1::uuid)`,
          [endpoints.productId],
        );
        await database.query("reset role");

        expect(rows.rows).toEqual([
          {
            catalog_number: "ACTIVE-CAT",
            relationship_id: activeRelationId,
            relationship_is_active: true,
            supplier_id: endpoints.supplierId,
            supplier_is_active: true,
            supplier_name: activeSupplierName,
          },
          {
            catalog_number: null,
            relationship_id: archivedRelationId,
            relationship_is_active: false,
            supplier_id: archivedSupplierId,
            supplier_is_active: false,
            supplier_name: archivedSupplierName,
          },
        ]);
        expect(Object.keys(rows.rows[0] ?? {}).sort()).toEqual([
          "catalog_number",
          "relationship_id",
          "relationship_is_active",
          "supplier_id",
          "supplier_is_active",
          "supplier_name",
        ]);
      }

      for (const actor of [
        fixture.actors.productCreator,
        fixture.actors.productEditor,
        fixture.actors.supplierEditor,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        fixture.actors.inactiveSupplierManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query("savepoint denied_product_supplier_read_rpc");
        await expect(
          database.query(
            "select * from public.get_product_suppliers_for_product($1::uuid)",
            [endpoints.productId],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint denied_product_supplier_read_rpc");
        await database.query("reset role");
      }

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.productEditor,
        fixture.actors.supplierEditor,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const choices = await database.query<ProductSupplierChoiceRow>(
          `select *
           from public.list_active_supplier_choices_for_product_supplier()`,
        );
        await database.query("reset role");

        expect(choices.rows).toContainEqual({
          supplier_id: endpoints.supplierId,
          supplier_name: activeSupplierName,
        });
        expect(choices.rows).not.toContainEqual({
          supplier_id: archivedSupplierId,
          supplier_name: archivedSupplierName,
        });
        expect(Object.keys(choices.rows[0] ?? {}).sort()).toEqual([
          "supplier_id",
          "supplier_name",
        ]);

        const sortedChoices = [...choices.rows].sort((left, right) =>
          left.supplier_name.localeCompare(right.supplier_name, undefined, {
            sensitivity: "base",
          }) || left.supplier_name.localeCompare(right.supplier_name) ||
          left.supplier_id.localeCompare(right.supplier_id));
        expect(choices.rows).toEqual(sortedChoices);
      }

      for (const actor of [
        fixture.actors.brandManager,
        fixture.actors.supplierViewer,
        fixture.actors.productCreator,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        fixture.actors.inactiveSupplierManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query("savepoint denied_supplier_choice_rpc");
        await expect(
          database.query(
            "select * from public.list_active_supplier_choices_for_product_supplier()",
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint denied_supplier_choice_rpc");
        await database.query("reset role");
      }

      for (const actor of [
        fixture.actors.brandManager,
        fixture.actors.productEditor,
        fixture.actors.supplierEditor,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hiddenSuppliers = await database.query<{ id: string }>(
          `select id
           from public.suppliers
           where id = any($1::uuid[])`,
          [[endpoints.supplierId, archivedSupplierId]],
        );
        await database.query("reset role");

        expect(hiddenSuppliers.rows).toEqual([]);
      }

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        name: string;
        settings: string[];
      }>(
        `select
           routine.proname as name,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'get_product_suppliers_for_product',
             'list_active_supplier_choices_for_product_supplier'
           )
         order by routine.proname`,
      );

      expect(functionSecurity.rows).toEqual([
        {
          anonymous_execute: false,
          authenticated_execute: true,
          is_security_definer: true,
          name: "get_product_suppliers_for_product",
          settings: ["search_path=\"\""],
        },
        {
          anonymous_execute: false,
          authenticated_execute: true,
          is_security_definer: true,
          name: "list_active_supplier_choices_for_product_supplier",
          settings: ["search_path=\"\""],
        },
      ]);
    });

    const anonymousRelationshipRead = await fixture.anonymousClient.rpc(
      "get_product_suppliers_for_product",
      { p_product_id: randomUUID() },
    );
    const anonymousChoices = await fixture.anonymousClient.rpc(
      "list_active_supplier_choices_for_product_supplier",
    );

    expectPermissionDenied(anonymousRelationshipRead.error);
    expectPermissionDenied(anonymousChoices.error);
  });
  it("exposes only minimal Supplier-side Product reads without broadening Product RLS", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const activeEndpoints = await createProductSupplierEndpoints(database, actorId);
      const archivedEndpoints = await createProductSupplierEndpoints(database, actorId, {
        productActive: false,
      });
      const activeRelationId = randomUUID();
      const archivedRelationId = randomUUID();
      const activeProductName = `Active Product ${randomUUID()}`;

      await database.query(
        `update public.products
         set name = $2::text
         where id = $1::uuid`,
        [activeEndpoints.productId, activeProductName],
      );
      const activeProduct = await database.query<{
        serial_number: string;
      }>(
        "select serial_number from public.products where id = $1::uuid",
        [activeEndpoints.productId],
      );
      const archivedProduct = await database.query<{
        name: string;
        serial_number: string;
      }>(
        "select name, serial_number from public.products where id = $1::uuid",
        [archivedEndpoints.productId],
      );

      await database.query(
        `insert into public.product_suppliers (
           id,
           product_id,
           supplier_id,
           catalog_number,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $3::uuid, $5::uuid, 'ACTIVE-CAT', true,
            $6::uuid, $6::uuid, null, null),
           ($2::uuid, $4::uuid, $5::uuid, null, false,
            $6::uuid, $6::uuid, pg_catalog.now(), $6::uuid)`,
        [
          activeRelationId,
          archivedRelationId,
          activeEndpoints.productId,
          archivedEndpoints.productId,
          activeEndpoints.supplierId,
          actorId,
        ],
      );

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.brandManager,
        fixture.actors.supplierViewer,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const rows = await database.query<SupplierProductReadRow>(
          "select * from public.get_product_suppliers_for_supplier($1::uuid)",
          [activeEndpoints.supplierId],
        );
        await database.query("reset role");

        expect(rows.rows).toEqual([
          {
            catalog_number: "ACTIVE-CAT",
            product_id: activeEndpoints.productId,
            product_is_active: true,
            product_name: activeProductName,
            product_serial_number: activeProduct.rows[0]?.serial_number,
            relationship_id: activeRelationId,
            relationship_is_active: true,
          },
          {
            catalog_number: null,
            product_id: archivedEndpoints.productId,
            product_is_active: false,
            product_name: archivedProduct.rows[0]?.name,
            product_serial_number: archivedProduct.rows[0]?.serial_number,
            relationship_id: archivedRelationId,
            relationship_is_active: false,
          },
        ]);
        expect(Object.keys(rows.rows[0] ?? {}).sort()).toEqual([
          "catalog_number",
          "product_id",
          "product_is_active",
          "product_name",
          "product_serial_number",
          "relationship_id",
          "relationship_is_active",
        ]);
      }

      for (const actor of [
        fixture.actors.productCreator,
        fixture.actors.productEditor,
        fixture.actors.supplierEditor,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        fixture.actors.inactiveSupplierManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query("savepoint denied_supplier_product_read_rpc");
        await expect(
          database.query(
            "select * from public.get_product_suppliers_for_supplier($1::uuid)",
            [activeEndpoints.supplierId],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint denied_supplier_product_read_rpc");
        await database.query("reset role");
      }

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.productEditor,
        fixture.actors.supplierEditor,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const choices = await database.query<SupplierProductChoiceRow>(
          "select * from public.list_active_product_choices_for_product_supplier()",
        );
        await database.query("reset role");

        expect(choices.rows).toContainEqual({
          product_id: activeEndpoints.productId,
          product_name: activeProductName,
          product_serial_number: activeProduct.rows[0]?.serial_number,
        });
        expect(choices.rows.some((row) =>
          row.product_id === archivedEndpoints.productId)).toBe(false);
        expect(Object.keys(choices.rows[0] ?? {}).sort()).toEqual([
          "product_id",
          "product_name",
          "product_serial_number",
        ]);
        expect(choices.rows).toEqual([...choices.rows].sort((left, right) =>
          left.product_serial_number.localeCompare(right.product_serial_number) ||
          left.product_id.localeCompare(right.product_id)));
      }

      for (const actor of [
        fixture.actors.brandManager,
        fixture.actors.supplierViewer,
        fixture.actors.productCreator,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        fixture.actors.inactiveSupplierManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query("savepoint denied_product_choice_rpc");
        await expect(
          database.query(
            "select * from public.list_active_product_choices_for_product_supplier()",
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint denied_product_choice_rpc");
        await database.query("reset role");
      }

      for (const actor of [
        fixture.actors.supplierViewer,
        fixture.actors.supplierEditor,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hiddenProducts = await database.query<{ id: string }>(
          "select id from public.products where id = any($1::uuid[])",
          [[activeEndpoints.productId, archivedEndpoints.productId]],
        );
        await database.query("reset role");
        expect(hiddenProducts.rows).toEqual([]);
      }

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        name: string;
        settings: string[];
      }>(
        `select
           routine.proname as name,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'get_product_suppliers_for_supplier',
             'list_active_product_choices_for_product_supplier'
           )
         order by routine.proname`,
      );
      expect(functionSecurity.rows).toEqual([
        {
          anonymous_execute: false,
          authenticated_execute: true,
          is_security_definer: true,
          name: "get_product_suppliers_for_supplier",
          settings: ["search_path=\"\""],
        },
        {
          anonymous_execute: false,
          authenticated_execute: true,
          is_security_definer: true,
          name: "list_active_product_choices_for_product_supplier",
          settings: ["search_path=\"\""],
        },
      ]);
    });

    const anonymousRelationshipRead = await fixture.anonymousClient.rpc(
      "get_product_suppliers_for_supplier",
      { p_supplier_id: randomUUID() },
    );
    const anonymousChoices = await fixture.anonymousClient.rpc(
      "list_active_product_choices_for_product_supplier",
    );
    expectPermissionDenied(anonymousRelationshipRead.error);
    expectPermissionDenied(anonymousChoices.error);
  });
  it("lets Admin create, edit, and archive ProductSupplier history with trusted audit", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const endpoints = await createProductSupplierEndpoints(
        database,
        actor.profileId,
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ relation_id: string }>(
        `select public.create_product_supplier(
           $1::uuid,
           $2::uuid,
           '  Cat-AbC  '
         ) as relation_id`,
        [endpoints.productId, endpoints.supplierId],
      );
      await database.query("reset role");
      const relationId = created.rows[0]?.relation_id;

      expect(relationId).toBeTypeOf("string");
      const afterCreate = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [relationId],
      );
      expect(afterCreate.rows[0]).toMatchObject({
        archived_at: null,
        archived_by_user_id: null,
        catalog_number: "Cat-AbC",
        created_by_user_id: actor.profileId,
        is_active: true,
        product_id: endpoints.productId,
        supplier_id: endpoints.supplierId,
        updated_by_user_id: actor.profileId,
      });
      expect(afterCreate.rows[0]?.created_at)
        .toEqual(afterCreate.rows[0]?.updated_at);

      await database.query("set local role authenticated");
      const updated = await database.query<{ relation_id: string }>(
        `select public.update_product_supplier(
           $1::uuid,
           '  Next-Catalog  '
         ) as relation_id`,
        [relationId],
      );
      await database.query("reset role");
      const afterUpdate = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [relationId],
      );

      expect(updated.rows).toEqual([{ relation_id: relationId }]);
      expect(afterUpdate.rows[0]).toMatchObject({
        catalog_number: "Next-Catalog",
        product_id: endpoints.productId,
        supplier_id: endpoints.supplierId,
        updated_by_user_id: actor.profileId,
      });

      const updatedAuditBeforeNoop = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product_supplier.updated'`,
        [relationId],
      );
      await database.query("set local role authenticated");
      const noop = await database.query<{ relation_id: string }>(
        `select public.update_product_supplier(
           $1::uuid,
           ' Next-Catalog '
         ) as relation_id`,
        [relationId],
      );
      await database.query("reset role");
      const afterNoop = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [relationId],
      );
      const updatedAuditAfterNoop = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product_supplier.updated'`,
        [relationId],
      );

      expect(noop.rows).toEqual([{ relation_id: relationId }]);
      expect(afterNoop.rows).toEqual(afterUpdate.rows);
      expect(updatedAuditAfterNoop.rows).toEqual(updatedAuditBeforeNoop.rows);

      await database.query("set local role authenticated");
      const archived = await database.query<{ relation_id: string }>(
        `select public.archive_product_supplier($1::uuid) as relation_id`,
        [relationId],
      );
      await database.query("reset role");
      const afterArchive = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [relationId],
      );

      expect(archived.rows).toEqual([{ relation_id: relationId }]);
      expect(afterArchive.rows[0]).toMatchObject({
        archived_by_user_id: actor.profileId,
        catalog_number: "Next-Catalog",
        is_active: false,
        product_id: endpoints.productId,
        supplier_id: endpoints.supplierId,
        updated_by_user_id: actor.profileId,
      });
      expect(afterArchive.rows[0]?.archived_at).toBeInstanceOf(Date);
      expect(afterArchive.rows[0]?.updated_at)
        .toEqual(afterArchive.rows[0]?.archived_at);

      await database.query("set local role authenticated");
      await database.query("savepoint repeated_product_supplier_archive");
      await expect(
        database.query(
          "select public.archive_product_supplier($1::uuid)",
          [relationId],
        ),
      ).rejects.toMatchObject({ code: "PSR01" });
      await database.query("rollback to savepoint repeated_product_supplier_archive");
      await database.query("savepoint archived_product_supplier_edit");
      await expect(
        database.query(
          "select public.update_product_supplier($1::uuid, 'FORBIDDEN')",
          [relationId],
        ),
      ).rejects.toMatchObject({ code: "PSR01" });
      await database.query("rollback to savepoint archived_product_supplier_edit");
      await database.query("reset role");

      const afterFailures = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [relationId],
      );
      const audits = await database.query<ProductAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in (
             'product_supplier.created',
             'product_supplier.updated',
             'product_supplier.archived'
           )
         order by pg_catalog.array_position(
           array[
             'product_supplier.created',
             'product_supplier.updated',
             'product_supplier.archived'
           ]::text[],
           action_type
         )`,
        [relationId],
      );

      expect(afterFailures.rows).toEqual(afterArchive.rows);
      expect(audits.rows).toHaveLength(3);
      expect(audits.rows.map((row) => row.action_type)).toEqual([
        "product_supplier.created",
        "product_supplier.updated",
        "product_supplier.archived",
      ]);
      expect(audits.rows.every((row) =>
        row.actor_user_id === actor.profileId &&
        row.entity_type === "product_supplier" &&
        row.entity_id === relationId
      )).toBe(true);
      expect(audits.rows[0]?.after_data).toEqual({
        catalog_number: "Cat-AbC",
        is_active: true,
        product_id: endpoints.productId,
        supplier_id: endpoints.supplierId,
      });
      expect(audits.rows[1]).toMatchObject({
        before_data: {
          catalog_number: "Cat-AbC",
          is_active: true,
          product_id: endpoints.productId,
          supplier_id: endpoints.supplierId,
        },
        after_data: {
          catalog_number: "Next-Catalog",
          is_active: true,
          product_id: endpoints.productId,
          supplier_id: endpoints.supplierId,
        },
      });
      expect(audits.rows[2]?.after_data).toMatchObject({
        archived_by_user_id: actor.profileId,
        catalog_number: "Next-Catalog",
        is_active: false,
        product_id: endpoints.productId,
        supplier_id: endpoints.supplierId,
      });

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        arguments: string;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        name: string;
        result_type: string;
        settings: string[];
      }>(
        `select
           routine.proname as name,
           pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
           pg_catalog.pg_get_function_result(routine.oid) as result_type,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'archive_product_supplier',
             'create_product_supplier',
             'current_product_supplier_mutation_actor_id',
             'update_product_supplier'
           )
         order by routine.proname`,
      );

      expect(functionSecurity.rows).toEqual([
        {
          anonymous_execute: false,
          arguments: "p_product_supplier_id uuid",
          authenticated_execute: true,
          is_security_definer: true,
          name: "archive_product_supplier",
          result_type: "uuid",
          settings: ["search_path=\"\""],
        },
        {
          anonymous_execute: false,
          arguments: "p_product_id uuid, p_supplier_id uuid, p_catalog_number text DEFAULT NULL::text",
          authenticated_execute: true,
          is_security_definer: true,
          name: "create_product_supplier",
          result_type: "uuid",
          settings: ["search_path=\"\""],
        },
        {
          anonymous_execute: false,
          arguments: "",
          authenticated_execute: false,
          is_security_definer: true,
          name: "current_product_supplier_mutation_actor_id",
          result_type: "uuid",
          settings: ["search_path=\"\""],
        },
        {
          anonymous_execute: false,
          arguments: "p_product_supplier_id uuid, p_catalog_number text",
          authenticated_execute: true,
          is_security_definer: true,
          name: "update_product_supplier",
          result_type: "uuid",
          settings: ["search_path=\"\""],
        },
      ]);
    });
  });
  it("uses the same ProductSupplier authority for Product and Supplier editors", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      for (const [label, actor] of [
        ["PRODUCT", fixture.actors.productEditor],
        ["SUPPLIER", fixture.actors.supplierEditor],
      ] as const) {
        const endpoints = await createProductSupplierEndpoints(
          database,
          fixture.actors.admin.profileId,
        );
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const created = await database.query<{ relation_id: string }>(
          `select public.create_product_supplier(
             $1::uuid,
             $2::uuid,
             $3::text
           ) as relation_id`,
          [endpoints.productId, endpoints.supplierId, `${label}-CREATE`],
        );
        const relationId = created.rows[0]?.relation_id;
        await database.query(
          "select public.update_product_supplier($1::uuid, $2::text)",
          [relationId, `${label}-UPDATE`],
        );
        await database.query(
          "select public.archive_product_supplier($1::uuid)",
          [relationId],
        );
        await database.query("reset role");

        const relation = await database.query<ProductSupplierRow>(
          "select * from public.product_suppliers where id = $1::uuid",
          [relationId],
        );
        const audits = await database.query<ProductAuditRow>(
          `select actor_user_id, action_type, entity_type, entity_id,
                  before_data, after_data
           from public.audit_logs
           where entity_id = $1::uuid
             and action_type like 'product_supplier.%'
           order by created_at`,
          [relationId],
        );

        expect(relation.rows[0]).toMatchObject({
          archived_by_user_id: actor.profileId,
          catalog_number: `${label}-UPDATE`,
          is_active: false,
          updated_by_user_id: actor.profileId,
        });
        expect(audits.rows).toHaveLength(3);
        expect(audits.rows.every((row) =>
          row.actor_user_id === actor.profileId
        )).toBe(true);
      }
    });
  });
  it("rejects unauthorized ProductSupplier mutations before target access", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      for (const actor of [
        fixture.actors.brandManager,
        fixture.actors.supplierViewer,
        fixture.actors.productCreator,
        fixture.actors.supplierCreator,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        fixture.actors.inactiveSupplierManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");

        for (const [savepoint, sql, values] of [
          [
            "denied_product_supplier_create",
            "select public.create_product_supplier($1::uuid, $2::uuid, null)",
            [randomUUID(), randomUUID()],
          ],
          [
            "denied_product_supplier_update",
            "select public.update_product_supplier($1::uuid, null)",
            [randomUUID()],
          ],
          [
            "denied_product_supplier_archive",
            "select public.archive_product_supplier($1::uuid)",
            [randomUUID()],
          ],
        ] as const) {
          await database.query(`savepoint ${savepoint}`);
          await expect(database.query(sql, [...values]))
            .rejects.toMatchObject({ code: "42501" });
          await database.query(`rollback to savepoint ${savepoint}`);
        }

        await database.query("reset role");
      }

      await database.query("savepoint anonymous_product_supplier_mutation");
      await database.query("set local role anon");
      await expect(
        database.query(
          "select public.create_product_supplier($1::uuid, $2::uuid, null)",
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_product_supplier_mutation");
      await database.query("reset role");
    });
  });
  it("normalizes ProductSupplier input and fails endpoint or duplicate conflicts atomically", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const active = await createProductSupplierEndpoints(
        database,
        actor.profileId,
      );
      const archivedProduct = await createProductSupplierEndpoints(
        database,
        actor.profileId,
        { productActive: false },
      );
      const archivedSupplier = await createProductSupplierEndpoints(
        database,
        actor.profileId,
        { supplierActive: false },
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");
      const nullCatalog = await database.query<{ relation_id: string }>(
        `select public.create_product_supplier(
           $1::uuid,
           $2::uuid,
           '   '
         ) as relation_id`,
        [active.productId, active.supplierId],
      );
      const firstCatalog = await database.query<{ relation_id: string }>(
        `select public.create_product_supplier(
           $1::uuid,
           $2::uuid,
           '  Case-Kept  '
         ) as relation_id`,
        [active.productId, active.supplierId],
      );
      const differentCatalog = await database.query<{ relation_id: string }>(
        `select public.create_product_supplier(
           $1::uuid,
           $2::uuid,
           'DIFFERENT'
         ) as relation_id`,
        [active.productId, active.supplierId],
      );

      for (const [savepoint, sql, values, errorCode] of [
        [
          "null_product_supplier_product",
          "select public.create_product_supplier(null, $1::uuid, null)",
          [active.supplierId],
          "22023",
        ],
        [
          "null_product_supplier_supplier",
          "select public.create_product_supplier($1::uuid, null, null)",
          [active.productId],
          "22023",
        ],
        [
          "duplicate_null_product_supplier",
          "select public.create_product_supplier($1::uuid, $2::uuid, null)",
          [active.productId, active.supplierId],
          "PSR04",
        ],
        [
          "duplicate_catalog_product_supplier",
          "select public.create_product_supplier($1::uuid, $2::uuid, ' Case-Kept ')",
          [active.productId, active.supplierId],
          "PSR04",
        ],
        [
          "missing_product_supplier_product",
          "select public.create_product_supplier($1::uuid, $2::uuid, null)",
          [randomUUID(), active.supplierId],
          "PSR02",
        ],
        [
          "archived_product_supplier_product",
          "select public.create_product_supplier($1::uuid, $2::uuid, null)",
          [archivedProduct.productId, active.supplierId],
          "PSR02",
        ],
        [
          "missing_product_supplier_supplier",
          "select public.create_product_supplier($1::uuid, $2::uuid, null)",
          [active.productId, randomUUID()],
          "PSR03",
        ],
        [
          "archived_product_supplier_supplier",
          "select public.create_product_supplier($1::uuid, $2::uuid, null)",
          [active.productId, archivedSupplier.supplierId],
          "PSR03",
        ],
      ] as const) {
        await database.query(`savepoint ${savepoint}`);
        await expect(database.query(sql, [...values]))
          .rejects.toMatchObject({ code: errorCode });
        await database.query(`rollback to savepoint ${savepoint}`);
      }

      await database.query("savepoint duplicate_product_supplier_edit");
      await expect(
        database.query(
          "select public.update_product_supplier($1::uuid, null)",
          [differentCatalog.rows[0]?.relation_id],
        ),
      ).rejects.toMatchObject({ code: "PSR04" });
      await database.query("rollback to savepoint duplicate_product_supplier_edit");

      for (const [savepoint, sql, values] of [
        [
          "null_product_supplier_update",
          "select public.update_product_supplier(null, null)",
          [],
        ],
        [
          "null_product_supplier_archive",
          "select public.archive_product_supplier(null)",
          [],
        ],
        [
          "missing_product_supplier_update",
          "select public.update_product_supplier($1::uuid, null)",
          [randomUUID()],
        ],
        [
          "missing_product_supplier_archive",
          "select public.archive_product_supplier($1::uuid)",
          [randomUUID()],
        ],
      ] as const) {
        await database.query(`savepoint ${savepoint}`);
        await expect(database.query(sql, [...values]))
          .rejects.toMatchObject({
            code: savepoint.startsWith("null_") ? "22023" : "P0002",
          });
        await database.query(`rollback to savepoint ${savepoint}`);
      }
      await database.query("reset role");

      const relations = await database.query<ProductSupplierRow>(
        `select *
         from public.product_suppliers
         where id = any($1::uuid[])
         order by id`,
        [[
          nullCatalog.rows[0]?.relation_id,
          firstCatalog.rows[0]?.relation_id,
          differentCatalog.rows[0]?.relation_id,
        ]],
      );
      const auditCount = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type like 'product_supplier.%'`,
        [[
          nullCatalog.rows[0]?.relation_id,
          firstCatalog.rows[0]?.relation_id,
          differentCatalog.rows[0]?.relation_id,
        ]],
      );

      expect(relations.rows).toHaveLength(3);
      expect(relations.rows.map((row) => row.catalog_number).sort()).toEqual([
        "Case-Kept",
        "DIFFERENT",
        null,
      ]);
      expect(auditCount.rows).toEqual([{ count: 3 }]);

      await database.query(
        `update public.products
         set is_active = false,
             updated_at = pg_catalog.now(),
             updated_by_user_id = $2::uuid,
             archived_at = pg_catalog.now(),
             archived_by_user_id = $2::uuid
         where id = $1::uuid`,
        [active.productId, actor.profileId],
      );
      await database.query("set local role authenticated");
      await database.query(
        "select public.update_product_supplier($1::uuid, 'HISTORICAL')",
        [firstCatalog.rows[0]?.relation_id],
      );
      await database.query("reset role");

      const historicalEdit = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [firstCatalog.rows[0]?.relation_id],
      );
      expect(historicalEdit.rows[0]).toMatchObject({
        catalog_number: "HISTORICAL",
        product_id: active.productId,
        supplier_id: active.supplierId,
      });
    });
  });

}
