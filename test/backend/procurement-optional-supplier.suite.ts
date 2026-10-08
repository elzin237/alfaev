import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import type {
  SecurityActor,
  SecurityFixtureHarness,
} from "./security-fixtures";

async function actAs(
  database: PoolClient,
  actor: Pick<SecurityActor, "authUserId">,
): Promise<void> {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor.authUserId],
  );
  await database.query("set local role authenticated");
}

export function registerProcurementOptionalSupplierTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe.skipIf(
    process.env.PROCUREMENT_OPTIONAL_SUPPLIER_MIGRATION !== "1",
  )("Procurement optional Supplier correction", () => {
    it("creates, reads, audits, delivers, resolves, and Product-links requests without inventing a Supplier", async () => {
      const fixture = requireHarness();
      const admin = fixture.actors.admin;
      const creator = await fixture.createTemporaryProfile(
        "procurement-no-supplier-creator",
        undefined,
        admin.profileId,
      );
      const viewer = await fixture.createTemporaryProfile(
        "procurement-no-supplier-viewer",
        undefined,
        admin.profileId,
      );
      const unauthorized = await fixture.createTemporaryProfile(
        "procurement-no-supplier-unauthorized",
        undefined,
        admin.profileId,
      );

      await fixture.withRollbackDatabaseTransaction(async (database) => {
        await database.query(
          `insert into public.user_permissions (
             user_id, permission_definition_id, granted_by_user_id
           )
           select actor.profile_id, definition.id, $3::uuid
           from (
             values
               ($1::uuid, 'procurement.create'::text),
               ($2::uuid, 'procurement.view'::text)
           ) as actor(profile_id, permission_key)
           join public.permission_definitions as definition
             on definition.key = actor.permission_key`,
          [creator.profileId, viewer.profileId, admin.profileId],
        );

        const productId = randomUUID();
        const existingSupplierId = randomUUID();
        const historicalRequestId = randomUUID();
        const serial = await database.query<{ value: string }>(
          "select public.allocate_product_serial_number() as value",
        );
        await database.query(
          `insert into public.products (
             id, serial_number, name, category, product_kind,
             created_by_user_id, updated_by_user_id
           ) values ($1, $2, 'Optional Supplier Existing Product',
             'Component', 'component', $3, $3)`,
          [productId, serial.rows[0]?.value, admin.profileId],
        );
        await database.query(
          `insert into public.suppliers (
             id, name, country, created_by_user_id, updated_by_user_id
           ) values (
             $1, 'Historical Procurement Supplier',
             'Bosnia and Herzegovina', $2, $2
           )`,
          [existingSupplierId, admin.profileId],
        );
        await database.query(
          `insert into public.procurement_requests (
             id, requested_name, supplier_id, requested_quantity,
             created_by_user_id, updated_by_user_id
           ) values ($1, 'Historical supplied request', $2, 2, $3, $3)`,
          [historicalRequestId, existingSupplierId, admin.profileId],
        );

        await actAs(database, unauthorized);
        await database.query("savepoint unauthorized_creation");
        await expect(database.query(
          "select public.create_procurement_request_for_product($1, 1)",
          [productId],
        )).rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint unauthorized_creation");
        await database.query("reset role");

        await actAs(database, creator);
        const existingResult = await database.query<{ id: string }>(
          `select public.create_procurement_request_for_product(
             $1, 7
           ) as id`,
          [productId],
        );
        const newResult = await database.query<{ id: string }>(
          `select public.create_procurement_request_for_new_component(
             '  Supplier-free new component  ', 5
           ) as id`,
        );
        await database.query("reset role");

        const existingRequestId = existingResult.rows[0]?.id;
        const newRequestId = newResult.rows[0]?.id;
        expect(existingRequestId).toBeTruthy();
        expect(newRequestId).toBeTruthy();

        const created = await database.query<{
          product_id: string | null;
          requested_name: string;
          supplier_id: string | null;
        }>(
          `select product_id, requested_name, supplier_id
           from public.procurement_requests
           where id = any($1::uuid[])
           order by requested_name`,
          [[existingRequestId, newRequestId]],
        );
        expect(created.rows).toEqual([
          {
            product_id: productId,
            requested_name: "Optional Supplier Existing Product",
            supplier_id: null,
          },
          {
            product_id: null,
            requested_name: "Supplier-free new component",
            supplier_id: null,
          },
        ]);

        const audits = await database.query<{
          after_data: Record<string, unknown>;
        }>(
          `select after_data
           from public.audit_logs
           where action_type = 'procurement.created'
             and entity_id = any($1::uuid[])
           order by entity_id`,
          [[existingRequestId, newRequestId]],
        );
        expect(audits.rows).toHaveLength(2);
        expect(audits.rows.every((row) => row.after_data.supplier_id === null))
          .toBe(true);

        await actAs(database, viewer);
        const listed = await database.query<{
          request_id: string;
          supplier_id: string | null;
          supplier_name: string | null;
        }>(
          "select request_id, supplier_id, supplier_name from public.search_procurement_requests()",
        );
        await database.query("reset role");
        expect(listed.rows).toEqual(expect.arrayContaining([
          {
            request_id: existingRequestId,
            supplier_id: null,
            supplier_name: null,
          },
          {
            request_id: newRequestId,
            supplier_id: null,
            supplier_name: null,
          },
          {
            request_id: historicalRequestId,
            supplier_id: existingSupplierId,
            supplier_name: "Historical Procurement Supplier",
          },
        ]));

        await actAs(database, admin);
        await database.query(
          "select public.update_procurement_delivered_quantity($1, 2)",
          [existingRequestId],
        );
        await database.query(
          "select public.resolve_procurement_request($1)",
          [existingRequestId],
        );
        await database.query("reset role");

        await database.query("savepoint invalid_supplier_fk");
        await expect(database.query(
          `insert into public.procurement_requests (
             requested_name, supplier_id, requested_quantity,
             created_by_user_id, updated_by_user_id
           ) values ('Invalid Supplier', $1, 1, $2, $2)`,
          [randomUUID(), admin.profileId],
        )).rejects.toMatchObject({ code: "23503" });
        await database.query("rollback to savepoint invalid_supplier_fk");

        await actAs(database, admin);
        await database.query("savepoint catalog_without_supplier");
        await expect(database.query(
          `select * from public.create_product_from_procurement_request(
             $1, 'Catalog misuse', 'Component', null, 'SHOULD-NOT-PERSIST'
           )`,
          [newRequestId],
        )).rejects.toMatchObject({ code: "22023" });
        await database.query("rollback to savepoint catalog_without_supplier");

        const productResult = await database.query<{
          product_id: string;
          serial_number: string;
        }>(
          `select * from public.create_product_from_procurement_request(
             $1, 'Supplier-free final Product', 'Component', null, null
           )`,
          [newRequestId],
        );
        await database.query("reset role");
        const createdProductId = productResult.rows[0]?.product_id;
        expect(createdProductId).toBeTruthy();

        const sideEffects = await database.query<{
          balance_count: number;
          movement_count: number;
          relation_count: number;
        }>(
          `select
             (select count(*)::integer from public.inventory_balances
              where product_id = $1) as balance_count,
             (select count(*)::integer from public.inventory_movements
              where product_id = $1) as movement_count,
             (select count(*)::integer from public.product_suppliers
              where product_id = $1) as relation_count`,
          [createdProductId],
        );
        expect(sideEffects.rows).toEqual([{
          balance_count: 1,
          movement_count: 0,
          relation_count: 0,
        }]);
      });
    });
  });
}
