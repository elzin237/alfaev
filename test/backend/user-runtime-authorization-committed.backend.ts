import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.TASK153_RUNTIME_E2E === "1";
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

interface WorkOrderRef {
  updatedAt: string;
  workOrderId: string;
}

interface ActivityWaitRow extends QueryResultRow {
  wait_event: string | null;
  wait_event_type: string | null;
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
    throw new Error(`Task 153 Management API request failed (${response.status})`);
  }

  return await response.json() as Result;
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
  const email = `task153.${campaignId}.${label.toLowerCase()}@example.com`;
  const password = `AlfaEV-${randomUUID()}-Aa1!`;
  const created = await authAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (created.error || !created.data.user) {
    throw new Error(`Task 153 ${label} Auth fixture creation failed`);
  }

  const profile = await pool.query<{ id: string }>(
    `insert into public.user_profiles (
       auth_user_id,
       full_name,
       email,
       birthday,
       is_admin,
       is_active,
       created_by_user_id
     )
     values ($1::uuid, $2::text, $3::text, '1990-01-01'::date,
             $4::boolean, true, $5::uuid)
     returning id`,
    [
      created.data.user.id,
      `Task 153 ${label} ${campaignId}`,
      email,
      isAdmin,
      createdByUserId,
    ],
  );
  const profileId = profile.rows[0]?.id;

  if (!profileId) throw new Error(`Task 153 ${label} profile creation failed`);

  if (permissions.length > 0) {
    const inserted = await pool.query(
      `insert into public.user_permissions (
         user_id,
         permission_definition_id,
         granted_by_user_id
       )
       select $1::uuid, definition.id, $2::uuid
       from public.permission_definitions as definition
       where definition.key = any($3::text[])
         and definition.is_delegable`,
      [profileId, createdByUserId, permissions],
    );

    if (inserted.rowCount !== permissions.length) {
      throw new Error(`Task 153 ${label} permission fixture is incomplete`);
    }
  }

  await pool.query(
    `insert into public.user_permission_revisions (user_id, revision, updated_at)
     values ($1::uuid, 1, pg_catalog.clock_timestamp())`,
    [profileId],
  );

  const client = createClient(
    `https://${disposableProjectRef}.supabase.co`,
    publishableKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  const signedIn = await client.auth.signInWithPassword({ email, password });

  if (signedIn.error || !signedIn.data.session) {
    throw new Error(`Task 153 ${label} sign-in failed`);
  }

  return {
    authUserId: created.data.user.id,
    client,
    profileId,
    token: signedIn.data.session.access_token,
  };
}

async function rpcOne<Row>(
  actor: Actor,
  functionName: string,
  parameters: Record<string, unknown> = {},
): Promise<Row> {
  const result = await actor.client.rpc(functionName, parameters);

  if (result.error) {
    throw new Error(`${functionName} failed (${result.error.code})`);
  }

  const row = Array.isArray(result.data) ? result.data[0] : result.data;

  if (row === undefined || row === null) {
    throw new Error(`${functionName} returned no value`);
  }

  return row as Row;
}

async function createDraft(admin: Actor, pool: Pool): Promise<WorkOrderRef> {
  const created = await rpcOne<{ work_order_id: string }>(
    admin,
    "create_draft_work_order",
  );
  const row = await pool.query<{ updated_at: string }>(
    `select updated_at::text as updated_at
     from public.work_orders
     where id = $1::uuid`,
    [created.work_order_id],
  );
  const updatedAt = row.rows[0]?.updated_at;

  if (!updatedAt) throw new Error("Task 153 Draft timestamp is unavailable");

  return { updatedAt, workOrderId: created.work_order_id };
}

async function permissionRevision(pool: Pool, profileId: string): Promise<string> {
  const result = await pool.query<{ revision: string }>(
    `select revision::text as revision
     from public.user_permission_revisions
     where user_id = $1::uuid`,
    [profileId],
  );
  const revision = result.rows[0]?.revision;

  if (!revision) throw new Error("Task 153 permission revision is unavailable");
  return revision;
}

