import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260930150000_create_calendar_entry_schema.sql",
);

async function expectStatementRejected(
  database: PoolClient,
  sql: string,
  values: unknown[],
  code: string,
): Promise<void> {
  await database.query("savepoint rejected_calendar_statement");
  try {
    await expect(database.query(sql, values)).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback to savepoint rejected_calendar_statement");
    await database.query("release savepoint rejected_calendar_statement");
  }
}

async function readCalendarAs<Row extends QueryResultRow>(
  database: PoolClient,
  actor: SecurityActor | null,
  ids: string[],
): Promise<Row[]> {
  await database.query("savepoint calendar_read");
  try {
    await database.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
      [actor?.authUserId ?? ""],
    );
    await database.query(actor ? "set local role authenticated" : "set local role anon");
    const rows = (await database.query<Row>(
      `select *
       from public.calendar_entries
       where id = any($1::uuid[])
       order by start_date, id`,
      [ids],
    )).rows;
    await database.query("reset role");
    await database.query("release savepoint calendar_read");
    return rows;
  } catch (error) {
    await database.query("rollback to savepoint calendar_read");
    await database.query("release savepoint calendar_read");
    throw error;
  }
}

async function insertCalendarEntry(
  database: PoolClient,
  values: {
    actorId: string;
    description?: string | null;
    endDate?: string;
    entryType?: string;
    id?: string;
    relatedUserId?: string | null;
    startDate?: string;
    title?: string;
  },
): Promise<string> {
  const id = values.id ?? randomUUID();
  await database.query(
    `insert into public.calendar_entries (
       id, entry_type, title, start_date, end_date, description,
       related_user_id, created_by_user_id, updated_by_user_id
     ) values (
       $1::uuid, $2::text, $3::text, $4::date, $5::date, $6::text,
       $7::uuid, $8::uuid, $8::uuid
     )`,
    [
      id,
      values.entryType ?? "event",
      values.title ?? "Company event",
      values.startDate ?? "2026-10-01",
      values.endDate ?? values.startDate ?? "2026-10-01",
      values.description === undefined ? null : values.description,
      values.relatedUserId ?? null,
      values.actorId,
    ],
  );
  return id;
}

