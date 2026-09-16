import { expect, it } from "vitest";
import { expectPermissionDenied, expectAdminStatus, expectPermission } from "./helpers/assertions";
import type { SecurityFixtureHarness } from "./security-fixtures";

export function registerAuthTests(requireHarness: () => SecurityFixtureHarness): void {
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

}
