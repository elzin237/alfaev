import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.TASK152_COMMITTED_E2E === "1";
const disposableProjectRef = "tkzlbxyjbnntrgohpedd";
const disposableProjectName = "alfaev-inventory-concurrency-test";
const sharedDevelopmentRef = "yzysgbrpbhiapalgetau";
const expectedLatestMigration = "20261005120000";
const expectedMigrationCount = 111;

interface ApiKeyRow {
  api_key: string;
  type: "legacy" | "publishable" | "secret";
}

interface PoolerConfig {
  database_type: string;
  db_host: string;
  db_name: string;
}

interface LoginRole {
  password: string;
  role: string;
}

interface Actor {
  authUserId: string;
  client: SupabaseClient;
  profileId: string;
  token: string;
}

interface ProductRef {
  productId: string;
  serialNumber: string;
}

interface WorkOrderRef {
  workOrderId: string;
  workOrderNumber: string;
}

interface EdgeResult {
  finishedAt: string;
  projectCompleted: boolean;
  projectId: string;
  storageReference: string;
  workOrderId: string;
  workOrderNumber: string;
  workOrderPdfId: string;
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
    throw new Error(`Task 152 Management API request failed (${response.status})`);
  }
  return await response.json() as Result;
}

async function rpcOne<Row>(
  actor: Actor,
  functionName: string,
  parameters: Record<string, unknown> = {},
): Promise<Row> {
  const { data, error } = await actor.client.rpc(functionName, parameters);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (row === undefined || row === null) {
    throw new Error(`Task 152 ${functionName} returned no result`);
  }
  return row as Row;
}

async function createActor(
  pool: Pool,
  authAdmin: SupabaseClient,
  publishableKey: string,
  campaignId: string,
  label: string,
  createdByUserId: string | null,
  permissions: readonly string[],
  isAdmin = false,
): Promise<Actor> {
  const email = `alfaev.task152.${campaignId}.${label}@example.com`;
  const password = `AlfaEV-${randomUUID()}-Aa1!`;
  const { data, error } = await authAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Task 152 ${label} Auth creation failed`);
  }
  const profileId = (await pool.query<{ id: string }>(
    `insert into public.user_profiles (
       auth_user_id, full_name, email, birthday, is_admin, is_active,
       created_by_user_id
     ) values (
       $1::uuid, $2::text, $3::text, '1990-01-01'::date,
       $4::boolean, true, $5::uuid
     ) returning id`,
    [
      data.user.id,
      `Task 152 Disposable ${label}`,
      email,
      isAdmin,
      createdByUserId,
    ],
  )).rows[0]?.id;
  if (!profileId) throw new Error(`Task 152 ${label} Profile creation failed`);
  if (permissions.length > 0) {
    await pool.query(
      `insert into public.user_permissions (
         user_id, permission_definition_id, granted_by_user_id
       )
       select $1::uuid, definition.id, $2::uuid
       from public.permission_definitions as definition
       where definition.key = any($3::text[])`,
      [profileId, createdByUserId, permissions],
    );
  }
  const client = createClient(
    `https://${disposableProjectRef}.supabase.co`,
    publishableKey,
    { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } },
  );
  const signedIn = await client.auth.signInWithPassword({ email, password });
  const token = signedIn.data.session?.access_token;
  if (signedIn.error || !token) {
    throw new Error(`Task 152 ${label} sign-in failed`);
  }
  return { authUserId: data.user.id, client, profileId, token };
}

async function createProduct(admin: Actor, name: string): Promise<ProductRef> {
  const row = await rpcOne<{ product_id: string; serial_number: string }>(
    admin,
    "create_product",
    { p_name: name, p_category: "Task 152 committed", p_brand_id: null },
  );
  return { productId: row.product_id, serialNumber: row.serial_number };
}

async function createDraft(creator: Actor): Promise<WorkOrderRef> {
  const row = await rpcOne<{
    work_order_id: string;
    work_order_number: string;
  }>(creator, "create_draft_work_order");
  return { workOrderId: row.work_order_id, workOrderNumber: row.work_order_number };
}

