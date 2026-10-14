import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityFixtureHarness } from "./security-fixtures";
import { createTestSerialNumber } from "./helpers/serial";

interface InventoryMovementHistoryRow {
  actor_full_name: string;
  actor_user_id: string;
  created_at: Date;
  movement_id: string;
  movement_type: string;
  project_id: string | null;
  quantity_after: string;
  quantity_before: string;
  quantity_delta: string;
  reason: string | null;
  reversal_of_movement_id: string | null;
  source_id: string | null;
  source_type: string | null;
}

interface InventoryProductSearchRow {
  brand_name: string | null;
  category: string;
  id: string;
  is_active: boolean;
  name: string;
  product_kind: "component" | "pcb_finished_good";
  quantity: string;
  serial_number: string;
}

export function registerInventoryReadsTests(requireHarness: () => SecurityFixtureHarness): void {
  it("searches Inventory Products through one authorized, literal, indexed read model", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const token = randomUUID().replace(/-/g, "");
      const activeProductId = randomUUID();
      const archivedProductId = randomUUID();
      const brandId = randomUUID();
      const supplierId = randomUUID();
      const activeSerial = createTestSerialNumber();
      let archivedSerial = createTestSerialNumber();
      while (archivedSerial === activeSerial) {
        archivedSerial = createTestSerialNumber();
      }

      await database.query(
        `insert into public.brands (
           id, name, created_by_user_id, updated_by_user_id
         ) values ($1::uuid, $2::text, $3::uuid, $3::uuid)`,
        [brandId, `Search Brand ${token}`, actorId],
      );
      await database.query(
        `insert into public.suppliers (
           id, name, catalog_number, country, created_by_user_id, updated_by_user_id
         ) values ($1::uuid, $2::text, 'SEARCH-CAT', 'Germany', $3::uuid, $3::uuid)`,
        [supplierId, `Search Supplier ${token}`, actorId],
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, brand_id, product_kind,
           is_active, created_by_user_id, updated_by_user_id,
           archived_at, archived_by_user_id
         ) values
           ($1::uuid, $2::text, $3::text, $9::text, $7::uuid,
            'component', true, $8::uuid, $8::uuid, null, null),
           ($4::uuid, $5::text, $6::text, $10::text, null,
            'pcb_finished_good', false, $8::uuid, $8::uuid,
            pg_catalog.now(), $8::uuid)`,
        [
          activeProductId,
          activeSerial,
          `Alpha ${token} Sensor %_`,
          archivedProductId,
          archivedSerial,
          `Archived ${token} Controller`,
          brandId,
          actorId,
          `Power Distribution ${token}`,
          `Legacy Control ${token}`,
        ],
      );
      await database.query(
        `update public.inventory_balances
         set quantity = case
           when product_id = $1::uuid then 12
           when product_id = $2::uuid then 4
           else quantity
         end
         where product_id = any($3::uuid[])`,
        [activeProductId, archivedProductId, [activeProductId, archivedProductId]],
      );
      await database.query(
        `insert into public.product_suppliers (
           id, product_id, supplier_id, catalog_number, is_active,
           created_by_user_id, updated_by_user_id, archived_at,
           archived_by_user_id
         ) values
           ($1::uuid, $4::uuid, $6::uuid, $7::text, true,
            $9::uuid, $9::uuid, null, null),
           ($2::uuid, $4::uuid, $6::uuid, $8::text, false,
            $9::uuid, $9::uuid, pg_catalog.now(), $9::uuid),
           ($3::uuid, $5::uuid, $6::uuid, $10::text, false,
            $9::uuid, $9::uuid, pg_catalog.now(), $9::uuid)`,
        [
          randomUUID(),
          randomUUID(),
          randomUUID(),
          activeProductId,
          archivedProductId,
          supplierId,
          `CAT-${token}-ONE`,
          `cat-${token}-two`,
          actorId,
          `HISTORICAL-${token}`,
        ],
      );

      const searchAs = async (
        authUserId: string,
        search: string | null,
      ): Promise<InventoryProductSearchRow[]> => {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<InventoryProductSearchRow>(
          "select * from public.search_inventory_products($1::text)",
          [search],
        );
        await database.query("reset role");
        return result.rows;
      };

      const adminBlank = await searchAs(fixture.actors.admin.authUserId, "   ");
      const inventoryViewBlank = await searchAs(
        fixture.actors.brandManager.authUserId,
        null,
      );
      expect(adminBlank.some((row) => row.id === activeProductId)).toBe(true);
      expect(adminBlank.some((row) => row.id === archivedProductId)).toBe(true);
      expect(inventoryViewBlank.some((row) => row.id === activeProductId))
        .toBe(true);
      expect(adminBlank.map((row) => row.serial_number)).toEqual(
        [...adminBlank.map((row) => row.serial_number)].sort(),
      );

      const nameMatch = await searchAs(
        fixture.actors.brandManager.authUserId,
        `ALPHA ${token.toUpperCase()}`,
      );
      expect(nameMatch.map((row) => row.id)).toEqual([activeProductId]);

      const serialExact = await searchAs(
        fixture.actors.admin.authUserId,
        activeSerial,
      );
      const serialPrefix = await searchAs(
        fixture.actors.admin.authUserId,
        activeSerial.slice(0, 6),
      );
      expect(serialExact.map((row) => row.id)).toEqual([activeProductId]);
      expect(serialPrefix.some((row) => row.id === activeProductId)).toBe(true);

      const catalogMatches = await searchAs(
        fixture.actors.admin.authUserId,
        `cat-${token}`,
      );
      expect(catalogMatches.filter((row) => row.id === activeProductId))
        .toHaveLength(1);

      const categoryMatch = await searchAs(
        fixture.actors.brandManager.authUserId,
        `dIsTrIbUtIoN ${token.toUpperCase()}`,
      );
      expect(categoryMatch.map((row) => row.id)).toEqual([activeProductId]);

      const archivedCategoryMatch = await searchAs(
        fixture.actors.admin.authUserId,
        `lEgAcY cOnTrOl ${token.toUpperCase()}`,
      );
      expect(archivedCategoryMatch.map((row) => row.id))
        .toEqual([archivedProductId]);

      const historicalCatalog = await searchAs(
        fixture.actors.admin.authUserId,
        `historical-${token}`,
      );
      expect(historicalCatalog.map((row) => row.id))
        .toEqual([archivedProductId]);

      const literalWildcard = await searchAs(
        fixture.actors.admin.authUserId,
        "%_",
      );
      expect(literalWildcard.map((row) => row.id)).toContain(activeProductId);
      expect(literalWildcard.every((row) => row.name.includes("%_"))).toBe(true);

      const activeResult = nameMatch[0];
      expect(activeResult).toEqual({
        brand_name: `Search Brand ${token}`,
        category: `Power Distribution ${token}`,
        id: activeProductId,
        is_active: true,
        name: `Alpha ${token} Sensor %_`,
        product_kind: "component",
        quantity: "12",
        serial_number: activeSerial,
      });
      expect(Object.keys(activeResult ?? {}).sort()).toEqual([
        "brand_name",
        "category",
        "id",
        "is_active",
        "name",
        "product_kind",
        "quantity",
        "serial_number",
      ]);

      for (const [label, authUserId] of [
        ["unpermitted_search", fixture.actors.unpermitted.authUserId],
        ["inactive_search", fixture.actors.inactive.authUserId],
      ] as const) {
        await database.query(`savepoint ${label}`);
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        await expect(
          database.query("select * from public.search_inventory_products(null)"),
        ).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint ${label}`);
        await database.query("reset role");
      }

      const infrastructure = await database.query<{
        catalog_index: string | null;
        category_index: string | null;
        extension_schema: string;
        function_definition: string;
        name_index: string | null;
      }>(
        `select
           pg_catalog.pg_get_indexdef(name_index.indexrelid) as name_index,
           pg_catalog.pg_get_indexdef(category_index.indexrelid) as category_index,
           pg_catalog.pg_get_indexdef(catalog_index.indexrelid) as catalog_index,
           extension_namespace.nspname as extension_schema,
           pg_catalog.pg_get_functiondef(search_function.oid) as function_definition
         from pg_catalog.pg_extension as extension
         join pg_catalog.pg_namespace as extension_namespace
           on extension_namespace.oid = extension.extnamespace
         join pg_catalog.pg_proc as search_function
           on search_function.proname = 'search_inventory_products'
         join pg_catalog.pg_namespace as function_namespace
           on function_namespace.oid = search_function.pronamespace
          and function_namespace.nspname = 'public'
         left join pg_catalog.pg_class as product_table
           on product_table.relname = 'products'
         left join pg_catalog.pg_namespace as product_namespace
           on product_namespace.oid = product_table.relnamespace
          and product_namespace.nspname = 'public'
         left join pg_catalog.pg_index as name_index
           on name_index.indrelid = product_table.oid
          and name_index.indexrelid = 'public.products_name_search_trgm_idx'::regclass
         left join pg_catalog.pg_index as category_index
           on category_index.indrelid = product_table.oid
          and category_index.indexrelid =
            'public.products_category_search_trgm_idx'::regclass
         left join pg_catalog.pg_class as relation_table
           on relation_table.relname = 'product_suppliers'
         left join pg_catalog.pg_namespace as relation_namespace
           on relation_namespace.oid = relation_table.relnamespace
          and relation_namespace.nspname = 'public'
         left join pg_catalog.pg_index as catalog_index
           on catalog_index.indrelid = relation_table.oid
          and catalog_index.indexrelid =
            'public.product_suppliers_catalog_number_search_trgm_idx'::regclass
         where extension.extname = 'pg_trgm'`,
      );
      expect(infrastructure.rows).toHaveLength(1);
      expect(infrastructure.rows[0]?.extension_schema).toBe("extensions");
      expect(infrastructure.rows[0]?.name_index).toContain("gin_trgm_ops");
      expect(infrastructure.rows[0]?.category_index).toContain("gin_trgm_ops");
      expect(infrastructure.rows[0]?.catalog_index).toContain("gin_trgm_ops");
      expect(infrastructure.rows[0]?.function_definition).toContain(
        "SECURITY DEFINER",
      );
      expect(infrastructure.rows[0]?.function_definition).toContain(
        "SET search_path TO ''",
      );
      expect(infrastructure.rows[0]?.function_definition).toContain(
        "lower(product.category)",
      );
    });

    const anonymous = await fixture.anonymousClient.rpc(
      "search_inventory_products",
      { p_search: null },
    );
    expectPermissionDenied(anonymous.error);
  });
  it("returns Product-specific immutable Inventory history with only the actor display name", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const activeProductId = randomUUID();
      const archivedProductId = randomUUID();
      const olderMovementId = randomUUID();
      const tieMovementIds = [randomUUID(), randomUUID()].sort();
      const lowerTieMovementId = tieMovementIds[0];
      const higherTieMovementId = tieMovementIds[1];
      if (!lowerTieMovementId || !higherTieMovementId) {
        throw new Error("Movement fixture IDs are unavailable");
      }
      const archivedMovementId = randomUUID();
      const activeProductSerial = createTestSerialNumber();
      let archivedProductSerial = createTestSerialNumber();
      while (archivedProductSerial === activeProductSerial) {
        archivedProductSerial = createTestSerialNumber();
      }

      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind, is_active,
           created_by_user_id, updated_by_user_id, archived_at,
           archived_by_user_id
         ) values
           ($1::uuid, $3::text, 'History Active Product', 'Components',
            'component', true, $5::uuid, $5::uuid, null, null),
           ($2::uuid, $4::text, 'History Archived Product', 'Components',
            'component', false, $5::uuid, $5::uuid,
            pg_catalog.now(), $5::uuid)`,
        [
          activeProductId,
          archivedProductId,
          activeProductSerial,
          archivedProductSerial,
          actor.profileId,
        ],
      );
      await database.query(
        `insert into public.inventory_movements (
           id, product_id, movement_type, quantity_delta,
           quantity_before, quantity_after, reason, source_type, source_id,
           project_id, actor_user_id, created_at,
           reversal_of_movement_id
         ) values
           ($1::uuid, $5::uuid, 'manual_add', 10, 0, 10, null, null, null,
            null, $7::uuid, '2026-09-14T10:00:00Z'::timestamptz, null),
           ($2::uuid, $5::uuid, 'manual_remove', -2, 10, 8,
            'Issued to workshop', 'manual_adjustment', $8::uuid,
            null, $7::uuid, '2026-09-14T12:00:00Z'::timestamptz, null),
           ($3::uuid, $5::uuid, 'manual_correction', 1, 8, 9,
            'Count corrected', 'correction_reversal', null,
            null, $7::uuid, '2026-09-14T12:00:00Z'::timestamptz, $1::uuid),
           ($4::uuid, $6::uuid, 'manual_add', 4, 0, 4,
            'Historical receipt', null, null, null, $7::uuid,
            '2026-09-13T09:00:00Z'::timestamptz, null)`,
        [
          olderMovementId,
          lowerTieMovementId,
          higherTieMovementId,
          archivedMovementId,
          activeProductId,
          archivedProductId,
          actor.profileId,
          randomUUID(),
        ],
      );

      const readAs = async (
        authUserId: string,
        productId: string,
      ): Promise<InventoryMovementHistoryRow[]> => {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<InventoryMovementHistoryRow>(
          `select *
           from public.get_inventory_movements_for_product($1::uuid)`,
          [productId],
        );
        await database.query("reset role");
        return result.rows;
      };

      const adminRows = await readAs(
        fixture.actors.admin.authUserId,
        activeProductId,
      );
      const inventoryViewerRows = await readAs(
        fixture.actors.brandManager.authUserId,
        archivedProductId,
      );

      expect(adminRows.map((row) => row.movement_id)).toEqual([
        higherTieMovementId,
        lowerTieMovementId,
        olderMovementId,
      ]);
      expect(inventoryViewerRows.map((row) => row.movement_id))
        .toEqual([archivedMovementId]);
      expect(adminRows.every((row) => row.actor_user_id === actor.profileId))
        .toBe(true);
      expect(adminRows.every((row) => row.actor_full_name.length > 0))
        .toBe(true);
      expect(adminRows[0]).toMatchObject({
        movement_type: "manual_correction",
        quantity_delta: "1",
        quantity_before: "8",
        quantity_after: "9",
        reason: "Count corrected",
        reversal_of_movement_id: olderMovementId,
      });
      expect(Object.keys(adminRows[0] ?? {}).sort()).toEqual([
        "actor_full_name",
        "actor_user_id",
        "created_at",
        "movement_id",
        "movement_type",
        "project_id",
        "quantity_after",
        "quantity_before",
        "quantity_delta",
        "reason",
        "reversal_of_movement_id",
        "source_id",
        "source_type",
      ]);

      for (const [label, authUserId] of [
        ["unpermitted_history", fixture.actors.unpermitted.authUserId],
        ["inactive_history", fixture.actors.inactive.authUserId],
      ] as const) {
        await database.query(`savepoint ${label}`);
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        await expect(
          database.query(
            "select * from public.get_inventory_movements_for_product($1::uuid)",
            [activeProductId],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint ${label}`);
        await database.query("reset role");
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint null_history_product");
      await expect(
        database.query(
          "select * from public.get_inventory_movements_for_product(null::uuid)",
        ),
      ).rejects.toMatchObject({ code: "22023" });
      await database.query("rollback to savepoint null_history_product");
      await database.query("reset role");

      await database.query("savepoint immutable_history_update");
      await expect(
        database.query(
          `update public.inventory_movements
           set reason = 'Forbidden'
           where id = $1::uuid`,
          [olderMovementId],
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await database.query("rollback to savepoint immutable_history_update");
      await database.query("savepoint immutable_history_delete");
      await expect(
        database.query(
          "delete from public.inventory_movements where id = $1::uuid",
          [olderMovementId],
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await database.query("rollback to savepoint immutable_history_delete");

      const security = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        definition: string;
        index_definition: string;
        is_security_definer: boolean;
        settings: string[];
      }>(
        `select
           pg_catalog.has_function_privilege(
             'anon', routine.oid, 'execute'
           ) as anonymous_execute,
           pg_catalog.has_function_privilege(
             'authenticated', routine.oid, 'execute'
           ) as authenticated_execute,
           pg_catalog.pg_get_functiondef(routine.oid) as definition,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.pg_get_indexdef(history_index.indexrelid)
             as index_definition
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as function_namespace
           on function_namespace.oid = routine.pronamespace
          and function_namespace.nspname = 'public'
         join pg_catalog.pg_index as history_index
           on history_index.indexrelid =
             'public.inventory_movements_product_created_id_idx'::regclass
         where routine.proname = 'get_inventory_movements_for_product'`,
      );
      expect(security.rows).toHaveLength(1);
      expect(security.rows[0]).toMatchObject({
        anonymous_execute: false,
        authenticated_execute: true,
        is_security_definer: true,
        settings: ["search_path=\"\""],
      });
      expect(security.rows[0]?.definition).toContain("actor.full_name");
      expect(security.rows[0]?.definition).not.toMatch(
        /actor\.(email|birthday|is_admin)/,
      );
      expect(security.rows[0]?.index_definition).toContain(
        "product_id, created_at DESC, id DESC",
      );
    });

    const anonymous = await fixture.anonymousClient.rpc(
      "get_inventory_movements_for_product",
      { p_product_id: randomUUID() },
    );
    expectPermissionDenied(anonymous.error);

    const crossProfileRead = await fixture.actors.brandManager.client
      .from("user_profiles")
      .select("id,full_name,email,is_admin,birthday")
      .eq("id", fixture.actors.admin.profileId);
    expect(crossProfileRead.error).toBeNull();
    expect(crossProfileRead.data).toEqual([]);
  });

}
