import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertCommittedConcurrencyTarget,
  TASK148_DISPOSABLE_PROJECT_REF,
} from "./env";
import {
  assertInventorySourceInvariant,
  createSupplierSourceFixture,
  seedSupplierStockForProfile,
} from "./helpers/inventory-provenance";

const enabled = process.env.TASK148_COMMITTED_CONCURRENCY === "1";
const disposableProjectRef = TASK148_DISPOSABLE_PROJECT_REF;
const disposableProjectName = "alfaev-inventory-concurrency-test";
const pdfBytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n%%EOF\n");

interface Actor {
  authUserId: string;
  profileId: string;
}

interface GenericFixture {
  productIds: string[];
  projectId: string;
  updatedAt: string;
  workOrderId: string;
}

interface PcbFixture {
  bomVersionId: string;
  cardId: string;
  inputProductIds: string[];
  outputProductId: string;
  updatedAt: string;
  workOrderId: string;
}

interface MovementRow extends QueryResultRow {
  id: string;
  movement_type: string;
  quantity_after: string;
  quantity_before: string;
  quantity_delta: string;
  source_id: string | null;
  source_type: string | null;
}

interface OperationResult {
  code?: string;
  ok: boolean;
}

interface ApiKeyRow {
  api_key: string;
  type: "legacy" | "publishable" | "secret";
}

interface LoginRole {
  password: string;
  role: string;
}

interface PoolerConfig {
  database_type: string;
  db_host: string;
  db_name: string;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

async function managementRequest<Result>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Result> {
  const response = await fetch(`https://api.supabase.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Task 148 Management API request failed (${response.status})`);
  }
  return await response.json() as Result;
}

async function setActor(database: PoolClient, actor: Actor): Promise<void> {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor.authUserId],
  );
  await database.query("set local role authenticated");
}

async function runAuthenticated(
  pool: Pool,
  actor: Actor,
  operation: (database: PoolClient) => Promise<void>,
): Promise<OperationResult> {
  const database = await pool.connect();
  try {
    await database.query("begin");
    await setActor(database, actor);
    await operation(database);
    await database.query("commit");
    return { ok: true };
  } catch (error) {
    await database.query("rollback").catch(() => undefined);
    return { code: errorCode(error), ok: false };
  } finally {
    database.release();
  }
}

async function createProduct(
  database: PoolClient,
  actorId: string,
  quantity: string,
  kind: "component" | "pcb_finished_good" = "component",
): Promise<string> {
  const productId = randomUUID();
  await database.query(
    `insert into public.products (
       id, serial_number, name, category, product_kind,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, public.allocate_product_serial_number(), $2::text,
       'Task 148 committed', $3::text, $4::uuid, $4::uuid
     )`,
    [productId, `Task 148 committed Product ${productId}`, kind, actorId],
  );
  if (BigInt(quantity) > 0n) {
    await database.query("begin");
    await seedSupplierStockForProfile(database, actorId, productId, quantity, {
      catalogNumber: `TASK148-COMMITTED-${productId}`,
      reason: "Task 148 committed initial supplier stock",
    });
    await database.query("commit");
  }
  return productId;
}

async function nextWorkOrderNumber(database: PoolClient): Promise<string> {
  const number = (await database.query<{ work_order_number: string }>(
    `select 'RN-8995-' || pg_catalog.lpad(candidate::text, 4, '0') as work_order_number
     from pg_catalog.generate_series(1, 9999) as candidate
     where not exists (
       select 1 from public.work_orders as work_order
       where work_order.work_order_number =
         'RN-8995-' || pg_catalog.lpad(candidate::text, 4, '0')
     )
     order by candidate
     limit 1`,
  )).rows[0]?.work_order_number;
  if (!number) throw new Error("Task 148 committed Work Order number unavailable");
  return number;
}

