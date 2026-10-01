import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261001090000_add_admin_calendar_management.sql",
);

const createSql = `select
  calendar_entry_id,
  calendar_entry_updated_at::text as calendar_entry_updated_at
from public.create_calendar_entry(
  $1::text, $2::text, $3::date, $4::date, $5::text, $6::uuid
)`;
const updateSql = `select
  calendar_entry_id,
  calendar_entry_updated_at::text as calendar_entry_updated_at
from public.update_calendar_entry(
  $1::uuid, $2::text, $3::text, $4::date, $5::date,
  $6::text, $7::uuid, $8::timestamptz
)`;
const deleteSql = `select
  calendar_entry_id,
  calendar_entry_updated_at::text as calendar_entry_updated_at
from public.delete_calendar_entry($1::uuid, $2::timestamptz)`;

async function setActor(database: PoolClient, actor: SecurityActor | null) {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor?.authUserId ?? ""],
  );
  await database.query(actor ? "set local role authenticated" : "set local role anon");
}

async function callAs<Row extends QueryResultRow>(
  database: PoolClient,
  actor: SecurityActor,
  sql: string,
  values: unknown[],
): Promise<Row[]> {
  await setActor(database, actor);
  try {
    return (await database.query<Row>(sql, values)).rows;
  } finally {
    await database.query("reset role");
  }
}

async function expectCallRejected(
  database: PoolClient,
  actor: SecurityActor | null,
  sql: string,
  values: unknown[],
  code: string,
): Promise<void> {
  await database.query("savepoint rejected_calendar_management_call");
  await setActor(database, actor);
  try {
    await expect(database.query(sql, values)).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback to savepoint rejected_calendar_management_call");
    await database.query("release savepoint rejected_calendar_management_call");
  }
}

async function createEntry(
  database: PoolClient,
  actor: SecurityActor,
  overrides: Partial<{
    description: string | null;
    endDate: string;
    entryType: string;
    relatedUserId: string | null;
    startDate: string;
    title: string;
  }> = {},
) {
  return (await callAs<{
    calendar_entry_id: string;
    calendar_entry_updated_at: string;
  }>(database, actor, createSql, [
    overrides.entryType ?? "event",
    overrides.title ?? "Calendar fixture",
    overrides.startDate ?? "2026-10-10",
    overrides.endDate ?? "2026-10-10",
    overrides.description ?? null,
    overrides.relatedUserId ?? null,
  ]))[0]!;
}

