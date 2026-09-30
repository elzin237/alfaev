import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260930160000_add_derived_birthday_calendar_read.sql",
);

interface BirthdayRow extends QueryResultRow {
  birthday: Date | string;
  full_name: string;
  user_id: string;
}

function normalizeDateOnly(value: Date | string): string {
  if (typeof value === "string") {
    return value;
  }

  if (Number.isNaN(value.getTime())) {
    throw new Error("Birthday query returned an invalid date");
  }

  return new Date(Date.UTC(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  )).toISOString().slice(0, 10);
}

async function callBirthdaysAs(
  database: PoolClient,
  actor: SecurityActor | null,
): Promise<BirthdayRow[]> {
  await database.query("savepoint calendar_birthday_read");
  try {
    await database.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
      [actor?.authUserId ?? ""],
    );
    await database.query(actor ? "set local role authenticated" : "set local role anon");
    const rows = (await database.query<BirthdayRow>(
      "select * from public.list_calendar_birthdays()",
    )).rows;
    await database.query("reset role");
    await database.query("release savepoint calendar_birthday_read");
    return rows;
  } catch (error) {
    await database.query("rollback to savepoint calendar_birthday_read");
    await database.query("release savepoint calendar_birthday_read");
    throw error;
  }
}

async function readTableSnapshot(
  database: PoolClient,
  tableName: "audit_logs" | "calendar_entries" | "user_permissions" | "user_profiles",
): Promise<string> {
  const result = await database.query<{ snapshot: string }>(
    `select coalesce(
       pg_catalog.string_agg(
         pg_catalog.to_jsonb(snapshot_row)::text,
         E'\\n'
         order by pg_catalog.to_jsonb(snapshot_row)::text
       ),
       ''
     ) as snapshot
     from public.${tableName} as snapshot_row`,
  );

  return result.rows[0]?.snapshot ?? "";
}

async function expectStatementRejected(
  database: PoolClient,
  sql: string,
  values: unknown[],
  code: string,
): Promise<void> {
  await database.query("savepoint rejected_calendar_birthday_statement");
  try {
    await expect(database.query(sql, values)).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback to savepoint rejected_calendar_birthday_statement");
    await database.query("release savepoint rejected_calendar_birthday_statement");
  }
}