async function createGenericFixture(
  database: PoolClient,
  actorId: string,
  values: {
    items: Array<{ productId: string; quantity: string }>;
  },
): Promise<GenericFixture> {
  const projectId = randomUUID();
  const workOrderId = randomUUID();
  await database.query(
    `insert into public.projects (
       id, name, customer_name, start_date, delivery_date,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, 'Task 148 committed Customer',
       '2026-10-06'::date, '2026-11-06'::date, $3::uuid, $3::uuid
     )`,
    [projectId, `Task 148 committed Project ${projectId}`, actorId],
  );
  await database.query(
    `insert into public.work_orders (
       id, work_order_number, project_id, customer_name_snapshot,
       description, created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, $3::uuid, 'Task 148 committed Customer',
       'Task 148 committed generic Finish', $4::uuid, $4::uuid
     )`,
    [workOrderId, await nextWorkOrderNumber(database), projectId, actorId],
  );
  for (const item of values.items) {
    await database.query(
      `insert into public.work_order_items (
         work_order_id, product_id, quantity, added_by_user_id
       ) values ($1::uuid, $2::uuid, $3::bigint, $4::uuid)`,
      [workOrderId, item.productId, item.quantity, actorId],
    );
  }
  const updatedAt = (await database.query<{ updated_at: string }>(
    `select updated_at::text as updated_at
     from public.work_orders where id = $1::uuid`,
    [workOrderId],
  )).rows[0]?.updated_at;
  if (!updatedAt) throw new Error("Task 148 generic timestamp unavailable");
  return {
    productIds: values.items.map((item) => item.productId),
    projectId,
    updatedAt,
    workOrderId,
  };
}

async function createPcbFixture(
  database: PoolClient,
  actorId: string,
  values: {
    bomItems: Array<{ productId: string; quantity: string }>;
    plannedQuantity?: string;
    supplemental?: Array<{ productId: string; quantity: string }>;
  },
): Promise<PcbFixture> {
  const plannedQuantity = values.plannedQuantity ?? "1";
  const outputProductId = await createProduct(
    database,
    actorId,
    "0",
    "pcb_finished_good",
  );
  const cardId = randomUUID();
  const bomVersionId = randomUUID();
  const workOrderId = randomUUID();
  await database.query(
    `insert into public.pcb_cards (
       id, name, output_product_id, created_by_user_id, updated_by_user_id
     ) values ($1::uuid, $2::text, $3::uuid, $4::uuid, $4::uuid)`,
    [cardId, `Task 148 committed PCB ${cardId}`, outputProductId, actorId],
  );
  await database.query(
    `insert into public.pcb_bom_versions (
       id, pcb_card_id, version_number, created_by_user_id
     ) values ($1::uuid, $2::uuid, 1, $3::uuid)`,
    [bomVersionId, cardId, actorId],
  );
  for (const item of values.bomItems) {
    await database.query(
      `insert into public.pcb_bom_items (
         bom_version_id, component_product_id, quantity_per_card
       ) values ($1::uuid, $2::uuid, $3::bigint)`,
      [bomVersionId, item.productId, item.quantity],
    );
  }
  await database.query(
    `insert into public.work_orders (
       id, work_order_number, project_id, customer_name_snapshot, description,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, null, null, $3::text, $4::uuid, $4::uuid
     )`,
    [
      workOrderId,
      await nextWorkOrderNumber(database),
      `PCB production — Task 148 committed ${cardId}`,
      actorId,
    ],
  );
  for (const item of values.bomItems) {
    const frozenQuantity = (
      BigInt(item.quantity) * BigInt(plannedQuantity)
    ).toString();
    await database.query(
      `insert into public.work_order_items (
         work_order_id, product_id, quantity, added_by_user_id
       ) values ($1::uuid, $2::uuid, $3::bigint, $4::uuid)`,
      [workOrderId, item.productId, frozenQuantity, actorId],
    );
  }
  await database.query(
    `insert into public.pcb_production_work_orders (
       work_order_id, pcb_card_id, bom_version_id, planned_quantity,
       creation_request_id, created_by_user_id
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid, $6::uuid)`,
    [
      workOrderId,
      cardId,
      bomVersionId,
      plannedQuantity,
      randomUUID(),
      actorId,
    ],
  );
  for (const item of values.supplemental ?? []) {
    await database.query(
      `insert into public.work_order_items (
         work_order_id, product_id, quantity, added_by_user_id, source_type
       ) values ($1::uuid, $2::uuid, $3::bigint, $4::uuid, 'manual')`,
      [workOrderId, item.productId, item.quantity, actorId],
    );
  }
  const updatedAt = (await database.query<{ updated_at: string }>(
    `select updated_at::text as updated_at
     from public.work_orders where id = $1::uuid`,
    [workOrderId],
  )).rows[0]?.updated_at;
  if (!updatedAt) throw new Error("Task 148 PCB timestamp unavailable");
  return {
    bomVersionId,
    cardId,
    inputProductIds: [...new Set([
      ...values.bomItems.map((item) => item.productId),
      ...(values.supplemental ?? []).map((item) => item.productId),
    ])],
    outputProductId,
    updatedAt,
    workOrderId,
  };
}

