import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261001100000_add_audit_log_page_read.sql",
);
const auditSchemaPath = resolve(
  process.cwd(),
  "supabase/migrations/20260904131503_create_audit_logs.sql",
);

interface AuditPageRow extends QueryResultRow {
  action_type: string;
  actor_full_name: string;
  actor_user_id: string;
  audit_log_id: string;
  created_at: Date;
  entity_id: string | null;
  entity_type: string;
  summary: string;
}

const pageSql = `select * from public.list_audit_log_page(
  $1::integer,
  $2::timestamptz,
  $3::uuid
)`;

async function setActor(database: PoolClient, actor: SecurityActor | null) {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor?.authUserId ?? ""],
  );
  await database.query(actor ? "set local role authenticated" : "set local role anon");
}

async function callPage(
  database: PoolClient,
  actor: SecurityActor,
  limit: number | null = 50,
  beforeCreatedAt: string | null = null,
  beforeId: string | null = null,
): Promise<AuditPageRow[]> {
  await setActor(database, actor);
  try {
    return (await database.query<AuditPageRow>(pageSql, [
      limit,
      beforeCreatedAt,
      beforeId,
    ])).rows;
  } finally {
    await database.query("reset role");
  }
}

async function expectPageRejected(
  database: PoolClient,
  actor: SecurityActor | null,
  values: readonly unknown[],
  code: string,
): Promise<void> {
  await database.query("savepoint rejected_audit_page_call");
  await setActor(database, actor);
  try {
    await expect(database.query(pageSql, [...values])).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback to savepoint rejected_audit_page_call");
    await database.query("release savepoint rejected_audit_page_call");
    await database.query("reset role");
  }
}

async function grantArchiveView(
  database: PoolClient,
  fixture: SecurityFixtureHarness,
  actor: SecurityActor,
) {
  await database.query(
    `insert into public.user_permissions (
       user_id, permission_definition_id, granted_by_user_id
     )
     select $1::uuid, definition.id, $2::uuid
     from public.permission_definitions as definition
     where definition.key = 'archive.view'
     on conflict (user_id, permission_definition_id) do nothing`,
    [actor.profileId, fixture.actors.admin.profileId],
  );
}

async function insertAudit(
  database: PoolClient,
  actorUserId: string,
  values: {
    createdAt: string;
    id?: string;
    summary: string;
  },
) {
  const id = values.id ?? randomUUID();
  await database.query(
    `insert into public.audit_logs (
       id, actor_user_id, action_type, entity_type, entity_id,
       summary, before_data, after_data, metadata, created_at
     ) values (
       $1::uuid, $2::uuid, 'task135.fixture', 'task135_fixture', $1::uuid,
       $3::text, '{"secret":"before"}'::jsonb,
       '{"secret":"after"}'::jsonb, '{"secret":"metadata"}'::jsonb,
       $4::timestamptz
     )`,
    [id, actorUserId, values.summary, values.createdAt],
  );
  return id;
}

