import { randomUUID } from "node:crypto";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

      expect(duplicateGrant.rows).toEqual([{ granted: true }]);
      expect(duplicateRevoke.rows).toEqual([{ granted: false }]);
      expect(auditAfterGrant.rows).toEqual([{ count: 1 }]);
      expect(auditAfterDuplicateGrant.rows).toEqual(auditAfterGrant.rows);
      expect(auditAfterRevoke.rows).toEqual([{ count: 1 }]);
      expect(auditAfterDuplicateRevoke.rows).toEqual(auditAfterRevoke.rows);
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
});