async function uploadPdf(
  storage: SupabaseClient,
  workOrderId: string,
): Promise<string> {
  const path = `final/${workOrderId}/${randomUUID()}.pdf`;
  const { error } = await storage.storage.from("work-order-pdfs").upload(
    path,
    pdfBytes,
    { contentType: "application/pdf", upsert: false },
  );
  if (error) throw new Error(`Task 148 PDF upload failed: ${error.message}`);
  return path;
}

async function finishGeneric(
  pool: Pool,
  actor: Actor,
  fixture: GenericFixture,
  reference: string,
): Promise<OperationResult> {
  let allocationFingerprint: string;
  try {
    allocationFingerprint = (await pool.query<{ fingerprint: string }>(
      `select public.get_work_order_source_allocation_fingerprint($1::uuid)
         as fingerprint`,
      [fixture.workOrderId],
    )).rows[0]?.fingerprint ?? "";
  } catch (error) {
    return { code: errorCode(error), ok: false };
  }
  return await runAuthenticated(pool, actor, async (database) => {
    await database.query(
      `select * from public.finish_work_order(
         $1::uuid, $2::timestamptz, $3::text, null::text, $4::text
       )`,
      [
        fixture.workOrderId,
        fixture.updatedAt,
        reference,
        allocationFingerprint,
      ],
    );
  });
}

async function finishPcb(
  pool: Pool,
  actor: Actor,
  fixture: PcbFixture,
  reference: string,
  actualGood = "1",
): Promise<OperationResult> {
  let allocationFingerprint: string;
  try {
    allocationFingerprint = (await pool.query<{ fingerprint: string }>(
      `select public.get_work_order_source_allocation_fingerprint($1::uuid)
         as fingerprint`,
      [fixture.workOrderId],
    )).rows[0]?.fingerprint ?? "";
  } catch (error) {
    return { code: errorCode(error), ok: false };
  }
  return await runAuthenticated(pool, actor, async (database) => {
    await database.query(
      `select * from public.finish_work_order(
         $1::uuid, $2::timestamptz, $3::text, null::text, $4::text, $5::text
       )`,
      [
        fixture.workOrderId,
        fixture.updatedAt,
        reference,
        allocationFingerprint,
        actualGood,
      ],
    );
  });
}

async function manualAdjust(
  pool: Pool,
  actor: Actor,
  productId: string,
  type: "add" | "correction" | "remove",
  quantity: string,
): Promise<OperationResult> {
  return await runAuthenticated(pool, actor, async (database) => {
    const currentQuantity = BigInt((await database.query<{ quantity: string }>(
      "select quantity::text as quantity from public.inventory_balances where product_id = $1::uuid",
      [productId],
    )).rows[0]?.quantity ?? "0");
    const createsStock = type === "add" ||
      (type === "correction" && BigInt(quantity) > currentQuantity);
    const source = createsStock
      ? await createSupplierSourceFixture(database, actor, productId, {
        catalogNumber: `TASK148-COMMITTED-RACE-${randomUUID()}`,
      })
      : null;
    await setActor(database, actor);
    await database.query(
      `select * from public.manual_adjust_inventory(
         $1::uuid, $2::text, $3::bigint, $4::text, $5::uuid
       )`,
      [
        productId,
        type,
        quantity,
        `Task 148 committed ${type}`,
        source?.productSupplierId ?? null,
      ],
    );
  });
}

async function movementsFor(
  pool: Pool,
  productId: string,
): Promise<MovementRow[]> {
  return (await pool.query<MovementRow>(
    `select id, movement_type, quantity_delta::text, quantity_before::text,
            quantity_after::text, source_type, source_id
     from public.inventory_movements
     where product_id = $1::uuid
       and reason is distinct from 'Task 148 committed initial supplier stock'
     order by created_at, id`,
    [productId],
  )).rows;
}

async function expectLedger(
  pool: Pool,
  productId: string,
  initialQuantity: bigint,
  expectedFinal?: bigint,
): Promise<MovementRow[]> {
  const movements = await movementsFor(pool, productId);
  let current = initialQuantity;
  for (const movement of movements) {
    expect(BigInt(movement.quantity_before)).toBe(current);
    current += BigInt(movement.quantity_delta);
    expect(BigInt(movement.quantity_after)).toBe(current);
    expect(current).toBeGreaterThanOrEqual(0n);
  }
  if (expectedFinal !== undefined) expect(current).toBe(expectedFinal);
  const balance = (await pool.query<{ quantity: string }>(
    `select quantity::text as quantity
     from public.inventory_balances where product_id = $1::uuid`,
    [productId],
  )).rows[0]?.quantity;
  expect(balance).toBe(current.toString());
  const database = await pool.connect();
  try {
    await assertInventorySourceInvariant(database, productId);
  } finally {
    database.release();
  }
  return movements;
}