export function registerAuditLogPageTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 135 Audit page read (static)", () => {
    it("defines the narrow authorized keyset RPC without filters, totals, or a duplicate index", () => {
      const sql = readFileSync(migrationPath, "utf8");
      const auditSchema = readFileSync(auditSchemaPath, "utf8");

      expect(sql).toContain("create function public.list_audit_log_page(");
      expect(sql).toContain("p_limit integer default 50");
      expect(sql).toContain("p_before_created_at timestamptz default null");
      expect(sql).toContain("p_before_id uuid default null");
      expect(sql).toContain("stable\nsecurity definer\nset search_path = ''");
      expect(sql).toContain("public.current_user_is_admin()");
      expect(sql).toContain("public.has_permission('archive.view')");
      expect(sql).toContain("p_limit is null or p_limit < 1 or p_limit > 100");
      expect(sql).toContain("(p_before_created_at is null) <> (p_before_id is null)");
      expect(sql).toContain("(audit.created_at, audit.id) < (p_before_created_at, p_before_id)");
      expect(sql).toContain("order by audit.created_at desc, audit.id desc");
      expect(sql).toContain("limit p_limit");
      expect(sql).toContain("join public.user_profiles as actor");
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain("to authenticated;");
      expect(sql).not.toMatch(/\boffset\b/i);
      expect(sql).not.toMatch(/count\s*\(/i);
      expect(sql).not.toMatch(/before_data|after_data|metadata/);
      expect(sql).not.toMatch(/actor\.(email|auth_user_id|birthday|is_admin|is_active)/);
      expect(sql).not.toMatch(/create\s+(unique\s+)?index/i);
      expect(auditSchema).toContain(
        "create index audit_logs_created_at_id_idx\n  on public.audit_logs (created_at desc, id desc);",
      );
    });
  });

  describe.skipIf(process.env.TASK135_MIGRATION !== "1")(
    "Task 135 Audit page read (requires deployed migration)",
    () => {
      it("enforces Admin/archive.view authorization including inactive-account denial", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          expect(await callPage(database, fixture.actors.admin, 1)).toHaveLength(1);

          await grantArchiveView(database, fixture, fixture.actors.permitted);
          expect(await callPage(database, fixture.actors.permitted, 1)).toHaveLength(1);

          await expectPageRejected(database, fixture.actors.productCreator, [1, null, null], "42501");
          await expectPageRejected(database, fixture.actors.unpermitted, [1, null, null], "42501");

          await grantArchiveView(database, fixture, fixture.actors.inactive);
          await database.query(
            "update public.user_profiles set is_admin = true where id = $1::uuid",
            [fixture.actors.inactive.profileId],
          );
          await expectPageRejected(database, fixture.actors.inactive, [1, null, null], "42501");
          await expectPageRejected(database, null, [1, null, null], "42501");
        });
      });

      it("returns only list-safe fields and keeps an inactive historical actor visible", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const id = await insertAudit(
            database,
            fixture.actors.inactiveBrandManager.profileId,
            {
              createdAt: "2098-01-01T00:00:00.000000Z",
              summary: "Historical inactive actor",
            },
          );
          const actor = (await database.query<{ full_name: string }>(
            "select full_name from public.user_profiles where id = $1::uuid",
            [fixture.actors.inactiveBrandManager.profileId],
          )).rows[0]!;
          const row = (await callPage(database, fixture.actors.admin, 1))[0]!;

          expect(row.audit_log_id).toBe(id);
          expect(row.actor_full_name).toBe(actor.full_name);
          expect(Object.keys(row).sort()).toEqual([
            "action_type",
            "actor_full_name",
            "actor_user_id",
            "audit_log_id",
            "created_at",
            "entity_id",
            "entity_type",
            "summary",
          ]);
        });
      });

      it("implements deterministic keyset pages, limits, ties, final pages, and concurrent appends", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          const newestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
          const tieHighId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
          const tieLowId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
          const olderId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
          const ancientId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
          await insertAudit(database, actorId, { id: newestId, createdAt: "2099-01-03T00:00:00Z", summary: "Newest" });
          await insertAudit(database, actorId, { id: tieHighId, createdAt: "2099-01-02T00:00:00Z", summary: "Tie high" });
          await insertAudit(database, actorId, { id: tieLowId, createdAt: "2099-01-02T00:00:00Z", summary: "Tie low" });
          await insertAudit(database, actorId, { id: olderId, createdAt: "2099-01-01T00:00:00Z", summary: "Older" });
          await insertAudit(database, actorId, { id: ancientId, createdAt: "1900-01-01T00:00:00Z", summary: "Ancient" });

          const first = await callPage(database, fixture.actors.admin, 2);
          expect(first.map((row) => row.audit_log_id)).toEqual([newestId, tieHighId]);
          await setActor(database, fixture.actors.admin);
          const defaultPage = await database.query<AuditPageRow>(
            "select * from public.list_audit_log_page()",
          );
          await database.query("reset role");
          expect(defaultPage.rowCount).toBeLessThanOrEqual(50);
          const second = await callPage(
            database,
            fixture.actors.admin,
            2,
            first[1]!.created_at.toISOString(),
            first[1]!.audit_log_id,
          );
          expect(second.map((row) => row.audit_log_id)).toEqual([tieLowId, olderId]);
          expect(new Set([...first, ...second].map((row) => row.audit_log_id)).size).toBe(4);

          expect(await callPage(database, fixture.actors.admin, 1)).toHaveLength(1);
          expect((await callPage(database, fixture.actors.admin, 100)).length).toBeLessThanOrEqual(100);
          for (const badLimit of [null, 0, -1, 101]) {
            await expectPageRejected(database, fixture.actors.admin, [badLimit, null, null], "22023");
          }
          await expectPageRejected(database, fixture.actors.admin, [50, "2099-01-01T00:00:00Z", null], "22023");
          await expectPageRejected(database, fixture.actors.admin, [50, null, olderId], "22023");

          const finalShort = await callPage(
            database,
            fixture.actors.admin,
            100,
            "1901-01-01T00:00:00Z",
            "ffffffff-ffff-4fff-8fff-ffffffffffff",
          );
          expect(finalShort.map((row) => row.audit_log_id)).toEqual([ancientId]);
          expect(await callPage(
            database,
            fixture.actors.admin,
            100,
            finalShort[0]!.created_at.toISOString(),
            finalShort[0]!.audit_log_id,
          )).toEqual([]);

          const appendedId = await insertAudit(database, actorId, {
            createdAt: "2100-01-01T00:00:00Z",
            summary: "Appended after page one",
          });
          const continuation = await callPage(
            database,
            fixture.actors.admin,
            2,
            first[1]!.created_at.toISOString(),
            first[1]!.audit_log_id,
          );
          expect(continuation.some((row) => row.audit_log_id === appendedId)).toBe(false);
          expect((await callPage(database, fixture.actors.admin, 1))[0]!.audit_log_id).toBe(appendedId);
        });
      });

      it("keeps the table private and immutable while trusted append remains usable", async () => {
        const fixture = requireHarness();
        let trustedAuditId = "";
        let trustedCalendarEntryId = "";
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          await grantArchiveView(database, fixture, fixture.actors.permitted);
          const fixtureId = await insertAudit(database, fixture.actors.admin.profileId, {
            createdAt: "2097-01-01T00:00:00Z",
            summary: "Granted archive.view to Historical User",
          });
          for (const sql of [
            "select * from public.audit_logs limit 1",
            `insert into public.audit_logs (actor_user_id, action_type, entity_type, summary)
             values ('${fixture.actors.permitted.profileId}', 'forged', 'forged', 'forged')`,
            `update public.audit_logs set summary = 'forged' where id = '${fixtureId}'`,
            `delete from public.audit_logs where id = '${fixtureId}'`,
          ]) {
            await database.query("savepoint direct_audit_access");
            await setActor(database, fixture.actors.permitted);
            try {
              await expect(database.query(sql)).rejects.toMatchObject({ code: "42501" });
            } finally {
              await database.query("rollback to savepoint direct_audit_access");
              await database.query("release savepoint direct_audit_access");
              await database.query("reset role");
            }
          }

          await database.query("savepoint anonymous_audit_select");
          await setActor(database, null);
          try {
            await expect(database.query(
              "select * from public.audit_logs limit 1",
            )).rejects.toMatchObject({ code: "42501" });
          } finally {
            await database.query("rollback to savepoint anonymous_audit_select");
            await database.query("release savepoint anonymous_audit_select");
            await database.query("reset role");
          }

          await database.query("savepoint archive_users_boundary");
          await setActor(database, fixture.actors.permitted);
          try {
            await expect(database.query(
              "select * from public.list_users_admin()",
            )).rejects.toMatchObject({ code: "42501" });
          } finally {
            await database.query("rollback to savepoint archive_users_boundary");
            await database.query("release savepoint archive_users_boundary");
            await database.query("reset role");
          }
          await setActor(database, fixture.actors.permitted);
          const arbitraryProfile = await database.query(
            `select id, email, birthday, is_admin, is_active
             from public.user_profiles
             where id = $1::uuid`,
            [fixture.actors.admin.profileId],
          );
          await database.query("reset role");
          expect(arbitraryProfile.rows).toEqual([]);

          await database.query("savepoint direct_audit_helper_access");
          await setActor(database, fixture.actors.admin);
          try {
            await expect(database.query(
              `select public.append_audit_log(
                 'task135.forged', 'task135_fixture', 'Forbidden direct append'
               )`,
            )).rejects.toMatchObject({ code: "42501" });
          } finally {
            await database.query("rollback to savepoint direct_audit_helper_access");
            await database.query("release savepoint direct_audit_helper_access");
            await database.query("reset role");
          }

          for (const sql of [
            "update public.audit_logs set summary = 'changed' where id = $1::uuid",
            "delete from public.audit_logs where id = $1::uuid",
          ]) {
            await database.query("savepoint immutable_audit_check");
            try {
              await expect(database.query(sql, [fixtureId])).rejects.toMatchObject({ code: "55000" });
            } finally {
              await database.query("rollback to savepoint immutable_audit_check");
              await database.query("release savepoint immutable_audit_check");
            }
          }

          await setActor(database, fixture.actors.admin);
          const created = await database.query<{
            calendar_entry_id: string;
          }>(
            `select calendar_entry_id
             from public.create_calendar_entry(
               'event',
               'Task 135 trusted append regression',
               '2026-10-01'::date,
               '2026-10-01'::date,
               null,
               null
             )`,
          );
          await database.query("reset role");
          trustedCalendarEntryId = created.rows[0]!.calendar_entry_id;

          const trustedAudits = (await database.query<{
            actor_user_id: string;
            created_at: Date;
            id: string;
          }>(
            `select id, actor_user_id, created_at
             from public.audit_logs
             where action_type = 'calendar.created'
               and entity_id = $1::uuid`,
            [trustedCalendarEntryId],
          )).rows;
          expect(trustedAudits).toHaveLength(1);
          const trustedAudit = trustedAudits[0]!;
          expect(trustedAudit.actor_user_id).toBe(fixture.actors.admin.profileId);
          trustedAuditId = trustedAudit.id;

          expect(await callPage(
            database,
            fixture.actors.permitted,
            1,
          )).toContainEqual(expect.objectContaining({
            audit_log_id: fixtureId,
            summary: "Granted archive.view to Historical User",
          }));

          const page = await callPage(
            database,
            fixture.actors.permitted,
            100,
            new Date(trustedAudit.created_at.getTime() + 1).toISOString(),
            "ffffffff-ffff-4fff-8fff-ffffffffffff",
          );
          expect(page).toContainEqual(expect.objectContaining({
            action_type: "calendar.created",
            audit_log_id: trustedAuditId,
            entity_id: trustedCalendarEntryId,
            summary: "Created Calendar entry Task 135 trusted append regression",
          }));
        });

        await fixture.withRollbackDatabaseTransaction(async (database) => {
          expect((await database.query(
            "select id from public.calendar_entries where id = $1::uuid",
            [trustedCalendarEntryId],
          )).rows).toEqual([]);
          expect((await database.query(
            "select id from public.audit_logs where id = $1::uuid",
            [trustedAuditId],
          )).rows).toEqual([]);
        });
      });

      it("has hardened metadata, the existing pagination index, and no read side effects", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const functionRow = (await database.query<{
            anon_execute: boolean;
            authenticated_execute: boolean;
            proconfig: string[];
            prosecdef: boolean;
            provolatile: string;
            public_execute: boolean;
          }>(
            `select
               procedure.provolatile,
               procedure.prosecdef,
               procedure.proconfig,
               pg_catalog.has_function_privilege('authenticated', procedure.oid, 'execute') as authenticated_execute,
               pg_catalog.has_function_privilege('anon', procedure.oid, 'execute') as anon_execute,
               exists (
                 select 1 from pg_catalog.aclexplode(procedure.proacl) as acl
                 where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
               ) as public_execute
             from pg_catalog.pg_proc as procedure
             join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'public'
               and procedure.proname = 'list_audit_log_page'`,
          )).rows[0]!;
          expect(functionRow).toEqual({
            anon_execute: false,
            authenticated_execute: true,
            proconfig: ['search_path=""'],
            prosecdef: true,
            provolatile: "s",
            public_execute: false,
          });
          expect((await database.query<{ indexdef: string }>(
            `select indexdef from pg_catalog.pg_indexes
             where schemaname = 'public' and indexname = 'audit_logs_created_at_id_idx'`,
          )).rows[0]?.indexdef).toContain("(created_at DESC, id DESC)");

          const snapshotSql = `select pg_catalog.jsonb_build_object(
            'audit_logs', (select count(*) from public.audit_logs),
            'audit_content', (
              select pg_catalog.md5(coalesce(pg_catalog.string_agg(
                audit.id::text || audit.actor_user_id::text || audit.action_type ||
                audit.entity_type || coalesce(audit.entity_id::text, '') ||
                audit.summary || coalesce(audit.before_data::text, '') ||
                coalesce(audit.after_data::text, '') ||
                coalesce(audit.metadata::text, '') || audit.created_at::text,
                '' order by audit.created_at, audit.id
              ), ''))
              from public.audit_logs as audit
            ),
            'user_profiles', (select count(*) from public.user_profiles),
            'user_permissions', (select count(*) from public.user_permissions),
            'projects', (select count(*) from public.projects),
            'products', (select count(*) from public.products),
            'inventory_balances', (select count(*) from public.inventory_balances),
            'work_orders', (select count(*) from public.work_orders),
            'calendar_entries', (select count(*) from public.calendar_entries)
          ) as snapshot`;
          const before = (await database.query(snapshotSql)).rows[0]!.snapshot;
          await callPage(database, fixture.actors.admin, 50);
          const after = (await database.query(snapshotSql)).rows[0]!.snapshot;
          expect(after).toEqual(before);
        });
      });
    },
  );
}
