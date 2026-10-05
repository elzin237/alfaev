import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadBackendTestEnvironment } from "./env";

interface Actor { authId: string; profileId: string }
interface BomInput { product: number; quantity: number }
interface Fixture {
  cardIds: string[];
  inputIds: string[];
  outputIds: string[];
  versionIds: string[];
  initialStock: bigint[];
}
interface Run {
  id: string;
  pcb_card_id: string;
  bom_version_id: string;
  project_id: string | null;
  produced_by_user_id: string;
  quantity_produced: string;
}
interface Movement {
  id: string;
  source_id: string;
  product_id: string;
  movement_type: string;
  source_type: string;
  quantity_before: string;
  quantity_delta: string;
  quantity_after: string;
  actor_user_id: string;
  project_id: string | null;
}
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

const enabled = process.env.TASK100_CONCURRENCY === "1";
const environment = loadBackendTestEnvironment();
const campaignId = randomUUID();
const timeoutMs = 60_000;

describe.skipIf(!enabled)("Task 100 committed PCB production concurrency", () => {
  let pool: Pool;
  let authAdmin: SupabaseClient;
  let admin: Actor;
  let producer: Actor;

  beforeAll(async () => {
    const disposableRef = "fflyjnbgevocmystgyob";
    if (new URL(environment.supabaseUrl).hostname !== `${disposableRef}.supabase.co`
      || environment.projectRef !== disposableRef) {
      throw new Error("Task 100 concurrency target is not the approved disposable project");
    }
    // These actors and their committed domain history deliberately remain in
    // the separate disposable project. Normal security-fixture cleanup is not
    // registered or changed by this opt-in campaign.
    pool = new Pool({ connectionString: environment.supabaseTestDatabaseUrl,
      max: 4, ssl: { rejectUnauthorized: false } });
    authAdmin = createClient(environment.supabaseUrl, environment.supabaseSecretKey,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const createActor = async (label: string, isAdmin: boolean, creator: string | null): Promise<Actor> => {
      const { data, error } = await authAdmin.auth.admin.createUser({
        email: `alfaev.task100.${campaignId}.${label}@example.com`,
        password: `AlfaEV-${randomUUID()}-Aa1!`, email_confirm: true,
      });
      if (error || !data.user) throw new Error(`Task 100 ${label} Auth fixture creation failed`);
      const result = await pool.query<{ id: string }>(
        `insert into public.user_profiles
           (auth_user_id, full_name, email, birthday, is_admin, is_active, created_by_user_id)
         values ($1, $2, $3, '1990-01-01', $4, true, $5) returning id`,
        [data.user.id, `Task 100 ${label}`, data.user.email, isAdmin, creator],
      );
      return { authId: data.user.id, profileId: result.rows[0]!.id };
    };
    admin = await createActor("admin", true, null);
    producer = await createActor("producer", false, admin.profileId);
    await pool.query(
      `insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id)
       select $1, definition.id, $2 from public.permission_definitions as definition
       where definition.key = 'pcb.produce'`,
      [producer.profileId, admin.profileId],
    );
  });

  afterAll(async () => { if (pool) await pool.end(); });

  async function withClients<T>(operation: (clients: [PoolClient, PoolClient, PoolClient, PoolClient]) => Promise<T>): Promise<T> {
    const clients: PoolClient[] = [];
    try {
      for (let index = 0; index < 4; index += 1) clients.push(await pool.connect());
      return await operation(clients as [PoolClient, PoolClient, PoolClient, PoolClient]);
    } finally {
      for (const client of clients) {
        try { await client.query("rollback"); } catch { /* transaction may already be closed */ }
        client.release();
      }
    }
  }

  async function createFixture(
    database: PoolClient, stock: number[], cards: BomInput[][],
  ): Promise<Fixture> {
    const inputIds = stock.map(() => randomUUID());
    const outputIds = cards.map(() => randomUUID());
    const cardIds = cards.map(() => randomUUID());
    const versionIds = cards.map(() => randomUUID());
    await database.query("begin");
    try {
      for (const [index, productId] of [...inputIds, ...outputIds].entries()) {
        const serial = (await database.query<{ serial: string }>(
          "select public.allocate_product_serial_number() as serial",
        )).rows[0]!.serial;
        await database.query(
          `insert into public.products
             (id, serial_number, name, category, product_kind, created_by_user_id, updated_by_user_id)
           values ($1, $2, $3, 'PCB', $4, $5, $5)`,
          [productId, serial, `Task 100 ${campaignId} Product ${index}`,
            index < inputIds.length ? "component" : "pcb_finished_good", admin.profileId],
        );
      }
      for (const [index, inputId] of inputIds.entries()) {
        await database.query(
          "update public.inventory_balances set quantity = $2 where product_id = $1",
          [inputId, stock[index]],
        );
      }
      for (const [index, cardId] of cardIds.entries()) {
        await database.query(
          `insert into public.pcb_cards
             (id, name, output_product_id, created_by_user_id, updated_by_user_id)
           values ($1, $2, $3, $4, $4)`,
          [cardId, `Task 100 ${campaignId} Card ${index}`, outputIds[index], admin.profileId],
        );
        await database.query(
          `insert into public.pcb_bom_versions
             (id, pcb_card_id, version_number, created_by_user_id)
           values ($1, $2, 1, $3)`,
          [versionIds[index], cardId, admin.profileId],
        );
        for (const item of cards[index] ?? []) {
          await database.query(
            `insert into public.pcb_bom_items
               (bom_version_id, component_product_id, quantity_per_card)
             values ($1, $2, $3)`,
            [versionIds[index], inputIds[item.product], item.quantity],
          );
        }
      }
      await database.query("commit");
      return { cardIds, inputIds, outputIds, versionIds, initialStock: stock.map(BigInt) };
    } catch (error) {
      await database.query("rollback");
      throw error;
    }
  }

  async function runAs<T>(
    client: PoolClient, actor: Actor, label: string,
    operation: () => Promise<T>,
  ): Promise<Outcome<T>> {
    await client.query("begin");
    try {
      await client.query("set local statement_timeout = '20s'");
      await client.query("set local lock_timeout = '15s'");
      await client.query("select pg_catalog.set_config('application_name', $1, true)", [label]);
      await client.query("select pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [actor.authId]);
      // produce_pcb is retired from browser use but remains an internal legacy
      // primitive whose transaction/locking regressions are still valuable.
      // Keep the caller claims while invoking it only through this trusted DB path.
      const value = await operation();
      await client.query("commit");
      return { ok: true, value };
    } catch (error) {
      await client.query("rollback");
      return { ok: false, error };
    }
  }

  async function produce(client: PoolClient, cardId: string, quantity = "1", projectId: string | null = null) {
    return (await client.query<{ id: string }>(
      "select public.produce_pcb($1::uuid, $2::text, $3::uuid) as id",
      [cardId, quantity, projectId],
    )).rows[0]!.id;
  }

  async function saveBom(client: PoolClient, cardId: string, items: Array<{ product: string; quantity: string }>) {
    return (await client.query<{ bom_version_id: string; version_number: string }>(
      "select * from public.save_initial_pcb_bom($1::uuid, $2::jsonb)",
      [cardId, JSON.stringify(items.map((item) => ({
        product_id: item.product, quantity_per_card: item.quantity,
      })))],
    )).rows[0]!;
  }

  async function waitForBoth(observer: PoolClient, labels: [string, string]): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const rows = (await observer.query<{ application_name: string; wait_event_type: string | null }>(
        `select application_name, wait_event_type from pg_catalog.pg_stat_activity
         where application_name = any($1::text[])`, [labels],
      )).rows;
      if (labels.every((label) => rows.some((row) =>
        row.application_name === label && row.wait_event_type === "Lock"))) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Task 100 lock gate did not block both callers: ${labels.join(", ")}`);
  }

  async function race<A, B>(
    clients: [PoolClient, PoolClient, PoolClient, PoolClient],
    gateSql: string, gateParameters: unknown[],
    first: (client: PoolClient, label: string) => Promise<Outcome<A>>,
    second: (client: PoolClient, label: string) => Promise<Outcome<B>>,
  ): Promise<[Outcome<A>, Outcome<B>]> {
    const [one, two, gate, observer] = clients;
    // PostgreSQL truncates application_name at 63 bytes; keep lock probes short.
    const raceId = randomUUID().slice(0, 12);
    const labels: [string, string] = [
      `task100-${raceId}-a`,
      `task100-${raceId}-b`,
    ];
    await gate.query("begin");
    await gate.query(gateSql, gateParameters);
    const oneResult = first(one, labels[0]);
    const twoResult = second(two, labels[1]);
    try {
      await waitForBoth(observer, labels);
    } finally {
      await gate.query("commit");
    }
    return Promise.all([oneResult, twoResult]);
  }

  async function assertRunIntegrity(database: PoolClient, fixture: Fixture, expectedRuns: number): Promise<Run[]> {
    const runs = (await database.query<Run>(
      `select id, pcb_card_id, bom_version_id, project_id,
              produced_by_user_id, quantity_produced
       from public.pcb_production_runs where pcb_card_id = any($1::uuid[])`,
      [fixture.cardIds],
    )).rows;
    expect(runs).toHaveLength(expectedRuns);
    const runIds = runs.map((run) => run.id);
    const fixtureProductIds = [...fixture.inputIds, ...fixture.outputIds];
    const movements = (await database.query<Movement>(
      `select id, source_id, product_id, movement_type, source_type,
              quantity_before, quantity_delta, quantity_after, actor_user_id, project_id
       from public.inventory_movements
       where product_id = any($1::uuid[]) and movement_type in
         ('pcb_production_input', 'pcb_production_output')`, [fixtureProductIds],
    )).rows;
    expect(movements.every((movement) => runIds.includes(movement.source_id))).toBe(true);
    const audits = (await database.query<{
      entity_id: string; actor_user_id: string; after_data: Record<string, unknown>;
    }>(
      `select entity_id, actor_user_id, after_data from public.audit_logs
       where action_type = 'pcb_production.completed'
         and after_data->>'pcb_card_id' = any($1::text[])`, [fixture.cardIds],
    )).rows;
    expect(audits).toHaveLength(expectedRuns);
    expect(audits.every((audit) => runIds.includes(audit.entity_id))).toBe(true);
    for (const run of runs) {
      const cardIndex = fixture.cardIds.indexOf(run.pcb_card_id);
      expect(cardIndex).toBeGreaterThanOrEqual(0);
      const items = (await database.query<{ component_product_id: string; quantity_per_card: string }>(
        `select component_product_id, quantity_per_card from public.pcb_bom_items
         where bom_version_id = $1`, [run.bom_version_id],
      )).rows;
      const own = movements.filter((movement) => movement.source_id === run.id);
      expect(own).toHaveLength(items.length + 1);
      expect(new Set(own.map((movement) => movement.product_id)).size).toBe(own.length);
      const output = own.filter((movement) => movement.movement_type === "pcb_production_output");
      expect(output).toHaveLength(1);
      expect(output[0]).toMatchObject({ product_id: fixture.outputIds[cardIndex],
        quantity_delta: run.quantity_produced, source_type: "pcb_production_output",
        actor_user_id: run.produced_by_user_id, project_id: run.project_id });
      for (const item of items) {
        const input = own.filter((movement) =>
          movement.product_id === item.component_product_id &&
          movement.movement_type === "pcb_production_input");
        expect(input).toHaveLength(1);
        expect(input[0]).toMatchObject({
          quantity_delta: (-BigInt(item.quantity_per_card) * BigInt(run.quantity_produced)).toString(),
          source_type: "pcb_production_input", actor_user_id: run.produced_by_user_id,
          project_id: run.project_id,
        });
      }
      for (const movement of own) {
        expect(BigInt(movement.quantity_after)).toBe(
          BigInt(movement.quantity_before) + BigInt(movement.quantity_delta));
      }
      expect(audits.filter((audit) => audit.entity_id === run.id)).toEqual([
        expect.objectContaining({ actor_user_id: run.produced_by_user_id,
          after_data: expect.objectContaining({
            pcb_card_id: run.pcb_card_id, bom_version_id: run.bom_version_id,
            quantity_produced: Number(run.quantity_produced), project_id: run.project_id,
            output_product_id: fixture.outputIds[cardIndex],
          }) }),
      ]);
    }
    for (const [index, productId] of [...fixture.inputIds, ...fixture.outputIds].entries()) {
      const productMovements = movements.filter((movement) => movement.product_id === productId);
      let current = index < fixture.inputIds.length ? fixture.initialStock[index]! : 0n;
      const remaining = [...productMovements];
      while (remaining.length) {
        const position = remaining.findIndex((movement) => BigInt(movement.quantity_before) === current);
        expect(position).toBeGreaterThanOrEqual(0);
        const [movement] = remaining.splice(position, 1);
        current = BigInt(movement!.quantity_after);
      }
      const balance = (await database.query<{ quantity: string }>(
        "select quantity from public.inventory_balances where product_id = $1", [productId],
      )).rows[0]!;
      expect(balance.quantity).toBe(current.toString());
      expect(current).toBeGreaterThanOrEqual(0n);
    }
    for (const cardId of fixture.cardIds) {
      const history = await runAs(database, admin, `task100-history-${randomUUID()}`, async () =>
        (await database.query<{ production_run_id: string; bom_version_id: string; quantity_produced: string }>(
          "select production_run_id, bom_version_id, quantity_produced from public.list_pcb_production_history($1::uuid)",
          [cardId],
        )).rows);
      expect(history.ok).toBe(true);
      if (history.ok) {
        const forCard = runs.filter((run) => run.pcb_card_id === cardId);
        expect(history.value).toHaveLength(forCard.length);
        for (const row of history.value) {
          expect(forCard).toContainEqual(expect.objectContaining({
            id: row.production_run_id, bom_version_id: row.bom_version_id,
            quantity_produced: row.quantity_produced,
          }));
        }
      }
    }
    return runs;
  }

  async function assertVersions(database: PoolClient, cardId: string, expectedCount: number) {
    const versions = (await database.query<{
      id: string; version_number: string; is_active: boolean;
    }>(
      `select id, version_number, is_active from public.pcb_bom_versions
       where pcb_card_id = $1 order by version_number`, [cardId],
    )).rows;
    expect(versions).toHaveLength(expectedCount);
    expect(versions.filter((version) => version.is_active)).toHaveLength(1);
    expect(versions[versions.length - 1]?.is_active).toBe(true);
    return versions;
  }

  it("Task 100 baseline succeeds with two inputs and exact run, ledger, audit, Project", async () => {
    await withClients(async ([worker, , , observer]) => {
      const fixture = await createFixture(observer, [20, 30], [[
        { product: 0, quantity: 2 }, { product: 1, quantity: 3 },
      ]]);
      const projectId = (await observer.query<{ id: string }>(
        `insert into public.projects
           (name, customer_name, start_date, delivery_date, created_by_user_id, updated_by_user_id)
         values ($1, 'Task 100 Customer', '2026-09-01', '2026-10-01', $2, $2) returning id`,
        [`Task 100 ${campaignId} Project`, admin.profileId],
      )).rows[0]!.id;
      const result = await runAs(worker, admin, `task100-baseline-${randomUUID()}`,
        () => produce(worker, fixture.cardIds[0]!, "2", projectId));
      expect(result.ok).toBe(true);
      const runs = await assertRunIntegrity(observer, fixture, 1);
      expect(runs[0]).toMatchObject({ bom_version_id: fixture.versionIds[0], project_id: projectId,
        quantity_produced: "2", produced_by_user_id: admin.profileId });
      expect((await observer.query<{ product_id: string; quantity: string }>(
        "select product_id, quantity from public.inventory_balances where product_id = any($1::uuid[])",
        [[...fixture.inputIds, ...fixture.outputIds]],
      )).rows).toEqual(expect.arrayContaining([
        { product_id: fixture.inputIds[0], quantity: "16" },
        { product_id: fixture.inputIds[1], quantity: "24" },
        { product_id: fixture.outputIds[0], quantity: "2" },
      ]));
    });
  }, timeoutMs);

  it("Task 100 insufficient second input rolls back every production effect", async () => {
    await withClients(async ([worker, , , observer]) => {
      const fixture = await createFixture(observer, [20, 2], [[
        { product: 0, quantity: 2 }, { product: 1, quantity: 3 },
      ]]);
      const result = await runAs(worker, admin, `task100-insufficient-${randomUUID()}`,
        () => produce(worker, fixture.cardIds[0]!, "1"));
      expect(result).toMatchObject({ ok: false, error: { code: "IVB02" } });
      await assertRunIntegrity(observer, fixture, 0);
      expect((await observer.query<{ quantity: string }>(
        "select quantity from public.inventory_balances where product_id = $1",
        [fixture.inputIds[0]],
      )).rows[0]?.quantity).toBe("20");
    });
  }, timeoutMs);

  for (let iteration = 1; iteration <= 3; iteration += 1) {
    it(`Task 100 same-card overspend serializes (repeat ${iteration})`, async () => {
      await withClients(async (clients) => {
        const fixture = await createFixture(clients[3], [10], [[{ product: 0, quantity: 6 }]]);
        const results = await race(clients,
          "select id from public.pcb_cards where id = $1 for update", [fixture.cardIds[0]],
          (client, label) => runAs(client, admin, label, () => produce(client, fixture.cardIds[0]!)),
          (client, label) => runAs(client, producer, label, () => produce(client, fixture.cardIds[0]!)));
        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(results.filter((result) => !result.ok)).toEqual([
          expect.objectContaining({ error: expect.objectContaining({ code: "IVB02" }) }),
        ]);
        const runs = await assertRunIntegrity(clients[3], fixture, 1);
        const winner = results.find((result) => result.ok);
        expect(runs[0]?.id).toBe(winner?.ok ? winner.value : undefined);
      });
    }, timeoutMs);
  }


  it("Task 100 first production and meaningful BOM edit serialize coherently", async () => {
    await withClients(async (clients) => {
      const fixture = await createFixture(clients[3], [20], [[{ product: 0, quantity: 2 }]]);
      const results = await race(clients,
        "select id from public.pcb_cards where id = $1 for update", [fixture.cardIds[0]],
        (client, label) => runAs(client, producer, label, () => produce(client, fixture.cardIds[0]!)),
        (client, label) => runAs(client, admin, label, () => saveBom(client, fixture.cardIds[0]!, [
          { product: fixture.inputIds[0]!, quantity: "3" },
        ])));
      expect(results.every((result) => result.ok)).toBe(true);
      const runs = await assertRunIntegrity(clients[3], fixture, 1);
      const usedItems = (await clients[3].query<{ quantity_per_card: string }>(
        "select quantity_per_card from public.pcb_bom_items where bom_version_id = $1",
        [runs[0]?.bom_version_id],
      )).rows;
      expect(usedItems).toHaveLength(1);
      expect(["2", "3"]).toContain(usedItems[0]?.quantity_per_card);
      const versions = await assertVersions(clients[3], fixture.cardIds[0]!,
        usedItems[0]?.quantity_per_card === "2" ? 2 : 1);
      expect(versions.some((version) => version.id === runs[0]?.bom_version_id)).toBe(true);
    });
  }, timeoutMs);

  it("Task 100 production against used BOM and rollover use one exact version", async () => {
    await withClients(async (clients) => {
      const fixture = await createFixture(clients[3], [30], [[{ product: 0, quantity: 2 }]]);
      const first = await runAs(clients[0], admin, `task100-prime-${randomUUID()}`,
        () => produce(clients[0], fixture.cardIds[0]!));
      expect(first.ok).toBe(true);
      const results = await race(clients,
        "select id from public.pcb_cards where id = $1 for update", [fixture.cardIds[0]],
        (client, label) => runAs(client, producer, label, () => produce(client, fixture.cardIds[0]!)),
        (client, label) => runAs(client, admin, label, () => saveBom(client, fixture.cardIds[0]!, [
          { product: fixture.inputIds[0]!, quantity: "3" },
        ])));
      expect(results.every((result) => result.ok)).toBe(true);
      const runs = await assertRunIntegrity(clients[3], fixture, 2);
      const versions = await assertVersions(clients[3], fixture.cardIds[0]!, 2);
      expect(versions.map((version) => version.version_number)).toEqual(["1", "2"]);
      expect(versions[0]?.is_active).toBe(false);
      const v1Items = (await clients[3].query<{ quantity_per_card: string }>(
        "select quantity_per_card from public.pcb_bom_items where bom_version_id = $1",
        [fixture.versionIds[0]],
      )).rows;
      expect(v1Items.map((item) => item.quantity_per_card)).toEqual(["2"]);
      expect(runs.some((run) => run.bom_version_id === fixture.versionIds[0])).toBe(true);
    });
  }, timeoutMs);

  it("Task 100 Product archive and production cannot create partial history", async () => {
    await withClients(async (clients) => {
      const fixture = await createFixture(clients[3], [10], [[{ product: 0, quantity: 2 }]]);
      const results = await race(clients,
        "select id from public.products where id = $1 for update", [fixture.inputIds[0]],
        (client, label) => runAs(client, producer, label, () => produce(client, fixture.cardIds[0]!)),
        (client, label) => runAs(client, admin, label, async () => (await client.query<{ id: string }>(
          "select public.archive_product($1::uuid) as id", [fixture.inputIds[0]],
        )).rows[0]!.id));
      expect(results[1].ok).toBe(true);
      if (!results[0].ok) expect(results[0].error).toMatchObject({ code: "PCB04" });
      await assertRunIntegrity(clients[3], fixture, results[0].ok ? 1 : 0);
      expect((await clients[3].query<{ is_active: boolean }>(
        "select is_active from public.products where id = $1", [fixture.inputIds[0]],
      )).rows[0]?.is_active).toBe(false);
    });
  }, timeoutMs);

  it("Task 100 Project cancellation and production serialize", async () => {
    await withClients(async (clients) => {
      const fixture = await createFixture(clients[3], [10], [[{ product: 0, quantity: 2 }]]);
      const projectId = (await clients[3].query<{ id: string }>(
        `insert into public.projects
           (name, customer_name, start_date, delivery_date, created_by_user_id, updated_by_user_id)
         values ($1, 'Task 100 Customer', '2026-09-01', '2026-10-01', $2, $2) returning id`,
        [`Task 100 ${campaignId} Lifecycle Project`, admin.profileId],
      )).rows[0]!.id;
      const results = await race(clients,
        "select id from public.projects where id = $1 for update", [projectId],
        (client, label) => runAs(client, producer, label,
          () => produce(client, fixture.cardIds[0]!, "1", projectId)),
        (client, label) => runAs(client, admin, label, async () => (await client.query<{ id: string }>(
          "select public.cancel_project($1::uuid) as id", [projectId],
        )).rows[0]!.id));
      expect(results[1].ok).toBe(true);
      if (!results[0].ok) expect(results[0].error).toMatchObject({ code: "PCB10" });
      const runs = await assertRunIntegrity(clients[3], fixture, results[0].ok ? 1 : 0);
      if (runs.length) expect(runs[0]?.project_id).toBe(projectId);
      expect((await clients[3].query<{ status: string }>(
        "select status from public.projects where id = $1", [projectId],
      )).rows[0]?.status).toBe("cancelled");
    });
  }, timeoutMs);

  it("Task 100 same-card sufficient stock permits two attributed runs", async () => {
    await withClients(async (clients) => {
      const fixture = await createFixture(clients[3], [20], [[{ product: 0, quantity: 6 }]]);
      const results = await race(clients,
        "select id from public.pcb_cards where id = $1 for update", [fixture.cardIds[0]],
        (client, label) => runAs(client, admin, label, () => produce(client, fixture.cardIds[0]!)),
        (client, label) => runAs(client, producer, label, () => produce(client, fixture.cardIds[0]!)));
      expect(results.every((result) => result.ok)).toBe(true);
      const runs = await assertRunIntegrity(clients[3], fixture, 2);
      expect(new Set(runs.map((run) => run.id)).size).toBe(2);
      expect(new Set(runs.map((run) => run.produced_by_user_id))).toEqual(
        new Set([admin.profileId, producer.profileId]));
    });
  }, timeoutMs);

  for (let iteration = 1; iteration <= 3; iteration += 1) {
    it(`Task 100 different cards sharing input cannot overspend (repeat ${iteration})`, async () => {
      await withClients(async (clients) => {
        const fixture = await createFixture(clients[3], [10], [
          [{ product: 0, quantity: 6 }], [{ product: 0, quantity: 6 }],
        ]);
        const results = await race(clients,
          "select product_id from public.inventory_balances where product_id = $1 for update",
          [fixture.inputIds[0]],
          (client, label) => runAs(client, admin, label, () => produce(client, fixture.cardIds[0]!)),
          (client, label) => runAs(client, producer, label, () => produce(client, fixture.cardIds[1]!)));
        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(results.filter((result) => !result.ok)).toEqual([
          expect.objectContaining({ error: expect.objectContaining({ code: "IVB02" }) }),
        ]);
        const runs = await assertRunIntegrity(clients[3], fixture, 1);
        expect(runs[0]?.pcb_card_id).toBe(results[0].ok ? fixture.cardIds[0] : fixture.cardIds[1]);
      });
    }, timeoutMs);
  }

  for (let iteration = 1; iteration <= 3; iteration += 1) {
    it(`Task 100 opposite BOM item order has no balance-lock deadlock (repeat ${iteration})`, async () => {
      await withClients(async (clients) => {
        const fixture = await createFixture(clients[3], [20, 20], [
          [{ product: 0, quantity: 2 }, { product: 1, quantity: 3 }],
          [{ product: 1, quantity: 4 }, { product: 0, quantity: 5 }],
        ]);
        const results = await race(clients,
          "select product_id from public.inventory_balances where product_id = $1 for update",
          [fixture.inputIds[0]],
          (client, label) => runAs(client, admin, label, () => produce(client, fixture.cardIds[0]!)),
          (client, label) => runAs(client, producer, label, () => produce(client, fixture.cardIds[1]!)));
        expect(results.every((result) => result.ok)).toBe(true);
        await assertRunIntegrity(clients[3], fixture, 2);
      });
    }, timeoutMs);
  }
});
