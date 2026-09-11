import { randomUUID } from "node:crypto";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PERMISSION_KEYS } from "../../app/auth/permissions";
import { loadBackendTestEnvironment } from "./env";
import {
  createSecurityFixtureHarness,
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

interface CreatedProductRow {
  product_id: string;
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
         order by created_at`,
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
         order by created_at`,
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
         order by created_at`,
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
      expect(stockTable.rows).toEqual([{ count: 0 }]);
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
         order by created_at`,
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
});
