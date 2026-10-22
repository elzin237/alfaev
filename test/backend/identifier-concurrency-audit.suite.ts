import { randomUUID } from "node:crypto";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

interface ProductCreationRow extends QueryResultRow {
  product_id: string;
  serial_number: string;
}

interface PcbCardCreationRow extends ProductCreationRow {
  pcb_card_id: string;
}

interface WorkOrderCreationRow extends QueryResultRow {
  work_order_id: string;
  work_order_number: string;
}

async function setActor(database: PoolClient, actor: SecurityActor): Promise<void> {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor.authUserId],
  );
  await database.query("set local role authenticated");
}

async function createProducts(
  database: PoolClient,
  actor: SecurityActor,
  count: number,
  label: string,
): Promise<ProductCreationRow[]> {
  await setActor(database, actor);
  const rows: ProductCreationRow[] = [];

  for (let index = 0; index < count; index += 1) {
    const created = await database.query<ProductCreationRow>(
      "select * from public.create_product($1::text, $2::text, null::uuid)",
      [`${label} ${index}`, "Task 147"],
    );
    rows.push(created.rows[0]!);
  }

  await database.query("reset role");
  return rows;
}

async function findIsolatedCounterYear(database: PoolClient): Promise<number> {
  const result = await database.query<{ business_year: number }>(
    `select candidate.business_year
     from pg_catalog.generate_series(5000, 8999) as candidate(business_year)
     where not exists (
       select 1
       from public.work_order_number_counters as counter
       where counter.business_year = candidate.business_year
     )
       and not exists (
         select 1
         from public.work_orders as work_order
         where work_order.work_order_number like
           'RN-' || candidate.business_year::text || '-%'
       )
     order by candidate.business_year
     limit 1`,
  );
  const year = result.rows[0]?.business_year;

  if (!year) throw new Error("No isolated Work Order counter year is available");
  return year;
}

function expectSerials(serials: readonly string[]): void {
  expect(serials.length).toBeGreaterThan(0);
  expect(serials.every((serial) => /^[0-9]{7}$/.test(serial))).toBe(true);
  expect(new Set(serials).size).toBe(serials.length);
}

function expectWorkOrderNumbers(
  numbers: readonly string[],
  businessYear: number,
): void {
  expect(numbers.length).toBeGreaterThan(0);
  expect(numbers.every((number) =>
    new RegExp(`^RN-${businessYear.toString().padStart(4, "0")}-[0-9]{4}$`)
      .test(number)
  )).toBe(true);
  expect(new Set(numbers).size).toBe(numbers.length);
}

export function registerIdentifierConcurrencyAuditTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 147 identifier concurrency audit", () => {
    it("uses one hardened non-cycling allocator for ordinary Product creation paths", async () => {
      const fixture = requireHarness();

      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const sequence = await database.query<{
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
        expect(sequence.rows).toEqual([{
          cache_size: "1",
          cycles: false,
          increment_by: "1",
          maximum_value: "9999999",
          minimum_value: "1",
          start_value: "1",
        }]);

        const productConstraints = await database.query<{ constraint_name: string }>(
          `select constraint_name
           from information_schema.table_constraints
           where table_schema = 'public'
             and table_name = 'products'
             and constraint_name in (
               'products_serial_number_key',
               'products_serial_number_format'
             )
           order by constraint_name`,
        );
        expect(productConstraints.rows).toEqual([
          { constraint_name: "products_serial_number_format" },
          { constraint_name: "products_serial_number_key" },
        ]);

        const insertFunctions = await database.query<{
          definition: string;
          function_name: string;
        }>(
          `select
             routine.proname as function_name,
             pg_catalog.lower(routine.prosrc) as definition
           from pg_catalog.pg_proc as routine
           join pg_catalog.pg_namespace as namespace
             on namespace.oid = routine.pronamespace
           where namespace.nspname = 'public'
             and routine.prokind = 'f'
             and pg_catalog.lower(routine.prosrc)
               like '%insert into public.products%'
           order by routine.proname`,
        );
        expect(insertFunctions.rows.map((row) => row.function_name)).toEqual([
          "bulk_import_components",
          "create_pcb_card",
          "create_product",
        ]);
        for (const routine of insertFunctions.rows.filter(
          (row) => row.function_name !== "create_pcb_card",
        )) {
          expect(routine.definition, routine.function_name)
            .toContain("public.allocate_product_serial_number()");
        }
        expect(insertFunctions.rows.find((row) => row.function_name === "create_pcb_card")?.definition)
          .not.toContain("public.allocate_product_serial_number()");

        const procurement = await database.query<{ definition: string }>(
          `select pg_catalog.lower(pg_catalog.pg_get_functiondef(
             'public.create_product_from_procurement_request(uuid,text,text,uuid)'
               ::pg_catalog.regprocedure
           )) as definition`,
        );
        expect(procurement.rows[0]?.definition).toContain("from public.create_product(");
        expect(procurement.rows[0]?.definition)
          .not.toContain("public.allocate_product_serial_number()");

        const boundaryFormatting = await database.query<{
          maximum_serial: string;
          truncated_overflow_text: string;
        }>(
          `select
             pg_catalog.lpad(9999999::text, 7, '0') as maximum_serial,
             pg_catalog.lpad(10000000::text, 7, '0') as truncated_overflow_text`,
        );
        expect(boundaryFormatting.rows).toEqual([{
          maximum_serial: "9999999",
          truncated_overflow_text: "1000000",
        }]);
      });
    });

    it("allocates a unique mixed-path Product Serial burst across independent sessions", async () => {
      const fixture = requireHarness();
      const burst = await fixture.withDatabaseClients(4, async (clients) => {
        const [normalAdmin, normalDelegate, pcbCreator, importer] = clients;

        if (!normalAdmin || !normalDelegate || !pcbCreator || !importer) {
          throw new Error("Task 147 Product concurrency clients are unavailable");
        }

        await Promise.all(clients.map((database) => database.query("begin")));
        await Promise.all([
          setActor(normalAdmin, fixture.actors.admin),
          setActor(normalDelegate, fixture.actors.productCreator),
          setActor(pcbCreator, fixture.actors.admin),
          setActor(importer, fixture.actors.productCreator),
        ]);
        const pcbSerials = (await normalAdmin.query<{ serial_number: string }>(
          `select pg_catalog.lpad(candidate::text, 3, '0') as serial_number
           from pg_catalog.generate_series(0, 999) as candidate
           where not exists (
             select 1 from public.products as product
             where product.serial_number = pg_catalog.lpad(candidate::text, 3, '0')
           )
           order by candidate limit 3`,
        )).rows.map((row) => row.serial_number);
        expect(pcbSerials).toHaveLength(3);

        const [adminProducts, delegatedProducts, pcbCards, imported] =
          await Promise.all([
            createProducts(
              normalAdmin,
              fixture.actors.admin,
              4,
              "Task 147 Admin Product",
            ),
            createProducts(
              normalDelegate,
              fixture.actors.productCreator,
              4,
              "Task 147 Delegated Product",
            ),
            (async () => {
              const rows: PcbCardCreationRow[] = [];
              for (let index = 0; index < 3; index += 1) {
                const result = await pcbCreator.query<PcbCardCreationRow>(
                  "select * from public.create_pcb_card($1::text, $2::text)",
                  [`Task 147 PCB Card ${index}`, pcbSerials[index]],
                );
                rows.push(result.rows[0]!);
              }
              return rows;
            })(),
            importer.query<ProductCreationRow>(
              "select product_id, serial_number from public.bulk_import_components($1::jsonb)",
              [JSON.stringify(Array.from({ length: 5 }, (_, index) => ({
                name: `Task 147 Imported Product ${index}`,
                category: "Task 147",
                brand: null,
              })))],
            ).then((result) => result.rows),
          ]);
        const created = [
          ...adminProducts,
          ...delegatedProducts,
          ...pcbCards,
          ...imported,
        ];
        const next = await normalAdmin.query<{ serial_number: string }>(
          "select public.allocate_product_serial_number() as serial_number",
        );

        await Promise.all(clients.map((database) => database.query("reset role")));

        for (const [database, rows] of [
          [normalAdmin, adminProducts],
          [normalDelegate, delegatedProducts],
          [pcbCreator, pcbCards],
          [importer, imported],
        ] as const) {
          const persisted = await database.query<{ count: string }>(
            `select pg_catalog.count(*)::text as count
             from public.products
             where id = any($1::uuid[])`,
            [rows.map((row) => row.product_id)],
          );
          expect(persisted.rows).toEqual([{ count: rows.length.toString() }]);
        }

        return {
          next: next.rows[0]!.serial_number,
          calculatorSerials: pcbCards.map((row) => row.serial_number),
          ordinarySerials: [
            ...adminProducts,
            ...delegatedProducts,
            ...imported,
          ].map((row) => row.serial_number),
          serials: created.map((row) => row.serial_number),
        };
      });

      expect(burst.serials).toHaveLength(16);
      expect(new Set(burst.serials).size).toBe(burst.serials.length);
      expectSerials(burst.ordinarySerials);
      expect(burst.calculatorSerials.every((serial) => /^[0-9]{3}$/.test(serial)))
        .toBe(true);
      expect(Number(burst.next)).toBeGreaterThan(
        Math.max(...burst.ordinarySerials.map(Number)),
      );

      const afterRollback = await fixture.withRollbackDatabaseTransaction(
        async (database) => {
          return (await database.query<{ serial_number: string }>(
            "select public.allocate_product_serial_number() as serial_number",
          )).rows[0]!.serial_number;
        },
      );
      expect(Number(afterRollback)).toBeGreaterThan(Number(burst.next));
    });

    it("shares Product allocation between normal and Procurement creation races", async () => {
      const fixture = requireHarness();
      await fixture.withDatabaseClients(3, async (clients) => {
        const [coordinator, normalCreator, procurementCreator] = clients;

        if (!coordinator || !normalCreator || !procurementCreator) {
          throw new Error("Task 147 Procurement concurrency clients are unavailable");
        }

        const supplierId = randomUUID();
        const requestId = randomUUID();
        try {
          await coordinator.query(
            `insert into public.suppliers (
               id, name, catalog_number, country, created_by_user_id, updated_by_user_id
             ) values ($1::uuid, $2::text, 'TASK147-CAT', 'BA', $3::uuid, $3::uuid)`,
            [supplierId, `Task 147 Supplier ${supplierId}`, fixture.actors.admin.profileId],
          );
          await coordinator.query(
            `insert into public.procurement_requests (
               id, requested_name, supplier_id, requested_quantity,
               created_by_user_id, updated_by_user_id
             ) values ($1::uuid, 'Task 147 Requested Product', $2::uuid, 1,
               $3::uuid, $3::uuid)`,
            [requestId, supplierId, fixture.actors.admin.profileId],
          );

          await Promise.all([
            normalCreator.query("begin"),
            procurementCreator.query("begin"),
          ]);
          await Promise.all([
            setActor(normalCreator, fixture.actors.admin),
            setActor(procurementCreator, fixture.actors.admin),
          ]);
          const [normal, procurement] = await Promise.all([
            normalCreator.query<ProductCreationRow>(
              "select * from public.create_product($1::text, $2::text, null::uuid)",
              ["Task 147 Concurrent Normal", "Task 147"],
            ),
            procurementCreator.query<ProductCreationRow>(
              `select * from public.create_product_from_procurement_request(
                 $1::uuid, $2::text, $3::text, null::uuid
               )`,
              [requestId, "Task 147 Concurrent Procurement", "Task 147"],
            ),
          ]);
          const serials = [
            normal.rows[0]!.serial_number,
            procurement.rows[0]!.serial_number,
          ];

          expectSerials(serials);
          await Promise.all([
            normalCreator.query("rollback"),
            procurementCreator.query("rollback"),
          ]);
          expect((await coordinator.query<{ product_id: string | null }>(
            "select product_id from public.procurement_requests where id = $1::uuid",
            [requestId],
          )).rows).toEqual([{ product_id: null }]);
        } finally {
          await normalCreator.query("rollback").catch(() => undefined);
          await procurementCreator.query("rollback").catch(() => undefined);
          await coordinator.query(
            "delete from public.procurement_requests where id = $1::uuid",
            [requestId],
          );
          await coordinator.query(
            "delete from public.suppliers where id = $1::uuid",
            [supplierId],
          );
        }
      });
    });

    it("never recycles an archived, duplicate, or rolled-back Product Serial", async () => {
      const fixture = requireHarness();
      let consumedSerial = "";

      await fixture.withRollbackDatabaseTransaction(async (database) => {
        consumedSerial = (await database.query<{ serial_number: string }>(
          "select public.allocate_product_serial_number() as serial_number",
        )).rows[0]!.serial_number;
        const productId = randomUUID();
        await database.query(
          `insert into public.products (
             id, serial_number, name, category, product_kind,
             created_by_user_id, updated_by_user_id
           ) values ($1::uuid, $2::text, 'Task 147 Archived Product',
             'Task 147', 'component', $3::uuid, $3::uuid)`,
          [productId, consumedSerial, fixture.actors.admin.profileId],
        );
        await database.query(
          `update public.products
           set is_active = false,
               archived_at = pg_catalog.clock_timestamp(),
               archived_by_user_id = $2::uuid,
               updated_at = pg_catalog.clock_timestamp(),
               updated_by_user_id = $2::uuid
           where id = $1::uuid`,
          [productId, fixture.actors.admin.profileId],
        );
        await database.query("savepoint duplicate_serial");
        await expect(database.query(
          `insert into public.products (
             serial_number, name, category, product_kind,
             created_by_user_id, updated_by_user_id
           ) values ($1::text, 'Task 147 Duplicate', 'Task 147', 'component',
             $2::uuid, $2::uuid)`,
          [consumedSerial, fixture.actors.admin.profileId],
        )).rejects.toMatchObject({ code: "23505" });
        await database.query("rollback to savepoint duplicate_serial");
      });

      const nextSerial = await fixture.withRollbackDatabaseTransaction(
        async (database) => {
          return (await database.query<{ serial_number: string }>(
            "select public.allocate_product_serial_number() as serial_number",
          )).rows[0]!.serial_number;
        },
      );
      expect(Number(nextSerial)).toBeGreaterThan(Number(consumedSerial));
    });

    it("atomically allocates a 32-number Work Order burst and keeps years independent", async () => {
      const fixture = requireHarness();
      await fixture.withDatabaseClients(4, async (clients) => {
        const coordinator = clients[0];
        if (!coordinator) throw new Error("Task 147 counter coordinator is unavailable");
        const businessYear = await findIsolatedCounterYear(coordinator);
        const allocations: string[] = [];

        try {
          for (let wave = 0; wave < 8; wave += 1) {
            allocations.push(...await Promise.all(clients.map(async (database) => {
              return (await database.query<{ number: string }>(
                "select public.allocate_work_order_number_for_year($1) as number",
                [businessYear],
              )).rows[0]!.number;
            })));
          }

          expect(allocations).toHaveLength(32);
          expectWorkOrderNumbers(allocations, businessYear);
          expect(allocations.map((number) => Number(number.slice(-4))).sort(
            (left, right) => left - right,
          )).toEqual(Array.from({ length: 32 }, (_, index) => index + 1));
          expect((await coordinator.query<{ last_value: number }>(
            `select last_value
             from public.work_order_number_counters
             where business_year = $1`,
            [businessYear],
          )).rows).toEqual([{ last_value: 32 }]);

          const nextYear = businessYear + 1;
          expect((await coordinator.query<{ number: string }>(
            "select public.allocate_work_order_number_for_year($1) as number",
            [nextYear],
          )).rows).toEqual([{
            number: `RN-${nextYear.toString().padStart(4, "0")}-0001`,
          }]);
          expect((await coordinator.query<{ last_value: number }>(
            `select last_value
             from public.work_order_number_counters
             where business_year = $1`,
            [businessYear],
          )).rows).toEqual([{ last_value: 32 }]);
        } finally {
          await coordinator.query(
            `delete from public.work_order_number_counters
             where business_year = any($1::integer[])
               and not exists (
                 select 1
                 from public.work_orders as work_order
                 where work_order.work_order_number like
                   'RN-' || public.work_order_number_counters.business_year::text || '-%'
               )`,
            [[businessYear, businessYear + 1]],
          );
        }
      });
    });

    it("uses Sarajevo year boundaries, rejects overflow, and never wraps", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const boundary = await database.query<{
          after_boundary: number;
          before_boundary: number;
        }>(
          `select
             pg_catalog.date_part(
               'year',
               pg_catalog.timezone(
                 'Europe/Sarajevo',
                 '2025-12-31 22:59:59+00'::timestamptz
               )
             )::integer as before_boundary,
             pg_catalog.date_part(
               'year',
               pg_catalog.timezone(
                 'Europe/Sarajevo',
                 '2025-12-31 23:00:00+00'::timestamptz
               )
             )::integer as after_boundary`,
        );
        expect(boundary.rows).toEqual([{
          after_boundary: 2026,
          before_boundary: 2025,
        }]);

        const allocator = await database.query<{ definition: string }>(
          `select pg_catalog.lower(pg_catalog.pg_get_functiondef(
             'public.allocate_work_order_number()'::pg_catalog.regprocedure
           )) as definition`,
        );
        expect(allocator.rows[0]?.definition).toContain("europe/sarajevo");
        expect(allocator.rows[0]?.definition).toContain("clock_timestamp()");

        const isolatedYear = await findIsolatedCounterYear(database);
        await database.query(
          `insert into public.work_order_number_counters (business_year, last_value)
           values ($1, 9998)`,
          [isolatedYear],
        );
        expect((await database.query<{ number: string }>(
          "select public.allocate_work_order_number_for_year($1) as number",
          [isolatedYear],
        )).rows).toEqual([{
          number: `RN-${isolatedYear.toString().padStart(4, "0")}-9999`,
        }]);
        await database.query("savepoint exhausted_counter");
        await expect(database.query(
          "select public.allocate_work_order_number_for_year($1)",
          [isolatedYear],
        )).rejects.toMatchObject({ code: "WOR03" });
        await database.query("rollback to savepoint exhausted_counter");
        expect((await database.query<{ last_value: number }>(
          `select last_value
           from public.work_order_number_counters
           where business_year = $1`,
          [isolatedYear],
        )).rows).toEqual([{ last_value: 9999 }]);
      });
    });

    it("shares numbering across generic and PCB creation, preserves idempotency, and does not reclaim deletion", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const businessYear = (await database.query<{ business_year: number }>(
          `select pg_catalog.date_part(
             'year',
             pg_catalog.timezone(
               'Europe/Sarajevo',
               pg_catalog.clock_timestamp()
             )
           )::integer as business_year`,
        )).rows[0]!.business_year;
        const counterBefore = Number((await database.query<{ last_value: number }>(
          `select last_value
           from public.work_order_number_counters
           where business_year = $1`,
          [businessYear],
        )).rows[0]?.last_value ?? 0);
        const outputProductId = randomUUID();
        const cardId = randomUUID();
        const versionId = randomUUID();
        const outputSerial = (await database.query<{ serial_number: string }>(
          "select public.allocate_product_serial_number() as serial_number",
        )).rows[0]!.serial_number;

        await database.query(
          `insert into public.products (
             id, serial_number, name, category, product_kind,
             created_by_user_id, updated_by_user_id
           ) values ($1::uuid, $2::text, 'Task 147 PCB Output', 'PCB',
             'pcb_finished_good', $3::uuid, $3::uuid)`,
          [outputProductId, outputSerial, fixture.actors.admin.profileId],
        );
        await database.query(
          `insert into public.pcb_cards (
             id, name, output_product_id, created_by_user_id, updated_by_user_id
           ) values ($1::uuid, 'Task 147 PCB', $2::uuid, $3::uuid, $3::uuid)`,
          [cardId, outputProductId, fixture.actors.admin.profileId],
        );
        await database.query(
          `insert into public.pcb_bom_versions (
             id, pcb_card_id, version_number, created_by_user_id
           ) values ($1::uuid, $2::uuid, 1, $3::uuid)`,
          [versionId, cardId, fixture.actors.admin.profileId],
        );
        await setActor(database, fixture.actors.admin);

        const genericOne = (await database.query<WorkOrderCreationRow>(
          "select * from public.create_draft_work_order()",
        )).rows[0]!;
        const firstRequestId = randomUUID();
        const pcbOne = (await database.query<WorkOrderCreationRow>(
          `select * from public.create_pcb_production_work_order(
             $1::uuid, '1', null::uuid, $2::uuid
           )`,
          [cardId, firstRequestId],
        )).rows[0]!;
        const pcbReplay = (await database.query<WorkOrderCreationRow>(
          `select * from public.create_pcb_production_work_order(
             $1::uuid, '1', null::uuid, $2::uuid
           )`,
          [cardId, firstRequestId],
        )).rows[0]!;
        const pcbTwo = (await database.query<WorkOrderCreationRow>(
          `select * from public.create_pcb_production_work_order(
             $1::uuid, '1', null::uuid, $2::uuid
           )`,
          [cardId, randomUUID()],
        )).rows[0]!;
        const genericTwo = (await database.query<WorkOrderCreationRow>(
          "select * from public.create_draft_work_order()",
        )).rows[0]!;

        expect(pcbReplay).toEqual(pcbOne);
        const initialNumbers = [
          genericOne.work_order_number,
          pcbOne.work_order_number,
          pcbTwo.work_order_number,
          genericTwo.work_order_number,
        ];
        expectWorkOrderNumbers(initialNumbers, businessYear);
        await database.query("reset role");
        expect((await database.query<{ last_value: number }>(
          `select last_value
           from public.work_order_number_counters
           where business_year = $1`,
          [businessYear],
        )).rows).toEqual([{ last_value: counterBefore + 4 }]);

        const expectedUpdatedAt = (await database.query<{ updated_at: string }>(
          `select updated_at::text
           from public.work_orders
           where id = $1::uuid`,
          [genericOne.work_order_id],
        )).rows[0]!.updated_at;
        await setActor(database, fixture.actors.admin);
        await database.query(
          "select * from public.delete_draft_work_order($1::uuid, $2::timestamptz)",
          [genericOne.work_order_id, expectedUpdatedAt],
        );
        const afterDelete = (await database.query<WorkOrderCreationRow>(
          "select * from public.create_draft_work_order()",
        )).rows[0]!;

        expect(afterDelete.work_order_number).not.toBe(
          genericOne.work_order_number,
        );
        expectWorkOrderNumbers(
          [...initialNumbers, afterDelete.work_order_number],
          businessYear,
        );
        await database.query("reset role");
        expect((await database.query<{ last_value: number }>(
          `select last_value
           from public.work_order_number_counters
           where business_year = $1`,
          [businessYear],
        )).rows).toEqual([{ last_value: counterBefore + 5 }]);

        const unrelatedDefinitions = await database.query<{
          definition: string;
          function_name: string;
        }>(
          `select
             routine.proname as function_name,
             pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
               as definition
           from pg_catalog.pg_proc as routine
           join pg_catalog.pg_namespace as namespace
             on namespace.oid = routine.pronamespace
           where namespace.nspname = 'public'
             and routine.proname in (
               'delete_draft_work_order',
               'finish_work_order',
               'save_pcb_production_supplemental_materials'
             )`,
        );
        expect(unrelatedDefinitions.rows.length).toBeGreaterThanOrEqual(3);
        for (const routine of unrelatedDefinitions.rows) {
          expect(routine.definition, routine.function_name)
            .not.toContain("allocate_work_order_number(");
        }
      });
    });

    it("keeps counters, allocators, and persisted identifiers browser-immutable", async () => {
      const fixture = requireHarness();
      for (const client of [
        fixture.anonymousClient,
        fixture.actors.admin.client,
        fixture.actors.productCreator.client,
        fixture.actors.unpermitted.client,
      ]) {
        expectPermissionDenied(
          (await client.rpc("allocate_product_serial_number")).error,
        );
        expectPermissionDenied(
          (await client.rpc("allocate_work_order_number")).error,
        );
        expectPermissionDenied((await client.rpc(
          "allocate_work_order_number_for_year",
          { p_business_year: 2026 },
        )).error);
        expectPermissionDenied((await client.from("work_order_number_counters")
          .upsert({ business_year: 2026, last_value: 1 })).error);
        expectPermissionDenied((await client.from("products")
          .update({ serial_number: "9999999" })
          .eq("id", randomUUID())).error);
        expectPermissionDenied((await client.from("work_orders")
          .update({ work_order_number: "RN-2026-9999" })
          .eq("id", randomUUID())).error);
      }

      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const functions = await database.query<{
          anonymous_execute: boolean;
          authenticated_execute: boolean;
          function_name: string;
          security_definer: boolean;
          settings: string[] | null;
        }>(
          `select
             routine.proname as function_name,
             routine.prosecdef as security_definer,
             routine.proconfig as settings,
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
             and routine.proname in (
               'allocate_product_serial_number',
               'allocate_work_order_number',
               'allocate_work_order_number_for_year'
             )
           order by routine.proname`,
        );
        expect(functions.rows).toHaveLength(3);
        for (const routine of functions.rows) {
          expect(routine).toMatchObject({
            anonymous_execute: false,
            authenticated_execute: false,
            security_definer: true,
            settings: ['search_path=""'],
          });
        }

        const infrastructure = await database.query<{
          counter_rls: boolean;
          sequence_authenticated_update: boolean;
          sequence_authenticated_usage: boolean;
          table_authenticated_insert: boolean;
          table_authenticated_update: boolean;
        }>(
          `select
             (
               select relation.relrowsecurity
               from pg_catalog.pg_class as relation
               join pg_catalog.pg_namespace as namespace
                 on namespace.oid = relation.relnamespace
               where namespace.nspname = 'public'
                 and relation.relname = 'work_order_number_counters'
             ) as counter_rls,
             pg_catalog.has_sequence_privilege(
               'authenticated',
               'public.product_serial_number_seq',
               'usage'
             ) as sequence_authenticated_usage,
             pg_catalog.has_sequence_privilege(
               'authenticated',
               'public.product_serial_number_seq',
               'update'
             ) as sequence_authenticated_update,
             pg_catalog.has_table_privilege(
               'authenticated',
               'public.work_order_number_counters',
               'insert'
             ) as table_authenticated_insert,
             pg_catalog.has_table_privilege(
               'authenticated',
               'public.work_order_number_counters',
               'update'
             ) as table_authenticated_update`,
        );
        expect(infrastructure.rows).toEqual([{
          counter_rls: true,
          sequence_authenticated_update: false,
          sequence_authenticated_usage: false,
          table_authenticated_insert: false,
          table_authenticated_update: false,
        }]);

        const workOrderMetadata = await database.query<{
          constraint_name: string;
        }>(
          `select constraint_name
           from information_schema.table_constraints
           where table_schema = 'public'
             and table_name = 'work_orders'
             and constraint_name in (
               'work_orders_number_format',
               'work_orders_work_order_number_key'
             )
           order by constraint_name`,
        );
        expect(workOrderMetadata.rows).toEqual([
          { constraint_name: "work_orders_number_format" },
          { constraint_name: "work_orders_work_order_number_key" },
        ]);
        const lifecycle = await database.query<{ definition: string }>(
          `select pg_catalog.lower(pg_catalog.pg_get_functiondef(
             'public.enforce_work_order_lifecycle()'::pg_catalog.regprocedure
           )) as definition`,
        );
        expect(lifecycle.rows[0]?.definition)
          .toContain("work order number cannot be changed");
      });
    });

  });
}