export function registerCalendarEntryTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe("Task 131 CalendarEntry schema and RLS (static)", () => {
    it("defines only the canonical active-user-readable Calendar foundation", () => {
      const sql = readFileSync(migrationPath, "utf8");
      expect(sql).toContain("create table public.calendar_entries (");
      expect(sql).toContain("check (entry_type in ('business_trip', 'event', 'vacation'))");
      expect(sql).not.toContain("'birthday'");
      expect(sql).toContain("check (end_date >= start_date)");
      expect(sql.match(/on delete restrict/g)).toHaveLength(3);
      expect(sql).toContain("create index calendar_entries_date_range_idx");
      expect(sql).toContain("on public.calendar_entries (start_date, end_date)");
      expect(sql).toContain("alter table public.calendar_entries enable row level security");
      expect(sql).toContain("using (public.is_active_user())");
      expect(sql).toContain("grant select");
      expect(sql).toContain("to authenticated");
      expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)/i);
      expect(sql).not.toContain("calendar.view");
      expect(sql).not.toContain("calendar.manage");
      expect(sql).not.toMatch(/\n\s+is_active\s+/);
      for (const unsupported of [
        "archived_at", "archived_by_user_id", "approved_by",
        "approval_status", "recurrence", "location", "color",
      ]) {
        expect(sql).not.toContain(unsupported);
      }
      expect(sql).not.toMatch(/create\s+function/i);
      expect(sql).not.toMatch(/insert\s+into\s+public\.audit_logs/i);
    });
  });

  describe.skipIf(process.env.TASK131_MIGRATION !== "1")(
    "Task 131 CalendarEntry schema and RLS (requires deployed migration)",
    () => {
      it("has the exact canonical columns, types, defaults, FKs, index, and RLS metadata", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const columns = (await database.query<{
            column_default: string | null;
            column_name: string;
            data_type: string;
            is_nullable: "NO" | "YES";
          }>(
            `select column_name, data_type, is_nullable, column_default
             from information_schema.columns
             where table_schema = 'public'
               and table_name = 'calendar_entries'
             order by ordinal_position`,
          )).rows;
          expect(columns.map(({ column_name, data_type, is_nullable }) => ({
            column_name, data_type, is_nullable,
          }))).toEqual([
            { column_name: "id", data_type: "uuid", is_nullable: "NO" },
            { column_name: "entry_type", data_type: "text", is_nullable: "NO" },
            { column_name: "title", data_type: "text", is_nullable: "NO" },
            { column_name: "start_date", data_type: "date", is_nullable: "NO" },
            { column_name: "end_date", data_type: "date", is_nullable: "NO" },
            { column_name: "description", data_type: "text", is_nullable: "YES" },
            { column_name: "related_user_id", data_type: "uuid", is_nullable: "YES" },
            { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
            { column_name: "created_by_user_id", data_type: "uuid", is_nullable: "NO" },
            { column_name: "updated_at", data_type: "timestamp with time zone", is_nullable: "NO" },
            { column_name: "updated_by_user_id", data_type: "uuid", is_nullable: "NO" },
          ]);
          expect(columns.find((column) => column.column_name === "id")?.column_default)
            .toContain("gen_random_uuid()");
          expect(columns.find((column) => column.column_name === "created_at")?.column_default)
            .toContain("now()");
          expect(columns.find((column) => column.column_name === "updated_at")?.column_default)
            .toContain("now()");

          const foreignKeys = (await database.query<{
            constraint_name: string;
            delete_action: string;
            referenced_table: string;
          }>(
            `select
               reference.constraint_name,
               reference.unique_constraint_schema || '.' || referenced_table.table_name as referenced_table,
               reference.delete_rule as delete_action
             from information_schema.referential_constraints as reference
             join information_schema.constraint_column_usage as referenced_table
               on referenced_table.constraint_schema = reference.unique_constraint_schema
              and referenced_table.constraint_name = reference.unique_constraint_name
             where reference.constraint_schema = 'public'
               and reference.constraint_name like 'calendar_entries_%_fkey'
             order by reference.constraint_name`,
          )).rows;
          expect(foreignKeys).toEqual([
            {
              constraint_name: "calendar_entries_created_by_user_id_fkey",
              delete_action: "RESTRICT",
              referenced_table: "public.user_profiles",
            },
            {
              constraint_name: "calendar_entries_related_user_id_fkey",
              delete_action: "RESTRICT",
              referenced_table: "public.user_profiles",
            },
            {
              constraint_name: "calendar_entries_updated_by_user_id_fkey",
              delete_action: "RESTRICT",
              referenced_table: "public.user_profiles",
            },
          ]);

          const metadata = (await database.query<{
            delete_grant: boolean;
            insert_grant: boolean;
            rls_enabled: boolean;
            select_grant: boolean;
            update_grant: boolean;
          }>(
            `select
               table_record.relrowsecurity as rls_enabled,
               pg_catalog.has_table_privilege('authenticated', table_record.oid, 'select') as select_grant,
               pg_catalog.has_table_privilege('authenticated', table_record.oid, 'insert') as insert_grant,
               pg_catalog.has_table_privilege('authenticated', table_record.oid, 'update') as update_grant,
               pg_catalog.has_table_privilege('authenticated', table_record.oid, 'delete') as delete_grant
             from pg_catalog.pg_class as table_record
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = table_record.relnamespace
             where namespace.nspname = 'public'
               and table_record.relname = 'calendar_entries'`,
          )).rows[0];
          expect(metadata).toEqual({
            delete_grant: false,
            insert_grant: false,
            rls_enabled: true,
            select_grant: true,
            update_grant: false,
          });
          const policy = (await database.query<{
            command: string;
            roles: string[];
            using_expression: string | null;
          }>(
            `select cmd as command, roles::text[] as roles, qual as using_expression
             from pg_catalog.pg_policies
             where schemaname = 'public'
               and tablename = 'calendar_entries'`,
          )).rows;
          expect(policy).toEqual([{
            command: "SELECT",
            roles: ["authenticated"],
            using_expression: "is_active_user()",
          }]);
          const index = (await database.query<{ index_definition: string }>(
            `select indexdef as index_definition
             from pg_catalog.pg_indexes
             where schemaname = 'public'
               and tablename = 'calendar_entries'
               and indexname = 'calendar_entries_date_range_idx'`,
          )).rows[0]?.index_definition;
          expect(index).toContain("(start_date, end_date)");
        });
      });

      it("enforces types, normalized text, dates, optional relationships, and historical FKs", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const actorId = fixture.actors.admin.profileId;
          for (const [entryType, startDate, endDate, description, relatedUserId] of [
            ["business_trip", "2026-10-01", "2026-10-01", null, null],
            ["event", "2026-10-02", "2026-10-03", "Company gathering", fixture.actors.inactiveBrandManager.profileId],
            ["vacation", "2026-10-04", "2026-10-10", null, fixture.actors.permitted.profileId],
          ] as const) {
            await insertCalendarEntry(database, {
              actorId, description, endDate, entryType, relatedUserId, startDate,
              title: `Valid ${entryType}`,
            });
          }
          expect((await database.query<{ count: string }>(
            "select count(*) from public.calendar_entries",
          )).rows[0]?.count).toBe("3");

          const baseValues = [
            randomUUID(), "event", "Valid title", "2026-10-10", "2026-10-10",
            null, null, actorId, actorId,
          ];
          const insertSql = `insert into public.calendar_entries (
            id, entry_type, title, start_date, end_date, description,
            related_user_id, created_by_user_id, updated_by_user_id
          ) values (
            $1::uuid, $2::text, $3::text, $4::date, $5::date, $6::text,
            $7::uuid, $8::uuid, $9::uuid
          )`;
          for (const entryType of ["birthday", "unknown"]) {
            await expectStatementRejected(
              database,
              insertSql,
              [randomUUID(), entryType, ...baseValues.slice(2)],
              "23514",
            );
          }
          for (const title of ["", "   ", " Untrimmed", "Untrimmed "]) {
            await expectStatementRejected(
              database,
              insertSql,
              [randomUUID(), "event", title, ...baseValues.slice(3)],
              "23514",
            );
          }
          for (const description of ["", "   ", " Untrimmed", "Untrimmed "]) {
            await expectStatementRejected(
              database,
              insertSql,
              [
                randomUUID(), "event", "Valid title", "2026-10-10", "2026-10-10",
                description, null, actorId, actorId,
              ],
              "23514",
            );
          }
          await expectStatementRejected(
            database,
            insertSql,
            [
              randomUUID(), "vacation", "Backwards", "2026-10-11", "2026-10-10",
              null, null, actorId, actorId,
            ],
            "23514",
          );
          for (const invalidValues of [
            [randomUUID(), actorId, actorId],
            [null, randomUUID(), actorId],
            [null, actorId, randomUUID()],
          ]) {
            await expectStatementRejected(
              database,
              insertSql,
              [
                randomUUID(), "event", "Bad reference", "2026-10-10", "2026-10-10",
                null, ...invalidValues,
              ],
              "23503",
            );
          }
        });
      });

      it("allows every active account to read and hides rows from inactive or anonymous actors", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const ids = [
            await insertCalendarEntry(database, {
              actorId: fixture.actors.admin.profileId,
              entryType: "business_trip",
              title: "Business trip",
            }),
            await insertCalendarEntry(database, {
              actorId: fixture.actors.admin.profileId,
              entryType: "vacation",
              startDate: "2026-10-02",
              endDate: "2026-10-04",
              title: "Vacation",
            }),
          ];
          for (const actor of [
            fixture.actors.admin,
            fixture.actors.permitted,
            fixture.actors.unpermitted,
          ]) {
            await expect(readCalendarAs(database, actor, ids)).resolves.toHaveLength(2);
          }
          for (const actor of [fixture.actors.inactive, fixture.actors.inactiveBrandManager]) {
            await expect(readCalendarAs(database, actor, ids)).resolves.toEqual([]);
          }
          await expect(readCalendarAs(database, null, ids)).rejects.toMatchObject({ code: "42501" });
        });
      });

      it("denies every browser write including Admin and adds no Calendar permission", async () => {
        const fixture = requireHarness();
        const row = {
          entry_type: "event",
          title: "Denied direct write",
          start_date: "2026-10-01",
          end_date: "2026-10-01",
          created_by_user_id: fixture.actors.admin.profileId,
          updated_by_user_id: fixture.actors.admin.profileId,
        };
        for (const client of [
          fixture.anonymousClient,
          fixture.actors.unpermitted.client,
          fixture.actors.admin.client,
        ]) {
          expectPermissionDenied((await client.from("calendar_entries").insert(row)).error);
          expectPermissionDenied((await client.from("calendar_entries")
            .update({ title: "Denied update" }).eq("id", randomUUID())).error);
          expectPermissionDenied((await client.from("calendar_entries")
            .delete().eq("id", randomUUID())).error);
        }
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          expect((await database.query<{ count: string }>(
            `select count(*)
             from public.permission_definitions
             where key like 'calendar.%'`,
          )).rows).toEqual([{ count: "0" }]);
        });
      });

      it("reads without mutating profiles, permissions, or AuditLog", async () => {
        const fixture = requireHarness();
        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const id = await insertCalendarEntry(database, {
            actorId: fixture.actors.admin.profileId,
            relatedUserId: fixture.actors.inactiveBrandManager.profileId,
            title: "Read-only calendar entry",
          });
          const snapshotSql = `select
            (select count(*)::text from public.audit_logs) as audits,
            (select count(*)::text from public.user_permissions) as permissions,
            (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(profile) order by profile.id)
             from public.user_profiles as profile
             where profile.id = any($1::uuid[])) as profiles`;
          const profileIds = [
            fixture.actors.admin.profileId,
            fixture.actors.inactiveBrandManager.profileId,
          ];
          const before = (await database.query(snapshotSql, [profileIds])).rows[0];
          await expect(readCalendarAs(database, fixture.actors.unpermitted, [id]))
            .resolves.toHaveLength(1);
          expect((await database.query(snapshotSql, [profileIds])).rows[0]).toEqual(before);
        });
      });
    },
  );
}
