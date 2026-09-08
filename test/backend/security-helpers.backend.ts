import { randomUUID } from "node:crypto";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
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
});
