import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadBackendTestEnvironment } from "./env";

interface WorkOrderCreationRow extends QueryResultRow {
  work_order_id: string;
  work_order_number: string;
}

interface Actor {
  authUserId: string;
  profileId: string;
}

const enabled = process.env.TASK147_COMMITTED_CONCURRENCY === "1";
const disposableProjectRef = "hipkoxienlffgyofcbzq";
const sharedDevelopmentRef = "yzysgbrpbhiapalgetau";
// The disposable project's session pool is capped at 15 clients. Keep each
// committed campaign below that infrastructure ceiling while exceeding the
// required eight-way generic race.
const genericParticipants = 12;
const pcbParticipants = 8;
const sameRequestParticipants = 8;
const mixedGenericParticipants = 7;
const mixedPcbParticipants = 8;

describe.skipIf(!enabled)(
  "Task 147 committed identifier concurrency on the disposable backend",
  () => {
    const environment = loadBackendTestEnvironment();
    const campaignId = randomUUID();
    const created = {
      generic: [] as WorkOrderCreationRow[],
      mixedGeneric: [] as WorkOrderCreationRow[],
      mixedPcb: [] as WorkOrderCreationRow[],
      pcb: [] as WorkOrderCreationRow[],
      sameRequest: [] as WorkOrderCreationRow[],
    };
    const pcbRequestIds: string[] = [];
    let actor: Actor;
    let authAdmin: SupabaseClient;
    let businessYear = 0;
    let cardId = "";
    let initialCounterValue = 0;
    let outputProductId = "";
    let pool: Pool;

    function expectCanonicalNumbers(rows: readonly WorkOrderCreationRow[]): void {
      const numbers = rows.map((row) => row.work_order_number);
      expect(numbers.every((number) =>
        new RegExp(`^RN-${businessYear}-[0-9]{4}$`).test(number)
      )).toBe(true);
      expect(new Set(numbers).size).toBe(numbers.length);
    }

    async function setActor(database: PoolClient): Promise<void> {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, false)",
        [actor.authUserId],
      );
      await database.query("set role authenticated");
    }

    async function runConcurrent<Result>(
      count: number,
      operation: (database: PoolClient, index: number) => Promise<Result>,
    ): Promise<Result[]> {
      const clients: PoolClient[] = [];

      try {
        for (let index = 0; index < count; index += 1) {
          clients.push(await pool.connect());
        }
        await Promise.all(clients.map(setActor));
        return await Promise.all(clients.map(operation));
      } finally {
        await Promise.all(clients.map(async (database) => {
          await database.query("reset role").catch(() => undefined);
          database.release();
        }));
      }
    }

    async function createGeneric(database: PoolClient): Promise<WorkOrderCreationRow> {
      return (await database.query<WorkOrderCreationRow>(
        "select * from public.create_draft_work_order()",
      )).rows[0]!;
    }

    async function createPcb(
      database: PoolClient,
      creationRequestId: string,
    ): Promise<WorkOrderCreationRow> {
      return (await database.query<WorkOrderCreationRow>(
        `select *
         from public.create_pcb_production_work_order(
           $1::uuid, '1'::text, null::uuid, $2::uuid
         )`,
        [cardId, creationRequestId],
      )).rows[0]!;
    }

    async function expectPersisted(
      rows: readonly WorkOrderCreationRow[],
    ): Promise<void> {
      const persisted = await pool.query<WorkOrderCreationRow>(
        `select id as work_order_id, work_order_number
         from public.work_orders
         where id = any($1::uuid[])
         order by id`,
        [rows.map((row) => row.work_order_id)],
      );
      const normalize = (values: readonly WorkOrderCreationRow[]) =>
        values.map((row) => ({
          work_order_id: row.work_order_id,
          work_order_number: row.work_order_number,
        })).sort((left, right) => left.work_order_id.localeCompare(right.work_order_id));
      expect(normalize(persisted.rows)).toEqual(normalize(rows));
    }

    beforeAll(async () => {
      if (
        environment.projectRef === sharedDevelopmentRef ||
        environment.projectRef !== disposableProjectRef ||
        new URL(environment.supabaseUrl).hostname !==
          `${disposableProjectRef}.supabase.co`
      ) {
        throw new Error(
          "Task 147 committed concurrency target is not the approved disposable project",
        );
      }

      pool = new Pool({
        connectionString: environment.supabaseTestDatabaseUrl,
        max: 20,
        ssl: { rejectUnauthorized: false },
      });
      authAdmin = createClient(
        environment.supabaseUrl,
        environment.supabaseSecretKey,
        { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } },
      );
      const email = `alfaev.task147.${campaignId}.admin@example.com`;
      const { data, error } = await authAdmin.auth.admin.createUser({
        email,
        password: `AlfaEV-${randomUUID()}-Aa1!`,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error("Task 147 disposable Auth actor creation failed");
      }
      const profile = await pool.query<{ id: string }>(
        `insert into public.user_profiles (
           auth_user_id, full_name, email, birthday, is_admin, is_active,
           created_by_user_id
         ) values (
           $1::uuid, 'Task 147 Disposable Admin', $2::text, '1990-01-01',
           true, true, null
         )
         returning id`,
        [data.user.id, email],
      );
      actor = { authUserId: data.user.id, profileId: profile.rows[0]!.id };
      businessYear = (await pool.query<{ business_year: number }>(
        `select pg_catalog.date_part(
           'year',
           pg_catalog.timezone('Europe/Sarajevo', pg_catalog.clock_timestamp())
         )::integer as business_year`,
      )).rows[0]!.business_year;
      initialCounterValue = Number((await pool.query<{ last_value: number }>(
        `select last_value
         from public.work_order_number_counters
         where business_year = $1`,
        [businessYear],
      )).rows[0]?.last_value ?? 0);

      outputProductId = randomUUID();
      cardId = randomUUID();
      const versionId = randomUUID();
      const outputSerial = (await pool.query<{ serial_number: string }>(
        "select public.allocate_product_serial_number() as serial_number",
      )).rows[0]!.serial_number;
      await pool.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, $3::text, 'PCB', 'pcb_finished_good',
           $4::uuid, $4::uuid
         )`,
        [outputProductId, outputSerial, `Task 147 PCB ${campaignId}`, actor.profileId],
      );
      await pool.query(
        `insert into public.pcb_cards (
           id, name, output_product_id, created_by_user_id, updated_by_user_id
         ) values ($1::uuid, $2::text, $3::uuid, $4::uuid, $4::uuid)`,
        [cardId, `Task 147 Card ${campaignId}`, outputProductId, actor.profileId],
      );
      await pool.query(
        `insert into public.pcb_bom_versions (
           id, pcb_card_id, version_number, created_by_user_id
         ) values ($1::uuid, $2::uuid, 1, $3::uuid)`,
        [versionId, cardId, actor.profileId],
      );
    }, 120_000);

    afterAll(async () => {
      if (pool) await pool.end();
    });

    it("commits twelve concurrent generic Draft creations without collisions", async () => {
      created.generic = await runConcurrent(
        genericParticipants,
        (database) => createGeneric(database),
      );

      expect(created.generic).toHaveLength(genericParticipants);
      expectCanonicalNumbers(created.generic);
      await expectPersisted(created.generic);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.audit_logs
         where action_type = 'work_order.created'
           and entity_id = any($1::uuid[])`,
        [created.generic.map((row) => row.work_order_id)],
      )).rows).toEqual([{ count: genericParticipants.toString() }]);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.pcb_production_work_orders
         where work_order_id = any($1::uuid[])`,
        [created.generic.map((row) => row.work_order_id)],
      )).rows).toEqual([{ count: "0" }]);
    }, 60_000);

    it("commits eight concurrent PCB creations with distinct request IDs", async () => {
      const requests = Array.from({ length: pcbParticipants }, () => randomUUID());
      pcbRequestIds.push(...requests);
      created.pcb = await runConcurrent(
        pcbParticipants,
        (database, index) => createPcb(database, requests[index]!),
      );

      expect(created.pcb).toHaveLength(pcbParticipants);
      expectCanonicalNumbers(created.pcb);
      await expectPersisted(created.pcb);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.pcb_production_work_orders
         where creation_request_id = any($1::uuid[])
           and work_order_id = any($2::uuid[])`,
        [requests, created.pcb.map((row) => row.work_order_id)],
      )).rows).toEqual([{ count: pcbParticipants.toString() }]);
      const auditCounts = await pool.query<{
        action_type: string;
        count: string;
      }>(
        `select action_type, pg_catalog.count(*)::text as count
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type in (
             'work_order.created',
             'pcb_production.work_order_created'
           )
         group by action_type
         order by action_type`,
        [created.pcb.map((row) => row.work_order_id)],
      );
      expect(auditCounts.rows).toEqual([
        { action_type: "pcb_production.work_order_created", count: "8" },
        { action_type: "work_order.created", count: "8" },
      ]);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.pcb_production_runs
         where pcb_card_id = $1::uuid`,
        [cardId],
      )).rows).toEqual([{ count: "0" }]);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.inventory_movements
         where product_id = $1::uuid`,
        [outputProductId],
      )).rows).toEqual([{ count: "0" }]);
      expect((await pool.query<{ quantity: string }>(
        `select quantity::text
         from public.inventory_balances
         where product_id = $1::uuid`,
        [outputProductId],
      )).rows).toEqual([{ quantity: "0" }]);
    }, 60_000);

    it("commits one PCB Work Order under an eight-caller same-request race", async () => {
      const requestId = randomUUID();
      pcbRequestIds.push(requestId);
      const counterBefore = Number((await pool.query<{ last_value: number }>(
        `select last_value
         from public.work_order_number_counters
         where business_year = $1`,
        [businessYear],
      )).rows[0]!.last_value);
      created.sameRequest = await runConcurrent(
        sameRequestParticipants,
        (database) => createPcb(database, requestId),
      );

      expect(created.sameRequest).toHaveLength(sameRequestParticipants);
      expect(new Set(created.sameRequest.map((row) => row.work_order_id)).size).toBe(1);
      expect(new Set(created.sameRequest.map((row) => row.work_order_number)).size).toBe(1);
      expectCanonicalNumbers([created.sameRequest[0]!]);
      await expectPersisted([created.sameRequest[0]!]);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.pcb_production_work_orders
         where creation_request_id = $1::uuid`,
        [requestId],
      )).rows).toEqual([{ count: "1" }]);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in (
             'work_order.created',
             'pcb_production.work_order_created'
           )`,
        [created.sameRequest[0]!.work_order_id],
      )).rows).toEqual([{ count: "2" }]);
      expect((await pool.query<{ last_value: number }>(
        `select last_value
         from public.work_order_number_counters
         where business_year = $1`,
        [businessYear],
      )).rows).toEqual([{ last_value: counterBefore + 1 }]);
    }, 60_000);

    it("commits seven generic and eight PCB creations in one mixed race", async () => {
      const requests = Array.from({ length: mixedPcbParticipants }, () => randomUUID());
      pcbRequestIds.push(...requests);
      const mixed = await runConcurrent(
        mixedGenericParticipants + mixedPcbParticipants,
        (database, index) => index < mixedGenericParticipants
          ? createGeneric(database)
          : createPcb(database, requests[index - mixedGenericParticipants]!),
      );
      created.mixedGeneric = mixed.slice(0, mixedGenericParticipants);
      created.mixedPcb = mixed.slice(mixedGenericParticipants);

      expect(created.mixedGeneric).toHaveLength(mixedGenericParticipants);
      expect(created.mixedPcb).toHaveLength(mixedPcbParticipants);
      expectCanonicalNumbers(mixed);
      await expectPersisted(mixed);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.pcb_production_work_orders
         where work_order_id = any($1::uuid[])`,
        [created.mixedGeneric.map((row) => row.work_order_id)],
      )).rows).toEqual([{ count: "0" }]);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.pcb_production_work_orders
         where work_order_id = any($1::uuid[])
           and creation_request_id = any($2::uuid[])`,
        [created.mixedPcb.map((row) => row.work_order_id), requests],
      )).rows).toEqual([{ count: mixedPcbParticipants.toString() }]);
    }, 60_000);

    it("keeps every committed campaign identifier and creation artifact consistent", async () => {
      const uniqueSameRequest = [created.sameRequest[0]!];
      const allRows = [
        ...created.generic,
        ...created.pcb,
        ...uniqueSameRequest,
        ...created.mixedGeneric,
        ...created.mixedPcb,
      ];
      const allIds = allRows.map((row) => row.work_order_id);
      const allNumbers = allRows.map((row) => row.work_order_number);
      const pcbRows = [
        ...created.pcb,
        ...uniqueSameRequest,
        ...created.mixedPcb,
      ];

      expect(allRows).toHaveLength(
        genericParticipants + pcbParticipants + 1 +
          mixedGenericParticipants + mixedPcbParticipants,
      );
      expect(new Set(allIds).size).toBe(allRows.length);
      expect(new Set(allNumbers).size).toBe(allRows.length);
      expectCanonicalNumbers(allRows);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from (
           select work_order_number
           from public.work_orders
           group by work_order_number
           having pg_catalog.count(*) > 1
         ) as duplicate_number`,
      )).rows).toEqual([{ count: "0" }]);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from (
           select creation_request_id
           from public.pcb_production_work_orders
           group by creation_request_id
           having pg_catalog.count(*) > 1
         ) as duplicate_request`,
      )).rows).toEqual([{ count: "0" }]);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.pcb_production_work_orders as production
         left join public.work_orders as work_order
           on work_order.id = production.work_order_id
         where work_order.id is null`,
      )).rows).toEqual([{ count: "0" }]);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.work_orders
         where id = any($1::uuid[])
           and work_order_number !~ '^RN-[0-9]{4}-[0-9]{4}$'`,
        [allIds],
      )).rows).toEqual([{ count: "0" }]);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from (
           select entity_id, action_type
           from public.audit_logs
           where entity_id = any($1::uuid[])
             and action_type in (
               'work_order.created',
               'pcb_production.work_order_created'
             )
           group by entity_id, action_type
           having pg_catalog.count(*) <> 1
         ) as invalid_audit_count`,
        [allIds],
      )).rows).toEqual([{ count: "0" }]);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type = 'work_order.created'`,
        [allIds],
      )).rows).toEqual([{ count: allRows.length.toString() }]);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type = 'pcb_production.work_order_created'`,
        [allIds],
      )).rows).toEqual([{ count: pcbRows.length.toString() }]);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.pcb_production_work_orders
         where work_order_id = any($1::uuid[])
           and creation_request_id = any($2::uuid[])`,
        [pcbRows.map((row) => row.work_order_id), pcbRequestIds],
      )).rows).toEqual([{ count: pcbRows.length.toString() }]);
      expect((await pool.query<{ last_value: number }>(
        `select last_value
         from public.work_order_number_counters
         where business_year = $1`,
        [businessYear],
      )).rows).toEqual([{ last_value: initialCounterValue + allRows.length }]);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.pcb_production_runs
         where pcb_card_id = $1::uuid`,
        [cardId],
      )).rows).toEqual([{ count: "0" }]);
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.inventory_movements
         where product_id = $1::uuid`,
        [outputProductId],
      )).rows).toEqual([{ count: "0" }]);
    }, 60_000);
  },
);
