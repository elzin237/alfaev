import { randomUUID } from "node:crypto";

import type {
  RealtimeChannel,
  SupabaseClient,
} from "@supabase/supabase-js";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const topicFor = (profileId: string) =>
  `project-alert-notifications:${profileId}`;

async function setPermissions(
  database: PoolClient,
  userId: string,
  grantedByUserId: string,
  keys: readonly string[],
) {
  await database.query(
    `delete from public.user_permissions as permission
     using public.permission_definitions as definition
     where definition.id = permission.permission_definition_id
       and permission.user_id = $1::uuid
       and definition.key in ('dashboard.view', 'projects.view')`,
    [userId],
  );
  if (keys.length === 0) return;
  await database.query(
    `insert into public.user_permissions (
       user_id, permission_definition_id, granted_by_user_id
     )
     select $1::uuid, definition.id, $2::uuid
     from public.permission_definitions as definition
     where definition.key = any($3::text[])
     on conflict (user_id, permission_definition_id) do nothing`,
    [userId, grantedByUserId, keys],
  );
}

async function setRealtimeAuth(client: SupabaseClient) {
  const { data, error } = await client.auth.getSession();
  expect(error).toBeNull();
  expect(data.session?.access_token).toBeTruthy();
  await client.realtime.setAuth(data.session!.access_token);
}

async function subscribe(
  client: SupabaseClient,
  topic: string,
  onInvalidate?: (payload: unknown) => void,
  receiveOwnBroadcasts = false,
): Promise<RealtimeChannel> {
  await setRealtimeAuth(client);
  return await new Promise<RealtimeChannel>((resolve, reject) => {
    let channel: RealtimeChannel;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      void client.removeChannel(channel);
      reject(new Error(`Realtime subscription timed out for ${topic}`));
    }, 8_000);

    channel = client
      .channel(topic, {
        config: {
          private: true,
          broadcast: receiveOwnBroadcasts
            ? { ack: true, self: true }
            : undefined,
        },
      })
      .on("broadcast", { event: "invalidate" }, (message) => {
        onInvalidate?.(message.payload);
      })
      .subscribe((status, error) => {
        if (settled) return;
        if (status === "SUBSCRIBED") {
          settled = true;
          clearTimeout(timeout);
          resolve(channel);
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          settled = true;
          clearTimeout(timeout);
          reject(error ?? new Error(`Realtime subscription denied: ${status}`));
          setTimeout(() => void client.removeChannel(channel), 0);
        }
      });
  });
}

async function expectSubscriptionDenied(
  client: SupabaseClient,
  topic: string,
) {
  await expect(subscribe(client, topic)).rejects.toBeTruthy();
}

