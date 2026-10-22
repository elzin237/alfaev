import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

interface AuthoritySnapshotRow extends QueryResultRow {
  audits: unknown;
  permissions: unknown;
  profiles: unknown;
  revisions: unknown;
}

interface ActivityWaitRow extends QueryResultRow {
  wait_event: string | null;
  wait_event_type: string | null;
}

const expectedDelegablePermissionKeys = [
  "dashboard.view",
  "projects.view",
  "projects.create",
  "projects.edit",
  "projects.archive",
  "projects.alerts.receive",
  "projects.alerts.send",
  "procurement.view",
  "procurement.create",
  "procurement.edit",
  "procurement.change_status",
  "procurement.resolve",
  "suppliers.view",
  "suppliers.create",
  "suppliers.edit",
  "suppliers.archive",
  "inventory.view",
  "inventory.raw_materials.view",
  "inventory.raw_materials.adjust",
  "inventory.finished_goods.view",
  "inventory.finished_goods.adjust",
  "inventory.customs.view",
  "inventory.customs.adjust",
  "inventory.products.create",
  "inventory.products.edit",
  "inventory.brands.manage",
  "inventory.barcodes.generate",
  "pcb.view",
  "pcb.create",
  "pcb.edit",
  "pcb.produce",
  "pcb.archive",
  "work_orders.view",
  "work_orders.create",
  "work_orders.edit_draft",
  "work_orders.finish",
  "work_orders.delete_draft",
  "archive.view",
] as const;

const adminRpcAttacks = (
  client: SupabaseClient,
  actor: SecurityActor,
  target: SecurityActor,
) => [
  client.rpc("list_users_admin"),
  client.rpc("get_user_admin", { p_user_id: target.profileId }),
  client.rpc("resolve_user_auth_identity_admin", {
    p_user_id: target.profileId,
  }),
  client.rpc("get_user_permissions_admin", { p_user_id: target.profileId }),
  client.rpc("update_user_profile_admin", {
    p_user_id: target.profileId,
    p_full_name: "Escalated User",
    p_email: "escalated@example.com",
    p_birthday: "1990-01-01",
  }),
  client.rpc("preflight_user_active_state_admin", {
    p_user_id: target.profileId,
    p_is_active: true,
  }),
  client.rpc("set_user_active_state_admin", {
    p_user_id: target.profileId,
    p_is_active: true,
  }),
  client.rpc("set_user_admin_status_admin", {
    p_user_id: actor.profileId,
    p_is_admin: true,
  }),
  client.rpc("set_user_permission_admin", {
    p_user_id: actor.profileId,
    p_permission_key: "dashboard.view",
    p_granted: true,
  }),
  client.rpc("save_user_permissions_admin", {
    p_user_id: actor.profileId,
    p_expected_permission_keys: [],
    p_desired_permission_keys: ["dashboard.view"],
  }),
  client.rpc("create_user_profile_admin", {
    p_auth_user_id: target.authUserId,
    p_full_name: "Replacement User",
    p_email: "replacement@example.com",
    p_birthday: "1990-01-01",
    p_is_admin: true,
  }),
];

async function readAuthoritySnapshot(
  database: PoolClient,
  profileIds: readonly string[],
): Promise<AuthoritySnapshotRow> {
  const snapshot = await database.query<AuthoritySnapshotRow>(
    `select
       (
         select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', profile.id,
               'is_active', profile.is_active,
               'is_admin', profile.is_admin,
               'deactivated_at', profile.deactivated_at,
               'deactivated_by_user_id', profile.deactivated_by_user_id
             ) order by profile.id
           ),
           '[]'::jsonb
         )
         from public.user_profiles as profile
         where profile.id = any($1::uuid[])
       ) as profiles,
       (
         select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'user_id', permission.user_id,
               'permission_key', definition.key,
               'granted_by_user_id', permission.granted_by_user_id
             ) order by permission.user_id, definition.key
           ),
           '[]'::jsonb
         )
         from public.user_permissions as permission
         join public.permission_definitions as definition
           on definition.id = permission.permission_definition_id
         where permission.user_id = any($1::uuid[])
       ) as permissions,
       (
         select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'user_id', revision.user_id,
               'revision', revision.revision,
               'updated_at', revision.updated_at
             ) order by revision.user_id
           ),
           '[]'::jsonb
         )
         from public.user_permission_revisions as revision
         where revision.user_id = any($1::uuid[])
       ) as revisions,
       (
         select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', audit.id,
               'actor_user_id', audit.actor_user_id,
               'action_type', audit.action_type,
               'entity_id', audit.entity_id
             ) order by audit.id
           ),
           '[]'::jsonb
         )
         from public.audit_logs as audit
         where audit.entity_id = any($1::uuid[])
           and audit.action_type in (
             'permission.granted',
             'permission.revoked',
             'user.created',
             'user.updated',
             'user.reactivated',
             'user.deactivated',
             'user.promoted_to_admin',
             'user.demoted_from_admin'
           )
       ) as audits`,
    [profileIds],
  );

  const row = snapshot.rows[0];

  if (!row) throw new Error("Authority snapshot returned no row");
  return row;
}

