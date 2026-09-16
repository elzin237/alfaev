import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityFixtureHarness } from "./security-fixtures";

interface CountResultRow {
  count: number;
}

interface BrandRow {
  archived_at: Date | null;
  archived_by_user_id: string | null;
  created_at: Date;
  created_by_user_id: string;
  id: string;
  is_active: boolean;
  name: string;
  updated_at: Date;
  updated_by_user_id: string;
}

interface BrandAuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown> | null;
  before_data: Record<string, unknown> | null;
  entity_id: string;
  entity_type: string;
}

export function registerBrandsTests(requireHarness: () => SecurityFixtureHarness): void {
  it("creates trimmed Brands with case-insensitive identity and trusted audit metadata", async () => {
    const fixture = requireHarness();
    const brandName = `Bosch ${randomUUID()}`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ brand_id: string }>(
        "select public.create_brand($1::text) as brand_id",
        [`  ${brandName}  `],
      );
      await database.query("reset role");
      const brandId = created.rows[0]?.brand_id;

      if (!brandId) {
        throw new Error("Brand creation returned no ID");
      }

      const brand = await database.query<BrandRow>(
        `select *
         from public.brands
         where id = $1::uuid`,
        [brandId],
      );
      const audit = await database.query<BrandAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'brand.created'`,
        [brandId],
      );

      expect(brand.rows).toHaveLength(1);
      expect(brand.rows[0]).toMatchObject({
        archived_at: null,
        archived_by_user_id: null,
        created_by_user_id: fixture.actors.admin.profileId,
        id: brandId,
        is_active: true,
        name: brandName,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(brand.rows[0]?.created_at).toEqual(brand.rows[0]?.updated_at);
      expect(audit.rows).toEqual([
        {
          action_type: "brand.created",
          actor_user_id: fixture.actors.admin.profileId,
          after_data: { is_active: true, name: brandName },
          before_data: null,
          entity_id: brandId,
          entity_type: "brand",
        },
      ]);

      await database.query("savepoint duplicate_brand");
      await database.query("set local role authenticated");
      await expect(
        database.query("select public.create_brand($1::text)", [
          ` ${brandName.toUpperCase()} `,
        ]),
      ).rejects.toMatchObject({ code: "BRN02" });
      await database.query("rollback to savepoint duplicate_brand");
      await database.query("reset role");

      const duplicateCount = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.brands
         where pg_catalog.lower(name) = pg_catalog.lower($1::text)`,
        [brandName],
      );
      const createAuditCount = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'brand.created'`,
        [brandId],
      );

      expect(duplicateCount.rows).toEqual([{ count: 1 }]);
      expect(createAuditCount.rows).toEqual([{ count: 1 }]);
    });

    const blank = await fixture.actors.admin.client.rpc("create_brand", {
      p_name: "   ",
    });

    expect(blank.error?.code).toBe("22023");
  });
  it("keeps Brand edits explicit, archive-only, immutable, and fully audited", async () => {
    const fixture = requireHarness();
    const originalName = `Lifecycle ${randomUUID()}`;
    const updatedName = `${originalName} Updated`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ brand_id: string }>(
        "select public.create_brand($1::text) as brand_id",
        [originalName],
      );
      await database.query("reset role");
      const brandId = created.rows[0]?.brand_id;

      if (!brandId) {
        throw new Error("Brand lifecycle fixture returned no ID");
      }

      const beforeNoOp = await database.query<BrandRow>(
        "select * from public.brands where id = $1::uuid",
        [brandId],
      );
      await database.query("set local role authenticated");
      await database.query("select public.update_brand($1::uuid, $2::text)", [
        brandId,
        `  ${originalName}  `,
      ]);
      await database.query("reset role");
      const afterNoOp = await database.query<BrandRow>(
        "select * from public.brands where id = $1::uuid",
        [brandId],
      );
      const noOpAudit = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'brand.updated'`,
        [brandId],
      );

      expect(afterNoOp.rows).toEqual(beforeNoOp.rows);
      expect(noOpAudit.rows).toEqual([{ count: 0 }]);

      await database.query("set local role authenticated");
      await database.query("select public.update_brand($1::uuid, $2::text)", [
        brandId,
        updatedName,
      ]);
      await database.query("select public.archive_brand($1::uuid)", [brandId]);
      await database.query("reset role");

      const archived = await database.query<BrandRow>(
        "select * from public.brands where id = $1::uuid",
        [brandId],
      );
      const audits = await database.query<BrandAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type in (
             'brand.created',
             'brand.updated',
             'brand.archived'
           )
         order by pg_catalog.array_position(
           array[
             'brand.created',
             'brand.updated',
             'brand.archived'
           ]::text[],
           action_type
         )`,
        [brandId],
      );

      expect(archived.rows).toHaveLength(1);
      expect(archived.rows[0]).toMatchObject({
        archived_by_user_id: fixture.actors.admin.profileId,
        created_by_user_id: fixture.actors.admin.profileId,
        id: brandId,
        is_active: false,
        name: updatedName,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(archived.rows[0]?.archived_at).toBeInstanceOf(Date);
      expect(audits.rows.map((auditRow) => auditRow.action_type)).toEqual([
        "brand.created",
        "brand.updated",
        "brand.archived",
      ]);
      expect(audits.rows.every(
        (auditRow) =>
          auditRow.actor_user_id === fixture.actors.admin.profileId,
      )).toBe(true);

      await database.query("savepoint archived_brand_edit");
      await database.query("set local role authenticated");
      await expect(
        database.query("select public.update_brand($1::uuid, $2::text)", [
          brandId,
          `${updatedName} Forbidden`,
        ]),
      ).rejects.toMatchObject({ code: "BRN01" });
      await database.query("rollback to savepoint archived_brand_edit");
      await database.query("reset role");

      const afterFailedEdit = await database.query<BrandRow>(
        "select * from public.brands where id = $1::uuid",
        [brandId],
      );
      const auditAfterFailure = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'brand.updated'`,
        [brandId],
      );

      expect(afterFailedEdit.rows).toEqual(archived.rows);
      expect(auditAfterFailure.rows).toEqual([{ count: 1 }]);
    });
  });
  it("allows a delegated active Brand manager to create, edit, and archive", async () => {
    const fixture = requireHarness();
    const actor = fixture.actors.brandManager;
    const originalName = `Managed ${randomUUID()}`;
    const updatedName = `${originalName} Updated`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [actor.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ brand_id: string }>(
        "select public.create_brand($1::text) as brand_id",
        [originalName],
      );
      const brandId = created.rows[0]?.brand_id;

      if (!brandId) {
        throw new Error("Delegated Brand creation returned no ID");
      }

      await database.query("select public.update_brand($1::uuid, $2::text)", [
        brandId,
        updatedName,
      ]);
      await database.query("select public.archive_brand($1::uuid)", [brandId]);
      await database.query("reset role");

      const brand = await database.query<BrandRow>(
        "select * from public.brands where id = $1::uuid",
        [brandId],
      );
      const audits = await database.query<BrandAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type like 'brand.%'
         order by case action_type
           when 'brand.created' then 1
           when 'brand.updated' then 2
           when 'brand.archived' then 3
           else 4
         end`,
        [brandId],
      );

      expect(brand.rows[0]).toMatchObject({
        archived_by_user_id: actor.profileId,
        created_by_user_id: actor.profileId,
        is_active: false,
        name: updatedName,
        updated_by_user_id: actor.profileId,
      });
      expect(audits.rows.map((auditRow) => auditRow.action_type)).toEqual([
        "brand.created",
        "brand.updated",
        "brand.archived",
      ]);
      expect(audits.rows.every(
        (auditRow) => auditRow.actor_user_id === actor.profileId,
      )).toBe(true);
    });
  });
  it("limits active and archived Brand reads to Inventory-authorized actors", async () => {
    const fixture = requireHarness();
    const activeBrandId = randomUUID();
    const archivedBrandId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.brands (
           id,
           name,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $2::text, true, $5::uuid, $5::uuid, null, null),
           (
             $3::uuid,
             $4::text,
             false,
             $5::uuid,
             $5::uuid,
             pg_catalog.now(),
             $5::uuid
           )`,
        [
          activeBrandId,
          `Readable ${randomUUID()}`,
          archivedBrandId,
          `Archived ${randomUUID()}`,
          fixture.actors.admin.profileId,
        ],
      );

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.brandManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ id: string }>(
          `select id
           from public.brands
           where id = any($1::uuid[])
           order by id`,
          [[activeBrandId, archivedBrandId]],
        );
        await database.query("reset role");

        expect(visible.rows.map((row) => row.id).sort()).toEqual(
          [activeBrandId, archivedBrandId].sort(),
        );
      }

      for (const actor of [
        fixture.actors.permitted,
        fixture.actors.unpermitted,
        fixture.actors.inactiveBrandManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ id: string }>(
          `select id
           from public.brands
           where id = any($1::uuid[])`,
          [[activeBrandId, archivedBrandId]],
        );
        await database.query("reset role");

        expect(hidden.rows).toEqual([]);
      }

      await database.query("savepoint anonymous_brand_read");
      await database.query("set local role anon");
      await expect(
        database.query("select id from public.brands limit 1"),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_brand_read");
      await database.query("reset role");
    });
  });
  it("denies unauthorized Brand RPCs, direct writes, restore, and hard-delete paths", async () => {
    const fixture = requireHarness();

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.permitted.client,
      fixture.actors.unpermitted.client,
      fixture.actors.inactiveBrandManager.client,
    ]) {
      const { error } = await client.rpc("create_brand", {
        p_name: `Denied ${randomUUID()}`,
      });

      expectPermissionDenied(error);
    }

    const directInsert = await fixture.actors.brandManager.client
      .from("brands")
      .insert({
        name: `Direct ${randomUUID()}`,
        created_by_user_id: fixture.actors.brandManager.profileId,
        updated_by_user_id: fixture.actors.brandManager.profileId,
      });
    const directUpdate = await fixture.actors.brandManager.client
      .from("brands")
      .update({ name: `Direct update ${randomUUID()}` })
      .eq("id", randomUUID());
    const directDelete = await fixture.actors.brandManager.client
      .from("brands")
      .delete()
      .eq("id", randomUUID());

    expectPermissionDenied(directInsert.error);
    expectPermissionDenied(directUpdate.error);
    expectPermissionDenied(directDelete.error);

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      const columns = await database.query<{ column_name: string }>(
        `select column_name
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'brands'
         order by ordinal_position`,
      );
      const unsupportedFunctions = await database.query<{ count: number }>(
        `select count(*)::integer as count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'delete_brand',
             'reactivate_brand',
             'restore_brand',
             'unarchive_brand'
           )`,
      );
      const functions = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        function_name: string;
        is_security_definer: boolean;
        settings: string[];
      }>(
        `select
           routine.proname as function_name,
           routine.prosecdef as is_security_definer,
           routine.proconfig as settings,
           pg_catalog.has_function_privilege(
             'authenticated',
             routine.oid,
             'execute'
           ) as authenticated_execute,
           pg_catalog.has_function_privilege(
             'anon',
             routine.oid,
             'execute'
           ) as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'create_brand',
             'update_brand',
             'archive_brand'
           )
         order by routine.proname`,
      );

      expect(columns.rows.map((column) => column.column_name)).toEqual([
        "id",
        "name",
        "is_active",
        "created_at",
        "created_by_user_id",
        "updated_at",
        "updated_by_user_id",
        "archived_at",
        "archived_by_user_id",
      ]);
      expect(unsupportedFunctions.rows).toEqual([{ count: 0 }]);
      expect(functions.rows).toHaveLength(3);
      for (const brandFunction of functions.rows) {
        expect(brandFunction).toMatchObject({
          anonymous_execute: false,
          authenticated_execute: true,
          is_security_definer: true,
          settings: ["search_path=\"\""],
        });
      }
    });
  });

}