export function registerCalendarManagementTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 134 Admin Calendar management (static)", () => {
    it("defines hardened Admin-only employee/create/update/delete boundaries", () => {
      const sql = readFileSync(migrationPath, "utf8");

      for (const signature of [
        "create function public.list_calendar_employee_choices()",
        "create function public.create_calendar_entry(",
        "create function public.update_calendar_entry(",
        "create function public.delete_calendar_entry(",
      ]) expect(sql).toContain(signature);
      expect(sql.match(/security definer/g)).toHaveLength(4);
      expect(sql.match(/set search_path = ''/g)).toHaveLength(4);
      expect(sql.match(/not public\.current_user_is_admin\(\)/g)?.length)
        .toBeGreaterThanOrEqual(6);
      expect(sql).toContain("for update");
      expect(sql).toContain("using errcode = 'CAL01'");
      expect(sql).toContain("current_entry.updated_at is distinct from p_expected_updated_at");
      expect(sql).toContain("current_entry.related_user_id is not distinct from p_related_user_id");
      expect(sql).toContain("'calendar.created'");
      expect(sql).toContain("'calendar.updated'");
      expect(sql).toContain("'calendar.deleted'");
      expect(sql.match(/public\.append_audit_log/g)).toHaveLength(3);
      expect(sql).toContain("delete from public.calendar_entries as entry");
      expect(sql).toContain("p_after_data => null");
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql.match(/to authenticated;/g)).toHaveLength(4);
      expect(sql).not.toContain("calendar.manage");
      expect(sql).not.toContain("calendar.view");
      expect(sql).not.toContain("'birthday'");
      expect(sql).not.toMatch(/alter table public\.calendar_entries/i);
      expect(sql).not.toMatch(/create policy/i);
      expect(sql).not.toMatch(/grant (insert|update|delete).*calendar_entries/is);
    });

    it("keeps audit payloads to normalized business fields and employee choices narrow", () => {
      const sql = readFileSync(migrationPath, "utf8");
      expect(sql).toContain("returns table (\n  user_id uuid,\n  full_name text\n)");
      expect(sql).not.toContain("profile.email");
      expect(sql).not.toContain("profile.is_admin");
      expect(sql).not.toContain("profile.is_active");
      for (const field of [
        "'entry_type'", "'title'", "'start_date'", "'end_date'",
        "'description'", "'related_user_id'",
      ]) expect(sql).toContain(field);
      expect(sql).not.toContain("'updated_by_user_id'");
      expect(sql).not.toContain("'created_by_user_id'");
    });
  });

  describe.skipIf(process.env.TASK134_MIGRATION !== "1")(
    "Task 134 Admin Calendar management (requires deployed migration)",
    () => {
      it("allows active Admin only, including the employee-choice lookup", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const input = ["event", "Authorized", "2026-10-10", "2026-10-10", null, null];
          const created = await callAs(database, fixture.actors.admin, createSql, input);
          expect(created).toHaveLength(1);
          const entryId = (created[0] as { calendar_entry_id: string }).calendar_entry_id;
          const updatedAt = (created[0] as { calendar_entry_updated_at: string })
            .calendar_entry_updated_at;

          for (const actor of [
            fixture.actors.permitted,
            fixture.actors.unpermitted,
            fixture.actors.productCreator,
            fixture.actors.inactiveBrandManager,
          ]) {
            await expectCallRejected(database, actor, createSql, input, "42501");
          }
          await expectCallRejected(database, null, createSql, input, "42501");
          for (const actor of [
            fixture.actors.permitted,
            fixture.actors.unpermitted,
            fixture.actors.inactiveBrandManager,
          ]) {
            await expectCallRejected(database, actor, updateSql, [
              entryId, "event", "Denied", "2026-10-10", "2026-10-10",
              null, null, updatedAt,
            ], "42501");
            await expectCallRejected(database, actor, deleteSql,
              [entryId, updatedAt], "42501");
          }
          await expectCallRejected(database, null, updateSql, [
            entryId, "event", "Denied", "2026-10-10", "2026-10-10",
            null, null, updatedAt,
          ], "42501");
          await expectCallRejected(database, null, deleteSql,
            [entryId, updatedAt], "42501");

          const choices = await callAs<{ user_id: string; full_name: string }>(
            database,
            fixture.actors.admin,
            "select * from public.list_calendar_employee_choices()",
            [],
          );
          expect(choices.length).toBeGreaterThan(0);
          expect(choices.every((choice) =>
            Object.keys(choice).sort().join(",") === "full_name,user_id"
          )).toBe(true);
          await expectCallRejected(
            database, fixture.actors.unpermitted,
            "select * from public.list_calendar_employee_choices()", [], "42501",
          );
        });
      });

      it("creates normalized state with server metadata and exactly one audit", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const created = await createEntry(database, fixture.actors.admin, {
            title: "  Normalized title  ",
            description: "   ",
            relatedUserId: fixture.actors.inactiveBrandManager.profileId,
          });
          const row = (await database.query(
            "select * from public.calendar_entries where id = $1::uuid",
            [created.calendar_entry_id],
          )).rows[0];
          expect(row).toMatchObject({
            entry_type: "event",
            title: "Normalized title",
            description: null,
            related_user_id: fixture.actors.inactiveBrandManager.profileId,
            created_by_user_id: fixture.actors.admin.profileId,
            updated_by_user_id: fixture.actors.admin.profileId,
          });
          expect(row.created_at.toISOString()).toBe(row.updated_at.toISOString());

          const audits = (await database.query(
            `select action_type, entity_type, actor_user_id, before_data, after_data
             from public.audit_logs where entity_id = $1::uuid`,
            [created.calendar_entry_id],
          )).rows;
          expect(audits).toEqual([expect.objectContaining({
            action_type: "calendar.created",
            entity_type: "calendar_entry",
            actor_user_id: fixture.actors.admin.profileId,
            before_data: null,
            after_data: {
              entry_type: "event",
              title: "Normalized title",
              start_date: "2026-10-10",
              end_date: "2026-10-10",
              description: null,
              related_user_id: fixture.actors.inactiveBrandManager.profileId,
            },
          })]);

          for (const [values, code] of [
            [["birthday", "Bad", "2026-10-10", "2026-10-10", null, null], "22023"],
            [["event", "   ", "2026-10-10", "2026-10-10", null, null], "22023"],
            [["event", "Backwards", "2026-10-11", "2026-10-10", null, null], "22023"],
            [["event", "Missing person", "2026-10-10", "2026-10-10", null, randomUUID()], "P0002"],
          ] as const) {
            await expectCallRejected(database, fixture.actors.admin, createSql, [...values], code);
          }
        });
      });

      it("updates meaningfully, preserves creation metadata, rejects stale state, and keeps no-op silent", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const created = await createEntry(database, fixture.actors.admin, {
            description: "Before",
          });
          const before = (await database.query(
            "select * from public.calendar_entries where id = $1::uuid",
            [created.calendar_entry_id],
          )).rows[0];
          const auditCountBefore = (await database.query<{ count: string }>(
            "select count(*) from public.audit_logs where entity_id = $1::uuid",
            [created.calendar_entry_id],
          )).rows[0]!.count;

          const noOp = await callAs<{ calendar_entry_updated_at: string }>(
            database, fixture.actors.admin, updateSql,
            [created.calendar_entry_id, "event", "  Calendar fixture  ", "2026-10-10", "2026-10-10", " Before ", null, created.calendar_entry_updated_at],
          );
          expect(noOp[0]?.calendar_entry_updated_at).toBe(created.calendar_entry_updated_at);
          expect((await database.query<{ count: string }>(
            "select count(*) from public.audit_logs where entity_id = $1::uuid",
            [created.calendar_entry_id],
          )).rows[0]!.count).toBe(auditCountBefore);

          await callAs(database, fixture.actors.admin, updateSql, [
            created.calendar_entry_id, "vacation", "Updated title",
            "2026-10-12", "2026-10-14", " After ",
            fixture.actors.inactiveBrandManager.profileId,
            created.calendar_entry_updated_at,
          ]);
          const after = (await database.query(
            "select * from public.calendar_entries where id = $1::uuid",
            [created.calendar_entry_id],
          )).rows[0];
          expect(after).toMatchObject({
            entry_type: "vacation",
            title: "Updated title",
            description: "After",
            related_user_id: fixture.actors.inactiveBrandManager.profileId,
            updated_by_user_id: fixture.actors.admin.profileId,
          });
          expect(after.created_at.toISOString()).toBe(before.created_at.toISOString());
          expect(after.created_by_user_id).toBe(before.created_by_user_id);
          expect(after.updated_at.toISOString()).not.toBe(before.updated_at.toISOString());
          expect((await database.query(
            `select action_type, before_data, after_data from public.audit_logs
             where entity_id = $1::uuid and action_type = 'calendar.updated'`,
            [created.calendar_entry_id],
          )).rows).toEqual([expect.objectContaining({
            action_type: "calendar.updated",
            before_data: expect.objectContaining({ title: "Calendar fixture" }),
            after_data: expect.objectContaining({ title: "Updated title" }),
          })]);

          await expectCallRejected(database, fixture.actors.admin, updateSql, [
            created.calendar_entry_id, "event", "Stale overwrite", "2026-10-10",
            "2026-10-10", null, null, created.calendar_entry_updated_at,
          ], "CAL01");
          await expectCallRejected(database, fixture.actors.admin, updateSql, [
            randomUUID(), "event", "Missing", "2026-10-10", "2026-10-10",
            null, null, created.calendar_entry_updated_at,
          ], "P0002");
          expect((await database.query<{ title: string }>(
            "select title from public.calendar_entries where id = $1::uuid",
            [created.calendar_entry_id],
          )).rows).toEqual([{ title: "Updated title" }]);
        });
      });

      it("deletes exactly one row with before-only audit and rejects stale/non-Admin attempts", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const target = await createEntry(database, fixture.actors.admin, { title: "Remove me" });
          await expectCallRejected(database, fixture.actors.unpermitted, deleteSql,
            [target.calendar_entry_id, target.calendar_entry_updated_at], "42501");
          await expectCallRejected(database, fixture.actors.admin, deleteSql,
            [target.calendar_entry_id, "2000-01-01T00:00:00+00:00"], "CAL01");
          expect((await database.query(
            "select id from public.calendar_entries where id = $1::uuid",
            [target.calendar_entry_id],
          )).rows).toHaveLength(1);

          await callAs(database, fixture.actors.admin, deleteSql,
            [target.calendar_entry_id, target.calendar_entry_updated_at]);
          expect((await database.query(
            "select id from public.calendar_entries where id = $1::uuid",
            [target.calendar_entry_id],
          )).rows).toEqual([]);
          expect((await database.query(
            `select action_type, entity_type, before_data, after_data
             from public.audit_logs
             where entity_id = $1::uuid and action_type = 'calendar.deleted'`,
            [target.calendar_entry_id],
          )).rows).toEqual([expect.objectContaining({
            action_type: "calendar.deleted",
            entity_type: "calendar_entry",
            before_data: expect.objectContaining({ title: "Remove me" }),
            after_data: null,
          })]);
          await expectCallRejected(database, fixture.actors.admin, deleteSql,
            [target.calendar_entry_id, target.calendar_entry_updated_at], "P0002");
        });
      });

      it("rolls back create, update, and delete when their audit append fails", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const updateTarget = await createEntry(database, fixture.actors.admin, { title: "Update rollback" });
          const deleteTarget = await createEntry(database, fixture.actors.admin, { title: "Delete rollback" });
          const beforeUpdate = (await database.query(
            "select * from public.calendar_entries where id = $1::uuid",
            [updateTarget.calendar_entry_id],
          )).rows[0];
          await database.query(
            `create function pg_temp.reject_calendar_audit()
             returns trigger language plpgsql set search_path = ''
             as $test_function$
             begin
               if new.action_type = pg_catalog.current_setting('test.reject_calendar_action', true) then
                 raise exception 'Forced Calendar audit failure' using errcode = 'TCA01';
               end if;
               return new;
             end;
             $test_function$`,
          );
          await database.query(
            `create trigger reject_calendar_audit_test before insert on public.audit_logs
             for each row execute function pg_temp.reject_calendar_audit()`,
          );

          await database.query("select pg_catalog.set_config('test.reject_calendar_action', 'calendar.created', true)");
          await expectCallRejected(database, fixture.actors.admin, createSql,
            ["event", "Create rollback", "2026-10-10", "2026-10-10", null, null], "TCA01");
          expect((await database.query(
            "select id from public.calendar_entries where title = 'Create rollback'",
          )).rows).toEqual([]);

          await database.query("select pg_catalog.set_config('test.reject_calendar_action', 'calendar.updated', true)");
          await expectCallRejected(database, fixture.actors.admin, updateSql, [
            updateTarget.calendar_entry_id, "event", "Changed", "2026-10-10",
            "2026-10-10", null, null, updateTarget.calendar_entry_updated_at,
          ], "TCA01");
          expect((await database.query(
            "select * from public.calendar_entries where id = $1::uuid",
            [updateTarget.calendar_entry_id],
          )).rows).toEqual([beforeUpdate]);

          await database.query("select pg_catalog.set_config('test.reject_calendar_action', 'calendar.deleted', true)");
          await expectCallRejected(database, fixture.actors.admin, deleteSql,
            [deleteTarget.calendar_entry_id, deleteTarget.calendar_entry_updated_at], "TCA01");
          expect((await database.query(
            "select id from public.calendar_entries where id = $1::uuid",
            [deleteTarget.calendar_entry_id],
          )).rows).toHaveLength(1);
        });
      });

      it("keeps table RLS/read policy unchanged and hardens exact function ACLs", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const functions = (await database.query<{
            authenticated_execute: boolean;
            function_name: string;
            is_security_definer: boolean;
            public_execute: boolean;
            volatility: string;
          }>(
            `select
               procedure.proname as function_name,
               procedure.prosecdef as is_security_definer,
               procedure.provolatile as volatility,
               pg_catalog.has_function_privilege(
                 'authenticated', procedure.oid, 'execute'
               ) as authenticated_execute,
               pg_catalog.has_function_privilege(
                 'anon', procedure.oid, 'execute'
               ) or exists (
                 select 1 from pg_catalog.aclexplode(procedure.proacl) as acl
                 where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
               ) as public_execute
             from pg_catalog.pg_proc as procedure
             join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'public'
               and procedure.proname in (
                 'list_calendar_employee_choices', 'create_calendar_entry',
                 'update_calendar_entry', 'delete_calendar_entry'
               )
             order by procedure.proname`,
          )).rows;
          expect(functions).toHaveLength(4);
          expect(functions.every((row) => row.authenticated_execute &&
            row.is_security_definer && !row.public_execute)).toBe(true);
          expect(functions.find((row) => row.function_name === "list_calendar_employee_choices")?.volatility)
            .toBe("s");
          expect(functions.filter((row) => row.function_name !== "list_calendar_employee_choices")
            .every((row) => row.volatility === "v")).toBe(true);

          expect((await database.query(
            `select cmd, roles::text[], qual from pg_catalog.pg_policies
             where schemaname = 'public' and tablename = 'calendar_entries'`,
          )).rows).toEqual([{
            cmd: "SELECT",
            roles: ["authenticated"],
            qual: "is_active_user()",
          }]);
          expect((await database.query<{ count: string }>(
            "select count(*) from public.permission_definitions where key like 'calendar.%'",
          )).rows).toEqual([{ count: "0" }]);
        });
      });
    },
  );
}
