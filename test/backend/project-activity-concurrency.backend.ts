import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadBackendTestEnvironment } from "./env";

const enabled = process.env.TASKC_COMMITTED_CONCURRENCY === "1";
const environment = loadBackendTestEnvironment();
const database = new Pool({
  connectionString: environment.supabaseTestDatabaseUrl,
  max: 3,
  ssl: false,
});

interface ConcurrencyFixture {
  automaticAdminAuthUserId: string;
  automaticAdminProfileId: string;
  projectId: string;
  recipientAuthUserId: string;
  recipientProfileId: string;
  requestId: string;
  senderAuthUserId: string;
  senderProfileId: string;
}

let fixture: ConcurrencyFixture;

const fixtureProfileNames = [
  "Task C concurrency sender",
  "Task C concurrency recipient",
  "Task C automatic Admin recipient",
] as const;

async function assertFreshCommittedConcurrencyContext(): Promise<void> {
  const priorFixtures = (await database.query<{ count: string }>(
    `select pg_catalog.count(*)::text as count
     from public.user_profiles
     where full_name = any($1::text[])`,
    [[...fixtureProfileNames]],
  )).rows[0]?.count;

  if (priorFixtures !== "0") {
    throw new Error(
      "Task C committed concurrency requires a freshly reset disposable local database; "
      + "prior immutable Task C history is present, so this campaign will not add more fixtures",
    );
  }
}