async function setPermission(
  admin: Actor,
  target: Actor,
  permissionKey: string,
  granted: boolean,
): Promise<void> {
  const result = await admin.client.rpc("set_user_permission_admin", {
    p_user_id: target.profileId,
    p_permission_key: permissionKey,
    p_granted: granted,
  });

  if (result.error) {
    throw new Error(`Task 153 permission change failed (${result.error.code})`);
  }
}

async function expectSessionUnchanged(actor: Actor): Promise<void> {
  const session = await actor.client.auth.getSession();

  expect(session.error).toBeNull();
  expect(session.data.session?.access_token).toBe(actor.token);
}

async function setDatabaseActor(database: PoolClient, actor: Actor): Promise<void> {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor.authUserId],
  );
  await database.query("set local role authenticated");
}

describe.skipIf(!enabled)(
  "Task 153 committed user runtime authorization E2E on disposable Supabase",
  () => {
    let accessToken = "";
    let admin: Actor;
    let adminToDemote: Actor;
    let authAdmin: SupabaseClient;
    let negative: Actor;
    let pool: Pool;
    let publishableKey = "";
    let target: Actor;
    const campaignId = randomUUID();

    beforeAll(async () => {
      if (resolve(process.cwd()) !== "/Users/test/Desktop/internal-tool") {
        throw new Error("Task 153 committed runner repository mismatch");
      }

      const requestedRef = process.env.TASK153_PROJECT_REF;

      if (requestedRef === sharedDevelopmentRef) {
        throw new Error("Task 153 refuses the shared development project");
      }
      if (requestedRef !== disposableProjectRef) {
        throw new Error("Task 153 target is not the approved disposable project");
      }

      accessToken = (
        process.env.SUPABASE_ACCESS_TOKEN
        ?? await readFile(join(homedir(), ".supabase", "access-token"), "utf8")
      ).trim();
      const project = await managementRequest<{
        id: string;
        name: string;
        status: string;
      }>(accessToken, `/v1/projects/${disposableProjectRef}`);

      if (
        project.id !== disposableProjectRef
        || project.name !== disposableProjectName
        || project.status !== "ACTIVE_HEALTHY"
      ) {
        throw new Error("Task 153 disposable project identity mismatch");
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
      const pooler = poolers.find((candidate) =>
        candidate.database_type === "PRIMARY"
      );
      const serviceKey = apiKeys.find((candidate) =>
        candidate.type === "secret"
      )?.api_key;
      publishableKey = apiKeys.find((candidate) =>
        candidate.type === "publishable"
      )?.api_key ?? "";

      if (
        !pooler
        || !serviceKey?.startsWith("sb_secret_")
        || !publishableKey.startsWith("sb_publishable_")
      ) {
        throw new Error("Task 153 disposable connection material unavailable");
      }

      const databaseUrl = new URL(
        "postgresql://placeholder:placeholder@localhost/postgres",
      );
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
      await Promise.all(initialized.map((database) =>
        database.query("set role postgres")
      ));
      initialized.forEach((database) => database.release());

      const localVersions = (
        await readdir(resolve(process.cwd(), "supabase/migrations"))
      )
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
        throw new Error("Task 153 disposable migration parity mismatch");
      }

      authAdmin = createClient(
        `https://${disposableProjectRef}.supabase.co`,
        serviceKey,
        {
          auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false,
          },
        },
      );
      admin = await createActor(
        pool,
        authAdmin,
        publishableKey,
        campaignId,
        "Admin",
        null,
        [],
        true,
      );
      target = await createActor(
        pool,
        authAdmin,
        publishableKey,
        campaignId,
        "Target",
        admin.profileId,
        [
          "projects.view",
          "work_orders.view",
          "work_orders.edit_draft",
          "dashboard.view",
          "archive.view",
          "inventory.view",
        ],
      );
      negative = await createActor(
        pool,
        authAdmin,
        publishableKey,
        campaignId,
        "Negative",
        admin.profileId,
        [],
      );
      adminToDemote = await createActor(
        pool,
        authAdmin,
        publishableKey,
        campaignId,
        "AdminToDemote",
        admin.profileId,
        [],
        true,
      );
    }, 120_000);

    afterAll(async () => {
      if (pool) await pool.end();
    });

    it("removes stale-session authority immediately across modules and lifecycle changes", async () => {
      const projectId = await rpcOne<string>(admin, "create_project", {
        p_name: `Task 153 runtime Project ${campaignId}`,
        p_customer_name: "Task 153 runtime Customer",
        p_start_date: "2026-10-07",
        p_delivery_date: "2026-12-31",
      });
      const draft = await createDraft(admin, pool);
      const initialSave = await rpcOne<{ updated_at: string }>(
        target,
        "save_draft_work_order",
        {
          p_work_order_id: draft.workOrderId,
          p_project_id: projectId,
          p_description: "Task 153 authorized Draft",
          p_items: [],
          p_expected_updated_at: draft.updatedAt,
        },
      );

      const initialProjectRead = await target.client.from("projects")
        .select("id")
        .eq("id", projectId);
      const initialPlanningRead = await target.client.rpc(
        "get_project_planning",
        { p_project_id: projectId },
      );
      const initialWorkOrders = await target.client.rpc("list_work_orders");
      const initialDashboard = await target.client.rpc("get_dashboard_read_model");
      const initialArchive = await target.client.rpc("list_audit_log_page", {
        p_limit: 1,
      });
      const initialInventory = await target.client.from("products")
        .select("id")
        .limit(1);

      expect(initialProjectRead).toMatchObject({ error: null, data: [{ id: projectId }] });
      expect(initialPlanningRead.error).toBeNull();
      expect(initialWorkOrders.error).toBeNull();
      expect(initialDashboard.error).toBeNull();
      expect(initialArchive.error).toBeNull();
      expect(initialInventory.error).toBeNull();
      await expectSessionUnchanged(target);

      const revisionBeforeProjectRevocation = await permissionRevision(
        pool,
        target.profileId,
      );
      let resolveRevisionEvent: ((revision: string) => void) | undefined;
      let rejectRevisionEvent: ((error: Error) => void) | undefined;
      const revisionEvent = new Promise<string>((resolveEvent, rejectEvent) => {
        resolveRevisionEvent = resolveEvent;
        rejectRevisionEvent = rejectEvent;
      });
      let resolveSubscribed: (() => void) | undefined;
      let rejectSubscribed: ((error: Error) => void) | undefined;
      const subscribed = new Promise<void>((resolveEvent, rejectEvent) => {
        resolveSubscribed = resolveEvent;
        rejectSubscribed = rejectEvent;
      });
      const revisionChannel = target.client
        .channel(`task153-revision-${campaignId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "user_permission_revisions",
            filter: `user_id=eq.${target.profileId}`,
          },
          (payload) => resolveRevisionEvent?.(String(payload.new.revision)),
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") resolveSubscribed?.();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            rejectSubscribed?.(new Error(`Task 153 Realtime ${status}`));
          }
        });
      const subscriptionTimeout = setTimeout(
        () => rejectSubscribed?.(new Error("Task 153 Realtime subscribe timeout")),
        30_000,
      );
      await subscribed;
      clearTimeout(subscriptionTimeout);

      await setPermission(admin, target, "projects.view", false);
      const revisionTimeout = setTimeout(
        () => rejectRevisionEvent?.(new Error("Task 153 revision event timeout")),
        30_000,
      );
      const observedRevision = await revisionEvent;
      clearTimeout(revisionTimeout);
      await target.client.removeChannel(revisionChannel);
      expect(BigInt(observedRevision)).toBe(
        BigInt(revisionBeforeProjectRevocation) + 1n,
      );

      const revokedProjectRead = await target.client.from("projects")
        .select("id")
        .eq("id", projectId);
      const revokedPlanningRead = await target.client.rpc(
        "get_project_planning",
        { p_project_id: projectId },
      );
      const retainedWorkOrderRead = await target.client.rpc("list_work_orders");

      expect(revokedProjectRead).toMatchObject({ error: null, data: [] });
      expect(revokedPlanningRead.error?.code).toBe("42501");
      expect(retainedWorkOrderRead.error).toBeNull();
      await expectSessionUnchanged(target);

      const workOrderBeforeDeniedSave = (await pool.query(
        `select description, updated_at::text as updated_at,
                (select count(*)::integer from public.work_order_items
                 where work_order_id = work_order.id) as item_count,
                (select count(*)::integer from public.audit_logs
                 where entity_id = work_order.id
                   and action_type = 'work_order.updated') as update_audits
         from public.work_orders as work_order
         where work_order.id = $1::uuid`,
        [draft.workOrderId],
      )).rows[0];
      await setPermission(admin, target, "work_orders.edit_draft", false);
      const deniedSave = await target.client.rpc("save_draft_work_order", {
        p_work_order_id: draft.workOrderId,
        p_project_id: projectId,
        p_description: "Task 153 forbidden update",
        p_items: [],
        p_expected_updated_at: initialSave.updated_at,
      });
      const workOrderAfterDeniedSave = (await pool.query(
        `select description, updated_at::text as updated_at,
                (select count(*)::integer from public.work_order_items
                 where work_order_id = work_order.id) as item_count,
                (select count(*)::integer from public.audit_logs
                 where entity_id = work_order.id
                   and action_type = 'work_order.updated') as update_audits
         from public.work_orders as work_order
         where work_order.id = $1::uuid`,
        [draft.workOrderId],
      )).rows[0];

      expect(deniedSave.error?.code).toBe("42501");
      expect(workOrderAfterDeniedSave).toEqual(workOrderBeforeDeniedSave);

      await setPermission(admin, target, "archive.view", false);
      const deniedArchive = await target.client.rpc("list_audit_log_page", {
        p_limit: 1,
      });
      const auditId = (await pool.query<{ id: string }>(
        `select id from public.audit_logs
         where entity_id = $1::uuid
         order by created_at desc, id desc limit 1`,
        [draft.workOrderId],
      )).rows[0]?.id;

      if (!auditId) throw new Error("Task 153 audit fixture is unavailable");
      const deniedAuditDetail = await target.client.rpc("get_audit_log_detail", {
        p_audit_log_id: auditId,
      });
      const dashboardWithoutArchive = await target.client.rpc(
        "get_dashboard_read_model",
      );

      expect(deniedArchive.error?.code).toBe("42501");
      expect(deniedAuditDetail.error?.code).toBe("42501");
      expect(dashboardWithoutArchive.error).toBeNull();
      expect(dashboardWithoutArchive.data).toMatchObject({ activity: null });

      await setPermission(admin, target, "dashboard.view", false);
      const deniedDashboard = await target.client.rpc("get_dashboard_read_model");

      expect(deniedDashboard.error?.code).toBe("42501");
      await expectSessionUnchanged(target);

      const revisionBeforeDeactivation = await permissionRevision(pool, target.profileId);
      const deactivated = await admin.client.rpc("set_user_active_state_admin", {
        p_user_id: target.profileId,
        p_is_active: false,
      });

      expect(deactivated.error).toBeNull();
      expect(await permissionRevision(pool, target.profileId))
        .toBe(revisionBeforeDeactivation);
      await expectSessionUnchanged(target);

      const inactiveProfile = await target.client.from("user_profiles")
        .select("id,is_active")
        .eq("id", target.profileId);
      const inactiveProjects = await target.client.from("projects")
        .select("id")
        .limit(1);
      const inactiveProducts = await target.client.from("products")
        .select("id")
        .limit(1);
      const inactiveWorkOrders = await target.client.rpc("list_work_orders");
      const inactiveDashboard = await target.client.rpc("get_dashboard_read_model");
      const inactiveArchive = await target.client.rpc("list_audit_log_page", {
        p_limit: 1,
      });
      const inactivePermission = await target.client.rpc("has_permission", {
        permission_key: "work_orders.view",
      });
      const inactiveSave = await target.client.rpc("save_draft_work_order", {
        p_work_order_id: draft.workOrderId,
        p_project_id: projectId,
        p_description: "Task 153 inactive forbidden update",
        p_items: [],
        p_expected_updated_at: initialSave.updated_at,
      });

      expect(inactiveProfile).toMatchObject({
        error: null,
        data: [{ id: target.profileId, is_active: false }],
      });
      expect(inactiveProjects).toMatchObject({ error: null, data: [] });
      expect(inactiveProducts).toMatchObject({ error: null, data: [] });
      expect(inactiveWorkOrders.error?.code).toBe("42501");
      expect(inactiveDashboard.error?.code).toBe("42501");
      expect(inactiveArchive.error?.code).toBe("42501");
      expect(inactivePermission).toMatchObject({ error: null, data: false });
      expect(inactiveSave.error?.code).toBe("42501");
      expect((await pool.query(
        `select description, updated_at::text as updated_at,
                (select count(*)::integer from public.work_order_items
                 where work_order_id = work_order.id) as item_count,
                (select count(*)::integer from public.audit_logs
                 where entity_id = work_order.id
                   and action_type = 'work_order.updated') as update_audits
         from public.work_orders as work_order
         where work_order.id = $1::uuid`,
        [draft.workOrderId],
      )).rows[0]).toEqual(workOrderBeforeDeniedSave);

      const reactivated = await admin.client.rpc("set_user_active_state_admin", {
        p_user_id: target.profileId,
        p_is_active: true,
      });

      expect(reactivated.error).toBeNull();
      expect(await permissionRevision(pool, target.profileId))
        .toBe(revisionBeforeDeactivation);
      await expectSessionUnchanged(target);

      const reactivatedWorkOrders = await target.client.rpc("list_work_orders");
      const reactivatedInventory = await target.client.from("products")
        .select("id")
        .limit(1);
      const stillRevokedProjects = await target.client.from("projects")
        .select("id")
        .eq("id", projectId);
      const stillRevokedPermissions = await Promise.all([
        "projects.view",
        "work_orders.edit_draft",
        "dashboard.view",
        "archive.view",
      ].map((permissionKey) =>
        target.client.rpc("has_permission", { permission_key: permissionKey })
      ));

      expect(reactivatedWorkOrders.error).toBeNull();
      expect(reactivatedInventory.error).toBeNull();
      expect(stillRevokedProjects).toMatchObject({ error: null, data: [] });
      expect(stillRevokedPermissions.every((result) =>
        result.error === null && result.data === false
      )).toBe(true);

      const negativeChecks = await Promise.all([
        negative.client.from("projects").select("id").limit(1),
        negative.client.rpc("list_work_orders"),
        negative.client.rpc("get_dashboard_read_model"),
        negative.client.rpc("list_audit_log_page", { p_limit: 1 }),
      ]);

      expect(negativeChecks[0]).toMatchObject({ error: null, data: [] });
      for (const result of negativeChecks.slice(1)) {
        expect(result.error?.code).toBe("42501");
      }

      const adminReadBeforeDemotion = await adminToDemote.client.rpc(
        "list_users_admin",
      );
      const demotion = await admin.client.rpc("set_user_admin_status_admin", {
        p_user_id: adminToDemote.profileId,
        p_is_admin: false,
      });
      const demotedUserRead = await adminToDemote.client.rpc("list_users_admin");
      const demotedPermissionWrite = await adminToDemote.client.rpc(
        "set_user_permission_admin",
        {
          p_user_id: negative.profileId,
          p_permission_key: "projects.view",
          p_granted: true,
        },
      );
      const demotedActiveWrite = await adminToDemote.client.rpc(
        "set_user_active_state_admin",
        { p_user_id: negative.profileId, p_is_active: false },
      );
      const demotedProfile = await adminToDemote.client.from("user_profiles")
        .select("is_admin,is_active")
        .eq("id", adminToDemote.profileId)
        .single();

      expect(adminReadBeforeDemotion.error).toBeNull();
      expect(demotion.error).toBeNull();
      expect(demotedUserRead.error?.code).toBe("42501");
      expect(demotedPermissionWrite.error?.code).toBe("42501");
      expect(demotedActiveWrite.error?.code).toBe("42501");
      expect(demotedProfile).toMatchObject({
        error: null,
        data: { is_admin: false, is_active: true },
      });
      await expectSessionUnchanged(adminToDemote);

      await setPermission(admin, target, "work_orders.edit_draft", true);
      const raceDraft = await createDraft(admin, pool);
      const applicationName = `alfaev-task153-wait-${campaignId}`;

      const clients = await Promise.all([
        pool.connect(),
        pool.connect(),
        pool.connect(),
      ]);
      const lockHolder = clients[0];
      const waitingActor = clients[1];
      const observer = clients[2];

      if (!lockHolder || !waitingActor || !observer) {
        throw new Error("Task 153 concurrency clients are unavailable");
      }

      try {
        await lockHolder.query("set role postgres");
        await waitingActor.query("set role postgres");
        await observer.query("set role postgres");
        await lockHolder.query("begin");
        await lockHolder.query(
          "select id from public.work_orders where id = $1::uuid for update",
          [raceDraft.workOrderId],
        );
        await waitingActor.query("begin");
        await waitingActor.query(
          "select pg_catalog.set_config('application_name', $1::text, true)",
          [applicationName],
        );
        await setDatabaseActor(waitingActor, target);
        const waitingSave = waitingActor.query(
          `select * from public.save_draft_work_order(
             $1::uuid, null, 'Task 153 waiting mutation', '[]'::jsonb,
             $2::timestamptz
           )`,
          [raceDraft.workOrderId, raceDraft.updatedAt],
        ).then(
          () => null,
          (error: unknown) => error,
        );
        let observedWait = false;

        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = await observer.query<ActivityWaitRow>(
            `select wait_event_type, wait_event
             from pg_catalog.pg_stat_activity
             where application_name = $1::text`,
            [applicationName],
          );
          const waiting = activity.rows[0];

          if (waiting?.wait_event_type === "Lock") {
            observedWait = true;
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        expect(observedWait).toBe(true);
        await setPermission(admin, target, "work_orders.edit_draft", false);
        await lockHolder.query("commit");
        expect(await waitingSave).toMatchObject({ code: "42501" });
        await waitingActor.query("rollback");
      } finally {
        await lockHolder.query("rollback").catch(() => undefined);
        await waitingActor.query("rollback").catch(() => undefined);
        lockHolder.release();
        waitingActor.release();
        observer.release();
      }

      expect((await pool.query(
        `select description,
                (select count(*)::integer from public.work_order_items
                 where work_order_id = work_order.id) as item_count,
                (select count(*)::integer from public.audit_logs
                 where entity_id = work_order.id
                   and action_type = 'work_order.updated') as update_audits
         from public.work_orders as work_order
         where work_order.id = $1::uuid`,
        [raceDraft.workOrderId],
      )).rows).toEqual([{
        description: null,
        item_count: 0,
        update_audits: 0,
      }]);

      const authorityHistory = await pool.query<{
        action_type: string;
        actor_user_id: string;
        entity_id: string;
      }>(
        `select action_type, actor_user_id, entity_id
         from public.audit_logs
         where (entity_id = $1::uuid and action_type in (
                  'permission.granted',
                  'permission.revoked',
                  'user.deactivated',
                  'user.reactivated'
                ))
            or (entity_id = $2::uuid
                and action_type = 'user.demoted_from_admin')
         order by created_at, id`,
        [target.profileId, adminToDemote.profileId],
      );

      expect(authorityHistory.rows.every((row) =>
        row.actor_user_id === admin.profileId
      )).toBe(true);
      expect(authorityHistory.rows.every((row) =>
        row.entity_id === target.profileId
        || row.entity_id === adminToDemote.profileId
      )).toBe(true);
      expect(authorityHistory.rows.map((row) => row.action_type)).toEqual(
        expect.arrayContaining([
          "permission.granted",
          "permission.revoked",
          "user.deactivated",
          "user.reactivated",
          "user.demoted_from_admin",
        ]),
      );
      expect(await permissionRevision(pool, target.profileId)).toBe("7");
    }, 180_000);
  },
);
