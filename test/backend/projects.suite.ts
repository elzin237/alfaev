import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityFixtureHarness } from "./security-fixtures";

interface CountResultRow {
  count: number;
}

interface ProjectRow {
  cancelled_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  created_by_user_id: string;
  customer_name: string;
  delivery_date: string;
  id: string;
  name: string;
  start_date: string;
  status: "planned" | "in_progress" | "on_hold" | "completed" | "cancelled";
  updated_at: Date;
  updated_by_user_id: string;
}

interface ProjectAuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown> | null;
  before_data: Record<string, unknown> | null;
  entity_id: string;
  entity_type: string;
}

export function registerProjectsTests(requireHarness: () => SecurityFixtureHarness): void {
  it("enforces the canonical Project fields, dates, statuses, and lifecycle metadata", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const sharedName = `Project ${randomUUID()}`;
      const sharedCustomer = `Customer ${randomUUID()}`;
      const projectIds = Array.from({ length: 5 }, () => randomUUID());

      await database.query(
        `insert into public.projects (
           id, name, customer_name, start_date, delivery_date,
           created_by_user_id, updated_by_user_id
         ) values (
           $1::uuid, $2::text, $3::text, '2026-09-01'::date,
           '2026-09-01'::date, $4::uuid, $4::uuid
         )`,
        [projectIds[0], sharedName, sharedCustomer, actorId],
      );
      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           completed_at, cancelled_at, created_by_user_id, updated_by_user_id
         ) values
           ($1::uuid, $5::text, $6::text, 'in_progress', '2026-09-01'::date,
            '2026-09-10'::date, null, null, $7::uuid, $7::uuid),
           ($2::uuid, $5::text, $6::text, 'on_hold', '2026-09-01'::date,
            '2026-09-10'::date, null, null, $7::uuid, $7::uuid),
           ($3::uuid, $5::text, $6::text, 'completed', '2026-09-01'::date,
            '2026-09-10'::date, '2026-09-10T10:00:00Z'::timestamptz,
            null, $7::uuid, $7::uuid),
           ($4::uuid, $5::text, $6::text, 'cancelled', '2026-09-01'::date,
            '2026-09-10'::date, null,
            '2026-09-09T10:00:00Z'::timestamptz, $7::uuid, $7::uuid)`,
        [
          projectIds[1],
          projectIds[2],
          projectIds[3],
          projectIds[4],
          sharedName,
          sharedCustomer,
          actorId,
        ],
      );
      const projects = await database.query<ProjectRow>(
        `select
           id,
           name,
           customer_name,
           status,
           start_date::text as start_date,
           delivery_date::text as delivery_date,
           created_at,
           created_by_user_id,
           updated_at,
           updated_by_user_id,
           completed_at,
           cancelled_at
         from public.projects
         where id = any($1::uuid[])
         order by status, id`,
        [projectIds],
      );
      expect(projects.rows).toHaveLength(5);
      expect(projects.rows.map((project) => project.status).sort()).toEqual([
        "cancelled",
        "completed",
        "in_progress",
        "on_hold",
        "planned",
      ]);
      expect(projects.rows.every((project) =>
        project.name === sharedName && project.customer_name === sharedCustomer
      )).toBe(true);
      expect(projects.rows.find((project) => project.status === "planned"))
        .toMatchObject({
          cancelled_at: null,
          completed_at: null,
          delivery_date: "2026-09-01",
          start_date: "2026-09-01",
        });
      expect(projects.rows.find((project) => project.status === "completed")
        ?.completed_at).toEqual(expect.any(Date));
      expect(projects.rows.find((project) => project.status === "cancelled")
        ?.cancelled_at).toEqual(expect.any(Date));

      const invalidCases: Array<{
        label: string;
        values: unknown[];
      }> = [
        {
          label: "blank_name",
          values: ["   ", "Customer", "planned", "2026-09-01", "2026-09-02", null, null],
        },
        {
          label: "untrimmed_name",
          values: [" Project ", "Customer", "planned", "2026-09-01", "2026-09-02", null, null],
        },
        {
          label: "blank_customer",
          values: ["Project", "   ", "planned", "2026-09-01", "2026-09-02", null, null],
        },
        {
          label: "untrimmed_customer",
          values: ["Project", " Customer ", "planned", "2026-09-01", "2026-09-02", null, null],
        },
        {
          label: "delivery_before_start",
          values: ["Project", "Customer", "planned", "2026-09-02", "2026-09-01", null, null],
        },
        {
          label: "invalid_status",
          values: ["Project", "Customer", "archived", "2026-09-01", "2026-09-02", null, null],
        },
        {
          label: "completed_without_completed_at",
          values: ["Project", "Customer", "completed", "2026-09-01", "2026-09-02", null, null],
        },
        {
          label: "cancelled_without_cancelled_at",
          values: ["Project", "Customer", "cancelled", "2026-09-01", "2026-09-02", null, null],
        },
        {
          label: "planned_with_completed_at",
          values: ["Project", "Customer", "planned", "2026-09-01", "2026-09-02", "2026-09-02T10:00:00Z", null],
        },
        {
          label: "planned_with_cancelled_at",
          values: ["Project", "Customer", "planned", "2026-09-01", "2026-09-02", null, "2026-09-02T10:00:00Z"],
        },
        {
          label: "completed_with_cancelled_at",
          values: ["Project", "Customer", "completed", "2026-09-01", "2026-09-02", null, "2026-09-02T10:00:00Z"],
        },
        {
          label: "cancelled_with_completed_at",
          values: ["Project", "Customer", "cancelled", "2026-09-01", "2026-09-02", "2026-09-02T10:00:00Z", null],
        },
      ];

      for (const invalid of invalidCases) {
        await database.query(`savepoint invalid_project_${invalid.label}`);
        await expect(
          database.query(
            `insert into public.projects (
               name, customer_name, status, start_date, delivery_date,
               completed_at, cancelled_at, created_by_user_id,
               updated_by_user_id
             ) values (
               $1::text, $2::text, $3::text, $4::date, $5::date,
               $6::timestamptz, $7::timestamptz, $8::uuid, $8::uuid
             )`,
            [...invalid.values, actorId],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await database.query(`rollback to savepoint invalid_project_${invalid.label}`);
      }

      const columns = await database.query<{
        column_default: string | null;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'projects'
         order by ordinal_position`,
      );
      expect(columns.rows.map((column) => column.column_name)).toEqual([
        "id",
        "name",
        "customer_name",
        "status",
        "start_date",
        "delivery_date",
        "created_at",
        "created_by_user_id",
        "updated_at",
        "updated_by_user_id",
        "completed_at",
        "cancelled_at",
      ]);
      expect(columns.rows.find((column) => column.column_name === "status"))
        .toMatchObject({ column_default: "'planned'::text", is_nullable: "NO" });
      expect(columns.rows.find((column) => column.column_name === "start_date"))
        .toMatchObject({ data_type: "date", is_nullable: "NO" });
      expect(columns.rows.find((column) => column.column_name === "delivery_date"))
        .toMatchObject({ data_type: "date", is_nullable: "NO" });
      expect(columns.rows.some((column) => [
        "is_active",
        "archived_at",
        "archived_by_user_id",
      ].includes(column.column_name))).toBe(false);
    });
  });
  it("limits Project reads to active Project viewers and denies every direct client write", async () => {
    const fixture = requireHarness();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const actorId = fixture.actors.admin.profileId;
      const projectIds = [randomUUID(), randomUUID(), randomUUID()];
      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           completed_at, cancelled_at, created_by_user_id,
           updated_by_user_id
         ) values
           ($1::uuid, 'Readable Planned Project', 'Customer', 'planned',
            '2026-09-01'::date, '2026-09-02'::date, null, null,
            $4::uuid, $4::uuid),
           ($2::uuid, 'Readable Completed Project', 'Customer', 'completed',
            '2026-09-01'::date, '2026-09-02'::date,
            '2026-09-02T10:00:00Z'::timestamptz, null,
            $4::uuid, $4::uuid),
           ($3::uuid, 'Readable Cancelled Project', 'Customer', 'cancelled',
            '2026-09-01'::date, '2026-09-02'::date,
            null, '2026-09-02T10:00:00Z'::timestamptz,
            $4::uuid, $4::uuid)`,
        [...projectIds, actorId],
      );

      for (const actor of [fixture.actors.admin, fixture.actors.permitted]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ id: string; status: string }>(
          `select id, status
           from public.projects
           where id = any($1::uuid[])
           order by status, id`,
          [projectIds],
        );
        await database.query("reset role");
        expect(visible.rows.map((project) => project.status).sort()).toEqual([
          "cancelled",
          "completed",
          "planned",
        ]);
      }

      for (const actor of [
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ id: string }>(
          `select id
           from public.projects
           where id = any($1::uuid[])`,
          [projectIds],
        );
        await database.query("reset role");
        expect(hidden.rows).toEqual([]);
      }

      const security = await database.query<{
        authenticated_delete: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        policy_expression: string;
        row_security: boolean;
      }>(
        `select
           class.relrowsecurity as row_security,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'select'
           ) as authenticated_select,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'insert'
           ) as authenticated_insert,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'update'
           ) as authenticated_update,
           pg_catalog.has_table_privilege(
             'authenticated', class.oid, 'delete'
           ) as authenticated_delete,
           pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
             as policy_expression
         from pg_catalog.pg_class as class
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = class.relnamespace
         join pg_catalog.pg_policy as policy
           on policy.polrelid = class.oid
          and policy.polname = 'projects_select_authorized'
         where namespace.nspname = 'public'
           and class.relname = 'projects'`,
      );
      expect(security.rows).toHaveLength(1);
      expect(security.rows[0]).toMatchObject({
        authenticated_delete: false,
        authenticated_insert: false,
        authenticated_select: true,
        authenticated_update: false,
        row_security: true,
      });
      expect(security.rows[0]?.policy_expression).toContain(
        "current_user_is_admin()",
      );
      expect(security.rows[0]?.policy_expression).toContain(
        "has_permission('projects.view'::text)",
      );

      const prematureFunctions = await database.query<{ count: number }>(
        `select count(*)::integer as count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = any($1::text[])`,
        [[
          "set_project_status",
          "archive_project",
        ]],
      );
      expect(prematureFunctions.rows).toEqual([{ count: 0 }]);
    });

    const adminClient = fixture.actors.admin.client;
    const directInsert = await adminClient.from("projects").insert({
      name: "Forbidden Direct Project",
      customer_name: "Forbidden Customer",
      start_date: "2026-09-01",
      delivery_date: "2026-09-02",
      created_by_user_id: fixture.actors.admin.profileId,
      updated_by_user_id: fixture.actors.admin.profileId,
    });
    const directUpdate = await adminClient
      .from("projects")
      .update({ name: "Forbidden Update" })
      .eq("id", randomUUID());
    const directDelete = await adminClient
      .from("projects")
      .delete()
      .eq("id", randomUUID());
    expectPermissionDenied(directInsert.error);
    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);

    const anonymousRead = await fixture.anonymousClient
      .from("projects")
      .select("id")
      .limit(1);
    expectPermissionDenied(anonymousRead.error);
  });
  it("creates only planned Projects for active Admins and delegated Project creators", async () => {
    const fixture = requireHarness();
    const delegatedActor = fixture.actors.productCreator;
    const unrelatedActor = fixture.actors.unpermitted;
    const delegatedName = `Delegated Project ${randomUUID()}`;
    const adminName = `Admin Project ${randomUUID()}`;
    const deniedName = `Denied Project ${randomUUID()}`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id,
           permission_definition_id,
           granted_by_user_id
         )
         select $1::uuid, definition.id, $2::uuid
         from public.permission_definitions as definition
         where definition.key = any($3::text[])`,
        [
          unrelatedActor.profileId,
          fixture.actors.admin.profileId,
          ["projects.edit", "projects.archive"],
        ],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [unrelatedActor.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint unrelated_project_permissions");
      await expect(
        database.query(
          `select public.create_project(
             $1::text, $2::text, $3::date, $4::date
           )`,
          [deniedName, "Denied Customer", "2026-09-01", "2026-09-10"],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint unrelated_project_permissions");
      await database.query("reset role");

      await database.query(
        `insert into public.user_permissions (
           user_id,
           permission_definition_id,
           granted_by_user_id
         )
         select $1::uuid, definition.id, $2::uuid
         from public.permission_definitions as definition
         where definition.key = 'projects.create'`,
        [delegatedActor.profileId, fixture.actors.admin.profileId],
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [delegatedActor.authUserId],
      );
      await database.query("set local role authenticated");
      const delegatedPermissions = await database.query<{
        can_create: boolean;
        can_view: boolean;
      }>(
        `select
           public.has_permission('projects.create') as can_create,
           public.has_permission('projects.view') as can_view`,
      );
      const delegatedCreation = await database.query<{ project_id: string }>(
        `select public.create_project(
           $1::text, $2::text, $3::date, $4::date
         ) as project_id`,
        [
          `  ${delegatedName}  `,
          "  Delegated Customer  ",
          "2026-09-01",
          "2026-09-10",
        ],
      );
      await database.query("reset role");

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const adminCreation = await database.query<{ project_id: string }>(
        `select public.create_project(
           $1::text, $2::text, $3::date, $4::date
         ) as project_id`,
        [adminName, "Admin Customer", "2026-10-01", "2026-10-01"],
      );
      await database.query("reset role");

      const projectIds = [
        delegatedCreation.rows[0]?.project_id,
        adminCreation.rows[0]?.project_id,
      ];
      if (projectIds.some((projectId) => !projectId)) {
        throw new Error("Trusted Project creation returned no ID");
      }

      const projects = await database.query<ProjectRow>(
        `select
           id,
           name,
           customer_name,
           status,
           start_date::text as start_date,
           delivery_date::text as delivery_date,
           created_at,
           created_by_user_id,
           updated_at,
           updated_by_user_id,
           completed_at,
           cancelled_at
         from public.projects
         where id = any($1::uuid[])
         order by name`,
        [projectIds],
      );
      const audits = await database.query<ProjectAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type = 'project.created'
         order by entity_id`,
        [projectIds],
      );
      const delegatedProject = projects.rows.find(
        (project) => project.id === delegatedCreation.rows[0]?.project_id,
      );
      const adminProject = projects.rows.find(
        (project) => project.id === adminCreation.rows[0]?.project_id,
      );

      expect(delegatedPermissions.rows).toEqual([{
        can_create: true,
        can_view: false,
      }]);
      expect(projects.rows).toHaveLength(2);
      expect(delegatedProject).toMatchObject({
        cancelled_at: null,
        completed_at: null,
        created_by_user_id: delegatedActor.profileId,
        customer_name: "Delegated Customer",
        delivery_date: "2026-09-10",
        name: delegatedName,
        start_date: "2026-09-01",
        status: "planned",
        updated_by_user_id: delegatedActor.profileId,
      });
      expect(delegatedProject?.created_at).toEqual(delegatedProject?.updated_at);
      expect(adminProject).toMatchObject({
        cancelled_at: null,
        completed_at: null,
        created_by_user_id: fixture.actors.admin.profileId,
        customer_name: "Admin Customer",
        delivery_date: "2026-10-01",
        name: adminName,
        start_date: "2026-10-01",
        status: "planned",
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(adminProject?.created_at).toEqual(adminProject?.updated_at);
      expect(audits.rows).toHaveLength(2);
      expect(audits.rows).toEqual(expect.arrayContaining([
        {
          action_type: "project.created",
          actor_user_id: delegatedActor.profileId,
          after_data: {
            cancelled_at: null,
            completed_at: null,
            customer_name: "Delegated Customer",
            delivery_date: "2026-09-10",
            name: delegatedName,
            start_date: "2026-09-01",
            status: "planned",
          },
          before_data: null,
          entity_id: delegatedCreation.rows[0]?.project_id,
          entity_type: "project",
        },
        {
          action_type: "project.created",
          actor_user_id: fixture.actors.admin.profileId,
          after_data: {
            cancelled_at: null,
            completed_at: null,
            customer_name: "Admin Customer",
            delivery_date: "2026-10-01",
            name: adminName,
            start_date: "2026-10-01",
            status: "planned",
          },
          before_data: null,
          entity_id: adminCreation.rows[0]?.project_id,
          entity_type: "project",
        },
      ]));

      const denied = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.projects
         where name = $1::text`,
        [deniedName],
      );
      const deniedAudit = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where action_type = 'project.created'
           and after_data ->> 'name' = $1::text`,
        [deniedName],
      );
      expect(denied.rows).toEqual([{ count: 0 }]);
      expect(deniedAudit.rows).toEqual([{ count: 0 }]);

      const functionSecurity = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        identity_arguments: string;
        is_security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.pg_get_function_identity_arguments(routine.oid)
             as identity_arguments,
           pg_catalog.has_function_privilege(
             'anon', routine.oid, 'execute'
           ) as anonymous_execute,
           pg_catalog.has_function_privilege(
             'authenticated', routine.oid, 'execute'
           ) as authenticated_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'create_project'`,
      );
      expect(functionSecurity.rows).toEqual([{
        anonymous_execute: false,
        authenticated_execute: true,
        identity_arguments:
          "p_name text, p_customer_name text, p_start_date date, p_delivery_date date",
        is_security_definer: true,
        settings: ["search_path=\"\""],
      }]);
    });
  });
  it("rejects invalid Project creation without persisting a Project or audit", async () => {
    const fixture = requireHarness();
    const namePrefix = `Invalid Project ${randomUUID()}`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const projectsBefore = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.projects",
      );
      const auditsBefore = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.audit_logs",
      );
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");

      const invalidCases: ReadonlyArray<{
        expectedCode: string;
        label: string;
        values: unknown[];
      }> = [
        {
          expectedCode: "22023",
          label: "blank_name",
          values: ["   ", "Customer", "2026-09-01", "2026-09-10"],
        },
        {
          expectedCode: "22023",
          label: "blank_customer",
          values: [`${namePrefix} blank customer`, "   ", "2026-09-01", "2026-09-10"],
        },
        {
          expectedCode: "22023",
          label: "missing_start",
          values: [`${namePrefix} missing start`, "Customer", null, "2026-09-10"],
        },
        {
          expectedCode: "22023",
          label: "missing_delivery",
          values: [`${namePrefix} missing delivery`, "Customer", "2026-09-01", null],
        },
        {
          expectedCode: "22007",
          label: "invalid_date",
          values: [`${namePrefix} invalid date`, "Customer", "not-a-date", "2026-09-10"],
        },
        {
          expectedCode: "22023",
          label: "delivery_before_start",
          values: [`${namePrefix} date order`, "Customer", "2026-09-10", "2026-09-01"],
        },
      ];

      for (const invalid of invalidCases) {
        await database.query(`savepoint invalid_project_create_${invalid.label}`);
        await expect(
          database.query(
            `select public.create_project(
               $1::text, $2::text, $3::date, $4::date
             )`,
            invalid.values,
          ),
        ).rejects.toMatchObject({ code: invalid.expectedCode });
        await database.query(
          `rollback to savepoint invalid_project_create_${invalid.label}`,
        );
      }
      await database.query("reset role");

      const projectsAfter = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.projects",
      );
      const auditsAfter = await database.query<CountResultRow>(
        "select count(*)::integer as count from public.audit_logs",
      );
      expect(projectsAfter.rows).toEqual(projectsBefore.rows);
      expect(auditsAfter.rows).toEqual(auditsBefore.rows);
    });
  });
  it("denies Project creation without active Admin or projects.create authority", async () => {
    const fixture = requireHarness();
    const deniedNamePrefix = `Denied RPC Project ${randomUUID()}`;
    const deniedActors = [
      fixture.actors.permitted,
      fixture.actors.productCreator,
      fixture.actors.brandManager,
      fixture.actors.unpermitted,
      fixture.actors.inactive,
    ];

    for (const [index, actor] of deniedActors.entries()) {
      const denied = await actor.client.rpc("create_project", {
        p_name: `${deniedNamePrefix} ${index}`,
        p_customer_name: "Denied Customer",
        p_start_date: "2026-09-01",
        p_delivery_date: "2026-09-10",
      });
      expectPermissionDenied(denied.error);
    }

    const anonymous = await fixture.anonymousClient.rpc("create_project", {
      p_name: `${deniedNamePrefix} anonymous`,
      p_customer_name: "Denied Customer",
      p_start_date: "2026-09-01",
      p_delivery_date: "2026-09-10",
    });
    expectPermissionDenied(anonymous.error);

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const projects = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.projects
         where name like $1::text`,
        [`${deniedNamePrefix}%`],
      );
      const audits = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where action_type = 'project.created'
           and after_data ->> 'name' like $1::text`,
        [`${deniedNamePrefix}%`],
      );
      expect(projects.rows).toEqual([{ count: 0 }]);
      expect(audits.rows).toEqual([{ count: 0 }]);
    });
  });
  it("edits Projects through trusted normal statuses with lifecycle and audit/no-op guarantees", async () => {
    const fixture = requireHarness();
    const projectId = randomUUID();
    const existingCompletedId = randomUUID();
    const cancelledId = randomUUID();
    const editor = fixture.actors.productCreator;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id)
         select $1::uuid, id, $2::uuid from public.permission_definitions
         where key = 'projects.edit'`,
        [editor.profileId, fixture.actors.admin.profileId],
      );
      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           created_by_user_id, updated_by_user_id, completed_at, cancelled_at
         ) values
           ($1, 'Editable Project', 'Customer', 'planned', '2026-09-01', '2026-09-30', $4, $4, null, null),
           ($2, 'Completed Project', 'Customer', 'completed', '2026-09-01', '2026-09-30', $4, $4, '2026-09-30T10:00:00Z', null),
           ($3, 'Cancelled Project', 'Customer', 'cancelled', '2026-09-01', '2026-09-30', $4, $4, null, '2026-09-20T10:00:00Z')`,
        [projectId, existingCompletedId, cancelledId, fixture.actors.admin.profileId],
      );
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [fixture.actors.admin.authUserId]);
      await database.query("set local role authenticated");
      await database.query(
        `select public.update_project($1, 'Admin Edited Project', 'Customer', '2026-09-01', '2026-09-30', 'planned')`,
        [projectId],
      );
      await database.query("reset role");
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [editor.authUserId]);
      await database.query("set local role authenticated");

      for (const status of ["in_progress", "on_hold", "planned"]) {
        await database.query(
          `select public.update_project($1, $2, $3, $4, $5, $6)`,
          [projectId, "  Editable Project  ", "  Updated Customer  ", "2026-09-02", "2026-10-01", status],
        );
      }
      await database.query("reset role");

      const beforeNoOp = await database.query<ProjectRow>(
        `select *, start_date::text as start_date, delivery_date::text as delivery_date
         from public.projects where id = $1`, [projectId],
      );
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [editor.authUserId]);
      await database.query("set local role authenticated");
      await database.query(
        `select public.update_project($1, 'Editable Project', 'Updated Customer', '2026-09-02', '2026-10-01', 'planned')`,
        [projectId],
      );
      await database.query("reset role");
      const afterNoOp = await database.query<ProjectRow>(
        `select *, start_date::text as start_date, delivery_date::text as delivery_date
         from public.projects where id = $1`, [projectId],
      );
      expect(afterNoOp.rows).toEqual(beforeNoOp.rows);

      const openProject = await database.query<ProjectRow>(
        `select *, start_date::text as start_date, delivery_date::text as delivery_date
         from public.projects where id = $1`, [projectId],
      );
      expect(openProject.rows[0]).toMatchObject({
        name: "Editable Project", customer_name: "Updated Customer",
        status: "planned", start_date: "2026-09-02",
        delivery_date: "2026-10-01", updated_by_user_id: editor.profileId,
        completed_at: null,
        cancelled_at: null,
      });

      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [editor.authUserId]);
      await database.query("set local role authenticated");
      await database.query("savepoint deny_cancelled_edit");
      await expect(database.query(
        `select public.update_project($1, 'Changed', 'Customer', '2026-09-01', '2026-09-30', 'planned')`,
        [cancelledId],
      )).rejects.toMatchObject({ code: "PRJ01" });
      await database.query("rollback to savepoint deny_cancelled_edit");
      await database.query("reset role");

      const finalRows = await database.query<ProjectRow>(
        `select *, start_date::text as start_date, delivery_date::text as delivery_date
         from public.projects where id = any($1::uuid[])`,
        [[projectId, existingCompletedId, cancelledId]],
      );
      expect(finalRows.rows.find((row) => row.id === projectId)).toMatchObject({
        status: "planned",
        completed_at: null,
        cancelled_at: null,
      });
      expect(finalRows.rows.find((row) => row.id === existingCompletedId)).toMatchObject({
        name: "Completed Project",
        completed_at: new Date("2026-09-30T10:00:00Z"),
      });
      expect(finalRows.rows.find((row) => row.id === cancelledId)?.name).toBe("Cancelled Project");
      const audits = await database.query<ProjectAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id, before_data, after_data
         from public.audit_logs where entity_id = any($1::uuid[]) and action_type = 'project.updated'`,
        [[projectId, existingCompletedId, cancelledId]],
      );
      expect(audits.rows).toHaveLength(4);
      expect(audits.rows.filter((row) => row.actor_user_id === fixture.actors.admin.profileId)).toHaveLength(1);
      expect(audits.rows.filter((row) => row.actor_user_id === editor.profileId)).toHaveLength(3);
      expect(audits.rows.filter((row) => row.entity_id === cancelledId)).toHaveLength(0);
      expect(audits.rows.filter((row) => row.entity_id === existingCompletedId)).toHaveLength(0);
      expect(audits.rows.some((row) => row.after_data?.status === "completed"))
        .toBe(false);
    });
  });
  it("rejects manual completion from every open status for Admin and projects.edit without mutation or audit", async () => {
    const fixture = requireHarness();
    const editor = fixture.actors.productCreator;
    const projectIds = [randomUUID(), randomUUID(), randomUUID()];

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select $1::uuid, id, $2::uuid
         from public.permission_definitions
         where key = 'projects.edit'`,
        [editor.profileId, fixture.actors.admin.profileId],
      );
      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           created_at, created_by_user_id, updated_at, updated_by_user_id,
           completed_at, cancelled_at
         ) values
           ($1, 'Planned Manual Completion', 'Customer', 'planned',
            '2026-09-01', '2026-09-30', '2026-09-01T08:00:00Z', $4,
            '2026-09-02T08:00:00Z', $4, null, null),
           ($2, 'Progress Manual Completion', 'Customer', 'in_progress',
            '2026-09-01', '2026-09-30', '2026-09-01T08:00:00Z', $4,
            '2026-09-02T08:00:00Z', $4, null, null),
           ($3, 'Hold Manual Completion', 'Customer', 'on_hold',
            '2026-09-01', '2026-09-30', '2026-09-01T08:00:00Z', $4,
            '2026-09-02T08:00:00Z', $4, null, null)`,
        [...projectIds, fixture.actors.admin.profileId],
      );
      const baseline = await database.query<{
        completed_at: Date | null;
        id: string;
        status: string;
        updated_at: Date;
        updated_by_user_id: string;
      }>(
        `select id, status, completed_at, updated_at, updated_by_user_id
         from public.projects
         where id = any($1::uuid[])
         order by id`,
        [projectIds],
      );

      for (const actor of [fixture.actors.admin, editor]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        for (const [index, projectId] of projectIds.entries()) {
          await database.query(`savepoint manual_completion_${index}`);
          await expect(database.query(
            `select public.update_project(
               $1, 'Manual Completion Attempt', 'Customer',
               '2026-09-01', '2026-09-30', 'completed'
             )`,
            [projectId],
          )).rejects.toMatchObject({ code: "22023" });
          await database.query(`rollback to savepoint manual_completion_${index}`);
        }
        await database.query("reset role");
      }

      const unchanged = await database.query<{
        completed_at: Date | null;
        id: string;
        status: string;
        updated_at: Date;
        updated_by_user_id: string;
      }>(
        `select id, status, completed_at, updated_at, updated_by_user_id
         from public.projects
         where id = any($1::uuid[])
         order by id`,
        [projectIds],
      );
      expect(unchanged.rows).toEqual(baseline.rows);
      expect(unchanged.rows.every((row) => row.completed_at === null)).toBe(true);
      expect((await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type = 'project.updated'`,
        [projectIds],
      )).rows).toEqual([{ count: 0 }]);
    });
  });
  it("locks every normal edit of a Completed Project for Admin and projects.edit actors", async () => {
    const fixture = requireHarness();
    const projectId = randomUUID();
    const editor = fixture.actors.productCreator;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select $1::uuid, id, $2::uuid
         from public.permission_definitions
         where key = 'projects.edit'`,
        [editor.profileId, fixture.actors.admin.profileId],
      );
      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           created_at, created_by_user_id, updated_at, updated_by_user_id,
           completed_at, cancelled_at
         ) values (
           $1, 'Locked Completed Project', 'Original Customer', 'completed',
           '2026-09-01', '2026-09-30', '2026-09-01T09:00:00Z', $2,
           '2026-09-30T10:30:00Z', $2, '2026-09-30T10:00:00Z', null
         )`,
        [projectId, fixture.actors.admin.profileId],
      );
      const baseline = await database.query<ProjectRow>(
        `select *, start_date::text as start_date,
                delivery_date::text as delivery_date
         from public.projects
         where id = $1`,
        [projectId],
      );
      const attempts: ReadonlyArray<{
        deliveryDate: string;
        name: string;
        customer: string;
        startDate: string;
        status: string;
      }> = [
        {
          name: "Changed Name",
          customer: "Original Customer",
          startDate: "2026-09-01",
          deliveryDate: "2026-09-30",
          status: "completed",
        },
        {
          name: "Locked Completed Project",
          customer: "Changed Customer",
          startDate: "2026-09-01",
          deliveryDate: "2026-09-30",
          status: "completed",
        },
        {
          name: "Locked Completed Project",
          customer: "Original Customer",
          startDate: "2026-09-02",
          deliveryDate: "2026-10-01",
          status: "completed",
        },
        {
          name: "Locked Completed Project",
          customer: "Original Customer",
          startDate: "2026-09-01",
          deliveryDate: "2026-09-30",
          status: "completed",
        },
        {
          name: "Locked Completed Project",
          customer: "Original Customer",
          startDate: "2026-09-01",
          deliveryDate: "2026-09-30",
          status: "in_progress",
        },
      ];

      for (const actor of [fixture.actors.admin, editor]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        for (const [index, attempt] of attempts.entries()) {
          await database.query(`savepoint completed_project_lock_${index}`);
          await expect(database.query(
            `select public.update_project(
               $1::uuid, $2::text, $3::text, $4::date, $5::date, $6::text
             )`,
            [
              projectId,
              attempt.name,
              attempt.customer,
              attempt.startDate,
              attempt.deliveryDate,
              attempt.status,
            ],
          )).rejects.toMatchObject({ code: "PRJ02" });
          await database.query(`rollback to savepoint completed_project_lock_${index}`);
        }
        await database.query("reset role");

        const unchanged = await database.query<ProjectRow>(
          `select *, start_date::text as start_date,
                  delivery_date::text as delivery_date
           from public.projects
           where id = $1`,
          [projectId],
        );
        expect(unchanged.rows).toEqual(baseline.rows);
        const audits = await database.query<CountResultRow>(
          `select count(*)::integer as count
           from public.audit_logs
           where entity_id = $1
             and action_type = 'project.updated'`,
          [projectId],
        );
        expect(audits.rows).toEqual([{ count: 0 }]);
      }
    });
  });
  it("rejects invalid and unauthorized Project edits without mutation or audit", async () => {
    const fixture = requireHarness();
    const projectId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.projects (id, name, customer_name, status, start_date, delivery_date, created_by_user_id, updated_by_user_id)
         values ($1, 'Guarded Project', 'Customer', 'planned', '2026-09-01', '2026-09-30', $2, $2)`,
        [projectId, fixture.actors.admin.profileId],
      );
      await database.query(
        `insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id)
         select grant_row.actor_id, definition.id, $3::uuid
         from unnest($1::uuid[], $2::text[]) as grant_row(actor_id, permission_key)
         join public.permission_definitions as definition on definition.key = grant_row.permission_key`,
        [[fixture.actors.productCreator.profileId, fixture.actors.supplierEditor.profileId], ["projects.create", "projects.archive"], fixture.actors.admin.profileId],
      );
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [fixture.actors.admin.authUserId]);
      await database.query("set local role authenticated");
      const invalidCases: unknown[][] = [
        ["   ", "Customer", "2026-09-01", "2026-09-30", "planned"],
        ["Project", "   ", "2026-09-01", "2026-09-30", "planned"],
        ["Project", "Customer", null, "2026-09-30", "planned"],
        ["Project", "Customer", "2026-10-01", "2026-09-30", "planned"],
        ["Project", "Customer", "2026-09-01", "2026-09-30", "completed"],
        ["Project", "Customer", "2026-09-01", "2026-09-30", "cancelled"],
        ["Project", "Customer", "2026-09-01", "2026-09-30", "unknown"],
      ];
      for (const [index, values] of invalidCases.entries()) {
        await database.query(`savepoint invalid_project_edit_${index}`);
        await expect(database.query(
          `select public.update_project($1::uuid, $2::text, $3::text, $4::date, $5::date, $6::text)`,
          [projectId, ...values],
        )).rejects.toMatchObject({ code: "22023" });
        await database.query(`rollback to savepoint invalid_project_edit_${index}`);
      }
      await database.query("reset role");

      for (const actor of [fixture.actors.permitted, fixture.actors.productCreator, fixture.actors.supplierEditor, fixture.actors.unpermitted, fixture.actors.inactive]) {
        await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [actor.authUserId]);
        await database.query("set local role authenticated");
        await database.query("savepoint denied_project_edit");
        await expect(database.query(
          `select public.update_project($1, 'Changed', 'Customer', '2026-09-01', '2026-09-30', 'planned')`,
          [projectId],
        )).rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint denied_project_edit");
        await database.query("reset role");
      }
      expect((await database.query("select name from public.projects where id = $1", [projectId])).rows).toEqual([{ name: "Guarded Project" }]);
      expect((await database.query<CountResultRow>(
        `select count(*)::integer as count from public.audit_logs where entity_id = $1 and action_type = 'project.updated'`, [projectId],
      )).rows).toEqual([{ count: 0 }]);
    });

    const anonymous = await fixture.anonymousClient.rpc("update_project", {
      p_project_id: projectId, p_name: "Changed", p_customer_name: "Customer",
      p_start_date: "2026-09-01", p_delivery_date: "2026-09-30", p_status: "planned",
    });
    expectPermissionDenied(anonymous.error);
  });
  it("cancels eligible Projects only for Admin or projects.archive and audits atomically", async () => {
    const fixture = requireHarness();
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const archiver = fixture.actors.supplierEditor;
    const editor = fixture.actors.productEditor;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (user_id, permission_definition_id, granted_by_user_id)
         select grant_row.actor_id, definition.id, $3::uuid
         from unnest($1::uuid[], $2::text[]) as grant_row(actor_id, permission_key)
         join public.permission_definitions as definition on definition.key = grant_row.permission_key`,
        [[archiver.profileId, editor.profileId], ["projects.archive", "projects.edit"], fixture.actors.admin.profileId],
      );
      await database.query(
        `insert into public.projects (id, name, customer_name, status, start_date, delivery_date, completed_at, cancelled_at, created_by_user_id, updated_by_user_id) values
         ($1, 'Planned', 'Customer', 'planned', '2026-09-01', '2026-09-30', null, null, $6, $6),
         ($2, 'Progress', 'Customer', 'in_progress', '2026-09-01', '2026-09-30', null, null, $6, $6),
         ($3, 'Hold', 'Customer', 'on_hold', '2026-09-01', '2026-09-30', null, null, $6, $6),
         ($4, 'Completed', 'Customer', 'completed', '2026-09-01', '2026-09-30', '2026-09-30', null, $6, $6),
         ($5, 'Cancelled', 'Customer', 'cancelled', '2026-09-01', '2026-09-30', null, '2026-09-20', $6, $6)`,
        [...ids, fixture.actors.admin.profileId],
      );
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [fixture.actors.admin.authUserId]);
      await database.query("set local role authenticated");
      await database.query("select public.cancel_project($1)", [ids[0]]);
      await database.query("reset role");
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [archiver.authUserId]);
      await database.query("set local role authenticated");
      await database.query("select public.cancel_project($1)", [ids[1]]);
      await database.query("select public.cancel_project($1)", [ids[2]]);
      for (const [index, id] of [ids[3], ids[4]].entries()) {
        await database.query(`savepoint invalid_cancel_${index}`);
        await expect(database.query("select public.cancel_project($1)", [id])).rejects.toMatchObject({ code: "PRJ03" });
        await database.query(`rollback to savepoint invalid_cancel_${index}`);
      }
      await database.query("reset role");
      await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)", [editor.authUserId]);
      await database.query("set local role authenticated");
      await database.query("savepoint edit_only_cancel_denied");
      await expect(database.query("select public.cancel_project($1)", [ids[3]])).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint edit_only_cancel_denied");
      await database.query("reset role");

      const rows = await database.query<ProjectRow>(
        `select *, start_date::text as start_date, delivery_date::text as delivery_date from public.projects where id = any($1::uuid[])`, [ids],
      );
      for (const id of ids.slice(0, 3)) {
        expect(rows.rows.find((row) => row.id === id)).toMatchObject({ status: "cancelled", completed_at: null });
        expect(rows.rows.find((row) => row.id === id)?.cancelled_at).toBeInstanceOf(Date);
      }
      expect(rows.rows.find((row) => row.id === ids[3])?.status).toBe("completed");
      expect(rows.rows.find((row) => row.id === ids[4])?.status).toBe("cancelled");
      const audits = await database.query<ProjectAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id, before_data, after_data from public.audit_logs
         where entity_id = any($1::uuid[]) and action_type = 'project.cancelled'`, [ids],
      );
      expect(audits.rows).toHaveLength(3);
      expect(audits.rows.find((row) => row.entity_id === ids[0])?.actor_user_id).toBe(fixture.actors.admin.profileId);
      const delegatedCancelledIds = new Set<string>(ids.slice(1, 3));
      expect(audits.rows.filter((row) => delegatedCancelledIds.has(row.entity_id)).every((row) => row.actor_user_id === archiver.profileId)).toBe(true);
      expect(audits.rows.find((row) => row.entity_id === ids[0])).toMatchObject({
        action_type: "project.cancelled",
        before_data: { status: "planned", cancelled_at: null },
        after_data: { status: "cancelled", completed_at: null },
      });

      const security = await database.query<{
        anonymous_execute: boolean; authenticated_execute: boolean;
        identity_arguments: string; name: string; security_definer: boolean; settings: string[];
      }>(
        `select routine.proname as name, pg_catalog.pg_get_function_identity_arguments(routine.oid) as identity_arguments,
                routine.prosecdef as security_definer, routine.proconfig as settings,
                pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute,
                pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute
         from pg_catalog.pg_proc as routine join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public' and routine.proname = any(array['update_project', 'cancel_project']::text[]) order by routine.proname`,
      );
      expect(security.rows).toEqual([
        { name: "cancel_project", identity_arguments: "p_project_id uuid", security_definer: true, settings: ["search_path=\"\""], anonymous_execute: false, authenticated_execute: true },
        { name: "update_project", identity_arguments: "p_project_id uuid, p_name text, p_customer_name text, p_start_date date, p_delivery_date date, p_status text", security_definer: true, settings: ["search_path=\"\""], anonymous_execute: false, authenticated_execute: true },
      ]);
    });

    for (const actor of [fixture.actors.permitted, fixture.actors.unpermitted, fixture.actors.inactive]) {
      expectPermissionDenied((await actor.client.rpc("cancel_project", { p_project_id: ids[0] })).error);
    }
    expectPermissionDenied((await fixture.anonymousClient.rpc("cancel_project", { p_project_id: ids[0] })).error);
  });
  it("reopens only a Completed Project for an active Admin and audits the exact transition", async () => {
    const fixture = requireHarness();
    const projectId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           created_at, created_by_user_id, updated_at, updated_by_user_id,
           completed_at, cancelled_at
         ) values (
           $1, 'Completed Reopen Project', 'Original Customer', 'completed',
           '2026-09-01', '2026-09-30', '2026-09-01T09:00:00Z', $2,
           '2026-09-30T10:30:00Z', $2, '2026-09-30T10:00:00Z', null
         )`,
        [projectId, fixture.actors.admin.profileId],
      );
      const baseline = await database.query<ProjectRow>(
        `select *, start_date::text as start_date,
                delivery_date::text as delivery_date
         from public.projects where id = $1`,
        [projectId],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("savepoint normal_completed_edit_still_denied");
      await expect(database.query(
        `select public.update_project(
           $1, 'Changed', 'Original Customer', '2026-09-01',
           '2026-09-30', 'in_progress'
         )`,
        [projectId],
      )).rejects.toMatchObject({ code: "PRJ02" });
      await database.query("rollback to savepoint normal_completed_edit_still_denied");
      const reopened = await database.query<{ project_id: string }>(
        "select public.reopen_project($1) as project_id",
        [projectId],
      );
      await database.query("reset role");

      expect(reopened.rows).toEqual([{ project_id: projectId }]);
      const row = await database.query<ProjectRow>(
        `select *, start_date::text as start_date,
                delivery_date::text as delivery_date
         from public.projects where id = $1`,
        [projectId],
      );
      expect(row.rows[0]).toMatchObject({
        cancelled_at: null,
        completed_at: null,
        customer_name: "Original Customer",
        delivery_date: "2026-09-30",
        name: "Completed Reopen Project",
        start_date: "2026-09-01",
        status: "in_progress",
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(row.rows[0]?.created_at).toEqual(baseline.rows[0]?.created_at);
      expect(row.rows[0]?.created_by_user_id).toBe(
        baseline.rows[0]?.created_by_user_id,
      );
      expect(row.rows[0]?.updated_at).not.toEqual(baseline.rows[0]?.updated_at);

      const audits = await database.query<ProjectAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1 and action_type = 'project.reopened'`,
        [projectId],
      );
      expect(audits.rows).toEqual([{
        action_type: "project.reopened",
        actor_user_id: fixture.actors.admin.profileId,
        after_data: {
          cancelled_at: null,
          completed_at: null,
          customer_name: "Original Customer",
          delivery_date: "2026-09-30",
          name: "Completed Reopen Project",
          start_date: "2026-09-01",
          status: "in_progress",
        },
        before_data: {
          cancelled_at: null,
          completed_at: "2026-09-30T10:00:00+00:00",
          customer_name: "Original Customer",
          delivery_date: "2026-09-30",
          name: "Completed Reopen Project",
          start_date: "2026-09-01",
          status: "completed",
        },
        entity_id: projectId,
        entity_type: "project",
      }]);

      const security = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        identity_arguments: string;
        security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.prosecdef as security_definer,
           routine.proconfig as settings,
           pg_catalog.pg_get_function_identity_arguments(routine.oid)
             as identity_arguments,
           pg_catalog.has_function_privilege(
             'anon', routine.oid, 'execute'
           ) as anonymous_execute,
           pg_catalog.has_function_privilege(
             'authenticated', routine.oid, 'execute'
           ) as authenticated_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname = 'reopen_project'`,
      );
      expect(security.rows).toEqual([{
        anonymous_execute: false,
        authenticated_execute: true,
        identity_arguments: "p_project_id uuid",
        security_definer: true,
        settings: ["search_path=\"\""],
      }]);
    });
  });
  it("rejects every non-Completed source and every non-Admin reopen actor without side effects", async () => {
    const fixture = requireHarness();
    const sourceStatuses = [
      "planned",
      "in_progress",
      "on_hold",
      "cancelled",
    ] as const;
    const sourceIds = sourceStatuses.map(() => randomUUID());
    const completedId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.user_permissions (
           user_id, permission_definition_id, granted_by_user_id
         )
         select grant_row.actor_id, definition.id, $3::uuid
         from unnest($1::uuid[], $2::text[])
           as grant_row(actor_id, permission_key)
         join public.permission_definitions as definition
           on definition.key = grant_row.permission_key`,
        [
          [
            fixture.actors.productCreator.profileId,
            fixture.actors.supplierEditor.profileId,
          ],
          ["projects.edit", "projects.archive"],
          fixture.actors.admin.profileId,
        ],
      );
      for (const [index, status] of sourceStatuses.entries()) {
        await database.query(
          `insert into public.projects (
             id, name, customer_name, status, start_date, delivery_date,
             completed_at, cancelled_at, created_by_user_id,
             updated_by_user_id
           ) values (
             $1, $2, 'Customer', $3, '2026-09-01', '2026-09-30',
             null, $4, $5, $5
           )`,
          [
            sourceIds[index],
            `Invalid Reopen ${status}`,
            status,
            status === "cancelled" ? "2026-09-20T10:00:00Z" : null,
            fixture.actors.admin.profileId,
          ],
        );
      }
      await database.query(
        `insert into public.projects (
           id, name, customer_name, status, start_date, delivery_date,
           completed_at, cancelled_at, created_by_user_id, updated_by_user_id
         ) values (
           $1, 'Authorization Reopen Target', 'Customer', 'completed',
           '2026-09-01', '2026-09-30', '2026-09-30T10:00:00Z', null,
           $2, $2
         )`,
        [completedId, fixture.actors.admin.profileId],
      );
      const baseline = await database.query<ProjectRow>(
        `select *, start_date::text as start_date,
                delivery_date::text as delivery_date
         from public.projects
         where id = any($1::uuid[])
         order by id`,
        [[...sourceIds, completedId]],
      );

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      for (const [index, sourceId] of sourceIds.entries()) {
        await database.query(`savepoint invalid_reopen_source_${index}`);
        await expect(
          database.query("select public.reopen_project($1)", [sourceId]),
        ).rejects.toMatchObject({ code: "PRJ04" });
        await database.query(`rollback to savepoint invalid_reopen_source_${index}`);
      }
      await database.query("reset role");

      const deniedActors = [
        fixture.actors.permitted,
        fixture.actors.productCreator,
        fixture.actors.supplierEditor,
        fixture.actors.unpermitted,
        fixture.actors.inactive,
      ];
      for (const [index, actor] of deniedActors.entries()) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        await database.query(`savepoint denied_reopen_actor_${index}`);
        await expect(
          database.query("select public.reopen_project($1)", [completedId]),
        ).rejects.toMatchObject({ code: "42501" });
        await database.query(`rollback to savepoint denied_reopen_actor_${index}`);
        await database.query("reset role");
      }

      await database.query("set local role anon");
      await database.query("savepoint denied_anonymous_reopen");
      await expect(
        database.query("select public.reopen_project($1)", [completedId]),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint denied_anonymous_reopen");
      await database.query("reset role");

      const rows = await database.query<ProjectRow>(
        `select *, start_date::text as start_date,
                delivery_date::text as delivery_date
         from public.projects
         where id = any($1::uuid[])
         order by id`,
        [[...sourceIds, completedId]],
      );
      expect(rows.rows).toEqual(baseline.rows);
      expect(rows.rows.find((row) => row.id === completedId)).toMatchObject({
        completed_at: new Date("2026-09-30T10:00:00Z"),
        status: "completed",
      });
      for (const [index, status] of sourceStatuses.entries()) {
        expect(rows.rows.find((row) => row.id === sourceIds[index])?.status)
          .toBe(status);
      }
      const audits = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = any($1::uuid[])
           and action_type = 'project.reopened'`,
        [[...sourceIds, completedId]],
      );
      expect(audits.rows).toEqual([{ count: 0 }]);
    });
  });

}
