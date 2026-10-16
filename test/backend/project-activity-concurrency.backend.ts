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
  projectId: string;
  requestId: string;
  senderAuthUserId: string;
}

let fixture: ConcurrencyFixture;

async function callAndCommit(client: PoolClient) {
  await client.query("begin");
  try {
    await client.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
      [fixture.senderAuthUserId],
    );
    await client.query("set local role authenticated");
    const result = await client.query<{
      activity_id: string;
      alert_id: string;
      recipient_count: string;
    }>(
      `select activity_id, alert_id, recipient_count::text
       from public.post_project_activity(
         $1::uuid, $2::uuid, 'Concurrent Activity',
         'One durable result for both callers', true
       )`,
      [fixture.projectId, fixture.requestId],
    );
    await client.query("commit");
    return result.rows[0]!;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

describe.skipIf(!enabled)("Task C committed duplicate-request concurrency", () => {
  beforeAll(async () => {
    if (environment.projectRef !== "local") {
      throw new Error("Task C committed concurrency may run only on local Supabase");
    }

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
    if (senderAuth.error || !senderAuth.data.user) throw senderAuth.error;
    if (recipientAuth.error || !recipientAuth.data.user) throw recipientAuth.error;

    const senderProfileId = randomUUID();
    const recipientProfileId = randomUUID();
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
          '1990-01-01'::date, false, true, $1::uuid)`,
      [
        senderProfileId,
        senderAuth.data.user.id,
        senderAuth.data.user.email,
        recipientProfileId,
        recipientAuth.data.user.id,
        recipientAuth.data.user.email,
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
      projectId,
      requestId,
      senderAuthUserId: senderAuth.data.user.id,
    };
  });

  afterAll(async () => {
    await database.end();
  });

  it("serializes identical simultaneous requests to one Activity, fanout, and audit pair", async () => {
    const first = await database.connect();
    const second = await database.connect();
    try {
      const [firstResult, secondResult] = await Promise.all([
        callAndCommit(first),
        callAndCommit(second),
      ]);
      expect(secondResult).toEqual(firstResult);
      expect(firstResult.recipient_count).toBe("1");

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
        recipients: "1",
        audits: "2",
      });
    } finally {
      first.release();
      second.release();
    }
  });
});
