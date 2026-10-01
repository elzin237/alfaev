import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261001110000_add_audit_log_filters.sql",
);

interface AuditPageRow extends QueryResultRow {
  audit_log_id: string;
  actor_user_id: string;
  actor_full_name: string;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  created_at: Date;
}

interface AuditFilterOptions {
  actors: Array<{ user_id: string; full_name: string }>;
  entity_types: string[];
  action_types: string[];
}

interface PageFilters {
  createdFrom?: string | null;
  createdBefore?: string | null;
  actorUserId?: string | null;
  entityType?: string | null;
  actionType?: string | null;
  searchText?: string | null;
}

const pageSql = `select * from public.list_audit_log_page(
  $1::integer,
  $2::timestamptz,
  $3::uuid,
  $4::timestamptz,
  $5::timestamptz,
  $6::uuid,
  $7::text,
  $8::text,
  $9::text
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
  filters: PageFilters = {},
  cursor: { createdAt: string; id: string } | null = null,
  limit = 50,
): Promise<AuditPageRow[]> {
  await setActor(database, actor);
  try {
    return (await database.query<AuditPageRow>(pageSql, [
      limit,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      filters.createdFrom ?? null,
      filters.createdBefore ?? null,
      filters.actorUserId ?? null,
      filters.entityType ?? null,
      filters.actionType ?? null,
      filters.searchText ?? null,
    ])).rows;
  } finally {
    await database.query("reset role");
  }
}

async function callOptions(
  database: PoolClient,
  actor: SecurityActor,
): Promise<AuditFilterOptions> {
  await setActor(database, actor);
  try {
    return (await database.query<{ options: AuditFilterOptions }>(
      "select public.get_audit_log_filter_options() as options",
    )).rows[0]!.options;
  } finally {
    await database.query("reset role");
  }
}

async function expectRejected(
  database: PoolClient,
  actor: SecurityActor | null,
  sql: string,
  values: readonly unknown[],
  code: string,
) {
  await database.query("savepoint rejected_task137_call");
  await setActor(database, actor);
  try {
    await expect(database.query(sql, [...values])).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback to savepoint rejected_task137_call");
    await database.query("release savepoint rejected_task137_call");
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
  input: {
    actorId: string;
    actionType: string;
    entityType: string;
    entityId?: string | null;
    summary: string;
    createdAt: string;
    beforeData?: object | null;
    afterData?: object | null;
    metadata?: object | null;
  },
) {
  const id = randomUUID();
  await database.query(
    `insert into public.audit_logs (
       id, actor_user_id, action_type, entity_type, entity_id,
       summary, before_data, after_data, metadata, created_at
     ) values (
       $1::uuid, $2::uuid, $3::text, $4::text, $5::uuid,
       $6::text, $7::jsonb, $8::jsonb, $9::jsonb, $10::timestamptz
     )`,
    [
      id,
      input.actorId,
      input.actionType,
      input.entityType,
      input.entityId ?? null,
      input.summary,
      JSON.stringify(input.beforeData ?? { protected: "before" }),
      JSON.stringify(input.afterData ?? { protected: "after" }),
      JSON.stringify(input.metadata ?? { protected: "metadata" }),
      input.createdAt,
    ],
  );
  return id;
}

export function registerAuditLogFilterTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 137 Archive filters (static)", () => {
    it("replaces the old identity with one compatible filtered keyset RPC", () => {
      const sql = readFileSync(migrationPath, "utf8");
      expect(sql).toContain(
        "drop function public.list_audit_log_page(integer, timestamptz, uuid);",
      );
      expect(sql.match(/create function public\.list_audit_log_page\(/g)).toHaveLength(1);
      for (const input of [
        "p_limit integer default 50",
        "p_before_created_at timestamptz default null",
        "p_before_id uuid default null",
        "p_created_from timestamptz default null",
        "p_created_before timestamptz default null",
        "p_actor_user_id uuid default null",
        "p_entity_type text default null",
        "p_action_type text default null",
        "p_search_text text default null",
      ]) expect(sql).toContain(input);
      expect(sql).toContain("audit.created_at >= p_created_from");
      expect(sql).toContain("audit.created_at < p_created_before");
      expect(sql).toContain("audit.actor_user_id = p_actor_user_id");
      expect(sql).toContain("audit.entity_type = normalized_entity_type");
      expect(sql).toContain("audit.action_type = normalized_action_type");
      expect(sql).toContain("(audit.created_at, audit.id) < (p_before_created_at, p_before_id)");
      expect(sql).toContain("order by audit.created_at desc, audit.id desc");
      expect(sql).not.toMatch(/\boffset\b|count\s*\(/i);
    });

    it("limits search to list-safe fields and defines one narrow options boundary", () => {
      const sql = readFileSync(migrationPath, "utf8");
      expect(sql).toContain("pg_catalog.length(normalized_search_text) > 200");
      for (const field of [
        "audit.summary",
        "actor.full_name",
        "audit.action_type",
        "audit.entity_type",
        "audit.entity_id::text",
      ]) expect(sql).toContain(field);
      expect(sql).not.toMatch(/audit\.(before_data|after_data|metadata)/);
      expect(sql).not.toMatch(/actor\.(email|birthday|auth_user_id|is_admin|is_active)/);
      expect(sql).toContain("create function public.get_audit_log_filter_options()");
      expect(sql).toContain("where audit.actor_user_id = actor.id");
      expect(sql).toContain("select distinct audit.entity_type");
      expect(sql).toContain("select distinct audit.action_type");
      expect(sql.match(/stable\nsecurity definer\nset search_path = ''/g)).toHaveLength(2);
      expect(sql.match(/from public, anon, authenticated;/g)).toHaveLength(2);
      expect(sql.match(/to authenticated;/g)).toHaveLength(2);
      expect(sql).not.toMatch(/create\s+(unique\s+)?index/i);
    });
  });

  describe.skipIf(process.env.TASK137_MIGRATION !== "1")(
    "Task 137 Archive filters (requires deployed migration)",
    () => {
      it("preserves authorization and original-argument compatibility", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          await setActor(database, fixture.actors.admin);
          const legacy = await database.query(
            "select * from public.list_audit_log_page(1, null, null)",
          );
          await database.query("reset role");
          expect(legacy.rowCount).toBe(1);

          await grantArchiveView(database, fixture, fixture.actors.permitted);
          expect(await callPage(database, fixture.actors.permitted)).toBeInstanceOf(Array);
          const values = [50, null, null, null, null, null, null, null, null];
          await expectRejected(database, fixture.actors.unpermitted, pageSql, values, "42501");
          await grantArchiveView(database, fixture, fixture.actors.inactive);
          await expectRejected(database, fixture.actors.inactive, pageSql, values, "42501");
          await expectRejected(database, null, pageSql, values, "42501");
        });
      });

      it("applies inclusive/exclusive dates, actor identity, exact raw values, and AND composition", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const entityId = randomUUID();
          const firstId = await insertAudit(database, {
            actorId: fixture.actors.admin.profileId,
            actionType: "task137.created",
            entityType: "task137_entity",
            entityId,
            summary: "First searchable Alpha",
            createdAt: "2097-05-01T10:00:00Z",
          });
          const secondId = await insertAudit(database, {
            actorId: fixture.actors.permitted.profileId,
            actionType: "task137.updated",
            entityType: "task137_entity",
            summary: "Second searchable Beta",
            createdAt: "2097-05-02T10:00:00Z",
          });
          const targetOnlyId = await insertAudit(database, {
            actorId: fixture.actors.admin.profileId,
            actionType: "task137.target_only",
            entityType: "user_profile",
            entityId: fixture.actors.permitted.profileId,
            summary: "Target identity must not act as actor identity",
            createdAt: "2097-05-03T10:00:00Z",
          });

          const bounded = await callPage(database, fixture.actors.admin, {
            createdFrom: "2097-05-01T10:00:00Z",
            createdBefore: "2097-05-02T10:00:00Z",
          });
          expect(bounded.map((row) => row.audit_log_id)).toContain(firstId);
          expect(bounded.map((row) => row.audit_log_id)).not.toContain(secondId);
          expect((await callPage(database, fixture.actors.admin, {
            createdFrom: "2097-05-02T10:00:00Z",
          })).map((row) => row.audit_log_id)).toContain(secondId);
          expect((await callPage(database, fixture.actors.admin, {
            createdBefore: "2097-05-02T10:00:00Z",
          })).map((row) => row.audit_log_id)).toContain(firstId);
          expect((await callPage(database, fixture.actors.admin, {
            actorUserId: fixture.actors.permitted.profileId,
          })).map((row) => row.audit_log_id)).toContain(secondId);
          expect((await callPage(database, fixture.actors.admin, {
            actorUserId: fixture.actors.permitted.profileId,
          })).map((row) => row.audit_log_id)).not.toContain(targetOnlyId);
          expect(await callPage(database, fixture.actors.admin, {
            actorUserId: randomUUID(),
          })).toEqual([]);
          expect((await callPage(database, fixture.actors.admin, {
            entityType: " task137_entity ", actionType: " task137.created ",
          })).map((row) => row.audit_log_id)).toContain(firstId);
          expect(await callPage(database, fixture.actors.admin, {
            entityType: "Task 137 Entity",
          })).toEqual([]);
          expect(await callPage(database, fixture.actors.admin, {
            entityType: "task137_unknown",
          })).toEqual([]);
          expect(await callPage(database, fixture.actors.admin, {
            actionType: "task137.unknown",
          })).toEqual([]);
          expect((await callPage(database, fixture.actors.admin, {
            entityType: "   ", actionType: "   ",
          })).map((row) => row.audit_log_id)).toEqual(
            expect.arrayContaining([firstId, secondId]),
          );
          expect((await callPage(database, fixture.actors.admin, {
            createdFrom: "2097-05-01T00:00:00Z",
            createdBefore: "2097-05-02T00:00:00Z",
            actorUserId: fixture.actors.admin.profileId,
            entityType: "task137_entity",
            actionType: "task137.created",
            searchText: "alpha",
          })).map((row) => row.audit_log_id)).toEqual([firstId]);

          await expectRejected(database, fixture.actors.admin, pageSql, [
            50, null, null, "2097-05-02", "2097-05-02", null, null, null, null,
          ], "22023");
          await expectRejected(database, fixture.actors.admin, pageSql, [
            50, null, null, "2097-05-03", "2097-05-02", null, null, null, null,
          ], "22023");
        });
      });

      it("searches every list-safe field case-insensitively but never protected JSON", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const entityId = randomUUID();
          const protectedSentinel = `task137-protected-${randomUUID()}`;
          const id = await insertAudit(database, {
            actorId: fixture.actors.admin.profileId,
            actionType: "task137.special_action",
            entityType: "task137_special_entity",
            entityId,
            summary: "Mixed Case Summary",
            beforeData: { protected: protectedSentinel },
            afterData: { protected: protectedSentinel },
            metadata: { protected: protectedSentinel },
            createdAt: "2097-06-01T00:00:00Z",
          });
          const actorName = (await database.query<{ full_name: string }>(
            "select full_name from public.user_profiles where id = $1::uuid",
            [fixture.actors.admin.profileId],
          )).rows[0]!.full_name;
          for (const searchText of [
            "mixed case", "TASK137.SPECIAL_ACTION",
            "TASK137_SPECIAL_ENTITY", entityId.slice(0, 12),
            actorName.toUpperCase(), "  mixed case  ", "   ",
          ]) {
            const rows = await callPage(database, fixture.actors.admin, { searchText });
            if (searchText.trim()) expect(rows.map((row) => row.audit_log_id)).toContain(id);
            else expect(rows.length).toBeGreaterThan(0);
          }
          expect(await callPage(database, fixture.actors.admin, {
            searchText: protectedSentinel,
          })).toEqual([]);
          expect(await callPage(database, fixture.actors.admin, {
            searchText: "definitely-no-match-task137",
          })).toEqual([]);
          expect(await callPage(database, fixture.actors.admin, {
            searchText: "x".repeat(200),
          })).toEqual([]);
          await expectRejected(database, fixture.actors.admin, pageSql, [
            50, null, null, null, null, null, null, null, "x".repeat(201),
          ], "22023");
        });
      });

      it("keeps filtered keyset ordering and continuation duplicate-free", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const ids = [
            "ffffffff-ffff-4fff-8fff-ffffffffffff",
            "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          ];
          for (const id of ids) {
            await database.query(
              `insert into public.audit_logs (
                 id, actor_user_id, action_type, entity_type, summary, created_at
               ) values ($1::uuid, $2::uuid, 'task137.page', 'task137_page', $1::text,
                 '2097-07-01T00:00:00Z'::timestamptz)`,
              [id, fixture.actors.admin.profileId],
            );
          }
          const first = await callPage(database, fixture.actors.admin, {
            entityType: "task137_page",
          }, null, 2);
          const second = await callPage(database, fixture.actors.admin, {
            entityType: "task137_page",
          }, {
            createdAt: first[1]!.created_at.toISOString(),
            id: first[1]!.audit_log_id,
          }, 2);
          expect(first.map((row) => row.audit_log_id)).toEqual(ids.slice(0, 2));
          expect(second.map((row) => row.audit_log_id)).toEqual(ids.slice(2));
          expect(new Set([...first, ...second].map((row) => row.audit_log_id)).size).toBe(3);

          const terminal = await callPage(database, fixture.actors.admin, {
            entityType: "task137_page",
          }, {
            createdAt: second[0]!.created_at.toISOString(),
            id: second[0]!.audit_log_id,
          }, 2);
          expect(terminal).toEqual([]);

          const newerId = await insertAudit(database, {
            actorId: fixture.actors.admin.profileId,
            actionType: "task137.page",
            entityType: "task137_page",
            summary: "Newer matching append",
            createdAt: "2097-07-02T00:00:00Z",
          });
          const continuationAfterAppend = await callPage(
            database,
            fixture.actors.admin,
            { entityType: "task137_page" },
            {
              createdAt: first[1]!.created_at.toISOString(),
              id: first[1]!.audit_log_id,
            },
            2,
          );
          expect(continuationAfterAppend.map((row) => row.audit_log_id))
            .toEqual(ids.slice(2));
          const freshFirstPage = await callPage(database, fixture.actors.admin, {
            entityType: "task137_page",
          }, null, 2);
          expect(freshFirstPage[0]!.audit_log_id).toBe(newerId);
          expect(continuationAfterAppend.map((row) => row.audit_log_id))
            .not.toContain(newerId);
        });
      });

      it("returns deterministic narrow options including inactive historical actors only", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          await insertAudit(database, {
            actorId: fixture.actors.inactive.profileId,
            actionType: "task137.option",
            entityType: "task137_option",
            summary: "Inactive historical actor option",
            createdAt: "2097-08-01T00:00:00Z",
          });
          const options = await callOptions(database, fixture.actors.admin);
          const inactiveName = (await database.query<{ full_name: string }>(
            "select full_name from public.user_profiles where id = $1::uuid",
            [fixture.actors.inactive.profileId],
          )).rows[0]!.full_name;
          expect(Object.keys(options).sort()).toEqual([
            "action_types", "actors", "entity_types",
          ]);
          expect(options.actors.find((actor) =>
            actor.user_id === fixture.actors.inactive.profileId
          )?.full_name).toBe(inactiveName);
          expect((await callPage(database, fixture.actors.admin, {
            actorUserId: fixture.actors.inactive.profileId,
          })).some((row) => row.actor_user_id === fixture.actors.inactive.profileId))
            .toBe(true);
          expect(options.actors.every((actor) =>
            Object.keys(actor).sort().join(",") === "full_name,user_id"
          )).toBe(true);
          const expectedActors = (await database.query<{
            user_id: string;
            full_name: string;
          }>(
            `select actor.id as user_id, actor.full_name
             from public.user_profiles as actor
             where exists (
               select 1
               from public.audit_logs as audit
               where audit.actor_user_id = actor.id
             )
             order by
               pg_catalog.lower(actor.full_name),
               actor.full_name,
               actor.id`,
          )).rows;
          const expectedEntityTypes = (await database.query<{ entity_type: string }>(
            `select distinct audit.entity_type
             from public.audit_logs as audit
             order by audit.entity_type`,
          )).rows.map((row) => row.entity_type);
          const expectedActionTypes = (await database.query<{ action_type: string }>(
            `select distinct audit.action_type
             from public.audit_logs as audit
             order by audit.action_type`,
          )).rows.map((row) => row.action_type);

          expect(options.actors).toEqual(expectedActors);
          expect(options.entity_types).toEqual(expectedEntityTypes);
          expect(options.action_types).toEqual(expectedActionTypes);

          await grantArchiveView(database, fixture, fixture.actors.permitted);
          expect((await callOptions(database, fixture.actors.permitted)).actors)
            .toEqual(options.actors);
          const optionsSql = "select public.get_audit_log_filter_options()";
          await expectRejected(database, fixture.actors.unpermitted, optionsSql, [], "42501");
          await grantArchiveView(database, fixture, fixture.actors.inactive);
          await expectRejected(database, fixture.actors.inactive, optionsSql, [], "42501");
          await expectRejected(database, null, optionsSql, [], "42501");
        });
      });

      it("keeps both reads side-effect free with narrow metadata and ACLs", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const before = (await database.query<{ count: string }>(
            "select count(*)::text as count from public.audit_logs",
          )).rows[0]!.count;
          const page = await callPage(database, fixture.actors.admin);
          await callOptions(database, fixture.actors.admin);
          const after = (await database.query<{ count: string }>(
            "select count(*)::text as count from public.audit_logs",
          )).rows[0]!.count;
          expect(after).toBe(before);
          if (page[0]) expect(Object.keys(page[0]).sort()).toEqual([
            "action_type", "actor_full_name", "actor_user_id", "audit_log_id",
            "created_at", "entity_id", "entity_type", "summary",
          ]);

          const metadata = await database.query<{
            proname: string;
            prosecdef: boolean;
            provolatile: string;
            config: string[] | null;
            public_execute: boolean;
            anon_execute: boolean;
            authenticated_execute: boolean;
          }>(
            `select procedure.proname, procedure.prosecdef, procedure.provolatile,
                    procedure.proconfig as config,
                    pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE') as public_execute,
                    pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE') as anon_execute,
                    pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as authenticated_execute
             from pg_catalog.pg_proc as procedure
             join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'public'
               and procedure.proname in ('list_audit_log_page', 'get_audit_log_filter_options')
             order by procedure.proname`,
          );
          expect(metadata.rows).toHaveLength(2);
          for (const row of metadata.rows) {
            expect(row).toMatchObject({
              prosecdef: true,
              provolatile: "s",
              config: ["search_path=\"\""],
              public_execute: false,
              anon_execute: false,
              authenticated_execute: true,
            });
          }

          const indexes = (await database.query<{ indexname: string }>(
            `select indexname
             from pg_catalog.pg_indexes
             where schemaname = 'public'
               and indexname in (
                 'audit_logs_created_at_id_idx',
                 'audit_logs_actor_user_id_created_at_id_idx',
                 'audit_logs_entity_type_created_at_id_idx',
                 'audit_logs_action_type_created_at_id_idx'
               )
             order by indexname`,
          )).rows.map((row) => row.indexname);
          expect(indexes).toEqual([
            "audit_logs_action_type_created_at_id_idx",
            "audit_logs_actor_user_id_created_at_id_idx",
            "audit_logs_created_at_id_idx",
            "audit_logs_entity_type_created_at_id_idx",
          ]);
          const trigramExtension = (await database.query<{ schema_name: string }>(
            `select namespace.nspname as schema_name
             from pg_catalog.pg_extension as extension
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = extension.extnamespace
             where extension.extname = 'pg_trgm'`,
          )).rows;
          expect(trigramExtension).toEqual([{ schema_name: "extensions" }]);
          expect(readFileSync(migrationPath, "utf8"))
            .not.toMatch(/create\s+extension|pg_trgm/i);
        });
      });
    },
  );
}
