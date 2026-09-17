import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { expect, it } from "vitest";
import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";
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

async function createBomSaveFixture(database: PoolClient, actorId: string) {
  const outputId = randomUUID();
  const componentId = randomUUID();
  const finishedId = randomUUID();
  const anotherId = randomUUID();
  const archivedId = randomUUID();
  const serials = new Set<string>();
  while (serials.size < 5) serials.add(createTestSerialNumber());
  const ids = [outputId, componentId, finishedId, anotherId, archivedId];
  let index = 0;
  for (const serial of serials) {
    await database.query(
      `insert into public.products
        (id, serial_number, name, category, product_kind, created_by_user_id, updated_by_user_id)
       values ($1, $2, $3, 'PCB', $4, $5, $5)`,
      [ids[index], serial, `BOM save Product ${index}`,
        index === 0 || index === 2 ? "pcb_finished_good" : "component", actorId],
    );
    index += 1;
  }
  const cardId = randomUUID();
  await database.query(
    `insert into public.pcb_cards
      (id, name, output_product_id, created_by_user_id, updated_by_user_id)
     values ($1, 'BOM save Card', $2, $3, $3)`,
    [cardId, outputId, actorId],
  );
  await database.query(
    `update public.products set is_active = false, archived_at = pg_catalog.now(),
       archived_by_user_id = $2, updated_at = pg_catalog.now(), updated_by_user_id = $2
     where id = $1`, [archivedId, actorId],
  );
  return { cardId, outputId, componentId, finishedId, anotherId, archivedId };
}

async function saveBomAs(
  database: PoolClient,
  actor: SecurityActor | null,
  cardId: string,
  items: unknown,
) {
  await database.query("savepoint save_bom_attempt");
  try {
    if (actor) {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");
    } else {
      await database.query("set local role anon");
    }
    const result = await database.query<{ bom_version_id: string; version_number: string }>(
      "select * from public.save_initial_pcb_bom($1::uuid, $2::jsonb)",
      [cardId, JSON.stringify(items)],
    );
    await database.query("rollback to savepoint save_bom_attempt");
    // The helper above is only for assertions about rejected calls; successful
    // saves use the explicit role-aware helper below so their writes remain.
    return result.rows;
  } catch (error) {
    await database.query("rollback to savepoint save_bom_attempt");
    throw error;
  }
}

async function commitBomCallInTestTransaction(
  database: PoolClient,
  actor: SecurityActor,
  cardId: string,
  items: unknown,
) {
  await database.query("savepoint successful_bom_call");
  try {
    await database.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', $1, true)",
      [actor.authUserId],
    );
    await database.query("set local role authenticated");
    const rows = (await database.query<{ bom_version_id: string; version_number: string }>(
      "select * from public.save_initial_pcb_bom($1::uuid, $2::jsonb)",
      [cardId, JSON.stringify(items)],
    )).rows;
    await database.query("reset role");
    await database.query("release savepoint successful_bom_call");
    return rows;
  } catch (error) {
    await database.query("rollback to savepoint successful_bom_call");
    throw error;
  }
}

async function readPcbRpcAs<Row extends QueryResultRow>(
  database: PoolClient,
  actor: SecurityActor | null,
  sql: string,
  parameters: unknown[],
): Promise<Row[]> {
  await database.query("savepoint pcb_read_attempt");
  try {
    if (actor) {
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1, true)",
        [actor.authUserId]);
      await database.query("set local role authenticated");
    } else {
      await database.query("set local role anon");
    }
    const rows = (await database.query<Row>(sql, parameters)).rows;
    await database.query("rollback to savepoint pcb_read_attempt");
    return rows;
  } catch (error) {
    await database.query("rollback to savepoint pcb_read_attempt");
    throw error;
  }
}

async function expectPcbRunSqlFailure(
  database: PoolClient,
  sql: string,
  parameters: unknown[],
  code: string,
): Promise<void> {
  await database.query("savepoint rejected_pcb_run_sql");
  try {
    await expect(database.query(sql, parameters)).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback to savepoint rejected_pcb_run_sql");
  }
}