async function waitForLength(values: readonly unknown[], expected: number) {
  const deadline = Date.now() + 5_000;
  while (values.length < expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(values).toHaveLength(expected);
}

async function expectNoNewEvent(values: readonly unknown[]) {
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(values).toHaveLength(0);
}

function expectTransportPayloads(values: readonly unknown[], expected: number) {
  expect(values).toHaveLength(expected);
  for (const value of values) {
    expect(value).toEqual({ id: expect.any(String) });
    expect(Object.keys(value as object)).toEqual(["id"]);
    expect((value as { id: string }).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  }
}

async function insertNotification(
  database: PoolClient,
  actorId: string,
  recipientId: string,
) {
  const projectId = randomUUID();
  const activityId = randomUUID();
  const alertId = randomUUID();
  const notificationId = randomUUID();

  await database.query(
    `insert into public.projects (
       id, name, customer_name, status, start_date, delivery_date,
       created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, 'Task 001C1 Customer', 'planned',
       '2026-10-20'::date, '2026-11-20'::date, $3::uuid, $3::uuid
     )`,
    [projectId, `Task 001C1 Project ${projectId}`, actorId],
  );
  await database.query(
    `insert into public.project_activity_updates (
       id, project_id, author_user_id, request_id, title, description
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       'Task 001C1 Activity', 'Task 001C1 content-free invalidation proof'
     )`,
    [activityId, projectId, actorId, randomUUID()],
  );
  await database.query(
    `insert into public.project_activity_alerts (
       id, project_activity_id, sent_by_user_id
     ) values ($1::uuid, $2::uuid, $3::uuid)`,
    [alertId, activityId, actorId],
  );
  await database.query(
    `insert into public.project_activity_alert_recipients (
       id, alert_id, recipient_user_id
     ) values ($1::uuid, $2::uuid, $3::uuid)`,
    [notificationId, alertId, recipientId],
  );

  return { notificationId };
}

async function expectRpcSuccess(
  actor: SecurityActor,
  name: "dismiss_project_alert_notification" | "mark_project_alert_read",
  notificationId: string,
) {
  const { error } = await actor.client.rpc(name, {
    p_notification_id: notificationId,
  });
  expect(error).toBeNull();
}

export function registerProjectAlertRealtimeInvalidationTests(
  requireHarness: () => SecurityFixtureHarness,
) {
  describe.skipIf(
    process.env.PROJECT_ALERT_REALTIME_INVALIDATION !== "1" ||
      process.env.SUPABASE_LOCAL_TEST !== "1",
  )("Task 001C1 private Realtime alert invalidation (local only)", () => {
    it("has the exact trigger, helper, policy, ACL, and unchanged table boundary", async () => {
      const fixture = requireHarness();
      await fixture.withRollbackDatabaseTransaction(async (database) => {
        const helper = (await database.query(
          `select
             pg_catalog.pg_get_function_identity_arguments(routine.oid) as arguments,
             pg_catalog.pg_get_function_result(routine.oid) as result_type,
             routine.prosecdef as security_definer,
             routine.provolatile as volatility,
             routine.proconfig as settings,
             pg_catalog.has_function_privilege('public', routine.oid, 'execute') as public_execute,
             pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anon_execute,
             pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
             pg_catalog.has_function_privilege('service_role', routine.oid, 'execute') as service_role_execute
           from pg_catalog.pg_proc as routine
           join pg_catalog.pg_namespace as namespace
             on namespace.oid = routine.pronamespace
           where namespace.nspname = 'public'
             and routine.proname = 'broadcast_project_alert_notification_invalidation'`,
        )).rows;
        expect(helper).toEqual([{
          arguments: "",
          result_type: "trigger",
          security_definer: true,
          volatility: "v",
          settings: ['search_path=""'],
          public_execute: false,
          anon_execute: false,
          authenticated_execute: false,
          service_role_execute: false,
        }]);

        const trigger = (await database.query(
          `select
             trigger.tgname as trigger_name,
             pg_catalog.pg_get_triggerdef(trigger.oid) as definition
           from pg_catalog.pg_trigger as trigger
           where trigger.tgrelid =
               'public.project_activity_alert_recipients'::pg_catalog.regclass
             and not trigger.tgisinternal
             and trigger.tgname =
               'broadcast_project_alert_notification_invalidation'`,
        )).rows;
        expect(trigger).toHaveLength(1);
        expect(trigger[0].definition).toContain(
          "AFTER INSERT OR UPDATE OF read_at, dismissed_at",
        );

        const policies = (await database.query(
          `select policyname, cmd, pg_catalog.to_jsonb(roles) as roles,
             qual, with_check
           from pg_catalog.pg_policies
           where schemaname = 'realtime'
             and tablename = 'messages'
           order by policyname`,
        )).rows;
        expect(policies).toHaveLength(1);
        expect(policies[0]).toMatchObject({
          policyname: "project_alert_notification_invalidation_select_own",
          cmd: "SELECT",
          roles: ["authenticated"],
          with_check: null,
        });
        expect(policies[0].qual).toContain("extension = 'broadcast'");
        expect(policies[0].qual).toContain("realtime.topic()");
        expect(policies[0].qual).toContain("current_active_user_profile_id()");
        expect(policies[0].qual).toContain("dashboard.view");
        expect(policies[0].qual).toContain("projects.view");
      });

      const { error } = await fixture.actors.admin.client
        .from("project_activity_alert_recipients")
        .select("id")
        .limit(1);
      expect(error).toBeTruthy();
    });

    it("authorizes only active owners with current Dashboard and Project access", async () => {
      const fixture = requireHarness();
      const { admin, brandManager, inactive, permitted, unpermitted } =
        fixture.actors;
      await fixture.withDatabaseClients(1, async ([database]) => {
        await setPermissions(database!, brandManager.profileId, admin.profileId, [
          "dashboard.view",
          "projects.view",
        ]);
        await setPermissions(database!, permitted.profileId, admin.profileId, [
          "projects.view",
        ]);
        await setPermissions(database!, unpermitted.profileId, admin.profileId, [
          "dashboard.view",
        ]);
      });

      const clientSendPayloads: unknown[] = [];
      const adminChannel = await subscribe(
        admin.client,
        topicFor(admin.profileId),
        (payload) => clientSendPayloads.push(payload),
        true,
      );
      const permittedChannel = await subscribe(
        brandManager.client,
        topicFor(brandManager.profileId),
      );
      try {
        await Promise.all([
          expectSubscriptionDenied(admin.client, topicFor(brandManager.profileId)),
          expectSubscriptionDenied(permitted.client, topicFor(permitted.profileId)),
          expectSubscriptionDenied(
            unpermitted.client,
            topicFor(unpermitted.profileId),
          ),
          expectSubscriptionDenied(inactive.client, topicFor(inactive.profileId)),
          expectSubscriptionDenied(
            fixture.anonymousClient,
            topicFor(admin.profileId),
          ),
        ]);

        await adminChannel.send({
          type: "broadcast",
          event: "invalidate",
          payload: {},
        });
        await expectNoNewEvent(clientSendPayloads);
      } finally {
        await admin.client.removeChannel(adminChannel);
        await brandManager.client.removeChannel(permittedChannel);
      }
    }, 30_000);

    it("broadcasts content-free insert/read/dismiss changes without retry or rollback noise", async () => {
      const fixture = requireHarness();
      const actor = fixture.actors.admin;
      const payloads: unknown[] = [];
      const channel = await subscribe(
        actor.client,
        topicFor(actor.profileId),
        (payload) => payloads.push(payload),
      );

      try {
        const notification = await fixture.withDatabaseClients(
          1,
          async ([database]) =>
            await insertNotification(database!, actor.profileId, actor.profileId),
        );
        await waitForLength(payloads, 1);
        expectTransportPayloads(payloads, 1);

        payloads.length = 0;
        await expectRpcSuccess(actor, "mark_project_alert_read", notification.notificationId);
        await waitForLength(payloads, 1);
        expectTransportPayloads(payloads, 1);

        payloads.length = 0;
        await expectRpcSuccess(
          actor,
          "dismiss_project_alert_notification",
          notification.notificationId,
        );
        await waitForLength(payloads, 1);
        expectTransportPayloads(payloads, 1);

        payloads.length = 0;
        await expectRpcSuccess(actor, "mark_project_alert_read", notification.notificationId);
        await expectRpcSuccess(
          actor,
          "dismiss_project_alert_notification",
          notification.notificationId,
        );
        await expectNoNewEvent(payloads);

        await fixture.withDatabaseClients(1, async ([database]) => {
          await database!.query("begin");
          await insertNotification(database!, actor.profileId, actor.profileId);
          await database!.query("rollback");
        });
        await expectNoNewEvent(payloads);

        const concurrent = await fixture.withDatabaseClients(
          1,
          async ([database]) =>
            await insertNotification(database!, actor.profileId, actor.profileId),
        );
        await waitForLength(payloads, 1);
        payloads.length = 0;
        await Promise.all([
          expectRpcSuccess(actor, "mark_project_alert_read", concurrent.notificationId),
          expectRpcSuccess(
            actor,
            "dismiss_project_alert_notification",
            concurrent.notificationId,
          ),
        ]);
        await waitForLength(payloads, 2);
        expectTransportPayloads(payloads, 2);
      } finally {
        await actor.client.removeChannel(channel);
      }
    }, 30_000);
  });
}
