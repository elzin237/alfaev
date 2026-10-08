import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import type {
  SecurityActor,
  SecurityFixtureHarness,
} from "./security-fixtures";

interface SearchRow {
  project_id: string;
  name: string;
  status: string;
}

async function actAs(
  database: PoolClient,
  actor: Pick<SecurityActor, "authUserId">,
): Promise<void> {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor.authUserId],
  );
  await database.query("set local role authenticated");
}

async function searchAs(
  database: PoolClient,
  actor: Pick<SecurityActor, "authUserId">,
  search: string | null,
): Promise<SearchRow[]> {
  await actAs(database, actor);
  const result = await database.query<SearchRow>(
    "select * from public.search_projects($1)",
    [search],
  );
  await database.query("reset role");
  return result.rows;
}

async function expectDenied(
  database: PoolClient,
  role: "anon" | "authenticated",
  authUserId?: string,
): Promise<void> {
  await database.query("savepoint project_search_denied");
  if (authUserId) {
    await database.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
      [authUserId],
    );
  } else {
    await database.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', '', true)",
    );
  }
  await database.query(`set local role ${role}`);
  await expect(database.query(
    "select * from public.search_projects('Topbar')",
  )).rejects.toMatchObject({ code: "42501" });
  await database.query("rollback to savepoint project_search_denied");
  await database.query("reset role");
}