export function registerCalendarBirthdayTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 132 Derived Birthday Calendar read (static)", () => {
    it("defines one narrow active-user read without persistence or Users grants", () => {
      const sql = readFileSync(migrationPath, "utf8");

      expect(sql).toContain("create function public.list_calendar_birthdays()");
      expect(sql).toContain("returns table (\n  user_id uuid,\n  full_name text,\n  birthday date\n)");
      expect(sql).toContain("language plpgsql");
      expect(sql).toContain("stable");
      expect(sql).toContain("security definer");
      expect(sql).toContain("set search_path = ''");
      expect(sql).toContain("if auth.uid() is null");
      expect(sql).toContain("or public.current_active_user_profile_id() is null");
      expect(sql).toContain("raise exception 'Access denied'");
      expect(sql).toContain("using errcode = '42501'");
      expect(sql).toContain("from public.user_profiles as profile");
      expect(sql).toContain("where profile.is_active");
      expect(sql).toContain("and profile.birthday is not null");
      expect(sql).toContain("pg_catalog.date_part('month', profile.birthday)");
      expect(sql).toContain("pg_catalog.date_part('day', profile.birthday)");
      expect(sql).toContain("profile.full_name,\n    profile.id");
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain("to authenticated");

      expect(sql).not.toMatch(/insert\s+into/i);
      expect(sql).not.toMatch(/update\s+public\./i);
      expect(sql).not.toMatch(/delete\s+from/i);
      expect(sql).not.toMatch(/alter\s+table\s+public\.user_profiles/i);
      expect(sql).not.toMatch(/(?:grant|revoke).*table\s+public\.user_profiles/is);
      expect(sql).not.toContain("public.user_permissions");
      expect(sql).not.toContain("auth.users");
      expect(sql).not.toContain("public.calendar_entries");
      expect(sql).not.toContain("public.audit_logs");
      expect(sql).not.toContain("calendar.view");
      expect(sql).not.toContain("age(");
      expect(sql).not.toContain("current_date");
    });
  });

  describe.skipIf(process.env.TASK132_MIGRATION !== "1")(
    "Task 132 Derived Birthday Calendar read (requires deployed migration)",
    () => {
      it("allows every active actor class and denies inactive or anonymous callers", async () => {
        const fixture = requireHarness();

        for (const actor of [
          fixture.actors.admin,
          fixture.actors.permitted,
          fixture.actors.unpermitted,
        ]) {
          const { data, error } = await actor.client.rpc("list_calendar_birthdays");

          expect(error).toBeNull();
          expect(Array.isArray(data)).toBe(true);
        }

        for (const client of [
          fixture.actors.inactive.client,
          fixture.actors.inactiveBrandManager.client,
          fixture.anonymousClient,
        ]) {
          const { error } = await client.rpc("list_calendar_birthdays");

          expectPermissionDenied(error);
        }
      });

      it("returns only active birthdays in deterministic calendar order with exact dates", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const sameNameActors = [
            fixture.actors.productCreator,
            fixture.actors.productEditor,
          ].sort((left, right) => left.profileId.localeCompare(right.profileId));
          const profileValues = [
            [fixture.actors.permitted.profileId, "Alpha January", "2001-01-15"],
            [fixture.actors.admin.profileId, "Zulu January", "1984-01-15"],
            [fixture.actors.supplierViewer.profileId, "Leap Person", "1992-02-29"],
            [sameNameActors[0]?.profileId, "Same Name", "1970-03-01"],
            [sameNameActors[1]?.profileId, "Same Name", "2005-03-01"],
            [fixture.actors.inactive.profileId, "Inactive First", "1960-01-01"],
          ] as const;

          for (const [profileId, fullName, birthday] of profileValues) {
            await database.query(
              `update public.user_profiles
               set full_name = $2::text,
                   birthday = $3::date
               where id = $1::uuid`,
              [profileId, fullName, birthday],
            );
          }

          const rows = await callBirthdaysAs(database, fixture.actors.unpermitted);
          const targetIds = new Set(profileValues.map(([profileId]) => profileId));
          const selectedRows = rows
            .filter((row) => targetIds.has(row.user_id))
            .map((row) => ({
              ...row,
              birthday: normalizeDateOnly(row.birthday),
            }));

          expect(selectedRows).toEqual([
            {
              birthday: "2001-01-15",
              full_name: "Alpha January",
              user_id: fixture.actors.permitted.profileId,
            },
            {
              birthday: "1984-01-15",
              full_name: "Zulu January",
              user_id: fixture.actors.admin.profileId,
            },
            {
              birthday: "1992-02-29",
              full_name: "Leap Person",
              user_id: fixture.actors.supplierViewer.profileId,
            },
            {
              birthday: "1970-03-01",
              full_name: "Same Name",
              user_id: sameNameActors[0]?.profileId,
            },
            {
              birthday: "2005-03-01",
              full_name: "Same Name",
              user_id: sameNameActors[1]?.profileId,
            },
          ]);
          expect(selectedRows.every((row) => Object.keys(row).sort().join(",") ===
            "birthday,full_name,user_id")).toBe(true);
          expect(selectedRows.some((row) => row.user_id === fixture.actors.inactive.profileId))
            .toBe(false);
        });
      });

      it("keeps null birthdays excluded without weakening the existing required field", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const birthdayColumn = (await database.query<{ is_nullable: string }>(
            `select is_nullable
             from information_schema.columns
             where table_schema = 'public'
               and table_name = 'user_profiles'
               and column_name = 'birthday'`,
          )).rows[0];
          const definition = (await database.query<{ definition: string }>(
            `select pg_catalog.pg_get_functiondef(procedure.oid) as definition
             from pg_catalog.pg_proc as procedure
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'public'
               and procedure.proname = 'list_calendar_birthdays'
               and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''`,
          )).rows[0]?.definition.toLowerCase();

          expect(birthdayColumn).toEqual({ is_nullable: "NO" });
          expect(definition).toContain("profile.birthday is not null");
        });
      });

      it("crosses only the narrow Calendar boundary while Users access stays isolated", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const rows = await callBirthdaysAs(database, fixture.actors.unpermitted);
          expect(rows.length).toBeGreaterThan(0);
          for (const row of rows) {
            expect(Object.keys(row).sort()).toEqual(["birthday", "full_name", "user_id"]);
          }

          await database.query(
            "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
            [fixture.actors.unpermitted.authUserId],
          );
          await database.query("set local role authenticated");
          const arbitraryProfile = await database.query(
            `select *
             from public.user_profiles
             where id = $1::uuid`,
            [fixture.actors.admin.profileId],
          );
          expect(arbitraryProfile.rows).toEqual([]);
          await expectPermissionDenied(
            (await fixture.actors.unpermitted.client.rpc("list_users_admin")).error,
          );
          await database.query("reset role");

          const policies = (await database.query<{ policy_name: string }>(
            `select policyname as policy_name
             from pg_catalog.pg_policies
             where schemaname = 'public'
               and tablename = 'user_profiles'
             order by policyname`,
          )).rows;
          expect(policies).toEqual([{ policy_name: "user_profiles_select_own" }]);
          expect((await database.query<{ allowed: boolean }>(
            `select pg_catalog.has_table_privilege(
               'authenticated', 'public.user_profiles', 'select'
             ) as allowed`,
          )).rows).toEqual([{ allowed: true }]);
          expect((await database.query<{ allowed: boolean }>(
            `select pg_catalog.has_table_privilege(
               'anon', 'public.user_profiles', 'select'
             ) as allowed`,
          )).rows).toEqual([{ allowed: false }]);
        });
      });

      it("does not persist birthdays, allow a birthday CalendarEntry, audit, or mutate state", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const tables = [
            "user_profiles",
            "user_permissions",
            "calendar_entries",
            "audit_logs",
          ] as const;
          const before = Object.fromEntries(await Promise.all(
            tables.map(async (table) => [table, await readTableSnapshot(database, table)]),
          ));

          await callBirthdaysAs(database, fixture.actors.unpermitted);

          const after = Object.fromEntries(await Promise.all(
            tables.map(async (table) => [table, await readTableSnapshot(database, table)]),
          ));
          expect(after).toEqual(before);

          await expectStatementRejected(
            database,
            `insert into public.calendar_entries (
               entry_type, title, start_date, end_date,
               created_by_user_id, updated_by_user_id
             ) values (
               'birthday', 'Not persisted', '2026-01-01', '2026-01-01',
               $1::uuid, $1::uuid
             )`,
            [fixture.actors.admin.profileId],
            "23514",
          );
        });
      });

      it("has the exact narrow return type and hardened authenticated-only metadata", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const metadata = (await database.query<{
            anon_execute: boolean;
            authenticated_execute: boolean;
            definition: string;
            is_security_definer: boolean;
            is_stable: boolean;
            public_execute: boolean;
            result_type: string;
            search_path: string[] | null;
          }>(
            `select
               procedure.provolatile = 's' as is_stable,
               procedure.prosecdef as is_security_definer,
               procedure.proconfig as search_path,
               pg_catalog.pg_get_function_result(procedure.oid) as result_type,
               pg_catalog.pg_get_functiondef(procedure.oid) as definition,
               pg_catalog.has_function_privilege(
                 'anon', procedure.oid, 'execute'
               ) as anon_execute,
               pg_catalog.has_function_privilege(
                 'authenticated', procedure.oid, 'execute'
               ) as authenticated_execute,
               exists (
                 select 1
                 from pg_catalog.aclexplode(procedure.proacl) as privilege
                 where privilege.grantee = 0
                   and privilege.privilege_type = 'EXECUTE'
               ) as public_execute
             from pg_catalog.pg_proc as procedure
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'public'
               and procedure.proname = 'list_calendar_birthdays'
               and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''`,
          )).rows[0];

          expect(metadata).toMatchObject({
            anon_execute: false,
            authenticated_execute: true,
            is_security_definer: true,
            is_stable: true,
            public_execute: false,
            result_type: "TABLE(user_id uuid, full_name text, birthday date)",
            search_path: ["search_path=\"\""],
          });
          expect(metadata?.definition).not.toContain("auth_user_id");
          expect(metadata?.definition).not.toContain("email");
          expect(metadata?.definition).not.toContain("is_admin");
          expect(metadata?.definition).not.toContain("created_at");
          expect(metadata?.definition).not.toContain("last_login_at");
          expect(metadata?.definition).not.toContain("deactivated_at");
          expect(metadata?.definition).not.toContain("deactivated_by_user_id");
          expect(metadata?.definition).not.toContain("user_permissions");
        });
      });
    },
  );
}