export function registerPcbTests(requireHarness: () => SecurityFixtureHarness): void {
  it("blocks privileged changes to a used BOM except one-way version deactivation (Task 092)", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const { cardId, componentId, finishedId, anotherId } =
        await createBomSaveFixture(database, actorId);
      const versionId = (await database.query<{ id: string }>(
        `insert into public.pcb_bom_versions (pcb_card_id, version_number, created_by_user_id)
         values ($1, 1, $2) returning id`, [cardId, actorId],
      )).rows[0]!.id;
      const unusedVersionId = (await database.query<{ id: string }>(
        `insert into public.pcb_bom_versions
           (pcb_card_id, version_number, is_active, created_by_user_id)
         values ($1, 2, false, $2) returning id`, [cardId, actorId],
      )).rows[0]!.id;
      const itemId = (await database.query<{ id: string }>(
        `insert into public.pcb_bom_items
           (bom_version_id, component_product_id, quantity_per_card)
         values ($1, $2, 2) returning id`, [versionId, componentId],
      )).rows[0]!.id;
      const unusedItemId = (await database.query<{ id: string }>(
        `insert into public.pcb_bom_items
           (bom_version_id, component_product_id, quantity_per_card)
         values ($1, $2, 3) returning id`, [unusedVersionId, finishedId],
      )).rows[0]!.id;
      await database.query(
        `insert into public.pcb_production_runs
           (pcb_card_id, bom_version_id, quantity_produced, produced_by_user_id)
         values ($1, $2, 1, $3)`, [cardId, versionId, actorId],
      );

      const rejects = (sql: string, values: unknown[]) =>
        expectPcbRunSqlFailure(database, sql, values, "PCB09");
      await rejects("update public.pcb_bom_versions set pcb_card_id = $2 where id = $1",
        [versionId, randomUUID()]);
      await rejects("update public.pcb_bom_versions set version_number = 3 where id = $1",
        [versionId]);
      await rejects("update public.pcb_bom_versions set created_at = created_at + interval '1 second' where id = $1",
        [versionId]);
      await rejects("update public.pcb_bom_versions set created_by_user_id = $2 where id = $1",
        [versionId, fixture.actors.permitted.profileId]);
      await rejects("update public.pcb_bom_versions set is_active = true where id = $1",
        [versionId]);
      await rejects("update public.pcb_bom_versions set is_active = false, version_number = 3 where id = $1",
        [versionId]);
      await rejects("delete from public.pcb_bom_versions where id = $1", [versionId]);
      await rejects("insert into public.pcb_bom_items (bom_version_id, component_product_id, quantity_per_card) values ($1, $2, 1)",
        [versionId, anotherId]);
      await rejects("update public.pcb_bom_items set quantity_per_card = 4 where id = $1", [itemId]);
      await rejects("update public.pcb_bom_items set component_product_id = $2 where id = $1",
        [itemId, finishedId]);
      await rejects("update public.pcb_bom_items set bom_version_id = $2 where id = $1",
        [itemId, unusedVersionId]);
      await rejects("update public.pcb_bom_items set quantity_per_card = quantity_per_card where id = $1",
        [itemId]);
      await rejects("delete from public.pcb_bom_items where id = $1", [itemId]);
      await rejects("update public.pcb_bom_items set bom_version_id = $2 where id = $1",
        [unusedItemId, versionId]);

      expect((await database.query(
        "select id, component_product_id, quantity_per_card from public.pcb_bom_items where bom_version_id = $1",
        [versionId],
      )).rows).toEqual([{ id: itemId, component_product_id: componentId, quantity_per_card: "2" }]);
      await database.query("update public.pcb_bom_versions set is_active = false where id = $1",
        [versionId]);
      await rejects("update public.pcb_bom_versions set is_active = true where id = $1",
        [versionId]);
      await rejects("update public.pcb_bom_versions set is_active = false where id = $1",
        [versionId]);
      expect((await database.query<{ is_active: boolean }>(
        "select is_active from public.pcb_bom_versions where id = $1", [versionId],
      )).rows).toEqual([{ is_active: false }]);
      expect((await database.query<{ count: string }>(
        "select count(*) from public.audit_logs where entity_id = $1", [versionId],
      )).rows).toEqual([{ count: "0" }]);
    });
  });

  it("keeps the trusted initial-BOM no-op but rejects edits after production use (Task 092)", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const { cardId, componentId, anotherId } =
        await createBomSaveFixture(database, actor.profileId);
      const initial = await commitBomCallInTestTransaction(database, actor, cardId,
        [{ product_id: componentId, quantity_per_card: "2" }]);
      const versionId = initial[0]!.bom_version_id;
      const itemId = (await database.query<{ id: string }>(
        "select id from public.pcb_bom_items where bom_version_id = $1", [versionId],
      )).rows[0]!.id;
      await database.query(
        `insert into public.pcb_production_runs
           (pcb_card_id, bom_version_id, quantity_produced, produced_by_user_id)
         values ($1, $2, 1, $3)`, [cardId, versionId, actor.profileId],
      );
      const noOp = await commitBomCallInTestTransaction(database, actor, cardId,
        [{ product_id: componentId, quantity_per_card: "2" }]);
      expect(noOp).toEqual(initial);
      for (const payload of [
        [{ product_id: componentId, quantity_per_card: "3" }],
        [{ product_id: componentId, quantity_per_card: "2" },
          { product_id: anotherId, quantity_per_card: "1" }],
        [],
      ]) {
        await expect(saveBomAs(database, actor, cardId, payload))
          .rejects.toMatchObject({ code: "PCB09" });
      }
      expect((await database.query(
        "select id, component_product_id, quantity_per_card from public.pcb_bom_items where bom_version_id = $1",
        [versionId],
      )).rows).toEqual([{ id: itemId, component_product_id: componentId, quantity_per_card: "2" }]);
      expect((await database.query<{ count: string }>(
        "select count(*) from public.audit_logs where entity_id = $1", [versionId],
      )).rows).toEqual([{ count: "1" }]);
    });
  });

  it("serializes first production-run insertion behind a BOM item mutation (Task 092)", async () => {
    const fixture = requireHarness();
    const actorId = fixture.actors.admin.profileId;
    const outputId = randomUUID();
    const inputId = randomUUID();
    const cardId = randomUUID();
    const versionId = randomUUID();
    const itemId = randomUUID();
    const serials = [createTestSerialNumber(), createTestSerialNumber()];
    while (serials[1] === serials[0]) serials[1] = createTestSerialNumber();
    const applicationName = `bom-history-${randomUUID()}`;
    await fixture.withDatabaseClients(3, async (clients) => {
      const writer = clients[0];
      const production = clients[1];
      const observer = clients[2];
      if (!writer || !production || !observer) throw new Error("PCB concurrency clients unavailable");
      let setupCommitted = false;
      let waitingInsert: Promise<unknown> | undefined;
      let waitingUpdate: Promise<unknown> | undefined;
      try {
        await observer.query("begin");
        for (const [id, serial, kind] of [
          [outputId, serials[0], "pcb_finished_good"],
          [inputId, serials[1], "component"],
        ]) {
          await observer.query(
            `insert into public.products
               (id, serial_number, name, category, product_kind, created_by_user_id, updated_by_user_id)
             values ($1, $2, 'History-lock Product', 'PCB', $3, $4, $4)`,
            [id, serial, kind, actorId],
          );
        }
        await observer.query(
          `insert into public.pcb_cards (id, name, output_product_id, created_by_user_id, updated_by_user_id)
           values ($1, 'History-lock Card', $2, $3, $3)`, [cardId, outputId, actorId],
        );
        await observer.query(
          `insert into public.pcb_bom_versions (id, pcb_card_id, version_number, created_by_user_id)
           values ($1, $2, 1, $3)`, [versionId, cardId, actorId],
        );
        await observer.query(
          `insert into public.pcb_bom_items (id, bom_version_id, component_product_id, quantity_per_card)
           values ($1, $2, $3, 1)`, [itemId, versionId, inputId],
        );
        await observer.query("commit");
        setupCommitted = true;

        await writer.query("begin");
        await writer.query("update public.pcb_bom_items set quantity_per_card = 2 where id = $1", [itemId]);
        await production.query("begin");
        await production.query("select pg_catalog.set_config('application_name', $1, true)", [applicationName]);
        waitingInsert = production.query(
          `insert into public.pcb_production_runs
             (pcb_card_id, bom_version_id, quantity_produced, produced_by_user_id)
           values ($1, $2, 1, $3)`, [cardId, versionId, actorId],
        );
        let waitingOnLock = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const result = await observer.query<{ wait_event_type: string | null }>(
            "select wait_event_type from pg_catalog.pg_stat_activity where application_name = $1",
            [applicationName],
          );
          if (result.rows[0]?.wait_event_type === "Lock") {
            waitingOnLock = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waitingOnLock).toBe(true);
        await writer.query("rollback");
        await waitingInsert;
        waitingInsert = undefined;
        expect((await production.query<{ count: string }>(
          "select count(*) from public.pcb_production_runs where bom_version_id = $1", [versionId],
        )).rows).toEqual([{ count: "1" }]);
        await production.query("rollback");

        // Reverse the order: a pending first production run owns the parent
        // lock, and an item writer cannot pass its history check until it ends.
        await production.query("begin");
        await production.query(
          `insert into public.pcb_production_runs
             (pcb_card_id, bom_version_id, quantity_produced, produced_by_user_id)
           values ($1, $2, 1, $3)`, [cardId, versionId, actorId],
        );
        await writer.query("begin");
        await writer.query("select pg_catalog.set_config('application_name', $1, true)",
          [`${applicationName}-writer`]);
        waitingUpdate = writer.query(
          "update public.pcb_bom_items set quantity_per_card = 2 where id = $1", [itemId],
        );
        let writerWaiting = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const result = await observer.query<{ wait_event_type: string | null }>(
            "select wait_event_type from pg_catalog.pg_stat_activity where application_name = $1",
            [`${applicationName}-writer`],
          );
          if (result.rows[0]?.wait_event_type === "Lock") {
            writerWaiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(writerWaiting).toBe(true);
        await production.query("rollback");
        await waitingUpdate;
        waitingUpdate = undefined;
        await writer.query("rollback");
      } finally {
        if (waitingUpdate) {
          await production.query("rollback");
          await waitingUpdate.catch(() => undefined);
          await writer.query("rollback");
        } else if (waitingInsert) {
          await writer.query("rollback");
          await waitingInsert.catch(() => undefined);
          await production.query("rollback");
        } else {
          await writer.query("rollback");
          await production.query("rollback");
        }
        if (setupCommitted) {
          await observer.query("delete from public.pcb_bom_items where id = $1", [itemId]);
          await observer.query("delete from public.pcb_bom_versions where id = $1", [versionId]);
          await observer.query("delete from public.pcb_cards where id = $1", [cardId]);
          await observer.query("delete from public.inventory_balances where product_id = any($1::uuid[])", [[outputId, inputId]]);
          await observer.query("delete from public.products where id = any($1::uuid[])", [[outputId, inputId]]);
        } else {
          await observer.query("rollback");
        }
      }
    });
  });

  it("serializes version mutation and first production insertion through the same parent lock (Task 092)", async () => {
    const fixture = requireHarness();
    const actorId = fixture.actors.admin.profileId;
    const outputId = randomUUID();
    const cardId = randomUUID();
    const versionId = randomUUID();
    const serial = createTestSerialNumber();
    const waitingApplication = `bom-version-${randomUUID()}`;
    await fixture.withDatabaseClients(3, async (clients) => {
      const versionWriter = clients[0];
      const production = clients[1];
      const observer = clients[2];
      if (!versionWriter || !production || !observer) {
        throw new Error("PCB version-concurrency clients unavailable");
      }
      let setupCommitted = false;
      let pendingInsert: Promise<unknown> | undefined;
      let pendingUpdate: Promise<unknown> | undefined;
      try {
        await observer.query("begin");
        await observer.query(
          `insert into public.products
             (id, serial_number, name, category, product_kind, created_by_user_id, updated_by_user_id)
           values ($1, $2, 'Version-lock output', 'PCB', 'pcb_finished_good', $3, $3)`,
          [outputId, serial, actorId],
        );
        await observer.query(
          `insert into public.pcb_cards (id, name, output_product_id, created_by_user_id, updated_by_user_id)
           values ($1, 'Version-lock Card', $2, $3, $3)`, [cardId, outputId, actorId],
        );
        await observer.query(
          `insert into public.pcb_bom_versions (id, pcb_card_id, version_number, created_by_user_id)
           values ($1, $2, 1, $3)`, [versionId, cardId, actorId],
        );
        await observer.query("commit");
        setupCommitted = true;

        // Version mutation wins: production must wait for its parent row.
        await versionWriter.query("begin");
        await versionWriter.query(
          "update public.pcb_bom_versions set version_number = 2 where id = $1", [versionId],
        );
        await production.query("begin");
        await production.query("select pg_catalog.set_config('application_name', $1, true)",
          [waitingApplication]);
        pendingInsert = production.query(
          `insert into public.pcb_production_runs
             (pcb_card_id, bom_version_id, quantity_produced, produced_by_user_id)
           values ($1, $2, 1, $3)`, [cardId, versionId, actorId],
        );
        let productionWaiting = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = await observer.query<{ wait_event_type: string | null }>(
            "select wait_event_type from pg_catalog.pg_stat_activity where application_name = $1",
            [waitingApplication],
          );
          if (activity.rows[0]?.wait_event_type === "Lock") {
            productionWaiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(productionWaiting).toBe(true);
        await versionWriter.query("commit");
        await pendingInsert;
        pendingInsert = undefined;
        expect((await production.query<{ version_number: string }>(
          "select version_number from public.pcb_bom_versions where id = $1", [versionId],
        )).rows).toEqual([{ version_number: "2" }]);
        // Roll back the run so immutable history is never forcibly removed.
        await production.query("rollback");

        // First production wins: a version mutation must wait for its lock.
        await production.query("begin");
        await production.query(
          `insert into public.pcb_production_runs
             (pcb_card_id, bom_version_id, quantity_produced, produced_by_user_id)
           values ($1, $2, 1, $3)`, [cardId, versionId, actorId],
        );
        await versionWriter.query("begin");
        await versionWriter.query("select pg_catalog.set_config('application_name', $1, true)",
          [`${waitingApplication}-writer`]);
        pendingUpdate = versionWriter.query(
          "update public.pcb_bom_versions set version_number = 3 where id = $1", [versionId],
        );
        let versionWaiting = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = await observer.query<{ wait_event_type: string | null }>(
            "select wait_event_type from pg_catalog.pg_stat_activity where application_name = $1",
            [`${waitingApplication}-writer`],
          );
          if (activity.rows[0]?.wait_event_type === "Lock") {
            versionWaiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(versionWaiting).toBe(true);
        await production.query("rollback");
        await pendingUpdate;
        pendingUpdate = undefined;
        await versionWriter.query("rollback");
      } finally {
        if (pendingUpdate) {
          await production.query("rollback");
          await pendingUpdate.catch(() => undefined);
          await versionWriter.query("rollback");
        } else if (pendingInsert) {
          await versionWriter.query("rollback");
          await pendingInsert.catch(() => undefined);
          await production.query("rollback");
        } else {
          await versionWriter.query("rollback");
          await production.query("rollback");
        }
        if (setupCommitted) {
          await observer.query("delete from public.pcb_bom_versions where id = $1", [versionId]);
          await observer.query("delete from public.pcb_cards where id = $1", [cardId]);
          await observer.query("delete from public.inventory_balances where product_id = $1", [outputId]);
          await observer.query("delete from public.products where id = $1", [outputId]);
        } else {
          await observer.query("rollback");
        }
      }
    });
  });

  it("enforces PCB production-run schema, card/BOM identity and permanent history", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const cardA = await createBomSaveFixture(database, actorId);
      const cardBId = (await database.query<{ id: string }>(
        `insert into public.pcb_cards
          (name, output_product_id, created_by_user_id, updated_by_user_id)
         values ('Second production-history card', $1, $2, $2) returning id`,
        [cardA.finishedId, actorId],
      )).rows[0]!.id;
      const createVersion = async (cardId: string) => (await database.query<{ id: string }>(
        `insert into public.pcb_bom_versions (pcb_card_id, version_number, created_by_user_id)
         values ($1, 1, $2) returning id`, [cardId, actorId],
      )).rows[0]!.id;
      const versionA = await createVersion(cardA.cardId);
      const versionB = await createVersion(cardBId);
      const projectId = (await database.query<{ id: string }>(
        `insert into public.projects
           (name, customer_name, start_date, delivery_date, created_by_user_id, updated_by_user_id)
         values ('PCB production history', 'Test customer', '2026-09-01', '2026-09-02', $1, $1)
         returning id`, [actorId],
      )).rows[0]!.id;
      const insertSql = `insert into public.pcb_production_runs
        (pcb_card_id, bom_version_id, project_id, quantity_produced, status, produced_by_user_id)
        values ($1, $2, $3, $4, $5, $6)
        returning id, pcb_card_id, bom_version_id, project_id, quantity_produced, status,
          produced_by_user_id, completed_at`;
      const first = (await database.query<{
        id: string; pcb_card_id: string; bom_version_id: string; project_id: string | null;
        quantity_produced: string; status: string; produced_by_user_id: string; completed_at: Date;
      }>(
        `insert into public.pcb_production_runs
          (pcb_card_id, bom_version_id, quantity_produced, produced_by_user_id)
         values ($1, $2, 1, $3)
         returning id, pcb_card_id, bom_version_id, project_id, quantity_produced,
           status, produced_by_user_id, completed_at`,
        [cardA.cardId, versionA, actorId],
      )).rows[0]!;
      expect(first).toMatchObject({ pcb_card_id: cardA.cardId, bom_version_id: versionA,
        project_id: null, quantity_produced: "1", status: "completed", produced_by_user_id: actorId });
      expect(first.completed_at).toBeInstanceOf(Date);
      const second = (await database.query<{ id: string }>(insertSql,
        [cardA.cardId, versionA, projectId, 2, "completed", actorId])).rows[0]!;
      expect(second.id).not.toBe(first.id);
      expect((await database.query<{ project_id: string }>(
        "select project_id from public.pcb_production_runs where id = $1", [second.id],
      )).rows).toEqual([{ project_id: projectId }]);
      expect((await database.query<{ count: string }>(
        "select count(*) from public.pcb_production_runs where bom_version_id = $1", [versionA],
      )).rows).toEqual([{ count: "2" }]);
      await database.query(insertSql, [cardBId, versionB, null, 3, "completed", actorId]);

      for (const [parameters, code] of [
        [[cardA.cardId, versionA, null, 0, "completed", actorId], "23514"],
        [[cardA.cardId, versionA, null, -1, "completed", actorId], "23514"],
        [[cardA.cardId, versionA, null, 1, "pending", actorId], "23514"],
        [[cardA.cardId, versionA, null, 1, null, actorId], "23502"],
        [[randomUUID(), versionA, null, 1, "completed", actorId], "23503"],
        [[cardA.cardId, randomUUID(), null, 1, "completed", actorId], "23503"],
        [[cardA.cardId, versionB, null, 1, "completed", actorId], "23503"],
        [[cardA.cardId, versionA, randomUUID(), 1, "completed", actorId], "23503"],
        [[cardA.cardId, versionA, null, 1, "completed", randomUUID()], "23503"],
      ] as Array<[unknown[], string]>) {
        await expectPcbRunSqlFailure(database, insertSql, parameters, code);
      }
      await expectPcbRunSqlFailure(database,
        `insert into public.pcb_production_runs
          (pcb_card_id, bom_version_id, quantity_produced, produced_by_user_id, completed_at)
         values ($1, $2, 1, $3, null)`, [cardA.cardId, versionA, actorId], "23502");

      await expectPcbRunSqlFailure(database,
        "update public.pcb_production_runs set quantity_produced = 9 where id = $1",
        [first.id], "PCB08");
      await expectPcbRunSqlFailure(database,
        "delete from public.pcb_production_runs where id = $1", [first.id], "PCB08");
      expect((await database.query<{ quantity_produced: string }>(
        "select quantity_produced from public.pcb_production_runs where id = $1", [first.id],
      )).rows).toEqual([{ quantity_produced: "1" }]);

      await database.query(
        `update public.pcb_cards set is_active = false, archived_at = pg_catalog.now(),
           archived_by_user_id = $2, updated_at = pg_catalog.now(), updated_by_user_id = $2
         where id = $1`, [cardA.cardId, actorId],
      );
      await database.query(
        `update public.products set is_active = false, archived_at = pg_catalog.now(),
           archived_by_user_id = $2, updated_at = pg_catalog.now(), updated_by_user_id = $2
         where id = $1`, [cardA.outputId, actorId],
      );
      await database.query(
        `update public.projects set status = 'cancelled', cancelled_at = pg_catalog.now(),
           updated_at = pg_catalog.now(), updated_by_user_id = $2 where id = $1`,
        [projectId, actorId],
      );
      await database.query(
        "update public.pcb_bom_versions set is_active = false where id = $1", [versionA],
      );
      expect((await database.query<{ count: string }>(
        "select count(*) from public.pcb_production_runs where bom_version_id = $1", [versionA],
      )).rows).toEqual([{ count: "2" }]);
      expect(await readPcbRpcAs(database, fixture.actors.admin,
        "select id from public.pcb_production_runs where id = $1", [first.id]))
        .toEqual([{ id: first.id }]);
      expect((await database.query<{ quantity: string }>(
        "select quantity from public.inventory_balances where product_id = $1", [cardA.outputId],
      )).rows).toEqual([{ quantity: "0" }]);
      expect((await database.query<{ count: string }>(
        "select count(*) from public.inventory_movements where product_id = $1", [cardA.outputId],
      )).rows).toEqual([{ count: "0" }]);
      expect((await database.query<{ count: string }>(
        "select count(*) from public.audit_logs where entity_id = any($1::uuid[])",
        [[first.id, second.id]],
      )).rows).toEqual([{ count: "0" }]);
    });
  });

  it("limits PCB production-run reads and denies every normal-client write", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const { cardId } = await createBomSaveFixture(database, actor.profileId);
      const versionId = (await database.query<{ id: string }>(
        `insert into public.pcb_bom_versions (pcb_card_id, version_number, created_by_user_id)
         values ($1, 1, $2) returning id`, [cardId, actor.profileId],
      )).rows[0]!.id;
      const runId = (await database.query<{ id: string }>(
        `insert into public.pcb_production_runs
          (pcb_card_id, bom_version_id, quantity_produced, produced_by_user_id)
         values ($1, $2, 1, $3) returning id`, [cardId, versionId, actor.profileId],
      )).rows[0]!.id;
      for (const [profileId, key] of [
        [fixture.actors.permitted.profileId, "pcb.view"],
        [fixture.actors.unpermitted.profileId, "pcb.produce"],
        [fixture.actors.productCreator.profileId, "pcb.edit"],
      ]) {
        await database.query(
          `insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id)
           select $1, id, $2 from public.permission_definitions where key = $3`,
          [profileId, actor.profileId, key],
        );
      }
      const selectSql = "select id from public.pcb_production_runs where id = $1";
      for (const allowed of [actor, fixture.actors.permitted]) {
        expect(await readPcbRpcAs(database, allowed, selectSql, [runId])).toEqual([{ id: runId }]);
      }
      for (const denied of [fixture.actors.unpermitted, fixture.actors.productCreator,
        fixture.actors.supplierViewer, fixture.actors.inactive]) {
        expect(await readPcbRpcAs(database, denied, selectSql, [runId])).toEqual([]);
      }
      await expect(readPcbRpcAs(database, null, selectSql, [runId]))
        .rejects.toMatchObject({ code: "42501" });
      for (const directActor of [actor, fixture.actors.unpermitted, fixture.actors.productCreator]) {
        await expect(readPcbRpcAs(database, directActor,
          `insert into public.pcb_production_runs
            (pcb_card_id, bom_version_id, quantity_produced, produced_by_user_id)
           values ($1, $2, 1, $3) returning id`, [cardId, versionId, directActor.profileId]))
          .rejects.toMatchObject({ code: "42501" });
        await expect(readPcbRpcAs(database, directActor,
          "update public.pcb_production_runs set quantity_produced = 2 where id = $1", [runId]))
          .rejects.toMatchObject({ code: "42501" });
        await expect(readPcbRpcAs(database, directActor,
          "delete from public.pcb_production_runs where id = $1", [runId]))
          .rejects.toMatchObject({ code: "42501" });
      }
    });
  });

  it("limits PCB BOM editor and Product-choice reads to narrow authorized projections", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const viewer = fixture.actors.permitted;
      const editor = fixture.actors.unpermitted;
      const { cardId, outputId, componentId, finishedId, anotherId, archivedId } =
        await createBomSaveFixture(database, actor.profileId);
      await database.query(
        `update public.inventory_balances set quantity = 7, updated_at = pg_catalog.now()
         where product_id = $1`, [finishedId],
      );
      for (const [profileId, key] of [
        [viewer.profileId, "pcb.view"], [editor.profileId, "pcb.edit"],
      ]) {
        await database.query(
          `insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id)
           select $1, id, $2 from public.permission_definitions where key = $3`,
          [profileId, actor.profileId, key],
        );
      }
      const detailSql = "select * from public.get_pcb_bom_editor($1::uuid)";
      const choicesSql = "select * from public.search_pcb_bom_product_choices($1::uuid, $2::text)";
      const empty = await readPcbRpcAs<Record<string, unknown>>(database, viewer, detailSql, [cardId]);
      expect(await readPcbRpcAs<{ allowed: boolean }>(database, viewer,
        "select public.has_permission('inventory.view') as allowed", [])).toEqual([{ allowed: false }]);
      expect(await readPcbRpcAs(database, viewer,
        "select id from public.products where id = $1", [componentId])).toEqual([]);
      expect(await readPcbRpcAs(database, viewer,
        "select product_id from public.inventory_balances where product_id = $1", [componentId])).toEqual([]);
      await expect(readPcbRpcAs(database, viewer, choicesSql, [cardId, ""]))
        .rejects.toMatchObject({ code: "42501" });
      expect(empty).toHaveLength(1);
      expect(empty[0]).toMatchObject({ card_id: cardId, output_product_id: outputId,
        active_bom_version_id: null, bom_item_id: null, output_current_stock: "0" });
      expect(Object.keys(empty[0] ?? {}).sort()).toEqual([
        "card_id", "card_name", "card_is_active", "output_product_id",
        "output_serial_number", "output_current_stock", "active_bom_version_id",
        "active_bom_version_number", "bom_item_id", "input_product_id",
        "input_product_name", "input_serial_number", "input_product_kind",
        "input_product_is_active", "input_current_stock", "quantity_per_card",
      ].sort());
      const initialChoices = await readPcbRpcAs<Record<string, unknown>>(
        database, editor, choicesSql, [cardId, ""],
      );
      expect(initialChoices.map((row) => row.product_id)).toContain(componentId);
      expect(initialChoices.map((row) => row.product_id)).toContain(finishedId);
      expect(initialChoices.find((row) => row.product_id === finishedId)?.current_stock).toBe("7");
      expect(initialChoices.map((row) => row.product_id)).not.toContain(outputId);
      expect(initialChoices.map((row) => row.product_id)).not.toContain(archivedId);
      expect(Object.keys(initialChoices[0] ?? {}).sort()).toEqual([
        "product_id", "product_name", "serial_number", "product_kind", "current_stock",
      ].sort());
      expect((await readPcbRpcAs<Record<string, unknown>>(database, editor, choicesSql,
        [cardId, "save Product 3"])).map((row) => row.product_id)).toEqual([anotherId]);
      const serial = initialChoices.find((row) => row.product_id === finishedId)?.serial_number;
      expect((await readPcbRpcAs<Record<string, unknown>>(database, editor, choicesSql,
        [cardId, serial])).map((row) => row.product_id)).toEqual([finishedId]);

      const saved = await commitBomCallInTestTransaction(database, actor, cardId, [
        { product_id: componentId, quantity_per_card: 2 },
        { product_id: finishedId, quantity_per_card: 3 },
      ]);
      const versionId = saved[0]?.bom_version_id;
      await database.query(
        `update public.products set is_active = false, archived_at = pg_catalog.now(),
           archived_by_user_id = $2, updated_at = pg_catalog.now(), updated_by_user_id = $2
         where id = $1`, [componentId, actor.profileId],
      );
      const beforeAudit = (await database.query<{ count: string }>(
        "select count(*) from public.audit_logs where entity_id = $1", [versionId],
      )).rows;
      const balanceBefore = (await database.query(
        `select product_id, quantity, updated_at from public.inventory_balances
         where product_id = any($1::uuid[]) order by product_id`,
        [[outputId, componentId, finishedId, anotherId, archivedId]],
      )).rows;
      const detail = await readPcbRpcAs<Record<string, unknown>>(database, viewer, detailSql, [cardId]);
      expect(detail).toHaveLength(2);
      expect(detail.every((row) => row.active_bom_version_id === versionId &&
        row.active_bom_version_number === "1")).toBe(true);
      expect(detail.find((row) => row.input_product_id === componentId)).toMatchObject({
        input_product_is_active: false, input_serial_number: expect.stringMatching(/^[0-9]{7}$/),
        input_current_stock: "0", quantity_per_card: "2",
      });
      expect(detail.find((row) => row.input_product_id === finishedId)).toMatchObject({
        input_product_kind: "pcb_finished_good", input_current_stock: "7", quantity_per_card: "3",
      });
      expect((await readPcbRpcAs<Record<string, unknown>>(database, editor, choicesSql,
        [cardId, ""])).map((row) => row.product_id)).not.toContain(componentId);
      await expect(readPcbRpcAs(database, editor, detailSql, [cardId]))
        .rejects.toMatchObject({ code: "42501" });
      await expect(readPcbRpcAs(database, fixture.actors.productCreator, detailSql, [cardId]))
        .rejects.toMatchObject({ code: "42501" });
      await expect(readPcbRpcAs(database, fixture.actors.productCreator, choicesSql, [cardId, ""]))
        .rejects.toMatchObject({ code: "42501" });
      await expect(readPcbRpcAs(database, fixture.actors.inactive, detailSql, [cardId]))
        .rejects.toMatchObject({ code: "42501" });
      await expect(readPcbRpcAs(database, fixture.actors.inactive, choicesSql, [cardId, ""]))
        .rejects.toMatchObject({ code: "42501" });
      await expect(readPcbRpcAs(database, null, detailSql, [cardId]))
        .rejects.toMatchObject({ code: "42501" });
      await expect(readPcbRpcAs(database, null, choicesSql, [cardId, ""]))
        .rejects.toMatchObject({ code: "42501" });
      expect((await readPcbRpcAs<Record<string, unknown>>(database, actor, detailSql,
        [cardId])).length).toBe(2);
      expect((await readPcbRpcAs<Record<string, unknown>>(database, actor, choicesSql,
        [cardId, ""])).length).toBeGreaterThan(0);
      expect((await database.query<{ count: string }>(
        "select count(*) from public.audit_logs where entity_id = $1", [versionId],
      )).rows).toEqual(beforeAudit);
      expect((await database.query(
        `select product_id, quantity, updated_at from public.inventory_balances
         where product_id = any($1::uuid[]) order by product_id`,
        [[outputId, componentId, finishedId, anotherId, archivedId]],
      )).rows).toEqual(balanceBefore);
      expect((await database.query<{ count: string }>(
        "select count(*) from public.inventory_movements where product_id = any($1::uuid[])",
        [[outputId, componentId, finishedId, anotherId, archivedId]],
      )).rows).toEqual([{ count: "0" }]);
      await database.query(
        `update public.pcb_cards set is_active = false, archived_at = pg_catalog.now(),
           archived_by_user_id = $2, updated_at = pg_catalog.now(), updated_by_user_id = $2
         where id = $1`, [cardId, actor.profileId],
      );
      expect((await readPcbRpcAs<Record<string, unknown>>(database, viewer, detailSql,
        [cardId]))[0]?.card_is_active).toBe(false);
      await expect(readPcbRpcAs(database, editor, choicesSql, [cardId, ""]))
        .rejects.toMatchObject({ code: "PCB07" });
    });
  });

  it("rejects an archived PCB Card BOM save with PCB07 before any BOM write", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { cardId, componentId } =
        await createBomSaveFixture(database, fixture.actors.admin.profileId);
      await database.query(
        `update public.pcb_cards set is_active = false, archived_at = pg_catalog.now(),
           archived_by_user_id = $2, updated_at = pg_catalog.now(), updated_by_user_id = $2
         where id = $1`,
        [cardId, fixture.actors.admin.profileId],
      );
      await expect(saveBomAs(database, fixture.actors.admin, cardId, [
        { product_id: componentId, quantity_per_card: 1 },
      ])).rejects.toMatchObject({ code: "PCB07" });
      expect((await database.query<{ count: string }>(
        "select count(*) from public.pcb_bom_versions where pcb_card_id = $1", [cardId],
      )).rows).toEqual([{ count: "0" }]);
      expect((await database.query<{ count: string }>(
        "select count(*) from public.audit_logs where entity_id = $1", [cardId],
      )).rows).toEqual([{ count: "0" }]);
    });
  });

  it("accepts legacy numeric and exact decimal-string PCB BOM quantities", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { cardId, componentId } = await createBomSaveFixture(
        database, fixture.actors.admin.profileId,
      );
      const actor = fixture.actors.admin;
      const save = (quantity: unknown) => commitBomCallInTestTransaction(database, actor, cardId,
        [{ product_id: componentId, quantity_per_card: quantity }]);
      const persistedQuantity = async () => (await database.query<{ quantity_per_card: string }>(
        `select item.quantity_per_card from public.pcb_bom_items as item
         join public.pcb_bom_versions as version on version.id = item.bom_version_id
         where version.pcb_card_id = $1`, [cardId],
      )).rows[0]?.quantity_per_card;
      const auditCount = async () => (await database.query<{ count: string }>(
        `select count(*) from public.audit_logs as audit
         join public.pcb_bom_versions as version on version.id = audit.entity_id
         where version.pcb_card_id = $1`, [cardId],
      )).rows[0]?.count;

      const initial = await save(2);
      expect(initial).toEqual([{ bom_version_id: expect.any(String), version_number: "1" }]);
      expect(await persistedQuantity()).toBe("2");
      for (const quantity of ["1", "9007199254740993", "9223372036854775807"]) {
        expect(await save(quantity)).toEqual(initial);
        expect(await persistedQuantity()).toBe(quantity);
      }
      expect(await auditCount()).toBe("4");
      expect(await save("0009223372036854775807")).toEqual(initial);
      expect(await persistedQuantity()).toBe("9223372036854775807");
      expect(await save("9223372036854775807")).toEqual(initial);
      expect(await auditCount()).toBe("4");

      for (const quantity of ["0", "-1", "1.5", "1e3", "9223372036854775808",
        "not-a-number", true, null, {}, []]) {
        await expect(saveBomAs(database, actor, cardId,
          [{ product_id: componentId, quantity_per_card: quantity }]))
          .rejects.toMatchObject({ code: "22023" });
        expect(await persistedQuantity()).toBe("9223372036854775807");
        expect(await auditCount()).toBe("4");
      }
    });
  });

  it("saves and updates only the initial PCB BOM with one audit per meaningful change", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { cardId, outputId, componentId, finishedId, anotherId, archivedId } =
        await createBomSaveFixture(database, fixture.actors.admin.profileId);
      const actor = fixture.actors.admin;
      const first = await commitBomCallInTestTransaction(database, actor, cardId, [
        { product_id: componentId, quantity_per_card: 2 },
        { product_id: finishedId, quantity_per_card: 3 },
      ]);
      expect(first).toEqual([{ bom_version_id: expect.any(String), version_number: "1" }]);
      const versionId = first[0]?.bom_version_id;
      expect(versionId).toBeDefined();
      const original = (await database.query<{ created_at: Date; created_by_user_id: string }>(
        "select created_at, created_by_user_id from public.pcb_bom_versions where id = $1",
        [versionId],
      )).rows[0];
      expect(original?.created_by_user_id).toBe(actor.profileId);
      const items = await database.query<{ component_product_id: string; quantity_per_card: string }>(
        `select component_product_id, quantity_per_card from public.pcb_bom_items
         where bom_version_id = $1 order by component_product_id`, [versionId],
      );
      expect(items.rows).toEqual([
        { component_product_id: componentId, quantity_per_card: "2" },
        { component_product_id: finishedId, quantity_per_card: "3" },
      ].sort((a, b) => a.component_product_id.localeCompare(b.component_product_id)));
      const itemIdsBefore = (await database.query<{ id: string }>(
        "select id from public.pcb_bom_items where bom_version_id = $1 order by id", [versionId],
      )).rows;

      const reordered = await commitBomCallInTestTransaction(database, actor, cardId, [
        { product_id: finishedId, quantity_per_card: 3 },
        { product_id: componentId, quantity_per_card: 2 },
      ]);
      expect(reordered).toEqual(first);
      expect((await database.query<{ id: string }>(
        "select id from public.pcb_bom_items where bom_version_id = $1 order by id", [versionId],
      )).rows).toEqual(itemIdsBefore);
      expect((await database.query<{ count: string }>(
        "select count(*) from public.audit_logs where entity_id = $1", [versionId],
      )).rows).toEqual([{ count: "1" }]);

      const updated = await commitBomCallInTestTransaction(database, actor, cardId, [
        { product_id: componentId, quantity_per_card: 5 },
        { product_id: anotherId, quantity_per_card: 1 },
      ]);
      expect(updated).toEqual(first);
      expect((await database.query<{ component_product_id: string; quantity_per_card: string }>(
        `select component_product_id, quantity_per_card from public.pcb_bom_items
         where bom_version_id = $1 order by component_product_id`, [versionId],
      )).rows).toEqual([
        { component_product_id: componentId, quantity_per_card: "5" },
        { component_product_id: anotherId, quantity_per_card: "1" },
      ].sort((a, b) => a.component_product_id.localeCompare(b.component_product_id)));
      expect((await database.query(
        "select created_at, created_by_user_id from public.pcb_bom_versions where id = $1",
        [versionId],
      )).rows).toEqual([original]);
      expect((await database.query<{ version_number: string; is_active: boolean }>(
        "select version_number, is_active from public.pcb_bom_versions where pcb_card_id = $1",
        [cardId],
      )).rows).toEqual([{ version_number: "1", is_active: true }]);
      const audits = await database.query<{ action_type: string; actor_user_id: string; before_data: unknown; after_data: unknown }>(
        "select action_type, actor_user_id, before_data, after_data from public.audit_logs where entity_id = $1 order by created_at, id",
        [versionId],
      );
      expect(audits.rows.map((row) => row.action_type).sort())
        .toEqual(["pcb_bom.created", "pcb_bom.updated"]);
      expect(audits.rows.every((row) => row.actor_user_id === actor.profileId)).toBe(true);
      expect(audits.rows.find((row) => row.action_type === "pcb_bom.updated"))
        .toMatchObject({ before_data: { items: expect.any(Array) }, after_data: { items: expect.any(Array) } });
      const allProductIds = [outputId, componentId, finishedId, anotherId, archivedId];
      const balances = await database.query<{ quantity: string }>(
        "select quantity from public.inventory_balances where product_id = any($1::uuid[])",
        [allProductIds],
      );
      expect(balances.rows).toHaveLength(allProductIds.length);
      expect(balances.rows.every((row) => row.quantity === "0")).toBe(true);
      expect((await database.query<{ count: string }>(
        "select count(*) from public.inventory_movements where product_id = any($1::uuid[])",
        [allProductIds],
      )).rows).toEqual([{ count: "0" }]);
    });
  });

  it("preserves unchanged archived BOM inputs while validating only new or changed inputs", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { cardId, outputId, componentId, finishedId, anotherId, archivedId } =
        await createBomSaveFixture(database, fixture.actors.admin.profileId);
      const actor = fixture.actors.admin;
      const allProductIds = [outputId, componentId, finishedId, anotherId, archivedId];
      const balanceRows = () => database.query<{
        product_id: string; quantity: string; updated_at: Date;
      }>(
        `select product_id, quantity, updated_at from public.inventory_balances
         where product_id = any($1::uuid[]) order by product_id`,
        [allProductIds],
      );
      const balancesBefore = (await balanceRows()).rows;
      const archivedInput = { product_id: componentId, quantity_per_card: 2 };
      const finishedInput = { product_id: finishedId, quantity_per_card: 3 };
      const anotherInput = { product_id: anotherId, quantity_per_card: 4 };

      // Every input is new on initial creation, so an archived Product is denied.
      await expect(saveBomAs(database, actor, cardId, [
        { product_id: archivedId, quantity_per_card: 1 },
      ])).rejects.toMatchObject({ code: "PCB04" });
      expect((await database.query<{ count: string }>(
        "select count(*) from public.pcb_bom_versions where pcb_card_id = $1", [cardId],
      )).rows).toEqual([{ count: "0" }]);

      const initial = await commitBomCallInTestTransaction(database, actor, cardId,
        [archivedInput, finishedInput]);
      const versionId = initial[0]?.bom_version_id;
      expect(versionId).toBeDefined();
      const itemRows = () => database.query<{
        id: string; component_product_id: string; quantity_per_card: string;
      }>(
        `select id, component_product_id, quantity_per_card
         from public.pcb_bom_items where bom_version_id = $1 order by component_product_id`,
        [versionId],
      );
      const auditCount = async () => (await database.query<{ count: string }>(
        "select count(*) from public.audit_logs where entity_id = $1", [versionId],
      )).rows[0]?.count;
      const initialRows = (await itemRows()).rows;
      const archivedItemId = initialRows.find((row) => row.component_product_id === componentId)?.id;
      expect(archivedItemId).toBeDefined();
      expect(await auditCount()).toBe("1");

      await database.query(
        `update public.products set is_active = false, archived_at = pg_catalog.now(),
           archived_by_user_id = $2, updated_at = pg_catalog.now(), updated_by_user_id = $2
         where id = $1`, [componentId, actor.profileId],
      );
      expect((await database.query<{ component_product_id: string; is_active: boolean }>(
        `select item.component_product_id, product.is_active
         from public.pcb_bom_items as item
         join public.products as product on product.id = item.component_product_id
         where item.id = $1`, [archivedItemId],
      )).rows).toEqual([{ component_product_id: componentId, is_active: false }]);

      // An exact no-op neither rewrites archived items nor creates audit noise.
      expect(await commitBomCallInTestTransaction(database, actor, cardId,
        [finishedInput, archivedInput])).toEqual(initial);
      expect((await itemRows()).rows).toEqual(initialRows);
      expect(await auditCount()).toBe("1");

      // Changing the archived input, even alongside an unrelated valid change,
      // fails atomically and leaves the complete prior set/audit unchanged.
      await expect(saveBomAs(database, actor, cardId, [
        { product_id: componentId, quantity_per_card: 5 }, finishedInput,
      ])).rejects.toMatchObject({ code: "PCB04" });
      await expect(saveBomAs(database, actor, cardId, [
        { product_id: componentId, quantity_per_card: 5 }, anotherInput,
      ])).rejects.toMatchObject({ code: "PCB04" });
      await expect(saveBomAs(database, actor, cardId, [
        archivedInput, { product_id: archivedId, quantity_per_card: 1 },
      ])).rejects.toMatchObject({ code: "PCB04" });
      expect((await itemRows()).rows).toEqual(initialRows);
      expect(await auditCount()).toBe("1");

      // Replacing a different row, then adding another active input, must not
      // touch the unchanged archived row or create an extra BOM version.
      expect(await commitBomCallInTestTransaction(database, actor, cardId,
        [archivedInput, anotherInput])).toEqual(initial);
      expect((await itemRows()).rows.find((row) => row.component_product_id === componentId)?.id)
        .toBe(archivedItemId);
      expect(await auditCount()).toBe("2");
      expect(await commitBomCallInTestTransaction(database, actor, cardId,
        [archivedInput, anotherInput, finishedInput])).toEqual(initial);
      expect((await itemRows()).rows.find((row) => row.component_product_id === componentId)?.id)
        .toBe(archivedItemId);
      expect(await auditCount()).toBe("3");

      // Removing the archived reference is allowed and is one meaningful update.
      expect(await commitBomCallInTestTransaction(database, actor, cardId,
        [anotherInput, finishedInput])).toEqual(initial);
      expect((await itemRows()).rows.map((row) => row.component_product_id).sort())
        .toEqual([anotherId, finishedId].sort());
      expect(await auditCount()).toBe("4");
      expect((await database.query<{ count: string }>(
        "select count(*) from public.pcb_bom_versions where pcb_card_id = $1", [cardId],
      )).rows).toEqual([{ count: "1" }]);
      expect((await database.query<{ action_type: string }>(
        "select action_type from public.audit_logs where entity_id = $1 order by created_at, id",
        [versionId],
      )).rows.map((row) => row.action_type).sort()).toEqual([
        "pcb_bom.created", "pcb_bom.updated", "pcb_bom.updated", "pcb_bom.updated",
      ]);
      expect(balancesBefore).toHaveLength(allProductIds.length);
      expect(balancesBefore.every((row) => row.quantity === "0")).toBe(true);
      expect((await balanceRows()).rows).toEqual(balancesBefore);
      expect((await database.query<{ count: string }>(
        "select count(*) from public.inventory_movements where product_id = any($1::uuid[])",
        [allProductIds],
      )).rows).toEqual([{ count: "0" }]);
    });
  });

  it("rejects unauthorized and invalid initial BOM saves without partial writes", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { cardId, outputId, componentId, finishedId, anotherId, archivedId } =
        await createBomSaveFixture(database, fixture.actors.admin.profileId);
      for (const [actor, key] of [
        [fixture.actors.permitted, "pcb.view"],
        [fixture.actors.productCreator, "pcb.create"],
        [fixture.actors.productEditor, "pcb.produce"],
        [fixture.actors.unpermitted, "pcb.edit"],
      ] as const) {
        await database.query(
          `insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id)
           select $1, id, $2 from public.permission_definitions where key = $3`,
          [actor.profileId, fixture.actors.admin.profileId, key],
        );
      }
      await database.query("update public.user_profiles set is_admin = true where id = $1",
        [fixture.actors.inactive.profileId]);
      const valid = [{ product_id: componentId, quantity_per_card: 2 }];
      for (const actor of [
        fixture.actors.permitted, fixture.actors.productCreator,
        fixture.actors.productEditor, fixture.actors.supplierViewer,
        fixture.actors.inactive,
      ]) {
        await expect(saveBomAs(database, actor, cardId, valid))
          .rejects.toMatchObject({ code: "42501" });
      }
      await expect(saveBomAs(database, null, cardId, valid))
        .rejects.toMatchObject({ code: "42501" });
      const editor = fixture.actors.unpermitted;
      const editorSave = await commitBomCallInTestTransaction(database, editor, cardId, valid);
      expect(editorSave[0]?.version_number).toBe("1");
      const versionId = editorSave[0]?.bom_version_id;
      const productIds = [outputId, componentId, finishedId, anotherId, archivedId];
      const balances = await database.query<{ quantity: string }>(
        "select quantity from public.inventory_balances where product_id = any($1::uuid[])",
        [productIds],
      );
      expect(balances.rows).toHaveLength(productIds.length);
      expect(balances.rows.every((row) => row.quantity === "0")).toBe(true);
      expect((await database.query<{ count: string }>(
        "select count(*) from public.inventory_movements where product_id = any($1::uuid[])",
        [productIds],
      )).rows).toEqual([{ count: "0" }]);
      const invalid: Array<[unknown, string]> = [
        [[{ product_id: outputId, quantity_per_card: 1 }], "22023"],
        [[{ product_id: archivedId, quantity_per_card: 1 }], "PCB04"],
        [[{ product_id: randomUUID(), quantity_per_card: 1 }], "PCB04"],
        [[{ product_id: componentId, quantity_per_card: 0 }], "22023"],
        [[{ product_id: componentId, quantity_per_card: -1 }], "22023"],
        [[{ product_id: componentId, quantity_per_card: 1.5 }], "22023"],
        [[{ product_id: componentId, quantity_per_card: "2.0" }], "22023"],
        [[{ product_id: "bad-uuid", quantity_per_card: 1 }], "22023"],
        [[{ product_id: componentId }], "22023"],
        [[{ product_id: componentId, quantity_per_card: 1 },
          { product_id: componentId, quantity_per_card: 2 }], "23505"],
        [[{ product_id: componentId, quantity_per_card: 1, is_active: false }], "22023"],
        [[{ product_id: componentId, quantity_per_card: 9223372036854775808 }], "22023"],
        [[{ product_id: componentId, quantity_per_card: 1 },
          { product_id: randomUUID(), quantity_per_card: 1 }], "PCB04"],
        [[{ product_id: componentId, quantity_per_card: 1 },
          { product_id: archivedId, quantity_per_card: 1 }], "PCB04"],
      ];
      // Exercise both array and non-array payloads without any successful replacement.
      for (const [payload, code] of invalid) {
        await expect(saveBomAs(database, editor, cardId, payload))
          .rejects.toMatchObject({ code });
      }
      for (const payload of [null, {}, "not-an-array"]) {
        await expect(saveBomAs(database, editor, cardId, payload))
          .rejects.toMatchObject({ code: "22023" });
      }
      await expect(saveBomAs(database, editor, randomUUID(), valid))
        .rejects.toMatchObject({ code: "P0002" });
      expect((await database.query<{ component_product_id: string; quantity_per_card: string }>(
        "select component_product_id, quantity_per_card from public.pcb_bom_items where bom_version_id = $1",
        [versionId],
      )).rows).toEqual([{ component_product_id: componentId, quantity_per_card: "2" }]);
      expect((await database.query<{ count: string }>(
        "select count(*) from public.audit_logs where entity_id = $1", [versionId],
      )).rows).toEqual([{ count: "1" }]);
      await database.query(
        `insert into public.pcb_bom_versions
          (pcb_card_id, version_number, is_active, created_by_user_id)
         values ($1, 2, false, $2)`,
        [cardId, fixture.actors.admin.profileId],
      );
      await expect(saveBomAs(database, editor, cardId, valid))
        .rejects.toMatchObject({ code: "PCB06" });
      await database.query(
        `update public.pcb_cards set is_active = false, archived_at = pg_catalog.now(),
           archived_by_user_id = $2, updated_at = pg_catalog.now(), updated_by_user_id = $2
         where id = $1`, [cardId, fixture.actors.admin.profileId],
      );
      await expect(saveBomAs(database, editor, cardId, valid))
        .rejects.toMatchObject({ code: "PCB07" });

      const security = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        security_definer: boolean;
        settings: string[];
      }>(
        `select p.prosecdef as security_definer, p.proconfig as settings,
           pg_catalog.has_function_privilege('anon', p.oid, 'execute') as anonymous_execute,
           pg_catalog.has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute
         from pg_catalog.pg_proc as p
         where p.oid = 'public.save_initial_pcb_bom(uuid,jsonb)'::pg_catalog.regprocedure`,
      );
      expect(security.rows).toEqual([{
        anonymous_execute: false,
        authenticated_execute: true,
        security_definer: true,
        settings: ['search_path=""'],
      }]);
    });
  });

  it("serializes concurrent first BOM saves through the PCB Card row lock", async () => {
    const fixture = requireHarness();
    const outputId = randomUUID();
    const inputA = randomUUID();
    const inputB = randomUUID();
    const cardId = randomUUID();
    const applicationName = `alfaev-bom-first-save-${randomUUID()}`;
    const actor = fixture.actors.admin;
    const ids = [outputId, inputA, inputB];
    const serials = new Set<string>();
    while (serials.size < 3) serials.add(createTestSerialNumber());

    await fixture.withDatabaseClients(3, async (clients) => {
      const first = clients[0];
      const second = clients[1];
      const observer = clients[2];
      if (!first || !second || !observer) throw new Error("PCB concurrency clients unavailable");
      let setupCommitted = false;
      let waitingSave: Promise<{
        error: unknown | null;
        rows: Array<{ bom_version_id: string; version_number: string }>;
      }> | undefined;
      try {
        await observer.query("begin");
        let index = 0;
        for (const serial of serials) {
          await observer.query(
            `insert into public.products
              (id, serial_number, name, category, product_kind, created_by_user_id, updated_by_user_id)
             values ($1, $2, 'Concurrent BOM Product', 'PCB', $3, $4, $4)`,
            [ids[index], serial, index === 0 ? "pcb_finished_good" : "component", actor.profileId],
          );
          index += 1;
        }
        await observer.query(
          `insert into public.pcb_cards
            (id, name, output_product_id, created_by_user_id, updated_by_user_id)
           values ($1, 'Concurrent BOM Card', $2, $3, $3)`,
          [cardId, outputId, actor.profileId],
        );
        await observer.query("commit");
        setupCommitted = true;

        await first.query("begin");
        await first.query("select pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [actor.authUserId]);
        await first.query("set local role authenticated");
        const firstResult = await first.query<{ bom_version_id: string; version_number: string }>(
          "select * from public.save_initial_pcb_bom($1, $2::jsonb)",
          [cardId, JSON.stringify([{ product_id: inputA, quantity_per_card: 2 }])],
        );
        expect(firstResult.rows[0]?.version_number).toBe("1");

        await second.query("begin");
        await second.query("select pg_catalog.set_config('application_name', $1, true)", [applicationName]);
        await second.query("select pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [actor.authUserId]);
        await second.query("set local role authenticated");
        waitingSave = second.query<{ bom_version_id: string; version_number: string }>(
          "select * from public.save_initial_pcb_bom($1, $2::jsonb)",
          [cardId, JSON.stringify([{ product_id: inputB, quantity_per_card: 7 }])],
        ).then(
          (result) => ({ error: null, rows: result.rows }),
          (error: unknown) => ({ error, rows: [] }),
        );
        let waitingOnLock = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = await observer.query<{ wait_event_type: string | null }>(
            "select wait_event_type from pg_catalog.pg_stat_activity where application_name = $1",
            [applicationName],
          );
          if (activity.rows[0]?.wait_event_type === "Lock") {
            waitingOnLock = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waitingOnLock).toBe(true);
        expect((await observer.query<{ count: string }>(
          "select count(*) from public.pcb_bom_versions where pcb_card_id = $1", [cardId],
        )).rows).toEqual([{ count: "0" }]);

        // Roll back the first writer so no permanent audit/business fixture remains.
        await first.query("rollback");
        const secondResult = await waitingSave;
        expect(secondResult.error).toBeNull();
        expect(secondResult.rows[0]?.version_number).toBe("1");
        const versionId = secondResult.rows[0]?.bom_version_id;
        expect((await second.query<{ version_number: string; is_active: boolean }>(
          "select version_number, is_active from public.pcb_bom_versions where pcb_card_id = $1",
          [cardId],
        )).rows).toEqual([{ version_number: "1", is_active: true }]);
        expect((await second.query<{ component_product_id: string; quantity_per_card: string }>(
          "select component_product_id, quantity_per_card from public.pcb_bom_items where bom_version_id = $1",
          [versionId],
        )).rows).toEqual([{ component_product_id: inputB, quantity_per_card: "7" }]);
        await second.query("rollback");
      } finally {
        await first.query("rollback");
        if (waitingSave) await waitingSave;
        await second.query("rollback");
        if (setupCommitted) {
          await observer.query("delete from public.pcb_cards where id = $1", [cardId]);
          await observer.query("delete from public.inventory_balances where product_id = any($1::uuid[])", [ids]);
          await observer.query("delete from public.products where id = any($1::uuid[])", [ids]);
        } else {
          await observer.query("rollback");
        }
      }
    });
  });
  it("enforces PCB BOM version, item, eligibility and historical reference integrity", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const [outputA, outputB, component, finishedGood, archivedInput] =
        Array.from({ length: 5 }, () => randomUUID());
      const serials: string[] = [];
      while (serials.length < 5) {
        const serial = createTestSerialNumber();
        if (!serials.includes(serial)) serials.push(serial);
      }
      for (const [index, productId] of [outputA, outputB, component, finishedGood, archivedInput].entries()) {
        await database.query(
          `insert into public.products (id, serial_number, name, category, product_kind,
             created_by_user_id, updated_by_user_id)
           values ($1, $2, $3, 'PCB', $4, $5, $5)`,
          [productId, serials[index], `BOM Product ${index}`,
            index < 2 || index === 3 ? "pcb_finished_good" : "component", actorId],
        );
      }
      const cardA = randomUUID();
      const cardB = randomUUID();
      for (const [cardId, productId] of [[cardA, outputA], [cardB, outputB]]) {
        await database.query(
          `insert into public.pcb_cards (id, name, output_product_id,
             created_by_user_id, updated_by_user_id)
           values ($1, 'BOM Test Card', $2, $3, $3)`,
          [cardId, productId, actorId],
        );
      }
      const noVersions = await database.query<{ count: string }>(
        "select count(*) from public.pcb_bom_versions where pcb_card_id = $1", [cardB],
      );
      expect(noVersions.rows).toEqual([{ count: "0" }]);

      const version1 = randomUUID();
      const version2 = randomUUID();
      const otherCardVersion = randomUUID();
      await database.query(
        `insert into public.pcb_bom_versions (id, pcb_card_id, version_number, created_by_user_id)
         values ($1, $2, 1, $3)`, [version1, cardA, actorId],
      );
      await database.query(
        `insert into public.pcb_bom_versions (id, pcb_card_id, version_number, is_active, created_by_user_id)
         values ($1, $2, 2, false, $3)`, [version2, cardA, actorId],
      );
      await database.query(
        `insert into public.pcb_bom_versions (id, pcb_card_id, version_number, created_by_user_id)
         values ($1, $2, 1, $3)`, [otherCardVersion, cardB, actorId],
      );

      async function rejects(sql: string, values: unknown[], code: string) {
        await database.query("savepoint invalid_bom_row");
        await expect(database.query(sql, values)).rejects.toMatchObject({ code });
        await database.query("rollback to savepoint invalid_bom_row");
      }

      const versionInsert = `insert into public.pcb_bom_versions
        (pcb_card_id, version_number, is_active, created_by_user_id)
        values ($1, $2, $3, $4)`;
      await rejects(versionInsert, [randomUUID(), 1, true, actorId], "23503");
      await rejects(versionInsert, [cardA, null, false, actorId], "23502");
      await rejects(versionInsert, [cardA, 0, false, actorId], "23514");
      await rejects(versionInsert, [cardA, -1, false, actorId], "23514");
      await rejects(versionInsert, [cardA, 1, false, actorId], "23505");
      await rejects(versionInsert, [cardA, 3, true, actorId], "23505");
      await rejects(versionInsert, [cardA, 3, false, randomUUID()], "23503");
      await rejects("update public.pcb_bom_versions set pcb_card_id = $2 where id = $1",
        [version2, cardB], "PCB03");

      const componentItem = randomUUID();
      const finishedItem = randomUUID();
      await database.query(
        `insert into public.pcb_bom_items
           (id, bom_version_id, component_product_id, quantity_per_card)
         values ($1, $2, $3, 2), ($4, $2, $5, 3)`,
        [componentItem, version1, component, finishedItem, finishedGood],
      );
      await database.query(
        `insert into public.pcb_bom_items
           (bom_version_id, component_product_id, quantity_per_card)
         values ($1, $2, 1)`, [version2, component],
      );
      const itemInsert = `insert into public.pcb_bom_items
        (bom_version_id, component_product_id, quantity_per_card)
        values ($1, $2, $3)`;
      await rejects(itemInsert, [version1, component, 1], "23505");
      await rejects(itemInsert, [version1, archivedInput, 0], "23514");
      await rejects(itemInsert, [version1, archivedInput, -1], "23514");
      await rejects(itemInsert, [randomUUID(), component, 1], "23503");
      await rejects(itemInsert, [version1, randomUUID(), 1], "23503");
      await rejects(itemInsert, [version1, outputA, 1], "PCB05");
      await rejects("update public.pcb_bom_items set component_product_id = $2 where id = $1",
        [componentItem, outputA], "PCB05");

      const foreignKeys = await database.query<{ conname: string; confdeltype: string }>(
        `select conname, confdeltype
         from pg_catalog.pg_constraint
         where conrelid in (
           'public.pcb_bom_versions'::pg_catalog.regclass,
           'public.pcb_bom_items'::pg_catalog.regclass
         ) and contype = 'f'
         order by conname`,
      );
      expect(foreignKeys.rows).toHaveLength(4);
      expect(foreignKeys.rows.every((row) => row.confdeltype === "r")).toBe(true);

      await database.query(
        `update public.products set is_active = false, archived_at = pg_catalog.now(),
           archived_by_user_id = $2, updated_at = pg_catalog.now(), updated_by_user_id = $2
         where id = $1`, [archivedInput, actorId],
      );
      await rejects(itemInsert, [version1, archivedInput, 1], "PCB04");
      await rejects("update public.pcb_bom_items set component_product_id = $2 where id = $1",
        [componentItem, archivedInput], "PCB04");

      await database.query(
        `update public.products set is_active = false, archived_at = pg_catalog.now(),
           archived_by_user_id = $2, updated_at = pg_catalog.now(), updated_by_user_id = $2
         where id = $1`, [finishedGood, actorId],
      );
      expect((await database.query<{ component_product_id: string }>(
        "select component_product_id from public.pcb_bom_items where id = $1", [finishedItem],
      )).rows).toEqual([{ component_product_id: finishedGood }]);
      expect((await database.query<{ count: string }>(
        "select count(*) from public.audit_logs where entity_id = any($1::uuid[])",
        [[version1, version2, componentItem, finishedItem]],
      )).rows).toEqual([{ count: "0" }]);
    });
  });

  it("allows only active PCB readers to see BOM rows and denies every direct client write", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const outputId = randomUUID();
      const inputId = randomUUID();
      const cardId = randomUUID();
      const versionId = randomUUID();
      const itemId = randomUUID();
      let inputSerial = createTestSerialNumber();
      const outputSerial = createTestSerialNumber();
      while (inputSerial === outputSerial) inputSerial = createTestSerialNumber();
      await database.query(
        `insert into public.products (id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id)
         values ($1, $3, 'BOM Output', 'PCB', 'pcb_finished_good', $5, $5),
                ($2, $4, 'BOM Input', 'Parts', 'component', $5, $5)`,
        [outputId, inputId, outputSerial, inputSerial, actorId],
      );
      await database.query(
        `insert into public.pcb_cards (id, name, output_product_id, created_by_user_id, updated_by_user_id)
         values ($1, 'BOM Security Card', $2, $3, $3)`, [cardId, outputId, actorId],
      );
      await database.query(
        `insert into public.pcb_bom_versions (id, pcb_card_id, version_number, created_by_user_id)
         values ($1, $2, 1, $3)`, [versionId, cardId, actorId],
      );
      await database.query(
        `insert into public.pcb_bom_items (id, bom_version_id, component_product_id, quantity_per_card)
         values ($1, $2, $3, 2)`, [itemId, versionId, inputId],
      );
      await database.query(
        `insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id)
         select $1, id, $3 from public.permission_definitions where key = $2`,
        [fixture.actors.permitted.profileId, "pcb.view", actorId],
      );
      await database.query(
        `insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id)
         select $1, id, $3 from public.permission_definitions where key = $2`,
        [fixture.actors.unpermitted.profileId, "pcb.edit", actorId],
      );
      await database.query("update public.user_profiles set is_admin = true where id = $1",
        [fixture.actors.inactive.profileId]);

      for (const actor of [fixture.actors.admin, fixture.actors.permitted]) {
        await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [actor.authUserId]);
        await database.query("set local role authenticated");
        expect((await database.query<{ id: string }>(
          "select id from public.pcb_bom_versions where id = $1", [versionId],
        )).rows).toEqual([{ id: versionId }]);
        expect((await database.query<{ id: string }>(
          "select id from public.pcb_bom_items where id = $1", [itemId],
        )).rows).toEqual([{ id: itemId }]);
        await database.query("reset role");
      }

      await database.query(
        `update public.products set is_active = false, archived_at = pg_catalog.now(),
           archived_by_user_id = $2, updated_at = pg_catalog.now(), updated_by_user_id = $2
         where id = $1`, [inputId, actorId],
      );
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1, true)",
        [fixture.actors.permitted.authUserId]);
      await database.query("set local role authenticated");
      expect((await database.query<{ id: string }>(
        "select id from public.pcb_bom_items where id = $1", [itemId],
      )).rows).toEqual([{ id: itemId }]);
      await database.query("reset role");

      for (const actor of [fixture.actors.unpermitted, fixture.actors.inactive]) {
        await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [actor.authUserId]);
        await database.query("set local role authenticated");
        expect((await database.query("select id from public.pcb_bom_versions where id = $1", [versionId])).rows)
          .toEqual([]);
        expect((await database.query("select id from public.pcb_bom_items where id = $1", [itemId])).rows)
          .toEqual([]);
        await database.query("reset role");
      }

      await database.query("savepoint anonymous_bom_read");
      await database.query("set local role anon");
      await expect(database.query("select id from public.pcb_bom_versions limit 1"))
        .rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_bom_read");
      await database.query("savepoint anonymous_bom_item_read");
      await database.query("set local role anon");
      await expect(database.query("select id from public.pcb_bom_items limit 1"))
        .rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_bom_item_read");

      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1, true)",
        [fixture.actors.unpermitted.authUserId]);
      await database.query("set local role authenticated");
      await database.query("savepoint pcb_edit_direct_write");
      await expect(database.query(
        `insert into public.pcb_bom_items (bom_version_id, component_product_id, quantity_per_card)
         values ($1, $2, 1)`, [versionId, inputId],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint pcb_edit_direct_write");
      await database.query("reset role");

      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1, true)",
        [fixture.actors.admin.authUserId]);
      await database.query("set local role authenticated");
      for (const [sql, values] of [
        ["insert into public.pcb_bom_versions (pcb_card_id, version_number, created_by_user_id) values ($1, 2, $2)", [cardId, actorId]],
        ["update public.pcb_bom_versions set is_active = false where id = $1", [versionId]],
        ["delete from public.pcb_bom_versions where id = $1", [versionId]],
        ["insert into public.pcb_bom_items (bom_version_id, component_product_id, quantity_per_card) values ($1, $2, 1)", [versionId, inputId]],
        ["update public.pcb_bom_items set quantity_per_card = 3 where id = $1", [itemId]],
        ["delete from public.pcb_bom_items where id = $1", [itemId]],
      ] as const) {
        await database.query("savepoint denied_bom_write");
        await expect(database.query(sql, [...values])).rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint denied_bom_write");
      }
      await database.query("reset role");

      const security = await database.query<{
        relname: string;
        relrowsecurity: boolean;
        select_allowed: boolean;
        insert_allowed: boolean;
        update_allowed: boolean;
        delete_allowed: boolean;
      }>(
        `select c.relname, c.relrowsecurity,
          pg_catalog.has_table_privilege('authenticated', c.oid, 'select') as select_allowed,
          pg_catalog.has_table_privilege('authenticated', c.oid, 'insert') as insert_allowed,
          pg_catalog.has_table_privilege('authenticated', c.oid, 'update') as update_allowed,
          pg_catalog.has_table_privilege('authenticated', c.oid, 'delete') as delete_allowed
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname in ('pcb_bom_versions', 'pcb_bom_items')
         order by c.relname`,
      );
      expect(security.rows).toEqual([
        { relname: "pcb_bom_items", relrowsecurity: true, select_allowed: true,
          insert_allowed: false, update_allowed: false, delete_allowed: false },
        { relname: "pcb_bom_versions", relrowsecurity: true, select_allowed: true,
          insert_allowed: false, update_allowed: false, delete_allowed: false },
      ]);
      const helperGrants = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        settings: string[];
      }>(
        `select pg_catalog.has_function_privilege('anon', p.oid, 'execute') as anonymous_execute,
                pg_catalog.has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
                p.proconfig as settings
         from pg_catalog.pg_proc p
         where p.oid in (
           'public.enforce_pcb_bom_item_product()'::pg_catalog.regprocedure,
           'public.enforce_pcb_bom_version_card_identity()'::pg_catalog.regprocedure
         )`,
      );
      expect(helperGrants.rows).toHaveLength(2);
      expect(helperGrants.rows.every((row) =>
        !row.anonymous_execute && !row.authenticated_execute &&
        row.settings.includes('search_path=""'))).toBe(true);
    });
  });

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
      expect(unsupportedObjects.rows).toEqual([{ bom_tables: 2, mutation_functions: 0 }]);
    });
  });

}
