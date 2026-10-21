import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadBackendTestEnvironment } from "./env";

const enabled = process.env.PROJECT_ISSUE_RESOLUTION_CONCURRENCY === "1";
const environment = loadBackendTestEnvironment();
const database = new Pool({
  connectionString: environment.supabaseTestDatabaseUrl,
  max: 4,
  ssl: false,
});

interface Fixture {
  adminOneAuthId: string;
  adminOneProfileId: string;
  adminTwoAuthId: string;
  adminTwoProfileId: string;
  issueId: string;
  replayIssueId: string;
  projectId: string;
}

let fixture: Fixture;

async function callResolution(
  client: PoolClient,
  authUserId: string,
  issueId: string,
  requestId: string,
  description: string,
) {
  await client.query("begin");
  try {
    await client.query("set local statement_timeout = '15s'");
    await client.query("set local lock_timeout = '10s'");
    await client.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
      [authUserId],
    );
    await client.query("set local role authenticated");
    const row = (await client.query<{ resolution_id: string }>(
      `select resolution_id
       from public.resolve_project_issue($1::uuid, $2::uuid, $3::text)`,
      [issueId, requestId, description],
    )).rows[0]!;
    await client.query("commit");
    return row;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

describe.skipIf(!enabled)("Task 002A committed local Issue-resolution concurrency", () => {
  beforeAll(async () => {
    if (environment.projectRef !== "local") {
      throw new Error("Task 002A committed concurrency may run only on local Supabase");
    }
    const prior = (await database.query<{ count: string }>(
      `select pg_catalog.count(*)::text as count
       from public.user_profiles
       where full_name like 'Task 002A concurrency %'`,
    )).rows[0]?.count;
    if (prior !== "0") {
      throw new Error(
        "Task 002A concurrency requires a freshly reset disposable local database",
      );
    }

    const authAdmin = createClient(
      environment.supabaseUrl,
      environment.supabaseSecretKey,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const first = await authAdmin.auth.admin.createUser({
      email: `task002a.one.${randomUUID()}@example.com`,
      password: `Task002A-${randomUUID()}-Aa1!`,
      email_confirm: true,
    });
    const second = await authAdmin.auth.admin.createUser({
      email: `task002a.two.${randomUUID()}@example.com`,
      password: `Task002A-${randomUUID()}-Aa1!`,
      email_confirm: true,
    });
    if (first.error || !first.data.user) throw first.error;
    if (second.error || !second.data.user) throw second.error;

    const adminOneProfileId = randomUUID();
    const adminTwoProfileId = randomUUID();
    const projectId = randomUUID();
    const issueId = randomUUID();
    const replayIssueId = randomUUID();
    await database.query(
      `insert into public.user_profiles (
         id, auth_user_id, full_name, email, birthday,
         is_admin, is_active, created_by_user_id
       ) values
         ($1::uuid, $2::uuid, 'Task 002A concurrency one', $3::text,
          '1990-01-01'::date, true, true, null),
         ($4::uuid, $5::uuid, 'Task 002A concurrency two', $6::text,
          '1990-01-01'::date, true, true, $1::uuid)`,
      [
        adminOneProfileId,
        first.data.user.id,
        first.data.user.email,
        adminTwoProfileId,
        second.data.user.id,
        second.data.user.email,
      ],
    );
    await database.query(
      `insert into public.projects (
         id, name, customer_name, status, start_date, delivery_date,
         created_by_user_id, updated_by_user_id
       ) values (
         $1::uuid, 'Task 002A concurrency Project', 'Task 002A Customer',
         'planned', '2026-10-20'::date, '2026-11-20'::date, $2::uuid, $2::uuid
       )`,
      [projectId, adminOneProfileId],
    );
    await database.query(
      `insert into public.project_activity_updates (
         id, project_id, author_user_id, request_id, title, description, activity_kind
       ) values
         ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
          'Competing resolvers', 'Exactly one resolution', 'issue'),
         ($5::uuid, $2::uuid, $3::uuid, $6::uuid,
          'Idempotent replay', 'Exactly one durable replay result', 'issue')`,
      [issueId, projectId, adminOneProfileId, randomUUID(), replayIssueId, randomUUID()],
    );
    fixture = {
      adminOneAuthId: first.data.user.id,
      adminOneProfileId,
      adminTwoAuthId: second.data.user.id,
      adminTwoProfileId,
      issueId,
      replayIssueId,
      projectId,
    };
  });

  afterAll(async () => {
    await database.end();
  });

  it("serializes different resolvers to exactly one resolution without deadlock", async () => {
    const clientOne = await database.connect();
    const clientTwo = await database.connect();
    let one: PromiseSettledResult<{ resolution_id: string }>;
    let two: PromiseSettledResult<{ resolution_id: string }>;
    try {
      [one, two] = await Promise.allSettled([
        callResolution(
          clientOne,
          fixture.adminOneAuthId,
          fixture.issueId,
          randomUUID(),
          "Resolver one",
        ),
        callResolution(
          clientTwo,
          fixture.adminTwoAuthId,
          fixture.issueId,
          randomUUID(),
          "Resolver two",
        ),
      ]);
    } finally {
      clientOne.release();
      clientTwo.release();
    }
    const results = [one, two];
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult)
      .reason).toMatchObject({ code: "PIR03" });
    expect((await database.query(
      `select pg_catalog.count(*)::int as count
       from public.project_issue_resolutions where project_activity_id = $1::uuid`,
      [fixture.issueId],
    )).rows[0]?.count).toBe(1);
  });

  it("serializes identical same-resolver retries to one resolution and notification", async () => {
    const requestId = randomUUID();
    const clientOne = await database.connect();
    const clientTwo = await database.connect();
    try {
      const [one, two] = await Promise.all([
        callResolution(
          clientOne,
          fixture.adminOneAuthId,
          fixture.replayIssueId,
          requestId,
          "Identical replay",
        ),
        callResolution(
          clientTwo,
          fixture.adminOneAuthId,
          fixture.replayIssueId,
          requestId,
          "Identical replay",
        ),
      ]);
      expect(one.resolution_id).toBe(two.resolution_id);
      const counts = (await database.query(
        `select
           (select pg_catalog.count(*)::int
            from public.project_issue_resolutions where request_id = $1::uuid) as resolutions,
           (select pg_catalog.count(*)::int
            from public.project_activity_alerts as notification
            join public.project_issue_resolutions as resolution
              on resolution.id = notification.project_issue_resolution_id
            where resolution.request_id = $1::uuid) as notifications,
           (select pg_catalog.count(*)::int
            from public.audit_logs as audit
            where audit.action_type = 'project_activity.issue_resolved'
              and audit.entity_id = $2::uuid) as audits`,
        [requestId, one.resolution_id],
      )).rows[0];
      expect(counts).toEqual({ resolutions: 1, notifications: 1, audits: 1 });
    } finally {
      clientOne.release();
      clientTwo.release();
    }
  });
});