async function callAndCommit(
  client: PoolClient,
  requestId = fixture.requestId,
  applicationName?: string,
  authUserId = fixture.senderAuthUserId,
  title = "Concurrent Activity",
  description = "One durable result for both callers",
  sendAlert = true,
) {
  await client.query("begin");
  try {
    await client.query("set local statement_timeout = '20s'");
    await client.query("set local lock_timeout = '15s'");
    if (applicationName) {
      await client.query(
        "select pg_catalog.set_config('application_name', $1::text, true)",
        [applicationName],
      );
    }
    await client.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
      [authUserId],
    );
    await client.query("set local role authenticated");
    const result = await client.query<{
      activity_id: string;
      alert_id: string;
      author_user_id: string;
      recipient_count: string;
    }>(
      `select activity_id, alert_id, author_user_id, recipient_count::text
       from public.post_project_activity(
         $1::uuid, $2::uuid, $3::text, $4::text, $5::boolean
       )`,
      [fixture.projectId, requestId, title, description, sendAlert],
    );
    await client.query("commit");
    return result.rows[0]!;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function waitForLockWait(
  observer: PoolClient,
  applicationName: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const waiting = (await observer.query<{ waiting: boolean }>(
      `select exists (
         select 1
         from pg_catalog.pg_stat_activity as activity
         where activity.application_name = $1::text
           and activity.wait_event_type = 'Lock'
       ) as waiting`,
      [applicationName],
    )).rows[0]?.waiting;
    if (waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${applicationName} to wait on the recipient profile lock`);
}

async function getEligibleRecipientIds(client: PoolClient): Promise<string[]> {
  return (await client.query<{ id: string }>(
    `select profile.id
     from public.user_profiles as profile
     where profile.is_active
       and (
         profile.is_admin
         or (
           exists (
             select 1
             from public.user_permissions as permission
             join public.permission_definitions as definition
               on definition.id = permission.permission_definition_id
             where permission.user_id = profile.id
               and definition.key = 'projects.alerts.receive'
               and definition.is_delegable
           )
           and exists (
             select 1
             from public.user_permissions as permission
             join public.permission_definitions as definition
               on definition.id = permission.permission_definition_id
             where permission.user_id = profile.id
               and definition.key = 'dashboard.view'
               and definition.is_delegable
           )
           and exists (
             select 1
             from public.user_permissions as permission
             join public.permission_definitions as definition
               on definition.id = permission.permission_definition_id
             where permission.user_id = profile.id
               and definition.key = 'projects.view'
               and definition.is_delegable
           )
         )
       )
     order by profile.id`,
  )).rows.map((row) => row.id);
}

async function getRecipientIds(
  client: PoolClient,
  alertId: string,
): Promise<string[]> {
  return (await client.query<{ recipient_user_id: string }>(
    `select recipient_user_id
     from public.project_activity_alert_recipients
     where alert_id = $1::uuid
     order by recipient_user_id`,
    [alertId],
  )).rows.map((row) => row.recipient_user_id);
}

describe.skipIf(!enabled)("Task C committed duplicate-request concurrency", () => {
  beforeAll(async () => {
    if (environment.projectRef !== "local") {
      throw new Error("Task C committed concurrency may run only on local Supabase");
    }
    await assertFreshCommittedConcurrencyContext();

    const authAdmin = createClient(
      environment.supabaseUrl,
      environment.supabaseSecretKey,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const senderAuth = await authAdmin.auth.admin.createUser({
      email: `taskc.sender.${randomUUID()}@example.com`,
      password: `TaskC-${randomUUID()}-Aa1!`,
      email_confirm: true,
    });
    const recipientAuth = await authAdmin.auth.admin.createUser({
      email: `taskc.recipient.${randomUUID()}@example.com`,
      password: `TaskC-${randomUUID()}-Aa1!`,
      email_confirm: true,
    });
    const automaticAdminAuth = await authAdmin.auth.admin.createUser({
      email: `taskc.admin-recipient.${randomUUID()}@example.com`,
      password: `TaskC-${randomUUID()}-Aa1!`,
      email_confirm: true,
    });
    if (senderAuth.error || !senderAuth.data.user) throw senderAuth.error;
    if (recipientAuth.error || !recipientAuth.data.user) throw recipientAuth.error;
    if (automaticAdminAuth.error || !automaticAdminAuth.data.user) {
      throw automaticAdminAuth.error;
    }

    const senderProfileId = randomUUID();
    const recipientProfileId = randomUUID();
    const automaticAdminProfileId = randomUUID();
    const projectId = randomUUID();
    const requestId = randomUUID();
    await database.query(
      `insert into public.user_profiles (
         id, auth_user_id, full_name, email, birthday,
         is_admin, is_active, created_by_user_id
       ) values
         ($1::uuid, $2::uuid, 'Task C concurrency sender', $3::text,
          '1990-01-01'::date, true, true, null),
         ($4::uuid, $5::uuid, 'Task C concurrency recipient', $6::text,
          '1990-01-01'::date, false, true, $1::uuid),
         ($7::uuid, $8::uuid, 'Task C automatic Admin recipient', $9::text,
          '1990-01-01'::date, true, true, $1::uuid)`,
      [
        senderProfileId,
        senderAuth.data.user.id,
        senderAuth.data.user.email,
        recipientProfileId,
        recipientAuth.data.user.id,
        recipientAuth.data.user.email,
        automaticAdminProfileId,
        automaticAdminAuth.data.user.id,
        automaticAdminAuth.data.user.email,
      ],
    );
    await database.query(
      `insert into public.user_permissions (
         user_id, permission_definition_id, granted_by_user_id
       )
       select $1::uuid, definition.id, $2::uuid
       from public.permission_definitions as definition
       where definition.key in (
         'projects.alerts.receive', 'dashboard.view', 'projects.view'
       )`,
      [recipientProfileId, senderProfileId],
    );
    await database.query(
      `insert into public.projects (
         id, name, customer_name, status, start_date, delivery_date,
         created_by_user_id, updated_by_user_id
       ) values (
         $1::uuid, 'Task C concurrency Project', 'Task C Customer',
         'planned', '2026-10-16'::date, '2026-11-16'::date,
         $2::uuid, $2::uuid
       )`,
      [projectId, senderProfileId],
    );
    fixture = {
      automaticAdminAuthUserId: automaticAdminAuth.data.user.id,
      automaticAdminProfileId,
      projectId,
      recipientAuthUserId: recipientAuth.data.user.id,
      recipientProfileId,
      requestId,
      senderAuthUserId: senderAuth.data.user.id,
      senderProfileId,
    };
  });

  afterAll(async () => {
    if (fixture) {
      await database.query(
        `update public.user_profiles
         set is_active = false,
             deactivated_at = coalesce(deactivated_at, pg_catalog.statement_timestamp()),
             deactivated_by_user_id = coalesce(
               deactivated_by_user_id,
               $1::uuid
             )
         where id = any($2::uuid[])`,
        [
          fixture.senderProfileId,
          [
            fixture.senderProfileId,
            fixture.recipientProfileId,
            fixture.automaticAdminProfileId,
          ],
        ],
      );
    }
    await database.end();
  });

  it("serializes identical simultaneous requests to one Activity, fanout, and audit pair", async () => {
    const first = await database.connect();
    const second = await database.connect();
    try {
      const expectedRecipientIds = await getEligibleRecipientIds(first);
      const [firstResult, secondResult] = await Promise.all([
        callAndCommit(first),
        callAndCommit(second),
      ]);
      expect(secondResult).toEqual(firstResult);
      expect(firstResult.recipient_count).toBe(String(expectedRecipientIds.length));

      const counts = (await database.query<{
        activities: string;
        alerts: string;
        audits: string;
        recipients: string;
      }>(
        `select
           (select pg_catalog.count(*)::text
            from public.project_activity_updates
            where request_id = $1::uuid) as activities,
           (select pg_catalog.count(*)::text
            from public.project_activity_alerts
            where project_activity_id = $2::uuid) as alerts,
           (select pg_catalog.count(*)::text
            from public.project_activity_alert_recipients
            where alert_id = $3::uuid) as recipients,
           (select pg_catalog.count(*)::text
            from public.audit_logs
            where entity_id in ($2::uuid, $3::uuid)) as audits`,
        [fixture.requestId, firstResult.activity_id, firstResult.alert_id],
      )).rows[0];
      expect(counts).toEqual({
        activities: "1",
        alerts: "1",
        recipients: String(expectedRecipientIds.length),
        audits: "2",
      });
      expect(await getRecipientIds(first, firstResult.alert_id))
        .toEqual(expectedRecipientIds);
      expect((await database.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.project_activity_alert_recipients
         where alert_id = $1::uuid
           and recipient_user_id = $2::uuid`,
        [firstResult.alert_id, fixture.senderProfileId],
      )).rows[0]?.count).toBe("1");
      expect((await database.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.project_activity_alert_recipients
         where alert_id = $1::uuid
           and recipient_user_id = $2::uuid`,
        [firstResult.alert_id, fixture.automaticAdminProfileId],
      )).rows[0]?.count).toBe("1");
    } finally {
      first.release();
      second.release();
    }
  });

  it("allows exactly one original author when different Admins race for one request UUID", async () => {
    const first = await database.connect();
    const second = await database.connect();
    const requestId = randomUUID();
    try {
      const results = await Promise.allSettled([
        callAndCommit(first, requestId),
        callAndCommit(
          second,
          requestId,
          undefined,
          fixture.automaticAdminAuthUserId,
        ),
      ]);
      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof callAndCommit>>> =>
          result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({
        code: "42501",
        message: "Access denied",
      });
      expect([
        fixture.senderProfileId,
        fixture.automaticAdminProfileId,
      ]).toContain(fulfilled[0]!.value.author_user_id);

      const counts = (await database.query<{
        activities: string;
        alerts: string;
        audits: string;
        recipients: string;
      }>(
        `select
           (select pg_catalog.count(*)::text
            from public.project_activity_updates
            where request_id = $1::uuid) as activities,
           (select pg_catalog.count(*)::text
            from public.project_activity_alerts
            where project_activity_id = $2::uuid) as alerts,
           (select pg_catalog.count(*)::text
            from public.project_activity_alert_recipients
            where alert_id = $3::uuid) as recipients,
           (select pg_catalog.count(*)::text
            from public.audit_logs
            where entity_id in ($2::uuid, $3::uuid)) as audits`,
        [
          requestId,
          fulfilled[0]!.value.activity_id,
          fulfilled[0]!.value.alert_id,
        ],
      )).rows[0];
      expect(counts).toEqual({
        activities: "1",
        alerts: "1",
        audits: "2",
        recipients: fulfilled[0]!.value.recipient_count,
      });
    } finally {
      first.release();
      second.release();
    }
  });

  it("serializes recipient fanout against trusted Admin demotion without deadlock", async () => {
    const statusChange = await database.connect();
    const poster = await database.connect();
    const observer = await database.connect();
    const requestId = randomUUID();
    const applicationName = `task129-${randomUUID().slice(0, 12)}`;
    try {
      await statusChange.query("begin");
      await statusChange.query("set local statement_timeout = '20s'");
      await statusChange.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.senderAuthUserId],
      );
      await statusChange.query("set local role authenticated");
      await statusChange.query(
        "select public.set_user_admin_status_admin($1::uuid, false)",
        [fixture.automaticAdminProfileId],
      );

      const posted = callAndCommit(poster, requestId, applicationName);
      await waitForLockWait(observer, applicationName);
      await statusChange.query("commit");
      const result = await posted;
      const expectedRecipientIds = await getEligibleRecipientIds(observer);

      expect(result.recipient_count).toBe(String(expectedRecipientIds.length));
      expect(await getRecipientIds(observer, result.alert_id))
        .toEqual(expectedRecipientIds);
      expect((await observer.query<{ count: string }>(
        `select pg_catalog.count(*)::text as count
         from public.project_activity_alert_recipients
         where alert_id = $1::uuid
           and recipient_user_id = $2::uuid`,
        [result.alert_id, fixture.automaticAdminProfileId],
      )).rows[0]?.count).toBe("0");
      expect((await observer.query<{ is_admin: boolean }>(
        "select is_admin from public.user_profiles where id = $1::uuid",
        [fixture.automaticAdminProfileId],
      )).rows[0]?.is_admin).toBe(false);
    } catch (error) {
      await statusChange.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      statusChange.release();
      poster.release();
      observer.release();
    }
  });

  it("rechecks permission revocation and account deactivation after replay waits", async () => {
    const modifier = await database.connect();
    const replayer = await database.connect();
    const observer = await database.connect();
    try {
      await observer.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select $1::uuid, definition.id, $2::uuid
         from public.permission_definitions as definition
         where definition.key = 'projects.edit'
         on conflict (user_id, permission_definition_id) do nothing`,
        [fixture.recipientProfileId, fixture.senderProfileId],
      );

      for (const mode of ["permission", "active"] as const) {
        const requestId = randomUUID();
        const original = await callAndCommit(
          replayer,
          requestId,
          undefined,
          fixture.recipientAuthUserId,
          `${mode} replay`,
          `The ${mode} change must win before replay`,
          false,
        );
        const applicationName = `task131-${mode}-${randomUUID().slice(0, 8)}`;

        await modifier.query("begin");
        await modifier.query("set local statement_timeout = '20s'");
        await modifier.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [fixture.senderAuthUserId],
        );
        await modifier.query("set local role authenticated");
        if (mode === "permission") {
          await modifier.query(
            "select public.set_user_permission_admin($1::uuid, 'projects.edit', false)",
            [fixture.recipientProfileId],
          );
        } else {
          await modifier.query(
            "select public.set_user_active_state_admin($1::uuid, false)",
            [fixture.recipientProfileId],
          );
        }

        const replay = callAndCommit(
          replayer,
          requestId,
          applicationName,
          fixture.recipientAuthUserId,
          `${mode} replay`,
          `The ${mode} change must win before replay`,
          false,
        );
        await waitForLockWait(observer, applicationName);
        await modifier.query("commit");
        await expect(replay).rejects.toMatchObject({
          code: "42501",
          message: "Access denied",
        });

        const counts = (await observer.query<{
          activities: string;
          alerts: string;
          audits: string;
        }>(
          `select
             (select pg_catalog.count(*)::text
              from public.project_activity_updates
              where request_id = $1::uuid) as activities,
             (select pg_catalog.count(*)::text
              from public.project_activity_alerts
              where project_activity_id = $2::uuid) as alerts,
             (select pg_catalog.count(*)::text
              from public.audit_logs
              where entity_id = $2::uuid) as audits`,
          [requestId, original.activity_id],
        )).rows[0];
        expect(counts).toEqual({ activities: "1", alerts: "0", audits: "1" });

        if (mode === "permission") {
          await observer.query(
            `insert into public.user_permissions (
               user_id, permission_definition_id, granted_by_user_id
             )
             select $1::uuid, definition.id, $2::uuid
             from public.permission_definitions as definition
             where definition.key = 'projects.edit'
             on conflict (user_id, permission_definition_id) do nothing`,
            [fixture.recipientProfileId, fixture.senderProfileId],
          );
        } else {
          await observer.query(
            `update public.user_profiles
             set is_active = true,
                 deactivated_at = null,
                 deactivated_by_user_id = null
             where id = $1::uuid`,
            [fixture.recipientProfileId],
          );
        }
      }
    } catch (error) {
      await modifier.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      modifier.release();
      replayer.release();
      observer.release();
    }
  });
});
