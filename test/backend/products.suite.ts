import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityFixtureHarness } from "./security-fixtures";
import { createTestSerialNumber } from "./helpers/serial";

interface CountResultRow {
  count: number;
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

interface ProductAuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown> | null;
  before_data: Record<string, unknown> | null;
  entity_id: string;
  entity_type: string;
}

interface CreatedProductRow {
  product_id: string;
  serial_number: string;
}

export function registerProductSchemaTests(requireHarness: () => SecurityFixtureHarness): void {
  it("enforces the canonical Product schema and lifecycle constraints", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const archivedBrandId = randomUUID();
      const componentId = randomUUID();
      const finishedGoodId = randomUUID();
      const componentSerial = createTestSerialNumber();
      let finishedGoodSerial = createTestSerialNumber();

      while (finishedGoodSerial === componentSerial) {
        finishedGoodSerial = createTestSerialNumber();
      }

      await database.query(
        `insert into public.brands (
           id,
           name,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values (
           $1::uuid,
           $2::text,
           false,
           $3::uuid,
           $3::uuid,
           pg_catalog.now(),
           $3::uuid
         )`,
        [archivedBrandId, `Historical Brand ${randomUUID()}`, actorId],
      );
      await database.query(
        `insert into public.products (
           id,
           serial_number,
           name,
           category,
           brand_id,
           product_kind,
           created_by_user_id,
           updated_by_user_id
         )
         values
           (
             $1::uuid,
             $2::text,
             'Valid Component',
             'Free Text Category',
             null,
             'component',
             $5::uuid,
             $5::uuid
           ),
           (
             $3::uuid,
             $4::text,
             'Historical PCB',
             'Finished Goods',
             $6::uuid,
             'pcb_finished_good',
             $5::uuid,
             $5::uuid
           )`,
        [
          componentId,
          componentSerial,
          finishedGoodId,
          finishedGoodSerial,
          actorId,
          archivedBrandId,
        ],
      );

      const products = await database.query<ProductRow>(
        `select *
         from public.products
         where id = any($1::uuid[])
         order by id`,
        [[componentId, finishedGoodId]],
      );
      const component = products.rows.find((row) => row.id === componentId);
      const finishedGood = products.rows.find(
        (row) => row.id === finishedGoodId,
      );

      expect(component).toMatchObject({
        archived_at: null,
        archived_by_user_id: null,
        brand_id: null,
        category: "Free Text Category",
        created_by_user_id: actorId,
        id: componentId,
        is_active: true,
        name: "Valid Component",
        product_kind: "component",
        serial_number: componentSerial,
        updated_by_user_id: actorId,
      });
      expect(component?.created_at).toEqual(component?.updated_at);
      expect(finishedGood).toMatchObject({
        brand_id: archivedBrandId,
        id: finishedGoodId,
        product_kind: "pcb_finished_good",
      });

      for (const [serialNumber, name, category, productKind] of [
        [createTestSerialNumber(), "   ", "Category", "component"],
        [createTestSerialNumber(), " Untrimmed", "Category", "component"],
        [createTestSerialNumber(), "Product", "   ", "component"],
        [createTestSerialNumber(), "Product", "Category ", "component"],
        ["123456", "Product", "Category", "component"],
        ["12345678", "Product", "Category", "component"],
        ["12345a7", "Product", "Category", "component"],
        [createTestSerialNumber(), "Product", "Category", "service"],
      ] as const) {
        await database.query("savepoint invalid_product_constraint");
        await expect(
          database.query(
            `insert into public.products (
               serial_number,
               name,
               category,
               product_kind,
               created_by_user_id,
               updated_by_user_id
             )
             values ($1::text, $2::text, $3::text, $4::text, $5::uuid, $5::uuid)`,
            [serialNumber, name, category, productKind, actorId],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await database.query("rollback to savepoint invalid_product_constraint");
      }

      await database.query("savepoint duplicate_product_serial");
      await expect(
        database.query(
          `insert into public.products (
             serial_number,
             name,
             category,
             product_kind,
             created_by_user_id,
             updated_by_user_id
           )
           values ($1::text, 'Duplicate', 'Category', 'component', $2::uuid, $2::uuid)`,
          [componentSerial, actorId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await database.query("rollback to savepoint duplicate_product_serial");

      const beforeSerialChange = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [componentId],
      );
      let changedSerial = createTestSerialNumber();

      while (changedSerial === componentSerial) {
        changedSerial = createTestSerialNumber();
      }

      await database.query("savepoint immutable_product_serial");
      await expect(
        database.query(
          `update public.products
           set serial_number = $2::text
           where id = $1::uuid`,
          [componentId, changedSerial],
        ),
      ).rejects.toMatchObject({ code: "PRD03" });
      await database.query("rollback to savepoint immutable_product_serial");

      const afterSerialChange = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [componentId],
      );

      expect(afterSerialChange.rows).toEqual(beforeSerialChange.rows);

      await database.query("savepoint immutable_product_kind");
      await expect(
        database.query(
          `update public.products
           set product_kind = 'pcb_finished_good'
           where id = $1::uuid`,
          [componentId],
        ),
      ).rejects.toMatchObject({ code: "PRD02" });
      await database.query("rollback to savepoint immutable_product_kind");

      await database.query(
        `update public.products
         set is_active = false,
             updated_at = pg_catalog.now(),
             updated_by_user_id = $2::uuid,
             archived_at = pg_catalog.now(),
             archived_by_user_id = $2::uuid
         where id = $1::uuid`,
        [componentId, actorId],
      );
      const archivedBefore = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [componentId],
      );

      expect(archivedBefore.rows[0]).toMatchObject({
        archived_by_user_id: actorId,
        id: componentId,
        is_active: false,
        serial_number: componentSerial,
      });
      expect(archivedBefore.rows[0]?.archived_at).toBeInstanceOf(Date);

      await database.query("savepoint immutable_archived_product");
      await expect(
        database.query(
          `update public.products
           set name = 'Forbidden archived edit'
           where id = $1::uuid`,
          [componentId],
        ),
      ).rejects.toMatchObject({ code: "PRD01" });
      await database.query("rollback to savepoint immutable_archived_product");

      const archivedAfter = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [componentId],
      );

      expect(archivedAfter.rows).toEqual(archivedBefore.rows);
    });
  });
  it("limits active and archived Product reads to Inventory-authorized actors", async () => {
    const fixture = requireHarness();
    const activeProductId = randomUUID();
    const archivedProductId = randomUUID();
    const activeSerial = createTestSerialNumber();
    let archivedSerial = createTestSerialNumber();

    while (archivedSerial === activeSerial) {
      archivedSerial = createTestSerialNumber();
    }

    await fixture.withRollbackDatabaseTransaction(async (database) => {
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
         values
           ($1::uuid, $2::text, 'Active Product', 'Category', 'component', true, $5::uuid, $5::uuid, null, null),
           ($3::uuid, $4::text, 'Archived Product', 'Category', 'component', false, $5::uuid, $5::uuid, pg_catalog.now(), $5::uuid)`,
        [
          activeProductId,
          activeSerial,
          archivedProductId,
          archivedSerial,
          fixture.actors.admin.profileId,
        ],
      );

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.brandManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ id: string }>(
          `select id
           from public.products
           where id = any($1::uuid[])
           order by id`,
          [[activeProductId, archivedProductId]],
        );
        await database.query("reset role");

        expect(visible.rows.map((row) => row.id).sort()).toEqual(
          [activeProductId, archivedProductId].sort(),
        );
      }

      for (const actor of [
        fixture.actors.permitted,
        fixture.actors.unpermitted,
        fixture.actors.inactiveBrandManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ id: string }>(
          `select id
           from public.products
           where id = any($1::uuid[])`,
          [[activeProductId, archivedProductId]],
        );
        await database.query("reset role");

        expect(hidden.rows).toEqual([]);
      }

      await database.query("savepoint anonymous_product_read");
      await database.query("set local role anon");
      await expect(
        database.query("select id from public.products limit 1"),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_product_read");
      await database.query("reset role");
    });
  });
  it("denies direct Product writes and exposes no unsupported Product lifecycle RPCs", async () => {
    const fixture = requireHarness();
    const client = fixture.actors.brandManager.client;
    const productId = randomUUID();
    const directInsert = await client.from("products").insert({
      serial_number: createTestSerialNumber(),
      name: "Direct Product",
      category: "Category",
      product_kind: "component",
      created_by_user_id: fixture.actors.brandManager.profileId,
      updated_by_user_id: fixture.actors.brandManager.profileId,
    });
    const directUpdate = await client
      .from("products")
      .update({ name: "Forbidden update" })
      .eq("id", productId);
    const directDelete = await client.from("products").delete().eq("id", productId);

    expectPermissionDenied(directInsert.error);
    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const columns = await database.query<{ column_name: string }>(
        `select column_name
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'products'
         order by ordinal_position`,
      );
      const constraints = await database.query<{ constraint_name: string }>(
        `select constraint_name
         from information_schema.table_constraints
         where table_schema = 'public'
           and table_name = 'products'
         order by constraint_name`,
      );
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
           and table_info.relname = 'products'`,
      );
      const unsupportedFunctions = await database.query<{ count: number }>(
        `select count(*)::integer as count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'delete_product',
             'reactivate_product',
             'restore_product',
             'unarchive_product'
           )`,
      );
      const lifecycleFunction = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'enforce_product_lifecycle_immutability'`,
      );

      expect(columns.rows.map((column) => column.column_name)).toEqual([
        "id",
        "serial_number",
        "name",
        "category",
        "brand_id",
        "product_kind",
        "is_active",
        "created_at",
        "created_by_user_id",
        "updated_at",
        "updated_by_user_id",
        "archived_at",
        "archived_by_user_id",
      ]);
      expect(constraints.rows.map((constraint) => constraint.constraint_name))
        .toEqual(expect.arrayContaining([
          "products_archive_state_consistent",
          "products_category_trimmed_nonblank",
          "products_kind_valid",
          "products_name_trimmed_nonblank",
          "products_pkey",
          "products_serial_number_format",
          "products_serial_number_key",
        ]));
      expect(tableSecurity.rows).toEqual([
        {
          authenticated_delete: false,
          authenticated_insert: false,
          authenticated_select: true,
          authenticated_update: false,
          row_security: true,
        },
      ]);
      expect(unsupportedFunctions.rows).toEqual([{ count: 0 }]);
      expect(lifecycleFunction.rows).toEqual([
        {
          anonymous_execute: false,
          authenticated_execute: false,
          is_security_definer: false,
          settings: ["search_path=\"\""],
        },
      ]);
    });
  });
  it("allocates sequential seven-digit Product Serials without rollback reuse", async () => {
    const fixture = requireHarness();
    const sequenceConfiguration = await fixture.withRollbackDatabaseTransaction(
      async (database) => {
        return database.query<{
          cache_size: string;
          cycles: boolean;
          increment_by: string;
          maximum_value: string;
          minimum_value: string;
          start_value: string;
        }>(
          `select
             sequence_info.seqstart::text as start_value,
             sequence_info.seqincrement::text as increment_by,
             sequence_info.seqmin::text as minimum_value,
             sequence_info.seqmax::text as maximum_value,
             sequence_info.seqcache::text as cache_size,
             sequence_info.seqcycle as cycles
           from pg_catalog.pg_sequence as sequence_info
           join pg_catalog.pg_class as sequence_object
             on sequence_object.oid = sequence_info.seqrelid
           join pg_catalog.pg_namespace as namespace
             on namespace.oid = sequence_object.relnamespace
           where namespace.nspname = 'public'
             and sequence_object.relname = 'product_serial_number_seq'`,
        );
      },
    );

    expect(sequenceConfiguration.rows).toEqual([
      {
        cache_size: "1",
        cycles: false,
        increment_by: "1",
        maximum_value: "9999999",
        minimum_value: "1",
        start_value: "1",
      },
    ]);

    const rolledBackAllocations = await fixture.withRollbackDatabaseTransaction(
      async (database) => {
        return database.query<{ serial_number: string }>(
          `select public.allocate_product_serial_number() as serial_number
           from pg_catalog.generate_series(1, 2)`,
        );
      },
    );
    const firstValue = rolledBackAllocations.rows[0]?.serial_number;
    const secondValue = rolledBackAllocations.rows[1]?.serial_number;

    expect(firstValue).toMatch(/^[0-9]{7}$/);
    expect(secondValue).toMatch(/^[0-9]{7}$/);
    expect(Number(secondValue)).toBe(Number(firstValue) + 1);

    const afterRollback = await fixture.withRollbackDatabaseTransaction(
      async (database) => {
        return database.query<{ serial_number: string }>(
          "select public.allocate_product_serial_number() as serial_number",
        );
      },
    );
    const afterRollbackValue = afterRollback.rows[0]?.serial_number;

    expect(afterRollbackValue).toMatch(/^[0-9]{7}$/);
    expect(Number(afterRollbackValue)).toBe(Number(secondValue) + 1);
  });
  it("allocates unique Product Serials safely across concurrent connections", async () => {
    const allocations = await requireHarness().withDatabaseClients(
      4,
      async (clients) => {
        return Promise.all(
          clients.map(async (database) => {
            const result = await database.query<{ serial_number: string }>(
              "select public.allocate_product_serial_number() as serial_number",
            );

            return result.rows[0]?.serial_number;
          }),
        );
      },
    );

    expect(allocations.every((value) => /^[0-9]{7}$/.test(value ?? "")))
      .toBe(true);
    expect(new Set(allocations).size).toBe(allocations.length);
  });
  it("keeps the Product Serial allocator internal and sequence state protected", async () => {
    const fixture = requireHarness();

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.admin.client,
      fixture.actors.brandManager.client,
    ]) {
      const { error } = await client.rpc("allocate_product_serial_number");

      expectPermissionDenied(error);
    }

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const allocator = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        result_type: string;
        settings: string[];
      }>(
        `select
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.pg_get_function_result(routine.oid) as result_type,
           pg_catalog.has_function_privilege(
             'authenticated',
             routine.oid,
             'execute'
           ) as authenticated_execute,
           pg_catalog.has_function_privilege(
             'anon',
             routine.oid,
             'execute'
           ) as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'allocate_product_serial_number'`,
      );
      const sequencePrivileges = await database.query<{
        anonymous_select: boolean;
        anonymous_update: boolean;
        anonymous_usage: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        authenticated_usage: boolean;
      }>(
        `select
           pg_catalog.has_sequence_privilege(
             'authenticated',
             'public.product_serial_number_seq',
             'select'
           ) as authenticated_select,
           pg_catalog.has_sequence_privilege(
             'authenticated',
             'public.product_serial_number_seq',
             'update'
           ) as authenticated_update,
           pg_catalog.has_sequence_privilege(
             'authenticated',
             'public.product_serial_number_seq',
             'usage'
           ) as authenticated_usage,
           pg_catalog.has_sequence_privilege(
             'anon',
             'public.product_serial_number_seq',
             'select'
           ) as anonymous_select,
           pg_catalog.has_sequence_privilege(
             'anon',
             'public.product_serial_number_seq',
             'update'
           ) as anonymous_update,
           pg_catalog.has_sequence_privilege(
             'anon',
             'public.product_serial_number_seq',
             'usage'
           ) as anonymous_usage`,
      );

      expect(allocator.rows).toEqual([
        {
          anonymous_execute: false,
          authenticated_execute: false,
          is_security_definer: true,
          result_type: "text",
          settings: ["search_path=\"\""],
        },
      ]);
      expect(sequencePrivileges.rows).toEqual([
        {
          anonymous_select: false,
          anonymous_update: false,
          anonymous_usage: false,
          authenticated_select: false,
          authenticated_update: false,
          authenticated_usage: false,
        },
      ]);
    });
  });
  it("lets an active Admin create a normalized Component with an active Brand and one audit", async () => {
    const fixture = requireHarness();
    const productName = `Created Product ${randomUUID()}`;
    const category = `Category ${randomUUID()}`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const brandId = randomUUID();

      await database.query(
        `insert into public.brands (
           id,
           name,
           created_by_user_id,
           updated_by_user_id
         )
         values ($1::uuid, $2::text, $3::uuid, $3::uuid)`,
        [
          brandId,
          `Product creation Brand ${randomUUID()}`,
          fixture.actors.admin.profileId,
        ],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<CreatedProductRow>(
        `select *
         from public.create_product($1::text, $2::text, $3::uuid)`,
        [`  ${productName}  `, `  ${category}  `, brandId],
      );
      await database.query("reset role");
      const result = created.rows[0];

      if (!result) {
        throw new Error("Trusted Product creation returned no result");
      }

      const product = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [result.product_id],
      );
      const audit = await database.query<ProductAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product.created'`,
        [result.product_id],
      );

      expect(result.serial_number).toMatch(/^[0-9]{7}$/);
      expect(product.rows).toHaveLength(1);
      expect(product.rows[0]).toMatchObject({
        archived_at: null,
        archived_by_user_id: null,
        brand_id: brandId,
        category,
        created_by_user_id: fixture.actors.admin.profileId,
        id: result.product_id,
        is_active: true,
        name: productName,
        product_kind: "component",
        serial_number: result.serial_number,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(product.rows[0]?.created_at).toEqual(product.rows[0]?.updated_at);
      expect(audit.rows).toEqual([
        {
          action_type: "product.created",
          actor_user_id: fixture.actors.admin.profileId,
          after_data: {
            brand_id: brandId,
            category,
            is_active: true,
            name: productName,
            product_kind: "component",
            serial_number: result.serial_number,
          },
          before_data: null,
          entity_id: result.product_id,
          entity_type: "product",
        },
      ]);
    });
  });
  it("lets inventory.products.create allocate sequential NULL-Brand Components without reuse after rollback", async () => {
    const fixture = requireHarness();
    const actor = fixture.actors.productCreator;

    const createRolledBackProduct = async (
      name: string,
    ): Promise<CreatedProductRow> => {
      return fixture.withRollbackDatabaseTransaction(async (database) => {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const created = await database.query<CreatedProductRow>(
          `select *
           from public.create_product($1::text, $2::text, null)`,
          [name, "Uncategorized Components"],
        );
        await database.query("reset role");
        const result = created.rows[0];

        if (!result) {
          throw new Error("Delegated Product creation returned no result");
        }

        const product = await database.query<ProductRow>(
          "select * from public.products where id = $1::uuid",
          [result.product_id],
        );
        const audit = await database.query<ProductAuditRow>(
          `select actor_user_id, action_type, entity_type, entity_id,
                  before_data, after_data
           from public.audit_logs
           where entity_id = $1::uuid
             and action_type = 'product.created'`,
          [result.product_id],
        );

        expect(product.rows[0]).toMatchObject({
          brand_id: null,
          created_by_user_id: actor.profileId,
          id: result.product_id,
          product_kind: "component",
          serial_number: result.serial_number,
          updated_by_user_id: actor.profileId,
        });
        expect(audit.rows).toHaveLength(1);
        expect(audit.rows[0]).toMatchObject({
          actor_user_id: actor.profileId,
          entity_id: result.product_id,
        });

        return result;
      });
    };

    const first = await createRolledBackProduct(
      `Rolled Back Product ${randomUUID()}`,
    );
    const second = await createRolledBackProduct(
      `Next Product ${randomUUID()}`,
    );

    expect(first.serial_number).toMatch(/^[0-9]{7}$/);
    expect(second.serial_number).toMatch(/^[0-9]{7}$/);
    expect(Number(second.serial_number)).toBe(Number(first.serial_number) + 1);

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const products = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.products
         where id = any($1::uuid[])`,
        [[first.product_id, second.product_id]],
      );
      const audits = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type = 'product.created'`,
        [[first.product_id, second.product_id]],
      );

      expect(products.rows).toEqual([{ count: 0 }]);
      expect(audits.rows).toEqual([{ count: 0 }]);
    });
  });
  it("fails Product creation closed for invalid data, unavailable Brands, and unauthorized actors", async () => {
    const fixture = requireHarness();

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
      fixture.actors.inactiveBrandManager.client,
    ]) {
      const { error } = await client.rpc("create_product", {
        p_name: `Denied Product ${randomUUID()}`,
        p_category: "Category",
      });

      expectPermissionDenied(error);
    }

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const archivedBrandId = randomUUID();
      const missingBrandId = randomUUID();

      await database.query(
        `insert into public.brands (
           id,
           name,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values (
           $1::uuid,
           $2::text,
           false,
           $3::uuid,
           $3::uuid,
           pg_catalog.now(),
           $3::uuid
         )`,
        [
          archivedBrandId,
          `Archived Product Brand ${randomUUID()}`,
          fixture.actors.admin.profileId,
        ],
      );
      const productCountBefore = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.products",
      );
      const auditCountBefore = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where action_type = 'product.created'`,
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");

      for (const [name, category, brandId, errorCode] of [
        ["   ", "Category", null, "22023"],
        [`Product ${randomUUID()}`, "   ", null, "22023"],
        [`Product ${randomUUID()}`, "Category", missingBrandId, "PRD04"],
        [`Product ${randomUUID()}`, "Category", archivedBrandId, "PRD04"],
      ] as const) {
        await database.query("savepoint invalid_product_creation");
        await expect(
          database.query(
            `select *
             from public.create_product($1::text, $2::text, $3::uuid)`,
            [name, category, brandId],
          ),
        ).rejects.toMatchObject({ code: errorCode });
        await database.query("rollback to savepoint invalid_product_creation");
      }

      await database.query("reset role");

      const productCountAfter = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.products",
      );
      const auditCountAfter = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where action_type = 'product.created'`,
      );
      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        arguments: string;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        result_type: string;
        settings: string[];
      }>(
        `select
           pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
           pg_catalog.pg_get_function_result(routine.oid) as result_type,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege(
             'authenticated', routine.oid, 'execute'
           ) as authenticated_execute,
           pg_catalog.has_function_privilege(
             'anon', routine.oid, 'execute'
           ) as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'create_product'`,
      );
      const stockTable = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from information_schema.tables
         where table_schema = 'public'
           and table_name = 'inventory_balances'`,
      );

      expect(productCountAfter.rows).toEqual(productCountBefore.rows);
      expect(auditCountAfter.rows).toEqual(auditCountBefore.rows);
      expect(functionSecurity.rows).toEqual([
        {
          anonymous_execute: false,
          arguments: "p_name text, p_category text, p_brand_id uuid DEFAULT NULL::uuid",
          authenticated_execute: true,
          is_security_definer: true,
          result_type: "TABLE(product_id uuid, serial_number text)",
          settings: ["search_path=\"\""],
        },
      ]);
      expect(stockTable.rows).toEqual([{ count: 1 }]);
    });
  });
}

export function registerProductEditTests(requireHarness: () => SecurityFixtureHarness): void {
  it("lets Admin update normalized Product master data with an active Brand and one audit", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const productId = randomUUID();
      const activeBrandId = randomUUID();
      const serialNumber = createTestSerialNumber();

      await database.query(
        `insert into public.brands (
           id,
           name,
           created_by_user_id,
           updated_by_user_id
         )
         values ($1::uuid, $2::text, $3::uuid, $3::uuid)`,
        [
          activeBrandId,
          `Product edit Brand ${randomUUID()}`,
          fixture.actors.admin.profileId,
        ],
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
         values ($1::uuid, $2::text, 'Old Name', 'Old Category', 'component', $3::uuid, $3::uuid)`,
        [productId, serialNumber, fixture.actors.admin.profileId],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const updated = await database.query<{ product_id: string }>(
        `select public.update_product(
           $1::uuid,
           $2::text,
           $3::text,
           $4::uuid
         ) as product_id`,
        [productId, "  Updated Name  ", "  Updated Category  ", activeBrandId],
      );
      await database.query("reset role");

      const product = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [productId],
      );
      const audit = await database.query<ProductAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product.updated'`,
        [productId],
      );

      expect(updated.rows).toEqual([{ product_id: productId }]);
      expect(product.rows[0]).toMatchObject({
        brand_id: activeBrandId,
        category: "Updated Category",
        id: productId,
        name: "Updated Name",
        product_kind: "component",
        serial_number: serialNumber,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(audit.rows).toEqual([
        {
          action_type: "product.updated",
          actor_user_id: fixture.actors.admin.profileId,
          after_data: {
            brand_id: activeBrandId,
            category: "Updated Category",
            is_active: true,
            name: "Updated Name",
            product_kind: "component",
            serial_number: serialNumber,
          },
          before_data: {
            brand_id: null,
            category: "Old Category",
            is_active: true,
            name: "Old Name",
            product_kind: "component",
            serial_number: serialNumber,
          },
          entity_id: productId,
          entity_type: "product",
        },
      ]);

      const updatedAt = product.rows[0]?.updated_at;
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query(
        `select public.update_product($1::uuid, $2::text, $3::text, $4::uuid)`,
        [
          productId,
          "  Updated Name  ",
          "  Updated Category  ",
          activeBrandId,
        ],
      );
      await database.query("reset role");
      const afterNoop = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [productId],
      );
      const auditAfterNoop = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product.updated'`,
        [productId],
      );

      expect(afterNoop.rows[0]?.updated_at).toEqual(updatedAt);
      expect(auditAfterNoop.rows).toEqual([{ count: 1 }]);
    });
  });
  it("lets inventory.products.edit preserve its current archived Brand, clear it, and assign an active Brand", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const productId = randomUUID();
      const archivedBrandId = randomUUID();
      const activeBrandId = randomUUID();
      const serialNumber = createTestSerialNumber();

      await database.query(
        `insert into public.brands (
           id,
           name,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $2::text, false, $4::uuid, $4::uuid, pg_catalog.now(), $4::uuid),
           ($3::uuid, $5::text, true, $4::uuid, $4::uuid, null, null)`,
        [
          archivedBrandId,
          `Current Archived Brand ${randomUUID()}`,
          activeBrandId,
          fixture.actors.admin.profileId,
          `Active Replacement Brand ${randomUUID()}`,
        ],
      );
      await database.query(
        `insert into public.products (
           id,
           serial_number,
           name,
           category,
           brand_id,
           product_kind,
           created_by_user_id,
           updated_by_user_id
         )
         values ($1::uuid, $2::text, 'Historical Brand Product', 'Category', $3::uuid, 'pcb_finished_good', $4::uuid, $4::uuid)`,
        [
          productId,
          serialNumber,
          archivedBrandId,
          fixture.actors.admin.profileId,
        ],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.productEditor.authUserId],
      );
      await database.query("set local role authenticated");

      await database.query(
        `select public.update_product($1::uuid, 'Renamed Product', 'Category', $2::uuid)`,
        [productId, archivedBrandId],
      );
      await database.query(
        `select public.update_product($1::uuid, 'Renamed Product', 'Category', null)`,
        [productId],
      );
      await database.query(
        `select public.update_product($1::uuid, 'Renamed Product', 'Category', $2::uuid)`,
        [productId, activeBrandId],
      );
      await database.query("reset role");

      const product = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [productId],
      );
      const audits = await database.query<ProductAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product.updated'
         order by created_at`,
        [productId],
      );

      expect(product.rows[0]).toMatchObject({
        brand_id: activeBrandId,
        id: productId,
        name: "Renamed Product",
        product_kind: "pcb_finished_good",
        serial_number: serialNumber,
        updated_by_user_id: fixture.actors.productEditor.profileId,
      });
      expect(audits.rows).toHaveLength(3);
      expect(audits.rows.every((row) =>
        row.actor_user_id === fixture.actors.productEditor.profileId
      )).toBe(true);
    });
  });
  it("fails Product updates closed for unauthorized actors, invalid state/data, and unavailable new Brands", async () => {
    const fixture = requireHarness();

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
      fixture.actors.inactiveBrandManager.client,
    ]) {
      const { error } = await client.rpc("update_product", {
        p_product_id: randomUUID(),
        p_name: "Denied Product",
        p_category: "Category",
        p_brand_id: null,
      });

      expectPermissionDenied(error);
    }

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const activeProductId = randomUUID();
      const archivedProductId = randomUUID();
      const archivedBrandId = randomUUID();
      const missingBrandId = randomUUID();
      const activeSerial = createTestSerialNumber();
      let archivedSerial = createTestSerialNumber();
      while (archivedSerial === activeSerial) archivedSerial = createTestSerialNumber();

      await database.query(
        `insert into public.brands (
           id,
           name,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values ($1::uuid, $2::text, false, $3::uuid, $3::uuid, pg_catalog.now(), $3::uuid)`,
        [
          archivedBrandId,
          `Unavailable Brand ${randomUUID()}`,
          fixture.actors.admin.profileId,
        ],
      );
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
         values
           ($1::uuid, $2::text, 'Active Product', 'Category', 'component', true, $5::uuid, $5::uuid, null, null),
           ($3::uuid, $4::text, 'Archived Product', 'Category', 'component', false, $5::uuid, $5::uuid, pg_catalog.now(), $5::uuid)`,
        [
          activeProductId,
          activeSerial,
          archivedProductId,
          archivedSerial,
          fixture.actors.admin.profileId,
        ],
      );
      const beforeProduct = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [activeProductId],
      );
      const auditBefore = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where action_type = 'product.updated'`,
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");

      for (const [productId, name, category, brandId, errorCode] of [
        [activeProductId, "   ", "Category", null, "22023"],
        [activeProductId, "Active Product", "   ", null, "22023"],
        [activeProductId, "Active Product", "Category", missingBrandId, "PRD04"],
        [activeProductId, "Active Product", "Category", archivedBrandId, "PRD04"],
        [archivedProductId, "Changed", "Category", null, "PRD01"],
        [randomUUID(), "Missing", "Category", null, "P0002"],
      ] as const) {
        await database.query("savepoint invalid_product_update");
        await expect(
          database.query(
            `select public.update_product($1::uuid, $2::text, $3::text, $4::uuid)`,
            [productId, name, category, brandId],
          ),
        ).rejects.toMatchObject({ code: errorCode });
        await database.query("rollback to savepoint invalid_product_update");
      }

      await database.query("reset role");
      const afterProduct = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [activeProductId],
      );
      const auditAfter = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where action_type = 'product.updated'`,
      );
      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        arguments: string;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        result_type: string;
        settings: string[];
      }>(
        `select
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
           and routine.proname = 'update_product'`,
      );

      expect(afterProduct.rows).toEqual(beforeProduct.rows);
      expect(auditAfter.rows).toEqual(auditBefore.rows);
      expect(functionSecurity.rows).toEqual([
        {
          anonymous_execute: false,
          arguments: "p_product_id uuid, p_name text, p_category text, p_brand_id uuid",
          authenticated_execute: true,
          is_security_definer: true,
          result_type: "uuid",
          settings: ["search_path=\"\""],
        },
      ]);
    });

    const directUpdate = await fixture.actors.productEditor.client
      .from("products")
      .update({ name: "Forbidden direct edit" })
      .eq("id", randomUUID());
    expectPermissionDenied(directUpdate.error);
  });
  it("archives a Product atomically with canonical lifecycle metadata and audit", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const productId = randomUUID();
      const serialNumber = createTestSerialNumber();

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
         values ($1::uuid, $2::text, 'Archive Candidate', 'Controls',
                 'component', $3::uuid, $3::uuid)`,
        [productId, serialNumber, fixture.actors.admin.profileId],
      );
      const before = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [productId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const archived = await database.query<{ product_id: string }>(
        "select public.archive_product($1::uuid) as product_id",
        [productId],
      );
      await database.query("reset role");

      const after = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [productId],
      );
      const audits = await database.query<ProductAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product.archived'`,
        [productId],
      );
      const current = after.rows[0];
      const original = before.rows[0];

      expect(archived.rows).toEqual([{ product_id: productId }]);
      expect(current).toMatchObject({
        archived_by_user_id: fixture.actors.admin.profileId,
        brand_id: original?.brand_id,
        category: original?.category,
        id: productId,
        is_active: false,
        name: original?.name,
        product_kind: original?.product_kind,
        serial_number: original?.serial_number,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(current?.archived_at).toBeInstanceOf(Date);
      expect(current?.updated_at).toEqual(current?.archived_at);
      expect(current?.created_at).toEqual(original?.created_at);
      expect(audits.rows).toHaveLength(1);
      expect(audits.rows[0]).toMatchObject({
        actor_user_id: fixture.actors.admin.profileId,
        action_type: "product.archived",
        entity_id: productId,
        entity_type: "product",
        before_data: {
          brand_id: null,
          category: "Controls",
          is_active: true,
          name: "Archive Candidate",
          product_kind: "component",
          serial_number: serialNumber,
        },
        after_data: {
          archived_by_user_id: fixture.actors.admin.profileId,
          brand_id: null,
          category: "Controls",
          is_active: false,
          name: "Archive Candidate",
          product_kind: "component",
          serial_number: serialNumber,
        },
      });

      await database.query("set local role authenticated");
      const readable = await database.query<{ id: string }>(
        "select id from public.products where id = $1::uuid",
        [productId],
      );
      expect(readable.rows).toEqual([{ id: productId }]);

      await database.query("savepoint repeat_product_archive");
      await expect(
        database.query("select public.archive_product($1::uuid)", [productId]),
      ).rejects.toMatchObject({ code: "PRD01" });
      await database.query("rollback to savepoint repeat_product_archive");

      await database.query("savepoint edit_archived_product");
      await expect(
        database.query(
          `select public.update_product(
             $1::uuid,
             'Forbidden edit',
             'Controls',
             null
           )`,
          [productId],
        ),
      ).rejects.toMatchObject({ code: "PRD01" });
      await database.query("rollback to savepoint edit_archived_product");
      await database.query("reset role");

      const afterFailures = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [productId],
      );
      const auditAfterFailures = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product.archived'`,
        [productId],
      );
      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        arguments: string;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        result_type: string;
        settings: string[];
      }>(
        `select
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
           and routine.proname = 'archive_product'`,
      );

      expect(afterFailures.rows).toEqual(after.rows);
      expect(auditAfterFailures.rows).toEqual([{ count: 1 }]);
      expect(functionSecurity.rows).toEqual([
        {
          anonymous_execute: false,
          arguments: "p_product_id uuid",
          authenticated_execute: true,
          is_security_definer: true,
          result_type: "uuid",
          settings: ["search_path=\"\""],
        },
      ]);
    });
  });
  it("limits Product archive to Admin or inventory.products.edit and fails safely", async () => {
    const fixture = requireHarness();
    const deniedProductIds: string[] = [];

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.productCreator.client,
      fixture.actors.brandManager.client,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
      fixture.actors.inactiveBrandManager.client,
    ]) {
      const deniedProductId = randomUUID();
      deniedProductIds.push(deniedProductId);
      const { error } = await client.rpc("archive_product", {
        p_product_id: deniedProductId,
      });

      expectPermissionDenied(error);
    }

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const productId = randomUUID();
      const serialNumber = createTestSerialNumber();

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
         values ($1::uuid, $2::text, 'Editor Archive', 'Controls',
                 'component', $3::uuid, $3::uuid)`,
        [productId, serialNumber, fixture.actors.admin.profileId],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.productEditor.authUserId],
      );
      await database.query("set local role authenticated");
      const archived = await database.query<{ product_id: string }>(
        "select public.archive_product($1::uuid) as product_id",
        [productId],
      );
      await database.query("reset role");

      const product = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [productId],
      );
      const audit = await database.query<ProductAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product.archived'`,
        [productId],
      );

      expect(archived.rows).toEqual([{ product_id: productId }]);
      expect(product.rows[0]).toMatchObject({
        archived_by_user_id: fixture.actors.productEditor.profileId,
        is_active: false,
      });
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]?.actor_user_id)
        .toBe(fixture.actors.productEditor.profileId);

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint missing_product_archive");
      const missingProductId = randomUUID();
      await expect(
        database.query("select public.archive_product($1::uuid)", [missingProductId]),
      ).rejects.toMatchObject({ code: "P0002" });
      await database.query("rollback to savepoint missing_product_archive");
      await database.query("savepoint null_product_archive");
      await expect(
        database.query("select public.archive_product(null::uuid)"),
      ).rejects.toMatchObject({ code: "22023" });
      await database.query("rollback to savepoint null_product_archive");
      await database.query("reset role");

      const failedAudit = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where action_type = 'product.archived'
           and entity_id = any($1::uuid[])`,
        [[...deniedProductIds, missingProductId]],
      );
      expect(failedAudit.rows).toEqual([{ count: 0 }]);
    });

    const directUpdate = await fixture.actors.productEditor.client
      .from("products")
      .update({ is_active: false })
      .eq("id", randomUUID());
    const directDelete = await fixture.actors.productEditor.client
      .from("products")
      .delete()
      .eq("id", randomUUID());

    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);
  });

}