async function workOrderFacts(pool: Pool, workOrderIds: string[]) {
  return (await pool.query<{
    audits: string;
    movements: string;
    pdfs: string;
    status: string;
    work_order_id: string;
  }>(
    `select
       work_order.id as work_order_id,
       work_order.status,
       (select pg_catalog.count(*)::text from public.work_order_pdfs as pdf
        where pdf.work_order_id = work_order.id) as pdfs,
       (select pg_catalog.count(*)::text from public.inventory_movements as movement
        where movement.source_type = 'work_order'
          and movement.source_id = work_order.id) as movements,
       (select pg_catalog.count(*)::text from public.audit_logs as audit
        where audit.entity_id = work_order.id
          and audit.action_type = 'work_order.finished') as audits
     from public.work_orders as work_order
     where work_order.id = any($1::uuid[])
     order by work_order.id`,
    [workOrderIds],
  )).rows;
}

describe.skipIf(!enabled)(
  "Task 148 committed Inventory concurrency on disposable Supabase",
  () => {
    let actor: Actor;
    let pool: Pool;
    let storage: SupabaseClient;

    beforeAll(async () => {
      const localTarget = process.env.SUPABASE_LOCAL_TEST === "1";
      const requestedRef = localTarget
        ? "local"
        : process.env.TASK148_PROJECT_REF ?? "";
      assertCommittedConcurrencyTarget(requestedRef, [disposableProjectRef]);
      let serviceKey: string;
      let supabaseUrl: string;
      let expectedLatest: string;
      let expectedMigrationCount: string;
      if (localTarget) {
        const databaseUrl = process.env.SUPABASE_TEST_DATABASE_URL;
        serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
        supabaseUrl = process.env.VITE_SUPABASE_URL ?? "";
        if (!databaseUrl || !serviceKey.startsWith("sb_secret_") || !supabaseUrl) {
          throw new Error("Task 148 local disposable connection material unavailable");
        }
        if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(supabaseUrl)) {
          throw new Error("Task 148 local runner is not targeting loopback Supabase");
        }
        pool = new Pool({ connectionString: databaseUrl, max: 15 });
        expectedLatest = "20261013110000";
        expectedMigrationCount = "118";
      } else {
        const accessToken = (
          process.env.SUPABASE_ACCESS_TOKEN ??
          await readFile(join(homedir(), ".supabase", "access-token"), "utf8")
        ).trim();
        const project = await managementRequest<{ id: string; name: string }>(
          accessToken,
          `/v1/projects/${disposableProjectRef}`,
        );
        if (
          project.id !== disposableProjectRef ||
          project.name !== disposableProjectName
        ) {
          throw new Error("Task 148 disposable project identity mismatch");
        }
        const [login, poolers, apiKeys] = await Promise.all([
          managementRequest<LoginRole>(
            accessToken,
            `/v1/projects/${disposableProjectRef}/cli/login-role`,
            { method: "POST", body: JSON.stringify({ read_only: false }) },
          ),
          managementRequest<PoolerConfig[]>(
            accessToken,
            `/v1/projects/${disposableProjectRef}/config/database/pooler`,
          ),
          managementRequest<ApiKeyRow[]>(
            accessToken,
            `/v1/projects/${disposableProjectRef}/api-keys?reveal=true`,
          ),
        ]);
        const pooler = poolers.find((candidate) => candidate.database_type === "PRIMARY");
        serviceKey = apiKeys.find((candidate) => candidate.type === "secret")?.api_key ?? "";
        if (!pooler || !serviceKey.startsWith("sb_secret_")) {
          throw new Error("Task 148 disposable connection material unavailable");
        }
        const databaseUrl = new URL("postgresql://placeholder:placeholder@localhost/postgres");
        databaseUrl.hostname = pooler.db_host;
        databaseUrl.port = "5432";
        databaseUrl.pathname = `/${pooler.db_name}`;
        databaseUrl.username = `${login.role}.${disposableProjectRef}`;
        databaseUrl.password = login.password;
        pool = new Pool({
          connectionString: databaseUrl.toString(),
          max: 15,
          ssl: { rejectUnauthorized: false },
        });
        supabaseUrl = `https://${disposableProjectRef}.supabase.co`;
        expectedLatest = "20261005120000";
        expectedMigrationCount = "111";
      }
      const initializedConnections = await Promise.all(
        Array.from({ length: 15 }, () => pool.connect()),
      );
      await Promise.all(initializedConnections.map((database) =>
        database.query("set role postgres")
      ));
      initializedConnections.forEach((database) => database.release());
      storage = createClient(
        supabaseUrl,
        serviceKey,
        { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } },
      );
      const campaignId = randomUUID();
      const email = `alfaev.task148.${campaignId}.admin@example.com`;
      const { data, error } = await storage.auth.admin.createUser({
        email,
        password: `AlfaEV-${randomUUID()}-Aa1!`,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error("Task 148 Auth actor creation failed");
      const profileId = (await pool.query<{ id: string }>(
        `insert into public.user_profiles (
           auth_user_id, full_name, email, birthday, is_admin, is_active,
           created_by_user_id
         ) values (
           $1::uuid, 'Task 148 Disposable Admin', $2::text, '1990-01-01',
           true, true, null
         ) returning id`,
        [data.user.id, email],
      )).rows[0]?.id;
      if (!profileId) throw new Error("Task 148 actor Profile creation failed");
      actor = { authUserId: data.user.id, profileId };

      expect((await pool.query<{
        migration_count: string;
        latest: string;
      }>(
        `select pg_catalog.count(*)::text as migration_count,
                pg_catalog.max(version) as latest
         from supabase_migrations.schema_migrations`,
      )).rows).toEqual([{
        latest: expectedLatest,
        migration_count: expectedMigrationCount,
      }]);
    }, 120_000);

    afterAll(async () => {
      if (pool) await pool.end();
    });

    it("commits exactly one of two competing generic Finishes", async () => {
      const setup = await pool.connect();
      const productId = await createProduct(setup, actor.profileId, "10");
      const first = await createGenericFixture(setup, actor.profileId, {
        items: [{ productId, quantity: "7" }],
      });
      const second = await createGenericFixture(setup, actor.profileId, {
        items: [{ productId, quantity: "7" }],
      });
      setup.release();
      const [firstReference, secondReference] = await Promise.all([
        uploadPdf(storage, first.workOrderId),
        uploadPdf(storage, second.workOrderId),
      ]);
      const results = await Promise.all([
        finishGeneric(pool, actor, first, firstReference),
        finishGeneric(pool, actor, second, secondReference),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        expect.objectContaining({ code: "IVB02" }),
      ]);
      expect(await workOrderFacts(pool, [first.workOrderId, second.workOrderId]))
        .toEqual(expect.arrayContaining([
          { audits: "1", movements: "1", pdfs: "1", status: "finished", work_order_id: expect.any(String) },
          { audits: "0", movements: "0", pdfs: "0", status: "draft", work_order_id: expect.any(String) },
        ]));
      const movements = await expectLedger(pool, productId, 10n, 3n);
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        movement_type: "work_order",
        quantity_delta: "-7",
        source_type: "work_order",
      });
    });

    it("commits one Finish when the same generic Work Order is submitted twice", async () => {
      const setup = await pool.connect();
      const productId = await createProduct(setup, actor.profileId, "10");
      const fixture = await createGenericFixture(setup, actor.profileId, {
        items: [{ productId, quantity: "7" }],
      });
      setup.release();
      const references = await Promise.all([
        uploadPdf(storage, fixture.workOrderId),
        uploadPdf(storage, fixture.workOrderId),
      ]);
      const results = await Promise.all(references.map((reference) =>
        finishGeneric(pool, actor, fixture, reference)
      ));
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        expect.objectContaining({ code: "WOR02" }),
      ]);
      expect(await workOrderFacts(pool, [fixture.workOrderId])).toEqual([{
        audits: "1",
        movements: "1",
        pdfs: "1",
        status: "finished",
        work_order_id: fixture.workOrderId,
      }]);
      expect(await expectLedger(pool, productId, 10n, 3n)).toHaveLength(1);
    });

    it("commits exactly one of two competing PCB Finishes", async () => {
      const setup = await pool.connect();
      const inputProductId = await createProduct(setup, actor.profileId, "10");
      const first = await createPcbFixture(setup, actor.profileId, {
        bomItems: [{ productId: inputProductId, quantity: "7" }],
      });
      const second = await createPcbFixture(setup, actor.profileId, {
        bomItems: [{ productId: inputProductId, quantity: "7" }],
      });
      setup.release();
      const references = await Promise.all([
        uploadPdf(storage, first.workOrderId),
        uploadPdf(storage, second.workOrderId),
      ]);
      const results = await Promise.all([
        finishPcb(pool, actor, first, references[0]!),
        finishPcb(pool, actor, second, references[1]!),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        expect.objectContaining({ code: "IVB02" }),
      ]);
      const workOrderIds = [first.workOrderId, second.workOrderId];
      expect((await pool.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.pcb_production_runs
         where work_order_id = any($1::uuid[])`,
        [workOrderIds],
      )).rows).toEqual([{ count: "1" }]);
      const facts = await workOrderFacts(pool, workOrderIds);
      expect(facts.filter((fact) => fact.status === "finished")).toHaveLength(1);
      expect(facts.filter((fact) => fact.status === "draft")).toEqual([
        expect.objectContaining({ audits: "0", movements: "0", pdfs: "0" }),
      ]);
      const movements = await expectLedger(pool, inputProductId, 10n, 3n);
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        movement_type: "pcb_production_input",
        quantity_delta: "-7",
        source_type: "pcb_production_input",
      });
      const winner = facts.find((fact) => fact.status === "finished")!;
      const winnerFixture = winner.work_order_id === first.workOrderId ? first : second;
      expect(await expectLedger(pool, winnerFixture.outputProductId, 0n, 1n)).toEqual([
        expect.objectContaining({
          movement_type: "pcb_production_output",
          quantity_delta: "1",
          source_type: "pcb_production_output",
        }),
      ]);
    });

    it("commits one Finish when the same PCB Work Order is submitted twice", async () => {
      const setup = await pool.connect();
      const inputProductId = await createProduct(setup, actor.profileId, "10");
      const fixture = await createPcbFixture(setup, actor.profileId, {
        bomItems: [{ productId: inputProductId, quantity: "7" }],
      });
      setup.release();
      const references = await Promise.all([
        uploadPdf(storage, fixture.workOrderId),
        uploadPdf(storage, fixture.workOrderId),
      ]);
      const results = await Promise.all(references.map((reference) =>
        finishPcb(pool, actor, fixture, reference, "1")
      ));
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        expect.objectContaining({ code: "WOR02" }),
      ]);
      expect((await pool.query<{ audits: string; pdfs: string; runs: string }>(
        `select
           (select pg_catalog.count(*)::text from public.pcb_production_runs
            where work_order_id = $1::uuid) as runs,
           (select pg_catalog.count(*)::text from public.work_order_pdfs
            where work_order_id = $1::uuid) as pdfs,
           (select pg_catalog.count(*)::text from public.audit_logs
            where action_type in ('work_order.finished', 'pcb_production.completed')
              and (entity_id = $1::uuid or after_data->>'work_order_id' = $1::text)) as audits`,
        [fixture.workOrderId],
      )).rows).toEqual([{ audits: "2", pdfs: "1", runs: "1" }]);
      expect(await expectLedger(pool, inputProductId, 10n, 3n)).toHaveLength(1);
      expect(await expectLedger(pool, fixture.outputProductId, 0n, 1n)).toHaveLength(1);
    });

    it("serializes competing generic and PCB Finishes on one constrained Product", async () => {
      const setup = await pool.connect();
      const productId = await createProduct(setup, actor.profileId, "10");
      const generic = await createGenericFixture(setup, actor.profileId, {
        items: [{ productId, quantity: "7" }],
      });
      const pcb = await createPcbFixture(setup, actor.profileId, {
        bomItems: [{ productId, quantity: "7" }],
      });
      setup.release();
      const [genericReference, pcbReference] = await Promise.all([
        uploadPdf(storage, generic.workOrderId),
        uploadPdf(storage, pcb.workOrderId),
      ]);
      const results = await Promise.all([
        finishGeneric(pool, actor, generic, genericReference),
        finishPcb(pool, actor, pcb, pcbReference),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        expect.objectContaining({ code: "IVB02" }),
      ]);
      expect(await expectLedger(pool, productId, 10n, 3n)).toHaveLength(1);
      const facts = await workOrderFacts(pool, [generic.workOrderId, pcb.workOrderId]);
      expect(facts.filter((fact) => fact.status === "finished")).toHaveLength(1);
      expect(facts.filter((fact) => fact.status === "draft")).toHaveLength(1);
    });

    it("serializes manual Add, Remove, and Correction with generic Finish", async () => {
      const cases = [
        { direction: null, initial: "10", quantity: "7", type: "remove" as const },
        { direction: null, initial: "5", quantity: "4", type: "add" as const },
        { direction: "up", initial: "5", quantity: "9", type: "correction" as const },
        { direction: "down", initial: "10", quantity: "4", type: "correction" as const },
      ];
      for (const testCase of cases) {
        const setup = await pool.connect();
        const productId = await createProduct(setup, actor.profileId, testCase.initial);
        const fixture = await createGenericFixture(setup, actor.profileId, {
          items: [{ productId, quantity: "7" }],
        });
        setup.release();
        const reference = await uploadPdf(storage, fixture.workOrderId);
        const [finish, adjustment] = await Promise.all([
          finishGeneric(pool, actor, fixture, reference),
          manualAdjust(pool, actor, productId, testCase.type, testCase.quantity),
        ]);
        if (testCase.type === "remove") {
          expect([finish, adjustment].filter((result) => result.ok)).toHaveLength(1);
          expect([finish, adjustment].find((result) => !result.ok)?.code).toBe("IVB02");
        } else if (testCase.type === "correction" && testCase.direction === "down") {
          expect([finish, adjustment].filter((result) => result.ok)).toHaveLength(1);
          expect(["IVB02", "IVL03"]).toContain(
            [finish, adjustment].find((result) => !result.ok)?.code,
          );
        } else {
          expect(adjustment).toEqual({ ok: true });
        }
        const movements = await expectLedger(pool, productId, BigInt(testCase.initial));
        expect(movements.filter((row) => row.movement_type === "work_order"))
          .toHaveLength(finish.ok ? 1 : 0);
        expect(movements.filter((row) => row.movement_type.startsWith("manual_")))
          .toHaveLength(adjustment.ok ? 1 : 0);
      }
    });

    it("serializes manual Add, Remove, and Correction with PCB Finish", async () => {
      const cases = [
        { direction: null, initial: "10", quantity: "7", type: "remove" as const },
        { direction: null, initial: "5", quantity: "4", type: "add" as const },
        { direction: "up", initial: "5", quantity: "9", type: "correction" as const },
        { direction: "down", initial: "10", quantity: "4", type: "correction" as const },
      ];
      for (const testCase of cases) {
        const setup = await pool.connect();
        const productId = await createProduct(setup, actor.profileId, testCase.initial);
        const fixture = await createPcbFixture(setup, actor.profileId, {
          bomItems: [{ productId, quantity: "7" }],
        });
        setup.release();
        const reference = await uploadPdf(storage, fixture.workOrderId);
        const [finish, adjustment] = await Promise.all([
          finishPcb(pool, actor, fixture, reference),
          manualAdjust(pool, actor, productId, testCase.type, testCase.quantity),
        ]);
        if (testCase.type === "remove") {
          expect([finish, adjustment].filter((result) => result.ok)).toHaveLength(1);
          expect([finish, adjustment].find((result) => !result.ok)?.code).toBe("IVB02");
        } else if (testCase.type === "correction" && testCase.direction === "down") {
          expect([finish, adjustment].filter((result) => result.ok)).toHaveLength(1);
          expect(["IVB02", "IVL03"]).toContain(
            [finish, adjustment].find((result) => !result.ok)?.code,
          );
        } else {
          expect(adjustment).toEqual({ ok: true });
        }
        const movements = await expectLedger(pool, productId, BigInt(testCase.initial));
        expect(movements.filter((row) => row.movement_type === "pcb_production_input"))
          .toHaveLength(finish.ok ? 1 : 0);
        expect(movements.filter((row) => row.movement_type.startsWith("manual_")))
          .toHaveLength(adjustment.ok ? 1 : 0);
        if (finish.ok) {
          expect(await expectLedger(pool, fixture.outputProductId, 0n, 1n)).toHaveLength(1);
        } else {
          expect(await expectLedger(pool, fixture.outputProductId, 0n, 0n)).toHaveLength(0);
        }
      }
    });

    it("commits overlapping multi-Product Finishes without deadlock", async () => {
      const setup = await pool.connect();
      const firstProductId = await createProduct(setup, actor.profileId, "10");
      const secondProductId = await createProduct(setup, actor.profileId, "10");
      const first = await createGenericFixture(setup, actor.profileId, {
        items: [
          { productId: firstProductId, quantity: "4" },
          { productId: secondProductId, quantity: "4" },
        ],
      });
      const second = await createGenericFixture(setup, actor.profileId, {
        items: [
          { productId: secondProductId, quantity: "4" },
          { productId: firstProductId, quantity: "4" },
        ],
      });
      setup.release();
      const references = await Promise.all([
        uploadPdf(storage, first.workOrderId),
        uploadPdf(storage, second.workOrderId),
      ]);
      const results = await Promise.all([
        finishGeneric(pool, actor, first, references[0]!),
        finishGeneric(pool, actor, second, references[1]!),
      ]);
      expect(results).toEqual([{ ok: true }, { ok: true }]);
      expect(await expectLedger(pool, firstProductId, 10n, 2n)).toHaveLength(2);
      expect(await expectLedger(pool, secondProductId, 10n, 2n)).toHaveLength(2);
    });

    it("commits same-Product BOM plus supplemental input only when aggregate stock suffices", async () => {
      const blockedSetup = await pool.connect();
      const blockedProductId = await createProduct(blockedSetup, actor.profileId, "6");
      const blocked = await createPcbFixture(blockedSetup, actor.profileId, {
        bomItems: [{ productId: blockedProductId, quantity: "5" }],
        supplemental: [{ productId: blockedProductId, quantity: "2" }],
      });
      blockedSetup.release();
      const blockedReference = await uploadPdf(storage, blocked.workOrderId);
      expect(await finishPcb(pool, actor, blocked, blockedReference)).toEqual({
        code: "IVB02",
        ok: false,
      });
      expect(await expectLedger(pool, blockedProductId, 6n, 6n)).toHaveLength(0);
      expect(await workOrderFacts(pool, [blocked.workOrderId])).toEqual([{
        audits: "0", movements: "0", pdfs: "0", status: "draft",
        work_order_id: blocked.workOrderId,
      }]);

      const successSetup = await pool.connect();
      const successProductId = await createProduct(successSetup, actor.profileId, "7");
      const success = await createPcbFixture(successSetup, actor.profileId, {
        bomItems: [{ productId: successProductId, quantity: "5" }],
        supplemental: [{ productId: successProductId, quantity: "2" }],
      });
      successSetup.release();
      const successReference = await uploadPdf(storage, success.workOrderId);
      expect(await finishPcb(pool, actor, success, successReference)).toEqual({ ok: true });
      const movements = await expectLedger(pool, successProductId, 7n, 0n);
      expect(movements).toEqual([expect.objectContaining({
        movement_type: "pcb_production_input",
        quantity_delta: "-7",
        quantity_before: "7",
        quantity_after: "0",
      })]);
      expect(await expectLedger(pool, success.outputProductId, 0n, 1n)).toHaveLength(1);
    });

    it("serializes actual-good output posting with manual Add, Remove, and Correction", async () => {
      const cases = [
        { expected: 9n, quantity: "4", type: "remove" as const },
        { expected: 17n, quantity: "4", type: "add" as const },
        { expected: undefined, quantity: "2", type: "correction" as const },
      ];
      for (const testCase of cases) {
        const setup = await pool.connect();
        const inputProductId = await createProduct(setup, actor.profileId, "5");
        const fixture = await createPcbFixture(setup, actor.profileId, {
          bomItems: [{ productId: inputProductId, quantity: "1" }],
          plannedQuantity: "3",
        });
        await setup.query("begin");
        await seedSupplierStockForProfile(
          setup,
          actor.profileId,
          fixture.outputProductId,
          "10",
          {
            catalogNumber: `TASK148-COMMITTED-OUTPUT-${fixture.outputProductId}`,
            reason: "Task 148 committed initial supplier stock",
          },
        );
        await setup.query("commit");
        setup.release();
        const reference = await uploadPdf(storage, fixture.workOrderId);
        const [finish, adjustment] = await Promise.all([
          finishPcb(pool, actor, fixture, reference, "3"),
          manualAdjust(
            pool,
            actor,
            fixture.outputProductId,
            testCase.type,
            testCase.quantity,
          ),
        ]);
        expect(finish).toEqual({ ok: true });
        expect(adjustment).toEqual({ ok: true });
        const movements = await expectLedger(
          pool,
          fixture.outputProductId,
          10n,
          testCase.expected,
        );
        expect(movements.filter((row) => row.movement_type === "pcb_production_output"))
          .toEqual([expect.objectContaining({ quantity_delta: "3" })]);
        expect(movements.filter((row) => row.movement_type.startsWith("manual_")))
          .toHaveLength(1);
        if (testCase.type === "correction") {
          const final = BigInt(movements[movements.length - 1]!.quantity_after);
          expect([2n, 5n]).toContain(final);
        }
      }
    });
  },
);