async function expectPgCode(
  database: PoolClient,
  operation: () => Promise<unknown>,
  code: string,
): Promise<void> {
  await database.query("begin");
  try {
    await expect(operation()).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback");
  }
}

describe.skipIf(!enabled)(
  "Task 152 committed Project to Work Order to PDF E2E on disposable Supabase",
  () => {
    let accessToken = "";
    let admin: Actor;
    let authAdmin: SupabaseClient;
    let creator: Actor;
    let editor: Actor;
    let finisher: Actor;
    let negative: Actor;
    let pool: Pool;
    let publishableKey = "";
    let service: SupabaseClient;
    let viewer: Actor;
    const campaignId = randomUUID();

    beforeAll(async () => {
      if (resolve(process.cwd()) !== "/Users/test/Desktop/internal-tool") {
        throw new Error("Task 152 committed runner repository mismatch");
      }
      const requestedRef = process.env.TASK152_PROJECT_REF;
      if (requestedRef === sharedDevelopmentRef) {
        throw new Error("Task 152 refuses the shared development project");
      }
      if (requestedRef !== disposableProjectRef) {
        throw new Error("Task 152 target is not the approved disposable project");
      }
      accessToken = (
        process.env.SUPABASE_ACCESS_TOKEN
        ?? await readFile(join(homedir(), ".supabase", "access-token"), "utf8")
      ).trim();
      const project = await managementRequest<{ id: string; name: string; status: string }>(
        accessToken,
        `/v1/projects/${disposableProjectRef}`,
      );
      if (
        project.id !== disposableProjectRef
        || project.name !== disposableProjectName
        || project.status !== "ACTIVE_HEALTHY"
      ) {
        throw new Error("Task 152 disposable project identity mismatch");
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
      const serviceKey = apiKeys.find((candidate) => candidate.type === "secret")?.api_key;
      publishableKey = apiKeys.find((candidate) => candidate.type === "publishable")?.api_key ?? "";
      if (
        !pooler
        || !serviceKey?.startsWith("sb_secret_")
        || !publishableKey.startsWith("sb_publishable_")
      ) {
        throw new Error("Task 152 disposable connection material unavailable");
      }
      const databaseUrl = new URL("postgresql://placeholder:placeholder@localhost/postgres");
      databaseUrl.hostname = pooler.db_host;
      databaseUrl.port = "5432";
      databaseUrl.pathname = `/${pooler.db_name}`;
      databaseUrl.username = `${login.role}.${disposableProjectRef}`;
      databaseUrl.password = login.password;
      pool = new Pool({
        connectionString: databaseUrl.toString(),
        max: 5,
        ssl: { rejectUnauthorized: false },
      });
      const initialized = await Promise.all(
        Array.from({ length: 5 }, () => pool.connect()),
      );
      await Promise.all(initialized.map((database) => database.query("set role postgres")));
      initialized.forEach((database) => database.release());

      const localVersions = (await readdir(resolve(process.cwd(), "supabase/migrations")))
        .filter((name) => name.endsWith(".sql"))
        .map((name) => name.split("_")[0]!)
        .sort();
      const remoteVersions = (await pool.query<{ version: string }>(
        "select version from supabase_migrations.schema_migrations order by version",
      )).rows.map((row) => row.version);
      if (
        localVersions.length !== expectedMigrationCount
        || remoteVersions.length !== expectedMigrationCount
        || localVersions[localVersions.length - 1] !== expectedLatestMigration
        || JSON.stringify(localVersions) !== JSON.stringify(remoteVersions)
      ) {
        throw new Error("Task 152 disposable migration parity mismatch");
      }

      service = createClient(
        `https://${disposableProjectRef}.supabase.co`,
        serviceKey,
        { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } },
      );
      authAdmin = service;
      admin = await createActor(
        pool, authAdmin, publishableKey, campaignId, "Admin", null, [], true,
      );
      creator = await createActor(
        pool, authAdmin, publishableKey, campaignId, "Creator", admin.profileId,
        ["work_orders.create"],
      );
      editor = await createActor(
        pool, authAdmin, publishableKey, campaignId, "Editor", admin.profileId,
        ["work_orders.edit_draft"],
      );
      finisher = await createActor(
        pool, authAdmin, publishableKey, campaignId, "Finisher", admin.profileId,
        ["work_orders.finish"],
      );
      viewer = await createActor(
        pool, authAdmin, publishableKey, campaignId, "Viewer", admin.profileId,
        ["work_orders.view", "projects.view", "archive.view"],
      );
      negative = await createActor(
        pool, authAdmin, publishableKey, campaignId, "Negative", admin.profileId, [],
      );
    }, 120_000);

    afterAll(async () => {
      if (pool) await pool.end();
    });

    it("commits the real authenticated Edge, PDF Storage, Inventory, Project, and Archive lifecycle", async () => {
      const projectName = `Task 152 committed Project ${campaignId}`;
      const projectId = await rpcOne<string>(admin, "create_project", {
        p_name: projectName,
        p_customer_name: "Task 152 committed Customer",
        p_start_date: "2026-10-06",
        p_delivery_date: "2026-12-18",
      });
      const productA = await createProduct(admin, `Task 152 committed A ${campaignId}`);
      const productB = await createProduct(admin, `Task 152 committed B ${campaignId}`);
      const productC = await createProduct(admin, `Task 152 committed C ${campaignId}`);
      const projectProductId = await rpcOne<string>(admin, "create_project_product", {
        p_project_id: projectId,
        p_name: "Task 152 planned A",
      });
      await rpcOne<string>(admin, "create_project_product_component", {
        p_project_product_id: projectProductId,
        p_product_id: productA.productId,
        p_required_quantity: "5",
      });
      for (const [product, quantity] of [
        [productA, "20"], [productB, "15"], [productC, "5"],
      ] as const) {
        await rpcOne(admin, "manual_adjust_inventory", {
          p_product_id: product.productId,
          p_adjustment_type: "add",
          p_quantity: quantity,
          p_reason: `Task 152 committed initial ${product.serialNumber}`,
        });
      }

      const workOrder = await createDraft(creator);
      const created = (await pool.query<{ updated_at: string }>(
        "select updated_at::text as updated_at from public.work_orders where id = $1::uuid",
        [workOrder.workOrderId],
      )).rows[0]!.updated_at;
      const items = [
        { product_id: productA.productId, quantity: "8" },
        { product_id: productB.productId, quantity: "3" },
        { product_id: productC.productId, quantity: "2" },
      ];
      const saved = await rpcOne<{ updated_at: string }>(editor, "save_draft_work_order", {
        p_work_order_id: workOrder.workOrderId,
        p_project_id: projectId,
        p_description: "Task 152 committed field work",
        p_items: items,
        p_expected_updated_at: created,
      });

      const before = (await pool.query<{
        customer_name_snapshot: string;
        finished_at: string | null;
        item_count: string;
        movements: string;
        pdfs: string;
        project_id: string;
        status: string;
      }>(
        `select work_order.status, work_order.project_id,
                work_order.customer_name_snapshot,
                work_order.finished_at::text as finished_at,
                (select count(*)::text from public.work_order_items
                 where work_order_id = work_order.id) as item_count,
                (select count(*)::text from public.work_order_pdfs
                 where work_order_id = work_order.id) as pdfs,
                (select count(*)::text from public.inventory_movements
                 where source_type = 'work_order' and source_id = work_order.id) as movements
         from public.work_orders as work_order where work_order.id = $1::uuid`,
        [workOrder.workOrderId],
      )).rows[0];
      expect(before).toEqual({
        customer_name_snapshot: "Task 152 committed Customer",
        finished_at: null,
        item_count: "3",
        movements: "0",
        pdfs: "0",
        project_id: projectId,
        status: "draft",
      });

      const callEdge = async (actor: Actor) => {
        const response = await fetch(
          `https://${disposableProjectRef}.supabase.co/functions/v1/finish-work-order`,
          {
            method: "POST",
            headers: {
              apikey: publishableKey,
              Authorization: `Bearer ${actor.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              workOrderId: workOrder.workOrderId,
              expectedUpdatedAt: saved.updated_at,
            }),
          },
        );
        return { body: await response.json() as Record<string, unknown>, status: response.status };
      };

      const denied = await callEdge(negative);
      expect(denied).toEqual({
        status: 403,
        body: {
          code: "access_denied",
          message: "You do not have permission to finish this Work Order.",
        },
      });
      expect((await pool.query<{ count: string }>(
        "select count(*)::text as count from storage.objects where name like $1::text",
        [`%/${workOrder.workOrderId}/%`],
      )).rows).toEqual([{ count: "0" }]);

      const successful = await callEdge(finisher);
      expect(successful.status).toBe(200);
      const finish = successful.body as unknown as EdgeResult;
      expect(finish).toMatchObject({
        projectCompleted: true,
        projectId,
        workOrderId: workOrder.workOrderId,
        workOrderNumber: workOrder.workOrderNumber,
      });
      expect(finish.storageReference).toMatch(
        new RegExp(`^final/${workOrder.workOrderId}/[0-9a-f-]{36}\\.pdf$`),
      );

      const storageRows = (await pool.query<{
        mimetype: string;
        name: string;
        size: string;
      }>(
        `select name, metadata->>'mimetype' as mimetype,
                metadata->>'size' as size
         from storage.objects
         where bucket_id = 'work-order-pdfs'
           and name like $1::text
         order by name`,
        [`%/${workOrder.workOrderId}/%`],
      )).rows;
      expect(storageRows).toEqual([{
        name: finish.storageReference,
        mimetype: "application/pdf",
        size: expect.stringMatching(/^[1-9][0-9]*$/),
      }]);

      const downloaded = await viewer.client.storage
        .from("work-order-pdfs")
        .download(finish.storageReference);
      expect(downloaded.error).toBeNull();
      const pdfBytes = new Uint8Array(await downloaded.data!.arrayBuffer());
      expect(pdfBytes.byteLength).toBeGreaterThan(5);
      expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe("%PDF-");
      const expectedHash = createHash("sha256").update(pdfBytes).digest("hex");
      const pdfMetadata = (await pool.query<{
        content_hash: string;
        document_version: number;
        generated_at_matches: boolean;
        generated_by_user_id: string;
        id: string;
        storage_reference: string;
      }>(
        `select id, storage_reference, document_version, content_hash,
                generated_at = $2::timestamptz as generated_at_matches,
                generated_by_user_id
         from public.work_order_pdfs where work_order_id = $1::uuid`,
        [workOrder.workOrderId, finish.finishedAt],
      )).rows[0];
      expect(pdfMetadata).toEqual({
        id: finish.workOrderPdfId,
        storage_reference: finish.storageReference,
        document_version: 1,
        content_hash: expectedHash,
        generated_at_matches: true,
        generated_by_user_id: finisher.profileId,
      });

      const movements = (await pool.query<{
        actor_user_id: string;
        product_id: string;
        project_id: string;
        quantity_after: string;
        quantity_before: string;
        quantity_delta: string;
        source_id: string;
        source_type: string;
      }>(
        `select product_id, quantity_delta::text as quantity_delta,
                quantity_before::text as quantity_before,
                quantity_after::text as quantity_after,
                source_type, source_id, project_id, actor_user_id
         from public.inventory_movements
         where source_type = 'work_order' and source_id = $1::uuid
         order by product_id`,
        [workOrder.workOrderId],
      )).rows;
      expect(movements).toHaveLength(3);
      expect(new Map(movements.map((row) => [row.product_id, row.quantity_delta])))
        .toEqual(new Map([
          [productA.productId, "-8"],
          [productB.productId, "-3"],
          [productC.productId, "-2"],
        ]));
      for (const movement of movements) {
        expect(BigInt(movement.quantity_before) + BigInt(movement.quantity_delta))
          .toBe(BigInt(movement.quantity_after));
        expect(movement).toMatchObject({
          actor_user_id: finisher.profileId,
          project_id: projectId,
          source_id: workOrder.workOrderId,
          source_type: "work_order",
        });
      }
      expect((await pool.query(
        `select product_id, quantity::text as quantity
         from public.inventory_balances
         where product_id = any($1::uuid[]) order by product_id`,
        [[productA.productId, productB.productId, productC.productId]],
      )).rows).toEqual([
        { product_id: productA.productId, quantity: "12" },
        { product_id: productB.productId, quantity: "12" },
        { product_id: productC.productId, quantity: "3" },
      ].sort((left, right) => left.product_id.localeCompare(right.product_id)));

      expect((await pool.query(
        `select status,
                completed_at = $2::timestamptz as completed_at_matches,
                updated_by_user_id
         from public.projects where id = $1::uuid`,
        [projectId, finish.finishedAt],
      )).rows).toEqual([{
        status: "completed",
        completed_at_matches: true,
        updated_by_user_id: finisher.profileId,
      }]);
      expect((await pool.query(
        `select required_quantity::text as required_quantity
         from public.project_product_components
         where project_product_id = $1::uuid`,
        [projectProductId],
      )).rows).toEqual([{ required_quantity: "5" }]);
      const usageResult = await viewer.client.rpc(
        "list_project_work_order_material_usage",
        { p_project_id: projectId },
      );
      expect(usageResult.error).toBeNull();
      expect(usageResult.data).toHaveLength(3);

      const detail = await viewer.client.rpc("get_finished_work_order_detail", {
        p_work_order_id: workOrder.workOrderId,
      });
      expect(detail.error).toBeNull();
      expect(detail.data?.[0]).toMatchObject({
        work_order_id: workOrder.workOrderId,
        work_order_number: workOrder.workOrderNumber,
        project_id: projectId,
        project_name: projectName,
        customer_name_snapshot: "Task 152 committed Customer",
        description: "Task 152 committed field work",
        finished_by_user_id: finisher.profileId,
        pdf_id: finish.workOrderPdfId,
        document_version: 1,
      });
      const readMovements = await viewer.client.rpc("list_finished_work_order_movements", {
        p_work_order_id: workOrder.workOrderId,
      });
      expect(readMovements.error).toBeNull();
      expect(readMovements.data).toHaveLength(3);
      const noView = await finisher.client.rpc("get_finished_work_order_detail", {
        p_work_order_id: workOrder.workOrderId,
      });
      expect(noView.error?.code).toBe("42501");
      expect((await finisher.client.from("work_order_pdfs")
        .select("id")
        .eq("work_order_id", workOrder.workOrderId)).data).toEqual([]);
      expect((await finisher.client.storage.from("work-order-pdfs")
        .download(finish.storageReference)).error).not.toBeNull();

      const factsBeforeRetry = (await pool.query(
        `select
           (select count(*)::integer from public.inventory_movements
            where source_type = 'work_order' and source_id = $1::uuid) as movements,
           (select count(*)::integer from public.work_order_pdfs
            where work_order_id = $1::uuid) as pdfs,
           (select count(*)::integer from public.audit_logs
            where entity_id = $1::uuid and action_type = 'work_order.finished') as audits`,
        [workOrder.workOrderId],
      )).rows[0];
      const retried = await callEdge(finisher);
      expect(retried.status).toBe(409);
      expect(retried.body.code).toBe("work_order_already_finished");
      expect((await pool.query(
        `select
           (select count(*)::integer from public.inventory_movements
            where source_type = 'work_order' and source_id = $1::uuid) as movements,
           (select count(*)::integer from public.work_order_pdfs
            where work_order_id = $1::uuid) as pdfs,
           (select count(*)::integer from public.audit_logs
            where entity_id = $1::uuid and action_type = 'work_order.finished') as audits`,
        [workOrder.workOrderId],
      )).rows[0]).toEqual(factsBeforeRetry);

      const browserOverwrite = await viewer.client.storage
        .from("work-order-pdfs")
        .upload(finish.storageReference, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });
      expect(browserOverwrite.error).not.toBeNull();
      const browserInsert = await viewer.client.storage
        .from("work-order-pdfs")
        .upload(
          `final/${workOrder.workOrderId}/${randomUUID()}.pdf`,
          pdfBytes,
          { contentType: "application/pdf", upsert: false },
        );
      expect(browserInsert.error).not.toBeNull();
      const browserDelete = await viewer.client.storage.from("work-order-pdfs")
        .remove([finish.storageReference]);
      expect(browserDelete.data ?? []).toEqual([]);
      const officialAfterDeleteAttempt = await service.storage
        .from("work-order-pdfs")
        .download(finish.storageReference);
      expect(officialAfterDeleteAttempt.error).toBeNull();
      expect(new Uint8Array(await officialAfterDeleteAttempt.data!.arrayBuffer()))
        .toEqual(pdfBytes);
      expect((await viewer.client.from("work_orders")
        .update({ description: "Forged" })
        .eq("id", workOrder.workOrderId)).error).not.toBeNull();
      expect((await viewer.client.from("work_order_items")
        .update({ quantity: "99" })
        .eq("work_order_id", workOrder.workOrderId)).error).not.toBeNull();
      expect((await viewer.client.from("work_order_pdfs")
        .update({ content_hash: null })
        .eq("work_order_id", workOrder.workOrderId)).error).not.toBeNull();

      const database = await pool.connect();
      try {
        await expectPgCode(database, () => database.query(
          "update public.work_orders set status = 'draft' where id = $1::uuid",
          [workOrder.workOrderId],
        ), "WOR02");
        await expectPgCode(database, () => database.query(
          "update public.work_orders set work_order_number = 'RN-7000-0001' where id = $1::uuid",
          [workOrder.workOrderId],
        ), "WOR02");
        await expectPgCode(database, () => database.query(
          "update public.work_order_items set quantity = quantity + 1 where work_order_id = $1::uuid",
          [workOrder.workOrderId],
        ), "WOR04");
        await expectPgCode(database, () => database.query(
          "update public.work_order_pdfs set content_hash = null where work_order_id = $1::uuid",
          [workOrder.workOrderId],
        ), "WOR09");
      } finally {
        database.release();
      }

      const flowAudits = (await pool.query<{
        action_type: string;
        actor_user_id: string;
        entity_id: string;
        id: string;
      }>(
        `select id, action_type, entity_id, actor_user_id
         from public.audit_logs
         where (entity_id = $1::uuid and action_type in ('project.created', 'project.completed'))
            or (entity_id = $2::uuid and action_type in (
              'work_order.created', 'work_order.updated', 'work_order.finished'
            ))`,
        [projectId, workOrder.workOrderId],
      )).rows;
      expect(flowAudits.map((row) => row.action_type).sort()).toEqual([
        "project.completed", "project.created", "work_order.created",
        "work_order.finished", "work_order.updated",
      ]);
      const archive = await viewer.client.rpc("list_audit_log_page", {
        p_limit: 100,
        p_entity_type: "work_order",
        p_search_text: workOrder.workOrderNumber,
      });
      expect(archive.error).toBeNull();
      expect(archive.data).toHaveLength(3);
      expect(Object.keys(archive.data![0]).sort()).toEqual([
        "action_type", "actor_full_name", "actor_user_id", "audit_log_id",
        "created_at", "entity_id", "entity_type", "summary",
      ]);
      const finishAudit = flowAudits.find((row) => row.action_type === "work_order.finished")!;
      const projectAudit = flowAudits.find((row) => row.action_type === "project.completed")!;
      expect((await rpcOne<Record<string, unknown>>(viewer, "get_audit_log_detail", {
        p_audit_log_id: finishAudit.id,
      }))).toMatchObject({
        context_kind: "work_order",
        context_id: workOrder.workOrderId,
        detail_authorized: true,
        target_view_authorized: true,
      });
      expect((await rpcOne<Record<string, unknown>>(viewer, "get_audit_log_detail", {
        p_audit_log_id: projectAudit.id,
      }))).toMatchObject({
        context_kind: "project",
        context_id: projectId,
        detail_authorized: true,
        target_view_authorized: true,
      });

      const failureProjectId = await rpcOne<string>(admin, "create_project", {
        p_name: `Task 152 rollback Project ${campaignId}`,
        p_customer_name: "Task 152 rollback Customer",
        p_start_date: "2026-10-06",
        p_delivery_date: "2026-12-18",
      });
      const failureWorkOrder = await createDraft(creator);
      const failureCreatedAt = (await pool.query<{ updated_at: string }>(
        "select updated_at::text as updated_at from public.work_orders where id = $1::uuid",
        [failureWorkOrder.workOrderId],
      )).rows[0]!.updated_at;
      const failureSaved = await rpcOne<{ updated_at: string }>(editor, "save_draft_work_order", {
        p_work_order_id: failureWorkOrder.workOrderId,
        p_project_id: failureProjectId,
        p_description: "Task 152 committed rollback proof",
        p_items: [{ product_id: productC.productId, quantity: "1" }],
        p_expected_updated_at: failureCreatedAt,
      });
      const balanceBeforeFailure = (await pool.query<{ quantity: string }>(
        "select quantity::text as quantity from public.inventory_balances where product_id = $1::uuid",
        [productC.productId],
      )).rows[0]!.quantity;
      await pool.query(
        `create function public.test_task152_committed_reject_completion_audit()
         returns trigger language plpgsql set search_path = '' as $function$
         begin
           if new.action_type = 'project.completed' then
             raise exception 'Rejected Task 152 committed completion audit'
               using errcode = '22023';
           end if;
           return new;
         end;
         $function$`,
      );
      await pool.query(
        `create trigger test_task152_committed_reject_completion_audit
         before insert on public.audit_logs for each row
         execute function public.test_task152_committed_reject_completion_audit()`,
      );
      try {
        const failureResponse = await fetch(
          `https://${disposableProjectRef}.supabase.co/functions/v1/finish-work-order`,
          {
            method: "POST",
            headers: {
              apikey: publishableKey,
              Authorization: `Bearer ${finisher.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              workOrderId: failureWorkOrder.workOrderId,
              expectedUpdatedAt: failureSaved.updated_at,
            }),
          },
        );
        expect(failureResponse.status).toBe(409);
        expect((await failureResponse.json()).code).toBe("pdf_candidate_invalid");
      } finally {
        await pool.query(
          "drop trigger test_task152_committed_reject_completion_audit on public.audit_logs",
        );
        await pool.query(
          "drop function public.test_task152_committed_reject_completion_audit()",
        );
      }
      expect((await pool.query(
        `select
           (select status from public.work_orders where id = $1::uuid) as status,
           (select status from public.projects where id = $2::uuid) as project_status,
           (select quantity::text from public.inventory_balances where product_id = $3::uuid) as balance,
           (select count(*)::integer from public.inventory_movements
            where source_type = 'work_order' and source_id = $1::uuid) as movements,
           (select count(*)::integer from public.work_order_pdfs
            where work_order_id = $1::uuid) as pdfs,
           (select count(*)::integer from public.audit_logs
            where entity_id in ($1::uuid, $2::uuid)
              and action_type in ('work_order.finished', 'project.completed')) as audits,
           (select count(*)::integer from storage.objects
            where name like $4::text) as objects`,
        [
          failureWorkOrder.workOrderId,
          failureProjectId,
          productC.productId,
          `%/${failureWorkOrder.workOrderId}/%`,
        ],
      )).rows).toEqual([{
        audits: 0,
        balance: balanceBeforeFailure,
        movements: 0,
        objects: 0,
        pdfs: 0,
        project_status: "planned",
        status: "draft",
      }]);
    }, 120_000);
  },
);
