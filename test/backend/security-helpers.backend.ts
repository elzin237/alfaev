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
      .update({ full_name: "Forbidden update" })
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

    expectPermissionDenied(profileMutation.error);
    expectPermissionDenied(permissionDefinitionMutation.error);
    expectPermissionDenied(permissionGrantMutation.error);
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
});
