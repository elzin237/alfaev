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

interface PcbCardRow {
  archived_at: Date | null;
  archived_by_user_id: string | null;
  created_at: Date;
  created_by_user_id: string;
  id: string;
  is_active: boolean;
  name: string;
  output_product_id: string;
  updated_at: Date;
  updated_by_user_id: string;
}

export function registerPcbTests(requireHarness: () => SecurityFixtureHarness): void {
  it("lists PCB Cards through a narrow authorized Product and stock projection", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const productId = randomUUID();
      const cardId = randomUUID();
      const serial = createTestSerialNumber();
      const archivedProductId = randomUUID();
      const archivedCardId = randomUUID();
      let archivedSerial = createTestSerialNumber();
      while (archivedSerial === serial) archivedSerial = createTestSerialNumber();
      await database.query(
        `insert into public.products (id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id)
         values ($1, $2, 'Private Product Name', 'PCB', 'pcb_finished_good', $3, $3)`,
        [productId, serial, actorId],
      );
      await database.query(
        `insert into public.pcb_cards (id, name, output_product_id,
           created_by_user_id, updated_by_user_id)
         values ($1, 'List Test Card', $2, $3, $3)`,
        [cardId, productId, actorId],
      );
      await database.query(
        `insert into public.products (id, serial_number, name, category, product_kind,
           is_active, archived_at, archived_by_user_id, created_by_user_id, updated_by_user_id)
         values ($1, $2, 'Private Archived Product', 'PCB', 'pcb_finished_good',
           false, pg_catalog.now(), $3, $3, $3)`,
        [archivedProductId, archivedSerial, actorId],
      );
      await database.query(
        `insert into public.pcb_cards (id, name, output_product_id, is_active,
           archived_at, archived_by_user_id, created_by_user_id, updated_by_user_id)
         values ($1, 'Archived List Card', $2, false, pg_catalog.now(), $3, $3, $3)`,
        [archivedCardId, archivedProductId, actorId],
      );
      await database.query(
        "update public.inventory_balances set quantity = 4 where product_id = $1",
        [productId],
      );
      await database.query(
        `insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id)
         select $1, id, $2 from public.permission_definitions where key = 'pcb.view'`,
        [fixture.actors.permitted.profileId, actorId],
      );

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        security_definer: boolean;
        search_path: string[];
      }>(
        `select p.prosecdef as security_definer,
                pg_catalog.has_function_privilege('anon', p.oid, 'execute') as anonymous_execute,
                pg_catalog.has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
                p.proconfig as search_path
         from pg_catalog.pg_proc p
         where p.oid = 'public.list_pcb_cards()'::pg_catalog.regprocedure`,
      );
      expect(functionSecurity.rows).toEqual([{
        anonymous_execute: false,
        authenticated_execute: true,
        security_definer: true,
        search_path: ['search_path=""'],
      }]);

      for (const actor of [fixture.actors.admin, fixture.actors.permitted]) {
        await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [actor.authUserId]);
        await database.query("set local role authenticated");
        const response = await database.query<Record<string, unknown>>("select * from public.list_pcb_cards()");
        await database.query("reset role");
        const listed = response.rows.find((row) => row.pcb_card_id === cardId);
        expect(listed).toEqual({
          pcb_card_id: cardId,
          card_name: "List Test Card",
          is_active: true,
          output_product_id: productId,
          serial_number: serial,
          current_stock: "4",
        });
        expect(response.rows.find((row) => row.pcb_card_id === archivedCardId)).toEqual({
          pcb_card_id: archivedCardId,
          card_name: "Archived List Card",
          is_active: false,
          output_product_id: archivedProductId,
          serial_number: archivedSerial,
          current_stock: "0",
        });
        expect(response.rows.findIndex((row) => row.pcb_card_id === cardId))
          .toBeLessThan(response.rows.findIndex((row) => row.pcb_card_id === archivedCardId));
      }

      for (const actor of [fixture.actors.unpermitted, fixture.actors.inactive]) {
        await database.query("savepoint denied_pcb_list");
        await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [actor.authUserId]);
        await database.query("set local role authenticated");
        await expect(database.query("select * from public.list_pcb_cards()"))
          .rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint denied_pcb_list");
      }
      await database.query("savepoint anon_pcb_list");
      await database.query("set local role anon");
      await expect(database.query("select * from public.list_pcb_cards()"))
        .rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anon_pcb_list");
      expect((await database.query<{ count: string }>(
        "select count(*) from public.inventory_movements where product_id = any($1::uuid[])",
        [[productId, archivedProductId]],
      )).rows).toEqual([{ count: "0" }]);
    });
  });

  it("enforces the canonical PcbCard schema and protected output Product relationship", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const activeOutputId = randomUUID();
      const archivedOutputId = randomUUID();
      const componentId = randomUUID();
      const alternateOutputId = randomUUID();
      const unusedOutputId = randomUUID();
      const productIds = [
        activeOutputId,
        archivedOutputId,
        componentId,
        alternateOutputId,
        unusedOutputId,
      ];
      const serials = productIds.map(() => createTestSerialNumber());

      while (new Set(serials).size !== serials.length) {
        serials.splice(0, serials.length, ...productIds.map(() => createTestSerialNumber()));
      }

      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind, is_active,
           created_by_user_id, updated_by_user_id, archived_at,
           archived_by_user_id
         ) values
           ($1, $6, 'PCB Output A', 'PCB', 'pcb_finished_good', true, $11, $11, null, null),
           ($2, $7, 'PCB Output Archived', 'PCB', 'pcb_finished_good', false, $11, $11, pg_catalog.now(), $11),
           ($3, $8, 'Component Output', 'Components', 'component', true, $11, $11, null, null),
           ($4, $9, 'PCB Output B', 'PCB', 'pcb_finished_good', true, $11, $11, null, null),
           ($5, $10, 'PCB Output Unused', 'PCB', 'pcb_finished_good', true, $11, $11, null, null)`,
        [...productIds, ...serials, actorId],
      );

      const productsBefore = await database.query<ProductRow>(
        "select * from public.products where id = any($1::uuid[]) order by id",
        [productIds],
      );
      const activeCardId = randomUUID();
      const archivedCardId = randomUUID();

      await database.query(
        `insert into public.pcb_cards (
           id, name, output_product_id, created_by_user_id, updated_by_user_id
         ) values ($1, 'Controller Card', $2, $3, $3)`,
        [activeCardId, activeOutputId, actorId],
      );
      await database.query(
        `insert into public.pcb_cards (
           id, name, output_product_id, is_active,
           created_by_user_id, updated_by_user_id,
           archived_at, archived_by_user_id
         ) values ($1, 'Controller Card', $2, false, $3, $3, pg_catalog.now(), $3)`,
        [archivedCardId, archivedOutputId, actorId],
      );

      const cards = await database.query<PcbCardRow>(
        "select * from public.pcb_cards where id = any($1::uuid[]) order by id",
        [[activeCardId, archivedCardId]],
      );
      expect(cards.rows).toHaveLength(2);
      expect(cards.rows.find((row) => row.id === activeCardId)).toMatchObject({
        archived_at: null,
        archived_by_user_id: null,
        created_by_user_id: actorId,
        is_active: true,
        name: "Controller Card",
        output_product_id: activeOutputId,
        updated_by_user_id: actorId,
      });
      expect(cards.rows.find((row) => row.id === archivedCardId)).toMatchObject({
        archived_by_user_id: actorId,
        is_active: false,
        name: "Controller Card",
        output_product_id: archivedOutputId,
      });
      expect(cards.rows.find((row) => row.id === archivedCardId)?.archived_at)
        .toBeInstanceOf(Date);
      expect((await database.query<ProductRow>(
        "select * from public.products where id = any($1::uuid[]) order by id",
        [productIds],
      )).rows).toEqual(productsBefore.rows);

      for (const invalidName of ["   ", " Untrimmed", "Trailing "]) {
        await database.query("savepoint invalid_pcb_card_name");
        await expect(database.query(
          `insert into public.pcb_cards (
             name, output_product_id, created_by_user_id, updated_by_user_id
           ) values ($1, $2, $3, $3)`,
          [invalidName, unusedOutputId, actorId],
        )).rejects.toMatchObject({ code: "23514" });
        await database.query("rollback to savepoint invalid_pcb_card_name");
      }

      await database.query("savepoint invalid_pcb_output_kind");
      await expect(database.query(
        `insert into public.pcb_cards (
           name, output_product_id, created_by_user_id, updated_by_user_id
         ) values ('Invalid Component Output', $1, $2, $2)`,
        [componentId, actorId],
      )).rejects.toMatchObject({ code: "PCB01" });
      await database.query("rollback to savepoint invalid_pcb_output_kind");

      await database.query("savepoint missing_pcb_output");
      await expect(database.query(
        `insert into public.pcb_cards (
           name, output_product_id, created_by_user_id, updated_by_user_id
         ) values ('Missing Output', $1, $2, $2)`,
        [randomUUID(), actorId],
      )).rejects.toMatchObject({ code: "23503" });
      await database.query("rollback to savepoint missing_pcb_output");

      await database.query("savepoint duplicate_pcb_output");
      await expect(database.query(
        `insert into public.pcb_cards (
           name, output_product_id, created_by_user_id, updated_by_user_id
         ) values ('Duplicate Output', $1, $2, $2)`,
        [activeOutputId, actorId],
      )).rejects.toMatchObject({ code: "23505" });
      await database.query("rollback to savepoint duplicate_pcb_output");

      await database.query("savepoint immutable_pcb_output");
      await expect(database.query(
        "update public.pcb_cards set output_product_id = $2 where id = $1",
        [activeCardId, alternateOutputId],
      )).rejects.toMatchObject({ code: "PCB02" });
      await database.query("rollback to savepoint immutable_pcb_output");
      expect((await database.query<{ output_product_id: string }>(
        "select output_product_id from public.pcb_cards where id = $1",
        [activeCardId],
      )).rows).toEqual([{ output_product_id: activeOutputId }]);

      for (const [isActive, hasArchivedAt, hasArchivedBy] of [
        [true, true, false],
        [true, false, true],
        [false, false, false],
        [false, true, false],
        [false, false, true],
      ] as const) {
        await database.query("savepoint invalid_pcb_lifecycle");
        await expect(database.query(
          `insert into public.pcb_cards (
             name, output_product_id, is_active,
             created_by_user_id, updated_by_user_id,
             archived_at, archived_by_user_id
           ) values (
             'Invalid Lifecycle', $1, $2, $3, $3,
             case when $4::boolean then pg_catalog.now() else null end,
             case when $5::boolean then $3::uuid else null end
           )`,
          [unusedOutputId, isActive, actorId, hasArchivedAt, hasArchivedBy],
        )).rejects.toMatchObject({ code: "23514" });
        await database.query("rollback to savepoint invalid_pcb_lifecycle");
      }

      for (const actorColumn of [
        "created_by_user_id",
        "updated_by_user_id",
        "archived_by_user_id",
      ] as const) {
        await database.query("savepoint invalid_pcb_actor");
        const missingActorId = randomUUID();
        const values = {
          archived_by_user_id: actorId,
          created_by_user_id: actorId,
          updated_by_user_id: actorId,
        };
        values[actorColumn] = missingActorId;
        await expect(database.query(
          `insert into public.pcb_cards (
             name, output_product_id, is_active,
             created_by_user_id, updated_by_user_id,
             archived_at, archived_by_user_id
           ) values ('Invalid Actor', $1, false, $2, $3, pg_catalog.now(), $4)`,
          [
            unusedOutputId,
            values.created_by_user_id,
            values.updated_by_user_id,
            values.archived_by_user_id,
          ],
        )).rejects.toMatchObject({ code: "23503" });
        await database.query("rollback to savepoint invalid_pcb_actor");
      }

      await database.query(
        `update public.products
         set is_active = false,
             updated_at = pg_catalog.now(),
             updated_by_user_id = $2,
             archived_at = pg_catalog.now(),
             archived_by_user_id = $2
         where id = $1`,
        [activeOutputId, actorId],
      );
      expect((await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.pcb_cards
         where id = $1 and output_product_id = $2`,
        [activeCardId, activeOutputId],
      )).rows).toEqual([{ count: 1 }]);

      await database.query("savepoint immutable_output_product_kind");
      await expect(database.query(
        "update public.products set product_kind = 'component' where id = $1",
        [alternateOutputId],
      )).rejects.toMatchObject({ code: "PRD02" });
      await database.query("rollback to savepoint immutable_output_product_kind");

      const productsAfter = await database.query<ProductRow>(
        "select * from public.products where id = any($1::uuid[]) order by id",
        [productIds],
      );
      const changedProduct = productsAfter.rows.find(
        (row) => row.id === activeOutputId,
      );
      expect(changedProduct).toMatchObject({
        is_active: false,
        product_kind: "pcb_finished_good",
      });
      expect(productsAfter.rows.filter((row) => row.id !== activeOutputId))
        .toEqual(productsBefore.rows.filter((row) => row.id !== activeOutputId));
      expect((await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.inventory_balances
         where product_id = any($1::uuid[])
           and quantity = 0`,
        [productIds],
      )).rows).toEqual([{ count: productIds.length }]);
      expect((await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.inventory_movements
         where product_id = any($1::uuid[])`,
        [productIds],
      )).rows).toEqual([{ count: 0 }]);
    });
  });
  it("limits PcbCard reads and denies direct writes at the Task 085 boundary", async () => {
    const fixture = requireHarness();
    const directInsert = await fixture.actors.admin.client.from("pcb_cards").insert({
      name: "Forbidden direct PCB Card",
      output_product_id: randomUUID(),
      created_by_user_id: fixture.actors.admin.profileId,
      updated_by_user_id: fixture.actors.admin.profileId,
    });
    expectPermissionDenied(directInsert.error);

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const activeOutputId = randomUUID();
      const archivedOutputId = randomUUID();
      const activeCardId = randomUUID();
      const archivedCardId = randomUUID();
      let archivedSerial = createTestSerialNumber();
      const activeSerial = createTestSerialNumber();
      while (archivedSerial === activeSerial) archivedSerial = createTestSerialNumber();

      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values
           ($1, $3, 'Readable PCB A', 'PCB', 'pcb_finished_good', $5, $5),
           ($2, $4, 'Readable PCB B', 'PCB', 'pcb_finished_good', $5, $5)`,
        [activeOutputId, archivedOutputId, activeSerial, archivedSerial, actorId],
      );
      await database.query(
        `insert into public.pcb_cards (
           id, name, output_product_id, is_active,
           created_by_user_id, updated_by_user_id,
           archived_at, archived_by_user_id
         ) values
           ($1, 'Active Readable Card', $3, true, $5, $5, null, null),
           ($2, 'Archived Readable Card', $4, false, $5, $5, pg_catalog.now(), $5)`,
        [activeCardId, archivedCardId, activeOutputId, archivedOutputId, actorId],
      );
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         ) select $1, definition.id, $2
           from public.permission_definitions as definition
          where definition.key = 'pcb.view'`,
        [fixture.actors.permitted.profileId, actorId],
      );

      for (const actor of [fixture.actors.admin, fixture.actors.permitted]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ id: string }>(
          "select id from public.pcb_cards where id = any($1::uuid[]) order by id",
          [[activeCardId, archivedCardId]],
        );
        await database.query("reset role");
        expect(visible.rows.map((row) => row.id).sort())
          .toEqual([activeCardId, archivedCardId].sort());
      }

      for (const actor of [fixture.actors.unpermitted, fixture.actors.inactive]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ id: string }>(
          "select id from public.pcb_cards where id = any($1::uuid[])",
          [[activeCardId, archivedCardId]],
        );
        await database.query("reset role");
        expect(hidden.rows).toEqual([]);
      }

      await database.query("savepoint anonymous_pcb_read");
      await database.query("set local role anon");
      await expect(database.query("select id from public.pcb_cards limit 1"))
        .rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_pcb_read");
      await database.query("reset role");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      for (const statement of [
        {
          sql: `insert into public.pcb_cards (
                  name, output_product_id, created_by_user_id, updated_by_user_id
                ) values ('Forbidden', $1::uuid, $2::uuid, $2::uuid)`,
          values: [randomUUID(), actorId],
        },
        {
          sql: "update public.pcb_cards set name = 'Forbidden' where id = $1::uuid",
          values: [activeCardId],
        },
        {
          sql: "delete from public.pcb_cards where id = $1::uuid",
          values: [activeCardId],
        },
      ]) {
        await database.query("savepoint denied_pcb_write");
        await expect(database.query(statement.sql, statement.values))
          .rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint denied_pcb_write");
      }
      await database.query("reset role");

      const tableSecurity = await database.query<{
        authenticated_delete: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        row_security: boolean;
      }>(
        `select
           relation.relrowsecurity as row_security,
           pg_catalog.has_table_privilege('authenticated', relation.oid, 'select') as authenticated_select,
           pg_catalog.has_table_privilege('authenticated', relation.oid, 'insert') as authenticated_insert,
           pg_catalog.has_table_privilege('authenticated', relation.oid, 'update') as authenticated_update,
           pg_catalog.has_table_privilege('authenticated', relation.oid, 'delete') as authenticated_delete
         from pg_catalog.pg_class as relation
         join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'public' and relation.relname = 'pcb_cards'`,
      );
      expect(tableSecurity.rows).toEqual([{
        authenticated_delete: false,
        authenticated_insert: false,
        authenticated_select: true,
        authenticated_update: false,
        row_security: true,
      }]);

      const triggerSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        identity_arguments: string;
        security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.prosecdef as security_definer,
           routine.proconfig as settings,
           pg_catalog.pg_get_function_identity_arguments(routine.oid) as identity_arguments,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute,
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'enforce_pcb_card_output_product'`,
      );
      expect(triggerSecurity.rows).toEqual([{
        anonymous_execute: false,
        authenticated_execute: false,
        identity_arguments: "",
        security_definer: true,
        settings: ["search_path=\"\""],
      }]);

      const unsupportedObjects = await database.query<{
        bom_tables: number;
        mutation_functions: number;
      }>(
        `select
           (select count(*)::integer
              from pg_catalog.pg_class as relation
              join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
             where namespace.nspname = 'public'
               and relation.relname in ('pcb_bom_versions', 'pcb_bom_items')) as bom_tables,
           (select count(*)::integer
              from pg_catalog.pg_proc as routine
              join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
             where namespace.nspname = 'public'
               and routine.proname in (
                 'update_pcb_card', 'archive_pcb_card',
                 'delete_pcb_card', 'reactivate_pcb_card', 'produce_pcb_card'
               )) as mutation_functions`,
      );
      expect(unsupportedObjects.rows).toEqual([{ bom_tables: 0, mutation_functions: 0 }]);
    });
  });

}
