import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { expectPermissionDenied } from "./helpers/assertions";
import type { SecurityFixtureHarness } from "./security-fixtures";

interface CountResultRow {
  count: number;
}

interface SupplierRow {
  archived_at: Date | null;
  archived_by_user_id: string | null;
  contact_email: string | null;
  contact_person_name: string | null;
  contact_phone: string | null;
  country: string;
  created_at: Date;
  created_by_user_id: string;
  id: string;
  is_active: boolean;
  name: string;
  updated_at: Date;
  updated_by_user_id: string;
}

interface SupplierAuditRow {
  action_type: string;
  actor_user_id: string;
  after_data: Record<string, unknown> | null;
  before_data: Record<string, unknown> | null;
  entity_id: string;
  entity_type: string;
}

export function registerSuppliersTests(requireHarness: () => SecurityFixtureHarness): void {
  it("normalizes Supplier creation, preserves name identity, and audits the trusted actor", async () => {
    const fixture = requireHarness();
    const supplierName = `Supplier ${randomUUID()}`;
    const duplicateEmail = `shared.${randomUUID()}@example.com`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ supplier_id: string }>(
        `select public.create_supplier(
           $1::text,
           $2::text,
           $3::text,
           $4::text,
           $5::text
         ) as supplier_id`,
        [
          `  ${supplierName}  `,
          "  Bosnia and Herzegovina  ",
          "  Ada Lovelace  ",
          "  +387 (0)33 ext. 42  ",
          `  ${duplicateEmail.toUpperCase()}  `,
        ],
      );
      const second = await database.query<{ supplier_id: string }>(
        `select public.create_supplier(
           $1::text,
           $2::text,
           $3::text,
           $4::text,
           $5::text
         ) as supplier_id`,
        [
          `Second ${randomUUID()}`,
          " Croatia ",
          "   ",
          "   ",
          ` ${duplicateEmail} `,
        ],
      );
      await database.query("reset role");
      const supplierId = created.rows[0]?.supplier_id;
      const secondSupplierId = second.rows[0]?.supplier_id;

      if (!supplierId || !secondSupplierId) {
        throw new Error("Supplier creation returned no ID");
      }

      const suppliers = await database.query<SupplierRow>(
        `select *
         from public.suppliers
         where id = any($1::uuid[])
         order by id`,
        [[supplierId, secondSupplierId]],
      );
      const createdSupplier = suppliers.rows.find(
        (supplier) => supplier.id === supplierId,
      );
      const secondSupplier = suppliers.rows.find(
        (supplier) => supplier.id === secondSupplierId,
      );
      const audit = await database.query<SupplierAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.created'`,
        [supplierId],
      );

      expect(createdSupplier).toMatchObject({
        archived_at: null,
        archived_by_user_id: null,
        contact_email: duplicateEmail,
        contact_person_name: "Ada Lovelace",
        contact_phone: "+387 (0)33 ext. 42",
        country: "Bosnia and Herzegovina",
        created_by_user_id: fixture.actors.admin.profileId,
        is_active: true,
        name: supplierName,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(createdSupplier?.created_at).toEqual(createdSupplier?.updated_at);
      expect(secondSupplier).toMatchObject({
        contact_email: duplicateEmail,
        contact_person_name: null,
        contact_phone: null,
        country: "Croatia",
      });
      expect(audit.rows).toEqual([
        {
          action_type: "supplier.created",
          actor_user_id: fixture.actors.admin.profileId,
          after_data: {
            contact_email: duplicateEmail,
            contact_person_name: "Ada Lovelace",
            contact_phone: "+387 (0)33 ext. 42",
            country: "Bosnia and Herzegovina",
            is_active: true,
            name: supplierName,
          },
          before_data: null,
          entity_id: supplierId,
          entity_type: "supplier",
        },
      ]);

      await database.query("savepoint duplicate_supplier");
      await database.query("set local role authenticated");
      await expect(
        database.query(
          "select public.create_supplier($1::text, $2::text)",
          [` ${supplierName.toUpperCase()} `, "Germany"],
        ),
      ).rejects.toMatchObject({ code: "SUP02" });
      await database.query("rollback to savepoint duplicate_supplier");
      await database.query("reset role");

      const identityCount = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.suppliers
         where pg_catalog.lower(name) = pg_catalog.lower($1::text)`,
        [supplierName],
      );
      const auditCount = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.created'`,
        [supplierId],
      );

      expect(identityCount.rows).toEqual([{ count: 1 }]);
      expect(auditCount.rows).toEqual([{ count: 1 }]);
    });

    for (const [input, expectedCode] of [
      [{ p_name: "   ", p_country: "Germany" }, "22023"],
      [{ p_name: `Name ${randomUUID()}`, p_country: "   " }, "22023"],
      [
        {
          p_name: `Name ${randomUUID()}`,
          p_country: "Germany",
          p_contact_email: "not-an-email",
        },
        "SUP03",
      ],
    ] as const) {
      const { error } = await fixture.actors.admin.client.rpc(
        "create_supplier",
        input,
      );

      expect(error?.code).toBe(expectedCode);
    }
  });
  it("keeps normalized Supplier no-ops audit-free and blocks archived edits", async () => {
    const fixture = requireHarness();
    const originalName = `Lifecycle Supplier ${randomUUID()}`;
    const updatedName = `${originalName} Updated`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ supplier_id: string }>(
        `select public.create_supplier(
           $1::text,
           $2::text,
           $3::text,
           $4::text,
           $5::text
         ) as supplier_id`,
        [originalName, "Germany", "Grace Hopper", "+49 30 123", "GRACE@EXAMPLE.COM"],
      );
      await database.query("reset role");
      const supplierId = created.rows[0]?.supplier_id;

      if (!supplierId) {
        throw new Error("Supplier lifecycle fixture returned no ID");
      }

      const beforeNoOp = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      await database.query("set local role authenticated");
      await database.query(
        `select public.update_supplier(
           $1::uuid,
           $2::text,
           $3::text,
           $4::text,
           $5::text,
           $6::text
         )`,
        [
          supplierId,
          ` ${originalName} `,
          " Germany ",
          " Grace Hopper ",
          " +49 30 123 ",
          " grace@example.com ",
        ],
      );
      await database.query("reset role");
      const afterNoOp = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      const noOpAudit = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.updated'`,
        [supplierId],
      );

      expect(afterNoOp.rows).toEqual(beforeNoOp.rows);
      expect(noOpAudit.rows).toEqual([{ count: 0 }]);

      await database.query("set local role authenticated");
      await database.query(
        `select public.update_supplier(
           $1::uuid,
           $2::text,
           $3::text,
           $4::text,
           $5::text,
           $6::text
         )`,
        [supplierId, updatedName, "Austria", "   ", " +43 / flexible ", "NEW@EXAMPLE.COM"],
      );
      await database.query("reset role");

      const updated = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      const updateAudit = await database.query<SupplierAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.updated'`,
        [supplierId],
      );

      expect(updated.rows[0]).toMatchObject({
        contact_email: "new@example.com",
        contact_person_name: null,
        contact_phone: "+43 / flexible",
        country: "Austria",
        created_by_user_id: fixture.actors.admin.profileId,
        is_active: true,
        name: updatedName,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(updated.rows[0]?.created_at).toEqual(beforeNoOp.rows[0]?.created_at);
      expect(updateAudit.rows).toEqual([
        {
          action_type: "supplier.updated",
          actor_user_id: fixture.actors.admin.profileId,
          after_data: {
            contact_email: "new@example.com",
            contact_person_name: null,
            contact_phone: "+43 / flexible",
            country: "Austria",
            name: updatedName,
          },
          before_data: {
            contact_email: "grace@example.com",
            contact_person_name: "Grace Hopper",
            contact_phone: "+49 30 123",
            country: "Germany",
            name: originalName,
          },
          entity_id: supplierId,
          entity_type: "supplier",
        },
      ]);

      await database.query(
        `update public.suppliers
         set is_active = false,
             archived_at = pg_catalog.now(),
             archived_by_user_id = $2::uuid
         where id = $1::uuid`,
        [supplierId, fixture.actors.admin.profileId],
      );
      const archivedBefore = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );

      await database.query("savepoint archived_supplier_edit");
      await database.query("set local role authenticated");
      await expect(
        database.query(
          "select public.update_supplier($1::uuid, $2::text, $3::text)",
          [supplierId, `${updatedName} Forbidden`, "Austria"],
        ),
      ).rejects.toMatchObject({ code: "SUP01" });
      await database.query("rollback to savepoint archived_supplier_edit");
      await database.query("reset role");

      const archivedAfter = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      const auditAfterFailure = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.updated'`,
        [supplierId],
      );

      expect(archivedAfter.rows).toEqual(archivedBefore.rows);
      expect(auditAfterFailure.rows).toEqual([{ count: 1 }]);
    });
  });
  it("separates delegated Supplier create and edit permissions", async () => {
    const fixture = requireHarness();
    const originalName = `Delegated Supplier ${randomUUID()}`;
    const updatedName = `${originalName} Updated`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.supplierCreator.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ supplier_id: string }>(
        "select public.create_supplier($1::text, $2::text) as supplier_id",
        [originalName, "Slovenia"],
      );
      await database.query("reset role");
      const supplierId = created.rows[0]?.supplier_id;

      if (!supplierId) {
        throw new Error("Delegated Supplier creation returned no ID");
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.supplierEditor.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query(
        "select public.update_supplier($1::uuid, $2::text, $3::text)",
        [supplierId, updatedName, "Slovenia"],
      );
      await database.query("reset role");

      const supplier = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      const audits = await database.query<SupplierAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type like 'supplier.%'
         order by case action_type
           when 'supplier.created' then 1
           when 'supplier.updated' then 2
           else 3
         end`,
        [supplierId],
      );

      expect(supplier.rows[0]).toMatchObject({
        created_by_user_id: fixture.actors.supplierCreator.profileId,
        name: updatedName,
        updated_by_user_id: fixture.actors.supplierEditor.profileId,
      });
      expect(audits.rows.map((audit) => [audit.action_type, audit.actor_user_id]))
        .toEqual([
          ["supplier.created", fixture.actors.supplierCreator.profileId],
          ["supplier.updated", fixture.actors.supplierEditor.profileId],
        ]);
    });

    const createOnlyEdit = await fixture.actors.supplierCreator.client.rpc(
      "update_supplier",
      {
        p_supplier_id: randomUUID(),
        p_name: `Denied ${randomUUID()}`,
        p_country: "Germany",
      },
    );
    const editOnlyCreate = await fixture.actors.supplierEditor.client.rpc(
      "create_supplier",
      { p_name: `Denied ${randomUUID()}`, p_country: "Germany" },
    );

    expectPermissionDenied(createOnlyEdit.error);
    expectPermissionDenied(editOnlyCreate.error);
  });
  it("archives a Supplier atomically with canonical metadata and one trusted audit", async () => {
    const fixture = requireHarness();
    const supplierName = `Archive Supplier ${randomUUID()}`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ supplier_id: string }>(
        `select public.create_supplier(
           $1::text,
           $2::text,
           $3::text,
           $4::text,
           $5::text
         ) as supplier_id`,
        [
          supplierName,
          "Germany",
          "Archive Contact",
          "+49 30 123",
          "archive@example.com",
        ],
      );
      await database.query("reset role");
      const supplierId = created.rows[0]?.supplier_id;

      if (!supplierId) {
        throw new Error("Supplier archive fixture returned no ID");
      }

      const before = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );

      await database.query("set local role authenticated");
      const archivedResult = await database.query<{ supplier_id: string }>(
        "select public.archive_supplier($1::uuid) as supplier_id",
        [supplierId],
      );
      await database.query("reset role");

      const after = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      const audit = await database.query<SupplierAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.archived'`,
        [supplierId],
      );

      expect(archivedResult.rows).toEqual([{ supplier_id: supplierId }]);
      expect(after.rows[0]).toMatchObject({
        archived_by_user_id: fixture.actors.admin.profileId,
        contact_email: before.rows[0]?.contact_email,
        contact_person_name: before.rows[0]?.contact_person_name,
        contact_phone: before.rows[0]?.contact_phone,
        country: before.rows[0]?.country,
        created_at: before.rows[0]?.created_at,
        created_by_user_id: before.rows[0]?.created_by_user_id,
        id: supplierId,
        is_active: false,
        name: before.rows[0]?.name,
        updated_by_user_id: fixture.actors.admin.profileId,
      });
      expect(after.rows[0]?.archived_at).toEqual(after.rows[0]?.updated_at);
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        action_type: "supplier.archived",
        actor_user_id: fixture.actors.admin.profileId,
        after_data: {
          archived_by_user_id: fixture.actors.admin.profileId,
          is_active: false,
          name: supplierName,
        },
        before_data: {
          archived_at: null,
          archived_by_user_id: null,
          is_active: true,
          name: supplierName,
        },
        entity_id: supplierId,
        entity_type: "supplier",
      });
      const auditArchivedAt = audit.rows[0]?.after_data?.archived_at;

      if (typeof auditArchivedAt !== "string") {
        throw new Error("Supplier archive audit returned no archive timestamp");
      }

      expect(Date.parse(auditArchivedAt)).toBe(
        after.rows[0]?.archived_at?.getTime(),
      );

      await database.query("savepoint repeated_supplier_archive");
      await database.query("set local role authenticated");
      await expect(
        database.query("select public.archive_supplier($1::uuid)", [supplierId]),
      ).rejects.toMatchObject({ code: "SUP01" });
      await database.query("rollback to savepoint repeated_supplier_archive");
      await database.query("reset role");

      await database.query("savepoint archived_supplier_update");
      await database.query("set local role authenticated");
      await expect(
        database.query(
          "select public.update_supplier($1::uuid, $2::text, $3::text)",
          [supplierId, `${supplierName} Edited`, "Austria"],
        ),
      ).rejects.toMatchObject({ code: "SUP01" });
      await database.query("rollback to savepoint archived_supplier_update");
      await database.query("reset role");

      const afterFailures = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      const auditAfterFailures = await database.query<CountResultRow>(
        `select count(*)::integer as count
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.archived'`,
        [supplierId],
      );

      expect(afterFailures.rows).toEqual(after.rows);
      expect(auditAfterFailures.rows).toEqual([{ count: 1 }]);

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.supplierViewer.authUserId],
      );
      await database.query("set local role authenticated");
      const stillReadable = await database.query<{ id: string }>(
        "select id from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      await database.query("reset role");

      expect(stillReadable.rows).toEqual([{ id: supplierId }]);
    });
  });
  it("allows an active suppliers.archive actor and derives the audit actor internally", async () => {
    const fixture = requireHarness();
    const supplierName = `Delegated Archive Supplier ${randomUUID()}`;

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.admin.authUserId],
      );
      await database.query("set local role authenticated");
      const created = await database.query<{ supplier_id: string }>(
        "select public.create_supplier($1::text, $2::text) as supplier_id",
        [supplierName, "Austria"],
      );
      await database.query("reset role");
      const supplierId = created.rows[0]?.supplier_id;

      if (!supplierId) {
        throw new Error("Delegated Supplier archive fixture returned no ID");
      }

      await database.query(
        "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
        [fixture.actors.supplierArchiver.authUserId],
      );
      await database.query("set local role authenticated");
      await database.query("select public.archive_supplier($1::uuid)", [supplierId]);
      await database.query("reset role");

      const archived = await database.query<SupplierRow>(
        "select * from public.suppliers where id = $1::uuid",
        [supplierId],
      );
      const audit = await database.query<SupplierAuditRow>(
        `select actor_user_id, action_type, entity_type, entity_id,
                before_data, after_data
         from public.audit_logs
         where entity_id = $1::uuid
           and action_type = 'supplier.archived'`,
        [supplierId],
      );

      expect(archived.rows[0]).toMatchObject({
        archived_by_user_id: fixture.actors.supplierArchiver.profileId,
        is_active: false,
        updated_by_user_id: fixture.actors.supplierArchiver.profileId,
      });
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        action_type: "supplier.archived",
        actor_user_id: fixture.actors.supplierArchiver.profileId,
        entity_id: supplierId,
        entity_type: "supplier",
      });
    });
  });
  it("denies Supplier archive to unrelated, inactive, and anonymous actors", async () => {
    const fixture = requireHarness();

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.unpermitted.client,
      fixture.actors.supplierViewer.client,
      fixture.actors.supplierCreator.client,
      fixture.actors.supplierEditor.client,
      fixture.actors.inactiveSupplierManager.client,
    ]) {
      const { error } = await client.rpc("archive_supplier", {
        p_supplier_id: randomUUID(),
      });

      expectPermissionDenied(error);
    }

    const missing = await fixture.actors.admin.client.rpc("archive_supplier", {
      p_supplier_id: randomUUID(),
    });
    const missingId = await fixture.actors.admin.client.rpc("archive_supplier", {
      p_supplier_id: null,
    });

    expect(missing.error?.code).toBe("P0002");
    expect(missingId.error?.code).toBe("22023");
  });
  it("denies Supplier mutations to unauthorized, inactive, and anonymous actors", async () => {
    const fixture = requireHarness();

    for (const client of [
      fixture.anonymousClient,
      fixture.actors.unpermitted.client,
      fixture.actors.supplierViewer.client,
      fixture.actors.inactiveSupplierManager.client,
    ]) {
      const createResult = await client.rpc("create_supplier", {
        p_name: `Denied ${randomUUID()}`,
        p_country: "Germany",
      });
      const updateResult = await client.rpc("update_supplier", {
        p_supplier_id: randomUUID(),
        p_name: `Denied ${randomUUID()}`,
        p_country: "Germany",
      });

      expectPermissionDenied(createResult.error);
      expectPermissionDenied(updateResult.error);
    }
  });
  it("allows Admin and suppliers.view readers to see active and archived Suppliers only", async () => {
    const fixture = requireHarness();
    const activeSupplierId = randomUUID();
    const archivedSupplierId = randomUUID();

    await fixture.withRollbackDatabaseTransaction(async (database) => {
      await database.query(
        `insert into public.suppliers (
           id,
           name,
           country,
           is_active,
           created_by_user_id,
           updated_by_user_id,
           archived_at,
           archived_by_user_id
         )
         values
           ($1::uuid, $2::text, 'Germany', true, $5::uuid, $5::uuid, null, null),
           (
             $3::uuid,
             $4::text,
             'Austria',
             false,
             $5::uuid,
             $5::uuid,
             pg_catalog.now(),
             $5::uuid
           )`,
        [
          activeSupplierId,
          `Readable Supplier ${randomUUID()}`,
          archivedSupplierId,
          `Archived Supplier ${randomUUID()}`,
          fixture.actors.admin.profileId,
        ],
      );

      for (const actor of [
        fixture.actors.admin,
        fixture.actors.supplierViewer,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const visible = await database.query<{ id: string }>(
          `select id
           from public.suppliers
           where id = any($1::uuid[])
           order by id`,
          [[activeSupplierId, archivedSupplierId]],
        );
        await database.query("reset role");

        expect(visible.rows.map((row) => row.id).sort()).toEqual(
          [activeSupplierId, archivedSupplierId].sort(),
        );
      }

      for (const actor of [
        fixture.actors.unpermitted,
        fixture.actors.supplierCreator,
        fixture.actors.supplierEditor,
        fixture.actors.inactiveSupplierManager,
      ]) {
        await database.query(
          "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
          [actor.authUserId],
        );
        await database.query("set local role authenticated");
        const hidden = await database.query<{ id: string }>(
          `select id
           from public.suppliers
           where id = any($1::uuid[])`,
          [[activeSupplierId, archivedSupplierId]],
        );
        await database.query("reset role");

        expect(hidden.rows).toEqual([]);
      }

      await database.query("savepoint anonymous_supplier_read");
      await database.query("set local role anon");
      await expect(
        database.query("select id from public.suppliers limit 1"),
      ).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous_supplier_read");
      await database.query("reset role");
    });
  });
  it("enforces Supplier constraints, direct-write denial, hardened RPCs, and Task 042 lifecycle scope", async () => {
    const fixture = requireHarness();
    const directInsert = await fixture.actors.supplierCreator.client
      .from("suppliers")
      .insert({
        name: `Direct ${randomUUID()}`,
        country: "Germany",
        created_by_user_id: fixture.actors.supplierCreator.profileId,
        updated_by_user_id: fixture.actors.supplierCreator.profileId,
      });
    const directUpdate = await fixture.actors.supplierEditor.client
      .from("suppliers")
      .update({ name: `Direct update ${randomUUID()}` })
      .eq("id", randomUUID());
    const directDelete = await fixture.actors.supplierEditor.client
      .from("suppliers")
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
           and table_name = 'suppliers'
         order by ordinal_position`,
      );
      const constraints = await database.query<{ constraint_name: string }>(
        `select constraint_name
         from information_schema.table_constraints
         where table_schema = 'public'
           and table_name = 'suppliers'
         order by constraint_name`,
      );
      const tableSecurity = await database.query<{
        row_security: boolean;
        authenticated_insert: boolean;
        authenticated_select: boolean;
        authenticated_update: boolean;
        authenticated_delete: boolean;
      }>(
        `select
           table_info.relrowsecurity as row_security,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'select') as authenticated_select,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'insert') as authenticated_insert,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'update') as authenticated_update,
           pg_catalog.has_table_privilege('authenticated', table_info.oid, 'delete') as authenticated_delete
         from pg_catalog.pg_class as table_info
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = table_info.relnamespace
         where namespace.nspname = 'public'
           and table_info.relname = 'suppliers'`,
      );
      const unsupportedFunctions = await database.query<{ count: number }>(
        `select count(*)::integer as count
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'delete_supplier',
             'reactivate_supplier',
             'restore_supplier',
             'unarchive_supplier'
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
           pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
           pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anonymous_execute
         from pg_catalog.pg_proc as routine
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'archive_supplier',
             'create_supplier',
             'update_supplier'
           )
         order by routine.proname`,
      );

      expect(columns.rows.map((column) => column.column_name)).toEqual([
        "id",
        "name",
        "country",
        "contact_person_name",
        "contact_phone",
        "contact_email",
        "is_active",
        "created_at",
        "created_by_user_id",
        "updated_at",
        "updated_by_user_id",
        "archived_at",
        "archived_by_user_id",
      ]);
      expect(constraints.rows.map((constraint) => constraint.constraint_name))
        .toEqual(expect.arrayContaining([
          "suppliers_archive_state_consistent",
          "suppliers_contact_email_basic_format",
          "suppliers_contact_email_normalized",
          "suppliers_contact_person_normalized",
          "suppliers_contact_phone_normalized",
          "suppliers_country_trimmed_nonblank",
          "suppliers_name_trimmed_nonblank",
          "suppliers_pkey",
        ]));
      expect(tableSecurity.rows).toEqual([
        {
          authenticated_delete: false,
          authenticated_insert: false,
          authenticated_select: true,
          authenticated_update: false,
          row_security: true,
        },
      ]);
      expect(unsupportedFunctions.rows).toEqual([{ count: 0 }]);
      expect(functions.rows).toHaveLength(3);
      for (const supplierFunction of functions.rows) {
        expect(supplierFunction).toMatchObject({
          anonymous_execute: false,
          authenticated_execute: true,
          is_security_definer: true,
          settings: ["search_path=\"\""],
        });
      }

      for (const [name, country, email] of [
        ["   ", "Germany", null],
        [`Constraint ${randomUUID()}`, "   ", null],
        [`Constraint ${randomUUID()}`, "Germany", "invalid-email"],
        [`Constraint ${randomUUID()}`, "Germany", "UPPER@EXAMPLE.COM"],
      ] as const) {
        await database.query("savepoint invalid_supplier_constraint");
        await expect(
          database.query(
            `insert into public.suppliers (
               name,
               country,
               contact_email,
               created_by_user_id,
               updated_by_user_id
             )
             values ($1::text, $2::text, $3::text, $4::uuid, $4::uuid)`,
            [name, country, email, fixture.actors.admin.profileId],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await database.query("rollback to savepoint invalid_supplier_constraint");
      }
    });
  });

}