export function registerProjectSearchTests(
  requireHarness: () => SecurityFixtureHarness,
): void {
  describe.skipIf(process.env.PROJECT_SEARCH_MIGRATION !== "1")(
    "bounded Project search",
    () => {
      it("enforces authorization, bounds and orders real matches, and returns only list-safe fields", async () => {
        const fixture = requireHarness();
        const viewer = await fixture.createTemporaryProfile(
          "project-search-viewer",
          undefined,
          fixture.actors.admin.profileId,
        );
        const inactiveViewer = await fixture.createTemporaryProfile(
          "inactive-project-search-viewer",
          undefined,
          fixture.actors.admin.profileId,
          { isActive: false },
        );

        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const permission = await database.query<{ id: string }>(
            "select id from public.permission_definitions where key = 'projects.view'",
          );
          const permissionId = permission.rows[0]?.id;
          expect(permissionId).toEqual(expect.any(String));
          await database.query(
            `insert into public.user_permissions (
               user_id, permission_definition_id, granted_by_user_id
             ) values
               ($1, $4, $5),
               ($2, $4, $5),
               ($3, $4, $5)
             on conflict (user_id, permission_definition_id) do nothing`,
            [
              viewer.profileId,
              fixture.actors.inactive.profileId,
              inactiveViewer.profileId,
              permissionId,
              fixture.actors.admin.profileId,
            ],
          );

          const rows = Array.from({ length: 10 }, (_, index) => ({
            id: randomUUID(),
            name: `Topbar Match ${String(index + 1).padStart(2, "0")}`,
          }));
          for (const row of rows) {
            await database.query(
              `insert into public.projects (
                 id, name, customer_name, start_date, delivery_date,
                 created_by_user_id, updated_by_user_id
               ) values ($1, $2, 'Hidden Customer', '2026-10-01',
                 '2026-10-31', $3, $3)`,
              [row.id, row.name, fixture.actors.admin.profileId],
            );
          }

          const adminRows = await searchAs(
            database,
            fixture.actors.admin,
            "  topbar match  ",
          );
          const repeatedRows = await searchAs(
            database,
            fixture.actors.admin,
            "topbar match",
          );
          const viewerRows = await searchAs(
            database,
            viewer,
            "TOPBAR MATCH",
          );

          expect(adminRows).toHaveLength(8);
          expect(repeatedRows).toEqual(adminRows);
          expect(viewerRows).toEqual(adminRows);
          expect(Object.keys(adminRows[0] ?? {}).sort()).toEqual([
            "name",
            "project_id",
            "status",
          ]);
          expect(adminRows.map((row) => row.name)).toEqual(
            Array.from({ length: 8 }, (_, index) =>
              `Topbar Match ${String(index + 1).padStart(2, "0")}`
            ),
          );
          expect(await searchAs(database, fixture.actors.admin, "   "))
            .toEqual([]);

          await expectDenied(
            database,
            "authenticated",
            fixture.actors.unpermitted.authUserId,
          );
          await expectDenied(
            database,
            "authenticated",
            fixture.actors.inactive.authUserId,
          );
          await expectDenied(
            database,
            "authenticated",
            inactiveViewer.authUserId,
          );
          await expectDenied(database, "anon");
        });
      });

      it("treats search text literally and applies the exact deterministic ordering", async () => {
        const fixture = requireHarness();

        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const orderedNames = [
            "Alpha",
            "alpha Beta",
            "ALPHA Gamma",
            "Project alpha Middle",
            "Zed Alpha",
          ];
          const tieIds = [
            "00000000-0000-4000-8000-000000000002",
            "00000000-0000-4000-8000-000000000001",
          ];
          const specialNames = [
            "Literal % Project",
            "Literal _ Project",
            "Literal \\ Project",
            "Director's Project",
            "Literal X Project",
          ];

          for (const [index, name] of [
            ...orderedNames,
            ...specialNames,
          ].entries()) {
            await database.query(
              `insert into public.projects (
                 id, name, customer_name, start_date, delivery_date,
                 created_by_user_id, updated_by_user_id
               ) values ($1, $2, 'Search Customer', '2026-10-01',
                 '2026-10-31', $3, $3)`,
              [
                `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
                name,
                fixture.actors.admin.profileId,
              ],
            );
          }
          for (const id of tieIds) {
            await database.query(
              `insert into public.projects (
                 id, name, customer_name, start_date, delivery_date,
                 created_by_user_id, updated_by_user_id
               ) values ($1, 'Tie Search', 'Search Customer', '2026-10-01',
                 '2026-10-31', $2, $2)`,
              [id, fixture.actors.admin.profileId],
            );
          }

          expect((await searchAs(
            database,
            fixture.actors.admin,
            "  ALPHA  ",
          )).map((row) => row.name)).toEqual(orderedNames);
          expect((await searchAs(
            database,
            fixture.actors.admin,
            "tie search",
          )).map((row) => row.project_id)).toEqual([...tieIds].sort());
          expect((await searchAs(database, fixture.actors.admin, "%"))
            .map((row) => row.name)).toEqual(["Literal % Project"]);
          expect((await searchAs(database, fixture.actors.admin, "_"))
            .map((row) => row.name)).toEqual(["Literal _ Project"]);
          expect((await searchAs(database, fixture.actors.admin, "\\"))
            .map((row) => row.name)).toEqual(["Literal \\ Project"]);
          expect((await searchAs(database, fixture.actors.admin, "'"))
            .map((row) => row.name)).toEqual(["Director's Project"]);
          expect(await searchAs(database, fixture.actors.admin, "no match"))
            .toEqual([]);
        });
      });

      it("has stable hardened function metadata and the exact supporting index", async () => {
        const fixture = requireHarness();

        await fixture.withRollbackDatabaseTransaction(async (database) => {
          const metadata = await database.query<{
            authenticated_execute: boolean;
            anonymous_execute: boolean;
            index_definition: string;
            operator_class: string;
            public_execute: boolean;
            security_definer: boolean;
            settings: string[];
            volatility: string;
          }>(
            `select
               procedure.provolatile as volatility,
               procedure.prosecdef as security_definer,
               procedure.proconfig as settings,
               pg_catalog.has_function_privilege(
                 'authenticated', procedure.oid, 'EXECUTE'
               ) as authenticated_execute,
               pg_catalog.has_function_privilege(
                 'anon', procedure.oid, 'EXECUTE'
               ) as anonymous_execute,
               coalesce((
                 select bool_or(expanded_acl.grantee = 0)
                 from pg_catalog.aclexplode(procedure.proacl) as expanded_acl
                 where expanded_acl.privilege_type = 'EXECUTE'
               ), false) as public_execute,
               pg_catalog.pg_get_indexdef(
                 'public.projects_name_search_trgm_idx'::regclass
               ) as index_definition,
               (
                 select opclass_namespace.nspname || '.' || opclass.opcname
                 from pg_catalog.pg_index as index_metadata
                 join pg_catalog.pg_opclass as opclass
                   on opclass.oid = index_metadata.indclass[0]
                 join pg_catalog.pg_namespace as opclass_namespace
                   on opclass_namespace.oid = opclass.opcnamespace
                 where index_metadata.indexrelid =
                   'public.projects_name_search_trgm_idx'::regclass
               ) as operator_class
             from pg_catalog.pg_proc as procedure
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'public'
               and procedure.proname = 'search_projects'
               and pg_catalog.pg_get_function_identity_arguments(procedure.oid)
                 = 'p_search text'`,
          );

          expect(metadata.rows).toEqual([{
            volatility: "s",
            security_definer: true,
            settings: ['search_path=""'],
            authenticated_execute: true,
            anonymous_execute: false,
            public_execute: false,
            index_definition: expect.stringContaining(
              "USING gin (lower(name) gin_trgm_ops)",
            ),
            operator_class: "extensions.gin_trgm_ops",
          }]);
        });
      });
    },
  );
}
