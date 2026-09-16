import { randomUUID } from "node:crypto";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { PoolClient, QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PERMISSION_KEYS } from "../../app/auth/permissions";
import { loadBackendTestEnvironment } from "./env";
import {
  createSecurityFixtureHarness,
  type SecurityActor,
  type SecurityFixtureHarness,
} from "./security-fixtures";

const environment = loadBackendTestEnvironment();
let harness: SecurityFixtureHarness | undefined;

function requireHarness(): SecurityFixtureHarness {
  if (!harness) {
    throw new Error("Backend security fixture harness is not initialized");
  }

  return harness;
}

function expectPermissionDenied(error: PostgrestError | null): void {
  expect(error).not.toBeNull();
  expect(error?.code).toBe("42501");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface CreatedProfileRow {
  auth_user_id: string;
  birthday: string;
  created_by_user_id: string;
  email: string;
  full_name: string;
  id: string;
  is_active: boolean;
  is_admin: boolean;
}

interface CreatedAuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown>;
  entity_id: string;
  entity_type: string;
  metadata: Record<string, unknown>;
}

interface CreatedProfileIdRow {
  profile_id: string;
}

interface CountResultRow {
  count: number;
}

interface UpdatedProfileRow {
  birthday: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_admin: boolean;
}

interface UpdatedAuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown>;
  before_data: Record<string, unknown>;
  entity_id: string;
  metadata: Record<string, unknown>;
}

interface ActiveStateProfileRow {
  deactivated_at: Date | null;
  deactivated_by_user_id: string | null;
  is_active: boolean;
  is_admin: boolean;
}

interface ActiveStateAuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown>;
  before_data: Record<string, unknown>;
  entity_id: string;
  metadata: Record<string, unknown>;
}

interface ActivityWaitRow {
  wait_event: string | null;
  wait_event_type: string | null;
}

interface AdminStatusProfileRow {
  is_active: boolean;
  is_admin: boolean;
}

interface AdminStatusAuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown>;
  before_data: Record<string, unknown>;
  entity_id: string;
  metadata: Record<string, unknown>;
}

interface PermissionAuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown>;
  before_data: Record<string, unknown>;
  entity_id: string;
  metadata: Record<string, unknown>;
}

interface PermissionMatrixRow {
  permission_key: string;
  module: string;
  label: string;
  description: string;
  granted: boolean;
}

interface BrandRow {
  archived_at: Date | null;
  archived_by_user_id: string | null;
  created_at: Date;
  created_by_user_id: string;
  id: string;
  is_active: boolean;
  name: string;
  updated_at: Date;
  updated_by_user_id: string;
}

interface BrandAuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown> | null;
  before_data: Record<string, unknown> | null;
  entity_id: string;
  entity_type: string;
}

interface SupplierRow {
  archived_at: Date | null;
  archived_by_user_id: string | null;
  contact_email: string | null;
  contact_person_name: string | null;
  contact_phone: string | null;
  country: string;
  created_at: Date;
  created_by_user_id: string;
  id: string;
  is_active: boolean;
  name: string;
  updated_at: Date;
  updated_by_user_id: string;
}

interface SupplierAuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown> | null;
  before_data: Record<string, unknown> | null;
  entity_id: string;
  entity_type: string;
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

interface ProjectRow {
  cancelled_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  created_by_user_id: string;
  customer_name: string;
  delivery_date: string;
  id: string;
  name: string;
  start_date: string;
  status: "planned" | "in_progress" | "on_hold" | "completed" | "cancelled";
  updated_at: Date;
  updated_by_user_id: string;
}

interface ProjectAuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown> | null;
  before_data: Record<string, unknown> | null;
  entity_id: string;
  entity_type: string;
}

interface ProjectProductRow {
  created_at: Date;
  created_by_user_id: string;
  id: string;
  name: string;
  project_id: string;
  updated_at: Date;
  updated_by_user_id: string;
}

interface ProjectProductComponentRow {
  created_at: Date;
  created_by_user_id: string;
  id: string;
  product_id: string;
  project_product_id: string;
  required_quantity: string;
  updated_at: Date;
  updated_by_user_id: string;
}

async function callPlanningAs<Row extends QueryResultRow>(
  database: PoolClient,
  actor: SecurityActor | null,
  statement: string,
  values: unknown[] = [],
): Promise<Row[]> {
  await database.query("savepoint planning_actor_call");
  try {
    await database.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
      [actor?.authUserId ?? ""],
    );
    await database.query(actor ? "set local role authenticated" : "set local role anon");
    const result = await database.query<Row>(statement, values);
    await database.query("reset role");
    await database.query("release savepoint planning_actor_call");
    return result.rows;
  } catch (error) {
    await database.query("rollback to savepoint planning_actor_call");
    await database.query("release savepoint planning_actor_call");
    throw error;
  }
}

async function createPlanningRows(database: PoolClient, actorId: string): Promise<{
  projectIds: string[];
  groupIds: string[];
  productIds: string[];
}> {
  const projectIds = Array.from({ length: 5 }, () => randomUUID());
  const groupIds = projectIds.map(() => randomUUID());
  const productIds = Array.from({ length: 3 }, () => randomUUID());
  const serials = await database.query<{ serial_number: string }>(
    "select public.allocate_product_serial_number() as serial_number from pg_catalog.generate_series(1, 3)",
  );
  for (const [index, status] of [
    "planned", "in_progress", "on_hold", "completed", "cancelled",
  ].entries()) {
    await database.query(
      "insert into public.projects (id, name, customer_name, status, start_date, delivery_date, completed_at, cancelled_at, created_by_user_id, updated_by_user_id) values ($1, $2, 'Planning Customer', $3, '2026-09-01', '2026-09-30', $4, $5, $6, $6)",
      [
        projectIds[index],
        "Planning " + status + " " + randomUUID(),
        status,
        status === "completed" ? "2026-09-30T10:00:00Z" : null,
        status === "cancelled" ? "2026-09-29T10:00:00Z" : null,
        actorId,
      ],
    );
    await database.query(
      "insert into public.project_products (id, project_id, name, created_by_user_id, updated_by_user_id) values ($1, $2, $3, $4, $4)",
      [groupIds[index], projectIds[index], "Group " + index, actorId],
    );
  }
  for (const [index, productId] of productIds.entries()) {
    await database.query(
        "insert into public.products (id, serial_number, name, category, product_kind, is_active, archived_at, archived_by_user_id, created_by_user_id, updated_by_user_id) values ($1, $2, $3, 'Planning', $4, $5, $6, $7, $8, $8)",
      [
        productId,
        serials.rows[index]?.serial_number,
        index === 0 ? "Literal 100%_\\ Part" : "Planning Choice " + index,
        index === 1 ? "pcb_finished_good" : "component",
        index !== 2,
        index === 2 ? new Date() : null,
        index === 2 ? actorId : null,
        actorId,
      ],
    );
  }
  return { projectIds, groupIds, productIds };
}

interface ProcurementRequestRow {
  created_at: Date;
  created_by_user_id: string;
  delivered_quantity: string;
  id: string;
  product_id: string | null;
  requested_name: string;
  requested_quantity: string;
  resolved_at: Date | null;
  resolved_by_user_id: string | null;
  status: "active" | "partly_delivered" | "resolved";
  supplier_id: string;
  updated_at: Date;
  updated_by_user_id: string;
}

interface InventoryBalanceRow {
  product_id: string;
  quantity: string;
  updated_at: Date;
}

interface InventoryMovementRow {
  actor_user_id: string;
  created_at: Date;
  id: string;
  movement_type: string;
  product_id: string;
  project_id: string | null;
  quantity_after: string;
  quantity_before: string;
  quantity_delta: string;
  reason: string | null;
  reversal_of_movement_id: string | null;
  source_id: string | null;
  source_type: string | null;
}

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

interface AppliedInventoryDeltaRow {
  movement_id: string;
  quantity_after: string;
  quantity_before: string;
}

interface ManualInventoryAdjustmentRow {
  movement_id: string;
  quantity_after: string;
  quantity_before: string;
}

interface ProductAuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown> | null;
  before_data: Record<string, unknown> | null;
  entity_id: string;
  entity_type: string;
}

interface ProductSupplierRow {
  archived_at: Date | null;
  archived_by_user_id: string | null;
  catalog_number: string | null;
  created_at: Date;
  created_by_user_id: string;
  id: string;
  is_active: boolean;
  product_id: string;
  supplier_id: string;
  updated_at: Date;
  updated_by_user_id: string;
}

interface ProductSupplierReadRow {
  catalog_number: string | null;
  relationship_id: string;
  relationship_is_active: boolean;
  supplier_id: string;
  supplier_is_active: boolean;
  supplier_name: string;
}

interface ProductSupplierChoiceRow {
  supplier_id: string;
  supplier_name: string;
}

interface SupplierProductReadRow {
  catalog_number: string | null;
  product_id: string;
  product_is_active: boolean;
  product_name: string;
  product_serial_number: string;
  relationship_id: string;
  relationship_is_active: boolean;
}

interface SupplierProductChoiceRow {
  product_id: string;
  product_name: string;
  product_serial_number: string;
}

interface CreatedProductRow {
  product_id: string;
  serial_number: string;
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

function createTestSerialNumber(): string {
  const randomValue = Number.parseInt(
    randomUUID().replace(/-/g, "").slice(0, 12),
    16,
  ) % 10_000_000;

  return randomValue.toString().padStart(7, "0");
}

async function createProductSupplierEndpoints(
  database: PoolClient,
  actorId: string,
  options: { productActive?: boolean; supplierActive?: boolean } = {},
): Promise<{ productId: string; supplierId: string }> {
  const productId = randomUUID();
  const supplierId = randomUUID();
  const productActive = options.productActive ?? true;
  const supplierActive = options.supplierActive ?? true;

  await database.query(
    `insert into public.products (
       id,
       serial_number,
       name,
       category,
       product_kind,
       is_active,
       created_by_user_id,
       updated_by_user_id,
       archived_at,
       archived_by_user_id
     )
     values (
       $1::uuid,
       $2::text,
       $3::text,
       'Components',
       'component',
       $4::boolean,
       $5::uuid,
       $5::uuid,
       case when $4::boolean then null else pg_catalog.now() end,
       case when $4::boolean then null else $5::uuid end
     )`,
    [
      productId,
      createTestSerialNumber(),
      `ProductSupplier Endpoint ${randomUUID()}`,
      productActive,
      actorId,
    ],
  );
  await database.query(
    `insert into public.suppliers (
       id,
       name,
       country,
       is_active,
       created_by_user_id,
       updated_by_user_id,
       archived_at,
       archived_by_user_id
     )
     values (
       $1::uuid,
       $2::text,
       'Germany',
       $3::boolean,
       $4::uuid,
       $4::uuid,
       case when $3::boolean then null else pg_catalog.now() end,
       case when $3::boolean then null else $4::uuid end
     )`,
    [
      supplierId,
      `ProductSupplier Endpoint ${randomUUID()}`,
      supplierActive,
      actorId,
    ],
  );

  return { productId, supplierId };
}

function isPermissionMatrixRow(value: unknown): value is PermissionMatrixRow {
  return (
    isRecord(value) &&
    typeof value.permission_key === "string" &&
    typeof value.module === "string" &&
    typeof value.label === "string" &&
    typeof value.description === "string" &&
    typeof value.granted === "boolean"
  );
}

async function expectAdminStatus(
  client: SupabaseClient,
  expected: boolean,
): Promise<void> {
  const { data, error } = await client.rpc("current_user_is_admin");

  expect(error).toBeNull();
  expect(data).toBe(expected);
}

async function expectPermission(
  client: SupabaseClient,
  permissionKey: string,
  expected: boolean,
): Promise<void> {
  const { data, error } = await client.rpc("has_permission", {
    permission_key: permissionKey,
  });

  expect(error).toBeNull();
  expect(data).toBe(expected);
}

describe("Supabase security helpers", () => {
  beforeAll(async () => {
    harness = await createSecurityFixtureHarness(environment);
  });

  afterAll(async () => {
    if (!harness) {
      return;
    }

    const cleanup = await harness.cleanup();

    expect(cleanup).toEqual({
      auditLogsRemaining: 0,
      authUsersRemaining: 0,
      permissionRevisionsRemaining: 0,
      profilesRemaining: 0,
      permissionsRemaining: 0,
      postgresClosed: true,
    });
  });

  it("denies protected helper RPCs to anonymous callers", async () => {
    const { anonymousClient } = requireHarness();
    const activeProfile = await anonymousClient.rpc(
      "current_active_user_profile_id",
    );
    const activeStatus = await anonymousClient.rpc("is_active_user");
    const adminStatus = await anonymousClient.rpc("current_user_is_admin");
    const permissionStatus = await anonymousClient.rpc("has_permission", {
      permission_key: "projects.view",
    });

    expectPermissionDenied(activeProfile.error);
    expectPermissionDenied(activeStatus.error);
    expectPermissionDenied(adminStatus.error);
    expectPermissionDenied(permissionStatus.error);
  });

  it("gives an active Admin the Admin bypass", async () => {
    const { admin } = requireHarness().actors;

    await expectAdminStatus(admin.client, true);
    await expectPermission(admin.client, "projects.view", true);
    await expectPermission(admin.client, "unknown.permission", false);
  });

  it("honors only explicit permissions for a permitted non-admin", async () => {
    const { permitted } = requireHarness().actors;

    await expectAdminStatus(permitted.client, false);
    await expectPermission(permitted.client, "projects.view", true);
    await expectPermission(permitted.client, "projects.create", false);
  });

  it("denies permissions to an active unpermitted non-admin", async () => {
    const { unpermitted } = requireHarness().actors;

    await expectAdminStatus(unpermitted.client, false);
    await expectPermission(unpermitted.client, "projects.view", false);
  });

  it("denies application access to an inactive authenticated user", async () => {
    const fixture = requireHarness();
    const { inactive } = fixture.actors;
    const sessionResult = await inactive.client.auth.getSession();
    const activeProfile = await inactive.client.rpc(
      "current_active_user_profile_id",
    );
    const activeStatus = await inactive.client.rpc("is_active_user");
    const profileMutation = await inactive.client
      .from("user_profiles")
      .update({ full_name: "Forbidden inactive update" })
      .eq("id", inactive.profileId);
    const permissionMutation = await inactive.client
      .from("user_permissions")
      .insert({
        user_id: inactive.profileId,
        permission_definition_id:
          fixture.permissionDefinitionIds.ungranted,
        granted_by_user_id: fixture.actors.admin.profileId,
      });

    expect(sessionResult.error).toBeNull();
    expect(sessionResult.data.session).not.toBeNull();
    expect(activeProfile.error).toBeNull();
    expect(activeProfile.data).toBeNull();
    expect(activeStatus.error).toBeNull();
    expect(activeStatus.data).toBe(false);
    await expectAdminStatus(inactive.client, false);
    await expectPermission(inactive.client, "projects.view", false);
    expectPermissionDenied(profileMutation.error);
    expectPermissionDenied(permissionMutation.error);
  });

  it("allows an authenticated user to read only their own profile", async () => {
    const fixture = requireHarness();
    const actor = fixture.actors.permitted;
    const ownProfile = await actor.client
      .from("user_profiles")
      .select("id,auth_user_id,is_admin,is_active")
      .eq("id", actor.profileId)
      .single();
    const otherProfile = await actor.client
      .from("user_profiles")
      .select("id")
      .eq("id", fixture.actors.unpermitted.profileId);

    expect(ownProfile.error).toBeNull();
    expect(ownProfile.data).toEqual({
      id: actor.profileId,
      auth_user_id: actor.authUserId,
      is_admin: false,
      is_active: true,
    });
    expect(otherProfile.error).toBeNull();
    expect(otherProfile.data).toEqual([]);
  });

  it("allows an inactive authenticated user to read their own inactive profile", async () => {
    const { inactive } = requireHarness().actors;
    const ownProfile = await inactive.client
      .from("user_profiles")
      .select("id,is_active")
      .eq("id", inactive.profileId)
      .single();

    expect(ownProfile.error).toBeNull();
    expect(ownProfile.data).toEqual({
      id: inactive.profileId,
      is_active: false,
    });
  });

  it("denies anonymous profile reads", async () => {
    const profileRead = await requireHarness()
      .anonymousClient.from("user_profiles")
      .select("id")
      .limit(1);

    expectPermissionDenied(profileRead.error);
  });

  it("denies direct protected-table mutations to normal actors", async () => {
    const fixture = requireHarness();
    const client = fixture.actors.permitted.client;
    const nonexistentId = "00000000-0000-0000-0000-000000000000";
    const profileMutation = await client
      .from("user_profiles")
      .update({ is_active: false, is_admin: true })
      .eq("id", nonexistentId);
    const permissionDefinitionMutation = await client
      .from("permission_definitions")
      .update({ label: "Forbidden update" })
      .eq("id", nonexistentId);
    const permissionGrantMutation = await client
      .from("user_permissions")
      .insert({
        user_id: fixture.actors.unpermitted.profileId,
        permission_definition_id:
          fixture.permissionDefinitionIds.ungranted,
        granted_by_user_id: fixture.actors.admin.profileId,
      });
    const permissionUpdateMutation = await client
      .from("user_permissions")
      .update({ granted_by_user_id: fixture.actors.unpermitted.profileId })
      .eq("user_id", fixture.actors.permitted.profileId);
    const permissionDeleteMutation = await client
      .from("user_permissions")
      .delete()
      .eq("user_id", fixture.actors.permitted.profileId);

    expectPermissionDenied(profileMutation.error);
    expectPermissionDenied(permissionDefinitionMutation.error);
    expectPermissionDenied(permissionGrantMutation.error);
    expectPermissionDenied(permissionUpdateMutation.error);
    expectPermissionDenied(permissionDeleteMutation.error);
  });

  it("allows an active Admin to list only approved User fields", async () => {
    const fixture = requireHarness();
    const { data, error } = await fixture.actors.admin.client.rpc(
      "list_users_admin",
    );
    const rows: unknown = data;

    expect(error).toBeNull();

    if (!Array.isArray(rows) || !rows.every(isRecord)) {
      throw new Error("Admin Users RPC returned an invalid result shape");
    }

    const approvedFields = [
      "created_at",
      "email",
      "full_name",
      "id",
      "is_active",
      "is_admin",
      "last_login_at",
    ];

    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(approvedFields);
    }

    const resultIds = new Set(rows.map((row) => row.id));

    for (const actor of Object.values(fixture.actors)) {
      expect(resultIds.has(actor.profileId)).toBe(true);
    }
  });

  it("denies the Admin Users list to every non-Admin actor class", async () => {
    const fixture = requireHarness();
    const deniedClients = [
      fixture.anonymousClient,
      fixture.actors.permitted.client,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
    ];

    for (const client of deniedClients) {
      const { error } = await client.rpc("list_users_admin");

      expectPermissionDenied(error);
    }
  });

  it("allows only an active Admin to read the approved user-detail fields", async () => {
    const fixture = requireHarness();
    const { data, error } = await fixture.actors.admin.client.rpc(
      "get_user_admin",
      { p_user_id: fixture.actors.permitted.profileId },
    );
    const rows: unknown = data;

    expect(error).toBeNull();

    if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0])) {
      throw new Error("Admin user-detail RPC returned an invalid result shape");
    }

    expect(Object.keys(rows[0]).sort()).toEqual([
      "birthday",
      "created_at",
      "email",
      "full_name",
      "id",
      "is_active",
      "is_admin",
      "last_login_at",
    ]);
    expect(rows[0].id).toBe(fixture.actors.permitted.profileId);

    const identity = await fixture.actors.admin.client.rpc(
      "resolve_user_auth_identity_admin",
      { p_user_id: fixture.actors.permitted.profileId },
    );

    expect(identity.error).toBeNull();
    expect(identity.data).toEqual([
      {
        auth_user_id: fixture.actors.permitted.authUserId,
        email: await fixture.getAuthUserEmail(
          fixture.actors.permitted.authUserId,
        ),
      },
    ]);

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.permitted.client,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
    ]) {
      const denied = await client.rpc("get_user_admin", {
        p_user_id: fixture.actors.permitted.profileId,
      });

      expectPermissionDenied(denied.error);

      const deniedIdentity = await client.rpc(
        "resolve_user_auth_identity_admin",
        { p_user_id: fixture.actors.permitted.profileId },
      );

      expectPermissionDenied(deniedIdentity.error);
    }
  });

  it("updates only editable profile fields and audits meaningful changes atomically", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.permitted;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const permissionBefore = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.user_permissions
         where user_id = $1::uuid`,
        [target.profileId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const update = await database.query<CreatedProfileIdRow>(
        `select public.update_user_profile_admin(
           $1::uuid,
           $2::text,
           $3::text,
           $4::date
         ) as profile_id`,
        [
          target.profileId,
          "  Updated   Security User  ",
          await fixture.getAuthUserEmail(target.authUserId),
          "1992-05-06",
        ],
      );
      await database.query("reset role");

      const profile = await database.query<UpdatedProfileRow>(
        `select full_name, email, birthday::text, is_active, is_admin
         from public.user_profiles
         where id = $1::uuid`,
        [target.profileId],
      );
      const audit = await database.query<UpdatedAuditRow>(
        `select
           actor_user_id,
           action_type,
           entity_id,
           before_data,
           after_data,
           metadata
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'user.updated'`,
        [target.profileId],
      );
      const permissionAfter = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.user_permissions
         where user_id = $1::uuid`,
        [target.profileId],
      );

      expect(update.rows).toEqual([{ profile_id: target.profileId }]);
      expect(profile.rows).toEqual([
        {
          full_name: "Updated Security User",
          email: await fixture.getAuthUserEmail(target.authUserId),
          birthday: "1992-05-06",
          is_active: true,
          is_admin: false,
        },
      ]);
      expect(audit.rows).toEqual([
        {
          actor_user_id: fixture.actors.admin.profileId,
          action_type: "user.updated",
          entity_id: target.profileId,
          before_data: {
            full_name: "Security fixture permitted",
            email: await fixture.getAuthUserEmail(target.authUserId),
            birthday: "1990-01-01",
          },
          after_data: {
            full_name: "Updated Security User",
            email: await fixture.getAuthUserEmail(target.authUserId),
            birthday: "1992-05-06",
          },
          metadata: { source: "admin_user_profile_update" },
        },
      ]);
      expect(permissionAfter.rows).toEqual(permissionBefore.rows);
    });
  });

  it("does not create audit noise for a no-op profile update", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.unpermitted;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const before = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'user.updated'`,
        [target.profileId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query(
        `select public.update_user_profile_admin(
           $1::uuid,
           $2::text,
           $3::text,
           $4::date
         )`,
        [
          target.profileId,
          "Security fixture unpermitted",
          await fixture.getAuthUserEmail(target.authUserId),
          "1990-01-01",
        ],
      );
      await database.query("reset role");

      const after = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'user.updated'`,
        [target.profileId],
      );

      expect(after.rows).toEqual(before.rows);
    });
  });

  it("keeps Auth and UserProfile email synchronized during trusted finalization", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.unpermitted;
    const previousEmail = await fixture.getAuthUserEmail(target.authUserId);
    const updatedEmail = `alfaev.security.email-update.${randomUUID()}@example.com`;

    await fixture.updateAuthUserEmail(target.authUserId, updatedEmail);

    try {
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(
          `select public.update_user_profile_admin(
             $1::uuid,
             $2::text,
             $3::text,
             $4::date
           )`,
          [target.profileId, "Email Updated User", updatedEmail, "1990-01-01"],
        );
        await database.query("reset role");

        const synchronized = await database.query<{
          auth_email: string;
          profile_email: string;
        }>(
          `select
             pg_catalog.lower(auth.users.email) as auth_email,
             public.user_profiles.email as profile_email
           from public.user_profiles
           join auth.users
             on auth.users.id = public.user_profiles.auth_user_id
           where public.user_profiles.id = $1::uuid`,
          [target.profileId],
        );

        expect(synchronized.rows).toEqual([
          { auth_email: updatedEmail, profile_email: updatedEmail },
        ]);
      });
    } finally {
      await fixture.updateAuthUserEmail(target.authUserId, previousEmail);
    }

    expect(await fixture.getAuthUserEmail(target.authUserId)).toBe(previousEmail);
  });

  it("denies profile updates to anonymous, non-Admin, and inactive actors", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.unpermitted;
    const targetEmail = await fixture.getAuthUserEmail(target.authUserId);

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.permitted.client,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
    ]) {
      const { error } = await client.rpc("update_user_profile_admin", {
        p_user_id: target.profileId,
        p_full_name: "Forbidden Update",
        p_email: targetEmail,
        p_birthday: "1990-01-01",
      });

      expectPermissionDenied(error);
    }
  });

  it("lets an active Admin atomically finalize a profile and its audit entry", async () => {
    const fixture = requireHarness();
    const targetUser = await fixture.createTemporaryAuthUser("profile-finalization");

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");

      const creation = await database.query<CreatedProfileIdRow>(
        `select public.create_user_profile_admin(
           $1::uuid,
           $2::text,
           $3::text,
           $4::date,
           $5::boolean
         ) as profile_id`,
        [
          targetUser.authUserId,
          "  Task 032   User  ",
          targetUser.email.toUpperCase(),
          "1992-05-06",
          true,
        ],
      );

      await database.query("reset role");

      const profileId = creation.rows[0]?.profile_id;

      expect(profileId).toEqual(expect.any(String));

      const profile = await database.query<CreatedProfileRow>(
        `select
           id,
           auth_user_id,
           full_name,
           email,
           birthday::text,
           is_admin,
           is_active,
           created_by_user_id
         from public.user_profiles
         where id = $1::uuid`,
        [profileId],
      );
      const audit = await database.query<CreatedAuditRow>(
        `select
           actor_user_id,
           action_type,
           entity_type,
           entity_id,
           after_data,
           metadata
         from public.audit_logs
         where entity_id = $1::uuid`,
        [profileId],
      );
      const permissionCount = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.user_permissions
         where user_id = $1::uuid`,
        [profileId],
      );

      expect(profile.rows).toEqual([
        {
          id: profileId,
          auth_user_id: targetUser.authUserId,
          full_name: "Task 032 User",
          email: targetUser.email,
          birthday: "1992-05-06",
          is_admin: true,
          is_active: true,
          created_by_user_id: fixture.actors.admin.profileId,
        },
      ]);
      expect(audit.rows).toEqual([
        {
          actor_user_id: fixture.actors.admin.profileId,
          action_type: "user.created",
          entity_type: "user_profile",
          entity_id: profileId,
          after_data: {
            id: profileId,
            auth_user_id: targetUser.authUserId,
            full_name: "Task 032 User",
            email: targetUser.email,
            birthday: "1992-05-06",
            is_admin: true,
            is_active: true,
          },
          metadata: {
            source: "admin_invite",
          },
        },
      ]);
      expect(permissionCount.rows).toEqual([{ count: 0 }]);
    });
  });

  it("denies profile finalization to anonymous, non-Admin, and inactive actors", async () => {
    const fixture = requireHarness();
    const deniedClients = [
      fixture.anonymousClient,
      fixture.actors.permitted.client,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
    ];

    for (const client of deniedClients) {
      const { error } = await client.rpc("create_user_profile_admin", {
        p_auth_user_id: randomUUID(),
        p_full_name: "Forbidden User",
        p_email: `alfaev.security.denied.${randomUUID()}@example.com`,
        p_birthday: "1990-01-01",
        p_is_admin: false,
      });

      expectPermissionDenied(error);
    }
  });

  it("denies the invite Edge Function before non-Admin Auth user creation", async () => {
    const fixture = requireHarness();
    const deniedActors = [fixture.actors.permitted, fixture.actors.inactive];

    for (const actor of deniedActors) {
      const sessionResult = await actor.client.auth.getSession();
      const accessToken = sessionResult.data.session?.access_token;
      const invitedEmail = `alfaev.security.edge-denied.${randomUUID()}@example.com`;

      expect(sessionResult.error).toBeNull();
      expect(accessToken).toEqual(expect.any(String));

      const response = await fetch(
        `${environment.supabaseUrl}/functions/v1/admin-invite-user`,
        {
          method: "POST",
          headers: {
            apikey: environment.supabasePublishableKey,
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            fullName: "Forbidden Edge Invite",
            email: invitedEmail,
            birthday: "1990-01-01",
            isAdmin: false,
          }),
        },
      );
      const responseBody: unknown = await response.json();

      expect(response.status).toBe(403);
      expect(isRecord(responseBody) ? responseBody.code : null).toBe(
        "access_denied",
      );
      expect(await fixture.countAuthUsersByEmail(invitedEmail)).toBe(0);
    }
  });

  it("denies the profile-update Edge Function before non-Admin mutation", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.unpermitted;
    const targetEmail = await fixture.getAuthUserEmail(target.authUserId);

    for (const actor of [fixture.actors.permitted, fixture.actors.inactive]) {
      const sessionResult = await actor.client.auth.getSession();
      const accessToken = sessionResult.data.session?.access_token;

      expect(sessionResult.error).toBeNull();
      expect(accessToken).toEqual(expect.any(String));

      const response = await fetch(
        `${environment.supabaseUrl}/functions/v1/admin-update-user-profile`,
        {
          method: "POST",
          headers: {
            apikey: environment.supabasePublishableKey,
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            userId: target.profileId,
            fullName: "Forbidden Edge Update",
            email: targetEmail,
            birthday: "1990-01-01",
          }),
        },
      );
      const responseBody: unknown = await response.json();

      expect(response.status).toBe(403);
      expect(isRecord(responseBody) ? responseBody.code : null).toBe(
        "access_denied",
      );
      expect(await fixture.getAuthUserEmail(target.authUserId)).toBe(targetEmail);
    }
  });

  it("rolls Auth email back when Edge profile finalization fails", async () => {
    const fixture = requireHarness();
    const target = await fixture.createTemporaryProfile(
      "edge-rollback-target",
      undefined,
      fixture.actors.admin.profileId,
    );
    const collisionEmail =
      `alfaev.security.edge-collision.${randomUUID()}@example.com`;

    await fixture.createTemporaryProfile(
      "edge-rollback-collision",
      collisionEmail,
      fixture.actors.admin.profileId,
    );

    const sessionResult = await fixture.actors.admin.client.auth.getSession();
    const accessToken = sessionResult.data.session?.access_token;

    expect(sessionResult.error).toBeNull();
    expect(accessToken).toEqual(expect.any(String));

    const response = await fetch(
      `${environment.supabaseUrl}/functions/v1/admin-update-user-profile`,
      {
        method: "POST",
        headers: {
          apikey: environment.supabasePublishableKey,
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: target.profileId,
          fullName: "Rollback Target",
          email: collisionEmail,
          birthday: "1990-01-01",
        }),
      },
    );
    const responseBody: unknown = await response.json();

    expect(response.status).toBe(409);
    expect(isRecord(responseBody) ? responseBody.code : null).toBe(
      "user_exists",
    );
    expect(await fixture.getAuthUserEmail(target.authUserId)).toBe(target.email);

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const profile = await database.query<{ email: string; full_name: string }>(
        `select email, full_name
         from public.user_profiles
         where id = $1::uuid`,
        [target.profileId],
      );
      const audit = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'user.updated'`,
        [target.profileId],
      );

      expect(profile.rows).toEqual([
        {
          email: target.profileEmail,
          full_name: "Security fixture edge-rollback-target",
        },
      ]);
      expect(audit.rows).toEqual([{ count: 0 }]);
    });
  });

  it("denies account-state operations to anonymous, non-Admin, and inactive actors", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.unpermitted;

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.permitted.client,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
    ]) {
      const preflight = await client.rpc("preflight_user_active_state_admin", {
        p_user_id: target.profileId,
        p_is_active: false,
      });
      const mutation = await client.rpc("set_user_active_state_admin", {
        p_user_id: target.profileId,
        p_is_active: false,
      });

      expectPermissionDenied(preflight.error);
      expectPermissionDenied(mutation.error);
    }
  });

  it("blocks self-deactivation without changing the account", async () => {
    const fixture = requireHarness();
    const additionalAdmin = await fixture.createTemporaryProfile(
      "self-deactivation-continuity",
      undefined,
      fixture.actors.admin.profileId,
      { isAdmin: true },
    );
    const { error } = await fixture.actors.admin.client.rpc(
      "set_user_active_state_admin",
      {
        p_user_id: fixture.actors.admin.profileId,
        p_is_active: false,
      },
    );

    expect(error?.code).toBe("AUE01");

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const profile = await database.query<ActiveStateProfileRow>(
        `select is_active, is_admin, deactivated_at, deactivated_by_user_id
         from public.user_profiles
         where id = $1::uuid`,
        [fixture.actors.admin.profileId],
      );

      expect(profile.rows[0]?.is_active).toBe(true);
      expect(additionalAdmin.profileId).toEqual(expect.any(String));
    });
  });

  it("prevents deactivation of the last active Admin under the serialized continuity lock", async () => {
    const fixture = requireHarness();

    await expect(
      fixture.withRollbackDatabaseTransaction(async (database) => {
        await database.query(
          `update public.user_profiles
           set is_active = false
           where is_admin
             and id <> $1::uuid`,
          [fixture.actors.admin.profileId],
        );
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(
          "select public.set_user_active_state_admin($1::uuid, false)",
          [fixture.actors.admin.profileId],
        );
      }),
    ).rejects.toMatchObject({ code: "AUE02" });

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const definition = await database.query<{ definition: string }>(
        `select pg_catalog.pg_get_functiondef(
           'public.set_user_active_state_admin(uuid,boolean)'::regprocedure
         ) as definition`,
      );

      expect(definition.rows[0]?.definition).toContain(
        "pg_advisory_xact_lock",
      );
      expect(definition.rows[0]?.definition.toLowerCase()).toContain(
        "for update",
      );
    });
  });

  it("rechecks Admin authorization after a waiting continuity lock is acquired", async () => {
    const fixture = requireHarness();
    const waitingAdmin = await fixture.createTemporaryProfile(
      "waiting-admin-authorization",
      undefined,
      fixture.actors.admin.profileId,
      { isAdmin: true },
    );
    const target = fixture.actors.unpermitted;
    const applicationName = `alfaev-security-wait-${randomUUID()}`;

    await fixture.withDatabaseClients(3, async (clients) => {
      const lockHolder = clients[0];
      const waitingActor = clients[1];
      const observer = clients[2];

      if (!lockHolder || !waitingActor || !observer) {
        throw new Error("Concurrency fixture clients are unavailable");
      }

      await lockHolder.query("begin");
      await lockHolder.query(
        `select pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended(
             'alfaev.active_admin_continuity',
             0
           )
         )`,
      );
      await waitingActor.query("begin");
      await waitingActor.query(
        "select pg_catalog.set_config('application_name', $1::text, true)",
        [applicationName],
      );
      await waitingActor.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [waitingAdmin.authUserId],
      );
      await waitingActor.query("set local role authenticated");

      const waitingMutation = waitingActor
        .query(
          "select public.set_user_active_state_admin($1::uuid, false)",
          [target.profileId],
        )
        .then(
          () => null,
          (error: unknown) => error,
        );
      let observedAdvisoryWait = false;

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await observer.query<ActivityWaitRow>(
          `select wait_event_type, wait_event
           from pg_catalog.pg_stat_activity
           where application_name = $1::text`,
          [applicationName],
        );
        const waiting = activity.rows[0];

        if (
          waiting?.wait_event_type === "Lock" &&
          waiting.wait_event?.toLowerCase() === "advisory"
        ) {
          observedAdvisoryWait = true;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(observedAdvisoryWait).toBe(true);

      await lockHolder.query(
        `update public.user_profiles
         set is_active = false,
             deactivated_at = pg_catalog.now(),
             deactivated_by_user_id = $2::uuid
         where id = $1::uuid`,
        [waitingAdmin.profileId, fixture.actors.admin.profileId],
      );
      await lockHolder.query("commit");

      const mutationError = await waitingMutation;

      expect(mutationError).toMatchObject({ code: "42501" });
      await waitingActor.query("rollback");

      const targetState = await observer.query<{ is_active: boolean }>(
        `select is_active
         from public.user_profiles
         where id = $1::uuid`,
        [target.profileId],
      );
      const audit = await observer.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'user.deactivated'`,
        [target.profileId],
      );
      const definitions = await observer.query<{
        name: string;
        definition: string;
      }>(
        `select
           routine.proname as name,
           pg_catalog.pg_get_functiondef(routine.oid) as definition
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'preflight_user_active_state_admin',
             'set_user_active_state_admin'
           )`,
      );

      expect(targetState.rows).toEqual([{ is_active: true }]);
      expect(audit.rows).toEqual([{ count: 0 }]);
      expect(definitions.rows).toHaveLength(2);

      for (const { definition } of definitions.rows) {
        const normalizedDefinition = definition.toLowerCase();
        const lockPosition = normalizedDefinition.indexOf(
          "pg_advisory_xact_lock",
        );
        const actorResolutionPosition = normalizedDefinition.indexOf(
          "actor_profile_id := public.current_active_user_profile_id()",
        );

        expect(
          normalizedDefinition.match(/current_user_is_admin\(\)/g),
        ).toHaveLength(2);
        expect(lockPosition).toBeGreaterThan(-1);
        expect(actorResolutionPosition).toBeGreaterThan(lockPosition);
      }
    });
  });

  it("does not add audit noise for an account-state no-op", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.unpermitted;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const before = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in ('user.deactivated', 'user.reactivated')`,
        [target.profileId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const result = await database.query<CreatedProfileIdRow>(
        `select public.set_user_active_state_admin(
           $1::uuid,
           true
         ) as profile_id`,
        [target.profileId],
      );
      await database.query("reset role");

      const after = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in ('user.deactivated', 'user.reactivated')`,
        [target.profileId],
      );

      expect(result.rows).toEqual([{ profile_id: target.profileId }]);
      expect(after.rows).toEqual(before.rows);
    });
  });

  it("deactivates profile and Auth state while preserving history and permissions", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.permitted;
    const existingSession = await target.client.auth.getSession();

    expect(existingSession.data.session).not.toBeNull();
    expect(await fixture.getAuthUserBanned(target.authUserId)).toBe(false);

    await fixture.setAuthUserBanned(target.authUserId, true);

    try {
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const permissionsBefore = await database.query<CountResultRow>(
          `select count(*)::integer as count
           from public.user_permissions
           where user_id = $1::uuid`,
          [target.profileId],
        );

        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(
          "select public.set_user_active_state_admin($1::uuid, false)",
          [target.profileId],
        );
        await database.query("reset role");

        const profile = await database.query<ActiveStateProfileRow>(
          `select is_active, is_admin, deactivated_at, deactivated_by_user_id
           from public.user_profiles
           where id = $1::uuid`,
          [target.profileId],
        );
        const audit = await database.query<ActiveStateAuditRow>(
          `select actor_user_id, action_type, entity_id, before_data,
                  after_data, metadata
           from public.audit_logs
           where entity_id = $1::uuid
             and action_type = 'user.deactivated'`,
          [target.profileId],
        );
        const permissionsAfter = await database.query<CountResultRow>(
          `select count(*)::integer as count
           from public.user_permissions
           where user_id = $1::uuid`,
          [target.profileId],
        );

        expect(profile.rows[0]).toMatchObject({
          is_active: false,
          is_admin: false,
          deactivated_by_user_id: fixture.actors.admin.profileId,
        });
        expect(profile.rows[0]?.deactivated_at).toBeInstanceOf(Date);
        expect(audit.rows).toHaveLength(1);
        expect(audit.rows[0]).toMatchObject({
          actor_user_id: fixture.actors.admin.profileId,
          action_type: "user.deactivated",
          entity_id: target.profileId,
          before_data: { is_active: true },
          after_data: {
            is_active: false,
            deactivated_by_user_id: fixture.actors.admin.profileId,
          },
          metadata: { source: "admin_user_active_state" },
        });
        expect(permissionsAfter.rows).toEqual(permissionsBefore.rows);

        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [target.authUserId],
        );
        await database.query("set local role authenticated");
        const activeGate = await database.query<{ active: boolean }>(
          "select public.is_active_user() as active",
        );
        const permissionGate = await database.query<{ allowed: boolean }>(
          "select public.has_permission('projects.view') as allowed",
        );

        expect(activeGate.rows).toEqual([{ active: false }]);
        expect(permissionGate.rows).toEqual([{ allowed: false }]);
      });

      const signIn = await fixture.attemptPasswordSignIn(target.authUserId);

      expect(signIn.signedIn).toBe(false);
      expect(signIn.errorCode).toEqual(expect.any(String));
    } finally {
      await fixture.setAuthUserBanned(target.authUserId, false);
    }
  });

  it("reactivates Auth and profile state and clears current deactivation metadata", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.unpermitted;

    await fixture.setAuthUserBanned(target.authUserId, true);

    try {
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        await database.query(
          `update public.user_profiles
           set is_active = false,
               deactivated_at = pg_catalog.now(),
               deactivated_by_user_id = $2::uuid
           where id = $1::uuid`,
          [target.profileId, fixture.actors.admin.profileId],
        );

        await fixture.setAuthUserBanned(target.authUserId, false);
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(
          "select public.set_user_active_state_admin($1::uuid, true)",
          [target.profileId],
        );
        await database.query("reset role");

        const profile = await database.query<ActiveStateProfileRow>(
          `select is_active, is_admin, deactivated_at, deactivated_by_user_id
           from public.user_profiles
           where id = $1::uuid`,
          [target.profileId],
        );
        const audit = await database.query<ActiveStateAuditRow>(
          `select actor_user_id, action_type, entity_id, before_data,
                  after_data, metadata
           from public.audit_logs
           where entity_id = $1::uuid
             and action_type = 'user.reactivated'`,
          [target.profileId],
        );
        const signIn = await fixture.attemptPasswordSignIn(target.authUserId);

        expect(profile.rows).toEqual([
          {
            is_active: true,
            is_admin: false,
            deactivated_at: null,
            deactivated_by_user_id: null,
          },
        ]);
        expect(audit.rows).toHaveLength(1);
        expect(audit.rows[0]).toMatchObject({
          actor_user_id: fixture.actors.admin.profileId,
          action_type: "user.reactivated",
          entity_id: target.profileId,
          before_data: {
            is_active: false,
            deactivated_by_user_id: fixture.actors.admin.profileId,
          },
          after_data: {
            is_active: true,
            deactivated_at: null,
            deactivated_by_user_id: null,
          },
          metadata: { source: "admin_user_active_state" },
        });
        expect(signIn).toEqual({ signedIn: true, errorCode: null });
      });
    } finally {
      if (await fixture.getAuthUserBanned(target.authUserId)) {
        await fixture.setAuthUserBanned(target.authUserId, false);
      }
    }
  });

  it("denies non-Admin and inactive callers at the account-state Edge boundary", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.unpermitted;

    for (const actor of [fixture.actors.permitted, fixture.actors.inactive]) {
      const sessionResult = await actor.client.auth.getSession();
      const accessToken = sessionResult.data.session?.access_token;

      expect(sessionResult.error).toBeNull();
      expect(accessToken).toEqual(expect.any(String));

      const response = await fetch(
        `${environment.supabaseUrl}/functions/v1/admin-set-user-active`,
        {
          method: "POST",
          headers: {
            apikey: environment.supabasePublishableKey,
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ userId: target.profileId, isActive: false }),
        },
      );
      const responseBody: unknown = await response.json();

      expect(response.status).toBe(403);
      expect(isRecord(responseBody) ? responseBody.code : null).toBe(
        "access_denied",
      );
      expect(await fixture.getAuthUserBanned(target.authUserId)).toBe(false);
    }
  });

  it("returns a safe no-op from the account-state Edge boundary", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.unpermitted;
    const sessionResult = await fixture.actors.admin.client.auth.getSession();
    const accessToken = sessionResult.data.session?.access_token;

    expect(accessToken).toEqual(expect.any(String));

    const response = await fetch(
      `${environment.supabaseUrl}/functions/v1/admin-set-user-active`,
      {
        method: "POST",
        headers: {
          apikey: environment.supabasePublishableKey,
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ userId: target.profileId, isActive: true }),
      },
    );
    const responseBody: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody).toMatchObject({
      code: "user_active_state_unchanged",
      data: {
        profileId: target.profileId,
        isActive: true,
        changed: false,
      },
    });
    expect(await fixture.getAuthUserBanned(target.authUserId)).toBe(false);
  });

  it("promotes and demotes while preserving active state and explicit permissions", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.permitted;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const permissionsBefore = await database.query<{
        permission_definition_id: string;
      }>(
        `select permission_definition_id
         from public.user_permissions
         where user_id = $1::uuid
         order by permission_definition_id`,
        [target.profileId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const promotion = await database.query<CreatedProfileIdRow>(
        `select public.set_user_admin_status_admin(
           $1::uuid,
           true
         ) as profile_id`,
        [target.profileId],
      );
      await database.query("reset role");

      const promotedProfile = await database.query<AdminStatusProfileRow>(
        `select is_admin, is_active
         from public.user_profiles
         where id = $1::uuid`,
        [target.profileId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [target.authUserId],
      );
      await database.query("set local role authenticated");
      const promotedAdminStatus = await database.query<{ value: boolean }>(
        "select public.current_user_is_admin() as value",
      );
      const promotedAdminBypass = await database.query<{ value: boolean }>(
        "select public.has_permission('projects.create') as value",
      );
      await database.query("reset role");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const demotion = await database.query<CreatedProfileIdRow>(
        `select public.set_user_admin_status_admin(
           $1::uuid,
           false
         ) as profile_id`,
        [target.profileId],
      );
      await database.query("reset role");

      const demotedProfile = await database.query<AdminStatusProfileRow>(
        `select is_admin, is_active
         from public.user_profiles
         where id = $1::uuid`,
        [target.profileId],
      );
      const permissionsAfter = await database.query<{
        permission_definition_id: string;
      }>(
        `select permission_definition_id
         from public.user_permissions
         where user_id = $1::uuid
         order by permission_definition_id`,
        [target.profileId],
      );
      const audits = await database.query<AdminStatusAuditRow>(
        `select actor_user_id, action_type, entity_id, before_data,
                after_data, metadata
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in (
             'user.promoted_to_admin',
             'user.demoted_from_admin'
           )
         order by action_type`,
        [target.profileId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [target.authUserId],
      );
      await database.query("set local role authenticated");
      const demotedAdminStatus = await database.query<{ value: boolean }>(
        "select public.current_user_is_admin() as value",
      );
      const preservedGrant = await database.query<{ value: boolean }>(
        "select public.has_permission('projects.view') as value",
      );
      const ungrantedPermission = await database.query<{ value: boolean }>(
        "select public.has_permission('projects.create') as value",
      );

      expect(promotion.rows).toEqual([{ profile_id: target.profileId }]);
      expect(demotion.rows).toEqual([{ profile_id: target.profileId }]);
      expect(promotedProfile.rows).toEqual([
        { is_admin: true, is_active: true },
      ]);
      expect(demotedProfile.rows).toEqual([
        { is_admin: false, is_active: true },
      ]);
      expect(promotedAdminStatus.rows).toEqual([{ value: true }]);
      expect(promotedAdminBypass.rows).toEqual([{ value: true }]);
      expect(demotedAdminStatus.rows).toEqual([{ value: false }]);
      expect(preservedGrant.rows).toEqual([{ value: true }]);
      expect(ungrantedPermission.rows).toEqual([{ value: false }]);
      expect(permissionsAfter.rows).toEqual(permissionsBefore.rows);
      expect(audits.rows).toEqual([
        {
          actor_user_id: fixture.actors.admin.profileId,
          action_type: "user.demoted_from_admin",
          entity_id: target.profileId,
          before_data: { is_admin: true },
          after_data: { is_admin: false },
          metadata: { source: "admin_user_status_change" },
        },
        {
          actor_user_id: fixture.actors.admin.profileId,
          action_type: "user.promoted_to_admin",
          entity_id: target.profileId,
          before_data: { is_admin: false },
          after_data: { is_admin: true },
          metadata: { source: "admin_user_status_change" },
        },
      ]);
    });
  });

  it("changes Admin status for an inactive target without activating it", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.inactive;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const permissionsBefore = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.user_permissions
         where user_id = $1::uuid`,
        [target.profileId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query(
        "select public.set_user_admin_status_admin($1::uuid, false)",
        [target.profileId],
      );
      await database.query("reset role");
      const demoted = await database.query<AdminStatusProfileRow>(
        `select is_admin, is_active
         from public.user_profiles
         where id = $1::uuid`,
        [target.profileId],
      );
      await database.query("set local role authenticated");
      await database.query(
        "select public.set_user_admin_status_admin($1::uuid, true)",
        [target.profileId],
      );
      await database.query("reset role");

      const promoted = await database.query<AdminStatusProfileRow>(
        `select is_admin, is_active
         from public.user_profiles
         where id = $1::uuid`,
        [target.profileId],
      );
      const permissionsAfter = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.user_permissions
         where user_id = $1::uuid`,
        [target.profileId],
      );

      expect(demoted.rows).toEqual([{ is_admin: false, is_active: false }]);
      expect(promoted.rows).toEqual([{ is_admin: true, is_active: false }]);
      expect(permissionsAfter.rows).toEqual(permissionsBefore.rows);

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [target.authUserId],
      );
      await database.query("set local role authenticated");
      const inactiveAdmin = await database.query<{ value: boolean }>(
        "select public.current_user_is_admin() as value",
      );

      expect(inactiveAdmin.rows).toEqual([{ value: false }]);
    });
  });

  it("denies Admin-status changes to anonymous, non-Admin, and inactive actors", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.unpermitted;

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.permitted.client,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
    ]) {
      const { error } = await client.rpc("set_user_admin_status_admin", {
        p_user_id: target.profileId,
        p_is_admin: true,
      });

      expectPermissionDenied(error);
    }
  });

  it("rejects self Admin-status changes without changing the actor", async () => {
    const fixture = requireHarness();
    const additionalAdmin = await fixture.createTemporaryProfile(
      "admin-status-self-continuity",
      undefined,
      fixture.actors.admin.profileId,
      { isAdmin: true },
    );
    const { error } = await fixture.actors.admin.client.rpc(
      "set_user_admin_status_admin",
      {
        p_user_id: fixture.actors.admin.profileId,
        p_is_admin: false,
      },
    );

    expect(error?.code).toBe("AUS01");
    expect(additionalAdmin.profileId).toEqual(expect.any(String));

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const profile = await database.query<AdminStatusProfileRow>(
        `select is_admin, is_active
         from public.user_profiles
         where id = $1::uuid`,
        [fixture.actors.admin.profileId],
      );

      expect(profile.rows).toEqual([{ is_admin: true, is_active: true }]);
    });
  });

  it("rejects demotion of the last active Admin without audit noise", async () => {
    const fixture = requireHarness();

    await expect(
      fixture.withRollbackDatabaseTransaction(async (database) => {
        await database.query(
          `update public.user_profiles
           set is_active = false
           where is_admin
             and id <> $1::uuid`,
          [fixture.actors.admin.profileId],
        );
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(
          "select public.set_user_admin_status_admin($1::uuid, false)",
          [fixture.actors.admin.profileId],
        );
      }),
    ).rejects.toMatchObject({ code: "AUS02" });

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const profile = await database.query<AdminStatusProfileRow>(
        `select is_admin, is_active
         from public.user_profiles
         where id = $1::uuid`,
        [fixture.actors.admin.profileId],
      );
      const audit = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'user.demoted_from_admin'`,
        [fixture.actors.admin.profileId],
      );

      expect(profile.rows).toEqual([{ is_admin: true, is_active: true }]);
      expect(audit.rows).toEqual([{ count: 0 }]);
    });
  });

  it("does not add audit noise for an Admin-status no-op", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.unpermitted;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const before = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in (
             'user.promoted_to_admin',
             'user.demoted_from_admin'
           )`,
        [target.profileId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const result = await database.query<CreatedProfileIdRow>(
        `select public.set_user_admin_status_admin(
           $1::uuid,
           false
         ) as profile_id`,
        [target.profileId],
      );
      await database.query("reset role");

      const after = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in (
             'user.promoted_to_admin',
             'user.demoted_from_admin'
           )`,
        [target.profileId],
      );

      expect(result.rows).toEqual([{ profile_id: target.profileId }]);
      expect(after.rows).toEqual(before.rows);
    });
  });

  it("shares the continuity lock and rejects an actor demoted while waiting", async () => {
    const fixture = requireHarness();
    const waitingAdmin = await fixture.createTemporaryProfile(
      "waiting-admin-status-authorization",
      undefined,
      fixture.actors.admin.profileId,
      { isAdmin: true },
    );
    const target = fixture.actors.unpermitted;
    const applicationName = `alfaev-admin-status-wait-${randomUUID()}`;

    await fixture.withDatabaseClients(3, async (clients) => {
      const lockHolder = clients[0];
      const waitingActor = clients[1];
      const observer = clients[2];

      if (!lockHolder || !waitingActor || !observer) {
        throw new Error("Concurrency fixture clients are unavailable");
      }

      await lockHolder.query("begin");
      await lockHolder.query(
        `select pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended(
             'alfaev.active_admin_continuity',
             0
           )
         )`,
      );
      await waitingActor.query("begin");
      await waitingActor.query(
        "select pg_catalog.set_config('application_name', $1::text, true)",
        [applicationName],
      );
      await waitingActor.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [waitingAdmin.authUserId],
      );
      await waitingActor.query("set local role authenticated");
      const waitingMutation = waitingActor
        .query(
          "select public.set_user_admin_status_admin($1::uuid, true)",
          [target.profileId],
        )
        .then(
          () => null,
          (error: unknown) => error,
        );
      let observedAdvisoryWait = false;

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await observer.query<ActivityWaitRow>(
          `select wait_event_type, wait_event
           from pg_catalog.pg_stat_activity
           where application_name = $1::text`,
          [applicationName],
        );
        const waiting = activity.rows[0];

        if (
          waiting?.wait_event_type === "Lock" &&
          waiting.wait_event?.toLowerCase() === "advisory"
        ) {
          observedAdvisoryWait = true;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(observedAdvisoryWait).toBe(true);

      await lockHolder.query(
        `update public.user_profiles
         set is_admin = false
         where id = $1::uuid`,
        [waitingAdmin.profileId],
      );
      await lockHolder.query("commit");

      const mutationError = await waitingMutation;

      expect(mutationError).toMatchObject({ code: "42501" });
      await waitingActor.query("rollback");

      const targetState = await observer.query<AdminStatusProfileRow>(
        `select is_admin, is_active
         from public.user_profiles
         where id = $1::uuid`,
        [target.profileId],
      );
      const audit = await observer.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'user.promoted_to_admin'`,
        [target.profileId],
      );
      const definitions = await observer.query<{
        name: string;
        definition: string;
      }>(
        `select
           routine.proname as name,
           pg_catalog.pg_get_functiondef(routine.oid) as definition
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'set_user_active_state_admin',
             'set_user_admin_status_admin'
           )`,
      );

      expect(targetState.rows).toEqual([{ is_admin: false, is_active: true }]);
      expect(audit.rows).toEqual([{ count: 0 }]);
      expect(definitions.rows).toHaveLength(2);

      for (const { definition } of definitions.rows) {
        expect(definition).toContain("alfaev.active_admin_continuity");
      }
    });
  });

  it("grants and revokes one delegable permission atomically with audit", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.permitted;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const profileBefore = await database.query<AdminStatusProfileRow>(
        `select is_admin, is_active
         from public.user_profiles
         where id = $1::uuid`,
        [target.profileId],
      );
      const unrelatedPermissionsBefore = await database.query<{
        permission_definition_id: string;
      }>(
        `select permission_definition_id
         from public.user_permissions
         where user_id = $1::uuid
         order by permission_definition_id`,
        [target.profileId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const grant = await database.query<{ granted: boolean }>(
        `select public.set_user_permission_admin(
           $1::uuid,
           $2::text,
           true
         ) as granted`,
        [target.profileId, "  projects.create  "],
      );
      await database.query("reset role");

      const grantedRow = await database.query<{
        granted_by_user_id: string;
        permission_definition_id: string;
      }>(
        `select
           user_permission.granted_by_user_id,
           user_permission.permission_definition_id
         from public.user_permissions as user_permission
         join public.permission_definitions as definition
           on definition.id = user_permission.permission_definition_id
         where user_permission.user_id = $1::uuid
           and definition.key = 'projects.create'`,
        [target.profileId],
      );
      const revisionAfterGrant = await database.query<{ revision: string }>(
        `select revision::text as revision
         from public.user_permission_revisions
         where user_id = $1::uuid`,
        [target.profileId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [target.authUserId],
      );
      await database.query("set local role authenticated");
      const helperAfterGrant = await database.query<{ allowed: boolean }>(
        "select public.has_permission('projects.create') as allowed",
      );
      await database.query("reset role");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const revoke = await database.query<{ granted: boolean }>(
        `select public.set_user_permission_admin(
           $1::uuid,
           $2::text,
           false
         ) as granted`,
        [target.profileId, "projects.create"],
      );
      await database.query("reset role");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [target.authUserId],
      );
      await database.query("set local role authenticated");
      const helperAfterRevoke = await database.query<{ allowed: boolean }>(
        "select public.has_permission('projects.create') as allowed",
      );
      const unrelatedHelper = await database.query<{ allowed: boolean }>(
        "select public.has_permission('projects.view') as allowed",
      );
      await database.query("reset role");
      const revisionAfterRevoke = await database.query<{ revision: string }>(
        `select revision::text as revision
         from public.user_permission_revisions
         where user_id = $1::uuid`,
        [target.profileId],
      );

      const profileAfter = await database.query<AdminStatusProfileRow>(
        `select is_admin, is_active
         from public.user_profiles
         where id = $1::uuid`,
        [target.profileId],
      );
      const unrelatedPermissionsAfter = await database.query<{
        permission_definition_id: string;
      }>(
        `select permission_definition_id
         from public.user_permissions
         where user_id = $1::uuid
         order by permission_definition_id`,
        [target.profileId],
      );
      const audits = await database.query<PermissionAuditRow>(
        `select actor_user_id, action_type, entity_id, before_data,
                after_data, metadata
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in ('permission.granted', 'permission.revoked')
         order by action_type`,
        [target.profileId],
      );

      expect(grant.rows).toEqual([{ granted: true }]);
      expect(revoke.rows).toEqual([{ granted: false }]);
      expect(grantedRow.rows).toEqual([
        {
          granted_by_user_id: fixture.actors.admin.profileId,
          permission_definition_id:
            fixture.permissionDefinitionIds.ungranted,
        },
      ]);
      expect(helperAfterGrant.rows).toEqual([{ allowed: true }]);
      expect(helperAfterRevoke.rows).toEqual([{ allowed: false }]);
      expect(unrelatedHelper.rows).toEqual([{ allowed: true }]);
      expect(revisionAfterGrant.rows).toEqual([{ revision: "2" }]);
      expect(revisionAfterRevoke.rows).toEqual([{ revision: "3" }]);
      expect(profileAfter.rows).toEqual(profileBefore.rows);
      expect(unrelatedPermissionsAfter.rows).toEqual(
        unrelatedPermissionsBefore.rows,
      );
      expect(audits.rows).toEqual([
        {
          actor_user_id: fixture.actors.admin.profileId,
          action_type: "permission.granted",
          entity_id: target.profileId,
          before_data: {
            permission_key: "projects.create",
            granted: false,
          },
          after_data: {
            permission_key: "projects.create",
            granted: true,
          },
          metadata: {
            source: "admin_user_permission_change",
            permission_definition_id:
              fixture.permissionDefinitionIds.ungranted,
          },
        },
        {
          actor_user_id: fixture.actors.admin.profileId,
          action_type: "permission.revoked",
          entity_id: target.profileId,
          before_data: {
            permission_key: "projects.create",
            granted: true,
          },
          after_data: {
            permission_key: "projects.create",
            granted: false,
          },
          metadata: {
            source: "admin_user_permission_change",
            permission_definition_id:
              fixture.permissionDefinitionIds.ungranted,
          },
        },
      ]);
    });
  });

  it("treats duplicate grant and revoke requests as audit-free no-ops", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.unpermitted;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query(
        "select public.set_user_permission_admin($1::uuid, $2::text, true)",
        [target.profileId, "projects.create"],
      );
      await database.query("reset role");
      const auditAfterGrant = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'permission.granted'`,
        [target.profileId],
      );
      const revisionAfterGrant = await database.query<{ revision: string }>(
        `select revision::text as revision
         from public.user_permission_revisions
         where user_id = $1::uuid`,
        [target.profileId],
      );
      await database.query("set local role authenticated");
      const duplicateGrant = await database.query<{ granted: boolean }>(
        `select public.set_user_permission_admin(
           $1::uuid,
           $2::text,
           true
        ) as granted`,
        [target.profileId, "projects.create"],
      );
      await database.query("reset role");
      const auditAfterDuplicateGrant = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'permission.granted'`,
        [target.profileId],
      );
      const revisionAfterDuplicateGrant = await database.query<{
        revision: string;
      }>(
        `select revision::text as revision
         from public.user_permission_revisions
         where user_id = $1::uuid`,
        [target.profileId],
      );
      await database.query("set local role authenticated");
      await database.query(
        "select public.set_user_permission_admin($1::uuid, $2::text, false)",
        [target.profileId, "projects.create"],
      );
      await database.query("reset role");
      const auditAfterRevoke = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'permission.revoked'`,
        [target.profileId],
      );
      const revisionAfterRevoke = await database.query<{ revision: string }>(
        `select revision::text as revision
         from public.user_permission_revisions
         where user_id = $1::uuid`,
        [target.profileId],
      );
      await database.query("set local role authenticated");
      const duplicateRevoke = await database.query<{ granted: boolean }>(
        `select public.set_user_permission_admin(
           $1::uuid,
           $2::text,
           false
        ) as granted`,
        [target.profileId, "projects.create"],
      );
      await database.query("reset role");
      const auditAfterDuplicateRevoke = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'permission.revoked'`,
        [target.profileId],
      );
      const revisionAfterDuplicateRevoke = await database.query<{
        revision: string;
      }>(
        `select revision::text as revision
         from public.user_permission_revisions
         where user_id = $1::uuid`,
        [target.profileId],
      );

      expect(duplicateGrant.rows).toEqual([{ granted: true }]);
      expect(duplicateRevoke.rows).toEqual([{ granted: false }]);
      expect(auditAfterGrant.rows).toEqual([{ count: 1 }]);
      expect(auditAfterDuplicateGrant.rows).toEqual(auditAfterGrant.rows);
      expect(auditAfterRevoke.rows).toEqual([{ count: 1 }]);
      expect(auditAfterDuplicateRevoke.rows).toEqual(auditAfterRevoke.rows);
      expect(revisionAfterGrant.rows).toEqual([{ revision: "2" }]);
      expect(revisionAfterDuplicateGrant.rows).toEqual(revisionAfterGrant.rows);
      expect(revisionAfterRevoke.rows).toEqual([{ revision: "3" }]);
      expect(revisionAfterDuplicateRevoke.rows).toEqual(revisionAfterRevoke.rows);
    });
  });

  it("rolls back permission, audit, and revision state when revision signaling fails", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.unpermitted;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `update public.user_permission_revisions
         set revision = 9223372036854775807
         where user_id = $1::uuid`,
        [target.profileId],
      );
      await database.query("savepoint failed_permission_mutation");
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");

      await expect(
        database.query(
          `select public.set_user_permission_admin(
             $1::uuid,
             'projects.create',
             true
           )`,
          [target.profileId],
        ),
      ).rejects.toMatchObject({ code: "22003" });

      await database.query("rollback to savepoint failed_permission_mutation");
      await database.query("reset role");

      const permission = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.user_permissions as user_permission
         join public.permission_definitions as definition
           on definition.id = user_permission.permission_definition_id
         where user_permission.user_id = $1::uuid
           and definition.key = 'projects.create'`,
        [target.profileId],
      );
      const audit = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'permission.granted'`,
        [target.profileId],
      );
      const revision = await database.query<{ revision: string }>(
        `select revision::text as revision
         from public.user_permission_revisions
         where user_id = $1::uuid`,
        [target.profileId],
      );

      expect(permission.rows).toEqual([{ count: 0 }]);
      expect(audit.rows).toEqual([{ count: 0 }]);
      expect(revision.rows).toEqual([
        { revision: "9223372036854775807" },
      ]);
    });
  });

  it("rejects unknown and non-delegable permission capabilities", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.unpermitted;
    const unknown = await fixture.actors.admin.client.rpc(
      "set_user_permission_admin",
      {
        p_user_id: target.profileId,
        p_permission_key: "users.manage",
        p_granted: true,
      },
    );

    expect(unknown.error?.code).toBe("PRM03");

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const nonDelegableCatalogRows = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.permission_definitions
         where not is_delegable`,
      );
      const mutationDefinition = await database.query<{ definition: string }>(
        `select pg_catalog.pg_get_functiondef(
           'public.set_user_permission_admin(uuid,text,boolean)'::regprocedure
         ) as definition`,
      );
      const invariantDefinition = await database.query<{ definition: string }>(
        `select pg_catalog.pg_get_functiondef(
           'public.enforce_delegable_permission_grant()'::regprocedure
         ) as definition`,
      );

      expect(nonDelegableCatalogRows.rows).toEqual([{ count: 0 }]);
      expect(mutationDefinition.rows[0]?.definition).toContain(
        "permission_definitions.is_delegable",
      );
      expect(invariantDefinition.rows[0]?.definition).toContain(
        "permission_definitions.is_delegable",
      );
    });
  });

  it("denies permission mutation to anonymous, non-Admin, and inactive actors", async () => {
    const fixture = requireHarness();

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.permitted.client,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
    ]) {
      const { error } = await client.rpc("set_user_permission_admin", {
        p_user_id: fixture.actors.unpermitted.profileId,
        p_permission_key: "projects.create",
        p_granted: true,
      });

      expectPermissionDenied(error);
    }
  });

  it("rejects self permission changes and permission changes for Admin targets", async () => {
    const fixture = requireHarness();
    const selfChange = await fixture.actors.admin.client.rpc(
      "set_user_permission_admin",
      {
        p_user_id: fixture.actors.admin.profileId,
        p_permission_key: "projects.create",
        p_granted: true,
      },
    );

    expect(selfChange.error?.code).toBe("PRM01");

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const existingPermissions = await database.query<{
        permission_definition_id: string;
      }>(
        `select permission_definition_id
         from public.user_permissions
         where user_id = $1::uuid
         order by permission_definition_id`,
        [fixture.actors.inactive.profileId],
      );
      const existingAudit = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in ('permission.granted', 'permission.revoked')`,
        [fixture.actors.inactive.profileId],
      );

      expect(existingPermissions.rows).toHaveLength(1);

      const adminTarget = await fixture.actors.admin.client.rpc(
        "set_user_permission_admin",
        {
          p_user_id: fixture.actors.inactive.profileId,
          p_permission_key: "projects.view",
          p_granted: false,
        },
      );

      expect(adminTarget.error?.code).toBe("PRM02");

      const permissionsAfter = await database.query<{
        permission_definition_id: string;
      }>(
        `select permission_definition_id
         from public.user_permissions
         where user_id = $1::uuid
         order by permission_definition_id`,
        [fixture.actors.inactive.profileId],
      );
      const auditAfter = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in ('permission.granted', 'permission.revoked')`,
        [fixture.actors.inactive.profileId],
      );

      expect(permissionsAfter.rows).toEqual(existingPermissions.rows);
      expect(auditAfter.rows).toEqual(existingAudit.rows);
    });
  });

  it("saves an atomic permission set with one audit per meaningful change", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.permitted;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const profileBefore = await database.query<AdminStatusProfileRow>(
        `select is_admin, is_active
         from public.user_profiles
         where id = $1::uuid`,
        [target.profileId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const save = await database.query<{ changed: boolean }>(
        `select public.save_user_permissions_admin(
           $1::uuid,
           $2::text[],
           $3::text[]
         ) as changed`,
        [
          target.profileId,
          ["projects.view"],
          ["archive.view", "projects.create"],
        ],
      );
      await database.query("reset role");

      const resultingPermissions = await database.query<{
        permission_key: string;
      }>(
        `select definition.key as permission_key
         from public.user_permissions as user_permission
         join public.permission_definitions as definition
           on definition.id = user_permission.permission_definition_id
         where user_permission.user_id = $1::uuid
         order by definition.key`,
        [target.profileId],
      );
      const audits = await database.query<{
        action_type: string;
        permission_key: string;
      }>(
        `select action_type, after_data ->> 'permission_key' as permission_key
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in ('permission.granted', 'permission.revoked')
         order by action_type, after_data ->> 'permission_key'`,
        [target.profileId],
      );
      const profileAfter = await database.query<AdminStatusProfileRow>(
        `select is_admin, is_active
         from public.user_profiles
         where id = $1::uuid`,
        [target.profileId],
      );
      const revisionAfter = await database.query<{ revision: string }>(
        `select revision::text as revision
         from public.user_permission_revisions
         where user_id = $1::uuid`,
        [target.profileId],
      );

      expect(save.rows).toEqual([{ changed: true }]);
      expect(resultingPermissions.rows).toEqual([
        { permission_key: "archive.view" },
        { permission_key: "projects.create" },
      ]);
      expect(audits.rows).toEqual([
        { action_type: "permission.granted", permission_key: "archive.view" },
        { action_type: "permission.granted", permission_key: "projects.create" },
        { action_type: "permission.revoked", permission_key: "projects.view" },
      ]);
      expect(profileAfter.rows).toEqual(profileBefore.rows);
      expect(revisionAfter.rows).toEqual([{ revision: "4" }]);
    });
  });

  it("keeps no-op saves audit-free and rejects stale expected state atomically", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.permitted;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const auditBefore = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in ('permission.granted', 'permission.revoked')`,
        [target.profileId],
      );
      const revisionBefore = await database.query<{ revision: string }>(
        `select revision::text as revision
         from public.user_permission_revisions
         where user_id = $1::uuid`,
        [target.profileId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const save = await database.query<{ changed: boolean }>(
        `select public.save_user_permissions_admin(
           $1::uuid,
           $2::text[],
           $3::text[]
         ) as changed`,
        [target.profileId, ["projects.view"], ["projects.view"]],
      );
      await database.query("reset role");

      const auditAfter = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in ('permission.granted', 'permission.revoked')`,
        [target.profileId],
      );
      const revisionAfter = await database.query<{ revision: string }>(
        `select revision::text as revision
         from public.user_permission_revisions
         where user_id = $1::uuid`,
        [target.profileId],
      );

      expect(save.rows).toEqual([{ changed: false }]);
      expect(auditAfter.rows).toEqual(auditBefore.rows);
      expect(revisionAfter.rows).toEqual(revisionBefore.rows);
    });

    await expect(
      fixture.withRollbackDatabaseTransaction(async (database) => {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(
          `select public.save_user_permissions_admin(
             $1::uuid,
             $2::text[],
             $3::text[]
           )`,
          [target.profileId, [], ["projects.create"]],
        );
      }),
    ).rejects.toMatchObject({ code: "PRM04" });

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const permissions = await database.query<{ permission_key: string }>(
        `select definition.key as permission_key
         from public.user_permissions as user_permission
         join public.permission_definitions as definition
           on definition.id = user_permission.permission_definition_id
         where user_permission.user_id = $1::uuid
         order by definition.key`,
        [target.profileId],
      );
      const revision = await database.query<{ revision: string }>(
        `select revision::text as revision
         from public.user_permission_revisions
         where user_id = $1::uuid`,
        [target.profileId],
      );

      expect(permissions.rows).toEqual([{ permission_key: "projects.view" }]);
      expect(revision.rows).toEqual([{ revision: "1" }]);
    });
  });

  it("validates batch keys and denies unauthorized or protected targets", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.unpermitted;
    const invalidRequests = [
      fixture.actors.admin.client.rpc("save_user_permissions_admin", {
        p_user_id: target.profileId,
        p_expected_permission_keys: [],
        p_desired_permission_keys: ["unknown.permission"],
      }),
      fixture.actors.admin.client.rpc("save_user_permissions_admin", {
        p_user_id: target.profileId,
        p_expected_permission_keys: [],
        p_desired_permission_keys: ["projects.view", " projects.view "],
      }),
    ];
    const invalidResults = await Promise.all(invalidRequests);

    expect(invalidResults[0]?.error?.code).toBe("PRM03");
    expect(invalidResults[1]?.error?.code).toBe("22023");

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.permitted.client,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
    ]) {
      const { error } = await client.rpc("save_user_permissions_admin", {
        p_user_id: target.profileId,
        p_expected_permission_keys: [],
        p_desired_permission_keys: [],
      });

      expectPermissionDenied(error);
    }

    const selfChange = await fixture.actors.admin.client.rpc(
      "save_user_permissions_admin",
      {
        p_user_id: fixture.actors.admin.profileId,
        p_expected_permission_keys: [],
        p_desired_permission_keys: [],
      },
    );
    const adminTarget = await fixture.actors.admin.client.rpc(
      "save_user_permissions_admin",
      {
        p_user_id: fixture.actors.inactive.profileId,
        p_expected_permission_keys: ["projects.view"],
        p_desired_permission_keys: [],
      },
    );

    expect(selfChange.error?.code).toBe("PRM01");
    expect(adminTarget.error?.code).toBe("PRM02");

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const catalog = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.permission_definitions
         where not is_delegable`,
      );
      const definition = await database.query<{ definition: string }>(
        `select pg_catalog.pg_get_functiondef(
           'public.save_user_permissions_admin(uuid,text[],text[])'::regprocedure
         ) as definition`,
      );

      expect(catalog.rows).toEqual([{ count: 0 }]);
      expect(definition.rows[0]?.definition).toContain("is_delegable");
    });
  });

  it("exposes only an active actor's own permission revision signal", async () => {
    const fixture = requireHarness();
    const own = await fixture.actors.permitted.client
      .from("user_permission_revisions")
      .select("user_id,revision");
    const crossUser = await fixture.actors.permitted.client
      .from("user_permission_revisions")
      .select("user_id")
      .eq("user_id", fixture.actors.inactive.profileId);
    const inactiveOwn = await fixture.actors.inactive.client
      .from("user_permission_revisions")
      .select("user_id");
    const anonymous = await fixture.anonymousClient
      .from("user_permission_revisions")
      .select("user_id");
    const protectedPermissionRead = await fixture.actors.permitted.client
      .from("user_permissions")
      .select("user_id");

    expect(own.error).toBeNull();
    expect(own.data).toEqual([
      {
        user_id: fixture.actors.permitted.profileId,
        revision: 1,
      },
    ]);
    expect(crossUser.error).toBeNull();
    expect(crossUser.data).toEqual([]);
    expect(inactiveOwn.error).toBeNull();
    expect(inactiveOwn.data).toEqual([]);
    expectPermissionDenied(anonymous.error);
    expectPermissionDenied(protectedPermissionRead.error);
  });

  it("denies all direct permission revision writes and helper execution", async () => {
    const fixture = requireHarness();
    const actor = fixture.actors.permitted;
    const insert = await actor.client.from("user_permission_revisions").insert({
      user_id: actor.profileId,
      revision: 99,
      updated_at: new Date().toISOString(),
    });
    const update = await actor.client
      .from("user_permission_revisions")
      .update({ revision: 99 })
      .eq("user_id", actor.profileId);
    const deletion = await actor.client
      .from("user_permission_revisions")
      .delete()
      .eq("user_id", actor.profileId);
    const helper = await fixture.actors.admin.client.rpc(
      "touch_user_permission_revision",
      { p_user_id: actor.profileId },
    );

    expectPermissionDenied(insert.error);
    expectPermissionDenied(update.error);
    expectPermissionDenied(deletion.error);
    expectPermissionDenied(helper.error);
  });

  it("publishes only the non-sensitive permission revision signal table", async () => {
    await requireHarness().withRollbackDatabaseTransaction(async (database) => {
      const publications = await database.query<{ tablename: string }>(
        `select tablename
         from pg_catalog.pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename in (
             'user_permissions',
             'user_permission_revisions'
           )
         order by tablename`,
      );
      const revisionAcl = await database.query<{
        can_delete: boolean;
        can_insert: boolean;
        can_select: boolean;
        can_update: boolean;
      }>(
        `select
           pg_catalog.has_table_privilege(
             'authenticated',
             'public.user_permission_revisions',
             'select'
           ) as can_select,
           pg_catalog.has_table_privilege(
             'authenticated',
             'public.user_permission_revisions',
             'insert'
           ) as can_insert,
           pg_catalog.has_table_privilege(
             'authenticated',
             'public.user_permission_revisions',
             'update'
           ) as can_update,
           pg_catalog.has_table_privilege(
             'authenticated',
             'public.user_permission_revisions',
             'delete'
           ) as can_delete`,
      );

      expect(publications.rows).toEqual([
        { tablename: "user_permission_revisions" },
      ]);
      expect(revisionAcl.rows).toEqual([
        {
          can_delete: false,
          can_insert: false,
          can_select: true,
          can_update: false,
        },
      ]);
    });
  });

  it("serializes single and batch permission mutations before stale checking", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.permitted;
    await fixture.withDatabaseClients(3, async (clients) => {
      const lockHolder = clients[0];
      const waitingBatch = clients[1];
      const observer = clients[2];

      if (!lockHolder || !waitingBatch || !observer) {
        throw new Error("Concurrency fixture clients are unavailable");
      }

      await lockHolder.query("begin");
      await lockHolder.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await lockHolder.query("set local role authenticated");
      await lockHolder.query(
        `select public.set_user_permission_admin(
           $1::uuid,
           'projects.create',
           true
         )`,
        [target.profileId],
      );
      await waitingBatch.query("begin");
      await waitingBatch.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await waitingBatch.query("set local role authenticated");
      let saveSettled = false;
      const pendingSaveBehindSingleMutation = waitingBatch
        .query(
          `select public.save_user_permissions_admin(
             $1::uuid,
             $2::text[],
             $3::text[]
           )`,
          [target.profileId, ["projects.view"], ["archive.view"]],
        )
        .finally(() => {
          saveSettled = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(saveSettled).toBe(false);

      await lockHolder.query("rollback");
      const serializedSave = await pendingSaveBehindSingleMutation;

      expect(serializedSave.rows).toEqual([{ save_user_permissions_admin: true }]);
      await waitingBatch.query("rollback");

      await lockHolder.query("begin");
      await lockHolder.query(
        `select pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended('alfaev.active_admin_continuity', 0)
         )`,
      );
      await waitingBatch.query("begin");
      await waitingBatch.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await waitingBatch.query("set local role authenticated");
      const pendingStaleSave = waitingBatch
        .query(
          `select public.save_user_permissions_admin(
             $1::uuid,
             $2::text[],
             $3::text[]
           )`,
          [target.profileId, ["projects.view"], ["archive.view"]],
        )
        .then(
          () => null,
          (error: unknown) => error,
        );

      await lockHolder.query(
        `insert into public.user_permissions (
           user_id,
           permission_definition_id,
           granted_by_user_id
         )
         select $1::uuid, definition.id, $2::uuid
         from public.permission_definitions as definition
         where definition.key = 'projects.create'`,
        [target.profileId, fixture.actors.admin.profileId],
      );
      await lockHolder.query("commit");

      const saveError = await pendingStaleSave;

      expect(saveError).toMatchObject({ code: "PRM04" });
      await waitingBatch.query("rollback");
      await observer.query(
        `delete from public.user_permissions
         where user_id = $1::uuid
           and permission_definition_id = $2::uuid`,
        [target.profileId, fixture.permissionDefinitionIds.ungranted],
      );

      const definitions = await observer.query<{ definition: string }>(
        `select pg_catalog.pg_get_functiondef(routine.oid) as definition
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'set_user_permission_admin',
             'save_user_permissions_admin'
           )
         order by routine.proname`,
      );

      expect(definitions.rows).toHaveLength(2);
      for (const { definition } of definitions.rows) {
        expect(definition).toContain("alfaev.active_admin_continuity");
      }
    });
  });

  it("returns the complete real permission matrix to an active Admin without mutation", async () => {
    const fixture = requireHarness();
    const target = fixture.actors.permitted;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const permissionsBefore = await database.query<{
        granted_by_user_id: string;
        permission_definition_id: string;
      }>(
        `select granted_by_user_id, permission_definition_id
         from public.user_permissions
         where user_id = $1::uuid
         order by permission_definition_id`,
        [target.profileId],
      );
      const { data, error } = await fixture.actors.admin.client.rpc(
        "get_user_permissions_admin",
        { p_user_id: target.profileId },
      );
      const rows: unknown = data;

      expect(error).toBeNull();

      if (!Array.isArray(rows) || !rows.every(isPermissionMatrixRow)) {
        throw new Error("Admin permission matrix RPC returned invalid data");
      }

      expect(rows).toHaveLength(30);
      expect(rows.map((row) => row.permission_key)).toEqual(PERMISSION_KEYS);
      expect(new Set(rows.map((row) => row.permission_key)).size).toBe(30);

      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual([
          "description",
          "granted",
          "label",
          "module",
          "permission_key",
        ]);
      }

      expect(
        rows.find((row) => row.permission_key === "projects.view")?.granted,
      ).toBe(true);
      expect(
        rows.find((row) => row.permission_key === "projects.create")?.granted,
      ).toBe(false);
      expect(rows.filter((row) => row.granted)).toHaveLength(1);

      const permissionsAfter = await database.query<{
        granted_by_user_id: string;
        permission_definition_id: string;
      }>(
        `select granted_by_user_id, permission_definition_id
         from public.user_permissions
         where user_id = $1::uuid
         order by permission_definition_id`,
        [target.profileId],
      );

      expect(permissionsAfter.rows).toEqual(permissionsBefore.rows);
    });
  });

  it("shows preserved explicit grants for an Admin target without fabricating bypass grants", async () => {
    const fixture = requireHarness();
    const { data, error } = await fixture.actors.admin.client.rpc(
      "get_user_permissions_admin",
      { p_user_id: fixture.actors.inactive.profileId },
    );
    const rows: unknown = data;

    expect(error).toBeNull();

    if (!Array.isArray(rows) || !rows.every(isPermissionMatrixRow)) {
      throw new Error("Admin-target permission matrix returned invalid data");
    }

    expect(rows).toHaveLength(30);
    expect(rows.filter((row) => row.granted).map((row) => row.permission_key))
      .toEqual(["projects.view"]);
  });

  it("denies permission-matrix reads to non-Admins, inactive Admins, and anonymous callers", async () => {
    const fixture = requireHarness();

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.permitted.client,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
    ]) {
      const { error } = await client.rpc("get_user_permissions_admin", {
        p_user_id: fixture.actors.permitted.profileId,
      });

      expectPermissionDenied(error);
    }
  });

  it("fails safely when the permission-matrix target does not exist", async () => {
    const { error } = await requireHarness().actors.admin.client.rpc(
      "get_user_permissions_admin",
      { p_user_id: "00000000-0000-0000-0000-000000000000" },
    );

    expect(error?.code).toBe("P0002");
  });

  it("creates trimmed Brands with case-insensitive identity and trusted audit metadata", async () => {
    const fixture = requireHarness();
    const brandName = `Bosch ${randomUUID()}`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ brand_id: string }>(
        "select public.create_brand($1::text) as brand_id",
        [`  ${brandName}  `],
      );
      await database.query("reset role");
      const brandId = created.rows[0]?.brand_id;

      if (!brandId) {
        throw new Error("Brand creation returned no ID");
      }

      const brand = await database.query<BrandRow>(
        `select *
         from public.brands
         where id = $1::uuid`,
        [brandId],
      );
      const audit = await database.query<BrandAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'brand.created'`,
        [brandId],
      );

      expect(brand.rows).toHaveLength(1);
      expect(brand.rows[0]).toMatchObject({
        archived_at: null,
        archived_by_user_id: null,
        created_by_user_id: fixture.actors.admin.profileId,
        id: brandId,
        is_active: true,
        name: brandName,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(brand.rows[0]?.created_at).toEqual(brand.rows[0]?.updated_at);
      expect(audit.rows).toEqual([
        {
          action_type: "brand.created",
          actor_user_id: fixture.actors.admin.profileId,
          after_data: { is_active: true, name: brandName },
          before_data: null,
          entity_id: brandId,
          entity_type: "brand",
        },
      ]);

      await database.query("savepoint duplicate_brand");
      await database.query("set local role authenticated");
      await expect(
        database.query("select public.create_brand($1::text)", [
          ` ${brandName.toUpperCase()} `,
        ]),
      ).rejects.toMatchObject({ code: "BRN02" });
      await database.query("rollback to savepoint duplicate_brand");
      await database.query("reset role");

      const duplicateCount = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.brands
         where pg_catalog.lower(name) = pg_catalog.lower($1::text)`,
        [brandName],
      );
      const createAuditCount = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'brand.created'`,
        [brandId],
      );

      expect(duplicateCount.rows).toEqual([{ count: 1 }]);
      expect(createAuditCount.rows).toEqual([{ count: 1 }]);
    });

    const blank = await fixture.actors.admin.client.rpc("create_brand", {
      p_name: "   ",
    });

    expect(blank.error?.code).toBe("22023");
  });

  it("keeps Brand edits explicit, archive-only, immutable, and fully audited", async () => {
    const fixture = requireHarness();
    const originalName = `Lifecycle ${randomUUID()}`;
    const updatedName = `${originalName} Updated`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ brand_id: string }>(
        "select public.create_brand($1::text) as brand_id",
        [originalName],
      );
      await database.query("reset role");
      const brandId = created.rows[0]?.brand_id;

      if (!brandId) {
        throw new Error("Brand lifecycle fixture returned no ID");
      }

      const beforeNoOp = await database.query<BrandRow>(
        "select * from public.brands where id = $1::uuid",
        [brandId],
      );
      await database.query("set local role authenticated");
      await database.query("select public.update_brand($1::uuid, $2::text)", [
        brandId,
        `  ${originalName}  `,
      ]);
      await database.query("reset role");
      const afterNoOp = await database.query<BrandRow>(
        "select * from public.brands where id = $1::uuid",
        [brandId],
      );
      const noOpAudit = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'brand.updated'`,
        [brandId],
      );

      expect(afterNoOp.rows).toEqual(beforeNoOp.rows);
      expect(noOpAudit.rows).toEqual([{ count: 0 }]);

      await database.query("set local role authenticated");
      await database.query("select public.update_brand($1::uuid, $2::text)", [
        brandId,
        updatedName,
      ]);
      await database.query("select public.archive_brand($1::uuid)", [brandId]);
      await database.query("reset role");

      const archived = await database.query<BrandRow>(
        "select * from public.brands where id = $1::uuid",
        [brandId],
      );
      const audits = await database.query<BrandAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in (
             'brand.created',
             'brand.updated',
             'brand.archived'
           )
         order by pg_catalog.array_position(
           array[
             'brand.created',
             'brand.updated',
             'brand.archived'
           ]::text[],
           action_type
         )`,
        [brandId],
      );

      expect(archived.rows).toHaveLength(1);
      expect(archived.rows[0]).toMatchObject({
        archived_by_user_id: fixture.actors.admin.profileId,
        created_by_user_id: fixture.actors.admin.profileId,
        id: brandId,
        is_active: false,
        name: updatedName,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(archived.rows[0]?.archived_at).toBeInstanceOf(Date);
      expect(audits.rows.map((auditRow) => auditRow.action_type)).toEqual([
        "brand.created",
        "brand.updated",
        "brand.archived",
      ]);
      expect(audits.rows.every(
        (auditRow) =>
          auditRow.actor_user_id === fixture.actors.admin.profileId,
      )).toBe(true);

      await database.query("savepoint archived_brand_edit");
      await database.query("set local role authenticated");
      await expect(
        database.query("select public.update_brand($1::uuid, $2::text)", [
          brandId,
          `${updatedName} Forbidden`,
        ]),
      ).rejects.toMatchObject({ code: "BRN01" });
      await database.query("rollback to savepoint archived_brand_edit");
      await database.query("reset role");

      const afterFailedEdit = await database.query<BrandRow>(
        "select * from public.brands where id = $1::uuid",
        [brandId],
      );
      const auditAfterFailure = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'brand.updated'`,
        [brandId],
      );

      expect(afterFailedEdit.rows).toEqual(archived.rows);
      expect(auditAfterFailure.rows).toEqual([{ count: 1 }]);
    });
  });

  it("allows a delegated active Brand manager to create, edit, and archive", async () => {
    const fixture = requireHarness();
    const actor = fixture.actors.brandManager;
    const originalName = `Managed ${randomUUID()}`;
    const updatedName = `${originalName} Updated`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ brand_id: string }>(
        "select public.create_brand($1::text) as brand_id",
        [originalName],
      );
      const brandId = created.rows[0]?.brand_id;

      if (!brandId) {
        throw new Error("Delegated Brand creation returned no ID");
      }

      await database.query("select public.update_brand($1::uuid, $2::text)", [
        brandId,
        updatedName,
      ]);
      await database.query("select public.archive_brand($1::uuid)", [brandId]);
      await database.query("reset role");

      const brand = await database.query<BrandRow>(
        "select * from public.brands where id = $1::uuid",
        [brandId],
      );
      const audits = await database.query<BrandAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type like 'brand.%'
         order by case action_type
           when 'brand.created' then 1
           when 'brand.updated' then 2
           when 'brand.archived' then 3
           else 4
         end`,
        [brandId],
      );

      expect(brand.rows[0]).toMatchObject({
        archived_by_user_id: actor.profileId,
        created_by_user_id: actor.profileId,
        is_active: false,
        name: updatedName,
        updated_by_user_id: actor.profileId,
      });
      expect(audits.rows.map((auditRow) => auditRow.action_type)).toEqual([
        "brand.created",
        "brand.updated",
        "brand.archived",
      ]);
      expect(audits.rows.every(
        (auditRow) => auditRow.actor_user_id === actor.profileId,
      )).toBe(true);
    });
  });

  it("limits active and archived Brand reads to Inventory-authorized actors", async () => {
    const fixture = requireHarness();
    const activeBrandId = randomUUID();
    const archivedBrandId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.brands (
           id,
           name,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $2::text, true, $5::uuid, $5::uuid, null, null),
           (
             $3::uuid,
             $4::text,
             false,
             $5::uuid,
             $5::uuid,
             pg_catalog.now(),
             $5::uuid
           )`,
        [
          activeBrandId,
          `Readable ${randomUUID()}`,
          archivedBrandId,
          `Archived ${randomUUID()}`,
          fixture.actors.admin.profileId,
        ],
      );

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.brandManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ id: string }>(
          `select id
           from public.brands
           where id = any($1::uuid[])
           order by id`,
          [[activeBrandId, archivedBrandId]],
        );
        await database.query("reset role");

        expect(visible.rows.map((row) => row.id).sort()).toEqual(
          [activeBrandId, archivedBrandId].sort(),
        );
      }

      for (const actor of [
        fixture.actors.permitted,
        fixture.actors.unpermitted,
        fixture.actors.inactiveBrandManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ id: string }>(
          `select id
           from public.brands
           where id = any($1::uuid[])`,
          [[activeBrandId, archivedBrandId]],
        );
        await database.query("reset role");

        expect(hidden.rows).toEqual([]);
      }

      await database.query("savepoint anonymous_brand_read");
      await database.query("set local role anon");
      await expect(
        database.query("select id from public.brands limit 1"),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_brand_read");
      await database.query("reset role");
    });
  });

  it("denies unauthorized Brand RPCs, direct writes, restore, and hard-delete paths", async () => {
    const fixture = requireHarness();

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.permitted.client,
      fixture.actors.unpermitted.client,
      fixture.actors.inactiveBrandManager.client,
    ]) {
      const { error } = await client.rpc("create_brand", {
        p_name: `Denied ${randomUUID()}`,
      });

      expectPermissionDenied(error);
    }

    const directInsert = await fixture.actors.brandManager.client
      .from("brands")
      .insert({
        name: `Direct ${randomUUID()}`,
        created_by_user_id: fixture.actors.brandManager.profileId,
        updated_by_user_id: fixture.actors.brandManager.profileId,
      });
    const directUpdate = await fixture.actors.brandManager.client
      .from("brands")
      .update({ name: `Direct update ${randomUUID()}` })
      .eq("id", randomUUID());
    const directDelete = await fixture.actors.brandManager.client
      .from("brands")
      .delete()
      .eq("id", randomUUID());

    expectPermissionDenied(directInsert.error);
    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const columns = await database.query<{ column_name: string }>(
        `select column_name
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'brands'
         order by ordinal_position`,
      );
      const unsupportedFunctions = await database.query<{ count: number }>(
        `select count(*)::integer as count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'delete_brand',
             'reactivate_brand',
             'restore_brand',
             'unarchive_brand'
           )`,
      );
      const functions = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        function_name: string;
        is_security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.proname as function_name,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege(
             'authenticated',
             routine.oid,
             'execute'
           ) as authenticated_execute,
           pg_catalog.has_function_privilege(
             'anon',
             routine.oid,
             'execute'
           ) as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'create_brand',
             'update_brand',
             'archive_brand'
           )
         order by routine.proname`,
      );

      expect(columns.rows.map((column) => column.column_name)).toEqual([
        "id",
        "name",
        "is_active",
        "created_at",
        "created_by_user_id",
        "updated_at",
        "updated_by_user_id",
        "archived_at",
        "archived_by_user_id",
      ]);
      expect(unsupportedFunctions.rows).toEqual([{ count: 0 }]);
      expect(functions.rows).toHaveLength(3);
      for (const brandFunction of functions.rows) {
        expect(brandFunction).toMatchObject({
          anonymous_execute: false,
          authenticated_execute: true,
          is_security_definer: true,
          settings: ["search_path=\"\""],
        });
      }
    });
  });

  it("normalizes Supplier creation, preserves name identity, and audits the trusted actor", async () => {
    const fixture = requireHarness();
    const supplierName = `Supplier ${randomUUID()}`;
    const duplicateEmail = `shared.${randomUUID()}@example.com`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ supplier_id: string }>(
        `select public.create_supplier(
           $1::text,
           $2::text,
           $3::text,
           $4::text,
           $5::text
         ) as supplier_id`,
        [
          `  ${supplierName}  `,
          "  Bosnia and Herzegovina  ",
          "  Ada Lovelace  ",
          "  +387 (0)33 ext. 42  ",
          `  ${duplicateEmail.toUpperCase()}  `,
        ],
      );
      const second = await database.query<{ supplier_id: string }>(
        `select public.create_supplier(
           $1::text,
           $2::text,
           $3::text,
           $4::text,
           $5::text
         ) as supplier_id`,
        [
          `Second ${randomUUID()}`,
          " Croatia ",
          "   ",
          "   ",
          ` ${duplicateEmail} `,
        ],
      );
      await database.query("reset role");
      const supplierId = created.rows[0]?.supplier_id;
      const secondSupplierId = second.rows[0]?.supplier_id;

      if (!supplierId || !secondSupplierId) {
        throw new Error("Supplier creation returned no ID");
      }

      const suppliers = await database.query<SupplierRow>(
        `select *
         from public.suppliers
         where id = any($1::uuid[])
         order by id`,
        [[supplierId, secondSupplierId]],
      );
      const createdSupplier = suppliers.rows.find(
        (supplier) => supplier.id === supplierId,
      );
      const secondSupplier = suppliers.rows.find(
        (supplier) => supplier.id === secondSupplierId,
      );
      const audit = await database.query<SupplierAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.created'`,
        [supplierId],
      );

      expect(createdSupplier).toMatchObject({
        archived_at: null,
        archived_by_user_id: null,
        contact_email: duplicateEmail,
        contact_person_name: "Ada Lovelace",
        contact_phone: "+387 (0)33 ext. 42",
        country: "Bosnia and Herzegovina",
        created_by_user_id: fixture.actors.admin.profileId,
        is_active: true,
        name: supplierName,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(createdSupplier?.created_at).toEqual(createdSupplier?.updated_at);
      expect(secondSupplier).toMatchObject({
        contact_email: duplicateEmail,
        contact_person_name: null,
        contact_phone: null,
        country: "Croatia",
      });
      expect(audit.rows).toEqual([
        {
          action_type: "supplier.created",
          actor_user_id: fixture.actors.admin.profileId,
          after_data: {
            contact_email: duplicateEmail,
            contact_person_name: "Ada Lovelace",
            contact_phone: "+387 (0)33 ext. 42",
            country: "Bosnia and Herzegovina",
            is_active: true,
            name: supplierName,
          },
          before_data: null,
          entity_id: supplierId,
          entity_type: "supplier",
        },
      ]);

      await database.query("savepoint duplicate_supplier");
      await database.query("set local role authenticated");
      await expect(
        database.query(
          "select public.create_supplier($1::text, $2::text)",
          [` ${supplierName.toUpperCase()} `, "Germany"],
        ),
      ).rejects.toMatchObject({ code: "SUP02" });
      await database.query("rollback to savepoint duplicate_supplier");
      await database.query("reset role");

      const identityCount = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.suppliers
         where pg_catalog.lower(name) = pg_catalog.lower($1::text)`,
        [supplierName],
      );
      const auditCount = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.created'`,
        [supplierId],
      );

      expect(identityCount.rows).toEqual([{ count: 1 }]);
      expect(auditCount.rows).toEqual([{ count: 1 }]);
    });

    for (const [input, expectedCode] of [
      [{ p_name: "   ", p_country: "Germany" }, "22023"],
      [{ p_name: `Name ${randomUUID()}`, p_country: "   " }, "22023"],
      [
        {
          p_name: `Name ${randomUUID()}`,
          p_country: "Germany",
          p_contact_email: "not-an-email",
        },
        "SUP03",
      ],
    ] as const) {
      const { error } = await fixture.actors.admin.client.rpc(
        "create_supplier",
        input,
      );

      expect(error?.code).toBe(expectedCode);
    }
  });

  it("keeps normalized Supplier no-ops audit-free and blocks archived edits", async () => {
    const fixture = requireHarness();
    const originalName = `Lifecycle Supplier ${randomUUID()}`;
    const updatedName = `${originalName} Updated`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ supplier_id: string }>(
        `select public.create_supplier(
           $1::text,
           $2::text,
           $3::text,
           $4::text,
           $5::text
         ) as supplier_id`,
        [originalName, "Germany", "Grace Hopper", "+49 30 123", "GRACE@EXAMPLE.COM"],
      );
      await database.query("reset role");
      const supplierId = created.rows[0]?.supplier_id;

      if (!supplierId) {
        throw new Error("Supplier lifecycle fixture returned no ID");
      }

      const beforeNoOp = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      await database.query("set local role authenticated");
      await database.query(
        `select public.update_supplier(
           $1::uuid,
           $2::text,
           $3::text,
           $4::text,
           $5::text,
           $6::text
         )`,
        [
          supplierId,
          ` ${originalName} `,
          " Germany ",
          " Grace Hopper ",
          " +49 30 123 ",
          " grace@example.com ",
        ],
      );
      await database.query("reset role");
      const afterNoOp = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      const noOpAudit = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.updated'`,
        [supplierId],
      );

      expect(afterNoOp.rows).toEqual(beforeNoOp.rows);
      expect(noOpAudit.rows).toEqual([{ count: 0 }]);

      await database.query("set local role authenticated");
      await database.query(
        `select public.update_supplier(
           $1::uuid,
           $2::text,
           $3::text,
           $4::text,
           $5::text,
           $6::text
         )`,
        [supplierId, updatedName, "Austria", "   ", " +43 / flexible ", "NEW@EXAMPLE.COM"],
      );
      await database.query("reset role");

      const updated = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      const updateAudit = await database.query<SupplierAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.updated'`,
        [supplierId],
      );

      expect(updated.rows[0]).toMatchObject({
        contact_email: "new@example.com",
        contact_person_name: null,
        contact_phone: "+43 / flexible",
        country: "Austria",
        created_by_user_id: fixture.actors.admin.profileId,
        is_active: true,
        name: updatedName,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(updated.rows[0]?.created_at).toEqual(beforeNoOp.rows[0]?.created_at);
      expect(updateAudit.rows).toEqual([
        {
          action_type: "supplier.updated",
          actor_user_id: fixture.actors.admin.profileId,
          after_data: {
            contact_email: "new@example.com",
            contact_person_name: null,
            contact_phone: "+43 / flexible",
            country: "Austria",
            name: updatedName,
          },
          before_data: {
            contact_email: "grace@example.com",
            contact_person_name: "Grace Hopper",
            contact_phone: "+49 30 123",
            country: "Germany",
            name: originalName,
          },
          entity_id: supplierId,
          entity_type: "supplier",
        },
      ]);

      await database.query(
        `update public.suppliers
         set is_active = false,
             archived_at = pg_catalog.now(),
             archived_by_user_id = $2::uuid
         where id = $1::uuid`,
        [supplierId, fixture.actors.admin.profileId],
      );
      const archivedBefore = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );

      await database.query("savepoint archived_supplier_edit");
      await database.query("set local role authenticated");
      await expect(
        database.query(
          "select public.update_supplier($1::uuid, $2::text, $3::text)",
          [supplierId, `${updatedName} Forbidden`, "Austria"],
        ),
      ).rejects.toMatchObject({ code: "SUP01" });
      await database.query("rollback to savepoint archived_supplier_edit");
      await database.query("reset role");

      const archivedAfter = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      const auditAfterFailure = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.updated'`,
        [supplierId],
      );

      expect(archivedAfter.rows).toEqual(archivedBefore.rows);
      expect(auditAfterFailure.rows).toEqual([{ count: 1 }]);
    });
  });

  it("separates delegated Supplier create and edit permissions", async () => {
    const fixture = requireHarness();
    const originalName = `Delegated Supplier ${randomUUID()}`;
    const updatedName = `${originalName} Updated`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.supplierCreator.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ supplier_id: string }>(
        "select public.create_supplier($1::text, $2::text) as supplier_id",
        [originalName, "Slovenia"],
      );
      await database.query("reset role");
      const supplierId = created.rows[0]?.supplier_id;

      if (!supplierId) {
        throw new Error("Delegated Supplier creation returned no ID");
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.supplierEditor.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query(
        "select public.update_supplier($1::uuid, $2::text, $3::text)",
        [supplierId, updatedName, "Slovenia"],
      );
      await database.query("reset role");

      const supplier = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      const audits = await database.query<SupplierAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type like 'supplier.%'
         order by case action_type
           when 'supplier.created' then 1
           when 'supplier.updated' then 2
           else 3
         end`,
        [supplierId],
      );

      expect(supplier.rows[0]).toMatchObject({
        created_by_user_id: fixture.actors.supplierCreator.profileId,
        name: updatedName,
        updated_by_user_id: fixture.actors.supplierEditor.profileId,
      });
      expect(audits.rows.map((audit) => [audit.action_type, audit.actor_user_id]))
        .toEqual([
          ["supplier.created", fixture.actors.supplierCreator.profileId],
          ["supplier.updated", fixture.actors.supplierEditor.profileId],
        ]);
    });

    const createOnlyEdit = await fixture.actors.supplierCreator.client.rpc(
      "update_supplier",
      {
        p_supplier_id: randomUUID(),
        p_name: `Denied ${randomUUID()}`,
        p_country: "Germany",
      },
    );
    const editOnlyCreate = await fixture.actors.supplierEditor.client.rpc(
      "create_supplier",
      { p_name: `Denied ${randomUUID()}`, p_country: "Germany" },
    );

    expectPermissionDenied(createOnlyEdit.error);
    expectPermissionDenied(editOnlyCreate.error);
  });

  it("archives a Supplier atomically with canonical metadata and one trusted audit", async () => {
    const fixture = requireHarness();
    const supplierName = `Archive Supplier ${randomUUID()}`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ supplier_id: string }>(
        `select public.create_supplier(
           $1::text,
           $2::text,
           $3::text,
           $4::text,
           $5::text
         ) as supplier_id`,
        [
          supplierName,
          "Germany",
          "Archive Contact",
          "+49 30 123",
          "archive@example.com",
        ],
      );
      await database.query("reset role");
      const supplierId = created.rows[0]?.supplier_id;

      if (!supplierId) {
        throw new Error("Supplier archive fixture returned no ID");
      }

      const before = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );

      await database.query("set local role authenticated");
      const archivedResult = await database.query<{ supplier_id: string }>(
        "select public.archive_supplier($1::uuid) as supplier_id",
        [supplierId],
      );
      await database.query("reset role");

      const after = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      const audit = await database.query<SupplierAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.archived'`,
        [supplierId],
      );

      expect(archivedResult.rows).toEqual([{ supplier_id: supplierId }]);
      expect(after.rows[0]).toMatchObject({
        archived_by_user_id: fixture.actors.admin.profileId,
        contact_email: before.rows[0]?.contact_email,
        contact_person_name: before.rows[0]?.contact_person_name,
        contact_phone: before.rows[0]?.contact_phone,
        country: before.rows[0]?.country,
        created_at: before.rows[0]?.created_at,
        created_by_user_id: before.rows[0]?.created_by_user_id,
        id: supplierId,
        is_active: false,
        name: before.rows[0]?.name,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(after.rows[0]?.archived_at).toEqual(after.rows[0]?.updated_at);
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        action_type: "supplier.archived",
        actor_user_id: fixture.actors.admin.profileId,
        after_data: {
          archived_by_user_id: fixture.actors.admin.profileId,
          is_active: false,
          name: supplierName,
        },
        before_data: {
          archived_at: null,
          archived_by_user_id: null,
          is_active: true,
          name: supplierName,
        },
        entity_id: supplierId,
        entity_type: "supplier",
      });
      const auditArchivedAt = audit.rows[0]?.after_data?.archived_at;

      if (typeof auditArchivedAt !== "string") {
        throw new Error("Supplier archive audit returned no archive timestamp");
      }

      expect(Date.parse(auditArchivedAt)).toBe(
        after.rows[0]?.archived_at?.getTime(),
      );

      await database.query("savepoint repeated_supplier_archive");
      await database.query("set local role authenticated");
      await expect(
        database.query("select public.archive_supplier($1::uuid)", [supplierId]),
      ).rejects.toMatchObject({ code: "SUP01" });
      await database.query("rollback to savepoint repeated_supplier_archive");
      await database.query("reset role");

      await database.query("savepoint archived_supplier_update");
      await database.query("set local role authenticated");
      await expect(
        database.query(
          "select public.update_supplier($1::uuid, $2::text, $3::text)",
          [supplierId, `${supplierName} Edited`, "Austria"],
        ),
      ).rejects.toMatchObject({ code: "SUP01" });
      await database.query("rollback to savepoint archived_supplier_update");
      await database.query("reset role");

      const afterFailures = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      const auditAfterFailures = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.archived'`,
        [supplierId],
      );

      expect(afterFailures.rows).toEqual(after.rows);
      expect(auditAfterFailures.rows).toEqual([{ count: 1 }]);

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.supplierViewer.authUserId],
      );
      await database.query("set local role authenticated");
      const stillReadable = await database.query<{ id: string }>(
        "select id from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      await database.query("reset role");

      expect(stillReadable.rows).toEqual([{ id: supplierId }]);
    });
  });

  it("allows an active suppliers.archive actor and derives the audit actor internally", async () => {
    const fixture = requireHarness();
    const supplierName = `Delegated Archive Supplier ${randomUUID()}`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ supplier_id: string }>(
        "select public.create_supplier($1::text, $2::text) as supplier_id",
        [supplierName, "Austria"],
      );
      await database.query("reset role");
      const supplierId = created.rows[0]?.supplier_id;

      if (!supplierId) {
        throw new Error("Delegated Supplier archive fixture returned no ID");
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.supplierArchiver.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("select public.archive_supplier($1::uuid)", [supplierId]);
      await database.query("reset role");

      const archived = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      const audit = await database.query<SupplierAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.archived'`,
        [supplierId],
      );

      expect(archived.rows[0]).toMatchObject({
        archived_by_user_id: fixture.actors.supplierArchiver.profileId,
        is_active: false,
        updated_by_user_id: fixture.actors.supplierArchiver.profileId,
      });
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        action_type: "supplier.archived",
        actor_user_id: fixture.actors.supplierArchiver.profileId,
        entity_id: supplierId,
        entity_type: "supplier",
      });
    });
  });

  it("denies Supplier archive to unrelated, inactive, and anonymous actors", async () => {
    const fixture = requireHarness();

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.unpermitted.client,
      fixture.actors.supplierViewer.client,
      fixture.actors.supplierCreator.client,
      fixture.actors.supplierEditor.client,
      fixture.actors.inactiveSupplierManager.client,
    ]) {
      const { error } = await client.rpc("archive_supplier", {
        p_supplier_id: randomUUID(),
      });

      expectPermissionDenied(error);
    }

    const missing = await fixture.actors.admin.client.rpc("archive_supplier", {
      p_supplier_id: randomUUID(),
    });
    const missingId = await fixture.actors.admin.client.rpc("archive_supplier", {
      p_supplier_id: null,
    });

    expect(missing.error?.code).toBe("P0002");
    expect(missingId.error?.code).toBe("22023");
  });

  it("denies Supplier mutations to unauthorized, inactive, and anonymous actors", async () => {
    const fixture = requireHarness();

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.unpermitted.client,
      fixture.actors.supplierViewer.client,
      fixture.actors.inactiveSupplierManager.client,
    ]) {
      const createResult = await client.rpc("create_supplier", {
        p_name: `Denied ${randomUUID()}`,
        p_country: "Germany",
      });
      const updateResult = await client.rpc("update_supplier", {
        p_supplier_id: randomUUID(),
        p_name: `Denied ${randomUUID()}`,
        p_country: "Germany",
      });

      expectPermissionDenied(createResult.error);
      expectPermissionDenied(updateResult.error);
    }
  });

  it("allows Admin and suppliers.view readers to see active and archived Suppliers only", async () => {
    const fixture = requireHarness();
    const activeSupplierId = randomUUID();
    const archivedSupplierId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.suppliers (
           id,
           name,
           country,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $2::text, 'Germany', true, $5::uuid, $5::uuid, null, null),
           (
             $3::uuid,
             $4::text,
             'Austria',
             false,
             $5::uuid,
             $5::uuid,
             pg_catalog.now(),
             $5::uuid
           )`,
        [
          activeSupplierId,
          `Readable Supplier ${randomUUID()}`,
          archivedSupplierId,
          `Archived Supplier ${randomUUID()}`,
          fixture.actors.admin.profileId,
        ],
      );

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.supplierViewer,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ id: string }>(
          `select id
           from public.suppliers
           where id = any($1::uuid[])
           order by id`,
          [[activeSupplierId, archivedSupplierId]],
        );
        await database.query("reset role");

        expect(visible.rows.map((row) => row.id).sort()).toEqual(
          [activeSupplierId, archivedSupplierId].sort(),
        );
      }

      for (const actor of [
        fixture.actors.unpermitted,
        fixture.actors.supplierCreator,
        fixture.actors.supplierEditor,
        fixture.actors.inactiveSupplierManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ id: string }>(
          `select id
           from public.suppliers
           where id = any($1::uuid[])`,
          [[activeSupplierId, archivedSupplierId]],
        );
        await database.query("reset role");

        expect(hidden.rows).toEqual([]);
      }

      await database.query("savepoint anonymous_supplier_read");
      await database.query("set local role anon");
      await expect(
        database.query("select id from public.suppliers limit 1"),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_supplier_read");
      await database.query("reset role");
    });
  });

  it("enforces Supplier constraints, direct-write denial, hardened RPCs, and Task 042 lifecycle scope", async () => {
    const fixture = requireHarness();
    const directInsert = await fixture.actors.supplierCreator.client
      .from("suppliers")
      .insert({
        name: `Direct ${randomUUID()}`,
        country: "Germany",
        created_by_user_id: fixture.actors.supplierCreator.profileId,
        updated_by_user_id: fixture.actors.supplierCreator.profileId,
      });
    const directUpdate = await fixture.actors.supplierEditor.client
      .from("suppliers")
      .update({ name: `Direct update ${randomUUID()}` })
      .eq("id", randomUUID());
    const directDelete = await fixture.actors.supplierEditor.client
      .from("suppliers")
      .delete()
      .eq("id", randomUUID());

    expectPermissionDenied(directInsert.error);
    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const columns = await database.query<{ column_name: string }>(
        `select column_name
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'suppliers'
         order by ordinal_position`,
      );
      const constraints = await database.query<{ constraint_name: string }>(
        `select constraint_name
         from information_schema.table_constraints
         where table_schema = 'public'
           and table_name = 'suppliers'
         order by constraint_name`,
      );
      const tableSecurity = await database.query<{
        row_security: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        authenticated_delete: boolean;
      }>(
        `select
           table_info.relrowsecurity as row_security,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'select') as authenticated_select,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'insert') as authenticated_insert,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'update') as authenticated_update,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'delete') as authenticated_delete
         from pg_catalog.pg_class as table_info
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = table_info.relnamespace
         where namespace.nspname = 'public'
           and table_info.relname = 'suppliers'`,
      );
      const unsupportedFunctions = await database.query<{ count: number }>(
        `select count(*)::integer as count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'delete_supplier',
             'reactivate_supplier',
             'restore_supplier',
             'unarchive_supplier'
           )`,
      );
      const functions = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        function_name: string;
        is_security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.proname as function_name,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'archive_supplier',
             'create_supplier',
             'update_supplier'
           )
         order by routine.proname`,
      );

      expect(columns.rows.map((column) => column.column_name)).toEqual([
        "id",
        "name",
        "country",
        "contact_person_name",
        "contact_phone",
        "contact_email",
        "is_active",
        "created_at",
        "created_by_user_id",
        "updated_at",
        "updated_by_user_id",
        "archived_at",
        "archived_by_user_id",
      ]);
      expect(constraints.rows.map((constraint) => constraint.constraint_name))
        .toEqual(expect.arrayContaining([
          "suppliers_archive_state_consistent",
          "suppliers_contact_email_basic_format",
          "suppliers_contact_email_normalized",
          "suppliers_contact_person_normalized",
          "suppliers_contact_phone_normalized",
          "suppliers_country_trimmed_nonblank",
          "suppliers_name_trimmed_nonblank",
          "suppliers_pkey",
        ]));
      expect(tableSecurity.rows).toEqual([
        {
          authenticated_delete: false,
          authenticated_insert: false,
          authenticated_select: true,
          authenticated_update: false,
          row_security: true,
        },
      ]);
      expect(unsupportedFunctions.rows).toEqual([{ count: 0 }]);
      expect(functions.rows).toHaveLength(3);
      for (const supplierFunction of functions.rows) {
        expect(supplierFunction).toMatchObject({
          anonymous_execute: false,
          authenticated_execute: true,
          is_security_definer: true,
          settings: ["search_path=\"\""],
        });
      }

      for (const [name, country, email] of [
        ["   ", "Germany", null],
        [`Constraint ${randomUUID()}`, "   ", null],
        [`Constraint ${randomUUID()}`, "Germany", "invalid-email"],
        [`Constraint ${randomUUID()}`, "Germany", "UPPER@EXAMPLE.COM"],
      ] as const) {
        await database.query("savepoint invalid_supplier_constraint");
        await expect(
          database.query(
            `insert into public.suppliers (
               name,
               country,
               contact_email,
               created_by_user_id,
               updated_by_user_id
             )
             values ($1::text, $2::text, $3::text, $4::uuid, $4::uuid)`,
            [name, country, email, fixture.actors.admin.profileId],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await database.query("rollback to savepoint invalid_supplier_constraint");
      }
    });
  });

  it("enforces the canonical Product schema and lifecycle constraints", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const archivedBrandId = randomUUID();
      const componentId = randomUUID();
      const finishedGoodId = randomUUID();
      const componentSerial = createTestSerialNumber();
      let finishedGoodSerial = createTestSerialNumber();

      while (finishedGoodSerial === componentSerial) {
        finishedGoodSerial = createTestSerialNumber();
      }

      await database.query(
        `insert into public.brands (
           id,
           name,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values (
           $1::uuid,
           $2::text,
           false,
           $3::uuid,
           $3::uuid,
           pg_catalog.now(),
           $3::uuid
         )`,
        [archivedBrandId, `Historical Brand ${randomUUID()}`, actorId],
      );
      await database.query(
        `insert into public.products (
           id,
           serial_number,
           name,
           category,
           brand_id,
           product_kind,
           created_by_user_id,
           updated_by_user_id
         )
         values
           (
             $1::uuid,
             $2::text,
             'Valid Component',
             'Free Text Category',
             null,
             'component',
             $5::uuid,
             $5::uuid
           ),
           (
             $3::uuid,
             $4::text,
             'Historical PCB',
             'Finished Goods',
             $6::uuid,
             'pcb_finished_good',
             $5::uuid,
             $5::uuid
           )`,
        [
          componentId,
          componentSerial,
          finishedGoodId,
          finishedGoodSerial,
          actorId,
          archivedBrandId,
        ],
      );

      const products = await database.query<ProductRow>(
        `select *
         from public.products
         where id = any($1::uuid[])
         order by id`,
        [[componentId, finishedGoodId]],
      );
      const component = products.rows.find((row) => row.id === componentId);
      const finishedGood = products.rows.find(
        (row) => row.id === finishedGoodId,
      );

      expect(component).toMatchObject({
        archived_at: null,
        archived_by_user_id: null,
        brand_id: null,
        category: "Free Text Category",
        created_by_user_id: actorId,
        id: componentId,
        is_active: true,
        name: "Valid Component",
        product_kind: "component",
        serial_number: componentSerial,
        updated_by_user_id: actorId,
      });
      expect(component?.created_at).toEqual(component?.updated_at);
      expect(finishedGood).toMatchObject({
        brand_id: archivedBrandId,
        id: finishedGoodId,
        product_kind: "pcb_finished_good",
      });

      for (const [serialNumber, name, category, productKind] of [
        [createTestSerialNumber(), "   ", "Category", "component"],
        [createTestSerialNumber(), " Untrimmed", "Category", "component"],
        [createTestSerialNumber(), "Product", "   ", "component"],
        [createTestSerialNumber(), "Product", "Category ", "component"],
        ["123456", "Product", "Category", "component"],
        ["12345678", "Product", "Category", "component"],
        ["12345a7", "Product", "Category", "component"],
        [createTestSerialNumber(), "Product", "Category", "service"],
      ] as const) {
        await database.query("savepoint invalid_product_constraint");
        await expect(
          database.query(
            `insert into public.products (
               serial_number,
               name,
               category,
               product_kind,
               created_by_user_id,
               updated_by_user_id
             )
             values ($1::text, $2::text, $3::text, $4::text, $5::uuid, $5::uuid)`,
            [serialNumber, name, category, productKind, actorId],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await database.query("rollback to savepoint invalid_product_constraint");
      }

      await database.query("savepoint duplicate_product_serial");
      await expect(
        database.query(
          `insert into public.products (
             serial_number,
             name,
             category,
             product_kind,
             created_by_user_id,
             updated_by_user_id
           )
           values ($1::text, 'Duplicate', 'Category', 'component', $2::uuid, $2::uuid)`,
          [componentSerial, actorId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await database.query("rollback to savepoint duplicate_product_serial");

      const beforeSerialChange = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [componentId],
      );
      let changedSerial = createTestSerialNumber();

      while (changedSerial === componentSerial) {
        changedSerial = createTestSerialNumber();
      }

      await database.query("savepoint immutable_product_serial");
      await expect(
        database.query(
          `update public.products
           set serial_number = $2::text
           where id = $1::uuid`,
          [componentId, changedSerial],
        ),
      ).rejects.toMatchObject({ code: "PRD03" });
      await database.query("rollback to savepoint immutable_product_serial");

      const afterSerialChange = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [componentId],
      );

      expect(afterSerialChange.rows).toEqual(beforeSerialChange.rows);

      await database.query("savepoint immutable_product_kind");
      await expect(
        database.query(
          `update public.products
           set product_kind = 'pcb_finished_good'
           where id = $1::uuid`,
          [componentId],
        ),
      ).rejects.toMatchObject({ code: "PRD02" });
      await database.query("rollback to savepoint immutable_product_kind");

      await database.query(
        `update public.products
         set is_active = false,
             updated_at = pg_catalog.now(),
             updated_by_user_id = $2::uuid,
             archived_at = pg_catalog.now(),
             archived_by_user_id = $2::uuid
         where id = $1::uuid`,
        [componentId, actorId],
      );
      const archivedBefore = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [componentId],
      );

      expect(archivedBefore.rows[0]).toMatchObject({
        archived_by_user_id: actorId,
        id: componentId,
        is_active: false,
        serial_number: componentSerial,
      });
      expect(archivedBefore.rows[0]?.archived_at).toBeInstanceOf(Date);

      await database.query("savepoint immutable_archived_product");
      await expect(
        database.query(
          `update public.products
           set name = 'Forbidden archived edit'
           where id = $1::uuid`,
          [componentId],
        ),
      ).rejects.toMatchObject({ code: "PRD01" });
      await database.query("rollback to savepoint immutable_archived_product");

      const archivedAfter = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [componentId],
      );

      expect(archivedAfter.rows).toEqual(archivedBefore.rows);
    });
  });

  it("limits active and archived Product reads to Inventory-authorized actors", async () => {
    const fixture = requireHarness();
    const activeProductId = randomUUID();
    const archivedProductId = randomUUID();
    const activeSerial = createTestSerialNumber();
    let archivedSerial = createTestSerialNumber();

    while (archivedSerial === activeSerial) {
      archivedSerial = createTestSerialNumber();
    }

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.products (
           id,
           serial_number,
           name,
           category,
           product_kind,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $2::text, 'Active Product', 'Category', 'component', true, $5::uuid, $5::uuid, null, null),
           ($3::uuid, $4::text, 'Archived Product', 'Category', 'component', false, $5::uuid, $5::uuid, pg_catalog.now(), $5::uuid)`,
        [
          activeProductId,
          activeSerial,
          archivedProductId,
          archivedSerial,
          fixture.actors.admin.profileId,
        ],
      );

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.brandManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ id: string }>(
          `select id
           from public.products
           where id = any($1::uuid[])
           order by id`,
          [[activeProductId, archivedProductId]],
        );
        await database.query("reset role");

        expect(visible.rows.map((row) => row.id).sort()).toEqual(
          [activeProductId, archivedProductId].sort(),
        );
      }

      for (const actor of [
        fixture.actors.permitted,
        fixture.actors.unpermitted,
        fixture.actors.inactiveBrandManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ id: string }>(
          `select id
           from public.products
           where id = any($1::uuid[])`,
          [[activeProductId, archivedProductId]],
        );
        await database.query("reset role");

        expect(hidden.rows).toEqual([]);
      }

      await database.query("savepoint anonymous_product_read");
      await database.query("set local role anon");
      await expect(
        database.query("select id from public.products limit 1"),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_product_read");
      await database.query("reset role");
    });
  });

  it("denies direct Product writes and exposes no unsupported Product lifecycle RPCs", async () => {
    const fixture = requireHarness();
    const client = fixture.actors.brandManager.client;
    const productId = randomUUID();
    const directInsert = await client.from("products").insert({
      serial_number: createTestSerialNumber(),
      name: "Direct Product",
      category: "Category",
      product_kind: "component",
      created_by_user_id: fixture.actors.brandManager.profileId,
      updated_by_user_id: fixture.actors.brandManager.profileId,
    });
    const directUpdate = await client
      .from("products")
      .update({ name: "Forbidden update" })
      .eq("id", productId);
    const directDelete = await client.from("products").delete().eq("id", productId);

    expectPermissionDenied(directInsert.error);
    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const columns = await database.query<{ column_name: string }>(
        `select column_name
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'products'
         order by ordinal_position`,
      );
      const constraints = await database.query<{ constraint_name: string }>(
        `select constraint_name
         from information_schema.table_constraints
         where table_schema = 'public'
           and table_name = 'products'
         order by constraint_name`,
      );
      const tableSecurity = await database.query<{
        authenticated_delete: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        row_security: boolean;
      }>(
        `select
           table_info.relrowsecurity as row_security,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'select') as authenticated_select,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'insert') as authenticated_insert,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'update') as authenticated_update,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'delete') as authenticated_delete
         from pg_catalog.pg_class as table_info
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = table_info.relnamespace
         where namespace.nspname = 'public'
           and table_info.relname = 'products'`,
      );
      const unsupportedFunctions = await database.query<{ count: number }>(
        `select count(*)::integer as count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'delete_product',
             'reactivate_product',
             'restore_product',
             'unarchive_product'
           )`,
      );
      const lifecycleFunction = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'enforce_product_lifecycle_immutability'`,
      );

      expect(columns.rows.map((column) => column.column_name)).toEqual([
        "id",
        "serial_number",
        "name",
        "category",
        "brand_id",
        "product_kind",
        "is_active",
        "created_at",
        "created_by_user_id",
        "updated_at",
        "updated_by_user_id",
        "archived_at",
        "archived_by_user_id",
      ]);
      expect(constraints.rows.map((constraint) => constraint.constraint_name))
        .toEqual(expect.arrayContaining([
          "products_archive_state_consistent",
          "products_category_trimmed_nonblank",
          "products_kind_valid",
          "products_name_trimmed_nonblank",
          "products_pkey",
          "products_serial_number_format",
          "products_serial_number_key",
        ]));
      expect(tableSecurity.rows).toEqual([
        {
          authenticated_delete: false,
          authenticated_insert: false,
          authenticated_select: true,
          authenticated_update: false,
          row_security: true,
        },
      ]);
      expect(unsupportedFunctions.rows).toEqual([{ count: 0 }]);
      expect(lifecycleFunction.rows).toEqual([
        {
          anonymous_execute: false,
          authenticated_execute: false,
          is_security_definer: false,
          settings: ["search_path=\"\""],
        },
      ]);
    });
  });

  it("allocates sequential seven-digit Product Serials without rollback reuse", async () => {
    const fixture = requireHarness();
    const sequenceConfiguration = await fixture.withRollbackDatabaseTransaction(
      async (database) => {
        return database.query<{
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
      },
    );

    expect(sequenceConfiguration.rows).toEqual([
      {
        cache_size: "1",
        cycles: false,
        increment_by: "1",
        maximum_value: "9999999",
        minimum_value: "1",
        start_value: "1",
      },
    ]);

    const rolledBackAllocations = await fixture.withRollbackDatabaseTransaction(
      async (database) => {
        return database.query<{ serial_number: string }>(
          `select public.allocate_product_serial_number() as serial_number
           from pg_catalog.generate_series(1, 2)`,
        );
      },
    );
    const firstValue = rolledBackAllocations.rows[0]?.serial_number;
    const secondValue = rolledBackAllocations.rows[1]?.serial_number;

    expect(firstValue).toMatch(/^[0-9]{7}$/);
    expect(secondValue).toMatch(/^[0-9]{7}$/);
    expect(Number(secondValue)).toBe(Number(firstValue) + 1);

    const afterRollback = await fixture.withRollbackDatabaseTransaction(
      async (database) => {
        return database.query<{ serial_number: string }>(
          "select public.allocate_product_serial_number() as serial_number",
        );
      },
    );
    const afterRollbackValue = afterRollback.rows[0]?.serial_number;

    expect(afterRollbackValue).toMatch(/^[0-9]{7}$/);
    expect(Number(afterRollbackValue)).toBe(Number(secondValue) + 1);
  });

  it("allocates unique Product Serials safely across concurrent connections", async () => {
    const allocations = await requireHarness().withDatabaseClients(
      4,
      async (clients) => {
        return Promise.all(
          clients.map(async (database) => {
            const result = await database.query<{ serial_number: string }>(
              "select public.allocate_product_serial_number() as serial_number",
            );

            return result.rows[0]?.serial_number;
          }),
        );
      },
    );

    expect(allocations.every((value) => /^[0-9]{7}$/.test(value ?? "")))
      .toBe(true);
    expect(new Set(allocations).size).toBe(allocations.length);
  });

  it("keeps the Product Serial allocator internal and sequence state protected", async () => {
    const fixture = requireHarness();

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.admin.client,
      fixture.actors.brandManager.client,
    ]) {
      const { error } = await client.rpc("allocate_product_serial_number");

      expectPermissionDenied(error);
    }

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const allocator = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        result_type: string;
        settings: string[];
      }>(
        `select
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.pg_get_function_result(routine.oid) as result_type,
           pg_catalog.has_function_privilege(
             'authenticated',
             routine.oid,
             'execute'
           ) as authenticated_execute,
           pg_catalog.has_function_privilege(
             'anon',
             routine.oid,
             'execute'
           ) as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'allocate_product_serial_number'`,
      );
      const sequencePrivileges = await database.query<{
        anonymous_select: boolean;
        anonymous_update: boolean;
        anonymous_usage: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        authenticated_usage: boolean;
      }>(
        `select
           pg_catalog.has_sequence_privilege(
             'authenticated',
             'public.product_serial_number_seq',
             'select'
           ) as authenticated_select,
           pg_catalog.has_sequence_privilege(
             'authenticated',
             'public.product_serial_number_seq',
             'update'
           ) as authenticated_update,
           pg_catalog.has_sequence_privilege(
             'authenticated',
             'public.product_serial_number_seq',
             'usage'
           ) as authenticated_usage,
           pg_catalog.has_sequence_privilege(
             'anon',
             'public.product_serial_number_seq',
             'select'
           ) as anonymous_select,
           pg_catalog.has_sequence_privilege(
             'anon',
             'public.product_serial_number_seq',
             'update'
           ) as anonymous_update,
           pg_catalog.has_sequence_privilege(
             'anon',
             'public.product_serial_number_seq',
             'usage'
           ) as anonymous_usage`,
      );

      expect(allocator.rows).toEqual([
        {
          anonymous_execute: false,
          authenticated_execute: false,
          is_security_definer: true,
          result_type: "text",
          settings: ["search_path=\"\""],
        },
      ]);
      expect(sequencePrivileges.rows).toEqual([
        {
          anonymous_select: false,
          anonymous_update: false,
          anonymous_usage: false,
          authenticated_select: false,
          authenticated_update: false,
          authenticated_usage: false,
        },
      ]);
    });
  });

  it("lets an active Admin create a normalized Component with an active Brand and one audit", async () => {
    const fixture = requireHarness();
    const productName = `Created Product ${randomUUID()}`;
    const category = `Category ${randomUUID()}`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const brandId = randomUUID();

      await database.query(
        `insert into public.brands (
           id,
           name,
           created_by_user_id,
           updated_by_user_id
         )
         values ($1::uuid, $2::text, $3::uuid, $3::uuid)`,
        [
          brandId,
          `Product creation Brand ${randomUUID()}`,
          fixture.actors.admin.profileId,
        ],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<CreatedProductRow>(
        `select *
         from public.create_product($1::text, $2::text, $3::uuid)`,
        [`  ${productName}  `, `  ${category}  `, brandId],
      );
      await database.query("reset role");
      const result = created.rows[0];

      if (!result) {
        throw new Error("Trusted Product creation returned no result");
      }

      const product = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [result.product_id],
      );
      const audit = await database.query<ProductAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product.created'`,
        [result.product_id],
      );

      expect(result.serial_number).toMatch(/^[0-9]{7}$/);
      expect(product.rows).toHaveLength(1);
      expect(product.rows[0]).toMatchObject({
        archived_at: null,
        archived_by_user_id: null,
        brand_id: brandId,
        category,
        created_by_user_id: fixture.actors.admin.profileId,
        id: result.product_id,
        is_active: true,
        name: productName,
        product_kind: "component",
        serial_number: result.serial_number,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(product.rows[0]?.created_at).toEqual(product.rows[0]?.updated_at);
      expect(audit.rows).toEqual([
        {
          action_type: "product.created",
          actor_user_id: fixture.actors.admin.profileId,
          after_data: {
            brand_id: brandId,
            category,
            is_active: true,
            name: productName,
            product_kind: "component",
            serial_number: result.serial_number,
          },
          before_data: null,
          entity_id: result.product_id,
          entity_type: "product",
        },
      ]);
    });
  });

  it("lets inventory.products.create allocate sequential NULL-Brand Components without reuse after rollback", async () => {
    const fixture = requireHarness();
    const actor = fixture.actors.productCreator;

    const createRolledBackProduct = async (
      name: string,
    ): Promise<CreatedProductRow> => {
      return fixture.withRollbackDatabaseTransaction(async (database) => {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const created = await database.query<CreatedProductRow>(
          `select *
           from public.create_product($1::text, $2::text, null)`,
          [name, "Uncategorized Components"],
        );
        await database.query("reset role");
        const result = created.rows[0];

        if (!result) {
          throw new Error("Delegated Product creation returned no result");
        }

        const product = await database.query<ProductRow>(
          "select * from public.products where id = $1::uuid",
          [result.product_id],
        );
        const audit = await database.query<ProductAuditRow>(
          `select actor_user_id, action_type, entity_type, entity_id,
                  before_data, after_data
           from public.audit_logs
           where entity_id = $1::uuid
             and action_type = 'product.created'`,
          [result.product_id],
        );

        expect(product.rows[0]).toMatchObject({
          brand_id: null,
          created_by_user_id: actor.profileId,
          id: result.product_id,
          product_kind: "component",
          serial_number: result.serial_number,
          updated_by_user_id: actor.profileId,
        });
        expect(audit.rows).toHaveLength(1);
        expect(audit.rows[0]).toMatchObject({
          actor_user_id: actor.profileId,
          entity_id: result.product_id,
        });

        return result;
      });
    };

    const first = await createRolledBackProduct(
      `Rolled Back Product ${randomUUID()}`,
    );
    const second = await createRolledBackProduct(
      `Next Product ${randomUUID()}`,
    );

    expect(first.serial_number).toMatch(/^[0-9]{7}$/);
    expect(second.serial_number).toMatch(/^[0-9]{7}$/);
    expect(Number(second.serial_number)).toBe(Number(first.serial_number) + 1);

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const products = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.products
         where id = any($1::uuid[])`,
        [[first.product_id, second.product_id]],
      );
      const audits = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type = 'product.created'`,
        [[first.product_id, second.product_id]],
      );

      expect(products.rows).toEqual([{ count: 0 }]);
      expect(audits.rows).toEqual([{ count: 0 }]);
    });
  });

  it("fails Product creation closed for invalid data, unavailable Brands, and unauthorized actors", async () => {
    const fixture = requireHarness();

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
      fixture.actors.inactiveBrandManager.client,
    ]) {
      const { error } = await client.rpc("create_product", {
        p_name: `Denied Product ${randomUUID()}`,
        p_category: "Category",
      });

      expectPermissionDenied(error);
    }

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const archivedBrandId = randomUUID();
      const missingBrandId = randomUUID();

      await database.query(
        `insert into public.brands (
           id,
           name,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values (
           $1::uuid,
           $2::text,
           false,
           $3::uuid,
           $3::uuid,
           pg_catalog.now(),
           $3::uuid
         )`,
        [
          archivedBrandId,
          `Archived Product Brand ${randomUUID()}`,
          fixture.actors.admin.profileId,
        ],
      );
      const productCountBefore = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.products",
      );
      const auditCountBefore = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where action_type = 'product.created'`,
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");

      for (const [name, category, brandId, errorCode] of [
        ["   ", "Category", null, "22023"],
        [`Product ${randomUUID()}`, "   ", null, "22023"],
        [`Product ${randomUUID()}`, "Category", missingBrandId, "PRD04"],
        [`Product ${randomUUID()}`, "Category", archivedBrandId, "PRD04"],
      ] as const) {
        await database.query("savepoint invalid_product_creation");
        await expect(
          database.query(
            `select *
             from public.create_product($1::text, $2::text, $3::uuid)`,
            [name, category, brandId],
          ),
        ).rejects.toMatchObject({ code: errorCode });
        await database.query("rollback to savepoint invalid_product_creation");
      }

      await database.query("reset role");

      const productCountAfter = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.products",
      );
      const auditCountAfter = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where action_type = 'product.created'`,
      );
      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        arguments: string;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        result_type: string;
        settings: string[];
      }>(
        `select
           pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
           pg_catalog.pg_get_function_result(routine.oid) as result_type,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege(
             'authenticated', routine.oid, 'execute'
           ) as authenticated_execute,
           pg_catalog.has_function_privilege(
             'anon', routine.oid, 'execute'
           ) as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'create_product'`,
      );
      const stockTable = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from information_schema.tables
         where table_schema = 'public'
           and table_name = 'inventory_balances'`,
      );

      expect(productCountAfter.rows).toEqual(productCountBefore.rows);
      expect(auditCountAfter.rows).toEqual(auditCountBefore.rows);
      expect(functionSecurity.rows).toEqual([
        {
          anonymous_execute: false,
          arguments: "p_name text, p_category text, p_brand_id uuid DEFAULT NULL::uuid",
          authenticated_execute: true,
          is_security_definer: true,
          result_type: "TABLE(product_id uuid, serial_number text)",
          settings: ["search_path=\"\""],
        },
      ]);
      expect(stockTable.rows).toEqual([{ count: 1 }]);
    });
  });

  it("creates exactly one whole-number zero InventoryBalance for every existing and future Product", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const missingZeroBalances = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.products as product
         where not exists (
           select 1
           from public.inventory_balances as balance
           where balance.product_id = product.id
             and balance.quantity = 0
         )`,
      );
      expect(missingZeroBalances.rows).toEqual([{ count: 0 }]);

      const activeProductId = randomUUID();
      const archivedProductId = randomUUID();
      await database.query(
        `insert into public.products (
           id,
           serial_number,
           name,
           category,
           product_kind,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $3::text, 'Balance Product', 'Components', 'component',
            true, $5::uuid, $5::uuid, null, null),
           ($2::uuid, $4::text, 'Archived Balance Product', 'Components',
            'pcb_finished_good', false, $5::uuid, $5::uuid,
            pg_catalog.now(), $5::uuid)`,
        [
          activeProductId,
          archivedProductId,
          createTestSerialNumber(),
          createTestSerialNumber(),
          actorId,
        ],
      );

      const balances = await database.query<InventoryBalanceRow>(
        `select product_id, quantity, updated_at
         from public.inventory_balances
         where product_id = any($1::uuid[])
         order by product_id`,
        [[activeProductId, archivedProductId]],
      );
      expect(balances.rows).toHaveLength(2);
      expect(balances.rows.map((balance) => ({
        productId: balance.product_id,
        quantity: balance.quantity,
        updatedAt: balance.updated_at,
      }))).toEqual(expect.arrayContaining([
        {
          productId: activeProductId,
          quantity: "0",
          updatedAt: expect.any(Date),
        },
        {
          productId: archivedProductId,
          quantity: "0",
          updatedAt: expect.any(Date),
        },
      ]));

      await database.query("savepoint duplicate_balance");
      await expect(
        database.query(
          `insert into public.inventory_balances (product_id)
           values ($1::uuid)`,
          [activeProductId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await database.query("rollback to savepoint duplicate_balance");

      await database.query("savepoint negative_balance");
      await expect(
        database.query(
          `update public.inventory_balances
           set quantity = -1
           where product_id = $1::uuid`,
          [activeProductId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await database.query("rollback to savepoint negative_balance");

      await database.query("savepoint fractional_balance");
      await expect(
        database.query(
          `update public.inventory_balances
           set quantity = $2::bigint
           where product_id = $1::uuid`,
          [activeProductId, "1.5"],
        ),
      ).rejects.toMatchObject({ code: "22P02" });
      await database.query("rollback to savepoint fractional_balance");

      const unchanged = await database.query<InventoryBalanceRow>(
        `select product_id, quantity, updated_at
         from public.inventory_balances
         where product_id = $1::uuid`,
        [activeProductId],
      );
      expect(unchanged.rows[0]?.quantity).toBe("0");

      await database.query("savepoint delete_product_with_balance");
      await expect(
        database.query("delete from public.products where id = $1::uuid", [activeProductId]),
      ).rejects.toMatchObject({ code: "23503" });
      await database.query("rollback to savepoint delete_product_with_balance");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<CreatedProductRow>(
        `select product_id, serial_number
         from public.create_product($1::text, $2::text, null)`,
        [`Balance RPC Product ${randomUUID()}`, "Components"],
      );
      await database.query("reset role");
      const createdProductId = created.rows[0]?.product_id;
      const createdBalance = await database.query<InventoryBalanceRow>(
        `select product_id, quantity, updated_at
         from public.inventory_balances
         where product_id = $1::uuid`,
        [createdProductId],
      );
      expect(createdBalance.rows).toEqual([
        {
          product_id: createdProductId,
          quantity: "0",
          updated_at: expect.any(Date),
        },
      ]);

      const columns = await database.query<{
        column_default: string | null;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'inventory_balances'
         order by ordinal_position`,
      );
      expect(columns.rows).toEqual([
        {
          column_default: null,
          column_name: "product_id",
          data_type: "uuid",
          is_nullable: "NO",
        },
        {
          column_default: "0",
          column_name: "quantity",
          data_type: "bigint",
          is_nullable: "NO",
        },
        {
          column_default: "now()",
          column_name: "updated_at",
          data_type: "timestamp with time zone",
          is_nullable: "NO",
        },
      ]);
      const constraints = await database.query<{ constraint_name: string }>(
        `select constraint_name
         from information_schema.table_constraints
         where table_schema = 'public'
           and table_name = 'inventory_balances'
         order by constraint_name`,
      );
      expect(constraints.rows.map((row) => row.constraint_name)).toEqual(
        expect.arrayContaining([
          "inventory_balances_product_id_fkey",
          "inventory_balances_pkey",
          "inventory_balances_quantity_nonnegative",
        ]),
      );
      const movements = await database.query<{ relation: string | null }>(
        "select pg_catalog.to_regclass('public.inventory_movements')::text as relation",
      );
      expect(movements.rows).toEqual([{ relation: "inventory_movements" }]);
    });
  });

  it("limits InventoryBalance reads to Inventory-authorized actors and denies all client writes", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const activeProductId = randomUUID();
      const archivedProductId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind, is_active,
           created_by_user_id, updated_by_user_id, archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $3::text, 'Visible Balance', 'Components', 'component',
            true, $5::uuid, $5::uuid, null, null),
           ($2::uuid, $4::text, 'Historical Balance', 'Components', 'component',
            false, $5::uuid, $5::uuid, pg_catalog.now(), $5::uuid)`,
        [
          activeProductId,
          archivedProductId,
          createTestSerialNumber(),
          createTestSerialNumber(),
          actorId,
        ],
      );

      for (const actor of [fixture.actors.admin, fixture.actors.brandManager]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ product_id: string; quantity: string }>(
          `select product_id, quantity
           from public.inventory_balances
           where product_id = any($1::uuid[])
           order by product_id`,
          [[activeProductId, archivedProductId]],
        );
        await database.query("reset role");
        expect(visible.rows).toHaveLength(2);
        expect(visible.rows.every((row) => row.quantity === "0")).toBe(true);
      }

      for (const actor of [
        fixture.actors.productCreator,
        fixture.actors.productEditor,
        fixture.actors.supplierViewer,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        fixture.actors.inactiveBrandManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ product_id: string }>(
          `select product_id
           from public.inventory_balances
           where product_id = any($1::uuid[])`,
          [[activeProductId, archivedProductId]],
        );
        await database.query("reset role");
        expect(hidden.rows).toEqual([]);
      }

      const security = await database.query<{
        authenticated_delete: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        row_security: boolean;
      }>(
        `select
           class.relrowsecurity as row_security,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'select') as authenticated_select,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'insert') as authenticated_insert,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'update') as authenticated_update,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'delete') as authenticated_delete
         from pg_catalog.pg_class as class
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = class.relnamespace
         where namespace.nspname = 'public'
           and class.relname = 'inventory_balances'`,
      );
      expect(security.rows).toEqual([{
        authenticated_delete: false,
        authenticated_insert: false,
        authenticated_select: true,
        authenticated_update: false,
        row_security: true,
      }]);

      const initializer = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        return_type: string;
        settings: string[];
        trigger_count: number;
      }>(
        `select
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute,
           pg_catalog.pg_get_function_result(routine.oid) as return_type,
           routine.proconfig as settings,
           (
             select count(*)::integer
             from pg_catalog.pg_trigger as trigger
             where trigger.tgfoid = routine.oid
               and not trigger.tgisinternal
           ) as trigger_count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'initialize_product_inventory_balance'`,
      );
      expect(initializer.rows).toEqual([{
        anonymous_execute: false,
        authenticated_execute: false,
        return_type: "trigger",
        settings: ["search_path=\"\""],
        trigger_count: 1,
      }]);
    });

    const client = fixture.actors.admin.client;
    const directInsert = await client.from("inventory_balances").insert({
      product_id: randomUUID(),
      quantity: 0,
    });
    const directUpdate = await client
      .from("inventory_balances")
      .update({ quantity: 1 })
      .eq("product_id", randomUUID());
    const directDelete = await client
      .from("inventory_balances")
      .delete()
      .eq("product_id", randomUUID());
    expectPermissionDenied(directInsert.error);
    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);

    const anonymousRead = await fixture.anonymousClient
      .from("inventory_balances")
      .select("product_id")
      .limit(1);
    expectPermissionDenied(anonymousRead.error);
    const initializerCall = await client.rpc("initialize_product_inventory_balance");
    expect(initializerCall.error).not.toBeNull();
    expect(["42501", "PGRST202"]).toContain(initializerCall.error?.code);
  });

  it("enforces canonical InventoryMovement fields, arithmetic, references, and optional context", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const productId = randomUUID();
      const firstMovementId = randomUUID();
      const secondMovementId = randomUUID();
      const reversalMovementId = randomUUID();
      const sourceId = randomUUID();
      const projectId = randomUUID();

      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         )
         values (
           $1::uuid, $2::text, 'Movement Product', 'Components', 'component',
           $3::uuid, $3::uuid
         )`,
        [productId, createTestSerialNumber(), actorId],
      );
      const balanceBefore = await database.query<InventoryBalanceRow>(
        `select product_id, quantity, updated_at
         from public.inventory_balances
         where product_id = $1::uuid`,
        [productId],
      );

      await database.query(
        `insert into public.inventory_movements (
           id, product_id, movement_type, quantity_delta, quantity_before,
           quantity_after, actor_user_id
         )
         values ($1::uuid, $2::uuid, 'stock_in', 5, 0, 5, $3::uuid)`,
        [firstMovementId, productId, actorId],
      );
      await database.query(
        `insert into public.inventory_movements (
           id, product_id, movement_type, quantity_delta, quantity_before,
           quantity_after, reason, source_type, source_id, project_id,
           actor_user_id
         )
         values (
           $1::uuid, $2::uuid, 'stock_out', -2, 5, 3,
           'Consumed by fixture', 'work_order', $3::uuid, $4::uuid, $5::uuid
         )`,
        [secondMovementId, productId, sourceId, projectId, actorId],
      );
      await database.query(
        `insert into public.inventory_movements (
           id, product_id, movement_type, quantity_delta, quantity_before,
           quantity_after, source_type, actor_user_id,
           reversal_of_movement_id
         )
         values (
           $1::uuid, $2::uuid, 'correction_reversal', -5, 5, 0,
           'correction_reversal', $3::uuid, $4::uuid
         )`,
        [reversalMovementId, productId, actorId, firstMovementId],
      );

      const movements = await database.query<InventoryMovementRow>(
        `select *
         from public.inventory_movements
         where id = any($1::uuid[])
         order by created_at, id`,
        [[firstMovementId, secondMovementId, reversalMovementId]],
      );
      expect(movements.rows).toHaveLength(3);
      expect(movements.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actor_user_id: actorId,
          id: firstMovementId,
          movement_type: "stock_in",
          product_id: productId,
          project_id: null,
          quantity_after: "5",
          quantity_before: "0",
          quantity_delta: "5",
          reason: null,
          reversal_of_movement_id: null,
          source_id: null,
          source_type: null,
        }),
        expect.objectContaining({
          id: secondMovementId,
          project_id: projectId,
          quantity_after: "3",
          quantity_before: "5",
          quantity_delta: "-2",
          reason: "Consumed by fixture",
          source_id: sourceId,
          source_type: "work_order",
        }),
        expect.objectContaining({
          id: reversalMovementId,
          reversal_of_movement_id: firstMovementId,
        }),
      ]));
      expect(movements.rows.every((movement) =>
        movement.created_at instanceof Date)).toBe(true);

      const invalidMovements: Array<{
        errorCode: string;
        sql: string;
        values: unknown[];
      }> = [
        {
          errorCode: "23514",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, actor_user_id
                ) values ($1::uuid, '   ', 1, 0, 1, $2::uuid)`,
          values: [productId, actorId],
        },
        {
          errorCode: "23514",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, reason, actor_user_id
                ) values ($1::uuid, 'stock_in', 1, 0, 1, ' padded ', $2::uuid)`,
          values: [productId, actorId],
        },
        {
          errorCode: "23514",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, source_type, actor_user_id
                ) values ($1::uuid, 'stock_in', 1, 0, 1, '', $2::uuid)`,
          values: [productId, actorId],
        },
        {
          errorCode: "23514",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, actor_user_id
                ) values ($1::uuid, 'stock_in', 2, 1, 2, $2::uuid)`,
          values: [productId, actorId],
        },
        {
          errorCode: "23514",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, actor_user_id
                ) values ($1::uuid, 'stock_in', 1, -1, 0, $2::uuid)`,
          values: [productId, actorId],
        },
        {
          errorCode: "23514",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, actor_user_id
                ) values ($1::uuid, 'stock_out', -1, 0, -1, $2::uuid)`,
          values: [productId, actorId],
        },
        {
          errorCode: "22P02",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, actor_user_id
                ) values (
                  $1::uuid, 'stock_in', $2::bigint, 0, 1, $3::uuid
                )`,
          values: [productId, "1.5", actorId],
        },
        {
          errorCode: "23514",
          sql: `insert into public.inventory_movements (
                  id, product_id, movement_type, quantity_delta,
                  quantity_before, quantity_after, actor_user_id,
                  reversal_of_movement_id
                ) values (
                  $1::uuid, $2::uuid, 'correction_reversal', 0, 0, 0,
                  $3::uuid, $1::uuid
                )`,
          values: [randomUUID(), productId, actorId],
        },
        {
          errorCode: "23503",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, actor_user_id
                ) values ($1::uuid, 'stock_in', 1, 0, 1, $2::uuid)`,
          values: [randomUUID(), actorId],
        },
        {
          errorCode: "23503",
          sql: `insert into public.inventory_movements (
                  product_id, movement_type, quantity_delta, quantity_before,
                  quantity_after, actor_user_id
                ) values ($1::uuid, 'stock_in', 1, 0, 1, $2::uuid)`,
          values: [productId, randomUUID()],
        },
      ];

      for (const invalid of invalidMovements) {
        await database.query("savepoint invalid_inventory_movement");
        await expect(database.query(invalid.sql, invalid.values))
          .rejects.toMatchObject({ code: invalid.errorCode });
        await database.query("rollback to savepoint invalid_inventory_movement");
      }

      const balanceAfter = await database.query<InventoryBalanceRow>(
        `select product_id, quantity, updated_at
         from public.inventory_balances
         where product_id = $1::uuid`,
        [productId],
      );
      expect(balanceAfter.rows).toEqual(balanceBefore.rows);

      const foreignKeys = await database.query<{
        constraint_name: string;
        delete_action: string;
      }>(
        `select
           constraint_name,
           delete_rule as delete_action
         from information_schema.referential_constraints
         where constraint_schema = 'public'
           and constraint_name like 'inventory_movements_%_fkey'
         order by constraint_name`,
      );
      expect(foreignKeys.rows).toEqual([
        {
          constraint_name: "inventory_movements_actor_user_id_fkey",
          delete_action: "RESTRICT",
        },
        {
          constraint_name: "inventory_movements_product_id_fkey",
          delete_action: "RESTRICT",
        },
        {
          constraint_name: "inventory_movements_reversal_of_movement_id_fkey",
          delete_action: "RESTRICT",
        },
      ]);
      const projectOrSourceForeignKey = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from information_schema.key_column_usage
         where constraint_schema = 'public'
           and table_name = 'inventory_movements'
           and column_name in ('project_id', 'source_id')
           and position_in_unique_constraint is not null`,
      );
      expect(projectOrSourceForeignKey.rows).toEqual([{ count: 0 }]);
    });
  });

  it("makes InventoryMovement rows immutable even for trusted database workflows", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const productId = randomUUID();
      const movementId = randomUUID();
      const actorId = fixture.actors.admin.profileId;
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Immutable Movement Product', 'Components',
           'component', $3::uuid, $3::uuid
         )`,
        [productId, createTestSerialNumber(), actorId],
      );
      await database.query(
        `insert into public.inventory_movements (
           id, product_id, movement_type, quantity_delta, quantity_before,
           quantity_after, actor_user_id
         ) values ($1::uuid, $2::uuid, 'stock_in', 4, 0, 4, $3::uuid)`,
        [movementId, productId, actorId],
      );

      await database.query("savepoint update_inventory_movement");
      await expect(
        database.query(
          `update public.inventory_movements
           set reason = 'Rewritten history'
           where id = $1::uuid`,
          [movementId],
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await database.query("rollback to savepoint update_inventory_movement");

      await database.query("savepoint delete_inventory_movement");
      await expect(
        database.query(
          "delete from public.inventory_movements where id = $1::uuid",
          [movementId],
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await database.query("rollback to savepoint delete_inventory_movement");

      const preserved = await database.query<InventoryMovementRow>(
        "select * from public.inventory_movements where id = $1::uuid",
        [movementId],
      );
      expect(preserved.rows).toHaveLength(1);

      const triggerSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        return_type: string;
        settings: string[];
        trigger_count: number;
      }>(
        `select
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute,
           pg_catalog.pg_get_function_result(routine.oid) as return_type,
           routine.proconfig as settings,
           (
             select count(*)::integer
             from pg_catalog.pg_trigger as trigger
             where trigger.tgfoid = routine.oid
               and not trigger.tgisinternal
           ) as trigger_count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'prevent_inventory_movement_mutation'`,
      );
      expect(triggerSecurity.rows).toEqual([{
        anonymous_execute: false,
        authenticated_execute: false,
        return_type: "trigger",
        settings: ["search_path=\"\""],
        trigger_count: 1,
      }]);
      const trustedInserters = await database.query<{ function_name: string }>(
        `select routine.proname as function_name
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.prorettype <> 'trigger'::pg_catalog.regtype
           and routine.prosrc ilike '%insert into public.inventory_movements%'
         order by routine.proname`,
      );
      expect(trustedInserters.rows).toEqual([
        { function_name: "apply_inventory_delta" },
      ]);
    });
  });

  it("limits InventoryMovement reads to Inventory-authorized actors and denies direct client writes", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const activeProductId = randomUUID();
      const archivedProductId = randomUUID();
      const activeMovementId = randomUUID();
      const archivedMovementId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind, is_active,
           created_by_user_id, updated_by_user_id, archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $3::text, 'Movement Read Product', 'Components',
            'component', true, $5::uuid, $5::uuid, null, null),
           ($2::uuid, $4::text, 'Archived Movement Product', 'Components',
            'component', false, $5::uuid, $5::uuid,
            pg_catalog.now(), $5::uuid)`,
        [
          activeProductId,
          archivedProductId,
          createTestSerialNumber(),
          createTestSerialNumber(),
          actorId,
        ],
      );
      await database.query(
        `insert into public.inventory_movements (
           id, product_id, movement_type, quantity_delta, quantity_before,
           quantity_after, actor_user_id
         ) values
           ($1::uuid, $3::uuid, 'stock_in', 1, 0, 1, $5::uuid),
           ($2::uuid, $4::uuid, 'stock_in', 2, 0, 2, $5::uuid)`,
        [activeMovementId, archivedMovementId, activeProductId, archivedProductId, actorId],
      );

      for (const actor of [fixture.actors.admin, fixture.actors.brandManager]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ id: string }>(
          `select id
           from public.inventory_movements
           where id = any($1::uuid[])
           order by id`,
          [[activeMovementId, archivedMovementId]],
        );
        await database.query("reset role");
        expect(visible.rows.map((row) => row.id).sort()).toEqual(
          [activeMovementId, archivedMovementId].sort(),
        );
      }

      for (const actor of [
        fixture.actors.productCreator,
        fixture.actors.productEditor,
        fixture.actors.supplierViewer,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        fixture.actors.inactiveBrandManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ id: string }>(
          `select id
           from public.inventory_movements
           where id = any($1::uuid[])`,
          [[activeMovementId, archivedMovementId]],
        );
        await database.query("reset role");
        expect(hidden.rows).toEqual([]);
      }

      const security = await database.query<{
        authenticated_delete: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        row_security: boolean;
      }>(
        `select
           class.relrowsecurity as row_security,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'select') as authenticated_select,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'insert') as authenticated_insert,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'update') as authenticated_update,
           pg_catalog.has_table_privilege('authenticated', class.oid, 'delete') as authenticated_delete
         from pg_catalog.pg_class as class
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = class.relnamespace
         where namespace.nspname = 'public'
           and class.relname = 'inventory_movements'`,
      );
      expect(security.rows).toEqual([{
        authenticated_delete: false,
        authenticated_insert: false,
        authenticated_select: true,
        authenticated_update: false,
        row_security: true,
      }]);
    });

    const client = fixture.actors.admin.client;
    const directInsert = await client.from("inventory_movements").insert({
      product_id: randomUUID(),
      movement_type: "stock_in",
      quantity_delta: 1,
      quantity_before: 0,
      quantity_after: 1,
      actor_user_id: fixture.actors.admin.profileId,
    });
    const directUpdate = await client
      .from("inventory_movements")
      .update({ reason: "Forbidden" })
      .eq("id", randomUUID());
    const directDelete = await client
      .from("inventory_movements")
      .delete()
      .eq("id", randomUUID());
    expectPermissionDenied(directInsert.error);
    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);

    const anonymousRead = await fixture.anonymousClient
      .from("inventory_movements")
      .select("id")
      .limit(1);
    expectPermissionDenied(anonymousRead.error);
  });

  it("applies trusted Inventory deltas atomically with normalized movement context and no generic audit", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const productId = randomUUID();
      const sourceId = randomUUID();
      const projectId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Delta Product', 'Components', 'component',
           $3::uuid, $3::uuid
         )`,
        [productId, createTestSerialNumber(), actor.profileId],
      );
      const auditBefore = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.audit_logs",
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );

      const positive = await database.query<AppliedInventoryDeltaRow>(
        `select *
         from public.apply_inventory_delta(
           $1::uuid,
           10,
           '  stock_in  ',
           '  Initial receipt  ',
           '  fixture_source  ',
           $2::uuid,
           $3::uuid,
           null
         )`,
        [productId, sourceId, projectId],
      );
      expect(positive.rows).toEqual([{
        movement_id: expect.any(String),
        quantity_after: "10",
        quantity_before: "0",
      }]);

      const negative = await database.query<AppliedInventoryDeltaRow>(
        `select *
         from public.apply_inventory_delta(
           $1::uuid,
           -4,
           ' stock_out ',
           '   ',
           '',
           null,
           null,
           null
         )`,
        [productId],
      );
      expect(negative.rows).toEqual([{
        movement_id: expect.any(String),
        quantity_after: "6",
        quantity_before: "10",
      }]);

      const movementRows = await database.query<InventoryMovementRow>(
        `select *
         from public.inventory_movements
         where id = any($1::uuid[])
         order by created_at, id`,
        [[positive.rows[0]?.movement_id, negative.rows[0]?.movement_id]],
      );
      expect(movementRows.rows).toHaveLength(2);
      expect(movementRows.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actor_user_id: actor.profileId,
          id: positive.rows[0]?.movement_id,
          movement_type: "stock_in",
          product_id: productId,
          project_id: projectId,
          quantity_after: "10",
          quantity_before: "0",
          quantity_delta: "10",
          reason: "Initial receipt",
          source_id: sourceId,
          source_type: "fixture_source",
        }),
        expect.objectContaining({
          actor_user_id: actor.profileId,
          id: negative.rows[0]?.movement_id,
          movement_type: "stock_out",
          project_id: null,
          quantity_after: "6",
          quantity_before: "10",
          quantity_delta: "-4",
          reason: null,
          source_id: null,
          source_type: null,
        }),
      ]));
      const balance = await database.query<InventoryBalanceRow>(
        `select product_id, quantity, updated_at
         from public.inventory_balances
         where product_id = $1::uuid`,
        [productId],
      );
      expect(balance.rows[0]).toMatchObject({
        product_id: productId,
        quantity: "6",
      });
      expect(balance.rows[0]?.updated_at).toEqual(
        movementRows.rows.find((row) =>
          row.id === negative.rows[0]?.movement_id)?.created_at,
      );

      await database.query("savepoint outer_inventory_operation");
      const rolledBack = await database.query<AppliedInventoryDeltaRow>(
        `select *
         from public.apply_inventory_delta($1::uuid, 2, 'stock_in')`,
        [productId],
      );
      await database.query("rollback to savepoint outer_inventory_operation");
      const afterOuterRollback = await database.query<InventoryBalanceRow>(
        `select product_id, quantity, updated_at
         from public.inventory_balances
         where product_id = $1::uuid`,
        [productId],
      );
      const rolledBackMovement = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.inventory_movements
         where id = $1::uuid`,
        [rolledBack.rows[0]?.movement_id],
      );
      expect(afterOuterRollback.rows).toEqual(balance.rows);
      expect(rolledBackMovement.rows).toEqual([{ count: 0 }]);

      const auditAfter = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.audit_logs",
      );
      expect(auditAfter.rows).toEqual(auditBefore.rows);
    });
  });

  it("fails Inventory deltas closed without leaving a balance or movement change", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const productId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Failed Delta Product', 'Components',
           'component', $3::uuid, $3::uuid
         )`,
        [productId, createTestSerialNumber(), actor.profileId],
      );
      await database.query(
        `update public.inventory_balances
         set quantity = 3
         where product_id = $1::uuid`,
        [productId],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );

      for (const [savepoint, sql, values, errorCode] of [
        [
          "negative_inventory_result",
          "select * from public.apply_inventory_delta($1::uuid, -4, 'stock_out')",
          [productId],
          "IVB02",
        ],
        [
          "blank_inventory_movement_type",
          "select * from public.apply_inventory_delta($1::uuid, 1, '   ')",
          [productId],
          "22023",
        ],
        [
          "null_inventory_delta",
          "select * from public.apply_inventory_delta($1::uuid, null, 'stock_in')",
          [productId],
          "22023",
        ],
        [
          "failed_inventory_movement_insert",
          `select *
           from public.apply_inventory_delta(
             $1::uuid, 1, 'correction_reversal', null, null, null, null,
             $2::uuid
           )`,
          [productId, randomUUID()],
          "23503",
        ],
      ] as const) {
        await database.query(`savepoint ${savepoint}`);
        await expect(database.query(sql, [...values]))
          .rejects.toMatchObject({ code: errorCode });
        await database.query(`rollback to savepoint ${savepoint}`);

        const unchangedBalance = await database.query<{ quantity: string }>(
          `select quantity
           from public.inventory_balances
           where product_id = $1::uuid`,
          [productId],
        );
        const movementCount = await database.query<CountResultRow>(
          `select count(*)::integer as count
           from public.inventory_movements
           where product_id = $1::uuid`,
          [productId],
        );
        expect(unchangedBalance.rows).toEqual([{ quantity: "3" }]);
        expect(movementCount.rows).toEqual([{ count: 0 }]);
      }

      await database.query(
        `update public.inventory_balances
         set quantity = 9223372036854775807
         where product_id = $1::uuid`,
        [productId],
      );
      await database.query("savepoint overflowing_inventory_delta");
      await expect(
        database.query(
          "select * from public.apply_inventory_delta($1::uuid, 1, 'stock_in')",
          [productId],
        ),
      ).rejects.toMatchObject({ code: "22003" });
      await database.query("rollback to savepoint overflowing_inventory_delta");
      const afterOverflow = await database.query<{ quantity: string }>(
        `select quantity
         from public.inventory_balances
         where product_id = $1::uuid`,
        [productId],
      );
      expect(afterOverflow.rows).toEqual([{ quantity: "9223372036854775807" }]);

      await database.query(
        "delete from public.inventory_balances where product_id = $1::uuid",
        [productId],
      );
      await database.query("savepoint missing_inventory_balance");
      await expect(
        database.query(
          "select * from public.apply_inventory_delta($1::uuid, 1, 'stock_in')",
          [productId],
        ),
      ).rejects.toMatchObject({ code: "IVB01" });
      await database.query("rollback to savepoint missing_inventory_balance");

      await database.query(
        `insert into public.inventory_balances (product_id, quantity)
         values ($1::uuid, 0)`,
        [productId],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.inactive.authUserId],
      );
      await database.query("savepoint inactive_inventory_actor");
      await expect(
        database.query(
          "select * from public.apply_inventory_delta($1::uuid, 1, 'stock_in')",
          [productId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint inactive_inventory_actor");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', '', true)",
      );
      await database.query("savepoint anonymous_inventory_actor");
      await expect(
        database.query(
          "select * from public.apply_inventory_delta($1::uuid, 1, 'stock_in')",
          [productId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_inventory_actor");
      const finalBalance = await database.query<{ quantity: string }>(
        `select quantity
         from public.inventory_balances
         where product_id = $1::uuid`,
        [productId],
      );
      expect(finalBalance.rows).toEqual([{ quantity: "0" }]);
    });
  });

  it("serializes competing deductions on one Product and prevents overspending", async () => {
    const fixture = requireHarness();
    const productId = randomUUID();
    const applicationName = `alfaev-inventory-wait-${randomUUID()}`;

    await fixture.withDatabaseClients(3, async (clients) => {
      const first = clients[0];
      const second = clients[1];
      const observer = clients[2];
      if (!first || !second || !observer) {
        throw new Error("Inventory concurrency clients are unavailable");
      }

      await observer.query("begin");
      await observer.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Concurrent Delta Product', 'Components',
           'component', $3::uuid, $3::uuid
         )`,
        [
          productId,
          createTestSerialNumber(),
          fixture.actors.admin.profileId,
        ],
      );
      await observer.query(
        `update public.inventory_balances
         set quantity = 5
         where product_id = $1::uuid`,
        [productId],
      );
      await observer.query("commit");

      try {
        await first.query("begin");
        await first.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        const firstDeduction = await first.query<AppliedInventoryDeltaRow>(
          "select * from public.apply_inventory_delta($1::uuid, -4, 'stock_out')",
          [productId],
        );
        expect(firstDeduction.rows).toEqual([{
          movement_id: expect.any(String),
          quantity_after: "1",
          quantity_before: "5",
        }]);

        await second.query("begin");
        await second.query(
          "select pg_catalog.set_config('application_name', $1::text, true)",
          [applicationName],
        );
        await second.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        const competingDeduction = second.query(
          "select * from public.apply_inventory_delta($1::uuid, -6, 'stock_out')",
          [productId],
        ).then(
          () => null,
          (error: unknown) => error,
        );

        let observedBalanceWait = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = await observer.query<ActivityWaitRow>(
            `select wait_event_type, wait_event
             from pg_catalog.pg_stat_activity
             where application_name = $1::text`,
            [applicationName],
          );
          if (activity.rows[0]?.wait_event_type === "Lock") {
            observedBalanceWait = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(observedBalanceWait).toBe(true);

        const committedWhileWaiting = await observer.query<{
          movement_count: number;
          quantity: string;
        }>(
          `select
             balance.quantity,
             (
               select count(*)::integer
               from public.inventory_movements as movement
               where movement.product_id = balance.product_id
             ) as movement_count
           from public.inventory_balances as balance
           where balance.product_id = $1::uuid`,
          [productId],
        );
        expect(committedWhileWaiting.rows).toEqual([{
          movement_count: 0,
          quantity: "5",
        }]);

        await first.query("rollback");
        const competingError = await competingDeduction;
        expect(competingError).toMatchObject({ code: "IVB02" });
        await second.query("rollback");

        const finalState = await observer.query<{
          movement_count: number;
          quantity: string;
        }>(
          `select
             balance.quantity,
             (
               select count(*)::integer
               from public.inventory_movements as movement
               where movement.product_id = balance.product_id
             ) as movement_count
           from public.inventory_balances as balance
           where balance.product_id = $1::uuid`,
          [productId],
        );
        expect(finalState.rows).toEqual([{
          movement_count: 0,
          quantity: "5",
        }]);
      } finally {
        await first.query("rollback");
        await second.query("rollback");
        await observer.query("begin");
        await observer.query(
          "delete from public.inventory_balances where product_id = $1::uuid",
          [productId],
        );
        await observer.query(
          "delete from public.products where id = $1::uuid",
          [productId],
        );
        await observer.query("commit");
      }
    });
  });

  it("keeps the Inventory primitive internal, permission-neutral, and client inaccessible", async () => {
    const fixture = requireHarness();
    const rpcArguments = {
      p_product_id: randomUUID(),
      p_quantity_delta: 1,
      p_movement_type: "stock_in",
    };

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.admin.client,
      fixture.actors.unpermitted.client,
    ]) {
      const { error } = await client.rpc("apply_inventory_delta", rpcArguments);
      expectPermissionDenied(error);
    }

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const primitive = await database.query<{
        anonymous_execute: boolean;
        arguments: string;
        authenticated_execute: boolean;
        definition: string;
        is_security_definer: boolean;
        result_type: string;
        settings: string[];
      }>(
        `select
           pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
           pg_catalog.pg_get_function_result(routine.oid) as result_type,
           pg_catalog.pg_get_functiondef(routine.oid) as definition,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege(
             'authenticated', routine.oid, 'execute'
           ) as authenticated_execute,
           pg_catalog.has_function_privilege(
             'anon', routine.oid, 'execute'
           ) as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'apply_inventory_delta'`,
      );
      expect(primitive.rows).toHaveLength(1);
      expect(primitive.rows[0]).toMatchObject({
        anonymous_execute: false,
        authenticated_execute: false,
        is_security_definer: true,
        result_type: "TABLE(movement_id uuid, quantity_before bigint, quantity_after bigint)",
        settings: ["search_path=\"\""],
      });
      expect(primitive.rows[0]?.arguments).not.toMatch(/actor/i);
      const definition = primitive.rows[0]?.definition.toLowerCase() ?? "";
      expect(definition).toContain("current_active_user_profile_id");
      expect(definition).toContain("for update");
      expect(definition).toContain("for share");
      expect(definition).not.toContain("has_permission");
      expect(definition).not.toContain("current_user_is_admin");
      expect(definition).not.toContain("append_audit_log");
    });
  });

  it("lets Admin update normalized Product master data with an active Brand and one audit", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const productId = randomUUID();
      const activeBrandId = randomUUID();
      const serialNumber = createTestSerialNumber();

      await database.query(
        `insert into public.brands (
           id,
           name,
           created_by_user_id,
           updated_by_user_id
         )
         values ($1::uuid, $2::text, $3::uuid, $3::uuid)`,
        [
          activeBrandId,
          `Product edit Brand ${randomUUID()}`,
          fixture.actors.admin.profileId,
        ],
      );
      await database.query(
        `insert into public.products (
           id,
           serial_number,
           name,
           category,
           product_kind,
           created_by_user_id,
           updated_by_user_id
         )
         values ($1::uuid, $2::text, 'Old Name', 'Old Category', 'component', $3::uuid, $3::uuid)`,
        [productId, serialNumber, fixture.actors.admin.profileId],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const updated = await database.query<{ product_id: string }>(
        `select public.update_product(
           $1::uuid,
           $2::text,
           $3::text,
           $4::uuid
         ) as product_id`,
        [productId, "  Updated Name  ", "  Updated Category  ", activeBrandId],
      );
      await database.query("reset role");

      const product = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [productId],
      );
      const audit = await database.query<ProductAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product.updated'`,
        [productId],
      );

      expect(updated.rows).toEqual([{ product_id: productId }]);
      expect(product.rows[0]).toMatchObject({
        brand_id: activeBrandId,
        category: "Updated Category",
        id: productId,
        name: "Updated Name",
        product_kind: "component",
        serial_number: serialNumber,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(audit.rows).toEqual([
        {
          action_type: "product.updated",
          actor_user_id: fixture.actors.admin.profileId,
          after_data: {
            brand_id: activeBrandId,
            category: "Updated Category",
            is_active: true,
            name: "Updated Name",
            product_kind: "component",
            serial_number: serialNumber,
          },
          before_data: {
            brand_id: null,
            category: "Old Category",
            is_active: true,
            name: "Old Name",
            product_kind: "component",
            serial_number: serialNumber,
          },
          entity_id: productId,
          entity_type: "product",
        },
      ]);

      const updatedAt = product.rows[0]?.updated_at;
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query(
        `select public.update_product($1::uuid, $2::text, $3::text, $4::uuid)`,
        [
          productId,
          "  Updated Name  ",
          "  Updated Category  ",
          activeBrandId,
        ],
      );
      await database.query("reset role");
      const afterNoop = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [productId],
      );
      const auditAfterNoop = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product.updated'`,
        [productId],
      );

      expect(afterNoop.rows[0]?.updated_at).toEqual(updatedAt);
      expect(auditAfterNoop.rows).toEqual([{ count: 1 }]);
    });
  });

  it("lets inventory.products.edit preserve its current archived Brand, clear it, and assign an active Brand", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const productId = randomUUID();
      const archivedBrandId = randomUUID();
      const activeBrandId = randomUUID();
      const serialNumber = createTestSerialNumber();

      await database.query(
        `insert into public.brands (
           id,
           name,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $2::text, false, $4::uuid, $4::uuid, pg_catalog.now(), $4::uuid),
           ($3::uuid, $5::text, true, $4::uuid, $4::uuid, null, null)`,
        [
          archivedBrandId,
          `Current Archived Brand ${randomUUID()}`,
          activeBrandId,
          fixture.actors.admin.profileId,
          `Active Replacement Brand ${randomUUID()}`,
        ],
      );
      await database.query(
        `insert into public.products (
           id,
           serial_number,
           name,
           category,
           brand_id,
           product_kind,
           created_by_user_id,
           updated_by_user_id
         )
         values ($1::uuid, $2::text, 'Historical Brand Product', 'Category', $3::uuid, 'pcb_finished_good', $4::uuid, $4::uuid)`,
        [
          productId,
          serialNumber,
          archivedBrandId,
          fixture.actors.admin.profileId,
        ],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.productEditor.authUserId],
      );
      await database.query("set local role authenticated");

      await database.query(
        `select public.update_product($1::uuid, 'Renamed Product', 'Category', $2::uuid)`,
        [productId, archivedBrandId],
      );
      await database.query(
        `select public.update_product($1::uuid, 'Renamed Product', 'Category', null)`,
        [productId],
      );
      await database.query(
        `select public.update_product($1::uuid, 'Renamed Product', 'Category', $2::uuid)`,
        [productId, activeBrandId],
      );
      await database.query("reset role");

      const product = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [productId],
      );
      const audits = await database.query<ProductAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product.updated'
         order by created_at`,
        [productId],
      );

      expect(product.rows[0]).toMatchObject({
        brand_id: activeBrandId,
        id: productId,
        name: "Renamed Product",
        product_kind: "pcb_finished_good",
        serial_number: serialNumber,
        updated_by_user_id: fixture.actors.productEditor.profileId,
      });
      expect(audits.rows).toHaveLength(3);
      expect(audits.rows.every((row) =>
        row.actor_user_id === fixture.actors.productEditor.profileId
      )).toBe(true);
    });
  });

  it("fails Product updates closed for unauthorized actors, invalid state/data, and unavailable new Brands", async () => {
    const fixture = requireHarness();

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
      fixture.actors.inactiveBrandManager.client,
    ]) {
      const { error } = await client.rpc("update_product", {
        p_product_id: randomUUID(),
        p_name: "Denied Product",
        p_category: "Category",
        p_brand_id: null,
      });

      expectPermissionDenied(error);
    }

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const activeProductId = randomUUID();
      const archivedProductId = randomUUID();
      const archivedBrandId = randomUUID();
      const missingBrandId = randomUUID();
      const activeSerial = createTestSerialNumber();
      let archivedSerial = createTestSerialNumber();
      while (archivedSerial === activeSerial) archivedSerial = createTestSerialNumber();

      await database.query(
        `insert into public.brands (
           id,
           name,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values ($1::uuid, $2::text, false, $3::uuid, $3::uuid, pg_catalog.now(), $3::uuid)`,
        [
          archivedBrandId,
          `Unavailable Brand ${randomUUID()}`,
          fixture.actors.admin.profileId,
        ],
      );
      await database.query(
        `insert into public.products (
           id,
           serial_number,
           name,
           category,
           product_kind,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $2::text, 'Active Product', 'Category', 'component', true, $5::uuid, $5::uuid, null, null),
           ($3::uuid, $4::text, 'Archived Product', 'Category', 'component', false, $5::uuid, $5::uuid, pg_catalog.now(), $5::uuid)`,
        [
          activeProductId,
          activeSerial,
          archivedProductId,
          archivedSerial,
          fixture.actors.admin.profileId,
        ],
      );
      const beforeProduct = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [activeProductId],
      );
      const auditBefore = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where action_type = 'product.updated'`,
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");

      for (const [productId, name, category, brandId, errorCode] of [
        [activeProductId, "   ", "Category", null, "22023"],
        [activeProductId, "Active Product", "   ", null, "22023"],
        [activeProductId, "Active Product", "Category", missingBrandId, "PRD04"],
        [activeProductId, "Active Product", "Category", archivedBrandId, "PRD04"],
        [archivedProductId, "Changed", "Category", null, "PRD01"],
        [randomUUID(), "Missing", "Category", null, "P0002"],
      ] as const) {
        await database.query("savepoint invalid_product_update");
        await expect(
          database.query(
            `select public.update_product($1::uuid, $2::text, $3::text, $4::uuid)`,
            [productId, name, category, brandId],
          ),
        ).rejects.toMatchObject({ code: errorCode });
        await database.query("rollback to savepoint invalid_product_update");
      }

      await database.query("reset role");
      const afterProduct = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [activeProductId],
      );
      const auditAfter = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where action_type = 'product.updated'`,
      );
      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        arguments: string;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        result_type: string;
        settings: string[];
      }>(
        `select
           pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
           pg_catalog.pg_get_function_result(routine.oid) as result_type,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'update_product'`,
      );

      expect(afterProduct.rows).toEqual(beforeProduct.rows);
      expect(auditAfter.rows).toEqual(auditBefore.rows);
      expect(functionSecurity.rows).toEqual([
        {
          anonymous_execute: false,
          arguments: "p_product_id uuid, p_name text, p_category text, p_brand_id uuid",
          authenticated_execute: true,
          is_security_definer: true,
          result_type: "uuid",
          settings: ["search_path=\"\""],
        },
      ]);
    });

    const directUpdate = await fixture.actors.productEditor.client
      .from("products")
      .update({ name: "Forbidden direct edit" })
      .eq("id", randomUUID());
    expectPermissionDenied(directUpdate.error);
  });

  it("archives a Product atomically with canonical lifecycle metadata and audit", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const productId = randomUUID();
      const serialNumber = createTestSerialNumber();

      await database.query(
        `insert into public.products (
           id,
           serial_number,
           name,
           category,
           product_kind,
           created_by_user_id,
           updated_by_user_id
         )
         values ($1::uuid, $2::text, 'Archive Candidate', 'Controls',
                 'component', $3::uuid, $3::uuid)`,
        [productId, serialNumber, fixture.actors.admin.profileId],
      );
      const before = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [productId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const archived = await database.query<{ product_id: string }>(
        "select public.archive_product($1::uuid) as product_id",
        [productId],
      );
      await database.query("reset role");

      const after = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [productId],
      );
      const audits = await database.query<ProductAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product.archived'`,
        [productId],
      );
      const current = after.rows[0];
      const original = before.rows[0];

      expect(archived.rows).toEqual([{ product_id: productId }]);
      expect(current).toMatchObject({
        archived_by_user_id: fixture.actors.admin.profileId,
        brand_id: original?.brand_id,
        category: original?.category,
        id: productId,
        is_active: false,
        name: original?.name,
        product_kind: original?.product_kind,
        serial_number: original?.serial_number,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(current?.archived_at).toBeInstanceOf(Date);
      expect(current?.updated_at).toEqual(current?.archived_at);
      expect(current?.created_at).toEqual(original?.created_at);
      expect(audits.rows).toHaveLength(1);
      expect(audits.rows[0]).toMatchObject({
        actor_user_id: fixture.actors.admin.profileId,
        action_type: "product.archived",
        entity_id: productId,
        entity_type: "product",
        before_data: {
          brand_id: null,
          category: "Controls",
          is_active: true,
          name: "Archive Candidate",
          product_kind: "component",
          serial_number: serialNumber,
        },
        after_data: {
          archived_by_user_id: fixture.actors.admin.profileId,
          brand_id: null,
          category: "Controls",
          is_active: false,
          name: "Archive Candidate",
          product_kind: "component",
          serial_number: serialNumber,
        },
      });

      await database.query("set local role authenticated");
      const readable = await database.query<{ id: string }>(
        "select id from public.products where id = $1::uuid",
        [productId],
      );
      expect(readable.rows).toEqual([{ id: productId }]);

      await database.query("savepoint repeat_product_archive");
      await expect(
        database.query("select public.archive_product($1::uuid)", [productId]),
      ).rejects.toMatchObject({ code: "PRD01" });
      await database.query("rollback to savepoint repeat_product_archive");

      await database.query("savepoint edit_archived_product");
      await expect(
        database.query(
          `select public.update_product(
             $1::uuid,
             'Forbidden edit',
             'Controls',
             null
           )`,
          [productId],
        ),
      ).rejects.toMatchObject({ code: "PRD01" });
      await database.query("rollback to savepoint edit_archived_product");
      await database.query("reset role");

      const afterFailures = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [productId],
      );
      const auditAfterFailures = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product.archived'`,
        [productId],
      );
      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        arguments: string;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        result_type: string;
        settings: string[];
      }>(
        `select
           pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
           pg_catalog.pg_get_function_result(routine.oid) as result_type,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'archive_product'`,
      );

      expect(afterFailures.rows).toEqual(after.rows);
      expect(auditAfterFailures.rows).toEqual([{ count: 1 }]);
      expect(functionSecurity.rows).toEqual([
        {
          anonymous_execute: false,
          arguments: "p_product_id uuid",
          authenticated_execute: true,
          is_security_definer: true,
          result_type: "uuid",
          settings: ["search_path=\"\""],
        },
      ]);
    });
  });

  it("limits Product archive to Admin or inventory.products.edit and fails safely", async () => {
    const fixture = requireHarness();

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.productCreator.client,
      fixture.actors.brandManager.client,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
      fixture.actors.inactiveBrandManager.client,
    ]) {
      const { error } = await client.rpc("archive_product", {
        p_product_id: randomUUID(),
      });

      expectPermissionDenied(error);
    }

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const productId = randomUUID();
      const serialNumber = createTestSerialNumber();

      await database.query(
        `insert into public.products (
           id,
           serial_number,
           name,
           category,
           product_kind,
           created_by_user_id,
           updated_by_user_id
         )
         values ($1::uuid, $2::text, 'Editor Archive', 'Controls',
                 'component', $3::uuid, $3::uuid)`,
        [productId, serialNumber, fixture.actors.admin.profileId],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.productEditor.authUserId],
      );
      await database.query("set local role authenticated");
      const archived = await database.query<{ product_id: string }>(
        "select public.archive_product($1::uuid) as product_id",
        [productId],
      );
      await database.query("reset role");

      const product = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [productId],
      );
      const audit = await database.query<ProductAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product.archived'`,
        [productId],
      );

      expect(archived.rows).toEqual([{ product_id: productId }]);
      expect(product.rows[0]).toMatchObject({
        archived_by_user_id: fixture.actors.productEditor.profileId,
        is_active: false,
      });
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]?.actor_user_id)
        .toBe(fixture.actors.productEditor.profileId);

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint missing_product_archive");
      await expect(
        database.query("select public.archive_product($1::uuid)", [randomUUID()]),
      ).rejects.toMatchObject({ code: "P0002" });
      await database.query("rollback to savepoint missing_product_archive");
      await database.query("savepoint null_product_archive");
      await expect(
        database.query("select public.archive_product(null::uuid)"),
      ).rejects.toMatchObject({ code: "22023" });
      await database.query("rollback to savepoint null_product_archive");
      await database.query("reset role");

      const failedAudit = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where action_type = 'product.archived'
           and entity_id <> $1::uuid`,
        [productId],
      );
      expect(failedAudit.rows).toEqual([{ count: 0 }]);
    });

    const directUpdate = await fixture.actors.productEditor.client
      .from("products")
      .update({ is_active: false })
      .eq("id", randomUUID());
    const directDelete = await fixture.actors.productEditor.client
      .from("products")
      .delete()
      .eq("id", randomUUID());

    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);
  });

  it("enforces ProductSupplier schema, duplicate, FK, and lifecycle invariants", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const productOneId = randomUUID();
      const productTwoId = randomUUID();
      const supplierId = randomUUID();
      const nullCatalogRelationId = randomUUID();
      const catalogRelationId = randomUUID();
      const differentCatalogRelationId = randomUUID();
      const sharedCatalogRelationId = randomUUID();
      const productOneSerial = createTestSerialNumber();
      let productTwoSerial = createTestSerialNumber();

      while (productTwoSerial === productOneSerial) {
        productTwoSerial = createTestSerialNumber();
      }

      await database.query(
        `insert into public.suppliers (
           id,
           name,
           country,
           created_by_user_id,
           updated_by_user_id
         )
         values ($1::uuid, $2::text, 'Germany', $3::uuid, $3::uuid)`,
        [supplierId, `ProductSupplier Test ${randomUUID()}`, actorId],
      );
      await database.query(
        `insert into public.products (
           id,
           serial_number,
           name,
           category,
           product_kind,
           created_by_user_id,
           updated_by_user_id
         )
         values
           ($1::uuid, $2::text, 'Linked Product One', 'Components',
            'component', $5::uuid, $5::uuid),
           ($3::uuid, $4::text, 'Linked Product Two', 'Components',
            'component', $5::uuid, $5::uuid)`,
        [
          productOneId,
          productOneSerial,
          productTwoId,
          productTwoSerial,
          actorId,
        ],
      );
      await database.query(
        `insert into public.product_suppliers (
           id,
           product_id,
           supplier_id,
           catalog_number,
           created_by_user_id,
           updated_by_user_id
         )
         values
           ($1::uuid, $5::uuid, $7::uuid, null, $8::uuid, $8::uuid),
           ($2::uuid, $5::uuid, $7::uuid, 'Cat-AbC', $8::uuid, $8::uuid),
           ($3::uuid, $5::uuid, $7::uuid, 'CAT-OTHER', $8::uuid, $8::uuid),
           ($4::uuid, $6::uuid, $7::uuid, 'Cat-AbC', $8::uuid, $8::uuid)`,
        [
          nullCatalogRelationId,
          catalogRelationId,
          differentCatalogRelationId,
          sharedCatalogRelationId,
          productOneId,
          productTwoId,
          supplierId,
          actorId,
        ],
      );

      const validRows = await database.query<ProductSupplierRow>(
        `select *
         from public.product_suppliers
         where id = any($1::uuid[])
         order by id`,
        [[
          nullCatalogRelationId,
          catalogRelationId,
          differentCatalogRelationId,
          sharedCatalogRelationId,
        ]],
      );
      const nullCatalog = validRows.rows.find(
        (row) => row.id === nullCatalogRelationId,
      );
      const preservedCase = validRows.rows.find(
        (row) => row.id === catalogRelationId,
      );

      expect(validRows.rows).toHaveLength(4);
      expect(nullCatalog).toMatchObject({
        archived_at: null,
        archived_by_user_id: null,
        catalog_number: null,
        is_active: true,
        product_id: productOneId,
        supplier_id: supplierId,
      });
      expect(nullCatalog?.created_at).toEqual(nullCatalog?.updated_at);
      expect(preservedCase?.catalog_number).toBe("Cat-AbC");

      for (const catalogNumber of [null, "Cat-AbC"] as const) {
        await database.query("savepoint duplicate_product_supplier");
        await expect(
          database.query(
            `insert into public.product_suppliers (
               product_id,
               supplier_id,
               catalog_number,
               created_by_user_id,
               updated_by_user_id
             )
             values ($1::uuid, $2::uuid, $3::text, $4::uuid, $4::uuid)`,
            [productOneId, supplierId, catalogNumber, actorId],
          ),
        ).rejects.toMatchObject({ code: "23505" });
        await database.query("rollback to savepoint duplicate_product_supplier");
      }

      for (const catalogNumber of ["", "   ", " Untrimmed"] as const) {
        await database.query("savepoint invalid_product_supplier_catalog");
        await expect(
          database.query(
            `insert into public.product_suppliers (
               product_id,
               supplier_id,
               catalog_number,
               created_by_user_id,
               updated_by_user_id
             )
             values ($1::uuid, $2::uuid, $3::text, $4::uuid, $4::uuid)`,
            [productTwoId, supplierId, catalogNumber, actorId],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await database.query("rollback to savepoint invalid_product_supplier_catalog");
      }

      for (const [isActive, archivedAt, archivedBy] of [
        [true, new Date(), actorId],
        [false, null, null],
      ] as const) {
        await database.query("savepoint invalid_product_supplier_lifecycle");
        await expect(
          database.query(
            `insert into public.product_suppliers (
               product_id,
               supplier_id,
               catalog_number,
               is_active,
               created_by_user_id,
               updated_by_user_id,
               archived_at,
               archived_by_user_id
             )
             values ($1::uuid, $2::uuid, $3::text, $4::boolean,
                     $5::uuid, $5::uuid, $6::timestamptz, $7::uuid)`,
            [
              productTwoId,
              supplierId,
              `STATE-${randomUUID()}`,
              isActive,
              actorId,
              archivedAt,
              archivedBy,
            ],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await database.query("rollback to savepoint invalid_product_supplier_lifecycle");
      }

      await database.query(
        `update public.product_suppliers
         set is_active = false,
             updated_at = pg_catalog.now(),
             updated_by_user_id = $2::uuid,
             archived_at = pg_catalog.now(),
             archived_by_user_id = $2::uuid
         where id = $1::uuid`,
        [catalogRelationId, actorId],
      );
      const archivedBefore = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [catalogRelationId],
      );

      expect(archivedBefore.rows[0]).toMatchObject({
        archived_by_user_id: actorId,
        catalog_number: "Cat-AbC",
        is_active: false,
      });
      expect(archivedBefore.rows[0]?.archived_at).toBeInstanceOf(Date);

      await database.query("savepoint immutable_archived_product_supplier");
      await expect(
        database.query(
          `update public.product_suppliers
           set catalog_number = 'FORBIDDEN'
           where id = $1::uuid`,
          [catalogRelationId],
        ),
      ).rejects.toMatchObject({ code: "PSR01" });
      await database.query("rollback to savepoint immutable_archived_product_supplier");

      const archivedAfter = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [catalogRelationId],
      );
      expect(archivedAfter.rows).toEqual(archivedBefore.rows);

      await database.query("savepoint referenced_product_delete");
      await expect(
        database.query(
          "delete from public.products where id = $1::uuid",
          [productOneId],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await database.query("rollback to savepoint referenced_product_delete");

      await database.query("savepoint referenced_supplier_delete");
      await expect(
        database.query(
          "delete from public.suppliers where id = $1::uuid",
          [supplierId],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await database.query("rollback to savepoint referenced_supplier_delete");

      const tableSecurity = await database.query<{
        authenticated_delete: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        row_security: boolean;
      }>(
        `select
           table_info.relrowsecurity as row_security,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'select') as authenticated_select,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'insert') as authenticated_insert,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'update') as authenticated_update,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'delete') as authenticated_delete
         from pg_catalog.pg_class as table_info
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = table_info.relnamespace
         where namespace.nspname = 'public'
           and table_info.relname = 'product_suppliers'`,
      );
      const duplicateConstraint = await database.query<{
        nulls_not_distinct: boolean;
      }>(
        `select index_info.indnullsnotdistinct as nulls_not_distinct
         from pg_catalog.pg_index as index_info
         join pg_catalog.pg_class as index_object
           on index_object.oid = index_info.indexrelid
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = index_object.relnamespace
         where namespace.nspname = 'public'
           and index_object.relname = 'product_suppliers_product_supplier_catalog_key'`,
      );
      const lifecycleFunction = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        settings: string[];
      }>(
        `select
           routine.proconfig as settings,
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'enforce_product_supplier_lifecycle_immutability'`,
      );
      const unsupportedMutationFunctions = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'delete_product_supplier',
             'restore_product_supplier',
             'reactivate_product_supplier',
             'unarchive_product_supplier'
           )`,
      );

      expect(tableSecurity.rows).toEqual([
        {
          authenticated_delete: false,
          authenticated_insert: false,
          authenticated_select: true,
          authenticated_update: false,
          row_security: true,
        },
      ]);
      expect(duplicateConstraint.rows).toEqual([{ nulls_not_distinct: true }]);
      expect(lifecycleFunction.rows).toEqual([
        {
          anonymous_execute: false,
          authenticated_execute: false,
          settings: ["search_path=\"\""],
        },
      ]);
      expect(unsupportedMutationFunctions.rows).toEqual([{ count: 0 }]);
    });
  });

  it("allows either ProductSupplier view permission and denies all direct client writes", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const productId = randomUUID();
      const supplierId = randomUUID();
      const activeRelationId = randomUUID();
      const archivedRelationId = randomUUID();

      await database.query(
        `insert into public.suppliers (
           id,
           name,
           country,
           created_by_user_id,
           updated_by_user_id
         )
         values ($1::uuid, $2::text, 'Germany', $3::uuid, $3::uuid)`,
        [supplierId, `RLS Supplier ${randomUUID()}`, actorId],
      );
      await database.query(
        `insert into public.products (
           id,
           serial_number,
           name,
           category,
           product_kind,
           created_by_user_id,
           updated_by_user_id
         )
         values ($1::uuid, $2::text, 'RLS Product', 'Components',
                 'component', $3::uuid, $3::uuid)`,
        [productId, createTestSerialNumber(), actorId],
      );
      await database.query(
        `insert into public.product_suppliers (
           id,
           product_id,
           supplier_id,
           catalog_number,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $3::uuid, $4::uuid, 'ACTIVE', true,
            $5::uuid, $5::uuid, null, null),
           ($2::uuid, $3::uuid, $4::uuid, 'ARCHIVED', false,
            $5::uuid, $5::uuid, pg_catalog.now(), $5::uuid)`,
        [activeRelationId, archivedRelationId, productId, supplierId, actorId],
      );

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.brandManager,
        fixture.actors.supplierViewer,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ id: string }>(
          `select id
           from public.product_suppliers
           where id = any($1::uuid[])
           order by id`,
          [[activeRelationId, archivedRelationId]],
        );
        await database.query("reset role");

        expect(visible.rows.map((row) => row.id).sort()).toEqual(
          [activeRelationId, archivedRelationId].sort(),
        );
      }

      for (const actor of [
        fixture.actors.productCreator,
        fixture.actors.productEditor,
        fixture.actors.supplierEditor,
        fixture.actors.unpermitted,
        fixture.actors.inactiveBrandManager,
        fixture.actors.inactiveSupplierManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ id: string }>(
          `select id
           from public.product_suppliers
           where id = any($1::uuid[])`,
          [[activeRelationId, archivedRelationId]],
        );
        await database.query("reset role");

        expect(hidden.rows).toEqual([]);
      }

      await database.query("savepoint anonymous_product_supplier_read");
      await database.query("set local role anon");
      await expect(
        database.query("select id from public.product_suppliers limit 1"),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_product_supplier_read");
      await database.query("reset role");
    });

    const client = fixture.actors.supplierViewer.client;
    const directInsert = await client.from("product_suppliers").insert({
      product_id: randomUUID(),
      supplier_id: randomUUID(),
      catalog_number: "DIRECT",
      created_by_user_id: fixture.actors.supplierViewer.profileId,
      updated_by_user_id: fixture.actors.supplierViewer.profileId,
    });
    const directUpdate = await client
      .from("product_suppliers")
      .update({ catalog_number: "FORBIDDEN" })
      .eq("id", randomUUID());
    const directDelete = await client
      .from("product_suppliers")
      .delete()
      .eq("id", randomUUID());

    expectPermissionDenied(directInsert.error);
    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);
  });

  it("exposes only minimal trusted ProductSupplier reads without broadening Supplier RLS", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const endpoints = await createProductSupplierEndpoints(database, actorId);
      const archivedSupplierId = randomUUID();
      const activeRelationId = randomUUID();
      const archivedRelationId = randomUUID();
      const activeSupplierName = `Active Choice ${randomUUID()}`;
      const archivedSupplierName = `Archived History ${randomUUID()}`;

      await database.query(
        `update public.suppliers
         set name = $2::text
         where id = $1::uuid`,
        [endpoints.supplierId, activeSupplierName],
      );
      await database.query(
        `insert into public.suppliers (
           id,
           name,
           country,
           contact_person_name,
           contact_phone,
           contact_email,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values (
           $1::uuid,
           $2::text,
           'Secret Country',
           'Secret Contact',
           '+000000000',
           'secret@example.com',
           false,
           $3::uuid,
           $3::uuid,
           pg_catalog.now(),
           $3::uuid
         )`,
        [archivedSupplierId, archivedSupplierName, actorId],
      );
      await database.query(
        `insert into public.product_suppliers (
           id,
           product_id,
           supplier_id,
           catalog_number,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $3::uuid, $4::uuid, 'ACTIVE-CAT', true,
            $6::uuid, $6::uuid, null, null),
           ($2::uuid, $3::uuid, $5::uuid, null, false,
            $6::uuid, $6::uuid, pg_catalog.now(), $6::uuid)`,
        [
          activeRelationId,
          archivedRelationId,
          endpoints.productId,
          endpoints.supplierId,
          archivedSupplierId,
          actorId,
        ],
      );

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.brandManager,
        fixture.actors.supplierViewer,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const rows = await database.query<ProductSupplierReadRow>(
          `select *
           from public.get_product_suppliers_for_product($1::uuid)`,
          [endpoints.productId],
        );
        await database.query("reset role");

        expect(rows.rows).toEqual([
          {
            catalog_number: "ACTIVE-CAT",
            relationship_id: activeRelationId,
            relationship_is_active: true,
            supplier_id: endpoints.supplierId,
            supplier_is_active: true,
            supplier_name: activeSupplierName,
          },
          {
            catalog_number: null,
            relationship_id: archivedRelationId,
            relationship_is_active: false,
            supplier_id: archivedSupplierId,
            supplier_is_active: false,
            supplier_name: archivedSupplierName,
          },
        ]);
        expect(Object.keys(rows.rows[0] ?? {}).sort()).toEqual([
          "catalog_number",
          "relationship_id",
          "relationship_is_active",
          "supplier_id",
          "supplier_is_active",
          "supplier_name",
        ]);
      }

      for (const actor of [
        fixture.actors.productCreator,
        fixture.actors.productEditor,
        fixture.actors.supplierEditor,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        fixture.actors.inactiveSupplierManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query("savepoint denied_product_supplier_read_rpc");
        await expect(
          database.query(
            "select * from public.get_product_suppliers_for_product($1::uuid)",
            [endpoints.productId],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint denied_product_supplier_read_rpc");
        await database.query("reset role");
      }

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.productEditor,
        fixture.actors.supplierEditor,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const choices = await database.query<ProductSupplierChoiceRow>(
          `select *
           from public.list_active_supplier_choices_for_product_supplier()`,
        );
        await database.query("reset role");

        expect(choices.rows).toContainEqual({
          supplier_id: endpoints.supplierId,
          supplier_name: activeSupplierName,
        });
        expect(choices.rows).not.toContainEqual({
          supplier_id: archivedSupplierId,
          supplier_name: archivedSupplierName,
        });
        expect(Object.keys(choices.rows[0] ?? {}).sort()).toEqual([
          "supplier_id",
          "supplier_name",
        ]);

        const sortedChoices = [...choices.rows].sort((left, right) =>
          left.supplier_name.localeCompare(right.supplier_name, undefined, {
            sensitivity: "base",
          }) || left.supplier_name.localeCompare(right.supplier_name) ||
          left.supplier_id.localeCompare(right.supplier_id));
        expect(choices.rows).toEqual(sortedChoices);
      }

      for (const actor of [
        fixture.actors.brandManager,
        fixture.actors.supplierViewer,
        fixture.actors.productCreator,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        fixture.actors.inactiveSupplierManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query("savepoint denied_supplier_choice_rpc");
        await expect(
          database.query(
            "select * from public.list_active_supplier_choices_for_product_supplier()",
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint denied_supplier_choice_rpc");
        await database.query("reset role");
      }

      for (const actor of [
        fixture.actors.brandManager,
        fixture.actors.productEditor,
        fixture.actors.supplierEditor,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hiddenSuppliers = await database.query<{ id: string }>(
          `select id
           from public.suppliers
           where id = any($1::uuid[])`,
          [[endpoints.supplierId, archivedSupplierId]],
        );
        await database.query("reset role");

        expect(hiddenSuppliers.rows).toEqual([]);
      }

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        name: string;
        settings: string[];
      }>(
        `select
           routine.proname as name,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'get_product_suppliers_for_product',
             'list_active_supplier_choices_for_product_supplier'
           )
         order by routine.proname`,
      );

      expect(functionSecurity.rows).toEqual([
        {
          anonymous_execute: false,
          authenticated_execute: true,
          is_security_definer: true,
          name: "get_product_suppliers_for_product",
          settings: ["search_path=\"\""],
        },
        {
          anonymous_execute: false,
          authenticated_execute: true,
          is_security_definer: true,
          name: "list_active_supplier_choices_for_product_supplier",
          settings: ["search_path=\"\""],
        },
      ]);
    });

    const anonymousRelationshipRead = await fixture.anonymousClient.rpc(
      "get_product_suppliers_for_product",
      { p_product_id: randomUUID() },
    );
    const anonymousChoices = await fixture.anonymousClient.rpc(
      "list_active_supplier_choices_for_product_supplier",
    );

    expectPermissionDenied(anonymousRelationshipRead.error);
    expectPermissionDenied(anonymousChoices.error);
  });

  it("exposes only minimal Supplier-side Product reads without broadening Product RLS", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const activeEndpoints = await createProductSupplierEndpoints(database, actorId);
      const archivedEndpoints = await createProductSupplierEndpoints(database, actorId, {
        productActive: false,
      });
      const activeRelationId = randomUUID();
      const archivedRelationId = randomUUID();
      const activeProductName = `Active Product ${randomUUID()}`;

      await database.query(
        `update public.products
         set name = $2::text
         where id = $1::uuid`,
        [activeEndpoints.productId, activeProductName],
      );
      const activeProduct = await database.query<{
        serial_number: string;
      }>(
        "select serial_number from public.products where id = $1::uuid",
        [activeEndpoints.productId],
      );
      const archivedProduct = await database.query<{
        name: string;
        serial_number: string;
      }>(
        "select name, serial_number from public.products where id = $1::uuid",
        [archivedEndpoints.productId],
      );

      await database.query(
        `insert into public.product_suppliers (
           id,
           product_id,
           supplier_id,
           catalog_number,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $3::uuid, $5::uuid, 'ACTIVE-CAT', true,
            $6::uuid, $6::uuid, null, null),
           ($2::uuid, $4::uuid, $5::uuid, null, false,
            $6::uuid, $6::uuid, pg_catalog.now(), $6::uuid)`,
        [
          activeRelationId,
          archivedRelationId,
          activeEndpoints.productId,
          archivedEndpoints.productId,
          activeEndpoints.supplierId,
          actorId,
        ],
      );

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.brandManager,
        fixture.actors.supplierViewer,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const rows = await database.query<SupplierProductReadRow>(
          "select * from public.get_product_suppliers_for_supplier($1::uuid)",
          [activeEndpoints.supplierId],
        );
        await database.query("reset role");

        expect(rows.rows).toEqual([
          {
            catalog_number: "ACTIVE-CAT",
            product_id: activeEndpoints.productId,
            product_is_active: true,
            product_name: activeProductName,
            product_serial_number: activeProduct.rows[0]?.serial_number,
            relationship_id: activeRelationId,
            relationship_is_active: true,
          },
          {
            catalog_number: null,
            product_id: archivedEndpoints.productId,
            product_is_active: false,
            product_name: archivedProduct.rows[0]?.name,
            product_serial_number: archivedProduct.rows[0]?.serial_number,
            relationship_id: archivedRelationId,
            relationship_is_active: false,
          },
        ]);
        expect(Object.keys(rows.rows[0] ?? {}).sort()).toEqual([
          "catalog_number",
          "product_id",
          "product_is_active",
          "product_name",
          "product_serial_number",
          "relationship_id",
          "relationship_is_active",
        ]);
      }

      for (const actor of [
        fixture.actors.productCreator,
        fixture.actors.productEditor,
        fixture.actors.supplierEditor,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        fixture.actors.inactiveSupplierManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query("savepoint denied_supplier_product_read_rpc");
        await expect(
          database.query(
            "select * from public.get_product_suppliers_for_supplier($1::uuid)",
            [activeEndpoints.supplierId],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint denied_supplier_product_read_rpc");
        await database.query("reset role");
      }

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.productEditor,
        fixture.actors.supplierEditor,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const choices = await database.query<SupplierProductChoiceRow>(
          "select * from public.list_active_product_choices_for_product_supplier()",
        );
        await database.query("reset role");

        expect(choices.rows).toContainEqual({
          product_id: activeEndpoints.productId,
          product_name: activeProductName,
          product_serial_number: activeProduct.rows[0]?.serial_number,
        });
        expect(choices.rows.some((row) =>
          row.product_id === archivedEndpoints.productId)).toBe(false);
        expect(Object.keys(choices.rows[0] ?? {}).sort()).toEqual([
          "product_id",
          "product_name",
          "product_serial_number",
        ]);
        expect(choices.rows).toEqual([...choices.rows].sort((left, right) =>
          left.product_serial_number.localeCompare(right.product_serial_number) ||
          left.product_id.localeCompare(right.product_id)));
      }

      for (const actor of [
        fixture.actors.brandManager,
        fixture.actors.supplierViewer,
        fixture.actors.productCreator,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        fixture.actors.inactiveSupplierManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query("savepoint denied_product_choice_rpc");
        await expect(
          database.query(
            "select * from public.list_active_product_choices_for_product_supplier()",
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint denied_product_choice_rpc");
        await database.query("reset role");
      }

      for (const actor of [
        fixture.actors.supplierViewer,
        fixture.actors.supplierEditor,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hiddenProducts = await database.query<{ id: string }>(
          "select id from public.products where id = any($1::uuid[])",
          [[activeEndpoints.productId, archivedEndpoints.productId]],
        );
        await database.query("reset role");
        expect(hiddenProducts.rows).toEqual([]);
      }

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        name: string;
        settings: string[];
      }>(
        `select
           routine.proname as name,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'get_product_suppliers_for_supplier',
             'list_active_product_choices_for_product_supplier'
           )
         order by routine.proname`,
      );
      expect(functionSecurity.rows).toEqual([
        {
          anonymous_execute: false,
          authenticated_execute: true,
          is_security_definer: true,
          name: "get_product_suppliers_for_supplier",
          settings: ["search_path=\"\""],
        },
        {
          anonymous_execute: false,
          authenticated_execute: true,
          is_security_definer: true,
          name: "list_active_product_choices_for_product_supplier",
          settings: ["search_path=\"\""],
        },
      ]);
    });

    const anonymousRelationshipRead = await fixture.anonymousClient.rpc(
      "get_product_suppliers_for_supplier",
      { p_supplier_id: randomUUID() },
    );
    const anonymousChoices = await fixture.anonymousClient.rpc(
      "list_active_product_choices_for_product_supplier",
    );
    expectPermissionDenied(anonymousRelationshipRead.error);
    expectPermissionDenied(anonymousChoices.error);
  });

  it("lets Admin create, edit, and archive ProductSupplier history with trusted audit", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const endpoints = await createProductSupplierEndpoints(
        database,
        actor.profileId,
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ relation_id: string }>(
        `select public.create_product_supplier(
           $1::uuid,
           $2::uuid,
           '  Cat-AbC  '
         ) as relation_id`,
        [endpoints.productId, endpoints.supplierId],
      );
      await database.query("reset role");
      const relationId = created.rows[0]?.relation_id;

      expect(relationId).toBeTypeOf("string");
      const afterCreate = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [relationId],
      );
      expect(afterCreate.rows[0]).toMatchObject({
        archived_at: null,
        archived_by_user_id: null,
        catalog_number: "Cat-AbC",
        created_by_user_id: actor.profileId,
        is_active: true,
        product_id: endpoints.productId,
        supplier_id: endpoints.supplierId,
        updated_by_user_id: actor.profileId,
      });
      expect(afterCreate.rows[0]?.created_at)
        .toEqual(afterCreate.rows[0]?.updated_at);

      await database.query("set local role authenticated");
      const updated = await database.query<{ relation_id: string }>(
        `select public.update_product_supplier(
           $1::uuid,
           '  Next-Catalog  '
         ) as relation_id`,
        [relationId],
      );
      await database.query("reset role");
      const afterUpdate = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [relationId],
      );

      expect(updated.rows).toEqual([{ relation_id: relationId }]);
      expect(afterUpdate.rows[0]).toMatchObject({
        catalog_number: "Next-Catalog",
        product_id: endpoints.productId,
        supplier_id: endpoints.supplierId,
        updated_by_user_id: actor.profileId,
      });

      const updatedAuditBeforeNoop = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product_supplier.updated'`,
        [relationId],
      );
      await database.query("set local role authenticated");
      const noop = await database.query<{ relation_id: string }>(
        `select public.update_product_supplier(
           $1::uuid,
           ' Next-Catalog '
         ) as relation_id`,
        [relationId],
      );
      await database.query("reset role");
      const afterNoop = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [relationId],
      );
      const updatedAuditAfterNoop = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'product_supplier.updated'`,
        [relationId],
      );

      expect(noop.rows).toEqual([{ relation_id: relationId }]);
      expect(afterNoop.rows).toEqual(afterUpdate.rows);
      expect(updatedAuditAfterNoop.rows).toEqual(updatedAuditBeforeNoop.rows);

      await database.query("set local role authenticated");
      const archived = await database.query<{ relation_id: string }>(
        `select public.archive_product_supplier($1::uuid) as relation_id`,
        [relationId],
      );
      await database.query("reset role");
      const afterArchive = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [relationId],
      );

      expect(archived.rows).toEqual([{ relation_id: relationId }]);
      expect(afterArchive.rows[0]).toMatchObject({
        archived_by_user_id: actor.profileId,
        catalog_number: "Next-Catalog",
        is_active: false,
        product_id: endpoints.productId,
        supplier_id: endpoints.supplierId,
        updated_by_user_id: actor.profileId,
      });
      expect(afterArchive.rows[0]?.archived_at).toBeInstanceOf(Date);
      expect(afterArchive.rows[0]?.updated_at)
        .toEqual(afterArchive.rows[0]?.archived_at);

      await database.query("set local role authenticated");
      await database.query("savepoint repeated_product_supplier_archive");
      await expect(
        database.query(
          "select public.archive_product_supplier($1::uuid)",
          [relationId],
        ),
      ).rejects.toMatchObject({ code: "PSR01" });
      await database.query("rollback to savepoint repeated_product_supplier_archive");
      await database.query("savepoint archived_product_supplier_edit");
      await expect(
        database.query(
          "select public.update_product_supplier($1::uuid, 'FORBIDDEN')",
          [relationId],
        ),
      ).rejects.toMatchObject({ code: "PSR01" });
      await database.query("rollback to savepoint archived_product_supplier_edit");
      await database.query("reset role");

      const afterFailures = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [relationId],
      );
      const audits = await database.query<ProductAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in (
             'product_supplier.created',
             'product_supplier.updated',
             'product_supplier.archived'
           )
         order by pg_catalog.array_position(
           array[
             'product_supplier.created',
             'product_supplier.updated',
             'product_supplier.archived'
           ]::text[],
           action_type
         )`,
        [relationId],
      );

      expect(afterFailures.rows).toEqual(afterArchive.rows);
      expect(audits.rows).toHaveLength(3);
      expect(audits.rows.map((row) => row.action_type)).toEqual([
        "product_supplier.created",
        "product_supplier.updated",
        "product_supplier.archived",
      ]);
      expect(audits.rows.every((row) =>
        row.actor_user_id === actor.profileId &&
        row.entity_type === "product_supplier" &&
        row.entity_id === relationId
      )).toBe(true);
      expect(audits.rows[0]?.after_data).toEqual({
        catalog_number: "Cat-AbC",
        is_active: true,
        product_id: endpoints.productId,
        supplier_id: endpoints.supplierId,
      });
      expect(audits.rows[1]).toMatchObject({
        before_data: {
          catalog_number: "Cat-AbC",
          is_active: true,
          product_id: endpoints.productId,
          supplier_id: endpoints.supplierId,
        },
        after_data: {
          catalog_number: "Next-Catalog",
          is_active: true,
          product_id: endpoints.productId,
          supplier_id: endpoints.supplierId,
        },
      });
      expect(audits.rows[2]?.after_data).toMatchObject({
        archived_by_user_id: actor.profileId,
        catalog_number: "Next-Catalog",
        is_active: false,
        product_id: endpoints.productId,
        supplier_id: endpoints.supplierId,
      });

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        arguments: string;
        authenticated_execute: boolean;
        is_security_definer: boolean;
        name: string;
        result_type: string;
        settings: string[];
      }>(
        `select
           routine.proname as name,
           pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
           pg_catalog.pg_get_function_result(routine.oid) as result_type,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'archive_product_supplier',
             'create_product_supplier',
             'current_product_supplier_mutation_actor_id',
             'update_product_supplier'
           )
         order by routine.proname`,
      );

      expect(functionSecurity.rows).toEqual([
        {
          anonymous_execute: false,
          arguments: "p_product_supplier_id uuid",
          authenticated_execute: true,
          is_security_definer: true,
          name: "archive_product_supplier",
          result_type: "uuid",
          settings: ["search_path=\"\""],
        },
        {
          anonymous_execute: false,
          arguments: "p_product_id uuid, p_supplier_id uuid, p_catalog_number text DEFAULT NULL::text",
          authenticated_execute: true,
          is_security_definer: true,
          name: "create_product_supplier",
          result_type: "uuid",
          settings: ["search_path=\"\""],
        },
        {
          anonymous_execute: false,
          arguments: "",
          authenticated_execute: false,
          is_security_definer: true,
          name: "current_product_supplier_mutation_actor_id",
          result_type: "uuid",
          settings: ["search_path=\"\""],
        },
        {
          anonymous_execute: false,
          arguments: "p_product_supplier_id uuid, p_catalog_number text",
          authenticated_execute: true,
          is_security_definer: true,
          name: "update_product_supplier",
          result_type: "uuid",
          settings: ["search_path=\"\""],
        },
      ]);
    });
  });

  it("uses the same ProductSupplier authority for Product and Supplier editors", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      for (const [label, actor] of [
        ["PRODUCT", fixture.actors.productEditor],
        ["SUPPLIER", fixture.actors.supplierEditor],
      ] as const) {
        const endpoints = await createProductSupplierEndpoints(
          database,
          fixture.actors.admin.profileId,
        );
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const created = await database.query<{ relation_id: string }>(
          `select public.create_product_supplier(
             $1::uuid,
             $2::uuid,
             $3::text
           ) as relation_id`,
          [endpoints.productId, endpoints.supplierId, `${label}-CREATE`],
        );
        const relationId = created.rows[0]?.relation_id;
        await database.query(
          "select public.update_product_supplier($1::uuid, $2::text)",
          [relationId, `${label}-UPDATE`],
        );
        await database.query(
          "select public.archive_product_supplier($1::uuid)",
          [relationId],
        );
        await database.query("reset role");

        const relation = await database.query<ProductSupplierRow>(
          "select * from public.product_suppliers where id = $1::uuid",
          [relationId],
        );
        const audits = await database.query<ProductAuditRow>(
          `select actor_user_id, action_type, entity_type, entity_id,
                  before_data, after_data
           from public.audit_logs
           where entity_id = $1::uuid
             and action_type like 'product_supplier.%'
           order by created_at`,
          [relationId],
        );

        expect(relation.rows[0]).toMatchObject({
          archived_by_user_id: actor.profileId,
          catalog_number: `${label}-UPDATE`,
          is_active: false,
          updated_by_user_id: actor.profileId,
        });
        expect(audits.rows).toHaveLength(3);
        expect(audits.rows.every((row) =>
          row.actor_user_id === actor.profileId
        )).toBe(true);
      }
    });
  });

  it("rejects unauthorized ProductSupplier mutations before target access", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      for (const actor of [
        fixture.actors.brandManager,
        fixture.actors.supplierViewer,
        fixture.actors.productCreator,
        fixture.actors.supplierCreator,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        fixture.actors.inactiveSupplierManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");

        for (const [savepoint, sql, values] of [
          [
            "denied_product_supplier_create",
            "select public.create_product_supplier($1::uuid, $2::uuid, null)",
            [randomUUID(), randomUUID()],
          ],
          [
            "denied_product_supplier_update",
            "select public.update_product_supplier($1::uuid, null)",
            [randomUUID()],
          ],
          [
            "denied_product_supplier_archive",
            "select public.archive_product_supplier($1::uuid)",
            [randomUUID()],
          ],
        ] as const) {
          await database.query(`savepoint ${savepoint}`);
          await expect(database.query(sql, [...values]))
            .rejects.toMatchObject({ code: "42501" });
          await database.query(`rollback to savepoint ${savepoint}`);
        }

        await database.query("reset role");
      }

      await database.query("savepoint anonymous_product_supplier_mutation");
      await database.query("set local role anon");
      await expect(
        database.query(
          "select public.create_product_supplier($1::uuid, $2::uuid, null)",
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_product_supplier_mutation");
      await database.query("reset role");
    });
  });

  it("normalizes ProductSupplier input and fails endpoint or duplicate conflicts atomically", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const active = await createProductSupplierEndpoints(
        database,
        actor.profileId,
      );
      const archivedProduct = await createProductSupplierEndpoints(
        database,
        actor.profileId,
        { productActive: false },
      );
      const archivedSupplier = await createProductSupplierEndpoints(
        database,
        actor.profileId,
        { supplierActive: false },
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");
      const nullCatalog = await database.query<{ relation_id: string }>(
        `select public.create_product_supplier(
           $1::uuid,
           $2::uuid,
           '   '
         ) as relation_id`,
        [active.productId, active.supplierId],
      );
      const firstCatalog = await database.query<{ relation_id: string }>(
        `select public.create_product_supplier(
           $1::uuid,
           $2::uuid,
           '  Case-Kept  '
         ) as relation_id`,
        [active.productId, active.supplierId],
      );
      const differentCatalog = await database.query<{ relation_id: string }>(
        `select public.create_product_supplier(
           $1::uuid,
           $2::uuid,
           'DIFFERENT'
         ) as relation_id`,
        [active.productId, active.supplierId],
      );

      for (const [savepoint, sql, values, errorCode] of [
        [
          "null_product_supplier_product",
          "select public.create_product_supplier(null, $1::uuid, null)",
          [active.supplierId],
          "22023",
        ],
        [
          "null_product_supplier_supplier",
          "select public.create_product_supplier($1::uuid, null, null)",
          [active.productId],
          "22023",
        ],
        [
          "duplicate_null_product_supplier",
          "select public.create_product_supplier($1::uuid, $2::uuid, null)",
          [active.productId, active.supplierId],
          "PSR04",
        ],
        [
          "duplicate_catalog_product_supplier",
          "select public.create_product_supplier($1::uuid, $2::uuid, ' Case-Kept ')",
          [active.productId, active.supplierId],
          "PSR04",
        ],
        [
          "missing_product_supplier_product",
          "select public.create_product_supplier($1::uuid, $2::uuid, null)",
          [randomUUID(), active.supplierId],
          "PSR02",
        ],
        [
          "archived_product_supplier_product",
          "select public.create_product_supplier($1::uuid, $2::uuid, null)",
          [archivedProduct.productId, active.supplierId],
          "PSR02",
        ],
        [
          "missing_product_supplier_supplier",
          "select public.create_product_supplier($1::uuid, $2::uuid, null)",
          [active.productId, randomUUID()],
          "PSR03",
        ],
        [
          "archived_product_supplier_supplier",
          "select public.create_product_supplier($1::uuid, $2::uuid, null)",
          [active.productId, archivedSupplier.supplierId],
          "PSR03",
        ],
      ] as const) {
        await database.query(`savepoint ${savepoint}`);
        await expect(database.query(sql, [...values]))
          .rejects.toMatchObject({ code: errorCode });
        await database.query(`rollback to savepoint ${savepoint}`);
      }

      await database.query("savepoint duplicate_product_supplier_edit");
      await expect(
        database.query(
          "select public.update_product_supplier($1::uuid, null)",
          [differentCatalog.rows[0]?.relation_id],
        ),
      ).rejects.toMatchObject({ code: "PSR04" });
      await database.query("rollback to savepoint duplicate_product_supplier_edit");

      for (const [savepoint, sql, values] of [
        [
          "null_product_supplier_update",
          "select public.update_product_supplier(null, null)",
          [],
        ],
        [
          "null_product_supplier_archive",
          "select public.archive_product_supplier(null)",
          [],
        ],
        [
          "missing_product_supplier_update",
          "select public.update_product_supplier($1::uuid, null)",
          [randomUUID()],
        ],
        [
          "missing_product_supplier_archive",
          "select public.archive_product_supplier($1::uuid)",
          [randomUUID()],
        ],
      ] as const) {
        await database.query(`savepoint ${savepoint}`);
        await expect(database.query(sql, [...values]))
          .rejects.toMatchObject({
            code: savepoint.startsWith("null_") ? "22023" : "P0002",
          });
        await database.query(`rollback to savepoint ${savepoint}`);
      }
      await database.query("reset role");

      const relations = await database.query<ProductSupplierRow>(
        `select *
         from public.product_suppliers
         where id = any($1::uuid[])
         order by id`,
        [[
          nullCatalog.rows[0]?.relation_id,
          firstCatalog.rows[0]?.relation_id,
          differentCatalog.rows[0]?.relation_id,
        ]],
      );
      const auditCount = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type like 'product_supplier.%'`,
        [[
          nullCatalog.rows[0]?.relation_id,
          firstCatalog.rows[0]?.relation_id,
          differentCatalog.rows[0]?.relation_id,
        ]],
      );

      expect(relations.rows).toHaveLength(3);
      expect(relations.rows.map((row) => row.catalog_number).sort()).toEqual([
        "Case-Kept",
        "DIFFERENT",
        null,
      ]);
      expect(auditCount.rows).toEqual([{ count: 3 }]);

      await database.query(
        `update public.products
         set is_active = false,
             updated_at = pg_catalog.now(),
             updated_by_user_id = $2::uuid,
             archived_at = pg_catalog.now(),
             archived_by_user_id = $2::uuid
         where id = $1::uuid`,
        [active.productId, actor.profileId],
      );
      await database.query("set local role authenticated");
      await database.query(
        "select public.update_product_supplier($1::uuid, 'HISTORICAL')",
        [firstCatalog.rows[0]?.relation_id],
      );
      await database.query("reset role");

      const historicalEdit = await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where id = $1::uuid",
        [firstCatalog.rows[0]?.relation_id],
      );
      expect(historicalEdit.rows[0]).toMatchObject({
        catalog_number: "HISTORICAL",
        product_id: active.productId,
        supplier_id: active.supplierId,
      });
    });
  });

  it("applies each Admin manual Inventory adjustment exactly once with canonical movement and audit data", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const productId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Manual Adjustment Product', 'Components',
           'component', $3::uuid, $3::uuid
         )`,
        [productId, createTestSerialNumber(), actor.profileId],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");

      const adjustments: Array<{
        adjustmentType: string;
        expectedAfter: string;
        expectedBefore: string;
        quantity: number;
        reason: string;
      }> = [
        {
          adjustmentType: "  ADD  ",
          expectedAfter: "10",
          expectedBefore: "0",
          quantity: 10,
          reason: "  Initial manual receipt  ",
        },
        {
          adjustmentType: "remove",
          expectedAfter: "7",
          expectedBefore: "10",
          quantity: 3,
          reason: "Manual issue",
        },
        {
          adjustmentType: "correction",
          expectedAfter: "12",
          expectedBefore: "7",
          quantity: 12,
          reason: "Count corrected up",
        },
        {
          adjustmentType: "correction",
          expectedAfter: "4",
          expectedBefore: "12",
          quantity: 4,
          reason: "Count corrected down",
        },
        {
          adjustmentType: "correction",
          expectedAfter: "0",
          expectedBefore: "4",
          quantity: 0,
          reason: "Count corrected to zero",
        },
      ];
      const results: ManualInventoryAdjustmentRow[] = [];

      for (const adjustment of adjustments) {
        const result = await database.query<ManualInventoryAdjustmentRow>(
          `select *
           from public.manual_adjust_inventory(
             $1::uuid,
             $2::text,
             $3::bigint,
             $4::text
           )`,
          [
            productId,
            adjustment.adjustmentType,
            adjustment.quantity,
            adjustment.reason,
          ],
        );
        expect(result.rows).toEqual([{
          movement_id: expect.any(String),
          quantity_after: adjustment.expectedAfter,
          quantity_before: adjustment.expectedBefore,
        }]);
        const appliedAdjustment = result.rows[0];

        if (!appliedAdjustment) {
          throw new Error("Manual Inventory adjustment returned no result");
        }

        results.push(appliedAdjustment);
      }

      await database.query("reset role");
      const movementIds = results.map((result) => result.movement_id);
      const movements = await database.query<InventoryMovementRow>(
        `select *
         from public.inventory_movements
         where id = any($1::uuid[])
         order by created_at, id`,
        [movementIds],
      );
      const audits = await database.query<{
        action_type: string;
        actor_user_id: string;
        after_data: Record<string, unknown>;
        before_data: Record<string, unknown>;
        entity_id: string;
        entity_type: string;
      }>(
        `select action_type, actor_user_id, after_data, before_data,
                entity_id, entity_type
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'inventory.manual_adjusted'
         order by created_at, id`,
        [productId],
      );
      const balance = await database.query<{ quantity: string }>(
        `select quantity
         from public.inventory_balances
         where product_id = $1::uuid`,
        [productId],
      );

      expect(balance.rows).toEqual([{ quantity: "0" }]);
      expect(movements.rows).toHaveLength(adjustments.length);
      expect(audits.rows).toHaveLength(adjustments.length);
      expect(movements.rows.map((movement) => ({
        actor: movement.actor_user_id,
        after: movement.quantity_after,
        before: movement.quantity_before,
        delta: movement.quantity_delta,
        reason: movement.reason,
        sourceId: movement.source_id,
        sourceType: movement.source_type,
        type: movement.movement_type,
      }))).toEqual([
        {
          actor: actor.profileId,
          after: "10",
          before: "0",
          delta: "10",
          reason: "Initial manual receipt",
          sourceId: null,
          sourceType: "manual_adjustment",
          type: "manual_add",
        },
        {
          actor: actor.profileId,
          after: "7",
          before: "10",
          delta: "-3",
          reason: "Manual issue",
          sourceId: null,
          sourceType: "manual_adjustment",
          type: "manual_remove",
        },
        {
          actor: actor.profileId,
          after: "12",
          before: "7",
          delta: "5",
          reason: "Count corrected up",
          sourceId: null,
          sourceType: "manual_adjustment",
          type: "manual_correction",
        },
        {
          actor: actor.profileId,
          after: "4",
          before: "12",
          delta: "-8",
          reason: "Count corrected down",
          sourceId: null,
          sourceType: "manual_adjustment",
          type: "manual_correction",
        },
        {
          actor: actor.profileId,
          after: "0",
          before: "4",
          delta: "-4",
          reason: "Count corrected to zero",
          sourceId: null,
          sourceType: "manual_adjustment",
          type: "manual_correction",
        },
      ]);
      expect(audits.rows.every((audit) =>
        audit.actor_user_id === actor.profileId &&
        audit.entity_id === productId &&
        audit.entity_type === "product_inventory"
      )).toBe(true);
      expect(audits.rows.map((audit) => audit.after_data)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            adjustment_type: "add",
            entered_quantity: 10,
            movement_type: "manual_add",
            quantity_after: 10,
            quantity_before: 0,
            quantity_delta: 10,
            reason: "Initial manual receipt",
          }),
          expect.objectContaining({
            adjustment_type: "remove",
            entered_quantity: 3,
            movement_type: "manual_remove",
            quantity_after: 7,
            quantity_before: 10,
            quantity_delta: -3,
            reason: "Manual issue",
          }),
          expect.objectContaining({
            adjustment_type: "correction",
            entered_quantity: 12,
            movement_type: "manual_correction",
            quantity_after: 12,
            quantity_before: 7,
            quantity_delta: 5,
            reason: "Count corrected up",
          }),
          expect.objectContaining({
            adjustment_type: "correction",
            entered_quantity: 4,
            movement_type: "manual_correction",
            quantity_after: 4,
            quantity_before: 12,
            quantity_delta: -8,
            reason: "Count corrected down",
          }),
          expect.objectContaining({
            adjustment_type: "correction",
            entered_quantity: 0,
            movement_type: "manual_correction",
            quantity_after: 0,
            quantity_before: 4,
            quantity_delta: -4,
            reason: "Count corrected to zero",
          }),
        ]),
      );
    });
  });

  it("rejects invalid, missing, archived, no-op, and insufficient manual adjustments without side effects", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const productId = randomUUID();
      const archivedProductId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind, is_active,
           created_by_user_id, updated_by_user_id, archived_at,
           archived_by_user_id
         ) values
           ($1::uuid, $3::text, 'Adjustment Validation Product', 'Components',
            'component', true, $5::uuid, $5::uuid, null, null),
           ($2::uuid, $4::text, 'Archived Adjustment Product', 'Components',
            'component', false, $5::uuid, $5::uuid,
            pg_catalog.now(), $5::uuid)`,
        [
          productId,
          archivedProductId,
          createTestSerialNumber(),
          createTestSerialNumber(),
          actor.profileId,
        ],
      );
      await database.query(
        `update public.inventory_balances
         set quantity = 5
         where product_id = $1::uuid`,
        [productId],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");

      const rejectedCases: Array<{
        code: string;
        label: string;
        values: unknown[];
      }> = [
        {
          code: "MIA01",
          label: "null_product",
          values: [null, "add", 1, "Reason"],
        },
        {
          code: "P0002",
          label: "missing_product",
          values: [randomUUID(), "add", 1, "Reason"],
        },
        {
          code: "PRD01",
          label: "archived_product",
          values: [archivedProductId, "add", 1, "Reason"],
        },
        {
          code: "MIA01",
          label: "invalid_type",
          values: [productId, "replace", 1, "Reason"],
        },
        {
          code: "MIA01",
          label: "null_type",
          values: [productId, null, 1, "Reason"],
        },
        {
          code: "MIA01",
          label: "zero_add",
          values: [productId, "add", 0, "Reason"],
        },
        {
          code: "MIA01",
          label: "negative_add",
          values: [productId, "add", -1, "Reason"],
        },
        {
          code: "MIA01",
          label: "zero_remove",
          values: [productId, "remove", 0, "Reason"],
        },
        {
          code: "MIA01",
          label: "negative_remove",
          values: [productId, "remove", -1, "Reason"],
        },
        {
          code: "MIA01",
          label: "negative_correction",
          values: [productId, "correction", -1, "Reason"],
        },
        {
          code: "MIA01",
          label: "null_quantity",
          values: [productId, "add", null, "Reason"],
        },
        {
          code: "MIA01",
          label: "blank_reason",
          values: [productId, "add", 1, "   "],
        },
        {
          code: "MIA01",
          label: "null_reason",
          values: [productId, "add", 1, null],
        },
        {
          code: "MIA02",
          label: "no_op_correction",
          values: [productId, "correction", 5, "No change"],
        },
        {
          code: "IVB02",
          label: "insufficient_remove",
          values: [productId, "remove", 6, "Too much"],
        },
      ];

      for (const rejected of rejectedCases) {
        await database.query(`savepoint ${rejected.label}`);
        await expect(
          database.query(
            `select *
             from public.manual_adjust_inventory(
               $1::uuid,
               $2::text,
               $3::bigint,
               $4::text
             )`,
            rejected.values,
          ),
        ).rejects.toMatchObject({ code: rejected.code });
        await database.query(`rollback to savepoint ${rejected.label}`);
      }

      await database.query("reset role");
      const state = await database.query<{
        audit_count: number;
        movement_count: number;
        quantity: string;
      }>(
        `select
           balance.quantity,
           (
             select count(*)::integer
             from public.inventory_movements as movement
             where movement.product_id = balance.product_id
           ) as movement_count,
           (
             select count(*)::integer
             from public.audit_logs as audit
             where audit.entity_id = balance.product_id
               and audit.action_type = 'inventory.manual_adjusted'
           ) as audit_count
         from public.inventory_balances as balance
         where balance.product_id = $1::uuid`,
        [productId],
      );
      expect(state.rows).toEqual([{
        audit_count: 0,
        movement_count: 0,
        quantity: "5",
      }]);
    });
  });

  it("keeps manual adjustment Admin-only and preserves all lower-level client write boundaries", async () => {
    const fixture = requireHarness();
    const argumentsForRpc = {
      p_adjustment_type: "add",
      p_product_id: randomUUID(),
      p_quantity: 1,
      p_reason: "Authorization probe",
    };
    const adminAttempt = await fixture.actors.admin.client.rpc(
      "manual_adjust_inventory",
      argumentsForRpc,
    );
    expect(adminAttempt.error).toMatchObject({ code: "P0002" });

    for (const client of [
      fixture.actors.productCreator.client,
      fixture.actors.productEditor.client,
      fixture.actors.brandManager.client,
      fixture.actors.unpermitted.client,
      fixture.actors.inactive.client,
      fixture.anonymousClient,
    ]) {
      const attempt = await client.rpc(
        "manual_adjust_inventory",
        argumentsForRpc,
      );
      expectPermissionDenied(attempt.error);
    }

    const directBalanceUpdate = await fixture.actors.admin.client
      .from("inventory_balances")
      .update({ quantity: 1 })
      .eq("product_id", randomUUID());
    const directMovementInsert = await fixture.actors.admin.client
      .from("inventory_movements")
      .insert({
        actor_user_id: fixture.actors.admin.profileId,
        movement_type: "manual_add",
        product_id: randomUUID(),
        quantity_after: 1,
        quantity_before: 0,
        quantity_delta: 1,
        reason: "Forbidden",
      });
    const primitiveAttempt = await fixture.actors.admin.client.rpc(
      "apply_inventory_delta",
      {
        p_movement_type: "manual_add",
        p_product_id: randomUUID(),
        p_quantity_delta: 1,
      },
    );
    expectPermissionDenied(directBalanceUpdate.error);
    expectPermissionDenied(directMovementInsert.error);
    expectPermissionDenied(primitiveAttempt.error);

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const security = await database.query<{
        anonymous_execute: boolean;
        arguments: string;
        authenticated_execute: boolean;
        definition: string;
        is_security_definer: boolean;
        result_type: string;
        settings: string[];
      }>(
        `select
           pg_catalog.pg_get_function_arguments(routine.oid) as arguments,
           pg_catalog.pg_get_function_result(routine.oid) as result_type,
           pg_catalog.pg_get_functiondef(routine.oid) as definition,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege(
             'authenticated', routine.oid, 'execute'
           ) as authenticated_execute,
           pg_catalog.has_function_privilege(
             'anon', routine.oid, 'execute'
           ) as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'manual_adjust_inventory'`,
      );
      expect(security.rows).toHaveLength(1);
      expect(security.rows[0]).toMatchObject({
        anonymous_execute: false,
        authenticated_execute: true,
        is_security_definer: true,
        result_type: "TABLE(movement_id uuid, quantity_before bigint, quantity_after bigint)",
        settings: ["search_path=\"\""],
      });
      expect(security.rows[0]?.arguments).toBe(
        "p_product_id uuid, p_adjustment_type text, p_quantity bigint, p_reason text",
      );
      const definition = security.rows[0]?.definition.toLowerCase() ?? "";
      expect(definition.match(/apply_inventory_delta/g)).toHaveLength(1);
      expect(definition).toContain("current_user_is_admin");
      expect(definition).toContain("append_audit_log");
      expect(definition).toContain("from public.products");
      expect(definition).toContain("for update");
      expect(definition).toContain("from public.user_profiles");
      expect(definition).toContain("for share");
      expect(definition.indexOf("from public.products")).toBeLessThan(
        definition.indexOf("from public.user_profiles"),
      );
      expect(definition).not.toContain("update public.inventory_balances");
      expect(definition).not.toContain("insert into public.inventory_movements");

      const primitiveAcl = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
      }>(
        `select
           pg_catalog.has_function_privilege(
             'authenticated', routine.oid, 'execute'
           ) as authenticated_execute,
           pg_catalog.has_function_privilege(
             'anon', routine.oid, 'execute'
           ) as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'apply_inventory_delta'`,
      );
      expect(primitiveAcl.rows).toEqual([{
        anonymous_execute: false,
        authenticated_execute: false,
      }]);
    });
  });

  it("keeps denied manual Inventory actors side-effect free across Inventory permission combinations", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const productId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Authorization Boundary Product', 'Components',
           'component', $3::uuid, $3::uuid
         )`,
        [
          productId,
          createTestSerialNumber(),
          fixture.actors.admin.profileId,
        ],
      );
      await database.query(
        `update public.inventory_balances
         set quantity = 8
         where product_id = $1::uuid`,
        [productId],
      );

      for (const [label, actor] of [
        ["inventory_view", fixture.actors.brandManager],
        ["inventory_product_edit", fixture.actors.productEditor],
        ["inventory_product_create", fixture.actors.productCreator],
        ["ordinary_user", fixture.actors.unpermitted],
        ["inactive_admin", fixture.actors.inactive],
      ] as const) {
        await database.query(`savepoint denied_manual_${label}`);
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await expect(
          database.query(
            `select *
             from public.manual_adjust_inventory(
               $1::uuid,
               'remove',
               1,
               'Denied authorization attempt'
             )`,
            [productId],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_manual_${label}`);
        await database.query("reset role");
      }

      await database.query("savepoint denied_manual_anonymous");
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', '', true)",
      );
      await database.query("set local role anon");
      await expect(
        database.query(
          `select *
           from public.manual_adjust_inventory(
             $1::uuid,
             'remove',
             1,
             'Anonymous authorization attempt'
           )`,
          [productId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint denied_manual_anonymous");
      await database.query("reset role");

      const unchanged = await database.query<{
        audit_count: number;
        movement_count: number;
        quantity: string;
      }>(
        `select
           balance.quantity,
           (
             select count(*)::integer
             from public.inventory_movements as movement
             where movement.product_id = balance.product_id
           ) as movement_count,
           (
             select count(*)::integer
             from public.audit_logs as audit
             where audit.entity_id = balance.product_id
               and audit.action_type = 'inventory.manual_adjusted'
           ) as audit_count
         from public.inventory_balances as balance
         where balance.product_id = $1::uuid`,
        [productId],
      );
      expect(unchanged.rows).toEqual([{
        audit_count: 0,
        movement_count: 0,
        quantity: "8",
      }]);
    });
  });

  it("serializes competing Admin manual removals and commits only the affordable adjustment", async () => {
    const fixture = requireHarness();
    const productId = randomUUID();
    const applicationName = `alfaev-manual-remove-wait-${randomUUID()}`;

    await fixture.withDatabaseClients(3, async (clients) => {
      const firstAdmin = clients[0];
      const secondAdmin = clients[1];
      const observer = clients[2];
      if (!firstAdmin || !secondAdmin || !observer) {
        throw new Error("Manual removal concurrency clients are unavailable");
      }

      await observer.query("begin");
      await observer.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Concurrent Manual Removal Product',
           'Components', 'component', $3::uuid, $3::uuid
         )`,
        [
          productId,
          createTestSerialNumber(),
          fixture.actors.admin.profileId,
        ],
      );
      await observer.query(
        `update public.inventory_balances
         set quantity = 10
         where product_id = $1::uuid`,
        [productId],
      );
      await observer.query("commit");

      try {
        await firstAdmin.query("begin");
        await firstAdmin.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await firstAdmin.query("set local role authenticated");
        const affordableRemoval = await firstAdmin.query<
          ManualInventoryAdjustmentRow
        >(
          `select *
           from public.manual_adjust_inventory(
             $1::uuid,
             'remove',
             7,
             'First concurrent removal'
           )`,
          [productId],
        );
        expect(affordableRemoval.rows).toEqual([{
          movement_id: expect.any(String),
          quantity_after: "3",
          quantity_before: "10",
        }]);

        await secondAdmin.query("begin");
        await secondAdmin.query(
          "select pg_catalog.set_config('application_name', $1::text, true)",
          [applicationName],
        );
        await secondAdmin.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await secondAdmin.query("set local role authenticated");
        const unaffordableRemoval = secondAdmin.query(
          `select *
           from public.manual_adjust_inventory(
             $1::uuid,
             'remove',
             6,
             'Competing concurrent removal'
           )`,
          [productId],
        ).then(
          () => null,
          (error: unknown) => error,
        );

        let observedLockWait = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = await observer.query<ActivityWaitRow>(
            `select wait_event_type, wait_event
             from pg_catalog.pg_stat_activity
             where application_name = $1::text`,
            [applicationName],
          );
          if (activity.rows[0]?.wait_event_type === "Lock") {
            observedLockWait = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(observedLockWait).toBe(true);

        const stateWhileWaiting = await observer.query<{
          audit_count: number;
          movement_count: number;
          quantity: string;
        }>(
          `select
             balance.quantity,
             (
               select count(*)::integer
               from public.inventory_movements as movement
               where movement.product_id = balance.product_id
             ) as movement_count,
             (
               select count(*)::integer
               from public.audit_logs as audit
               where audit.entity_id = balance.product_id
                 and audit.action_type = 'inventory.manual_adjusted'
             ) as audit_count
           from public.inventory_balances as balance
           where balance.product_id = $1::uuid`,
          [productId],
        );
        expect(stateWhileWaiting.rows).toEqual([{
          audit_count: 0,
          movement_count: 0,
          quantity: "10",
        }]);

        await firstAdmin.query("commit");
        const competingError = await unaffordableRemoval;
        expect(competingError).toMatchObject({ code: "IVB02" });
        await secondAdmin.query("rollback");

        const committedState = await observer.query<{
          action_type: string;
          actor_user_id: string;
          audit_count: number;
          movement_count: number;
          movement_type: string;
          quantity: string;
          quantity_after: string;
          quantity_before: string;
          quantity_delta: string;
        }>(
          `select
             balance.quantity,
             movement.movement_type,
             movement.quantity_delta,
             movement.quantity_before,
             movement.quantity_after,
             movement.actor_user_id,
             audit.action_type,
             (
               select count(*)::integer
               from public.inventory_movements as counted_movement
               where counted_movement.product_id = balance.product_id
             ) as movement_count,
             (
               select count(*)::integer
               from public.audit_logs as counted_audit
               where counted_audit.entity_id = balance.product_id
                 and counted_audit.action_type = 'inventory.manual_adjusted'
             ) as audit_count
           from public.inventory_balances as balance
           join public.inventory_movements as movement
             on movement.product_id = balance.product_id
           join public.audit_logs as audit
             on audit.entity_id = balance.product_id
            and audit.action_type = 'inventory.manual_adjusted'
           where balance.product_id = $1::uuid`,
          [productId],
        );
        expect(committedState.rows).toEqual([{
          action_type: "inventory.manual_adjusted",
          actor_user_id: fixture.actors.admin.profileId,
          audit_count: 1,
          movement_count: 1,
          movement_type: "manual_remove",
          quantity: "3",
          quantity_after: "3",
          quantity_before: "10",
          quantity_delta: "-7",
        }]);

        const readableHistory = await fixture.actors.admin.client.rpc(
          "get_inventory_movements_for_product",
          { p_product_id: productId },
        );
        expect(readableHistory.error).toBeNull();
        expect(readableHistory.data).toEqual([
          expect.objectContaining({
            movement_id: affordableRemoval.rows[0]?.movement_id,
            movement_type: "manual_remove",
            quantity_after: 3,
            quantity_before: 10,
            quantity_delta: -7,
          }),
        ]);
      } finally {
        await firstAdmin.query("rollback");
        await secondAdmin.query("rollback");
        await observer.query("begin");
        await observer.query("set local session_replication_role = replica");
        await observer.query(
          `delete from public.audit_logs
           where entity_id = $1::uuid
             and action_type = 'inventory.manual_adjusted'`,
          [productId],
        );
        await observer.query(
          `delete from public.inventory_movements
           where product_id = $1::uuid`,
          [productId],
        );
        await observer.query(
          `delete from public.inventory_balances
           where product_id = $1::uuid`,
          [productId],
        );
        await observer.query(
          "delete from public.products where id = $1::uuid",
          [productId],
        );
        await observer.query("commit");
      }
    });
  });

  it("rolls back the manual balance and movement when the required audit append fails", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture.actors.admin;
      const productId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Audit Rollback Product', 'Components',
           'component', $3::uuid, $3::uuid
         )`,
        [productId, createTestSerialNumber(), actor.profileId],
      );
      await database.query(
        `create function public.test_reject_manual_inventory_audit()
         returns trigger
         language plpgsql
         set search_path = ''
         as $test_function$
         begin
           if new.action_type = 'inventory.manual_adjusted' then
             raise exception 'Test audit rejection'
               using errcode = 'TST01';
           end if;

           return new;
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_reject_manual_inventory_audit
         before insert on public.audit_logs
         for each row
         execute function public.test_reject_manual_inventory_audit()`,
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint failed_manual_inventory_audit");
      await expect(
        database.query(
          `select *
           from public.manual_adjust_inventory(
             $1::uuid,
             'add',
             3,
             'Must roll back'
           )`,
          [productId],
        ),
      ).rejects.toMatchObject({ code: "TST01" });
      await database.query("rollback to savepoint failed_manual_inventory_audit");
      await database.query("reset role");

      const state = await database.query<{
        audit_count: number;
        movement_count: number;
        quantity: string;
      }>(
        `select
           balance.quantity,
           (
             select count(*)::integer
             from public.inventory_movements as movement
             where movement.product_id = balance.product_id
           ) as movement_count,
           (
             select count(*)::integer
             from public.audit_logs as audit
             where audit.entity_id = balance.product_id
               and audit.action_type = 'inventory.manual_adjusted'
           ) as audit_count
         from public.inventory_balances as balance
         where balance.product_id = $1::uuid`,
        [productId],
      );
      expect(state.rows).toEqual([{
        audit_count: 0,
        movement_count: 0,
        quantity: "0",
      }]);
    });
  });

  it("fails a waiting manual adjustment when the Product archive transition wins", async () => {
    const fixture = requireHarness();
    const productId = randomUUID();
    const applicationName = `alfaev-manual-adjust-wait-${randomUUID()}`;

    await fixture.withDatabaseClients(3, async (clients) => {
      const archiver = clients[0];
      const adjuster = clients[1];
      const observer = clients[2];
      if (!archiver || !adjuster || !observer) {
        throw new Error("Manual adjustment concurrency clients are unavailable");
      }

      await observer.query("begin");
      await observer.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, 'Archive Race Product', 'Components',
           'component', $3::uuid, $3::uuid
         )`,
        [
          productId,
          createTestSerialNumber(),
          fixture.actors.admin.profileId,
        ],
      );
      await observer.query("commit");

      try {
        await archiver.query("begin");
        await archiver.query(
          `update public.products
           set is_active = false,
               updated_at = pg_catalog.now(),
               updated_by_user_id = $2::uuid,
               archived_at = pg_catalog.now(),
               archived_by_user_id = $2::uuid
           where id = $1::uuid`,
          [productId, fixture.actors.admin.profileId],
        );

        await adjuster.query("begin");
        await adjuster.query(
          "select pg_catalog.set_config('application_name', $1::text, true)",
          [applicationName],
        );
        await adjuster.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await adjuster.query("set local role authenticated");
        const waitingAdjustment = adjuster.query(
          `select *
           from public.manual_adjust_inventory(
             $1::uuid,
             'add',
             1,
             'Must lose archive race'
           )`,
          [productId],
        ).then(
          () => null,
          (error: unknown) => error,
        );

        let observedProductWait = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = await observer.query<ActivityWaitRow>(
            `select wait_event_type, wait_event
             from pg_catalog.pg_stat_activity
             where application_name = $1::text`,
            [applicationName],
          );
          if (activity.rows[0]?.wait_event_type === "Lock") {
            observedProductWait = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(observedProductWait).toBe(true);

        await archiver.query("commit");
        const adjustmentError = await waitingAdjustment;
        expect(adjustmentError).toMatchObject({ code: "PRD01" });
        await adjuster.query("rollback");

        const finalState = await observer.query<{
          audit_count: number;
          is_active: boolean;
          movement_count: number;
          quantity: string;
        }>(
          `select
             product.is_active,
             balance.quantity,
             (
               select count(*)::integer
               from public.inventory_movements as movement
               where movement.product_id = product.id
             ) as movement_count,
             (
               select count(*)::integer
               from public.audit_logs as audit
               where audit.entity_id = product.id
                 and audit.action_type = 'inventory.manual_adjusted'
             ) as audit_count
           from public.products as product
           join public.inventory_balances as balance
             on balance.product_id = product.id
           where product.id = $1::uuid`,
          [productId],
        );
        expect(finalState.rows).toEqual([{
          audit_count: 0,
          is_active: false,
          movement_count: 0,
          quantity: "0",
        }]);
      } finally {
        await archiver.query("rollback");
        await adjuster.query("rollback");
        await observer.query("begin");
        await observer.query(
          "delete from public.inventory_balances where product_id = $1::uuid",
          [productId],
        );
        await observer.query(
          "delete from public.products where id = $1::uuid",
          [productId],
        );
        await observer.query("commit");
      }
    });
  });

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
           id, name, country, created_by_user_id, updated_by_user_id
         ) values ($1::uuid, $2::text, 'Germany', $3::uuid, $3::uuid)`,
        [supplierId, `Search Supplier ${token}`, actorId],
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, brand_id, product_kind,
           is_active, created_by_user_id, updated_by_user_id,
           archived_at, archived_by_user_id
         ) values
           ($1::uuid, $2::text, $3::text, 'Components', $7::uuid,
            'component', true, $8::uuid, $8::uuid, null, null),
           ($4::uuid, $5::text, $6::text, 'Historical', null,
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
        category: "Components",
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
        extension_schema: string;
        function_definition: string;
        name_index: string | null;
      }>(
        `select
           pg_catalog.pg_get_indexdef(name_index.indexrelid) as name_index,
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
      expect(infrastructure.rows[0]?.catalog_index).toContain("gin_trgm_ops");
      expect(infrastructure.rows[0]?.function_definition).toContain(
        "SECURITY DEFINER",
      );
      expect(infrastructure.rows[0]?.function_definition).toContain(
        "SET search_path TO ''",
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
            'Count corrected', 'manual_adjustment', null,
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

  it("enforces the canonical Project fields, dates, statuses, and lifecycle metadata", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const sharedName = `Project ${randomUUID()}`;
      const sharedCustomer = `Customer ${randomUUID()}`;
      const projectIds = Array.from({ length: 5 }, () => randomUUID());

      await database.query(
        `insert into public.projects (
           id, name, customer_name, start_date, delivery_date,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, $3::text, '2026-09-01'::date,
           '2026-09-01'::date, $4::uuid, $4::uuid
         )`,
        [projectIds[0], sharedName, sharedCustomer, actorId],
      );
      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           completed_at, cancelled_at, created_by_user_id, updated_by_user_id
         ) values
           ($1::uuid, $5::text, $6::text, 'in_progress', '2026-09-01'::date,
            '2026-09-10'::date, null, null, $7::uuid, $7::uuid),
           ($2::uuid, $5::text, $6::text, 'on_hold', '2026-09-01'::date,
            '2026-09-10'::date, null, null, $7::uuid, $7::uuid),
           ($3::uuid, $5::text, $6::text, 'completed', '2026-09-01'::date,
            '2026-09-10'::date, '2026-09-10T10:00:00Z'::timestamptz,
            null, $7::uuid, $7::uuid),
           ($4::uuid, $5::text, $6::text, 'cancelled', '2026-09-01'::date,
            '2026-09-10'::date, null,
            '2026-09-09T10:00:00Z'::timestamptz, $7::uuid, $7::uuid)`,
        [
          projectIds[1],
          projectIds[2],
          projectIds[3],
          projectIds[4],
          sharedName,
          sharedCustomer,
          actorId,
        ],
      );
      const projects = await database.query<ProjectRow>(
        `select
           id,
           name,
           customer_name,
           status,
           start_date::text as start_date,
           delivery_date::text as delivery_date,
           created_at,
           created_by_user_id,
           updated_at,
           updated_by_user_id,
           completed_at,
           cancelled_at
         from public.projects
         where id = any($1::uuid[])
         order by status, id`,
        [projectIds],
      );
      expect(projects.rows).toHaveLength(5);
      expect(projects.rows.map((project) => project.status).sort()).toEqual([
        "cancelled",
        "completed",
        "in_progress",
        "on_hold",
        "planned",
      ]);
      expect(projects.rows.every((project) =>
        project.name === sharedName && project.customer_name === sharedCustomer
      )).toBe(true);
      expect(projects.rows.find((project) => project.status === "planned"))
        .toMatchObject({
          cancelled_at: null,
          completed_at: null,
          delivery_date: "2026-09-01",
          start_date: "2026-09-01",
        });
      expect(projects.rows.find((project) => project.status === "completed")
        ?.completed_at).toEqual(expect.any(Date));
      expect(projects.rows.find((project) => project.status === "cancelled")
        ?.cancelled_at).toEqual(expect.any(Date));

      const invalidCases: Array<{
        label: string;
        values: unknown[];
      }> = [
        {
          label: "blank_name",
          values: ["   ", "Customer", "planned", "2026-09-01", "2026-09-02", null, null],
        },
        {
          label: "untrimmed_name",
          values: [" Project ", "Customer", "planned", "2026-09-01", "2026-09-02", null, null],
        },
        {
          label: "blank_customer",
          values: ["Project", "   ", "planned", "2026-09-01", "2026-09-02", null, null],
        },
        {
          label: "untrimmed_customer",
          values: ["Project", " Customer ", "planned", "2026-09-01", "2026-09-02", null, null],
        },
        {
          label: "delivery_before_start",
          values: ["Project", "Customer", "planned", "2026-09-02", "2026-09-01", null, null],
        },
        {
          label: "invalid_status",
          values: ["Project", "Customer", "archived", "2026-09-01", "2026-09-02", null, null],
        },
        {
          label: "completed_without_completed_at",
          values: ["Project", "Customer", "completed", "2026-09-01", "2026-09-02", null, null],
        },
        {
          label: "cancelled_without_cancelled_at",
          values: ["Project", "Customer", "cancelled", "2026-09-01", "2026-09-02", null, null],
        },
        {
          label: "planned_with_completed_at",
          values: ["Project", "Customer", "planned", "2026-09-01", "2026-09-02", "2026-09-02T10:00:00Z", null],
        },
        {
          label: "planned_with_cancelled_at",
          values: ["Project", "Customer", "planned", "2026-09-01", "2026-09-02", null, "2026-09-02T10:00:00Z"],
        },
        {
          label: "completed_with_cancelled_at",
          values: ["Project", "Customer", "completed", "2026-09-01", "2026-09-02", null, "2026-09-02T10:00:00Z"],
        },
        {
          label: "cancelled_with_completed_at",
          values: ["Project", "Customer", "cancelled", "2026-09-01", "2026-09-02", "2026-09-02T10:00:00Z", null],
        },
      ];

      for (const invalid of invalidCases) {
        await database.query(`savepoint invalid_project_${invalid.label}`);
        await expect(
          database.query(
            `insert into public.projects (
               name, customer_name, status, start_date, delivery_date,
               completed_at, cancelled_at, created_by_user_id,
               updated_by_user_id
             ) values (
               $1::text, $2::text, $3::text, $4::date, $5::date,
               $6::timestamptz, $7::timestamptz, $8::uuid, $8::uuid
             )`,
            [...invalid.values, actorId],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await database.query(`rollback to savepoint invalid_project_${invalid.label}`);
      }

      const columns = await database.query<{
        column_default: string | null;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'projects'
         order by ordinal_position`,
      );
      expect(columns.rows.map((column) => column.column_name)).toEqual([
        "id",
        "name",
        "customer_name",
        "status",
        "start_date",
        "delivery_date",
        "created_at",
        "created_by_user_id",
        "updated_at",
        "updated_by_user_id",
        "completed_at",
        "cancelled_at",
      ]);
      expect(columns.rows.find((column) => column.column_name === "status"))
        .toMatchObject({ column_default: "'planned'::text", is_nullable: "NO" });
      expect(columns.rows.find((column) => column.column_name === "start_date"))
        .toMatchObject({ data_type: "date", is_nullable: "NO" });
      expect(columns.rows.find((column) => column.column_name === "delivery_date"))
        .toMatchObject({ data_type: "date", is_nullable: "NO" });
      expect(columns.rows.some((column) => [
        "is_active",
        "archived_at",
        "archived_by_user_id",
      ].includes(column.column_name))).toBe(false);
    });
  });

  it("limits Project reads to active Project viewers and denies every direct client write", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const projectIds = [randomUUID(), randomUUID(), randomUUID()];
      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           completed_at, cancelled_at, created_by_user_id,
           updated_by_user_id
         ) values
           ($1::uuid, 'Readable Planned Project', 'Customer', 'planned',
            '2026-09-01'::date, '2026-09-02'::date, null, null,
            $4::uuid, $4::uuid),
           ($2::uuid, 'Readable Completed Project', 'Customer', 'completed',
            '2026-09-01'::date, '2026-09-02'::date,
            '2026-09-02T10:00:00Z'::timestamptz, null,
            $4::uuid, $4::uuid),
           ($3::uuid, 'Readable Cancelled Project', 'Customer', 'cancelled',
            '2026-09-01'::date, '2026-09-02'::date,
            null, '2026-09-02T10:00:00Z'::timestamptz,
            $4::uuid, $4::uuid)`,
        [...projectIds, actorId],
      );

      for (const actor of [fixture.actors.admin, fixture.actors.permitted]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ id: string; status: string }>(
          `select id, status
           from public.projects
           where id = any($1::uuid[])
           order by status, id`,
          [projectIds],
        );
        await database.query("reset role");
        expect(visible.rows.map((project) => project.status).sort()).toEqual([
          "cancelled",
          "completed",
          "planned",
        ]);
      }

      for (const actor of [
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ id: string }>(
          `select id
           from public.projects
           where id = any($1::uuid[])`,
          [projectIds],
        );
        await database.query("reset role");
        expect(hidden.rows).toEqual([]);
      }

      const security = await database.query<{
        authenticated_delete: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        policy_expression: string;
        row_security: boolean;
      }>(
        `select
           class.relrowsecurity as row_security,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'select'
           ) as authenticated_select,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'insert'
           ) as authenticated_insert,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'update'
           ) as authenticated_update,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'delete'
           ) as authenticated_delete,
           pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
             as policy_expression
         from pg_catalog.pg_class as class
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = class.relnamespace
         join pg_catalog.pg_policy as policy
           on policy.polrelid = class.oid
          and policy.polname = 'projects_select_authorized'
         where namespace.nspname = 'public'
           and class.relname = 'projects'`,
      );
      expect(security.rows).toHaveLength(1);
      expect(security.rows[0]).toMatchObject({
        authenticated_delete: false,
        authenticated_insert: false,
        authenticated_select: true,
        authenticated_update: false,
        row_security: true,
      });
      expect(security.rows[0]?.policy_expression).toContain(
        "current_user_is_admin()",
      );
      expect(security.rows[0]?.policy_expression).toContain(
        "has_permission('projects.view'::text)",
      );

      const prematureFunctions = await database.query<{ count: number }>(
        `select count(*)::integer as count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = any($1::text[])`,
        [[
          "set_project_status",
          "archive_project",
        ]],
      );
      expect(prematureFunctions.rows).toEqual([{ count: 0 }]);
    });

    const adminClient = fixture.actors.admin.client;
    const directInsert = await adminClient.from("projects").insert({
      name: "Forbidden Direct Project",
      customer_name: "Forbidden Customer",
      start_date: "2026-09-01",
      delivery_date: "2026-09-02",
      created_by_user_id: fixture.actors.admin.profileId,
      updated_by_user_id: fixture.actors.admin.profileId,
    });
    const directUpdate = await adminClient
      .from("projects")
      .update({ name: "Forbidden Update" })
      .eq("id", randomUUID());
    const directDelete = await adminClient
      .from("projects")
      .delete()
      .eq("id", randomUUID());
    expectPermissionDenied(directInsert.error);
    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);

    const anonymousRead = await fixture.anonymousClient
      .from("projects")
      .select("id")
      .limit(1);
    expectPermissionDenied(anonymousRead.error);
  });

  it("creates only planned Projects for active Admins and delegated Project creators", async () => {
    const fixture = requireHarness();
    const delegatedActor = fixture.actors.productCreator;
    const unrelatedActor = fixture.actors.unpermitted;
    const delegatedName = `Delegated Project ${randomUUID()}`;
    const adminName = `Admin Project ${randomUUID()}`;
    const deniedName = `Denied Project ${randomUUID()}`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id,
           permission_definition_id,
           granted_by_user_id
         )
         select $1::uuid, definition.id, $2::uuid
         from public.permission_definitions as definition
         where definition.key = any($3::text[])`,
        [
          unrelatedActor.profileId,
          fixture.actors.admin.profileId,
          ["projects.edit", "projects.archive"],
        ],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [unrelatedActor.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint unrelated_project_permissions");
      await expect(
        database.query(
          `select public.create_project(
             $1::text, $2::text, $3::date, $4::date
           )`,
          [deniedName, "Denied Customer", "2026-09-01", "2026-09-10"],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint unrelated_project_permissions");
      await database.query("reset role");

      await database.query(
        `insert into public.user_permissions (
           user_id,
           permission_definition_id,
           granted_by_user_id
         )
         select $1::uuid, definition.id, $2::uuid
         from public.permission_definitions as definition
         where definition.key = 'projects.create'`,
        [delegatedActor.profileId, fixture.actors.admin.profileId],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [delegatedActor.authUserId],
      );
      await database.query("set local role authenticated");
      const delegatedPermissions = await database.query<{
        can_create: boolean;
        can_view: boolean;
      }>(
        `select
           public.has_permission('projects.create') as can_create,
           public.has_permission('projects.view') as can_view`,
      );
      const delegatedCreation = await database.query<{ project_id: string }>(
        `select public.create_project(
           $1::text, $2::text, $3::date, $4::date
         ) as project_id`,
        [
          `  ${delegatedName}  `,
          "  Delegated Customer  ",
          "2026-09-01",
          "2026-09-10",
        ],
      );
      await database.query("reset role");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const adminCreation = await database.query<{ project_id: string }>(
        `select public.create_project(
           $1::text, $2::text, $3::date, $4::date
         ) as project_id`,
        [adminName, "Admin Customer", "2026-10-01", "2026-10-01"],
      );
      await database.query("reset role");

      const projectIds = [
        delegatedCreation.rows[0]?.project_id,
        adminCreation.rows[0]?.project_id,
      ];
      if (projectIds.some((projectId) => !projectId)) {
        throw new Error("Trusted Project creation returned no ID");
      }

      const projects = await database.query<ProjectRow>(
        `select
           id,
           name,
           customer_name,
           status,
           start_date::text as start_date,
           delivery_date::text as delivery_date,
           created_at,
           created_by_user_id,
           updated_at,
           updated_by_user_id,
           completed_at,
           cancelled_at
         from public.projects
         where id = any($1::uuid[])
         order by name`,
        [projectIds],
      );
      const audits = await database.query<ProjectAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type = 'project.created'
         order by entity_id`,
        [projectIds],
      );
      const delegatedProject = projects.rows.find(
        (project) => project.id === delegatedCreation.rows[0]?.project_id,
      );
      const adminProject = projects.rows.find(
        (project) => project.id === adminCreation.rows[0]?.project_id,
      );

      expect(delegatedPermissions.rows).toEqual([{
        can_create: true,
        can_view: false,
      }]);
      expect(projects.rows).toHaveLength(2);
      expect(delegatedProject).toMatchObject({
        cancelled_at: null,
        completed_at: null,
        created_by_user_id: delegatedActor.profileId,
        customer_name: "Delegated Customer",
        delivery_date: "2026-09-10",
        name: delegatedName,
        start_date: "2026-09-01",
        status: "planned",
        updated_by_user_id: delegatedActor.profileId,
      });
      expect(delegatedProject?.created_at).toEqual(delegatedProject?.updated_at);
      expect(adminProject).toMatchObject({
        cancelled_at: null,
        completed_at: null,
        created_by_user_id: fixture.actors.admin.profileId,
        customer_name: "Admin Customer",
        delivery_date: "2026-10-01",
        name: adminName,
        start_date: "2026-10-01",
        status: "planned",
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(adminProject?.created_at).toEqual(adminProject?.updated_at);
      expect(audits.rows).toHaveLength(2);
      expect(audits.rows).toEqual(expect.arrayContaining([
        {
          action_type: "project.created",
          actor_user_id: delegatedActor.profileId,
          after_data: {
            cancelled_at: null,
            completed_at: null,
            customer_name: "Delegated Customer",
            delivery_date: "2026-09-10",
            name: delegatedName,
            start_date: "2026-09-01",
            status: "planned",
          },
          before_data: null,
          entity_id: delegatedCreation.rows[0]?.project_id,
          entity_type: "project",
        },
        {
          action_type: "project.created",
          actor_user_id: fixture.actors.admin.profileId,
          after_data: {
            cancelled_at: null,
            completed_at: null,
            customer_name: "Admin Customer",
            delivery_date: "2026-10-01",
            name: adminName,
            start_date: "2026-10-01",
            status: "planned",
          },
          before_data: null,
          entity_id: adminCreation.rows[0]?.project_id,
          entity_type: "project",
        },
      ]));

      const denied = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.projects
         where name = $1::text`,
        [deniedName],
      );
      const deniedAudit = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where action_type = 'project.created'
           and after_data ->> 'name' = $1::text`,
        [deniedName],
      );
      expect(denied.rows).toEqual([{ count: 0 }]);
      expect(deniedAudit.rows).toEqual([{ count: 0 }]);

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        identity_arguments: string;
        is_security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.pg_get_function_identity_arguments(routine.oid)
             as identity_arguments,
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
           and routine.proname = 'create_project'`,
      );
      expect(functionSecurity.rows).toEqual([{
        anonymous_execute: false,
        authenticated_execute: true,
        identity_arguments:
          "p_name text, p_customer_name text, p_start_date date, p_delivery_date date",
        is_security_definer: true,
        settings: ["search_path=\"\""],
      }]);
    });
  });

  it("rejects invalid Project creation without persisting a Project or audit", async () => {
    const fixture = requireHarness();
    const namePrefix = `Invalid Project ${randomUUID()}`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const projectsBefore = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.projects",
      );
      const auditsBefore = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.audit_logs",
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");

      const invalidCases: ReadonlyArray<{
        expectedCode: string;
        label: string;
        values: unknown[];
      }> = [
        {
          expectedCode: "22023",
          label: "blank_name",
          values: ["   ", "Customer", "2026-09-01", "2026-09-10"],
        },
        {
          expectedCode: "22023",
          label: "blank_customer",
          values: [`${namePrefix} blank customer`, "   ", "2026-09-01", "2026-09-10"],
        },
        {
          expectedCode: "22023",
          label: "missing_start",
          values: [`${namePrefix} missing start`, "Customer", null, "2026-09-10"],
        },
        {
          expectedCode: "22023",
          label: "missing_delivery",
          values: [`${namePrefix} missing delivery`, "Customer", "2026-09-01", null],
        },
        {
          expectedCode: "22007",
          label: "invalid_date",
          values: [`${namePrefix} invalid date`, "Customer", "not-a-date", "2026-09-10"],
        },
        {
          expectedCode: "22023",
          label: "delivery_before_start",
          values: [`${namePrefix} date order`, "Customer", "2026-09-10", "2026-09-01"],
        },
      ];

      for (const invalid of invalidCases) {
        await database.query(`savepoint invalid_project_create_${invalid.label}`);
        await expect(
          database.query(
            `select public.create_project(
               $1::text, $2::text, $3::date, $4::date
             )`,
            invalid.values,
          ),
        ).rejects.toMatchObject({ code: invalid.expectedCode });
        await database.query(
          `rollback to savepoint invalid_project_create_${invalid.label}`,
        );
      }
      await database.query("reset role");

      const projectsAfter = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.projects",
      );
      const auditsAfter = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.audit_logs",
      );
      expect(projectsAfter.rows).toEqual(projectsBefore.rows);
      expect(auditsAfter.rows).toEqual(auditsBefore.rows);
    });
  });

  it("denies Project creation without active Admin or projects.create authority", async () => {
    const fixture = requireHarness();
    const deniedNamePrefix = `Denied RPC Project ${randomUUID()}`;
    const deniedActors = [
      fixture.actors.permitted,
      fixture.actors.productCreator,
      fixture.actors.brandManager,
      fixture.actors.unpermitted,
      fixture.actors.inactive,
    ];

    for (const [index, actor] of deniedActors.entries()) {
      const denied = await actor.client.rpc("create_project", {
        p_name: `${deniedNamePrefix} ${index}`,
        p_customer_name: "Denied Customer",
        p_start_date: "2026-09-01",
        p_delivery_date: "2026-09-10",
      });
      expectPermissionDenied(denied.error);
    }

    const anonymous = await fixture.anonymousClient.rpc("create_project", {
      p_name: `${deniedNamePrefix} anonymous`,
      p_customer_name: "Denied Customer",
      p_start_date: "2026-09-01",
      p_delivery_date: "2026-09-10",
    });
    expectPermissionDenied(anonymous.error);

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const projects = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.projects
         where name like $1::text`,
        [`${deniedNamePrefix}%`],
      );
      const audits = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where action_type = 'project.created'
           and after_data ->> 'name' like $1::text`,
        [`${deniedNamePrefix}%`],
      );
      expect(projects.rows).toEqual([{ count: 0 }]);
      expect(audits.rows).toEqual([{ count: 0 }]);
    });
  });

  it("edits Projects through trusted normal statuses with lifecycle and audit/no-op guarantees", async () => {
    const fixture = requireHarness();
    const projectId = randomUUID();
    const existingCompletedId = randomUUID();
    const cancelledId = randomUUID();
    const editor = fixture.actors.productCreator;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id)
         select $1::uuid, id, $2::uuid from public.permission_definitions
         where key = 'projects.edit'`,
        [editor.profileId, fixture.actors.admin.profileId],
      );
      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           created_by_user_id, updated_by_user_id, completed_at, cancelled_at
         ) values
           ($1, 'Editable Project', 'Customer', 'planned', '2026-09-01', '2026-09-30', $4, $4, null, null),
           ($2, 'Completed Project', 'Customer', 'completed', '2026-09-01', '2026-09-30', $4, $4, '2026-09-30T10:00:00Z', null),
           ($3, 'Cancelled Project', 'Customer', 'cancelled', '2026-09-01', '2026-09-30', $4, $4, null, '2026-09-20T10:00:00Z')`,
        [projectId, existingCompletedId, cancelledId, fixture.actors.admin.profileId],
      );
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [fixture.actors.admin.authUserId]);
      await database.query("set local role authenticated");
      await database.query(
        `select public.update_project($1, 'Admin Edited Project', 'Customer', '2026-09-01', '2026-09-30', 'planned')`,
        [projectId],
      );
      await database.query("reset role");
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [editor.authUserId]);
      await database.query("set local role authenticated");

      for (const status of ["in_progress", "on_hold", "planned"]) {
        await database.query(
          `select public.update_project($1, $2, $3, $4, $5, $6)`,
          [projectId, "  Editable Project  ", "  Updated Customer  ", "2026-09-02", "2026-10-01", status],
        );
      }
      await database.query("reset role");

      const beforeNoOp = await database.query<ProjectRow>(
        `select *, start_date::text as start_date, delivery_date::text as delivery_date
         from public.projects where id = $1`, [projectId],
      );
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [editor.authUserId]);
      await database.query("set local role authenticated");
      await database.query(
        `select public.update_project($1, 'Editable Project', 'Updated Customer', '2026-09-02', '2026-10-01', 'planned')`,
        [projectId],
      );
      await database.query("reset role");
      const afterNoOp = await database.query<ProjectRow>(
        `select *, start_date::text as start_date, delivery_date::text as delivery_date
         from public.projects where id = $1`, [projectId],
      );
      expect(afterNoOp.rows).toEqual(beforeNoOp.rows);

      const openProject = await database.query<ProjectRow>(
        `select *, start_date::text as start_date, delivery_date::text as delivery_date
         from public.projects where id = $1`, [projectId],
      );
      expect(openProject.rows[0]).toMatchObject({
        name: "Editable Project", customer_name: "Updated Customer",
        status: "planned", start_date: "2026-09-02",
        delivery_date: "2026-10-01", updated_by_user_id: editor.profileId,
        completed_at: null,
        cancelled_at: null,
      });

      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [editor.authUserId]);
      await database.query("set local role authenticated");
      await database.query("savepoint deny_cancelled_edit");
      await expect(database.query(
        `select public.update_project($1, 'Changed', 'Customer', '2026-09-01', '2026-09-30', 'planned')`,
        [cancelledId],
      )).rejects.toMatchObject({ code: "PRJ01" });
      await database.query("rollback to savepoint deny_cancelled_edit");
      await database.query("reset role");

      const finalRows = await database.query<ProjectRow>(
        `select *, start_date::text as start_date, delivery_date::text as delivery_date
         from public.projects where id = any($1::uuid[])`,
        [[projectId, existingCompletedId, cancelledId]],
      );
      expect(finalRows.rows.find((row) => row.id === projectId)).toMatchObject({
        status: "planned",
        completed_at: null,
        cancelled_at: null,
      });
      expect(finalRows.rows.find((row) => row.id === existingCompletedId)).toMatchObject({
        name: "Completed Project",
        completed_at: new Date("2026-09-30T10:00:00Z"),
      });
      expect(finalRows.rows.find((row) => row.id === cancelledId)?.name).toBe("Cancelled Project");
      const audits = await database.query<ProjectAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id, before_data, after_data
         from public.audit_logs where entity_id = any($1::uuid[]) and action_type = 'project.updated'`,
        [[projectId, existingCompletedId, cancelledId]],
      );
      expect(audits.rows).toHaveLength(4);
      expect(audits.rows.filter((row) => row.actor_user_id === fixture.actors.admin.profileId)).toHaveLength(1);
      expect(audits.rows.filter((row) => row.actor_user_id === editor.profileId)).toHaveLength(3);
      expect(audits.rows.filter((row) => row.entity_id === cancelledId)).toHaveLength(0);
      expect(audits.rows.filter((row) => row.entity_id === existingCompletedId)).toHaveLength(0);
      expect(audits.rows.some((row) => row.after_data?.status === "completed"))
        .toBe(false);
    });
  });

  it("rejects manual completion from every open status for Admin and projects.edit without mutation or audit", async () => {
    const fixture = requireHarness();
    const editor = fixture.actors.productCreator;
    const projectIds = [randomUUID(), randomUUID(), randomUUID()];

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select $1::uuid, id, $2::uuid
         from public.permission_definitions
         where key = 'projects.edit'`,
        [editor.profileId, fixture.actors.admin.profileId],
      );
      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           created_at, created_by_user_id, updated_at, updated_by_user_id,
           completed_at, cancelled_at
         ) values
           ($1, 'Planned Manual Completion', 'Customer', 'planned',
            '2026-09-01', '2026-09-30', '2026-09-01T08:00:00Z', $4,
            '2026-09-02T08:00:00Z', $4, null, null),
           ($2, 'Progress Manual Completion', 'Customer', 'in_progress',
            '2026-09-01', '2026-09-30', '2026-09-01T08:00:00Z', $4,
            '2026-09-02T08:00:00Z', $4, null, null),
           ($3, 'Hold Manual Completion', 'Customer', 'on_hold',
            '2026-09-01', '2026-09-30', '2026-09-01T08:00:00Z', $4,
            '2026-09-02T08:00:00Z', $4, null, null)`,
        [...projectIds, fixture.actors.admin.profileId],
      );
      const baseline = await database.query<{
        completed_at: Date | null;
        id: string;
        status: string;
        updated_at: Date;
        updated_by_user_id: string;
      }>(
        `select id, status, completed_at, updated_at, updated_by_user_id
         from public.projects
         where id = any($1::uuid[])
         order by id`,
        [projectIds],
      );

      for (const actor of [fixture.actors.admin, editor]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        for (const [index, projectId] of projectIds.entries()) {
          await database.query(`savepoint manual_completion_${index}`);
          await expect(database.query(
            `select public.update_project(
               $1, 'Manual Completion Attempt', 'Customer',
               '2026-09-01', '2026-09-30', 'completed'
             )`,
            [projectId],
          )).rejects.toMatchObject({ code: "22023" });
          await database.query(`rollback to savepoint manual_completion_${index}`);
        }
        await database.query("reset role");
      }

      const unchanged = await database.query<{
        completed_at: Date | null;
        id: string;
        status: string;
        updated_at: Date;
        updated_by_user_id: string;
      }>(
        `select id, status, completed_at, updated_at, updated_by_user_id
         from public.projects
         where id = any($1::uuid[])
         order by id`,
        [projectIds],
      );
      expect(unchanged.rows).toEqual(baseline.rows);
      expect(unchanged.rows.every((row) => row.completed_at === null)).toBe(true);
      expect((await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type = 'project.updated'`,
        [projectIds],
      )).rows).toEqual([{ count: 0 }]);
    });
  });

  it("locks every normal edit of a Completed Project for Admin and projects.edit actors", async () => {
    const fixture = requireHarness();
    const projectId = randomUUID();
    const editor = fixture.actors.productCreator;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select $1::uuid, id, $2::uuid
         from public.permission_definitions
         where key = 'projects.edit'`,
        [editor.profileId, fixture.actors.admin.profileId],
      );
      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           created_at, created_by_user_id, updated_at, updated_by_user_id,
           completed_at, cancelled_at
         ) values (
           $1, 'Locked Completed Project', 'Original Customer', 'completed',
           '2026-09-01', '2026-09-30', '2026-09-01T09:00:00Z', $2,
           '2026-09-30T10:30:00Z', $2, '2026-09-30T10:00:00Z', null
         )`,
        [projectId, fixture.actors.admin.profileId],
      );
      const baseline = await database.query<ProjectRow>(
        `select *, start_date::text as start_date,
                delivery_date::text as delivery_date
         from public.projects
         where id = $1`,
        [projectId],
      );
      const attempts: ReadonlyArray<{
        deliveryDate: string;
        name: string;
        customer: string;
        startDate: string;
        status: string;
      }> = [
        {
          name: "Changed Name",
          customer: "Original Customer",
          startDate: "2026-09-01",
          deliveryDate: "2026-09-30",
          status: "completed",
        },
        {
          name: "Locked Completed Project",
          customer: "Changed Customer",
          startDate: "2026-09-01",
          deliveryDate: "2026-09-30",
          status: "completed",
        },
        {
          name: "Locked Completed Project",
          customer: "Original Customer",
          startDate: "2026-09-02",
          deliveryDate: "2026-10-01",
          status: "completed",
        },
        {
          name: "Locked Completed Project",
          customer: "Original Customer",
          startDate: "2026-09-01",
          deliveryDate: "2026-09-30",
          status: "completed",
        },
        {
          name: "Locked Completed Project",
          customer: "Original Customer",
          startDate: "2026-09-01",
          deliveryDate: "2026-09-30",
          status: "in_progress",
        },
      ];

      for (const actor of [fixture.actors.admin, editor]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        for (const [index, attempt] of attempts.entries()) {
          await database.query(`savepoint completed_project_lock_${index}`);
          await expect(database.query(
            `select public.update_project(
               $1::uuid, $2::text, $3::text, $4::date, $5::date, $6::text
             )`,
            [
              projectId,
              attempt.name,
              attempt.customer,
              attempt.startDate,
              attempt.deliveryDate,
              attempt.status,
            ],
          )).rejects.toMatchObject({ code: "PRJ02" });
          await database.query(`rollback to savepoint completed_project_lock_${index}`);
        }
        await database.query("reset role");

        const unchanged = await database.query<ProjectRow>(
          `select *, start_date::text as start_date,
                  delivery_date::text as delivery_date
           from public.projects
           where id = $1`,
          [projectId],
        );
        expect(unchanged.rows).toEqual(baseline.rows);
        const audits = await database.query<CountResultRow>(
          `select count(*)::integer as count
           from public.audit_logs
           where entity_id = $1
             and action_type = 'project.updated'`,
          [projectId],
        );
        expect(audits.rows).toEqual([{ count: 0 }]);
      }
    });
  });

  it("rejects invalid and unauthorized Project edits without mutation or audit", async () => {
    const fixture = requireHarness();
    const projectId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.projects (id, name, customer_name, status, start_date, delivery_date, created_by_user_id, updated_by_user_id)
         values ($1, 'Guarded Project', 'Customer', 'planned', '2026-09-01', '2026-09-30', $2, $2)`,
        [projectId, fixture.actors.admin.profileId],
      );
      await database.query(
        `insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id)
         select grant_row.actor_id, definition.id, $3::uuid
         from unnest($1::uuid[], $2::text[]) as grant_row(actor_id, permission_key)
         join public.permission_definitions as definition on definition.key = grant_row.permission_key`,
        [[fixture.actors.productCreator.profileId, fixture.actors.supplierEditor.profileId], ["projects.create", "projects.archive"], fixture.actors.admin.profileId],
      );
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [fixture.actors.admin.authUserId]);
      await database.query("set local role authenticated");
      const invalidCases: unknown[][] = [
        ["   ", "Customer", "2026-09-01", "2026-09-30", "planned"],
        ["Project", "   ", "2026-09-01", "2026-09-30", "planned"],
        ["Project", "Customer", null, "2026-09-30", "planned"],
        ["Project", "Customer", "2026-10-01", "2026-09-30", "planned"],
        ["Project", "Customer", "2026-09-01", "2026-09-30", "completed"],
        ["Project", "Customer", "2026-09-01", "2026-09-30", "cancelled"],
        ["Project", "Customer", "2026-09-01", "2026-09-30", "unknown"],
      ];
      for (const [index, values] of invalidCases.entries()) {
        await database.query(`savepoint invalid_project_edit_${index}`);
        await expect(database.query(
          `select public.update_project($1::uuid, $2::text, $3::text, $4::date, $5::date, $6::text)`,
          [projectId, ...values],
        )).rejects.toMatchObject({ code: "22023" });
        await database.query(`rollback to savepoint invalid_project_edit_${index}`);
      }
      await database.query("reset role");

      for (const actor of [fixture.actors.permitted, fixture.actors.productCreator, fixture.actors.supplierEditor, fixture.actors.unpermitted, fixture.actors.inactive]) {
        await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [actor.authUserId]);
        await database.query("set local role authenticated");
        await database.query("savepoint denied_project_edit");
        await expect(database.query(
          `select public.update_project($1, 'Changed', 'Customer', '2026-09-01', '2026-09-30', 'planned')`,
          [projectId],
        )).rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint denied_project_edit");
        await database.query("reset role");
      }
      expect((await database.query("select name from public.projects where id = $1", [projectId])).rows).toEqual([{ name: "Guarded Project" }]);
      expect((await database.query<CountResultRow>(
        `select count(*)::integer as count from public.audit_logs where entity_id = $1 and action_type = 'project.updated'`, [projectId],
      )).rows).toEqual([{ count: 0 }]);
    });

    const anonymous = await fixture.anonymousClient.rpc("update_project", {
      p_project_id: projectId, p_name: "Changed", p_customer_name: "Customer",
      p_start_date: "2026-09-01", p_delivery_date: "2026-09-30", p_status: "planned",
    });
    expectPermissionDenied(anonymous.error);
  });

  it("cancels eligible Projects only for Admin or projects.archive and audits atomically", async () => {
    const fixture = requireHarness();
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const archiver = fixture.actors.supplierEditor;
    const editor = fixture.actors.productEditor;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id)
         select grant_row.actor_id, definition.id, $3::uuid
         from unnest($1::uuid[], $2::text[]) as grant_row(actor_id, permission_key)
         join public.permission_definitions as definition on definition.key = grant_row.permission_key`,
        [[archiver.profileId, editor.profileId], ["projects.archive", "projects.edit"], fixture.actors.admin.profileId],
      );
      await database.query(
        `insert into public.projects (id, name, customer_name, status, start_date, delivery_date, completed_at, cancelled_at, created_by_user_id, updated_by_user_id) values
         ($1, 'Planned', 'Customer', 'planned', '2026-09-01', '2026-09-30', null, null, $6, $6),
         ($2, 'Progress', 'Customer', 'in_progress', '2026-09-01', '2026-09-30', null, null, $6, $6),
         ($3, 'Hold', 'Customer', 'on_hold', '2026-09-01', '2026-09-30', null, null, $6, $6),
         ($4, 'Completed', 'Customer', 'completed', '2026-09-01', '2026-09-30', '2026-09-30', null, $6, $6),
         ($5, 'Cancelled', 'Customer', 'cancelled', '2026-09-01', '2026-09-30', null, '2026-09-20', $6, $6)`,
        [...ids, fixture.actors.admin.profileId],
      );
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [fixture.actors.admin.authUserId]);
      await database.query("set local role authenticated");
      await database.query("select public.cancel_project($1)", [ids[0]]);
      await database.query("reset role");
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [archiver.authUserId]);
      await database.query("set local role authenticated");
      await database.query("select public.cancel_project($1)", [ids[1]]);
      await database.query("select public.cancel_project($1)", [ids[2]]);
      for (const [index, id] of [ids[3], ids[4]].entries()) {
        await database.query(`savepoint invalid_cancel_${index}`);
        await expect(database.query("select public.cancel_project($1)", [id])).rejects.toMatchObject({ code: "PRJ03" });
        await database.query(`rollback to savepoint invalid_cancel_${index}`);
      }
      await database.query("reset role");
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [editor.authUserId]);
      await database.query("set local role authenticated");
      await database.query("savepoint edit_only_cancel_denied");
      await expect(database.query("select public.cancel_project($1)", [ids[3]])).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint edit_only_cancel_denied");
      await database.query("reset role");

      const rows = await database.query<ProjectRow>(
        `select *, start_date::text as start_date, delivery_date::text as delivery_date from public.projects where id = any($1::uuid[])`, [ids],
      );
      for (const id of ids.slice(0, 3)) {
        expect(rows.rows.find((row) => row.id === id)).toMatchObject({ status: "cancelled", completed_at: null });
        expect(rows.rows.find((row) => row.id === id)?.cancelled_at).toBeInstanceOf(Date);
      }
      expect(rows.rows.find((row) => row.id === ids[3])?.status).toBe("completed");
      expect(rows.rows.find((row) => row.id === ids[4])?.status).toBe("cancelled");
      const audits = await database.query<ProjectAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id, before_data, after_data from public.audit_logs
         where entity_id = any($1::uuid[]) and action_type = 'project.cancelled'`, [ids],
      );
      expect(audits.rows).toHaveLength(3);
      expect(audits.rows.find((row) => row.entity_id === ids[0])?.actor_user_id).toBe(fixture.actors.admin.profileId);
      const delegatedCancelledIds = new Set<string>(ids.slice(1, 3));
      expect(audits.rows.filter((row) => delegatedCancelledIds.has(row.entity_id)).every((row) => row.actor_user_id === archiver.profileId)).toBe(true);
      expect(audits.rows.find((row) => row.entity_id === ids[0])).toMatchObject({
        action_type: "project.cancelled",
        before_data: { status: "planned", cancelled_at: null },
        after_data: { status: "cancelled", completed_at: null },
      });

      const security = await database.query<{
        anonymous_execute: boolean; authenticated_execute: boolean;
        identity_arguments: string; name: string; security_definer: boolean; settings: string[];
      }>(
        `select routine.proname as name, pg_catalog.pg_get_function_identity_arguments(routine.oid) as identity_arguments,
                routine.prosecdef as security_definer, routine.proconfig as settings,
                pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute,
                pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute
         from pg_catalog.pg_proc as routine join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public' and routine.proname = any(array['update_project', 'cancel_project']::text[]) order by routine.proname`,
      );
      expect(security.rows).toEqual([
        { name: "cancel_project", identity_arguments: "p_project_id uuid", security_definer: true, settings: ["search_path=\"\""], anonymous_execute: false, authenticated_execute: true },
        { name: "update_project", identity_arguments: "p_project_id uuid, p_name text, p_customer_name text, p_start_date date, p_delivery_date date, p_status text", security_definer: true, settings: ["search_path=\"\""], anonymous_execute: false, authenticated_execute: true },
      ]);
    });

    for (const actor of [fixture.actors.permitted, fixture.actors.unpermitted, fixture.actors.inactive]) {
      expectPermissionDenied((await actor.client.rpc("cancel_project", { p_project_id: ids[0] })).error);
    }
    expectPermissionDenied((await fixture.anonymousClient.rpc("cancel_project", { p_project_id: ids[0] })).error);
  });

  it("reopens only a Completed Project for an active Admin and audits the exact transition", async () => {
    const fixture = requireHarness();
    const projectId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           created_at, created_by_user_id, updated_at, updated_by_user_id,
           completed_at, cancelled_at
         ) values (
           $1, 'Completed Reopen Project', 'Original Customer', 'completed',
           '2026-09-01', '2026-09-30', '2026-09-01T09:00:00Z', $2,
           '2026-09-30T10:30:00Z', $2, '2026-09-30T10:00:00Z', null
         )`,
        [projectId, fixture.actors.admin.profileId],
      );
      const baseline = await database.query<ProjectRow>(
        `select *, start_date::text as start_date,
                delivery_date::text as delivery_date
         from public.projects where id = $1`,
        [projectId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint normal_completed_edit_still_denied");
      await expect(database.query(
        `select public.update_project(
           $1, 'Changed', 'Original Customer', '2026-09-01',
           '2026-09-30', 'in_progress'
         )`,
        [projectId],
      )).rejects.toMatchObject({ code: "PRJ02" });
      await database.query("rollback to savepoint normal_completed_edit_still_denied");
      const reopened = await database.query<{ project_id: string }>(
        "select public.reopen_project($1) as project_id",
        [projectId],
      );
      await database.query("reset role");

      expect(reopened.rows).toEqual([{ project_id: projectId }]);
      const row = await database.query<ProjectRow>(
        `select *, start_date::text as start_date,
                delivery_date::text as delivery_date
         from public.projects where id = $1`,
        [projectId],
      );
      expect(row.rows[0]).toMatchObject({
        cancelled_at: null,
        completed_at: null,
        customer_name: "Original Customer",
        delivery_date: "2026-09-30",
        name: "Completed Reopen Project",
        start_date: "2026-09-01",
        status: "in_progress",
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(row.rows[0]?.created_at).toEqual(baseline.rows[0]?.created_at);
      expect(row.rows[0]?.created_by_user_id).toBe(
        baseline.rows[0]?.created_by_user_id,
      );
      expect(row.rows[0]?.updated_at).not.toEqual(baseline.rows[0]?.updated_at);

      const audits = await database.query<ProjectAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1 and action_type = 'project.reopened'`,
        [projectId],
      );
      expect(audits.rows).toEqual([{
        action_type: "project.reopened",
        actor_user_id: fixture.actors.admin.profileId,
        after_data: {
          cancelled_at: null,
          completed_at: null,
          customer_name: "Original Customer",
          delivery_date: "2026-09-30",
          name: "Completed Reopen Project",
          start_date: "2026-09-01",
          status: "in_progress",
        },
        before_data: {
          cancelled_at: null,
          completed_at: "2026-09-30T10:00:00+00:00",
          customer_name: "Original Customer",
          delivery_date: "2026-09-30",
          name: "Completed Reopen Project",
          start_date: "2026-09-01",
          status: "completed",
        },
        entity_id: projectId,
        entity_type: "project",
      }]);

      const security = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        identity_arguments: string;
        security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.prosecdef as security_definer,
           routine.proconfig as settings,
           pg_catalog.pg_get_function_identity_arguments(routine.oid)
             as identity_arguments,
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
           and routine.proname = 'reopen_project'`,
      );
      expect(security.rows).toEqual([{
        anonymous_execute: false,
        authenticated_execute: true,
        identity_arguments: "p_project_id uuid",
        security_definer: true,
        settings: ["search_path=\"\""],
      }]);
    });
  });

  it("rejects every non-Completed source and every non-Admin reopen actor without side effects", async () => {
    const fixture = requireHarness();
    const sourceStatuses = [
      "planned",
      "in_progress",
      "on_hold",
      "cancelled",
    ] as const;
    const sourceIds = sourceStatuses.map(() => randomUUID());
    const completedId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select grant_row.actor_id, definition.id, $3::uuid
         from unnest($1::uuid[], $2::text[])
           as grant_row(actor_id, permission_key)
         join public.permission_definitions as definition
           on definition.key = grant_row.permission_key`,
        [
          [
            fixture.actors.productCreator.profileId,
            fixture.actors.supplierEditor.profileId,
          ],
          ["projects.edit", "projects.archive"],
          fixture.actors.admin.profileId,
        ],
      );
      for (const [index, status] of sourceStatuses.entries()) {
        await database.query(
          `insert into public.projects (
             id, name, customer_name, status, start_date, delivery_date,
             completed_at, cancelled_at, created_by_user_id,
             updated_by_user_id
           ) values (
             $1, $2, 'Customer', $3, '2026-09-01', '2026-09-30',
             null, $4, $5, $5
           )`,
          [
            sourceIds[index],
            `Invalid Reopen ${status}`,
            status,
            status === "cancelled" ? "2026-09-20T10:00:00Z" : null,
            fixture.actors.admin.profileId,
          ],
        );
      }
      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           completed_at, cancelled_at, created_by_user_id, updated_by_user_id
         ) values (
           $1, 'Authorization Reopen Target', 'Customer', 'completed',
           '2026-09-01', '2026-09-30', '2026-09-30T10:00:00Z', null,
           $2, $2
         )`,
        [completedId, fixture.actors.admin.profileId],
      );
      const baseline = await database.query<ProjectRow>(
        `select *, start_date::text as start_date,
                delivery_date::text as delivery_date
         from public.projects
         where id = any($1::uuid[])
         order by id`,
        [[...sourceIds, completedId]],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      for (const [index, sourceId] of sourceIds.entries()) {
        await database.query(`savepoint invalid_reopen_source_${index}`);
        await expect(
          database.query("select public.reopen_project($1)", [sourceId]),
        ).rejects.toMatchObject({ code: "PRJ04" });
        await database.query(`rollback to savepoint invalid_reopen_source_${index}`);
      }
      await database.query("reset role");

      const deniedActors = [
        fixture.actors.permitted,
        fixture.actors.productCreator,
        fixture.actors.supplierEditor,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ];
      for (const [index, actor] of deniedActors.entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_reopen_actor_${index}`);
        await expect(
          database.query("select public.reopen_project($1)", [completedId]),
        ).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_reopen_actor_${index}`);
        await database.query("reset role");
      }

      await database.query("set local role anon");
      await database.query("savepoint denied_anonymous_reopen");
      await expect(
        database.query("select public.reopen_project($1)", [completedId]),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint denied_anonymous_reopen");
      await database.query("reset role");

      const rows = await database.query<ProjectRow>(
        `select *, start_date::text as start_date,
                delivery_date::text as delivery_date
         from public.projects
         where id = any($1::uuid[])
         order by id`,
        [[...sourceIds, completedId]],
      );
      expect(rows.rows).toEqual(baseline.rows);
      expect(rows.rows.find((row) => row.id === completedId)).toMatchObject({
        completed_at: new Date("2026-09-30T10:00:00Z"),
        status: "completed",
      });
      for (const [index, status] of sourceStatuses.entries()) {
        expect(rows.rows.find((row) => row.id === sourceIds[index])?.status)
          .toBe(status);
      }
      const audits = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type = 'project.reopened'`,
        [[...sourceIds, completedId]],
      );
      expect(audits.rows).toEqual([{ count: 0 }]);
    });
  });

  it("enforces the Project planning schema, references, quantities, and non-mutating baseline", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const projectId = randomUUID();
      const projectProductIds = [randomUUID(), randomUUID()];
      const productIds = [randomUUID(), randomUUID()];
      const componentIds = [randomUUID(), randomUUID(), randomUUID()];
      const serials = await database.query<{ serial_number: string }>(
        `select public.allocate_product_serial_number() as serial_number
         from pg_catalog.generate_series(1, 2)`,
      );

      await database.query(
        `insert into public.projects (
           id, name, customer_name, start_date, delivery_date,
           created_by_user_id, updated_by_user_id
         ) values (
           $1, 'Planning Schema Project', 'Planning Customer',
           '2026-09-01', '2026-09-30', $2, $2
         )`,
        [projectId, actorId],
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values
           ($1, $3, 'Planning Component', 'Component', 'component', $5, $5),
           ($2, $4, 'Planning PCB', 'PCB', 'pcb_finished_good', $5, $5)`,
        [
          productIds[0],
          productIds[1],
          serials.rows[0]?.serial_number,
          serials.rows[1]?.serial_number,
          actorId,
        ],
      );

      const projectsBefore = await database.query<ProjectRow>(
        `select *, start_date::text as start_date,
                delivery_date::text as delivery_date
         from public.projects
         where id = $1`,
        [projectId],
      );
      const productsBefore = await database.query<ProductRow>(
        `select * from public.products
         where id = any($1::uuid[])
         order by id`,
        [productIds],
      );
      const inventoryBefore = await database.query<{
        balances: number;
        movements: number;
        total_quantity: string;
      }>(
        `select
           (select count(*)::integer
            from public.inventory_balances
            where product_id = any($1::uuid[])) as balances,
           (select count(*)::integer
            from public.inventory_movements
            where product_id = any($1::uuid[])) as movements,
           (select coalesce(sum(quantity), 0::numeric)::text
            from public.inventory_balances
            where product_id = any($1::uuid[])) as total_quantity`,
        [productIds],
      );

      await database.query(
        `insert into public.project_products (
           id, project_id, name, created_by_user_id, updated_by_user_id
         ) values
           ($1, $3, 'B24', $4, $4),
           ($2, $3, 'B24', $4, $4)`,
        [projectProductIds[0], projectProductIds[1], projectId, actorId],
      );
      await database.query(
        `insert into public.project_product_components (
           id, project_product_id, product_id, required_quantity,
           created_by_user_id, updated_by_user_id
         ) values
           ($1, $4, $6, 12, $8, $8),
           ($2, $4, $7, 3, $8, $8),
           ($3, $5, $6, 4, $8, $8)`,
        [
          componentIds[0],
          componentIds[1],
          componentIds[2],
          projectProductIds[0],
          projectProductIds[1],
          productIds[0],
          productIds[1],
          actorId,
        ],
      );

      const projectProducts = await database.query<ProjectProductRow>(
        `select * from public.project_products
         where id = any($1::uuid[])
         order by id`,
        [projectProductIds],
      );
      const components = await database.query<ProjectProductComponentRow>(
        `select * from public.project_product_components
         where id = any($1::uuid[])
         order by id`,
        [componentIds],
      );
      expect(projectProducts.rows).toHaveLength(2);
      expect(projectProducts.rows.every((row) => row.name === "B24")).toBe(true);
      expect(components.rows.map((row) => row.required_quantity).sort())
        .toEqual(["12", "3", "4"]);
      expect(components.rows.some((row) => row.product_id === productIds[0]))
        .toBe(true);
      expect(components.rows.some((row) => row.product_id === productIds[1]))
        .toBe(true);

      expect(await database.query<ProjectRow>(
        `select *, start_date::text as start_date,
                delivery_date::text as delivery_date
         from public.projects
         where id = $1`,
        [projectId],
      )).toEqual(projectsBefore);
      expect(await database.query<ProductRow>(
        `select * from public.products
         where id = any($1::uuid[])
         order by id`,
        [productIds],
      )).toEqual(productsBefore);
      expect(await database.query<{
        balances: number;
        movements: number;
        total_quantity: string;
      }>(
        `select
           (select count(*)::integer
            from public.inventory_balances
            where product_id = any($1::uuid[])) as balances,
           (select count(*)::integer
            from public.inventory_movements
            where product_id = any($1::uuid[])) as movements,
           (select coalesce(sum(quantity), 0::numeric)::text
            from public.inventory_balances
            where product_id = any($1::uuid[])) as total_quantity`,
        [productIds],
      )).toEqual(inventoryBefore);

      const invalidProjectProducts = [
        { label: "empty_name", projectId, name: "", actorId },
        { label: "whitespace_name", projectId, name: "   ", actorId },
        { label: "untrimmed_name", projectId, name: " B25 ", actorId },
        {
          label: "missing_project",
          projectId: randomUUID(),
          name: "Missing Project",
          actorId,
        },
        {
          label: "invalid_created_actor",
          projectId,
          name: "Invalid Created Actor",
          actorId: randomUUID(),
        },
      ];
      for (const invalid of invalidProjectProducts) {
        await database.query(`savepoint project_product_${invalid.label}`);
        await expect(database.query(
          `insert into public.project_products (
             project_id, name, created_by_user_id, updated_by_user_id
           ) values ($1, $2, $3, $4)`,
          [invalid.projectId, invalid.name, invalid.actorId, actorId],
        )).rejects.toMatchObject({
          code: invalid.label.includes("name") ? "23514" : "23503",
        });
        await database.query(`rollback to savepoint project_product_${invalid.label}`);
      }
      await database.query("savepoint project_product_invalid_updated_actor");
      await expect(database.query(
        `insert into public.project_products (
           project_id, name, created_by_user_id, updated_by_user_id
         ) values ($1, 'Invalid Updated Actor', $2, $3)`,
        [projectId, actorId, randomUUID()],
      )).rejects.toMatchObject({ code: "23503" });
      await database.query("rollback to savepoint project_product_invalid_updated_actor");

      for (const [label, quantity] of [["zero", 0], ["negative", -1]] as const) {
        await database.query(`savepoint component_quantity_${label}`);
        await expect(database.query(
          `insert into public.project_product_components (
             project_product_id, product_id, required_quantity,
             created_by_user_id, updated_by_user_id
           ) values ($1, $2, $3, $4, $4)`,
          [projectProductIds[1], productIds[1], quantity, actorId],
        )).rejects.toMatchObject({ code: "23514" });
        await database.query(`rollback to savepoint component_quantity_${label}`);
      }

      const invalidComponents = [
        {
          label: "duplicate_pair",
          projectProductId: projectProductIds[0],
          productId: productIds[0],
          actorId,
          code: "23505",
        },
        {
          label: "missing_project_product",
          projectProductId: randomUUID(),
          productId: productIds[0],
          actorId,
          code: "23503",
        },
        {
          label: "missing_product",
          projectProductId: projectProductIds[1],
          productId: randomUUID(),
          actorId,
          code: "23503",
        },
        {
          label: "invalid_created_actor",
          projectProductId: projectProductIds[1],
          productId: productIds[1],
          actorId: randomUUID(),
          code: "23503",
        },
      ];
      for (const invalid of invalidComponents) {
        await database.query(`savepoint project_component_${invalid.label}`);
        await expect(database.query(
          `insert into public.project_product_components (
             project_product_id, product_id, required_quantity,
             created_by_user_id, updated_by_user_id
           ) values ($1, $2, 1, $3, $4)`,
          [
            invalid.projectProductId,
            invalid.productId,
            invalid.actorId,
            actorId,
          ],
        )).rejects.toMatchObject({ code: invalid.code });
        await database.query(`rollback to savepoint project_component_${invalid.label}`);
      }
      await database.query("savepoint component_invalid_updated_actor");
      await expect(database.query(
        `insert into public.project_product_components (
           project_product_id, product_id, required_quantity,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 1, $3, $4)`,
        [projectProductIds[1], productIds[1], actorId, randomUUID()],
      )).rejects.toMatchObject({ code: "23503" });
      await database.query("rollback to savepoint component_invalid_updated_actor");

      await database.query(
        `update public.products
         set is_active = false,
             updated_at = now(),
             updated_by_user_id = $2,
             archived_at = now(),
             archived_by_user_id = $2
         where id = $1`,
        [productIds[1], actorId],
      );
      const archivedReference = await database.query<{
        is_active: boolean;
        product_id: string;
      }>(
        `select product.id as product_id, product.is_active
         from public.project_product_components as component
         join public.products as product on product.id = component.product_id
         where component.id = $1`,
        [componentIds[1]],
      );
      expect(archivedReference.rows).toEqual([{
        is_active: false,
        product_id: productIds[1],
      }]);

      const foreignKeys = await database.query<{
        constraint_name: string;
        delete_rule: string;
      }>(
        `select constraint_name, delete_rule
         from information_schema.referential_constraints
         where constraint_schema = 'public'
           and constraint_name = any($1::text[])
         order by constraint_name`,
        [[
          "project_products_project_id_fkey",
          "project_products_created_by_user_id_fkey",
          "project_products_updated_by_user_id_fkey",
          "project_product_components_project_product_id_fkey",
          "project_product_components_product_id_fkey",
          "project_product_components_created_by_user_id_fkey",
          "project_product_components_updated_by_user_id_fkey",
        ]],
      );
      expect(foreignKeys.rows).toHaveLength(7);
      expect(foreignKeys.rows.every((foreignKey) =>
        foreignKey.delete_rule === "RESTRICT"
      )).toBe(true);

      const columns = await database.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        table_name: string;
      }>(
        `select table_name, column_name, data_type, is_nullable
         from information_schema.columns
         where table_schema = 'public'
           and table_name = any($1::text[])
         order by table_name, ordinal_position`,
        [["project_products", "project_product_components"]],
      );
      expect(columns.rows.filter((column) => column.table_name === "project_products")
        .map((column) => column.column_name)).toEqual([
          "id",
          "project_id",
          "name",
          "created_at",
          "created_by_user_id",
          "updated_at",
          "updated_by_user_id",
        ]);
      expect(columns.rows.find((column) =>
        column.table_name === "project_product_components"
        && column.column_name === "required_quantity"
      )).toMatchObject({ data_type: "bigint", is_nullable: "NO" });

      const indexes = await database.query<{
        indexdef: string;
        indexname: string;
      }>(
        `select indexname, indexdef
         from pg_catalog.pg_indexes
         where schemaname = 'public'
           and tablename = any($1::text[])
         order by indexname`,
        [["project_products", "project_product_components"]],
      );
      expect(indexes.rows.find((index) =>
        index.indexname === "project_products_project_id_idx"
      )?.indexdef).toContain("(project_id)");
      expect(indexes.rows.find((index) =>
        index.indexname === "project_product_components_product_id_idx"
      )?.indexdef).toContain("(product_id)");
      expect(indexes.rows.find((index) =>
        index.indexname ===
          "project_product_components_project_product_product_key"
      )?.indexdef).toContain(
        "UNIQUE INDEX project_product_components_project_product_product_key",
      );
      expect(indexes.rows.find((index) =>
        index.indexname ===
          "project_product_components_project_product_product_key"
      )?.indexdef).toContain("(project_product_id, product_id)");

      const prematureObjects = await database.query<{
        object_kind: string;
        object_name: string;
      }>(
        `select 'function'::text as object_kind, routine.proname as object_name
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and (
             routine.proname like '%project_commitment%'
           )
         union all
         select 'relation'::text, relation.relname
         from pg_catalog.pg_class as relation
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = relation.relnamespace
         where namespace.nspname = 'public'
           and relation.relname like '%project_commitment%'`,
      );
      expect(prematureObjects.rows).toEqual([]);
    });
  });

  it("limits Project planning reads to active Project viewers and denies every direct client write", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const projectIds = [randomUUID(), randomUUID(), randomUUID()];
      const projectProductIds = [randomUUID(), randomUUID(), randomUUID()];
      const componentIds = [randomUUID(), randomUUID(), randomUUID()];
      const productId = randomUUID();
      const serial = await database.query<{ serial_number: string }>(
        "select public.allocate_product_serial_number() as serial_number",
      );

      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           completed_at, cancelled_at, created_by_user_id, updated_by_user_id
         ) values
           ($1, 'Planning Read Planned', 'Customer', 'planned',
            '2026-09-01', '2026-09-30', null, null, $4, $4),
           ($2, 'Planning Read Completed', 'Customer', 'completed',
            '2026-09-01', '2026-09-30', '2026-09-30T10:00:00Z', null, $4, $4),
           ($3, 'Planning Read Cancelled', 'Customer', 'cancelled',
            '2026-09-01', '2026-09-30', null, '2026-09-20T10:00:00Z', $4, $4)`,
        [...projectIds, actorId],
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'Planning Read Product', 'Component', 'component', $3, $3)`,
        [productId, serial.rows[0]?.serial_number, actorId],
      );
      await database.query(
        `insert into public.project_products (
           id, project_id, name, created_by_user_id, updated_by_user_id
         ) values
           ($1, $4, 'Planned Group', $7, $7),
           ($2, $5, 'Completed Group', $7, $7),
           ($3, $6, 'Cancelled Group', $7, $7)`,
        [...projectProductIds, ...projectIds, actorId],
      );
      await database.query(
        `insert into public.project_product_components (
           id, project_product_id, product_id, required_quantity,
           created_by_user_id, updated_by_user_id
         ) values
           ($1, $4, $7, 1, $8, $8),
           ($2, $5, $7, 2, $8, $8),
           ($3, $6, $7, 3, $8, $8)`,
        [...componentIds, ...projectProductIds, productId, actorId],
      );

      for (const actor of [fixture.actors.admin, fixture.actors.permitted]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visibleProjectProducts = await database.query<{ id: string }>(
          `select id from public.project_products
           where id = any($1::uuid[])
           order by id`,
          [projectProductIds],
        );
        const visibleComponents = await database.query<{ id: string }>(
          `select id from public.project_product_components
           where id = any($1::uuid[])
           order by id`,
          [componentIds],
        );
        await database.query("reset role");
        expect(visibleProjectProducts.rows.map((row) => row.id))
          .toEqual([...projectProductIds].sort());
        expect(visibleComponents.rows.map((row) => row.id))
          .toEqual([...componentIds].sort());
      }

      for (const actor of [fixture.actors.unpermitted, fixture.actors.inactive]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hiddenProjectProducts = await database.query<{ id: string }>(
          `select id from public.project_products
           where id = any($1::uuid[])`,
          [projectProductIds],
        );
        const hiddenComponents = await database.query<{ id: string }>(
          `select id from public.project_product_components
           where id = any($1::uuid[])`,
          [componentIds],
        );
        await database.query("reset role");
        expect(hiddenProjectProducts.rows).toEqual([]);
        expect(hiddenComponents.rows).toEqual([]);
      }

      const security = await database.query<{
        authenticated_delete: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        policy_expression: string;
        row_security: boolean;
        table_name: string;
      }>(
        `select
           relation.relname as table_name,
           relation.relrowsecurity as row_security,
           pg_catalog.has_table_privilege(
             'authenticated', relation.oid, 'select'
           ) as authenticated_select,
           pg_catalog.has_table_privilege(
             'authenticated', relation.oid, 'insert'
           ) as authenticated_insert,
           pg_catalog.has_table_privilege(
             'authenticated', relation.oid, 'update'
           ) as authenticated_update,
           pg_catalog.has_table_privilege(
             'authenticated', relation.oid, 'delete'
           ) as authenticated_delete,
           pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
             as policy_expression
         from pg_catalog.pg_class as relation
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = relation.relnamespace
         join pg_catalog.pg_policy as policy
           on policy.polrelid = relation.oid
         where namespace.nspname = 'public'
           and relation.relname = any($1::text[])
         order by relation.relname`,
        [["project_products", "project_product_components"]],
      );
      expect(security.rows).toHaveLength(2);
      for (const tableSecurity of security.rows) {
        expect(tableSecurity).toMatchObject({
          authenticated_delete: false,
          authenticated_insert: false,
          authenticated_select: true,
          authenticated_update: false,
          row_security: true,
        });
        expect(tableSecurity.policy_expression).toContain(
          "current_user_is_admin()",
        );
        expect(tableSecurity.policy_expression).toContain(
          "has_permission('projects.view'::text)",
        );
      }

      await database.query("set local role anon");
      await database.query("savepoint anonymous_project_planning_reads");
      await expect(database.query("select id from public.project_products limit 1"))
        .rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_project_planning_reads");
      await database.query("savepoint anonymous_project_component_reads");
      await expect(database.query(
        "select id from public.project_product_components limit 1",
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_project_component_reads");
      await database.query("reset role");
    });

    const adminClient = fixture.actors.admin.client;
    const projectProductInsert = await adminClient.from("project_products").insert({
      project_id: randomUUID(),
      name: "Forbidden Direct Planning Group",
      created_by_user_id: fixture.actors.admin.profileId,
      updated_by_user_id: fixture.actors.admin.profileId,
    });
    const projectProductUpdate = await adminClient
      .from("project_products")
      .update({ name: "Forbidden Direct Update" })
      .eq("id", randomUUID());
    const projectProductDelete = await adminClient
      .from("project_products")
      .delete()
      .eq("id", randomUUID());
    const componentInsert = await adminClient
      .from("project_product_components")
      .insert({
        project_product_id: randomUUID(),
        product_id: randomUUID(),
        required_quantity: 1,
        created_by_user_id: fixture.actors.admin.profileId,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
    const componentUpdate = await adminClient
      .from("project_product_components")
      .update({ required_quantity: 2 })
      .eq("id", randomUUID());
    const componentDelete = await adminClient
      .from("project_product_components")
      .delete()
      .eq("id", randomUUID());
    for (const error of [
      projectProductInsert.error,
      projectProductUpdate.error,
      projectProductDelete.error,
      componentInsert.error,
      componentUpdate.error,
      componentDelete.error,
    ]) {
      expectPermissionDenied(error);
    }

    for (const table of ["project_products", "project_product_components"] as const) {
      const anonymousRead = await fixture.anonymousClient
        .from(table)
        .select("id")
        .limit(1);
      expectPermissionDenied(anonymousRead.error);
    }
  });

  it("mutates open Project plans atomically with trusted actors, audit, and no physical stock changes", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { projectIds, groupIds, productIds } = await createPlanningRows(
        database, fixture.actors.admin.profileId,
      );
      const delegated = fixture.actors.productCreator;
      await database.query(
        "insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id) select $1, id, $2 from public.permission_definitions where key = 'projects.edit'",
        [delegated.profileId, fixture.actors.admin.profileId],
      );
      expect(await callPlanningAs<{ can_edit: boolean; can_view: boolean }>(
        database, delegated,
        "select public.has_permission('projects.edit') as can_edit, public.has_permission('projects.view') as can_view",
      )).toEqual([{ can_edit: true, can_view: false }]);

      const inventoryBefore = await database.query<{
        product_id: string; quantity: string;
      }>(
        "select product_id, quantity from public.inventory_balances where product_id = any($1::uuid[]) order by product_id",
        [productIds],
      );
      const productsBefore = await database.query<ProductRow>(
        "select * from public.products where id = any($1::uuid[]) order by id",
        [productIds],
      );
      const projectsBefore = await database.query<ProjectRow>(
        "select *, start_date::text as start_date, delivery_date::text as delivery_date from public.projects where id = any($1::uuid[]) order by id",
        [projectIds],
      );

      const created = await callPlanningAs<{ id: string }>(
        database, delegated,
        "select public.create_project_product($1, $2) as id",
        [projectIds[0], "  B24  "],
      );
      const duplicateName = await callPlanningAs<{ id: string }>(
        database, fixture.actors.admin,
        "select public.create_project_product($1, $2) as id",
        [projectIds[0], "B24"],
      );
      expect(created[0]?.id).toEqual(expect.any(String));
      expect(duplicateName[0]?.id).not.toBe(created[0]?.id);
      const createdId = created[0]?.id;
      const createdRow = await database.query<ProjectProductRow>(
        "select * from public.project_products where id = $1", [createdId],
      );
      expect(createdRow.rows[0]).toMatchObject({
        name: "B24",
        project_id: projectIds[0],
        created_by_user_id: delegated.profileId,
        updated_by_user_id: delegated.profileId,
      });

      const updated = await callPlanningAs<{ id: string }>(
        database, delegated, "select public.update_project_product($1, $2) as id",
        [createdId, "  B25  "],
      );
      expect(updated).toEqual([{ id: createdId }]);
      const editedRow = await database.query<ProjectProductRow>(
        "select * from public.project_products where id = $1", [createdId],
      );
      expect(editedRow.rows[0]?.name).toBe("B25");
      await callPlanningAs(
        database, delegated, "select public.update_project_product($1, $2)",
        [createdId, " B25 "],
      );
      const afterNoop = await database.query<ProjectProductRow>(
        "select * from public.project_products where id = $1", [createdId],
      );
      expect(afterNoop.rows).toEqual(editedRow.rows);

      const component = await callPlanningAs<{ id: string }>(
        database, delegated,
        "select public.create_project_product_component($1, $2, $3) as id",
        [createdId, productIds[0], 12],
      );
      const pcb = await callPlanningAs<{ id: string }>(
        database, fixture.actors.admin,
        "select public.create_project_product_component($1, $2, $3) as id",
        [createdId, productIds[1], 3],
      );
      const anotherGroup = await callPlanningAs<{ id: string }>(
        database, delegated,
        "select public.create_project_product_component($1, $2, $3) as id",
        [groupIds[0], productIds[0], 5],
      );
      expect([component[0]?.id, pcb[0]?.id, anotherGroup[0]?.id]
        .every(Boolean)).toBe(true);

      await expect(callPlanningAs(
        database, fixture.actors.admin,
        "select public.remove_project_product($1)", [createdId],
      )).rejects.toMatchObject({ code: "PPL03" });
      await callPlanningAs(
        database, delegated,
        "select public.update_project_product_component($1, $2, $3)",
        [component[0]?.id, productIds[0], 15],
      );
      const editedComponent = await database.query<ProjectProductComponentRow>(
        "select * from public.project_product_components where id = $1",
        [component[0]?.id],
      );
      expect(editedComponent.rows[0]).toMatchObject({
        product_id: productIds[0],
        required_quantity: "15",
        updated_by_user_id: delegated.profileId,
      });
      await callPlanningAs(
        database, delegated,
        "select public.update_project_product_component($1, $2, $3)",
        [component[0]?.id, productIds[0], 15],
      );
      const afterComponentNoop = await database.query<ProjectProductComponentRow>(
        "select * from public.project_product_components where id = $1",
        [component[0]?.id],
      );
      expect(afterComponentNoop.rows).toEqual(editedComponent.rows);
      await callPlanningAs(
        database, delegated,
        "select public.update_project_product_component($1, $2, $3)",
        [component[0]?.id, productIds[1], 15],
      ).then(
        () => { throw new Error("Duplicate Product reference should have failed"); },
        (error: unknown) => { expect(error).toMatchObject({ code: "PPL02" }); },
      );

      await callPlanningAs(
        database, delegated,
        "select public.remove_project_product_component($1)", [pcb[0]?.id],
      );
      await callPlanningAs(
        database, delegated,
        "select public.update_project_product_component($1, $2, $3)",
        [component[0]?.id, productIds[1], 17],
      );
      expect((await database.query<ProjectProductComponentRow>(
        "select * from public.project_product_components where id = $1",
        [component[0]?.id],
      )).rows[0]).toMatchObject({
        project_product_id: createdId,
        product_id: productIds[1],
        required_quantity: "17",
      });
      await callPlanningAs(
        database, fixture.actors.admin,
        "select public.remove_project_product_component($1)", [component[0]?.id],
      );
      await callPlanningAs(
        database, delegated,
        "select public.remove_project_product($1)", [createdId],
      );
      expect((await database.query(
        "select id from public.project_products where id = $1", [createdId],
      )).rows).toEqual([]);

      const audit = await database.query<{
        action_type: string; actor_user_id: string; before_data: Record<string, unknown> | null;
        after_data: Record<string, unknown> | null; entity_id: string;
      }>(
        "select action_type, actor_user_id, entity_id, before_data, after_data from public.audit_logs where entity_id = any($1::uuid[]) order by created_at, id",
        [[createdId, duplicateName[0]?.id, component[0]?.id, pcb[0]?.id, anotherGroup[0]?.id]],
      );
      const eventCounts = new Map<string, number>();
      for (const entry of audit.rows) {
        eventCounts.set(entry.action_type, (eventCounts.get(entry.action_type) ?? 0) + 1);
        expect(entry.actor_user_id).toBe(
          entry.entity_id === pcb[0]?.id
            && entry.action_type === "project_product_component.created"
          || entry.entity_id === component[0]?.id
            && entry.action_type === "project_product_component.removed"
          || entry.entity_id === duplicateName[0]?.id
            ? fixture.actors.admin.profileId : delegated.profileId,
        );
      }
      expect(Object.fromEntries(eventCounts)).toEqual({
        "project_product.created": 2,
        "project_product.updated": 1,
        "project_product_component.created": 3,
        "project_product_component.updated": 2,
        "project_product_component.removed": 2,
        "project_product.removed": 1,
      });
      expect(audit.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          entity_id: component[0]?.id,
          action_type: "project_product_component.updated",
          before_data: expect.objectContaining({ required_quantity: 12 }),
          after_data: expect.objectContaining({ required_quantity: 15 }),
        }),
      ]));
      // Exercise the same six authorized operations as Admin, independently
      // of the delegated projects.edit actor used above.
      const adminGroup = await callPlanningAs<{ id: string }>(
        database, fixture.actors.admin,
        "select public.create_project_product($1, 'Admin Group') as id",
        [projectIds[1]],
      );
      await callPlanningAs(
        database, fixture.actors.admin,
        "select public.update_project_product($1, 'Admin Edited Group')",
        [adminGroup[0]?.id],
      );
      const adminComponent = await callPlanningAs<{ id: string }>(
        database, fixture.actors.admin,
        "select public.create_project_product_component($1, $2, 2) as id",
        [adminGroup[0]?.id, productIds[0]],
      );
      await callPlanningAs(
        database, fixture.actors.admin,
        "select public.update_project_product_component($1, $2, 4)",
        [adminComponent[0]?.id, productIds[0]],
      );
      await callPlanningAs(
        database, fixture.actors.admin,
        "select public.remove_project_product_component($1)",
        [adminComponent[0]?.id],
      );
      await callPlanningAs(
        database, fixture.actors.admin,
        "select public.remove_project_product($1)",
        [adminGroup[0]?.id],
      );
      expect(await database.query<ProductRow>(
        "select * from public.products where id = any($1::uuid[]) order by id",
        [productIds],
      )).toEqual(productsBefore);
      expect(await database.query<ProjectRow>(
        "select *, start_date::text as start_date, delivery_date::text as delivery_date from public.projects where id = any($1::uuid[]) order by id",
        [projectIds],
      )).toEqual(projectsBefore);
      expect(await database.query(
        "select product_id, quantity from public.inventory_balances where product_id = any($1::uuid[]) order by product_id",
        [productIds],
      )).toEqual(inventoryBefore);
      expect((await database.query<{ count: number }>(
        "select count(*)::integer as count from public.inventory_movements where product_id = any($1::uuid[])",
        [productIds],
      )).rows).toEqual([{ count: 0 }]);
    });
  });

  it("denies unauthorized, closed, invalid, or duplicate Project planning mutations without audit", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { projectIds, groupIds, productIds } = await createPlanningRows(
        database, fixture.actors.admin.profileId,
      );
      const componentId = randomUUID();
      await database.query(
        "insert into public.project_product_components (id, project_product_id, product_id, required_quantity, created_by_user_id, updated_by_user_id) values ($1, $2, $3, 8, $4, $4)",
        [componentId, groupIds[0], productIds[0], fixture.actors.admin.profileId],
      );
      const archiveOnly = fixture.actors.productCreator;
      const createOnly = fixture.actors.productEditor;
      const editor = fixture.actors.supplierEditor;
      await database.query(
        "insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id) select grants.actor_id, definition.id, $3 from unnest($1::uuid[], $2::text[]) as grants(actor_id, permission_key) join public.permission_definitions as definition on definition.key = grants.permission_key",
        [
          [archiveOnly.profileId, createOnly.profileId, editor.profileId],
          ["projects.archive", "projects.create", "projects.edit"],
          fixture.actors.admin.profileId,
        ],
      );
      const cases: Array<{ sql: string; args: unknown[] }> = [
        { sql: "select public.create_project_product($1, 'Denied')", args: [projectIds[0]] },
        { sql: "select public.update_project_product($1, 'Denied')", args: [groupIds[0]] },
        { sql: "select public.remove_project_product($1)", args: [groupIds[1]] },
        { sql: "select public.create_project_product_component($1, $2, 1)", args: [groupIds[0], productIds[1]] },
        { sql: "select public.update_project_product_component($1, $2, 2)", args: [componentId, productIds[0]] },
        { sql: "select public.remove_project_product_component($1)", args: [componentId] },
      ];
      for (const actor of [
        fixture.actors.permitted,
        archiveOnly,
        createOnly,
        fixture.actors.brandManager,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
        null,
      ]) {
        for (const testCase of cases) {
          await expect(callPlanningAs(
            database, actor, testCase.sql, testCase.args,
          )).rejects.toMatchObject({ code: "42501" });
        }
      }
      for (const index of [3, 4]) {
        const closedComponentId = randomUUID();
        await database.query(
          "insert into public.project_product_components (id, project_product_id, product_id, required_quantity, created_by_user_id, updated_by_user_id) values ($1, $2, $3, 1, $4, $4)",
          [closedComponentId, groupIds[index], productIds[0], fixture.actors.admin.profileId],
        );
        for (const actor of [fixture.actors.admin, editor]) {
          const closedCases: Array<{ sql: string; args: unknown[] }> = [
            { sql: "select public.create_project_product($1, 'Closed')", args: [projectIds[index]] },
            { sql: "select public.update_project_product($1, 'Closed')", args: [groupIds[index]] },
            { sql: "select public.remove_project_product($1)", args: [groupIds[index]] },
            { sql: "select public.create_project_product_component($1, $2, 1)", args: [groupIds[index], productIds[0]] },
          ];
          closedCases.push(
            { sql: "select public.update_project_product_component($1, $2, 2)", args: [closedComponentId, productIds[0]] },
            { sql: "select public.remove_project_product_component($1)", args: [closedComponentId] },
          );
          for (const testCase of closedCases) {
            await expect(callPlanningAs(
              database, actor, testCase.sql, testCase.args,
            )).rejects.toMatchObject({ code: "PPL01" });
          }
        }
      }

      const admin = fixture.actors.admin;
      for (const index of [0, 1, 2]) {
        const result = await callPlanningAs<{ id: string }>(
          database, index === 0 ? editor : admin,
          "select public.create_project_product($1, 'Open') as id",
          [projectIds[index]],
        );
        expect(result[0]?.id).toEqual(expect.any(String));
      }
      const invalid: Array<{ sql: string; args: unknown[]; code: string }> = [
        { sql: "select public.create_project_product($1, '   ')", args: [projectIds[0]], code: "22023" },
        { sql: "select public.update_project_product($1, '')", args: [groupIds[0]], code: "22023" },
        { sql: "select public.create_project_product(null::uuid, 'X')", args: [], code: "22023" },
        { sql: "select public.create_project_product($1, 'X')", args: [randomUUID()], code: "P0002" },
        { sql: "select public.create_project_product_component($1, $2, 0)", args: [groupIds[0], productIds[1]], code: "22023" },
        { sql: "select public.create_project_product_component($1, $2, -1)", args: [groupIds[0], productIds[1]], code: "22023" },
        { sql: "select public.create_project_product_component($1, $2, 1)", args: [groupIds[0], productIds[2]], code: "PPL04" },
        { sql: "select public.create_project_product_component($1, $2, 1)", args: [groupIds[0], randomUUID()], code: "PPL04" },
        { sql: "select public.create_project_product_component($1, $2, 1)", args: [groupIds[0], productIds[0]], code: "PPL02" },
        { sql: "select public.update_project_product_component($1, $2, 0)", args: [componentId, productIds[0]], code: "22023" },
        { sql: "select public.update_project_product_component($1, $2, -1)", args: [componentId, productIds[0]], code: "22023" },
        { sql: "select public.update_project_product_component($1, $2, 2)", args: [componentId, productIds[2]], code: "PPL04" },
      ];
      for (const testCase of invalid) {
        await expect(callPlanningAs(
          database, admin, testCase.sql, testCase.args,
        )).rejects.toMatchObject({ code: testCase.code });
      }
      // Archiving after the original requirement does not invalidate unchanged
      // historical Product references during a meaningful quantity edit.
      await database.query(
        "update public.products set is_active = false, archived_at = now(), archived_by_user_id = $2, updated_at = now(), updated_by_user_id = $2 where id = $1",
        [productIds[0], admin.profileId],
      );
      await callPlanningAs(
        database, editor,
        "select public.update_project_product_component($1, $2, 9)",
        [componentId, productIds[0]],
      );
      await expect(callPlanningAs(
        database, admin,
        "select public.create_project_product_component($1, $2, 1)",
        [groupIds[1], productIds[0]],
      )).rejects.toMatchObject({ code: "PPL04" });

      expect((await database.query<ProjectProductComponentRow>(
        "select * from public.project_product_components where id = $1", [componentId],
      )).rows[0]).toMatchObject({
        product_id: productIds[0], required_quantity: "9",
        updated_by_user_id: editor.profileId,
      });
      const events = await database.query<{ action_type: string; count: number }>(
        "select action_type, count(*)::integer as count from public.audit_logs where entity_type in ('project_product', 'project_product_component') group by action_type order by action_type",
      );
      expect(events.rows).toEqual([
        { action_type: "project_product_component.updated", count: 1 },
        { action_type: "project_product.created", count: 3 },
      ]);
      expect((await database.query<{ count: number }>(
        "select count(*)::integer as count from public.inventory_movements where product_id = any($1::uuid[])",
        [productIds],
      )).rows).toEqual([{ count: 0 }]);
    });
  });

  it("offers only active narrow Product choices to Project editors without Inventory read access", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { productIds } = await createPlanningRows(
        database, fixture.actors.admin.profileId,
      );
      const editor = fixture.actors.productCreator;
      await database.query(
        "insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id) select $1, id, $2 from public.permission_definitions where key = 'projects.edit'",
        [editor.profileId, fixture.actors.admin.profileId],
      );
      expect(await callPlanningAs<{ can_view: boolean; can_inventory: boolean }>(
        database, editor,
        "select public.has_permission('projects.view') as can_view, public.has_permission('inventory.view') as can_inventory",
      )).toEqual([{ can_view: false, can_inventory: false }]);
      const rows = await callPlanningAs<{
        product_id: string; serial_number: string;
        name: string; product_kind: string;
      }>(
        database, editor, "select * from public.search_project_component_product_choices()",
      );
      expect(rows.filter((row) => productIds.includes(row.product_id))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            product_id: productIds[0], product_kind: "component",
          }),
          expect.objectContaining({
            product_id: productIds[1], product_kind: "pcb_finished_good",
          }),
        ]),
      );
      expect(rows.some((row) => row.product_id === productIds[2])).toBe(false);
      expect(rows.every((row) => Object.keys(row).sort().join(",") ===
        "name,product_id,product_kind,serial_number")).toBe(true);
      const serial = rows.find((row) => row.product_id === productIds[1])?.serial_number;
      expect((await callPlanningAs<{ product_id: string }>(
        database, editor,
        "select * from public.search_project_component_product_choices($1)",
        [serial?.slice(0, 5)],
      )).some((row) => row.product_id === productIds[1])).toBe(true);
      for (const literal of ["%", "_", "\\"]) {
        const matched = await callPlanningAs<{ product_id: string }>(
          database, editor,
          "select * from public.search_project_component_product_choices($1)",
          [literal],
        );
        expect(matched.filter((row) => productIds.includes(row.product_id))
          .map((row) => row.product_id)).toEqual([productIds[0]]);
      }
      expect((await callPlanningAs<{ product_id: string }>(
        database, fixture.actors.admin,
        "select * from public.search_project_component_product_choices('choice 1')",
      )).some((row) => row.product_id === productIds[1])).toBe(true);
      for (const actor of [
        fixture.actors.permitted, fixture.actors.inactive, null,
      ]) {
        await expect(callPlanningAs(
          database, actor,
          "select * from public.search_project_component_product_choices()",
        )).rejects.toMatchObject({ code: "42501" });
      }

      const security = await database.query<{
        anonymous_execute: boolean; authenticated_execute: boolean;
        is_definer: boolean; settings: string[]; name: string;
      }>(
        "select routine.proname as name, routine.prosecdef as is_definer, routine.proconfig as settings, pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute, pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute from pg_catalog.pg_proc as routine join pg_catalog.pg_namespace as ns on ns.oid = routine.pronamespace where ns.nspname = 'public' and routine.proname = any($1::text[]) order by routine.proname",
        [[
          "current_project_planning_mutation_actor_id",
          "lock_open_project_for_planning",
          "create_project_product",
          "update_project_product",
          "remove_project_product",
          "create_project_product_component",
          "update_project_product_component",
          "remove_project_product_component",
          "search_project_component_product_choices",
        ]],
      );
      expect(security.rows).toHaveLength(9);
      for (const row of security.rows) {
        expect(row).toMatchObject({
          anonymous_execute: false,
          is_definer: true,
          settings: ["search_path=\"\""],
        });
        expect(row.authenticated_execute).toBe(
          !["current_project_planning_mutation_actor_id",
            "lock_open_project_for_planning"].includes(row.name),
        );
      }
      for (const table of ["project_products", "project_product_components"]) {
        const direct = await database.query<{
          can_insert: boolean; can_update: boolean; can_delete: boolean;
        }>(
          "select pg_catalog.has_table_privilege('authenticated', $1::text, 'insert') as can_insert, pg_catalog.has_table_privilege('authenticated', $1::text, 'update') as can_update, pg_catalog.has_table_privilege('authenticated', $1::text, 'delete') as can_delete",
          ["public." + table],
        );
        expect(direct.rows).toEqual([{
          can_insert: false, can_update: false, can_delete: false,
        }]);
      }
    });
  });

  it("reads only narrow historical Product identity through the Project planning boundary", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { projectIds, groupIds, productIds } = await createPlanningRows(
        database, fixture.actors.admin.profileId,
      );
      const requirementIds = [randomUUID(), randomUUID(), randomUUID()];
      for (const [index, requirementId] of requirementIds.entries()) {
        await database.query(
          "insert into public.project_product_components (id, project_product_id, product_id, required_quantity, created_by_user_id, updated_by_user_id) values ($1, $2, $3, $4, $5, $5)",
          [
            requirementId,
            groupIds[index + 2],
            productIds[index],
            index + 1,
            fixture.actors.admin.profileId,
          ],
        );
      }
      for (const actor of [fixture.actors.admin, fixture.actors.permitted]) {
        const open = await callPlanningAs<{
          project_product_id: string; project_product_name: string;
          component_id: string | null; product_id: string | null;
          serial_number: string | null; product_name: string | null;
          product_kind: string | null; required_quantity: string | null;
        }>(
          database, actor, "select * from public.get_project_planning($1)",
          [projectIds[0]],
        );
        expect(open).toEqual([{
          project_product_id: groupIds[0],
          project_product_name: "Group 0",
          component_id: null,
          product_id: null,
          serial_number: null,
          product_name: null,
          product_kind: null,
          required_quantity: null,
        }]);
        for (const index of [3, 4]) {
          const historical = await callPlanningAs<{
            product_id: string; required_quantity: string;
          }>(
            database, actor, "select * from public.get_project_planning($1)",
            [projectIds[index]],
          );
          expect(historical).toHaveLength(1);
          expect(historical[0]).toMatchObject({
            product_id: productIds[index - 2],
            required_quantity: String(index - 1),
          });
          expect(Object.keys(historical[0] ?? {}).sort()).toEqual([
            "component_id", "product_id", "product_kind", "product_name",
            "project_product_id", "project_product_name", "required_quantity",
            "serial_number",
          ]);
        }
      }
      const directProduct = await callPlanningAs<{ id: string }>(
        database, fixture.actors.permitted,
        "select id from public.products where id = $1", [productIds[2]],
      );
      expect(directProduct).toEqual([]);
      for (const actor of [
        fixture.actors.unpermitted, fixture.actors.inactive, null,
      ]) {
        await expect(callPlanningAs(
          database, actor, "select * from public.get_project_planning($1)",
          [projectIds[4]],
        )).rejects.toMatchObject({ code: "42501" });
      }
      const security = await database.query<{
        anon_execute: boolean; authenticated_execute: boolean;
        is_definer: boolean; settings: string[];
      }>(
        "select routine.prosecdef as is_definer, routine.proconfig as settings, pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anon_execute, pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute from pg_catalog.pg_proc as routine join pg_catalog.pg_namespace as ns on ns.oid = routine.pronamespace where ns.nspname = 'public' and routine.proname = 'get_project_planning'",
      );
      expect(security.rows).toEqual([{
        anon_execute: false,
        authenticated_execute: true,
        is_definer: true,
        settings: ["search_path=\"\""],
      }]);
      const productRls = await database.query<{ policy: string }>(
        "select pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) as policy from pg_catalog.pg_policy as pol where pol.polrelid = 'public.products'::regclass order by pol.polname",
      );
      expect(productRls.rows.every((row) => !row.policy.includes("projects.view"))).toBe(true);
    });
  });

  it("rolls back Project planning creation when its immutable audit append fails", async () => {
    const fixture = requireHarness();
    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const { projectIds, groupIds, productIds } = await createPlanningRows(
        database, fixture.actors.admin.profileId,
      );
      await database.query(
        "create function public.test_reject_project_planning_audit() returns trigger language plpgsql set search_path = '' as $test_function$ begin if new.action_type in ('project_product.created', 'project_product_component.created') then raise exception 'Test audit rejection' using errcode = 'TST01'; end if; return new; end; $test_function$",
      );
      await database.query(
        "create trigger test_reject_project_planning_audit before insert on public.audit_logs for each row execute function public.test_reject_project_planning_audit()",
      );
      await expect(callPlanningAs(
        database, fixture.actors.admin,
        "select public.create_project_product($1, 'Audit Rejected')",
        [projectIds[0]],
      )).rejects.toMatchObject({ code: "TST01" });
      await expect(callPlanningAs(
        database, fixture.actors.admin,
        "select public.create_project_product_component($1, $2, 8)",
        [groupIds[0], productIds[0]],
      )).rejects.toMatchObject({ code: "TST01" });
      expect((await database.query<{ count: number }>(
        "select count(*)::integer as count from public.project_products where project_id = $1 and name = 'Audit Rejected'",
        [projectIds[0]],
      )).rows).toEqual([{ count: 0 }]);
      expect((await database.query<{ count: number }>(
        "select count(*)::integer as count from public.project_product_components where project_product_id = $1",
        [groupIds[0]],
      )).rows).toEqual([{ count: 0 }]);
      expect((await database.query<{ count: number }>(
        "select count(*)::integer as count from public.audit_logs where action_type like 'project_product%'",
      )).rows).toEqual([{ count: 0 }]);
      expect((await database.query<{ count: number }>(
        "select count(*)::integer as count from public.inventory_movements where product_id = any($1::uuid[])",
        [productIds],
      )).rows).toEqual([{ count: 0 }]);
    });
  });

  it("serializes competing duplicate requirements and leaves one audited row", async () => {
    const fixture = requireHarness();
    const projectId = randomUUID();
    const groupId = randomUUID();
    const productId = randomUUID();
    const applicationName = "alfaev-planning-wait-" + randomUUID();
    await fixture.withDatabaseClients(3, async (clients) => {
      const first = clients[0];
      const second = clients[1];
      const observer = clients[2];
      if (!first || !second || !observer) {
        throw new Error("Project planning concurrency clients unavailable");
      }
      await observer.query("begin");
      await observer.query(
        "insert into public.projects (id, name, customer_name, start_date, delivery_date, created_by_user_id, updated_by_user_id) values ($1, 'Concurrency Project', 'Customer', '2026-09-01', '2026-09-30', $2, $2)",
        [projectId, fixture.actors.admin.profileId],
      );
      await observer.query(
        "insert into public.project_products (id, project_id, name, created_by_user_id, updated_by_user_id) values ($1, $2, 'Concurrent Group', $3, $3)",
        [groupId, projectId, fixture.actors.admin.profileId],
      );
      await observer.query(
        "insert into public.products (id, serial_number, name, category, product_kind, created_by_user_id, updated_by_user_id) values ($1, $2, 'Concurrent Component', 'Planning', 'component', $3, $3)",
        [productId, createTestSerialNumber(), fixture.actors.admin.profileId],
      );
      await observer.query("commit");
      try {
        await first.query("begin");
        await first.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await first.query("set local role authenticated");
        const firstResult = await first.query<{ id: string }>(
          "select public.create_project_product_component($1, $2, 2) as id",
          [groupId, productId],
        );
        expect(firstResult.rows[0]?.id).toEqual(expect.any(String));

        await second.query("begin");
        await second.query(
          "select pg_catalog.set_config('application_name', $1::text, true)",
          [applicationName],
        );
        await second.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await second.query("set local role authenticated");
        const competing = second.query(
          "select public.create_project_product_component($1, $2, 3)",
          [groupId, productId],
        ).then(
          () => null,
          (error: unknown) => error,
        );

        let lockObserved = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = await observer.query<ActivityWaitRow>(
            "select wait_event_type, wait_event from pg_catalog.pg_stat_activity where application_name = $1",
            [applicationName],
          );
          if (activity.rows[0]?.wait_event_type === "Lock") {
            lockObserved = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(lockObserved).toBe(true);
        await first.query("commit");
        expect(await competing).toMatchObject({ code: "PPL02" });
        await second.query("rollback");
        const result = await observer.query<{
          audit_count: number; movement_count: number;
          quantity: string; relation_count: number;
        }>(
          "select (select count(*)::integer from public.project_product_components where project_product_id = $1 and product_id = $2) as relation_count, (select count(*)::integer from public.audit_logs where action_type = 'project_product_component.created' and entity_id in (select id from public.project_product_components where project_product_id = $1 and product_id = $2)) as audit_count, (select count(*)::integer from public.inventory_movements where product_id = $2) as movement_count, (select quantity::text from public.inventory_balances where product_id = $2) as quantity",
          [groupId, productId],
        );
        expect(result.rows).toEqual([{
          audit_count: 1, movement_count: 0, quantity: "0", relation_count: 1,
        }]);
      } finally {
        await first.query("rollback");
        await second.query("rollback");
        await observer.query("begin");
        await observer.query("set local session_replication_role = replica");
        await observer.query(
          "delete from public.audit_logs where action_type = 'project_product_component.created' and entity_id in (select id from public.project_product_components where project_product_id = $1)",
          [groupId],
        );
        await observer.query(
          "delete from public.project_product_components where project_product_id = $1",
          [groupId],
        );
        await observer.query("delete from public.project_products where id = $1", [groupId]);
        await observer.query("delete from public.inventory_balances where product_id = $1", [productId]);
        await observer.query("delete from public.products where id = $1", [productId]);
        await observer.query("delete from public.projects where id = $1", [projectId]);
        await observer.query("commit");
      }
    });
  });

  it("enforces the canonical ProcurementRequest schema, lifecycle, snapshot, and historical foreign keys", async () => {
    const fixture = requireHarness();
    const actorId = fixture.actors.admin.profileId;
    const supplierId = randomUUID();
    const productId = randomUUID();
    const requestIds = Array.from({ length: 7 }, () => randomUUID());

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const serial = await database.query<{ serial_number: string }>(
        `select public.allocate_product_serial_number() as serial_number`,
      );
      await database.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'BiH', $3, $3)`,
        [supplierId, `Procurement Supplier ${supplierId}`, actorId],
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'Procurement Product', 'Component', 'component', $3, $3)`,
        [productId, serial.rows[0]?.serial_number, actorId],
      );
      const inventoryBefore = await database.query<{
        balances: number;
        movements: number;
      }>(
        `select
           (select count(*)::integer from public.inventory_balances)
             as balances,
           (select count(*)::integer from public.inventory_movements)
             as movements`,
      );

      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'Default Active Snapshot', $3, 5, $4, $4)`,
        [requestIds[0], productId, supplierId, actorId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           created_by_user_id, updated_by_user_id
         ) values ($1, null, 'Brand New Snapshot', $2, 3, $3, $3)`,
        [requestIds[1], supplierId, actorId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_by_user_id, updated_by_user_id
         ) values
           ($1, $3, 'Partial Snapshot', $4, 5, 2, 'partly_delivered', $5, $5),
           ($2, $3, 'Fully Delivered Unresolved Snapshot', $4, 5, 5,
            'partly_delivered', $5, $5)`,
        [requestIds[2], requestIds[3], productId, supplierId, actorId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_by_user_id, updated_by_user_id,
           resolved_at, resolved_by_user_id
         ) values
           ($1, $4, 'Resolved Zero Snapshot', $5, 5, 0, 'resolved', $6, $6,
            '2026-09-15T08:00:00Z', $6),
           ($2, $4, 'Resolved Partial Snapshot', $5, 5, 2, 'resolved', $6, $6,
            '2026-09-15T08:01:00Z', $6),
           ($3, $4, 'Resolved Full Snapshot', $5, 5, 5, 'resolved', $6, $6,
            '2026-09-15T08:02:00Z', $6)`,
        [requestIds[4], requestIds[5], requestIds[6], productId, supplierId, actorId],
      );

      const rows = await database.query<ProcurementRequestRow>(
        `select * from public.procurement_requests
         where id = any($1::uuid[]) order by id`,
        [requestIds],
      );
      expect(rows.rows).toHaveLength(7);
      expect(rows.rows.find((row) => row.id === requestIds[0])).toMatchObject({
        delivered_quantity: "0",
        product_id: productId,
        requested_name: "Default Active Snapshot",
        requested_quantity: "5",
        resolved_at: null,
        resolved_by_user_id: null,
        status: "active",
        supplier_id: supplierId,
      });
      expect(rows.rows.find((row) => row.id === requestIds[1])?.product_id)
        .toBeNull();
      expect(rows.rows.find((row) => row.id === requestIds[3])).toMatchObject({
        delivered_quantity: "5",
        requested_quantity: "5",
        status: "partly_delivered",
      });
      expect(rows.rows.filter((row) => row.status === "resolved")
        .map((row) => row.delivered_quantity).sort()).toEqual(["0", "2", "5"]);

      const invalidChecks: ReadonlyArray<{
        createdBy?: string;
        delivered: number;
        expectedCode: string;
        label: string;
        name: string;
        product?: string | null;
        requested: number;
        resolvedAt?: string | null;
        resolvedBy?: string | null;
        status: string;
        supplier?: string;
        updatedBy?: string;
      }> = [
        { label: "empty_name", name: "", requested: 1, delivered: 0, status: "active", expectedCode: "23514" },
        { label: "blank_name", name: "   ", requested: 1, delivered: 0, status: "active", expectedCode: "23514" },
        { label: "untrimmed_name", name: " Snapshot ", requested: 1, delivered: 0, status: "active", expectedCode: "23514" },
        { label: "zero_requested", name: "Snapshot", requested: 0, delivered: 0, status: "active", expectedCode: "23514" },
        { label: "negative_requested", name: "Snapshot", requested: -1, delivered: 0, status: "active", expectedCode: "23514" },
        { label: "negative_delivered", name: "Snapshot", requested: 1, delivered: -1, status: "partly_delivered", expectedCode: "23514" },
        { label: "excess_delivered", name: "Snapshot", requested: 1, delivered: 2, status: "partly_delivered", expectedCode: "23514" },
        { label: "invalid_status", name: "Snapshot", requested: 1, delivered: 0, status: "pending", expectedCode: "23514" },
        { label: "active_delivered", name: "Snapshot", requested: 2, delivered: 1, status: "active", expectedCode: "23514" },
        { label: "partial_zero", name: "Snapshot", requested: 2, delivered: 0, status: "partly_delivered", expectedCode: "23514" },
        { label: "resolved_without_at", name: "Snapshot", requested: 2, delivered: 0, status: "resolved", resolvedBy: actorId, expectedCode: "23514" },
        { label: "resolved_without_actor", name: "Snapshot", requested: 2, delivered: 0, status: "resolved", resolvedAt: "2026-09-15T08:00:00Z", expectedCode: "23514" },
        { label: "active_with_at", name: "Snapshot", requested: 2, delivered: 0, status: "active", resolvedAt: "2026-09-15T08:00:00Z", expectedCode: "23514" },
        { label: "active_with_actor", name: "Snapshot", requested: 2, delivered: 0, status: "active", resolvedBy: actorId, expectedCode: "23514" },
        { label: "partial_with_at", name: "Snapshot", requested: 2, delivered: 1, status: "partly_delivered", resolvedAt: "2026-09-15T08:00:00Z", expectedCode: "23514" },
        { label: "partial_with_actor", name: "Snapshot", requested: 2, delivered: 1, status: "partly_delivered", resolvedBy: actorId, expectedCode: "23514" },
        { label: "missing_supplier", name: "Snapshot", requested: 1, delivered: 0, status: "active", supplier: randomUUID(), expectedCode: "23503" },
        { label: "missing_product", name: "Snapshot", requested: 1, delivered: 0, status: "active", product: randomUUID(), expectedCode: "23503" },
        { label: "missing_creator", name: "Snapshot", requested: 1, delivered: 0, status: "active", createdBy: randomUUID(), expectedCode: "23503" },
        { label: "missing_updater", name: "Snapshot", requested: 1, delivered: 0, status: "active", updatedBy: randomUUID(), expectedCode: "23503" },
        { label: "missing_resolver", name: "Snapshot", requested: 1, delivered: 0, status: "resolved", resolvedAt: "2026-09-15T08:00:00Z", resolvedBy: randomUUID(), expectedCode: "23503" },
      ];

      for (const invalid of invalidChecks) {
        await database.query(`savepoint procurement_${invalid.label}`);
        await expect(database.query(
          `insert into public.procurement_requests (
             product_id, requested_name, supplier_id, requested_quantity,
             delivered_quantity, status, created_by_user_id,
             updated_by_user_id, resolved_at, resolved_by_user_id
           ) values (
             $1::uuid, $2::text, $3::uuid, $4::bigint, $5::bigint, $6::text,
             $7::uuid, $8::uuid, $9::timestamptz, $10::uuid
           )`,
          [
            invalid.product === undefined ? productId : invalid.product,
            invalid.name,
            invalid.supplier ?? supplierId,
            invalid.requested,
            invalid.delivered,
            invalid.status,
            invalid.createdBy ?? actorId,
            invalid.updatedBy ?? actorId,
            invalid.resolvedAt ?? null,
            invalid.resolvedBy ?? null,
          ],
        )).rejects.toMatchObject({ code: invalid.expectedCode });
        await database.query(`rollback to savepoint procurement_${invalid.label}`);
      }

      await database.query("savepoint immutable_procurement_snapshot");
      await expect(database.query(
        `update public.procurement_requests
         set requested_name = 'Changed Snapshot'
         where id = $1`,
        [requestIds[0]],
      )).rejects.toMatchObject({ code: "PRQ01" });
      await database.query("rollback to savepoint immutable_procurement_snapshot");

      await database.query(
        `update public.procurement_requests
         set product_id = $1, updated_at = pg_catalog.clock_timestamp(),
             updated_by_user_id = $2
         where id = $3`,
        [productId, actorId, requestIds[1]],
      );
      expect((await database.query<{ product_id: string }>(
        `select product_id from public.procurement_requests where id = $1`,
        [requestIds[1]],
      )).rows).toEqual([{ product_id: productId }]);

      await database.query("savepoint immutable_resolved_procurement");
      await expect(database.query(
        `update public.procurement_requests
         set status = 'active', resolved_at = null,
             resolved_by_user_id = null
         where id = $1`,
        [requestIds[4]],
      )).rejects.toMatchObject({ code: "PRQ02" });
      await database.query("rollback to savepoint immutable_resolved_procurement");

      await database.query(
        `update public.products
         set is_active = false,
             archived_at = pg_catalog.clock_timestamp(),
             archived_by_user_id = $1,
             updated_at = pg_catalog.clock_timestamp(),
             updated_by_user_id = $1
         where id = $2`,
        [actorId, productId],
      );
      await database.query(
        `update public.suppliers
         set is_active = false,
             archived_at = pg_catalog.clock_timestamp(),
             archived_by_user_id = $1,
             updated_at = pg_catalog.clock_timestamp(),
             updated_by_user_id = $1
         where id = $2`,
        [actorId, supplierId],
      );
      const historical = await database.query<{
        product_id: string;
        supplier_id: string;
      }>(
        `select product_id, supplier_id
         from public.procurement_requests where id = $1`,
        [requestIds[0]],
      );
      expect(historical.rows).toEqual([{
        product_id: productId,
        supplier_id: supplierId,
      }]);

      const inventoryAfter = await database.query<{
        balances: number;
        movements: number;
      }>(
        `select
           (select count(*)::integer from public.inventory_balances)
             as balances,
           (select count(*)::integer from public.inventory_movements)
             as movements`,
      );
      expect(inventoryAfter.rows).toEqual(inventoryBefore.rows);

      const columns = await database.query<{
        column_default: string | null;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'procurement_requests'
         order by ordinal_position`,
      );
      expect(columns.rows.map((column) => column.column_name)).toEqual([
        "id",
        "product_id",
        "requested_name",
        "supplier_id",
        "requested_quantity",
        "delivered_quantity",
        "status",
        "created_at",
        "created_by_user_id",
        "updated_at",
        "updated_by_user_id",
        "resolved_at",
        "resolved_by_user_id",
      ]);
      expect(columns.rows.find((column) =>
        column.column_name === "requested_quantity"
      )).toMatchObject({ data_type: "bigint", is_nullable: "NO" });
      expect(columns.rows.find((column) =>
        column.column_name === "delivered_quantity"
      )).toMatchObject({
        column_default: "0",
        data_type: "bigint",
        is_nullable: "NO",
      });
      expect(columns.rows.find((column) => column.column_name === "status"))
        .toMatchObject({ column_default: "'active'::text", is_nullable: "NO" });

      const foreignKeys = await database.query<{
        delete_action: string;
        name: string;
      }>(
        `select constraint_row.conname as name,
                constraint_row.confdeltype::text as delete_action
         from pg_catalog.pg_constraint as constraint_row
         where constraint_row.conrelid =
               'public.procurement_requests'::pg_catalog.regclass
           and constraint_row.contype = 'f'
         order by constraint_row.conname`,
      );
      expect(foreignKeys.rows).toEqual([
        { delete_action: "r", name: "procurement_requests_created_by_user_id_fkey" },
        { delete_action: "r", name: "procurement_requests_product_id_fkey" },
        { delete_action: "r", name: "procurement_requests_resolved_by_user_id_fkey" },
        { delete_action: "r", name: "procurement_requests_supplier_id_fkey" },
        { delete_action: "r", name: "procurement_requests_updated_by_user_id_fkey" },
      ]);

      const indexes = await database.query<{ indexname: string }>(
        `select indexname from pg_catalog.pg_indexes
         where schemaname = 'public'
           and tablename = 'procurement_requests'
         order by indexname`,
      );
      expect(indexes.rows.map((index) => index.indexname)).toEqual([
        "procurement_requests_pkey",
        "procurement_requests_product_id_idx",
        "procurement_requests_requested_name_search_trgm_idx",
        "procurement_requests_status_idx",
        "procurement_requests_supplier_id_idx",
      ]);
    });
  });

  it("limits ProcurementRequest reads to active viewers and denies all direct client writes", async () => {
    const fixture = requireHarness();
    const supplierId = randomUUID();
    const requestIds = [randomUUID(), randomUUID()];
    const viewer = fixture.actors.productCreator;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'BiH', $3, $3)`,
        [
          supplierId,
          `Procurement Read Supplier ${supplierId}`,
          fixture.actors.admin.profileId,
        ],
      );
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select $1, definition.id, $2
         from public.permission_definitions as definition
         where definition.key = 'procurement.view'`,
        [viewer.profileId, fixture.actors.admin.profileId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_by_user_id,
           updated_by_user_id, resolved_at, resolved_by_user_id
         ) values
           ($1, 'Readable Active Request', $3, 5, 0, 'active', $4, $4,
            null, null),
           ($2, 'Readable Resolved Request', $3, 5, 2, 'resolved', $4, $4,
            '2026-09-15T08:00:00Z', $4)`,
        [requestIds[0], requestIds[1], supplierId, fixture.actors.admin.profileId],
      );

      for (const actor of [fixture.actors.admin, viewer]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ id: string; status: string }>(
          `select id, status from public.procurement_requests
           where id = any($1::uuid[]) order by status`,
          [requestIds],
        );
        await database.query("reset role");
        expect(visible.rows).toEqual([
          { id: requestIds[0], status: "active" },
          { id: requestIds[1], status: "resolved" },
        ]);
      }

      for (const actor of [
        fixture.actors.permitted,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ id: string }>(
          `select id from public.procurement_requests
           where id = any($1::uuid[])`,
          [requestIds],
        );
        await database.query("reset role");
        expect(hidden.rows).toEqual([]);
      }

      const security = await database.query<{
        authenticated_delete: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        policy_expression: string;
        row_security: boolean;
      }>(
        `select
           class.relrowsecurity as row_security,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'select'
           ) as authenticated_select,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'insert'
           ) as authenticated_insert,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'update'
           ) as authenticated_update,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'delete'
           ) as authenticated_delete,
           pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
             as policy_expression
         from pg_catalog.pg_class as class
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = class.relnamespace
         join pg_catalog.pg_policy as policy
           on policy.polrelid = class.oid
          and policy.polname = 'procurement_requests_select_authorized'
         where namespace.nspname = 'public'
           and class.relname = 'procurement_requests'`,
      );
      expect(security.rows).toHaveLength(1);
      expect(security.rows[0]).toMatchObject({
        authenticated_delete: false,
        authenticated_insert: false,
        authenticated_select: true,
        authenticated_update: false,
        row_security: true,
      });
      expect(security.rows[0]?.policy_expression).toContain(
        "current_user_is_admin()",
      );
      expect(security.rows[0]?.policy_expression).toContain(
        "has_permission('procurement.view'::text)",
      );

      const prematureFunctions = await database.query<{ name: string }>(
        `select routine.proname as name
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = any($1::text[])
         order by routine.proname`,
        [[
          "create_existing_product_procurement_request",
          "create_new_component_procurement_request",
          "update_procurement_delivery",
        ]],
      );
      expect(prematureFunctions.rows).toEqual([]);
    });

    const directInsert = await fixture.actors.admin.client
      .from("procurement_requests")
      .insert({
        requested_name: "Forbidden Direct Request",
        supplier_id: supplierId,
        requested_quantity: 1,
        created_by_user_id: fixture.actors.admin.profileId,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
    const directUpdate = await fixture.actors.admin.client
      .from("procurement_requests")
      .update({ requested_quantity: 2 })
      .eq("id", requestIds[0]);
    const directDelete = await fixture.actors.admin.client
      .from("procurement_requests")
      .delete()
      .eq("id", requestIds[0]);
    expectPermissionDenied(directInsert.error);
    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);

    const anonymousRead = await fixture.anonymousClient
      .from("procurement_requests")
      .select("id")
      .limit(1);
    expectPermissionDenied(anonymousRead.error);
  });

  it("counts unresolved ProcurementRequest rows only for authorized active viewers", async () => {
    const fixture = requireHarness();
    const supplierId = randomUUID();
    const requestIds = Array.from({ length: 4 }, () => randomUUID());
    const viewer = fixture.actors.productCreator;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query("delete from public.procurement_requests");
      await database.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'BiH', $3, $3)`,
        [
          supplierId,
          `Procurement Badge Supplier ${supplierId}`,
          fixture.actors.admin.profileId,
        ],
      );
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select $1, definition.id, $2
         from public.permission_definitions as definition
         where definition.key = 'procurement.view'`,
        [viewer.profileId, fixture.actors.admin.profileId],
      );
      const inventoryBefore = await database.query<{
        balances: number;
        movements: number;
      }>(
        `select
           (select count(*)::integer from public.inventory_balances)
             as balances,
           (select count(*)::integer from public.inventory_movements)
             as movements`,
      );

      async function readCount(authUserId: string): Promise<string> {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<{ badge_count: string }>(
          `select public.get_procurement_sidebar_badge_count()
             as badge_count`,
        );
        await database.query("reset role");
        const count = result.rows[0]?.badge_count;

        if (count === undefined) {
          throw new Error("Procurement badge RPC returned no count");
        }

        return count;
      }

      expect(await readCount(fixture.actors.admin.authUserId)).toBe("0");

      await database.query(
        `insert into public.procurement_requests (
           id, requested_name, supplier_id, requested_quantity,
           created_by_user_id, updated_by_user_id
         ) values ($1, 'One Thousand Pieces', $2, 1000, $3, $3)`,
        [requestIds[0], supplierId, fixture.actors.admin.profileId],
      );
      expect(await readCount(fixture.actors.admin.authUserId)).toBe("1");

      await database.query(
        `insert into public.procurement_requests (
           id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_by_user_id, updated_by_user_id
         ) values (
           $1, 'Partly Delivered Pieces', $2, 1000, 999,
           'partly_delivered', $3, $3
         )`,
        [requestIds[1], supplierId, fixture.actors.admin.profileId],
      );
      expect(await readCount(fixture.actors.admin.authUserId)).toBe("2");

      await database.query(
        `insert into public.procurement_requests (
           id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_by_user_id, updated_by_user_id,
           resolved_at, resolved_by_user_id
         ) values (
           $1, 'Resolved Pieces', $2, 5000, 5000, 'resolved', $3, $3,
           pg_catalog.clock_timestamp(), $3
         )`,
        [requestIds[2], supplierId, fixture.actors.admin.profileId],
      );
      expect(await readCount(fixture.actors.admin.authUserId)).toBe("2");

      await database.query(
        `insert into public.procurement_requests (
           id, requested_name, supplier_id, requested_quantity,
           created_by_user_id, updated_by_user_id
         ) values ($1, 'Another Active Row', $2, 1, $3, $3)`,
        [requestIds[3], supplierId, fixture.actors.admin.profileId],
      );
      expect(await readCount(fixture.actors.admin.authUserId)).toBe("3");
      expect(await readCount(viewer.authUserId)).toBe("3");

      const requestsBefore = await database.query<ProcurementRequestRow>(
        `select * from public.procurement_requests order by id`,
      );
      for (const [index, actor] of [
        fixture.actors.permitted,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ].entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_procurement_badge_${index}`);
        await expect(database.query(
          "select public.get_procurement_sidebar_badge_count()",
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_procurement_badge_${index}`);
        await database.query("reset role");
      }

      await database.query("set local role anon");
      await database.query("savepoint anonymous_procurement_badge");
      await expect(database.query(
        "select public.get_procurement_sidebar_badge_count()",
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_procurement_badge");
      await database.query("reset role");

      const requestsAfter = await database.query<ProcurementRequestRow>(
        `select * from public.procurement_requests order by id`,
      );
      const inventoryAfter = await database.query<{
        balances: number;
        movements: number;
      }>(
        `select
           (select count(*)::integer from public.inventory_balances)
             as balances,
           (select count(*)::integer from public.inventory_movements)
             as movements`,
      );
      expect(requestsAfter.rows).toEqual(requestsBefore.rows);
      expect(inventoryAfter.rows).toEqual(inventoryBefore.rows);

      const security = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        definition: string;
        identity_arguments: string;
        security_definer: boolean;
        settings: string[];
        volatility: string;
      }>(
        `select
           routine.prosecdef as security_definer,
           routine.proconfig as settings,
           routine.provolatile::text as volatility,
           pg_catalog.pg_get_function_identity_arguments(routine.oid)
             as identity_arguments,
           pg_catalog.pg_get_functiondef(routine.oid) as definition,
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
           and routine.proname = 'get_procurement_sidebar_badge_count'`,
      );
      expect(security.rows).toHaveLength(1);
      expect(security.rows[0]).toMatchObject({
        anonymous_execute: false,
        authenticated_execute: true,
        identity_arguments: "",
        security_definer: true,
        settings: ["search_path=\"\""],
        volatility: "s",
      });
      expect(security.rows[0]?.definition).toContain("count(*)");
      expect(security.rows[0]?.definition).toContain("'active'");
      expect(security.rows[0]?.definition).toContain(
        "'partly_delivered'",
      );
      expect(security.rows[0]?.definition).not.toContain("requested_quantity");
      expect(security.rows[0]?.definition).not.toContain("delivered_quantity");
    });

    expectPermissionDenied((await fixture.actors.unpermitted.client.rpc(
      "get_procurement_sidebar_badge_count",
    )).error);
    expectPermissionDenied((await fixture.actors.inactive.client.rpc(
      "get_procurement_sidebar_badge_count",
    )).error);
    expectPermissionDenied((await fixture.anonymousClient.rpc(
      "get_procurement_sidebar_badge_count",
    )).error);
  });

  it("serves the Procurement list and Supplier filters through narrow authorized projections", async () => {
    const fixture = requireHarness();
    const viewer = fixture.actors.productCreator;
    const actorId = fixture.actors.admin.profileId;
    const supplierIds = [randomUUID(), randomUUID()];
    const productIds = [randomUUID(), randomUUID()];
    const requestIds = Array.from({ length: 5 }, () => randomUUID());

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query("delete from public.procurement_requests");
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select $1, definition.id, $2
         from public.permission_definitions as definition
         where definition.key = 'procurement.view'`,
        [viewer.profileId, actorId],
      );
      await database.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values
           ($1, $2, 'BiH', $5, $5),
           ($3, $4, 'BiH', $5, $5)`,
        [
          supplierIds[0],
          `Archived Procurement Supplier ${supplierIds[0]}`,
          supplierIds[1],
          `Active Procurement Supplier ${supplierIds[1]}`,
          actorId,
        ],
      );
      const serials = await database.query<{ serial_number: string }>(
        `select public.allocate_product_serial_number() as serial_number
         from pg_catalog.generate_series(1, 2)`,
      );
      const archivedSerial = serials.rows[0]?.serial_number;
      const activeSerial = serials.rows[1]?.serial_number;
      if (!archivedSerial || !activeSerial) {
        throw new Error("Product serial fixture allocation failed");
      }
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values
           ($1, $2, 'Archived Product', 'Component', 'component', $5, $5),
           ($3, $4, 'Active Product', 'Component', 'component', $5, $5)`,
        [productIds[0], archivedSerial, productIds[1], activeSerial, actorId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_at, created_by_user_id,
           updated_by_user_id, resolved_at, resolved_by_user_id
         ) values
           ($1, $6, $11, $8, 1000, 0, 'active',
            '2026-09-15T10:05:00Z', $10, $10, null, null),
           ($2, null, 'Unlinked Snapshot', $9, 2, 0, 'active',
            '2026-09-15T10:00:00Z', $10, $10, null, null),
           ($3, $7, 'Partly Delivered Snapshot', $9, 10, 4,
            'partly_delivered', '2026-09-15T10:04:00Z', $10, $10,
            null, null),
           ($4, $6, 'Resolved Historical Snapshot', $8, 20, 7, 'resolved',
            '2026-09-15T10:06:00Z', $10, $10,
            '2026-09-15T10:07:00Z', $10),
           ($5, $7, 'Resolved Active Endpoint Snapshot', $9, 5, 5,
            'resolved', '2026-09-15T09:59:00Z', $10, $10,
            '2026-09-15T10:08:00Z', $10)`,
        [
          ...requestIds,
          ...productIds,
          ...supplierIds,
          actorId,
          "Literal 100%_\\ Request",
        ],
      );
      await database.query(
        `update public.products
         set is_active = false,
             archived_at = pg_catalog.clock_timestamp(),
             archived_by_user_id = $1,
             updated_at = pg_catalog.clock_timestamp(),
             updated_by_user_id = $1
         where id = $2`,
        [actorId, productIds[0]],
      );
      await database.query(
        `update public.suppliers
         set is_active = false,
             archived_at = pg_catalog.clock_timestamp(),
             archived_by_user_id = $1,
             updated_at = pg_catalog.clock_timestamp(),
             updated_by_user_id = $1
         where id = $2`,
        [actorId, supplierIds[0]],
      );

      const sideEffectsBefore = await database.query<{
        audits: string;
        balances: string;
        movements: string;
        requests: string;
      }>(
        `select
           (select count(*)::text from public.audit_logs) as audits,
           (select count(*)::text from public.inventory_balances) as balances,
           (select count(*)::text from public.inventory_movements) as movements,
           (select count(*)::text from public.procurement_requests) as requests`,
      );

      async function readList(
        authUserId: string,
        search: string | null = null,
        status: string | null = null,
        supplierId: string | null = null,
      ) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<Record<string, unknown>>(
          `select * from public.search_procurement_requests($1, $2, $3)`,
          [search, status, supplierId],
        );
        await database.query("reset role");
        return result.rows;
      }

      const approvedFields = [
        "request_id",
        "product_id",
        "product_serial_number",
        "requested_name",
        "supplier_id",
        "supplier_name",
        "requested_quantity",
        "delivered_quantity",
        "status",
        "created_at",
        "created_by_user_id",
        "created_by_full_name",
      ];
      const adminRows = await readList(fixture.actors.admin.authUserId);
      const viewerRows = await readList(viewer.authUserId);
      expect(viewerRows).toEqual(adminRows);
      expect(viewerRows.map((row) => row.request_id)).toEqual([
        requestIds[0],
        requestIds[1],
        requestIds[2],
        requestIds[3],
        requestIds[4],
      ]);
      expect(viewerRows.every((row) =>
        JSON.stringify(Object.keys(row).sort()) ===
          JSON.stringify([...approvedFields].sort())
      )).toBe(true);
      expect(viewerRows[0]).toMatchObject({
        created_by_full_name: "Security fixture admin",
        product_serial_number: archivedSerial,
        supplier_name: `Archived Procurement Supplier ${supplierIds[0]}`,
      });
      expect(viewerRows[1]).toMatchObject({
        product_id: null,
        product_serial_number: null,
      });

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [viewer.authUserId],
      );
      await database.query("set local role authenticated");
      const unrelatedAccess = await database.query<{
        inventory_view: boolean;
        suppliers_view: boolean;
      }>(
        `select
           public.has_permission('inventory.view') as inventory_view,
           public.has_permission('suppliers.view') as suppliers_view`,
      );
      await database.query("reset role");
      expect(unrelatedAccess.rows).toEqual([{
        inventory_view: false,
        suppliers_view: false,
      }]);

      expect((await readList(viewer.authUserId, "snapshot"))).toHaveLength(4);
      expect((await readList(viewer.authUserId, archivedSerial))
        .map((row) => row.request_id)).toEqual([requestIds[0], requestIds[3]]);
      expect((await readList(viewer.authUserId, "%"))
        .map((row) => row.request_id)).toEqual([requestIds[0]]);
      expect((await readList(viewer.authUserId, "_"))
        .map((row) => row.request_id)).toEqual([requestIds[0]]);
      expect((await readList(viewer.authUserId, "\\"))
        .map((row) => row.request_id)).toEqual([requestIds[0]]);
      expect((await readList(viewer.authUserId, "LITERAL 100"))
        .map((row) => row.request_id)).toEqual([requestIds[0]]);
      expect((await readList(viewer.authUserId, null, "partly_delivered"))
        .map((row) => row.request_id)).toEqual([requestIds[2]]);
      expect((await readList(viewer.authUserId, null, "resolved"))
        .map((row) => row.request_id)).toEqual([requestIds[3], requestIds[4]]);
      expect((await readList(viewer.authUserId, null, null, supplierIds[0]))
        .map((row) => row.request_id)).toEqual([requestIds[0], requestIds[3]]);
      expect(await readList(viewer.authUserId, "   ")).toEqual(viewerRows);

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [viewer.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint invalid_procurement_list_status");
      await expect(database.query(
        "select * from public.search_procurement_requests(null, 'unknown', null)",
      )).rejects.toMatchObject({ code: "22023" });
      await database.query("rollback to savepoint invalid_procurement_list_status");
      await database.query("reset role");

      for (const [index, actor] of [
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ].entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_procurement_list_${index}`);
        await expect(database.query(
          "select * from public.search_procurement_requests(null, null, null)",
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_procurement_list_${index}`);
        await database.query("reset role");
      }
      await database.query("set local role anon");
      await database.query("savepoint anonymous_procurement_list");
      await expect(database.query(
        "select * from public.search_procurement_requests(null, null, null)",
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_procurement_list");
      await database.query("reset role");

      async function readSupplierOptions(authUserId: string) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<Record<string, unknown>>(
          "select * from public.list_procurement_supplier_options()",
        );
        await database.query("reset role");
        return result.rows;
      }

      const supplierOptions = await readSupplierOptions(viewer.authUserId);
      expect(supplierOptions).toHaveLength(2);
      expect(new Set(supplierOptions.map((row) => row.supplier_id))).toEqual(
        new Set(supplierIds),
      );
      expect(supplierOptions.every((row) =>
        Object.keys(row).sort().join(",") === "supplier_id,supplier_name"
      )).toBe(true);
      expect(supplierOptions).toContainEqual({
        supplier_id: supplierIds[0],
        supplier_name: `Archived Procurement Supplier ${supplierIds[0]}`,
      });

      for (const [index, actor] of [
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ].entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_procurement_options_${index}`);
        await expect(database.query(
          "select * from public.list_procurement_supplier_options()",
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_procurement_options_${index}`);
        await database.query("reset role");
      }
      await database.query("set local role anon");
      await database.query("savepoint anonymous_procurement_options");
      await expect(database.query(
        "select * from public.list_procurement_supplier_options()",
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_procurement_options");
      await database.query("reset role");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [viewer.authUserId],
      );
      await database.query("set local role authenticated");
      const badge = await database.query<{ count: string }>(
        "select public.get_procurement_sidebar_badge_count()::text as count",
      );
      await database.query("reset role");
      expect(badge.rows).toEqual([{ count: "3" }]);

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        identity_arguments: string;
        name: string;
        security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.proname as name,
           routine.prosecdef as security_definer,
           routine.proconfig as settings,
           pg_catalog.pg_get_function_identity_arguments(routine.oid)
             as identity_arguments,
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
           and routine.proname = any($1::text[])
         order by routine.proname`,
        [[
          "list_procurement_supplier_options",
          "search_procurement_requests",
        ]],
      );
      expect(functionSecurity.rows).toEqual([
        {
          anonymous_execute: false,
          authenticated_execute: true,
          identity_arguments: "",
          name: "list_procurement_supplier_options",
          security_definer: true,
          settings: ["search_path=\"\""],
        },
        {
          anonymous_execute: false,
          authenticated_execute: true,
          identity_arguments:
            "p_search text, p_status text, p_supplier_id uuid",
          name: "search_procurement_requests",
          security_definer: true,
          settings: ["search_path=\"\""],
        },
      ]);

      const sideEffectsAfter = await database.query<{
        audits: string;
        balances: string;
        movements: string;
        requests: string;
      }>(
        `select
           (select count(*)::text from public.audit_logs) as audits,
           (select count(*)::text from public.inventory_balances) as balances,
           (select count(*)::text from public.inventory_movements) as movements,
           (select count(*)::text from public.procurement_requests) as requests`,
      );
      expect(sideEffectsAfter.rows).toEqual(sideEffectsBefore.rows);
    });

    expectPermissionDenied((await fixture.actors.unpermitted.client.rpc(
      "search_procurement_requests",
      { p_search: null, p_status: null, p_supplier_id: null },
    )).error);
    expectPermissionDenied((await fixture.actors.inactive.client.rpc(
      "list_procurement_supplier_options",
    )).error);
    expectPermissionDenied((await fixture.anonymousClient.rpc(
      "search_procurement_requests",
      { p_search: null, p_status: null, p_supplier_id: null },
    )).error);
  });

  it("creates existing-Product Procurement requests through independent trusted creation authority", async () => {
    const fixture = requireHarness();
    const admin = fixture.actors.admin;
    const creator = fixture.actors.productCreator;
    const viewerOnly = fixture.actors.permitted;
    const editOnly = fixture.actors.supplierEditor;
    const statusOnly = fixture.actors.supplierArchiver;
    const resolveOnly = fixture.actors.supplierCreator;
    const productIds = [randomUUID(), randomUUID(), randomUUID()];
    const supplierIds = [randomUUID(), randomUUID()];

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select actor.profile_id, definition.id, $6::uuid
         from (
           values
             ($1::uuid, 'procurement.create'::text),
             ($2::uuid, 'procurement.view'::text),
             ($3::uuid, 'procurement.edit'::text),
             ($4::uuid, 'procurement.change_status'::text),
             ($5::uuid, 'procurement.resolve'::text)
         ) as actor(profile_id, permission_key)
         join public.permission_definitions as definition
           on definition.key = actor.permission_key`,
        [
          creator.profileId,
          viewerOnly.profileId,
          editOnly.profileId,
          statusOnly.profileId,
          resolveOnly.profileId,
          admin.profileId,
        ],
      );
      await database.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values
           ($1, 'Active Request Supplier', 'BiH', $3, $3),
           ($2, 'Archived Request Supplier', 'BiH', $3, $3)`,
        [supplierIds[0], supplierIds[1], admin.profileId],
      );
      const serials = await database.query<{ serial_number: string }>(
        `select public.allocate_product_serial_number() as serial_number
         from pg_catalog.generate_series(1, 3)`,
      );
      if (serials.rows.length !== 3) {
        throw new Error("Procurement Product serial fixtures are unavailable");
      }
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values
           ($1, $4, 'Authoritative Product Name', 'Component', 'component', $7, $7),
           ($2, $5, $8, 'Component', 'component', $7, $7),
           ($3, $6, 'Archived Request Product', 'Component', 'component', $7, $7)`,
        [
          ...productIds,
          ...serials.rows.map((row) => row.serial_number),
          admin.profileId,
          "Choice 100%_\\ Product",
        ],
      );
      await database.query(
        `update public.products
         set is_active = false,
             archived_at = pg_catalog.clock_timestamp(),
             archived_by_user_id = $1,
             updated_at = pg_catalog.clock_timestamp(),
             updated_by_user_id = $1
         where id = $2`,
        [admin.profileId, productIds[2]],
      );
      await database.query(
        `update public.suppliers
         set is_active = false,
             archived_at = pg_catalog.clock_timestamp(),
             archived_by_user_id = $1,
             updated_at = pg_catalog.clock_timestamp(),
             updated_by_user_id = $1
         where id = $2`,
        [admin.profileId, supplierIds[1]],
      );

      const inventoryBefore = await database.query<{
        balances: string;
        movements: string;
        quantities: string;
      }>(
        `select
           (select count(*)::text from public.inventory_balances) as balances,
           (select count(*)::text from public.inventory_movements) as movements,
           (
             select pg_catalog.string_agg(
               balance.product_id::text || ':' || balance.quantity::text,
               ',' order by balance.product_id
             )
             from public.inventory_balances as balance
           ) as quantities`,
      );
      const endpointsBefore = await database.query<Record<string, unknown>>(
        `select 'product' as kind, product.id, product.name,
                product.is_active, product.updated_at
         from public.products as product
         where product.id = any($1::uuid[])
         union all
         select 'supplier' as kind, supplier.id, supplier.name,
                supplier.is_active, supplier.updated_at
         from public.suppliers as supplier
         where supplier.id = any($2::uuid[])
         order by kind, id`,
        [productIds, supplierIds],
      );

      async function createAs(
        authUserId: string,
        productId: string,
        supplierId: string,
        quantity: number,
      ): Promise<string> {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<{ request_id: string }>(
          `select public.create_procurement_request_for_product(
             $1, $2, $3
           ) as request_id`,
          [productId, supplierId, quantity],
        );
        await database.query("reset role");
        const requestId = result.rows[0]?.request_id;
        if (!requestId) throw new Error("Procurement creation returned no ID");
        return requestId;
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [creator.authUserId],
      );
      await database.query("set local role authenticated");
      const independentAuthority = await database.query<{
        can_create: boolean;
        can_view: boolean;
      }>(
        `select
           public.has_permission('procurement.create') as can_create,
           public.has_permission('procurement.view') as can_view`,
      );
      await database.query("reset role");
      expect(independentAuthority.rows).toEqual([{
        can_create: true,
        can_view: false,
      }]);

      const adminRequestId = await createAs(
        admin.authUserId,
        productIds[0]!,
        supplierIds[0]!,
        6,
      );
      const creatorRequestId = await createAs(
        creator.authUserId,
        productIds[0]!,
        supplierIds[0]!,
        9,
      );
      const createdRequests = await database.query<ProcurementRequestRow>(
        `select * from public.procurement_requests
         where id = any($1::uuid[])
         order by id`,
        [[adminRequestId, creatorRequestId]],
      );
      expect(createdRequests.rows).toHaveLength(2);
      expect(createdRequests.rows.find((row) => row.id === adminRequestId))
        .toMatchObject({
          created_by_user_id: admin.profileId,
          delivered_quantity: "0",
          product_id: productIds[0],
          requested_name: "Authoritative Product Name",
          requested_quantity: "6",
          resolved_at: null,
          resolved_by_user_id: null,
          status: "active",
          supplier_id: supplierIds[0],
          updated_by_user_id: admin.profileId,
        });
      expect(createdRequests.rows.find((row) => row.id === creatorRequestId))
        .toMatchObject({
          created_by_user_id: creator.profileId,
          requested_name: "Authoritative Product Name",
          requested_quantity: "9",
          updated_by_user_id: creator.profileId,
        });
      for (const row of createdRequests.rows) {
        expect(row.created_at).toEqual(row.updated_at);
      }
      const audits = await database.query<CreatedAuditRow>(
        `select action_type, actor_user_id, after_data, entity_id,
                entity_type, metadata
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type = 'procurement.created'
         order by entity_id`,
        [[adminRequestId, creatorRequestId]],
      );
      expect(audits.rows).toHaveLength(2);
      expect(audits.rows.find((audit) => audit.entity_id === creatorRequestId))
        .toMatchObject({
          action_type: "procurement.created",
          actor_user_id: creator.profileId,
          entity_type: "procurement_request",
          after_data: {
            product_id: productIds[0],
            requested_name: "Authoritative Product Name",
            supplier_id: supplierIds[0],
            requested_quantity: 9,
            delivered_quantity: 0,
            status: "active",
          },
        });

      const deniedActors = [
        viewerOnly,
        editOnly,
        statusOnly,
        resolveOnly,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ];
      for (const [index, actor] of deniedActors.entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_procurement_create_${index}`);
        await expect(database.query(
          `select public.create_procurement_request_for_product($1, $2, 1)`,
          [productIds[0], supplierIds[0]],
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_procurement_create_${index}`);
        await database.query("reset role");
      }
      await database.query("set local role anon");
      await database.query("savepoint anonymous_procurement_create");
      await expect(database.query(
        `select public.create_procurement_request_for_product($1, $2, 1)`,
        [productIds[0], supplierIds[0]],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_procurement_create");
      await database.query("reset role");

      const rejectedInputs = [
        { productId: randomUUID(), supplierId: supplierIds[0], quantity: 1, code: "PRQ03" },
        { productId: productIds[2], supplierId: supplierIds[0], quantity: 1, code: "PRQ03" },
        { productId: productIds[0], supplierId: randomUUID(), quantity: 1, code: "PRQ04" },
        { productId: productIds[0], supplierId: supplierIds[1], quantity: 1, code: "PRQ04" },
        { productId: productIds[0], supplierId: supplierIds[0], quantity: 0, code: "22023" },
        { productId: productIds[0], supplierId: supplierIds[0], quantity: -1, code: "22023" },
      ];
      for (const [index, rejected] of rejectedInputs.entries()) {
        const before = await database.query<CountResultRow>(
          `select (
             select count(*)::integer from public.procurement_requests
           ) + (
             select count(*)::integer from public.audit_logs
             where action_type = 'procurement.created'
           ) as count`,
        );
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint rejected_procurement_input_${index}`);
        await expect(database.query(
          `select public.create_procurement_request_for_product($1, $2, $3)`,
          [rejected.productId, rejected.supplierId, rejected.quantity],
        )).rejects.toMatchObject({ code: rejected.code });
        await database.query(`rollback to savepoint rejected_procurement_input_${index}`);
        await database.query("reset role");
        const after = await database.query<CountResultRow>(
          `select (
             select count(*)::integer from public.procurement_requests
           ) + (
             select count(*)::integer from public.audit_logs
             where action_type = 'procurement.created'
           ) as count`,
        );
        expect(after.rows).toEqual(before.rows);
      }

      async function readProductChoices(authUserId: string, search: string | null) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<Record<string, unknown>>(
          "select * from public.search_procurement_product_choices($1)",
          [search],
        );
        await database.query("reset role");
        return result.rows;
      }

      const adminProductChoices = await readProductChoices(admin.authUserId, null);
      const creatorProductChoices = await readProductChoices(creator.authUserId, null);
      expect(creatorProductChoices).toEqual(adminProductChoices);
      expect(new Set(creatorProductChoices
        .filter((row) => productIds.some((productId) => productId === row.product_id))
        .map((row) => row.product_id)))
        .toEqual(new Set([productIds[0], productIds[1]]));
      expect(creatorProductChoices.every((row) =>
        Object.keys(row).sort().join(",") === "name,product_id,serial_number"
      )).toBe(true);
      expect((await readProductChoices(creator.authUserId, "authoritative"))
        .map((row) => row.product_id)).toEqual([productIds[0]]);
      expect((await readProductChoices(
        creator.authUserId,
        serials.rows[0]!.serial_number,
      )).map((row) => row.product_id)).toEqual([productIds[0]]);
      for (const literal of ["%", "_", "\\"]) {
        expect((await readProductChoices(creator.authUserId, literal))
          .map((row) => row.product_id)).toEqual([productIds[1]]);
      }

      async function readSupplierChoices(authUserId: string) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<Record<string, unknown>>(
          "select * from public.list_active_procurement_supplier_choices()",
        );
        await database.query("reset role");
        return result.rows;
      }

      expect(await readSupplierChoices(admin.authUserId)).toEqual(
        await readSupplierChoices(creator.authUserId),
      );
      const supplierChoices = await readSupplierChoices(creator.authUserId);
      expect(supplierChoices).toContainEqual({
        supplier_id: supplierIds[0],
        supplier_name: "Active Request Supplier",
      });
      expect(supplierChoices).not.toContainEqual(expect.objectContaining({
        supplier_id: supplierIds[1],
      }));
      expect(supplierChoices.every((row) =>
        Object.keys(row).sort().join(",") === "supplier_id,supplier_name"
      )).toBe(true);

      for (const [index, functionCall] of [
        "select * from public.search_procurement_product_choices(null)",
        "select * from public.list_active_procurement_supplier_choices()",
      ].entries()) {
        for (const [actorIndex, actor] of [viewerOnly, fixture.actors.inactive].entries()) {
          await database.query(
            "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
            [actor.authUserId],
          );
          await database.query("set local role authenticated");
          await database.query(`savepoint denied_creation_choice_${index}_${actorIndex}`);
          await expect(database.query(functionCall))
            .rejects.toMatchObject({ code: "42501" });
          await database.query(`rollback to savepoint denied_creation_choice_${index}_${actorIndex}`);
          await database.query("reset role");
        }
        await database.query("set local role anon");
        await database.query(`savepoint anonymous_creation_choice_${index}`);
        await expect(database.query(functionCall))
          .rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint anonymous_creation_choice_${index}`);
        await database.query("reset role");
      }

      await database.query(
        `create function public.test_reject_procurement_created_audit()
         returns trigger
         language plpgsql
         set search_path = ''
         as $test_function$
         begin
           if new.action_type = 'procurement.created' then
             raise exception 'Test Procurement audit rejection'
               using errcode = 'TST01';
           end if;

           return new;
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_reject_procurement_created_audit
         before insert on public.audit_logs
         for each row
         execute function public.test_reject_procurement_created_audit()`,
      );
      const requestCountBeforeAuditFailure = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.procurement_requests",
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint failed_procurement_audit");
      await expect(database.query(
        `select public.create_procurement_request_for_product($1, $2, 3)`,
        [productIds[0], supplierIds[0]],
      )).rejects.toMatchObject({ code: "TST01" });
      await database.query("rollback to savepoint failed_procurement_audit");
      await database.query("reset role");
      const requestCountAfterAuditFailure = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.procurement_requests",
      );
      expect(requestCountAfterAuditFailure.rows)
        .toEqual(requestCountBeforeAuditFailure.rows);

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        definition: string;
        identity_arguments: string;
        name: string;
        security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.proname as name,
           routine.prosecdef as security_definer,
           routine.proconfig as settings,
           pg_catalog.pg_get_function_identity_arguments(routine.oid)
             as identity_arguments,
           pg_catalog.pg_get_functiondef(routine.oid) as definition,
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
           and routine.proname = any($1::text[])
         order by routine.proname`,
        [[
          "create_procurement_request_for_product",
          "list_active_procurement_supplier_choices",
          "search_procurement_product_choices",
        ]],
      );
      expect(functionSecurity.rows).toHaveLength(3);
      for (const security of functionSecurity.rows) {
        expect(security).toMatchObject({
          anonymous_execute: false,
          authenticated_execute: true,
          security_definer: true,
          settings: ["search_path=\"\""],
        });
        expect(security.definition).toContain("procurement.create");
      }
      const creationSecurity = functionSecurity.rows.find((row) =>
        row.name === "create_procurement_request_for_product"
      );
      expect(creationSecurity?.identity_arguments).toBe(
        "p_product_id uuid, p_supplier_id uuid, p_requested_quantity bigint",
      );
      expect(creationSecurity?.definition.toLowerCase()).toContain("for share");
      expect(creationSecurity?.definition).not.toContain("p_requested_name");
      expect(creationSecurity?.definition).not.toContain("inventory_balances");
      expect(creationSecurity?.definition).not.toContain("inventory_movements");

      const inventoryAfter = await database.query<{
        balances: string;
        movements: string;
        quantities: string;
      }>(
        `select
           (select count(*)::text from public.inventory_balances) as balances,
           (select count(*)::text from public.inventory_movements) as movements,
           (
             select pg_catalog.string_agg(
               balance.product_id::text || ':' || balance.quantity::text,
               ',' order by balance.product_id
             )
             from public.inventory_balances as balance
           ) as quantities`,
      );
      const endpointsAfter = await database.query<Record<string, unknown>>(
        `select 'product' as kind, product.id, product.name,
                product.is_active, product.updated_at
         from public.products as product
         where product.id = any($1::uuid[])
         union all
         select 'supplier' as kind, supplier.id, supplier.name,
                supplier.is_active, supplier.updated_at
         from public.suppliers as supplier
         where supplier.id = any($2::uuid[])
         order by kind, id`,
        [productIds, supplierIds],
      );
      expect(inventoryAfter.rows).toEqual(inventoryBefore.rows);
      expect(endpointsAfter.rows).toEqual(endpointsBefore.rows);
    });

    expectPermissionDenied((await viewerOnly.client.rpc(
      "create_procurement_request_for_product",
      {
        p_product_id: productIds[0],
        p_supplier_id: supplierIds[0],
        p_requested_quantity: 1,
      },
    )).error);
    expectPermissionDenied((await fixture.anonymousClient.rpc(
      "search_procurement_product_choices",
      { p_search: null },
    )).error);
  });

  it("creates unlinked brand-new component Procurement requests without Product, Serial, or Inventory side effects", async () => {
    const fixture = requireHarness();
    const admin = fixture.actors.admin;
    const creator = fixture.actors.productCreator;
    const viewerOnly = fixture.actors.permitted;
    const editOnly = fixture.actors.supplierEditor;
    const statusOnly = fixture.actors.supplierArchiver;
    const resolveOnly = fixture.actors.supplierCreator;
    const supplierIds = [randomUUID(), randomUUID()];
    const productId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select actor.profile_id, definition.id, $6::uuid
         from (
           values
             ($1::uuid, 'procurement.create'::text),
             ($2::uuid, 'procurement.view'::text),
             ($3::uuid, 'procurement.edit'::text),
             ($4::uuid, 'procurement.change_status'::text),
             ($5::uuid, 'procurement.resolve'::text)
         ) as actor(profile_id, permission_key)
         join public.permission_definitions as definition
           on definition.key = actor.permission_key`,
        [
          creator.profileId,
          viewerOnly.profileId,
          editOnly.profileId,
          statusOnly.profileId,
          resolveOnly.profileId,
          admin.profileId,
        ],
      );
      await database.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values
           ($1, 'New Component Supplier', 'BiH', $3, $3),
           ($2, 'Archived New Component Supplier', 'BiH', $3, $3)`,
        [supplierIds[0], supplierIds[1], admin.profileId],
      );
      await database.query(
        `update public.suppliers
         set is_active = false,
             archived_at = pg_catalog.clock_timestamp(),
             archived_by_user_id = $1,
             updated_at = pg_catalog.clock_timestamp(),
             updated_by_user_id = $1
         where id = $2`,
        [admin.profileId, supplierIds[1]],
      );
      const serial = await database.query<{ serial_number: string }>(
        "select public.allocate_product_serial_number() as serial_number",
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'Task 078 Regression Product', 'Component',
                   'component', $3, $3)`,
        [productId, serial.rows[0]?.serial_number, admin.profileId],
      );

      const sideEffectsBefore = await database.query<Record<string, unknown>>(
        `select
           (select count(*)::text from public.products) as products,
           (select count(*)::text from public.product_suppliers) as product_suppliers,
           (select count(*)::text from public.inventory_balances) as balances,
           (select count(*)::text from public.inventory_movements) as movements,
           (select last_value::text from public.product_serial_number_seq) as serial_last_value`,
      );

      async function createAs(
        authUserId: string,
        requestedName: string,
        supplierId: string,
        quantity: number,
      ): Promise<string> {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<{ request_id: string }>(
          `select public.create_procurement_request_for_new_component(
             $1::text, $2::uuid, $3::bigint
           ) as request_id`,
          [requestedName, supplierId, quantity],
        );
        await database.query("reset role");
        const requestId = result.rows[0]?.request_id;
        if (!requestId) throw new Error("New-component request returned no ID");
        return requestId;
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [creator.authUserId],
      );
      await database.query("set local role authenticated");
      const independentAuthority = await database.query<{
        can_create: boolean;
        can_view: boolean;
      }>(
        `select
           public.has_permission('procurement.create') as can_create,
           public.has_permission('procurement.view') as can_view`,
      );
      await database.query("reset role");
      expect(independentAuthority.rows).toEqual([{
        can_create: true,
        can_view: false,
      }]);

      const adminRequestId = await createAs(
        admin.authUserId,
        "  New Component by Admin  ",
        supplierIds[0]!,
        5,
      );
      const creatorRequestId = await createAs(
        creator.authUserId,
        "  Worker New Component  ",
        supplierIds[0]!,
        11,
      );
      const createdRequests = await database.query<ProcurementRequestRow>(
        `select * from public.procurement_requests
         where id = any($1::uuid[])
         order by id`,
        [[adminRequestId, creatorRequestId]],
      );
      expect(createdRequests.rows).toHaveLength(2);
      expect(createdRequests.rows.find((row) => row.id === adminRequestId))
        .toMatchObject({
          created_by_user_id: admin.profileId,
          delivered_quantity: "0",
          product_id: null,
          requested_name: "New Component by Admin",
          requested_quantity: "5",
          resolved_at: null,
          resolved_by_user_id: null,
          status: "active",
          supplier_id: supplierIds[0],
          updated_by_user_id: admin.profileId,
        });
      expect(createdRequests.rows.find((row) => row.id === creatorRequestId))
        .toMatchObject({
          created_by_user_id: creator.profileId,
          product_id: null,
          requested_name: "Worker New Component",
          requested_quantity: "11",
          updated_by_user_id: creator.profileId,
        });
      for (const row of createdRequests.rows) {
        expect(row.created_at).toEqual(row.updated_at);
      }

      const audits = await database.query<CreatedAuditRow>(
        `select action_type, actor_user_id, after_data, entity_id,
                entity_type, metadata
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type = 'procurement.created'`,
        [[adminRequestId, creatorRequestId]],
      );
      expect(audits.rows).toHaveLength(2);
      expect(audits.rows.find((audit) => audit.entity_id === creatorRequestId))
        .toMatchObject({
          action_type: "procurement.created",
          actor_user_id: creator.profileId,
          entity_type: "procurement_request",
          after_data: {
            delivered_quantity: 0,
            product_id: null,
            requested_name: "Worker New Component",
            requested_quantity: 11,
            status: "active",
            supplier_id: supplierIds[0],
          },
        });

      for (const [index, actor] of [
        viewerOnly,
        editOnly,
        statusOnly,
        resolveOnly,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ].entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_new_component_${index}`);
        await expect(database.query(
          `select public.create_procurement_request_for_new_component(
             'Denied', $1::uuid, 1
           )`,
          [supplierIds[0]],
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_new_component_${index}`);
        await database.query("reset role");
      }
      await database.query("set local role anon");
      await database.query("savepoint anonymous_new_component");
      await expect(database.query(
        `select public.create_procurement_request_for_new_component(
           'Denied', $1::uuid, 1
         )`,
        [supplierIds[0]],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_new_component");
      await database.query("reset role");

      const rejectedInputs: Array<{
        code: string;
        name: string | null;
        quantity: number | null;
        supplierId: string | null;
      }> = [
        { name: "", supplierId: supplierIds[0]!, quantity: 1, code: "22023" },
        { name: "   ", supplierId: supplierIds[0]!, quantity: 1, code: "22023" },
        { name: null, supplierId: supplierIds[0]!, quantity: 1, code: "22023" },
        { name: "Missing Supplier", supplierId: null, quantity: 1, code: "22023" },
        { name: "Missing Supplier", supplierId: randomUUID(), quantity: 1, code: "PRQ04" },
        { name: "Archived Supplier", supplierId: supplierIds[1]!, quantity: 1, code: "PRQ04" },
        { name: "Zero", supplierId: supplierIds[0]!, quantity: 0, code: "22023" },
        { name: "Negative", supplierId: supplierIds[0]!, quantity: -1, code: "22023" },
      ];
      for (const [index, rejected] of rejectedInputs.entries()) {
        const before = await database.query<CountResultRow>(
          `select (
             select count(*)::integer from public.procurement_requests
           ) + (
             select count(*)::integer from public.audit_logs
             where action_type = 'procurement.created'
           ) as count`,
        );
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint rejected_new_component_${index}`);
        await expect(database.query(
          `select public.create_procurement_request_for_new_component(
             $1::text, $2::uuid, $3::bigint
           )`,
          [rejected.name, rejected.supplierId, rejected.quantity],
        )).rejects.toMatchObject({ code: rejected.code });
        await database.query(`rollback to savepoint rejected_new_component_${index}`);
        await database.query("reset role");
        const after = await database.query<CountResultRow>(
          `select (
             select count(*)::integer from public.procurement_requests
           ) + (
             select count(*)::integer from public.audit_logs
             where action_type = 'procurement.created'
           ) as count`,
        );
        expect(after.rows).toEqual(before.rows);
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [creator.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint direct_new_component_insert");
      await expect(database.query(
        `insert into public.procurement_requests (
           product_id, requested_name, supplier_id, requested_quantity,
           created_by_user_id, updated_by_user_id
         ) values (null, 'Direct', $1, 1, $2, $2)`,
        [supplierIds[0], creator.profileId],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint direct_new_component_insert");
      await database.query("reset role");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [creator.authUserId],
      );
      await database.query("set local role authenticated");
      const existingProductRequest = await database.query<{ request_id: string }>(
        `select public.create_procurement_request_for_product(
           $1::uuid, $2::uuid, 2
         ) as request_id`,
        [productId, supplierIds[0]],
      );
      await database.query("reset role");
      expect(existingProductRequest.rows[0]?.request_id).toBeTruthy();

      await database.query(
        `create function public.test_reject_new_component_procurement_audit()
         returns trigger
         language plpgsql
         set search_path = ''
         as $test_function$
         begin
           if new.action_type = 'procurement.created'
             and new.after_data ->> 'product_id' is null
           then
             raise exception 'Test new-component audit rejection'
               using errcode = 'TST01';
           end if;

           return new;
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_reject_new_component_procurement_audit
         before insert on public.audit_logs
         for each row
         execute function public.test_reject_new_component_procurement_audit()`,
      );
      const requestCountBeforeFailure = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.procurement_requests",
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint rejected_new_component_audit");
      await expect(database.query(
        `select public.create_procurement_request_for_new_component(
           'Rollback Component', $1::uuid, 3
         )`,
        [supplierIds[0]],
      )).rejects.toMatchObject({ code: "TST01" });
      await database.query("rollback to savepoint rejected_new_component_audit");
      await database.query("reset role");
      expect((await database.query<CountResultRow>(
        "select count(*)::integer as count from public.procurement_requests",
      )).rows).toEqual(requestCountBeforeFailure.rows);

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        definition: string;
        identity_arguments: string;
        security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.prosecdef as security_definer,
           routine.proconfig as settings,
           pg_catalog.pg_get_function_identity_arguments(routine.oid)
             as identity_arguments,
           pg_catalog.pg_get_functiondef(routine.oid) as definition,
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
           and routine.proname = 'create_procurement_request_for_new_component'`,
      );
      expect(functionSecurity.rows).toHaveLength(1);
      expect(functionSecurity.rows[0]).toMatchObject({
        anonymous_execute: false,
        authenticated_execute: true,
        identity_arguments:
          "p_requested_name text, p_supplier_id uuid, p_requested_quantity bigint",
        security_definer: true,
        settings: ["search_path=\"\""],
      });
      const definition = functionSecurity.rows[0]?.definition ?? "";
      expect(definition.toLowerCase()).toContain("for share");
      expect(definition).toContain("procurement.create");
      expect(definition).not.toContain("allocate_product_serial_number");
      expect(definition).not.toContain("inventory_balances");
      expect(definition).not.toContain("inventory_movements");
      expect(definition).not.toContain("product_suppliers");

      const sideEffectsAfter = await database.query<Record<string, unknown>>(
        `select
           (select count(*)::text from public.products) as products,
           (select count(*)::text from public.product_suppliers) as product_suppliers,
           (select count(*)::text from public.inventory_balances) as balances,
           (select count(*)::text from public.inventory_movements) as movements,
           (select last_value::text from public.product_serial_number_seq) as serial_last_value`,
      );
      expect(sideEffectsAfter.rows).toEqual(sideEffectsBefore.rows);
    });

    expectPermissionDenied((await viewerOnly.client.rpc(
      "create_procurement_request_for_new_component",
      {
        p_requested_name: "Denied",
        p_supplier_id: supplierIds[0],
        p_requested_quantity: 1,
      },
    )).error);
    expectPermissionDenied((await fixture.anonymousClient.rpc(
      "create_procurement_request_for_new_component",
      {
        p_requested_name: "Denied",
        p_supplier_id: supplierIds[0],
        p_requested_quantity: 1,
      },
    )).error);
  });

  it("updates Procurement Delivered Quantity through change-status authority without Inventory effects", async () => {
    const fixture = requireHarness();
    const admin = fixture.actors.admin;
    const statusChanger = fixture.actors.productEditor;
    const viewerOnly = fixture.actors.permitted;
    const editorOnly = fixture.actors.supplierEditor;
    const creatorOnly = fixture.actors.productCreator;
    const resolverOnly = fixture.actors.supplierCreator;
    const supplierId = randomUUID();
    const productId = randomUUID();
    const activeRequestId = randomUUID();
    const resolvedRequestId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select actor.profile_id, definition.id, $6::uuid
         from (
           values
             ($1::uuid, 'procurement.change_status'::text),
             ($2::uuid, 'procurement.view'::text),
             ($3::uuid, 'procurement.edit'::text),
             ($4::uuid, 'procurement.create'::text),
             ($5::uuid, 'procurement.resolve'::text)
         ) as actor(profile_id, permission_key)
         join public.permission_definitions as definition
           on definition.key = actor.permission_key`,
        [
          statusChanger.profileId,
          viewerOnly.profileId,
          editorOnly.profileId,
          creatorOnly.profileId,
          resolverOnly.profileId,
          admin.profileId,
        ],
      );
      await database.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values ($1, 'Delivery Update Supplier', 'BiH', $2, $2)`,
        [supplierId, admin.profileId],
      );
      const serial = await database.query<{ serial_number: string }>(
        "select public.allocate_product_serial_number() as serial_number",
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'Delivery Product', 'Component', 'component', $3, $3)`,
        [productId, serial.rows[0]?.serial_number, admin.profileId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_at, created_by_user_id,
           updated_at, updated_by_user_id, resolved_at, resolved_by_user_id
         ) values
           ($1, $3, 'Immutable Delivery Snapshot', $4, 10, 0, 'active',
            '2026-09-15T08:00:00Z', $5, '2000-01-01T00:00:00Z', $5,
            null, null),
           ($2, $3, 'Resolved Delivery Snapshot', $4, 10, 5, 'resolved',
            '2026-09-15T08:00:00Z', $5, '2026-09-15T09:00:00Z', $5,
            '2026-09-15T09:00:00Z', $5)`,
        [
          activeRequestId,
          resolvedRequestId,
          productId,
          supplierId,
          admin.profileId,
        ],
      );

      const inventoryBefore = await database.query<Record<string, unknown>>(
        `select
           (select pg_catalog.string_agg(
             balance.product_id::text || ':' || balance.quantity::text,
             ',' order by balance.product_id
           ) from public.inventory_balances as balance) as balances,
           (select count(*)::text from public.inventory_movements) as movements`,
      );

      async function updateAs(
        authUserId: string,
        requestId: string,
        deliveredQuantity: number,
      ): Promise<string> {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<{ request_id: string }>(
          `select public.update_procurement_delivered_quantity(
             $1::uuid, $2::bigint
           ) as request_id`,
          [requestId, deliveredQuantity],
        );
        await database.query("reset role");
        const updatedRequestId = result.rows[0]?.request_id;
        if (!updatedRequestId) throw new Error("Delivery update returned no ID");
        return updatedRequestId;
      }

      async function readRequest() {
        const result = await database.query<ProcurementRequestRow>(
          "select * from public.procurement_requests where id = $1::uuid",
          [activeRequestId],
        );
        const request = result.rows[0];
        if (!request) throw new Error("Delivery request fixture is missing");
        return request;
      }

      async function countDeliveryAudits(): Promise<number> {
        const result = await database.query<CountResultRow>(
          `select count(*)::integer as count
           from public.audit_logs
           where entity_id = $1::uuid
             and action_type = 'procurement.delivery_updated'`,
          [activeRequestId],
        );
        return result.rows[0]?.count ?? -1;
      }

      async function readBadgeCount(): Promise<string> {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [admin.authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<{ count: string }>(
          `select public.get_procurement_sidebar_badge_count()::text as count`,
        );
        await database.query("reset role");
        return result.rows[0]?.count ?? "missing";
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [statusChanger.authUserId],
      );
      await database.query("set local role authenticated");
      const independentAuthority = await database.query<{
        can_change: boolean;
        can_view: boolean;
      }>(
        `select
           public.has_permission('procurement.change_status') as can_change,
           public.has_permission('procurement.view') as can_view`,
      );
      await database.query("reset role");
      expect(independentAuthority.rows).toEqual([{
        can_change: true,
        can_view: false,
      }]);

      const badgeBefore = await readBadgeCount();
      expect(await updateAs(admin.authUserId, activeRequestId, 1))
        .toBe(activeRequestId);
      expect(await readRequest()).toMatchObject({
        delivered_quantity: "1",
        requested_quantity: "10",
        status: "partly_delivered",
        updated_by_user_id: admin.profileId,
      });
      expect((await readRequest()).updated_at.toISOString())
        .not.toBe("2000-01-01T00:00:00.000Z");
      expect(await countDeliveryAudits()).toBe(1);

      expect(await updateAs(statusChanger.authUserId, activeRequestId, 4))
        .toBe(activeRequestId);
      expect(await readRequest()).toMatchObject({
        delivered_quantity: "4",
        status: "partly_delivered",
        updated_by_user_id: statusChanger.profileId,
      });
      expect(await countDeliveryAudits()).toBe(2);

      await updateAs(statusChanger.authUserId, activeRequestId, 0);
      expect(await readRequest()).toMatchObject({
        delivered_quantity: "0",
        status: "active",
      });
      expect(await countDeliveryAudits()).toBe(3);

      await updateAs(statusChanger.authUserId, activeRequestId, 10);
      expect(await readRequest()).toMatchObject({
        delivered_quantity: "10",
        resolved_at: null,
        resolved_by_user_id: null,
        status: "partly_delivered",
      });
      expect(await countDeliveryAudits()).toBe(4);

      await updateAs(statusChanger.authUserId, activeRequestId, 3);
      const beforeNoOp = await readRequest();
      expect(beforeNoOp).toMatchObject({
        delivered_quantity: "3",
        status: "partly_delivered",
      });
      expect(await countDeliveryAudits()).toBe(5);
      expect(await updateAs(statusChanger.authUserId, activeRequestId, 3))
        .toBe(activeRequestId);
      expect(await readRequest()).toEqual(beforeNoOp);
      expect(await countDeliveryAudits()).toBe(5);
      expect(await readBadgeCount()).toBe(badgeBefore);

      const deliveryAudits = await database.query<{
        action_type: string;
        actor_user_id: string;
        after_data: Record<string, unknown>;
        before_data: Record<string, unknown>;
      }>(
        `select action_type, actor_user_id, before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'procurement.delivery_updated'`,
        [activeRequestId],
      );
      expect(deliveryAudits.rows).toHaveLength(5);
      expect(deliveryAudits.rows).toContainEqual(expect.objectContaining({
        action_type: "procurement.delivery_updated",
        actor_user_id: admin.profileId,
        before_data: {
          delivered_quantity: 0,
          remaining_quantity: 10,
          requested_quantity: 10,
          status: "active",
        },
        after_data: {
          delivered_quantity: 1,
          remaining_quantity: 9,
          requested_quantity: 10,
          status: "partly_delivered",
        },
      }));

      const deniedState = await readRequest();
      const deniedAuditCount = await countDeliveryAudits();
      for (const [index, actor] of [
        editorOnly,
        viewerOnly,
        creatorOnly,
        resolverOnly,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ].entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_delivery_update_${index}`);
        await expect(database.query(
          `select public.update_procurement_delivered_quantity($1::uuid, 2)`,
          [activeRequestId],
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_delivery_update_${index}`);
        await database.query("reset role");
      }
      await database.query("set local role anon");
      await database.query("savepoint anonymous_delivery_update");
      await expect(database.query(
        `select public.update_procurement_delivered_quantity($1::uuid, 2)`,
        [activeRequestId],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_delivery_update");
      await database.query("reset role");
      expect(await readRequest()).toEqual(deniedState);
      expect(await countDeliveryAudits()).toBe(deniedAuditCount);

      for (const [index, invalid] of [
        { requestId: null, quantity: 0, code: "22023" },
        { requestId: activeRequestId, quantity: null, code: "22023" },
        { requestId: activeRequestId, quantity: -1, code: "22023" },
        { requestId: activeRequestId, quantity: 11, code: "22023" },
        { requestId: randomUUID(), quantity: 0, code: "P0002" },
        { requestId: resolvedRequestId, quantity: 4, code: "PRQ02" },
      ].entries()) {
        const before = await database.query<ProcurementRequestRow>(
          `select * from public.procurement_requests
           where id = any($1::uuid[]) order by id`,
          [[activeRequestId, resolvedRequestId]],
        );
        const auditCount = await countDeliveryAudits();
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint invalid_delivery_update_${index}`);
        await expect(database.query(
          `select public.update_procurement_delivered_quantity(
             $1::uuid, $2::bigint
           )`,
          [invalid.requestId, invalid.quantity],
        )).rejects.toMatchObject({ code: invalid.code });
        await database.query(`rollback to savepoint invalid_delivery_update_${index}`);
        await database.query("reset role");
        expect((await database.query<ProcurementRequestRow>(
          `select * from public.procurement_requests
           where id = any($1::uuid[]) order by id`,
          [[activeRequestId, resolvedRequestId]],
        )).rows).toEqual(before.rows);
        expect(await countDeliveryAudits()).toBe(auditCount);
      }

      await database.query("savepoint immutable_delivery_snapshot");
      await expect(database.query(
        `update public.procurement_requests
         set requested_name = 'Changed Snapshot'
         where id = $1::uuid`,
        [activeRequestId],
      )).rejects.toMatchObject({ code: "PRQ01" });
      await database.query("rollback to savepoint immutable_delivery_snapshot");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [statusChanger.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint direct_delivery_update");
      await expect(database.query(
        `update public.procurement_requests
         set delivered_quantity = 2, status = 'partly_delivered'
         where id = $1::uuid`,
        [activeRequestId],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint direct_delivery_update");
      await database.query("reset role");

      await database.query(
        `create function public.test_reject_procurement_delivery_audit()
         returns trigger
         language plpgsql
         set search_path = ''
         as $test_function$
         begin
           if new.action_type = 'procurement.delivery_updated' then
             raise exception 'Test delivery audit rejection'
               using errcode = 'TST01';
           end if;

           return new;
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_reject_procurement_delivery_audit
         before insert on public.audit_logs
         for each row
         execute function public.test_reject_procurement_delivery_audit()`,
      );
      const beforeAuditFailure = await readRequest();
      const auditCountBeforeFailure = await countDeliveryAudits();
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint failed_delivery_audit");
      await expect(database.query(
        `select public.update_procurement_delivered_quantity($1::uuid, 4)`,
        [activeRequestId],
      )).rejects.toMatchObject({ code: "TST01" });
      await database.query("rollback to savepoint failed_delivery_audit");
      await database.query("reset role");
      expect(await readRequest()).toEqual(beforeAuditFailure);
      expect(await countDeliveryAudits()).toBe(auditCountBeforeFailure);

      const finalRequest = await readRequest();
      expect(finalRequest).toMatchObject({
        created_by_user_id: admin.profileId,
        delivered_quantity: "3",
        product_id: productId,
        requested_name: "Immutable Delivery Snapshot",
        requested_quantity: "10",
        resolved_at: null,
        resolved_by_user_id: null,
        status: "partly_delivered",
        supplier_id: supplierId,
        updated_by_user_id: statusChanger.profileId,
      });
      const inventoryAfter = await database.query<Record<string, unknown>>(
        `select
           (select pg_catalog.string_agg(
             balance.product_id::text || ':' || balance.quantity::text,
             ',' order by balance.product_id
           ) from public.inventory_balances as balance) as balances,
           (select count(*)::text from public.inventory_movements) as movements`,
      );
      expect(inventoryAfter.rows).toEqual(inventoryBefore.rows);

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        definition: string;
        identity_arguments: string;
        security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.prosecdef as security_definer,
           routine.proconfig as settings,
           pg_catalog.pg_get_function_identity_arguments(routine.oid)
             as identity_arguments,
           pg_catalog.pg_get_functiondef(routine.oid) as definition,
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
           and routine.proname = 'update_procurement_delivered_quantity'`,
      );
      expect(functionSecurity.rows).toHaveLength(1);
      expect(functionSecurity.rows[0]).toMatchObject({
        anonymous_execute: false,
        authenticated_execute: true,
        identity_arguments: "p_request_id uuid, p_delivered_quantity bigint",
        security_definer: true,
        settings: ["search_path=\"\""],
      });
      const definition = functionSecurity.rows[0]?.definition ?? "";
      expect(definition.toLowerCase()).toContain("for update");
      expect(definition.match(/procurement\.change_status/g)).toHaveLength(2);
      expect(definition).not.toContain("p_status");
      expect(definition).not.toContain("p_requested_quantity");
      expect(definition).not.toContain("apply_inventory_delta");
      expect(definition).not.toContain("manual_adjust_inventory");
    });

    expectPermissionDenied((await viewerOnly.client.rpc(
      "update_procurement_delivered_quantity",
      { p_request_id: activeRequestId, p_delivered_quantity: 1 },
    )).error);
    expectPermissionDenied((await fixture.anonymousClient.rpc(
      "update_procurement_delivered_quantity",
      { p_request_id: activeRequestId, p_delivered_quantity: 1 },
    )).error);
  });

  it("resolves Procurement requests terminally through independent resolve authority without Inventory effects", async () => {
    const fixture = requireHarness();
    const admin = fixture.actors.admin;
    const resolver = fixture.actors.supplierCreator;
    const statusChanger = fixture.actors.productEditor;
    const editor = fixture.actors.supplierEditor;
    const creator = fixture.actors.productCreator;
    const viewer = fixture.actors.permitted;
    const supplierId = randomUUID();
    const productId = randomUUID();
    const activeRequestId = randomUUID();
    const partialRequestId = randomUUID();
    const fullRequestId = randomUUID();
    const resolvedRequestId = randomUUID();
    const auditFailureRequestId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select actor.profile_id, definition.id, $6::uuid
         from (
           values
             ($1::uuid, 'procurement.resolve'::text),
             ($2::uuid, 'procurement.change_status'::text),
             ($3::uuid, 'procurement.edit'::text),
             ($4::uuid, 'procurement.create'::text),
             ($5::uuid, 'procurement.view'::text)
         ) as actor(profile_id, permission_key)
         join public.permission_definitions as definition
           on definition.key = actor.permission_key`,
        [
          resolver.profileId,
          statusChanger.profileId,
          editor.profileId,
          creator.profileId,
          viewer.profileId,
          admin.profileId,
        ],
      );
      await database.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values ($1, 'Resolve Supplier', 'BiH', $2, $2)`,
        [supplierId, admin.profileId],
      );
      const serial = await database.query<{ serial_number: string }>(
        "select public.allocate_product_serial_number() as serial_number",
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'Resolve Product', 'Component', 'component', $3, $3)`,
        [productId, serial.rows[0]?.serial_number, admin.profileId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_at, created_by_user_id,
           updated_at, updated_by_user_id, resolved_at, resolved_by_user_id
         ) values
           ($1, $6, 'Active Resolve Snapshot', $7, 10, 0, 'active',
            '2026-09-15T08:00:00Z', $8, '2000-01-01T00:00:00Z', $8,
            null, null),
           ($2, $6, 'Partial Resolve Snapshot', $7, 10, 4, 'partly_delivered',
            '2026-09-15T08:01:00Z', $8, '2000-01-01T00:00:00Z', $8,
            null, null),
           ($3, $6, 'Full Resolve Snapshot', $7, 10, 10, 'partly_delivered',
            '2026-09-15T08:02:00Z', $8, '2000-01-01T00:00:00Z', $8,
            null, null),
           ($4, $6, 'Already Resolved Snapshot', $7, 10, 5, 'resolved',
            '2026-09-15T08:03:00Z', $8, '2026-09-15T09:00:00Z', $8,
            '2026-09-15T09:00:00Z', $8),
           ($5, $6, 'Audit Failure Snapshot', $7, 10, 2, 'partly_delivered',
            '2026-09-15T08:04:00Z', $8, '2000-01-01T00:00:00Z', $8,
            null, null)`,
        [
          activeRequestId,
          partialRequestId,
          fullRequestId,
          resolvedRequestId,
          auditFailureRequestId,
          productId,
          supplierId,
          admin.profileId,
        ],
      );

      const inventoryBefore = await database.query<Record<string, unknown>>(
        `select
           (select pg_catalog.string_agg(
             balance.product_id::text || ':' || balance.quantity::text,
             ',' order by balance.product_id
           ) from public.inventory_balances as balance) as balances,
           (select count(*)::text from public.inventory_movements) as movements`,
      );

      async function resolveAs(authUserId: string, requestId: string) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<{ request_id: string }>(
          `select public.resolve_procurement_request($1::uuid) as request_id`,
          [requestId],
        );
        await database.query("reset role");
        return result.rows[0]?.request_id;
      }

      async function readRequest(requestId: string) {
        const result = await database.query<ProcurementRequestRow>(
          "select * from public.procurement_requests where id = $1::uuid",
          [requestId],
        );
        const row = result.rows[0];
        if (!row) throw new Error("Resolve request fixture is missing");
        return row;
      }

      async function countResolveAudits(requestId: string) {
        const result = await database.query<CountResultRow>(
          `select count(*)::integer as count
           from public.audit_logs
           where entity_id = $1::uuid
             and action_type = 'procurement.resolved'`,
          [requestId],
        );
        return result.rows[0]?.count ?? -1;
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [resolver.authUserId],
      );
      await database.query("set local role authenticated");
      const independentAuthority = await database.query<{
        can_resolve: boolean;
        can_view: boolean;
      }>(
        `select
           public.has_permission('procurement.resolve') as can_resolve,
           public.has_permission('procurement.view') as can_view`,
      );
      await database.query("reset role");
      expect(independentAuthority.rows).toEqual([{
        can_resolve: true,
        can_view: false,
      }]);

      for (const [requestId, actor, deliveredQuantity] of [
        [activeRequestId, admin, "0"],
        [partialRequestId, resolver, "4"],
        [fullRequestId, resolver, "10"],
      ] as const) {
        const before = await readRequest(requestId);
        expect(await resolveAs(actor.authUserId, requestId)).toBe(requestId);
        const after = await readRequest(requestId);

        expect(after).toMatchObject({
          created_at: before.created_at,
          created_by_user_id: before.created_by_user_id,
          delivered_quantity: deliveredQuantity,
          product_id: before.product_id,
          requested_name: before.requested_name,
          requested_quantity: before.requested_quantity,
          resolved_by_user_id: actor.profileId,
          status: "resolved",
          supplier_id: before.supplier_id,
          updated_by_user_id: actor.profileId,
        });
        expect(after.resolved_at).toBeInstanceOf(Date);
        expect(after.updated_at).toEqual(after.resolved_at);
        expect(await countResolveAudits(requestId)).toBe(1);
      }

      const audit = await database.query<{
        action_type: string;
        actor_user_id: string;
        after_data: Record<string, unknown>;
        before_data: Record<string, unknown>;
      }>(
        `select action_type, actor_user_id, before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'procurement.resolved'`,
        [partialRequestId],
      );
      expect(audit.rows).toEqual([expect.objectContaining({
        action_type: "procurement.resolved",
        actor_user_id: resolver.profileId,
        before_data: expect.objectContaining({
          delivered_quantity: 4,
          remaining_quantity: 6,
          requested_quantity: 10,
          status: "partly_delivered",
        }),
        after_data: expect.objectContaining({
          delivered_quantity: 4,
          remaining_quantity: 6,
          requested_quantity: 10,
          resolved_by_user_id: resolver.profileId,
          status: "resolved",
        }),
      })]);

      const deniedRequest = await readRequest(auditFailureRequestId);
      for (const [index, actor] of [
        statusChanger,
        editor,
        creator,
        viewer,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ].entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_procurement_resolve_${index}`);
        await expect(database.query(
          "select public.resolve_procurement_request($1::uuid)",
          [auditFailureRequestId],
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_procurement_resolve_${index}`);
        await database.query("reset role");
      }
      await database.query("set local role anon");
      await database.query("savepoint anonymous_procurement_resolve");
      await expect(database.query(
        "select public.resolve_procurement_request($1::uuid)",
        [auditFailureRequestId],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_procurement_resolve");
      await database.query("reset role");
      expect(await readRequest(auditFailureRequestId)).toEqual(deniedRequest);
      expect(await countResolveAudits(auditFailureRequestId)).toBe(0);

      for (const [index, requestId, code] of [
        [0, resolvedRequestId, "PRQ02"],
        [1, randomUUID(), "P0002"],
      ] as const) {
        const before = await readRequest(resolvedRequestId);
        const auditCount = await countResolveAudits(resolvedRequestId);
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint invalid_procurement_resolve_${index}`);
        await expect(database.query(
          "select public.resolve_procurement_request($1::uuid)",
          [requestId],
        )).rejects.toMatchObject({ code });
        await database.query(`rollback to savepoint invalid_procurement_resolve_${index}`);
        await database.query("reset role");
        expect(await readRequest(resolvedRequestId)).toEqual(before);
        expect(await countResolveAudits(resolvedRequestId)).toBe(auditCount);
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint resolved_delivery_regression");
      await expect(database.query(
        `select public.update_procurement_delivered_quantity($1::uuid, 1)`,
        [activeRequestId],
      )).rejects.toMatchObject({ code: "PRQ02" });
      await database.query("rollback to savepoint resolved_delivery_regression");

      await database.query("savepoint direct_procurement_resolve_update");
      await expect(database.query(
        `update public.procurement_requests
         set status = 'resolved', resolved_at = pg_catalog.now(),
             resolved_by_user_id = $2::uuid
         where id = $1::uuid`,
        [auditFailureRequestId, admin.profileId],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint direct_procurement_resolve_update");
      await database.query("reset role");

      await database.query(
        `create function public.test_reject_procurement_resolve_audit()
         returns trigger
         language plpgsql
         set search_path = ''
         as $test_function$
         begin
           if new.action_type = 'procurement.resolved' then
             raise exception 'Test resolve audit rejection'
               using errcode = 'TST01';
           end if;

           return new;
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_reject_procurement_resolve_audit
         before insert on public.audit_logs
         for each row
         execute function public.test_reject_procurement_resolve_audit()`,
      );
      const beforeAuditFailure = await readRequest(auditFailureRequestId);
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint failed_procurement_resolve_audit");
      await expect(database.query(
        "select public.resolve_procurement_request($1::uuid)",
        [auditFailureRequestId],
      )).rejects.toMatchObject({ code: "TST01" });
      await database.query("rollback to savepoint failed_procurement_resolve_audit");
      await database.query("reset role");
      expect(await readRequest(auditFailureRequestId)).toEqual(beforeAuditFailure);
      expect(await countResolveAudits(auditFailureRequestId)).toBe(0);

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      const historicalRead = await database.query<{ id: string }>(
        `select id from public.procurement_requests
         where id = $1::uuid and status = 'resolved'`,
        [activeRequestId],
      );
      await database.query("reset role");
      expect(historicalRead.rows).toEqual([{ id: activeRequestId }]);

      const inventoryAfter = await database.query<Record<string, unknown>>(
        `select
           (select pg_catalog.string_agg(
             balance.product_id::text || ':' || balance.quantity::text,
             ',' order by balance.product_id
           ) from public.inventory_balances as balance) as balances,
           (select count(*)::text from public.inventory_movements) as movements`,
      );
      expect(inventoryAfter.rows).toEqual(inventoryBefore.rows);

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        definition: string;
        identity_arguments: string;
        security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.prosecdef as security_definer,
           routine.proconfig as settings,
           pg_catalog.pg_get_function_identity_arguments(routine.oid)
             as identity_arguments,
           pg_catalog.pg_get_functiondef(routine.oid) as definition,
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
           and routine.proname = 'resolve_procurement_request'`,
      );
      expect(functionSecurity.rows).toHaveLength(1);
      expect(functionSecurity.rows[0]).toMatchObject({
        anonymous_execute: false,
        authenticated_execute: true,
        identity_arguments: "p_request_id uuid",
        security_definer: true,
        settings: ["search_path=\"\""],
      });
      const definition = functionSecurity.rows[0]?.definition ?? "";
      expect(definition.toLowerCase()).toContain("for update");
      expect(definition.match(/'procurement\.resolve'/g)).toHaveLength(2);
      expect(definition).not.toContain("procurement.view");
      expect(definition).not.toContain("apply_inventory_delta");
      expect(definition).not.toContain("manual_adjust_inventory");

      const reopenFunctions = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname like '%procurement%reopen%'`,
      );
      expect(reopenFunctions.rows).toEqual([{ count: 0 }]);
    });
  });

  it("creates and links a component from an eligible Procurement request as one Admin-only transaction", async () => {
    const fixture = requireHarness();
    const admin = fixture.actors.admin;
    const activeBrandId = randomUUID();
    const archivedBrandId = randomUUID();
    const activeSupplierId = randomUUID();
    const archivedSupplierId = randomUUID();
    const activeRequestId = randomUUID();
    const partialRequestId = randomUUID();
    const deniedRequestId = randomUUID();
    const linkedRequestId = randomUUID();
    const resolvedRequestId = randomUUID();
    const archivedSupplierRequestId = randomUUID();
    const productSupplierFailureRequestId = randomUUID();
    const auditFailureRequestId = randomUUID();
    const existingProductId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select actor.profile_id, definition.id, $6::uuid
         from (
           values
             ($1::uuid, 'procurement.view'::text),
             ($2::uuid, 'procurement.create'::text),
             ($3::uuid, 'procurement.edit'::text),
             ($4::uuid, 'procurement.change_status'::text),
             ($5::uuid, 'procurement.resolve'::text)
         ) as actor(profile_id, permission_key)
         join public.permission_definitions as definition
           on definition.key = actor.permission_key
         on conflict do nothing`,
        [
          fixture.actors.permitted.profileId,
          fixture.actors.productCreator.profileId,
          fixture.actors.supplierEditor.profileId,
          fixture.actors.productEditor.profileId,
          fixture.actors.supplierCreator.profileId,
          admin.profileId,
        ],
      );
      await database.query(
        `insert into public.brands (
           id, name, is_active, created_by_user_id, updated_by_user_id,
           archived_at, archived_by_user_id
         ) values
           ($1, 'Procurement Product Brand', true, $3, $3, null, null),
           ($2, 'Archived Procurement Product Brand', false, $3, $3,
            pg_catalog.now(), $3)`,
        [activeBrandId, archivedBrandId, admin.profileId],
      );
      await database.query(
        `insert into public.suppliers (
           id, name, country, is_active, created_by_user_id,
           updated_by_user_id, archived_at, archived_by_user_id
         ) values
           ($1, 'Procurement Product Supplier', 'BiH', true, $3, $3,
            null, null),
           ($2, 'Archived Procurement Product Supplier', 'BiH', false,
            $3, $3, pg_catalog.now(), $3)`,
        [activeSupplierId, archivedSupplierId, admin.profileId],
      );
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values ($1, $2, 'Existing Linked Product', 'Components',
           'component', $3, $3)`,
        [existingProductId, createTestSerialNumber(), admin.profileId],
      );
      await database.query(
        `insert into public.procurement_requests (
           id, product_id, requested_name, supplier_id, requested_quantity,
           delivered_quantity, status, created_at, created_by_user_id,
           updated_at, updated_by_user_id, resolved_at, resolved_by_user_id
         ) values
           ($1, null, 'Original Active Snapshot', $9, 12, 0, 'active',
            '2026-09-15T10:00:00Z', $11, '2000-01-01T00:00:00Z', $11,
            null, null),
           ($2, null, 'Original Partial Snapshot', $9, 10, 4,
            'partly_delivered', '2026-09-15T10:01:00Z', $11,
            '2000-01-01T00:00:00Z', $11, null, null),
           ($3, null, 'Denied Snapshot', $9, 8, 0, 'active',
            '2026-09-15T10:02:00Z', $11, '2000-01-01T00:00:00Z', $11,
            null, null),
           ($4, $10, 'Already Linked Snapshot', $9, 7, 0, 'active',
            '2026-09-15T10:03:00Z', $11, '2000-01-01T00:00:00Z', $11,
            null, null),
           ($5, null, 'Resolved Snapshot', $9, 6, 2, 'resolved',
            '2026-09-15T10:04:00Z', $11, '2026-09-15T11:00:00Z', $11,
            '2026-09-15T11:00:00Z', $11),
           ($6, null, 'Archived Supplier Snapshot', $12, 5, 0, 'active',
            '2026-09-15T10:05:00Z', $11, '2000-01-01T00:00:00Z', $11,
            null, null),
           ($7, null, 'Link Failure Snapshot', $9, 4, 0, 'active',
            '2026-09-15T10:06:00Z', $11, '2000-01-01T00:00:00Z', $11,
            null, null),
           ($8, null, 'Audit Failure Snapshot', $9, 3, 0, 'active',
            '2026-09-15T10:07:00Z', $11, '2000-01-01T00:00:00Z', $11,
            null, null)`,
        [
          activeRequestId,
          partialRequestId,
          deniedRequestId,
          linkedRequestId,
          resolvedRequestId,
          archivedSupplierRequestId,
          productSupplierFailureRequestId,
          auditFailureRequestId,
          activeSupplierId,
          existingProductId,
          admin.profileId,
          archivedSupplierId,
        ],
      );

      async function createFromRequest(
        authUserId: string,
        requestId: string,
        name: string,
        category: string,
        brandId: string | null,
        catalogNumber: string | null,
      ) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [authUserId],
        );
        await database.query("set local role authenticated");
        const result = await database.query<{
          product_id: string;
          serial_number: string;
        }>(
          `select * from public.create_product_from_procurement_request(
             $1::uuid, $2::text, $3::text, $4::uuid, $5::text
           )`,
          [requestId, name, category, brandId, catalogNumber],
        );
        await database.query("reset role");
        const row = result.rows[0];
        if (!row) throw new Error("Procurement Product creation returned no row");
        return row;
      }

      async function requestState(requestId: string) {
        const result = await database.query<ProcurementRequestRow>(
          "select * from public.procurement_requests where id = $1::uuid",
          [requestId],
        );
        const row = result.rows[0];
        if (!row) throw new Error("Procurement Product request fixture is missing");
        return row;
      }

      const activeBefore = await requestState(activeRequestId);
      const inventoryBefore = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.inventory_movements",
      );
      const created = await createFromRequest(
        admin.authUserId,
        activeRequestId,
        "  Replacement Alfa Component  ",
        "  Power Electronics  ",
        activeBrandId,
        "  CaT-083  ",
      );
      expect(created.serial_number).toMatch(/^[0-9]{7}$/);

      const product = await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [created.product_id],
      );
      expect(product.rows).toEqual([expect.objectContaining({
        brand_id: activeBrandId,
        category: "Power Electronics",
        created_by_user_id: admin.profileId,
        is_active: true,
        name: "Replacement Alfa Component",
        product_kind: "component",
        serial_number: created.serial_number,
        updated_by_user_id: admin.profileId,
      })]);
      expect(product.rows[0]?.name).not.toBe(activeBefore.requested_name);

      const relation = await database.query<ProductSupplierRow>(
        `select * from public.product_suppliers
         where product_id = $1::uuid`,
        [created.product_id],
      );
      expect(relation.rows).toEqual([expect.objectContaining({
        catalog_number: "CaT-083",
        created_by_user_id: admin.profileId,
        is_active: true,
        supplier_id: activeSupplierId,
        updated_by_user_id: admin.profileId,
      })]);
      const balance = await database.query<InventoryBalanceRow>(
        "select * from public.inventory_balances where product_id = $1::uuid",
        [created.product_id],
      );
      expect(balance.rows).toEqual([expect.objectContaining({
        product_id: created.product_id,
        quantity: "0",
      })]);
      expect((await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.inventory_movements where product_id = $1::uuid`,
        [created.product_id],
      )).rows).toEqual([{ count: 0 }]);

      const activeAfter = await requestState(activeRequestId);
      expect(activeAfter).toMatchObject({
        created_at: activeBefore.created_at,
        created_by_user_id: activeBefore.created_by_user_id,
        delivered_quantity: activeBefore.delivered_quantity,
        product_id: created.product_id,
        requested_name: activeBefore.requested_name,
        requested_quantity: activeBefore.requested_quantity,
        resolved_at: activeBefore.resolved_at,
        resolved_by_user_id: activeBefore.resolved_by_user_id,
        status: activeBefore.status,
        supplier_id: activeBefore.supplier_id,
        updated_by_user_id: admin.profileId,
      });
      expect(activeAfter.updated_at.getTime()).toBeGreaterThan(
        activeBefore.updated_at.getTime(),
      );

      const audit = await database.query<{
        action_type: string;
        actor_user_id: string;
        after_data: Record<string, unknown>;
        before_data: Record<string, unknown> | null;
        entity_id: string;
      }>(
        `select action_type, actor_user_id, before_data, after_data, entity_id
         from public.audit_logs
         where entity_id = any($1::uuid[])
         order by action_type`,
        [[created.product_id, relation.rows[0]?.id, activeRequestId]],
      );
      expect(audit.rows.map((row) => row.action_type)).toEqual([
        "procurement.product_linked",
        "product_supplier.created",
        "product.created",
      ]);
      expect(audit.rows.every((row) => row.actor_user_id === admin.profileId))
        .toBe(true);
      expect(audit.rows.find((row) =>
        row.action_type === "procurement.product_linked"
      )).toEqual(expect.objectContaining({
        after_data: expect.objectContaining({
          product_id: created.product_id,
          product_serial_number: created.serial_number,
          supplier_id: activeSupplierId,
        }),
        before_data: expect.objectContaining({ product_id: null }),
        entity_id: activeRequestId,
      }));

      const partialBefore = await requestState(partialRequestId);
      const createdWithoutOptionalValues = await createFromRequest(
        admin.authUserId,
        partialRequestId,
        "Snapshot-independent Name",
        "Components",
        null,
        "   ",
      );
      expect((await database.query<ProductRow>(
        "select * from public.products where id = $1::uuid",
        [createdWithoutOptionalValues.product_id],
      )).rows[0]).toMatchObject({ brand_id: null, product_kind: "component" });
      expect((await database.query<ProductSupplierRow>(
        "select * from public.product_suppliers where product_id = $1::uuid",
        [createdWithoutOptionalValues.product_id],
      )).rows[0]).toMatchObject({
        catalog_number: null,
        supplier_id: activeSupplierId,
      });
      expect(await requestState(partialRequestId)).toMatchObject({
        delivered_quantity: partialBefore.delivered_quantity,
        product_id: createdWithoutOptionalValues.product_id,
        requested_name: partialBefore.requested_name,
        requested_quantity: partialBefore.requested_quantity,
        status: "partly_delivered",
        supplier_id: partialBefore.supplier_id,
      });

      const deniedBefore = await requestState(deniedRequestId);
      for (const [index, actor] of [
        fixture.actors.permitted,
        fixture.actors.productCreator,
        fixture.actors.supplierEditor,
        fixture.actors.productEditor,
        fixture.actors.supplierCreator,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ].entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_procurement_product_${index}`);
        await expect(database.query(
          `select * from public.create_product_from_procurement_request(
             $1::uuid, 'Denied Product', 'Components', null, null
           )`,
          [deniedRequestId],
        )).rejects.toMatchObject({ code: "42501" });
        await database.query(
          `rollback to savepoint denied_procurement_product_${index}`,
        );
        await database.query("reset role");
      }
      await database.query("set local role anon");
      await database.query("savepoint anonymous_procurement_product");
      await expect(database.query(
        `select * from public.create_product_from_procurement_request(
           $1::uuid, 'Anonymous Product', 'Components', null, null
         )`,
        [deniedRequestId],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_procurement_product");
      await database.query("reset role");
      expect(await requestState(deniedRequestId)).toEqual(deniedBefore);

      for (const [index, values, code] of [
        [0, [randomUUID(), "Missing Request", "Components", null, null], "P0002"],
        [1, [linkedRequestId, "Linked Request", "Components", null, null], "PRQ05"],
        [2, [resolvedRequestId, "Resolved Request", "Components", null, null], "PRQ02"],
        [3, [archivedSupplierRequestId, "Archived Supplier", "Components", null, null], "PRQ04"],
        [4, [deniedRequestId, "Missing Brand", "Components", randomUUID(), null], "PRD04"],
        [5, [deniedRequestId, "Archived Brand", "Components", archivedBrandId, null], "PRD04"],
        [6, [deniedRequestId, "   ", "Components", null, null], "22023"],
        [7, [deniedRequestId, "Valid Name", "   ", null, null], "22023"],
      ] as const) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [admin.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint invalid_procurement_product_${index}`);
        await expect(database.query(
          `select * from public.create_product_from_procurement_request(
             $1::uuid, $2::text, $3::text, $4::uuid, $5::text
           )`,
          [...values],
        )).rejects.toMatchObject({ code });
        await database.query(
          `rollback to savepoint invalid_procurement_product_${index}`,
        );
        await database.query("reset role");
      }

      await database.query(
        `create function public.test_reject_procurement_product_supplier()
         returns trigger language plpgsql set search_path = ''
         as $test_function$
         begin
           raise exception 'Test ProductSupplier rejection'
             using errcode = 'TST02';
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_reject_procurement_product_supplier
         before insert on public.product_suppliers
         for each row execute function
           public.test_reject_procurement_product_supplier()`,
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint failed_procurement_product_supplier");
      await expect(database.query(
        `select * from public.create_product_from_procurement_request(
           $1::uuid, 'Must Roll Back Product', 'Components', null, null
         )`,
        [productSupplierFailureRequestId],
      )).rejects.toMatchObject({ code: "TST02" });
      await database.query(
        "rollback to savepoint failed_procurement_product_supplier",
      );
      await database.query("reset role");
      expect((await requestState(productSupplierFailureRequestId)).product_id)
        .toBeNull();
      expect((await database.query<CountResultRow>(
        `select count(*)::integer as count from public.products
         where name = 'Must Roll Back Product'`,
      )).rows).toEqual([{ count: 0 }]);
      expect((await database.query<CountResultRow>(
        `select count(*)::integer as count from public.audit_logs
         where summary like '%Must Roll Back Product%'`,
      )).rows).toEqual([{ count: 0 }]);
      await database.query("drop trigger test_reject_procurement_product_supplier on public.product_suppliers");
      await database.query("drop function public.test_reject_procurement_product_supplier()");

      await database.query(
        `create function public.test_reject_procurement_product_link_audit()
         returns trigger language plpgsql set search_path = ''
         as $test_function$
         begin
           if new.action_type = 'procurement.product_linked' then
             raise exception 'Test Procurement Product audit rejection'
               using errcode = 'TST01';
           end if;
           return new;
         end;
         $test_function$`,
      );
      await database.query(
        `create trigger test_reject_procurement_product_link_audit
         before insert on public.audit_logs
         for each row execute function
           public.test_reject_procurement_product_link_audit()`,
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint failed_procurement_product_audit");
      await expect(database.query(
        `select * from public.create_product_from_procurement_request(
           $1::uuid, 'Audit Rollback Product', 'Components', null, null
         )`,
        [auditFailureRequestId],
      )).rejects.toMatchObject({ code: "TST01" });
      await database.query("rollback to savepoint failed_procurement_product_audit");
      await database.query("reset role");
      expect((await requestState(auditFailureRequestId)).product_id).toBeNull();
      expect((await database.query<CountResultRow>(
        `select count(*)::integer as count from public.products
         where name = 'Audit Rollback Product'`,
      )).rows).toEqual([{ count: 0 }]);

      const inventoryAfter = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.inventory_movements",
      );
      expect(inventoryAfter.rows).toEqual(inventoryBefore.rows);

      const security = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        definition: string;
        identity_arguments: string;
        security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.prosecdef as security_definer,
           routine.proconfig as settings,
           pg_catalog.pg_get_function_identity_arguments(routine.oid)
             as identity_arguments,
           pg_catalog.pg_get_functiondef(routine.oid) as definition,
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
           and routine.proname = 'create_product_from_procurement_request'`,
      );
      expect(security.rows).toHaveLength(1);
      expect(security.rows[0]).toMatchObject({
        anonymous_execute: false,
        authenticated_execute: true,
        identity_arguments:
          "p_request_id uuid, p_name text, p_category text, p_brand_id uuid, p_catalog_number text",
        security_definer: true,
        settings: ["search_path=\"\""],
      });
      const definition = security.rows[0]?.definition ?? "";
      expect(definition.toLowerCase()).toContain("for update");
      expect(definition.match(/current_user_is_admin\(\)/g)).toHaveLength(2);
      expect(definition).toContain("public.create_product(");
      expect(definition).toContain("public.create_product_supplier(");
      expect(definition).toContain("procurement.product_linked");
      expect(definition).not.toContain("procurement.view");
      expect(definition).not.toContain("apply_inventory_delta");
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
                 'create_pcb_card', 'update_pcb_card', 'archive_pcb_card',
                 'delete_pcb_card', 'reactivate_pcb_card', 'produce_pcb_card'
               )) as mutation_functions`,
      );
      expect(unsupportedObjects.rows).toEqual([{ bom_tables: 0, mutation_functions: 0 }]);
    });
  });

  it("serializes simultaneous Admin Product creation attempts for the same Procurement request", async () => {
    const fixture = requireHarness();
    const requestId = randomUUID();
    const supplierId = randomUUID();

    await fixture.withDatabaseClients(3, async (clients) => {
      const firstAdmin = clients[0];
      const secondAdmin = clients[1];
      const observer = clients[2];
      if (!firstAdmin || !secondAdmin || !observer) {
        throw new Error("Procurement Product concurrency clients are unavailable");
      }

      await observer.query("begin");
      await observer.query(
        `insert into public.suppliers (
           id, name, country, created_by_user_id, updated_by_user_id
         ) values ($1, 'Concurrent Procurement Product Supplier', 'BiH', $2, $2)`,
        [supplierId, fixture.actors.admin.profileId],
      );
      await observer.query(
        `insert into public.procurement_requests (
           id, requested_name, supplier_id, requested_quantity,
           created_by_user_id, updated_by_user_id
         ) values ($1, 'Concurrent Request Snapshot', $2, 10, $3, $3)`,
        [requestId, supplierId, fixture.actors.admin.profileId],
      );
      await observer.query("commit");

      try {
        await firstAdmin.query("begin");
        await firstAdmin.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await firstAdmin.query("set local role authenticated");
        const firstResult = await firstAdmin.query<{
          product_id: string;
          serial_number: string;
        }>(
          `select * from public.create_product_from_procurement_request(
             $1::uuid, 'Concurrent Product', 'Components', null, null
           )`,
          [requestId],
        );
        expect(firstResult.rows).toEqual([{
          product_id: expect.any(String),
          serial_number: expect.stringMatching(/^[0-9]{7}$/),
        }]);

        await secondAdmin.query("begin");
        const secondBackend = await secondAdmin.query<{ pid: number }>(
          "select pg_catalog.pg_backend_pid()::integer as pid",
        );
        const secondBackendPid = secondBackend.rows[0]?.pid;
        if (!secondBackendPid) {
          throw new Error("Concurrent Procurement Product backend PID is unavailable");
        }
        await secondAdmin.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.actors.admin.authUserId],
        );
        await secondAdmin.query("set local role authenticated");
        const secondResult = secondAdmin.query(
          `select * from public.create_product_from_procurement_request(
             $1::uuid, 'Duplicate Concurrent Product', 'Components', null, null
           )`,
          [requestId],
        ).then(
          () => null,
          (error: unknown) => error,
        );

        let observedRequestLockWait = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = await observer.query<ActivityWaitRow>(
            `select wait_event_type, wait_event
             from pg_catalog.pg_stat_activity
             where pid = $1::integer`,
            [secondBackendPid],
          );
          if (activity.rows[0]?.wait_event_type === "Lock") {
            observedRequestLockWait = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(observedRequestLockWait).toBe(true);

        await firstAdmin.query("commit");
        expect(await secondResult).toMatchObject({ code: "PRQ05" });
        await secondAdmin.query("rollback");

        const finalState = await observer.query<{
          audit_count: number;
          balance_count: number;
          movement_count: number;
          product_count: number;
          product_id: string;
          relation_count: number;
        }>(
          `select
             request.product_id,
             (select count(*)::integer from public.products as product
              where product.id = request.product_id) as product_count,
             (select count(*)::integer from public.product_suppliers as relation
              where relation.product_id = request.product_id
                and relation.supplier_id = request.supplier_id) as relation_count,
             (select count(*)::integer from public.inventory_balances as balance
              where balance.product_id = request.product_id) as balance_count,
             (select count(*)::integer from public.inventory_movements as movement
              where movement.product_id = request.product_id) as movement_count,
             (select count(*)::integer from public.audit_logs as audit
              where audit.action_type in (
                'product.created', 'product_supplier.created',
                'procurement.product_linked'
              ) and (
                audit.entity_id = request.id
                or audit.entity_id = request.product_id
                or audit.entity_id in (
                  select relation.id from public.product_suppliers as relation
                  where relation.product_id = request.product_id
                )
              )) as audit_count
           from public.procurement_requests as request
           where request.id = $1::uuid`,
          [requestId],
        );
        expect(finalState.rows).toEqual([{
          audit_count: 3,
          balance_count: 1,
          movement_count: 0,
          product_count: 1,
          product_id: firstResult.rows[0]?.product_id,
          relation_count: 1,
        }]);
      } finally {
        await firstAdmin.query("rollback");
        await secondAdmin.query("rollback");
        await observer.query("begin");
        await observer.query("set local session_replication_role = replica");
        await observer.query(
          `delete from public.audit_logs
           where entity_id = $1::uuid
              or entity_id in (
                select product_id from public.procurement_requests where id = $1::uuid
              )
              or entity_id in (
                select relation.id from public.product_suppliers as relation
                join public.procurement_requests as request
                  on request.product_id = relation.product_id
                where request.id = $1::uuid
              )`,
          [requestId],
        );
        await observer.query(
          `delete from public.product_suppliers
           where product_id in (
             select product_id from public.procurement_requests where id = $1::uuid
           )`,
          [requestId],
        );
        await observer.query(
          "delete from public.procurement_requests where id = $1::uuid",
          [requestId],
        );
        await observer.query(
          `delete from public.inventory_balances
           where product_id in (
             select id from public.products
             where name = 'Concurrent Product'
           )`,
        );
        await observer.query(
          "delete from public.products where name = 'Concurrent Product'",
        );
        await observer.query(
          "delete from public.suppliers where id = $1::uuid",
          [supplierId],
        );
        await observer.query("commit");
      }
    });
  });
});
