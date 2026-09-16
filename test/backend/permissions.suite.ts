import { expect, it } from "vitest";
import { PERMISSION_KEYS } from "../../app/auth/permissions";
import { expectPermissionDenied, isRecord } from "./helpers/assertions";
import type { SecurityFixtureHarness } from "./security-fixtures";

interface CountResultRow {
  count: number;
}

interface AdminStatusProfileRow {
  is_active: boolean;
  is_admin: boolean;
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

export function registerPermissionsTests(requireHarness: () => SecurityFixtureHarness): void {
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

}