async function setActor(database: PoolClient, actor: SecurityActor): Promise<void> {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor.authUserId],
  );
  await database.query("set local role authenticated");
}

export function registerPermissionEscalationAttackTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 146 permission escalation attack tests", () => {
    it("denies every direct authority-table write path and preserves state", async () => {
      const fixture = requireHarness();
      const attacker = fixture.actors.brandManager;
      const target = fixture.actors.unpermitted;
      const inactiveTarget = fixture.actors.inactiveBrandManager;
      const profileIds = [attacker.profileId, target.profileId, inactiveTarget.profileId];

      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const before = await readAuthoritySnapshot(database, profileIds);
        const definition = await database.query<{ id: string }>(
          `select id
           from public.permission_definitions
           where key = 'work_orders.finish'`,
        );
        const permissionDefinitionId = definition.rows[0]?.id;

        if (!permissionDefinitionId) {
          throw new Error("Canonical work_orders.finish permission is missing");
        }

        const attacks = [
          attacker.client.from("user_permissions").insert({
            user_id: attacker.profileId,
            permission_definition_id: permissionDefinitionId,
            granted_by_user_id: attacker.profileId,
          }),
          attacker.client.from("user_permissions").insert({
            user_id: target.profileId,
            permission_definition_id: permissionDefinitionId,
            granted_by_user_id: attacker.profileId,
          }),
          attacker.client.from("user_permissions").update({
            granted_by_user_id: attacker.profileId,
          }).eq("user_id", target.profileId),
          attacker.client.from("user_permissions").delete()
            .eq("user_id", target.profileId),
          attacker.client.from("user_permission_revisions").insert({
            user_id: attacker.profileId,
            revision: 9_999,
            updated_at: new Date().toISOString(),
          }),
          attacker.client.from("user_permission_revisions").update({
            revision: 9_999,
          }).eq("user_id", attacker.profileId),
          attacker.client.from("user_permission_revisions").delete()
            .eq("user_id", attacker.profileId),
          attacker.client.from("permission_definitions").update({
            is_delegable: true,
          }).eq("key", "dashboard.view"),
          attacker.client.from("user_profiles").upsert({
            id: attacker.profileId,
            auth_user_id: attacker.authUserId,
            full_name: "Escalated replacement",
            email: `task146-${randomUUID()}@example.com`,
            birthday: "1990-01-01",
            is_admin: true,
            is_active: true,
            created_by_user_id: attacker.profileId,
          }, { onConflict: "id" }),
          attacker.client.from("user_profiles").update({ is_admin: true })
            .eq("id", attacker.profileId),
          attacker.client.from("user_profiles").update({ is_admin: true })
            .eq("id", target.profileId),
          attacker.client.from("user_profiles").update({ is_active: true })
            .eq("id", inactiveTarget.profileId),
        ];

        for (const attack of attacks) {
          expectPermissionDenied((await attack).error);
        }

        for (const client of [
          fixture.actors.inactiveBrandManager.client,
          fixture.anonymousClient,
        ]) {
          expectPermissionDenied((await client.from("user_permissions").insert({
            user_id: target.profileId,
            permission_definition_id: permissionDefinitionId,
            granted_by_user_id: attacker.profileId,
          })).error);
          expectPermissionDenied((await client.from("user_profiles").update({
            is_active: true,
            is_admin: true,
          }).eq("id", target.profileId)).error);
        }

        expect(await readAuthoritySnapshot(database, profileIds)).toEqual(before);
      });
    });

    it("denies self-grant, target swapping, malformed, replay, and every permission class through RPCs", async () => {
      const fixture = requireHarness();
      const attacker = fixture.actors.brandManager;
      const activeTarget = fixture.actors.unpermitted;
      const inactiveTarget = fixture.actors.inactiveBrandManager;

      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const profileIds = [
          attacker.profileId,
          activeTarget.profileId,
          inactiveTarget.profileId,
        ];
        const before = await readAuthoritySnapshot(database, profileIds);
        const definitions = await database.query<{ key: string }>(
          `select key
           from public.permission_definitions
           where is_delegable
           order by key`,
        );
        const permissionKeys = definitions.rows.map((row) => row.key);

        expect(permissionKeys).toHaveLength(38);
        expect(new Set(permissionKeys)).toEqual(
          new Set(expectedDelegablePermissionKeys),
        );

        for (const permissionKey of permissionKeys) {
          for (const target of [attacker, activeTarget, inactiveTarget]) {
            const result = await attacker.client.rpc(
              "set_user_permission_admin",
              {
                p_user_id: target.profileId,
                p_permission_key: permissionKey,
                p_granted: true,
              },
            );

            expectPermissionDenied(result.error);
          }
        }

        const replayPayload = {
          p_user_id: activeTarget.profileId,
          p_permission_key: "work_orders.finish",
          p_granted: true,
        };
        const firstReplay = await attacker.client.rpc(
          "set_user_permission_admin",
          replayPayload,
        );
        const secondReplay = await attacker.client.rpc(
          "set_user_permission_admin",
          replayPayload,
        );

        expectPermissionDenied(firstReplay.error);
        expectPermissionDenied(secondReplay.error);

        for (const result of await Promise.all([
          attacker.client.rpc("set_user_permission_admin", {
            p_user_id: randomUUID(),
            p_permission_key: "unknown.permission",
            p_granted: true,
          }),
          attacker.client.rpc("set_user_permission_admin", {
            p_user_id: attacker.profileId,
            p_permission_key: "   ",
            p_granted: true,
          }),
          attacker.client.rpc("save_user_permissions_admin", {
            p_user_id: attacker.profileId,
            p_expected_permission_keys: [],
            p_desired_permission_keys: ["dashboard.view", "dashboard.view"],
          }),
          attacker.client.rpc("save_user_permissions_admin", {
            p_user_id: activeTarget.profileId,
            p_expected_permission_keys: [],
            p_desired_permission_keys: permissionKeys,
          }),
          fixture.actors.inactiveBrandManager.client.rpc(
            "set_user_permission_admin",
            {
              p_user_id: activeTarget.profileId,
              p_permission_key: "dashboard.view",
              p_granted: true,
            },
          ),
        ])) {
          expectPermissionDenied(result.error);
        }

        expect(await readAuthoritySnapshot(database, profileIds)).toEqual(before);
      });
    });

    it("denies manual Admin, activation, profile, and Users RPC bypasses for every non-Admin actor class", async () => {
      const fixture = requireHarness();
      const target = fixture.actors.unpermitted;
      const profileIds = [
        fixture.actors.brandManager.profileId,
        fixture.actors.unpermitted.profileId,
        fixture.actors.inactiveBrandManager.profileId,
      ];

      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const before = await readAuthoritySnapshot(database, profileIds);

        for (const actor of [
          fixture.actors.unpermitted,
          fixture.actors.brandManager,
          fixture.actors.inactiveBrandManager,
        ]) {
          for (const attack of adminRpcAttacks(actor.client, actor, target)) {
            expectPermissionDenied((await attack).error);
          }
        }

        for (const attack of adminRpcAttacks(
          fixture.anonymousClient,
          fixture.actors.unpermitted,
          target,
        )) {
          expectPermissionDenied((await attack).error);
        }

        expect(await readAuthoritySnapshot(database, profileIds)).toEqual(before);
      });
    });

    it("prevents direct and trusted-read exfiltration while keeping only canonical narrow feeds", async () => {
      const fixture = requireHarness();
      const attacker = fixture.actors.unpermitted;
      const target = fixture.actors.admin;

      const otherProfile = await attacker.client.from("user_profiles")
        .select("*")
        .eq("id", target.profileId);
      const ownProfile = await attacker.client.from("user_profiles")
        .select("id,auth_user_id,email,full_name,birthday,is_admin,is_active")
        .eq("id", attacker.profileId)
        .single();
      const permissions = await attacker.client.from("user_permissions")
        .select("*");
      const definitions = await attacker.client.from("permission_definitions")
        .select("*");
      const otherRevision = await attacker.client
        .from("user_permission_revisions")
        .select("*")
        .eq("user_id", target.profileId);
      const birthdays = await attacker.client.rpc("list_calendar_birthdays");

      expect(otherProfile.error).toBeNull();
      expect(otherProfile.data).toEqual([]);
      expect(ownProfile.error).toBeNull();
      expect(ownProfile.data).toEqual(expect.objectContaining({
        id: attacker.profileId,
        auth_user_id: attacker.authUserId,
        is_admin: false,
        is_active: true,
      }));
      expectPermissionDenied(permissions.error);
      expectPermissionDenied(definitions.error);
      expect(otherRevision.error).toBeNull();
      expect(otherRevision.data).toEqual([]);
      expect(birthdays.error).toBeNull();
      expect(Array.isArray(birthdays.data)).toBe(true);
      for (const row of birthdays.data ?? []) {
        expect(Object.keys(row).sort()).toEqual([
          "birthday",
          "full_name",
          "user_id",
        ]);
      }

      for (const attack of adminRpcAttacks(attacker.client, attacker, target)) {
        expectPermissionDenied((await attack).error);
      }
    });

    it("hardens authenticated SECURITY DEFINER authority boundaries and nested helpers", async () => {
      const fixture = requireHarness();

      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const adminFunctions = [
          "create_user_profile_admin",
          "get_user_admin",
          "get_user_permissions_admin",
          "list_users_admin",
          "preflight_user_active_state_admin",
          "resolve_user_auth_identity_admin",
          "save_user_permissions_admin",
          "set_user_active_state_admin",
          "set_user_admin_status_admin",
          "set_user_permission_admin",
          "update_user_profile_admin",
        ];
        const metadata = await database.query<{
          anonymous_execute: boolean;
          authenticated_execute: boolean;
          function_name: string;
          public_execute: boolean;
          security_definer: boolean;
          settings: string[] | null;
        }>(
          `select
             routine.proname as function_name,
             routine.prosecdef as security_definer,
             routine.proconfig as settings,
             exists (
               select 1
               from pg_catalog.aclexplode(
                 coalesce(
                   routine.proacl,
                   pg_catalog.acldefault('f', routine.proowner)
                 )
               ) as acl
               where acl.grantee = 0
                 and acl.privilege_type = 'EXECUTE'
             ) as public_execute,
             pg_catalog.has_function_privilege(
               'anon', routine.oid, 'EXECUTE'
             ) as anonymous_execute,
             pg_catalog.has_function_privilege(
               'authenticated', routine.oid, 'EXECUTE'
             ) as authenticated_execute
           from pg_catalog.pg_proc as routine
           join pg_catalog.pg_namespace as namespace
             on namespace.oid = routine.pronamespace
           where namespace.nspname = 'public'
             and routine.proname = any($1::text[])
           order by routine.proname`,
          [adminFunctions],
        );

        expect(metadata.rows.map((row) => row.function_name)).toEqual(
          [...adminFunctions].sort(),
        );
        for (const routine of metadata.rows) {
          expect(routine).toMatchObject({
            anonymous_execute: false,
            authenticated_execute: true,
            public_execute: false,
            security_definer: true,
            settings: ['search_path=""'],
          });
        }

        const internalHelpers = await database.query<{
          anonymous_execute: boolean;
          authenticated_execute: boolean;
          function_name: string;
          public_execute: boolean;
        }>(
          `select
             routine.proname as function_name,
             exists (
               select 1
               from pg_catalog.aclexplode(
                 coalesce(
                   routine.proacl,
                   pg_catalog.acldefault('f', routine.proowner)
                 )
               ) as acl
               where acl.grantee = 0
                 and acl.privilege_type = 'EXECUTE'
             ) as public_execute,
             pg_catalog.has_function_privilege(
               'anon', routine.oid, 'EXECUTE'
             ) as anonymous_execute,
             pg_catalog.has_function_privilege(
               'authenticated', routine.oid, 'EXECUTE'
             ) as authenticated_execute
           from pg_catalog.pg_proc as routine
           join pg_catalog.pg_namespace as namespace
             on namespace.oid = routine.pronamespace
           where namespace.nspname = 'public'
             and routine.proname = any($1::text[])
           order by routine.proname`,
          [[
            "append_audit_log",
            "enforce_delegable_permission_grant",
            "prevent_granted_permission_from_becoming_non_delegable",
            "touch_user_permission_revision",
          ]],
        );

        expect(internalHelpers.rows).toHaveLength(4);
        for (const helper of internalHelpers.rows) {
          expect(helper).toMatchObject({
            anonymous_execute: false,
            authenticated_execute: false,
            public_execute: false,
          });
        }

        const recheckedFunctions = await database.query<{
          definition: string;
          function_name: string;
        }>(
          `select
             routine.proname as function_name,
             pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
               as definition
           from pg_catalog.pg_proc as routine
           join pg_catalog.pg_namespace as namespace
             on namespace.oid = routine.pronamespace
           where namespace.nspname = 'public'
             and routine.proname = any($1::text[])
           order by routine.proname`,
          [[
            "preflight_user_active_state_admin",
            "save_user_permissions_admin",
            "set_user_active_state_admin",
            "set_user_admin_status_admin",
            "set_user_permission_admin",
          ]],
        );

        for (const routine of recheckedFunctions.rows) {
          expect(
            routine.definition.match(/current_user_is_admin\(\)/g),
            routine.function_name,
          ).toHaveLength(2);
          expect(routine.definition).toContain("alfaev.active_admin_continuity");
        }
      });

      for (const client of [
        fixture.actors.brandManager.client,
        fixture.actors.inactiveBrandManager.client,
        fixture.anonymousClient,
      ]) {
        expectPermissionDenied((await client.rpc(
          "touch_user_permission_revision",
          { p_user_id: fixture.actors.brandManager.profileId },
        )).error);
      }
    });

    it("rechecks authority after the continuity lock and rejects a demoted waiting actor", async () => {
      const fixture = requireHarness();
      const waitingAdmin = await fixture.createTemporaryProfile(
        "task146-waiting-admin",
        undefined,
        fixture.actors.admin.profileId,
        { isAdmin: true },
      );
      const target = fixture.actors.unpermitted;
      const applicationName = `alfaev-task146-wait-${randomUUID()}`;

      await fixture.withDatabaseClients(3, async (clients) => {
        const lockHolder = clients[0];
        const waitingActor = clients[1];
        const observer = clients[2];

        if (!lockHolder || !waitingActor || !observer) {
          throw new Error("Task 146 concurrency clients are unavailable");
        }

        const before = await readAuthoritySnapshot(observer, [target.profileId]);
        await lockHolder.query("begin");
        await lockHolder.query(
          `select pg_catalog.pg_advisory_xact_lock(
             pg_catalog.hashtextextended('alfaev.active_admin_continuity', 0)
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
        const waitingMutation = waitingActor.query(
          `select public.set_user_permission_admin(
             $1::uuid,
             'work_orders.finish',
             true
           )`,
          [target.profileId],
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

          if (
            waiting?.wait_event_type === "Lock" &&
            waiting.wait_event?.toLowerCase() === "advisory"
          ) {
            observedWait = true;
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        expect(observedWait).toBe(true);
        await lockHolder.query(
          "update public.user_profiles set is_admin = false where id = $1::uuid",
          [waitingAdmin.profileId],
        );
        await lockHolder.query("commit");

        expect(await waitingMutation).toMatchObject({ code: "42501" });
        await waitingActor.query("rollback");
        expect(await readAuthoritySnapshot(observer, [target.profileId]))
          .toEqual(before);
      });
    });

    it("keeps legitimate Admin authority operations functional and audited", async () => {
      const fixture = requireHarness();
      const target = fixture.actors.unpermitted;

      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const before = await readAuthoritySnapshot(database, [target.profileId]);
        await setActor(database, fixture.actors.admin);
        await database.query(
          "select public.set_user_permission_admin($1::uuid, 'projects.create', true)",
          [target.profileId],
        );
        await database.query(
          "select public.set_user_admin_status_admin($1::uuid, true)",
          [target.profileId],
        );
        await database.query(
          "select public.set_user_admin_status_admin($1::uuid, false)",
          [target.profileId],
        );
        await database.query(
          "select public.set_user_active_state_admin($1::uuid, false)",
          [target.profileId],
        );
        await database.query(
          "select public.set_user_active_state_admin($1::uuid, true)",
          [target.profileId],
        );
        await database.query(
          "select public.set_user_permission_admin($1::uuid, 'projects.create', false)",
          [target.profileId],
        );
        await database.query("reset role");

        const after = await readAuthoritySnapshot(database, [target.profileId]);
        const actionTypes = await database.query<{ action_type: string }>(
          `select action_type
           from public.audit_logs
           where entity_id = $1::uuid
             and action_type in (
               'permission.granted',
               'permission.revoked',
               'user.reactivated',
               'user.deactivated',
               'user.promoted_to_admin',
               'user.demoted_from_admin'
             )
           order by action_type`,
          [target.profileId],
        );

        expect(after.profiles).toEqual(before.profiles);
        expect(after.permissions).toEqual(before.permissions);
        expect(actionTypes.rows.map((row) => row.action_type)).toEqual([
          "permission.granted",
          "permission.revoked",
          "user.deactivated",
          "user.demoted_from_admin",
          "user.promoted_to_admin",
          "user.reactivated",
        ]);
      });
    });
  });
}
