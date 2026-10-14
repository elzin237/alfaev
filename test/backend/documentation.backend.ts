import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadBackendTestEnvironment } from "./env";
import { createSecurityFixtureHarness, type SecurityFixtureHarness } from "./security-fixtures";

const environment = loadBackendTestEnvironment();
let harness: SecurityFixtureHarness | undefined;

interface OrderedAuditRow {
  action_type: string;
  actor_user_id: string;
  audit_log_id: string;
  created_at: string;
}

function expectTiedAuditsInCanonicalOrder(rows: OrderedAuditRow[]): void {
  expect(new Set(rows.map((row) => row.created_at))).toHaveLength(1);

  for (let index = 1; index < rows.length; index += 1) {
    expect(rows[index - 1]!.audit_log_id > rows[index]!.audit_log_id).toBe(true);
  }
}

function fixture(): SecurityFixtureHarness {
  if (!harness) throw new Error("Security fixtures are not ready");
  return harness;
}

async function setActor(
  database: import("pg").PoolClient,
  authUserId: string,
  role: "authenticated" | "anon" | "service_role" = "authenticated",
) {
  await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [authUserId]);
  await database.query(`set local role ${role}`);
}

async function createRecord(database: import("pg").PoolClient, authUserId: string) {
  await setActor(database, authUserId);
  const created = await database.query<{ id: string }>(
    "select public.create_documentation_record($1,$2,$3::date,$4::numeric) as id",
    [`  Document ${randomUUID()}  `, "uvoz", "2026-09-16", "12.345"],
  );
  await database.query("reset role");
  const id = created.rows[0]?.id;
  if (!id) throw new Error("Documentation fixture creation returned no ID");
  return id;
}

describe("Documentation backend security", () => {
  beforeAll(async () => { harness = await createSecurityFixtureHarness(environment); });
  afterAll(async () => {
    if (harness) expect(await harness.cleanup()).toMatchObject({
      auditLogsRemaining: 0, authUsersRemaining: 0, profilesRemaining: 0,
      permissionsRemaining: 0, postgresClosed: true,
    });
  });

  it("keeps the PDF bucket private and denies direct client object access", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      const bucket = await database.query<{ public: boolean; allowed_mime_types: string[] }>(
        "select public, allowed_mime_types from storage.buckets where id = $1",
        ["documentation-pdfs"],
      );
      expect(bucket.rows).toEqual([{ public: false, allowed_mime_types: ["application/pdf"] }]);
      const policy = await database.query<{ qual: string; with_check: string }>(
        "select qual, with_check from pg_policies where schemaname = $1 and tablename = $2 and policyname = $3",
        ["storage", "objects", "documentation_pdf_objects_no_direct_client_access"],
      );
      expect(policy.rows).toHaveLength(1);
      expect(policy.rows[0]?.qual).toContain("documentation-pdfs");
      expect(policy.rows[0]?.with_check).toContain("documentation-pdfs");
    });
  });

  it("allows trusted Storage setup but denies anonymous, non-Admin and Admin direct PDF downloads", async () => {
    const service = createClient(environment.supabaseUrl, environment.supabaseSecretKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const path = `${randomUUID()}/${randomUUID()}.pdf`;
    const bytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n%%EOF\n");
    const { error: uploadError } = await service.storage.from("documentation-pdfs")
      .upload(path, bytes, { contentType: "application/pdf", upsert: false });
    expect(uploadError).toBeNull();
    try {
      for (const actor of [
        fixture().anonymousClient, fixture().actors.permitted.client,
        fixture().actors.admin.client,
      ]) {
        const { data, error } = await actor.storage.from("documentation-pdfs").download(path);
        expect(data).toBeNull();
        expect(error).not.toBeNull();
        const directPath = `${randomUUID()}/${randomUUID()}.pdf`;
        const directUpload = await actor.storage.from("documentation-pdfs")
          .upload(directPath, bytes, { contentType: "application/pdf" });
        expect(directUpload.error).not.toBeNull();
        const directReplace = await actor.storage.from("documentation-pdfs")
          .update(path, bytes, { contentType: "application/pdf" });
        expect(directReplace.error).not.toBeNull();
        await actor.storage.from("documentation-pdfs").remove([path]);
        const stillStored = await service.storage.from("documentation-pdfs").download(path);
        expect(stillStored.error).toBeNull();
        expect(stillStored.data).not.toBeNull();
      }
    } finally {
      const { error } = await service.storage.from("documentation-pdfs").remove([path]);
      expect(error).toBeNull();
    }
  });

  it("attaches, replaces, and removes only validated private objects with one audit each", async () => {
    const service = createClient(environment.supabaseUrl, environment.supabaseSecretKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const paths: string[] = [];
    try {
      await fixture().withRollbackDatabaseTransaction(async (database) => {
        const id = await createRecord(database, fixture().actors.admin.authUserId);
        const bytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n%%EOF\n");
        const first = `${id}/${randomUUID()}.pdf`;
        const second = `${id}/${randomUUID()}.pdf`;
        for (const path of [first, second]) {
          const { error } = await service.storage.from("documentation-pdfs")
            .upload(path, bytes, { contentType: "application/pdf", upsert: false });
          expect(error).toBeNull();
          paths.push(path);
        }
        const change = async (expected: string | null, next: string | null, actorId: string) => {
          await setActor(database, actorId, "service_role");
          const result = await database.query<{ id: string }>(
            "select public.set_documentation_pdf_reference_admin($1,$2,$3,$4) as id",
            [id, expected, next, actorId],
          );
          await database.query("reset role");
          return result.rows[0]?.id;
        };

        expect(await change(null, first, fixture().actors.admin.authUserId)).toBe(id);
        let current = await database.query<{ pdf_storage_path: string | null }>(
          "select pdf_storage_path from public.documentation_records where id=$1", [id],
        );
        expect(current.rows[0]?.pdf_storage_path).toBe(first);

        await database.query("savepoint stale_pdf");
        await setActor(database, fixture().actors.admin.authUserId, "service_role");
        await expect(database.query(
          "select public.set_documentation_pdf_reference_admin($1,$2,$3,$4)",
          [id, null, second, fixture().actors.admin.authUserId],
        )).rejects.toMatchObject({ code: "DOC04" });
        await database.query("rollback to savepoint stale_pdf");
        await database.query("reset role");

        await database.query("savepoint inactive_pdf_actor");
        await setActor(database, fixture().actors.inactive.authUserId, "service_role");
        await expect(database.query(
          "select public.set_documentation_pdf_reference_admin($1,$2,$3,$4)",
          [id, first, second, fixture().actors.inactive.authUserId],
        )).rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint inactive_pdf_actor");
        await database.query("reset role");

        expect(await change(first, second, fixture().actors.admin.authUserId)).toBe(id);
        current = await database.query("select pdf_storage_path from public.documentation_records where id=$1", [id]);
        expect(current.rows[0]?.pdf_storage_path).toBe(second);
        expect(await change(second, null, fixture().actors.admin.authUserId)).toBe(id);
        current = await database.query("select pdf_storage_path from public.documentation_records where id=$1", [id]);
        expect(current.rows[0]?.pdf_storage_path).toBeNull();
        const audits = await database.query<OrderedAuditRow>(
          "select id as audit_log_id,action_type,actor_user_id,created_at::text from public.audit_logs where entity_id=$1 and action_type like $2 order by created_at desc,id desc",
          [id, "documentation.pdf_%"],
        );
        expect(audits.rows).toHaveLength(3);
        expectTiedAuditsInCanonicalOrder(audits.rows);
        expect(audits.rows.map((row) => row.action_type)).toEqual(expect.arrayContaining([
          "documentation.pdf_attached", "documentation.pdf_replaced", "documentation.pdf_removed",
        ]));
        expect(audits.rows.every((row) => row.actor_user_id === fixture().actors.admin.profileId)).toBe(true);
      });
    } finally {
      if (paths.length > 0) {
        const { error } = await service.storage.from("documentation-pdfs").remove(paths);
        expect(error).toBeNull();
      }
    }
  });

  it("denies non-Admin and anonymous Edge requests before any PDF operation", async () => {
    const body = { action: "open", recordId: randomUUID() };
    const nonAdmin = await fixture().actors.permitted.client.functions.invoke("admin-documentation-pdf", { body });
    const anonymous = await fixture().anonymousClient.functions.invoke("admin-documentation-pdf", { body });
    expect(nonAdmin.error).not.toBeNull();
    expect(anonymous.error).not.toBeNull();
  });

  it("creates, edits, no-ops, archives and audits atomically under active Admin authority", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      const id = await createRecord(database, fixture().actors.admin.authUserId);
      const row = await database.query<{ name: string; amount: string; is_active: boolean }>(
        "select name, amount::text, is_active from public.documentation_records where id=$1", [id],
      );
      expect(row.rows[0]).toMatchObject({ amount: "12.345", is_active: true });
      expect(row.rows[0]?.name).not.toMatch(/^ | $/);

      await setActor(database, fixture().actors.admin.authUserId);
      await database.query("select public.update_documentation_record($1,$2,$3,$4::date,$5::numeric)",
        [id, row.rows[0]?.name, "uvoz", "2026-09-16", "12.345"]);
      await database.query("select public.update_documentation_record($1,$2,$3,$4::date,$5::numeric)",
        [id, "  Revised  ", "troskovi", "2026-09-17", "0"]);
      await database.query("select public.archive_documentation_record($1)", [id]);
      await database.query("reset role");
      const result = await database.query<{ name: string; amount: string; is_active: boolean; archived_by_user_id: string }>(
        "select name,amount::text,is_active,archived_by_user_id from public.documentation_records where id=$1", [id],
      );
      expect(result.rows[0]).toMatchObject({ name: "Revised", amount: "0", is_active: false, archived_by_user_id: fixture().actors.admin.profileId });
      const audits = await database.query<OrderedAuditRow>(
        "select id as audit_log_id,action_type,actor_user_id,created_at::text from public.audit_logs where entity_id=$1 order by created_at desc,id desc", [id],
      );
      expect(audits.rows).toHaveLength(3);
      expectTiedAuditsInCanonicalOrder(audits.rows);
      expect(audits.rows.map((audit) => audit.action_type)).toEqual(expect.arrayContaining([
        "documentation.created", "documentation.updated", "documentation.archived",
      ]));
      expect(audits.rows.every((audit) => audit.actor_user_id === fixture().actors.admin.profileId)).toBe(true);

      await database.query("savepoint archived_edit");
      await setActor(database, fixture().actors.admin.authUserId);
      await expect(database.query("select public.update_documentation_record($1,$2,$3,$4::date,$5::numeric)",
        [id, "Again", "uvoz", "2026-09-18", "1"])).rejects.toMatchObject({ code: "DOC01" });
      await database.query("rollback to savepoint archived_edit");
      await database.query("reset role");
      await expect(database.query("delete from public.documentation_records where id=$1", [id]))
        .rejects.toMatchObject({ code: "DOC01" });
    });
  });

  it("accepts exactly the four categories and rejects malformed lifecycle, path, and actor references", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      await setActor(database, fixture().actors.admin.authUserId);
      const ids: string[] = [];
      for (const category of ["uvoz", "izvoz", "nabavka", "troskovi"]) {
        const result = await database.query<{ id: string }>(
          "select public.create_documentation_record($1,$2,$3::date,$4::numeric) as id",
          [`Name ${category}`, category, "2026-09-16", "0"],
        );
        if (result.rows[0]?.id) ids.push(result.rows[0].id);
      }
      await database.query("reset role");
      expect(ids).toHaveLength(4);
      const rows = await database.query<{ category: string; amount: string }>(
        "select category,amount::text from public.documentation_records where id=any($1::uuid[]) order by category",
        [ids],
      );
      expect(rows.rows.map((row) => row.category)).toEqual(["izvoz", "nabavka", "troskovi", "uvoz"]);
      expect(rows.rows.every((row) => row.amount === "0")).toBe(true);

      const actorId = fixture().actors.admin.profileId;
      const base = ["Record", "uvoz", "2026-09-16", "1", actorId, actorId];
      const invalidRows = [
        { column: "is_active", values: [...base, false], code: "23514" },
        { column: "pdf_storage_path", values: [...base, " untrimmed.pdf "], code: "23514" },
      ];
      for (const { column, values, code } of invalidRows) {
        await database.query("savepoint invalid_record");
        await expect(database.query(
          `insert into public.documentation_records (
            name,category,document_date,amount,created_by_user_id,updated_by_user_id,${column}
          ) values ($1,$2,$3::date,$4::numeric,$5::uuid,$6::uuid,$7)`,
          values,
        )).rejects.toMatchObject({ code });
        await database.query("rollback to savepoint invalid_record");
      }
      await database.query("savepoint invalid_actor");
      await expect(database.query(
        `insert into public.documentation_records (
          name,category,document_date,amount,created_by_user_id,updated_by_user_id
        ) values ($1,$2,$3::date,$4::numeric,$5::uuid,$6::uuid)`,
        ["Record", "uvoz", "2026-09-16", "1", randomUUID(), actorId],
      )).rejects.toMatchObject({ code: "23503" });
      await database.query("rollback to savepoint invalid_actor");
    });
  });

  it("denies non-Admin, inactive Admin, anonymous and direct writes", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      const id = await createRecord(database, fixture().actors.admin.authUserId);
      for (const actor of [fixture().actors.permitted, fixture().actors.inactive]) {
        await database.query("savepoint denied_actor");
        await setActor(database, actor.authUserId);
        const visible = await database.query("select id from public.documentation_records where id=$1", [id]);
        expect(visible.rows).toEqual([]);
        await expect(database.query("select public.archive_documentation_record($1)", [id]))
          .rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint denied_actor");
        await database.query("reset role");

        await database.query("savepoint denied_create");
        await setActor(database, actor.authUserId);
        await expect(database.query(
          "select public.create_documentation_record($1,$2,$3::date,$4::numeric)",
          ["Denied", "uvoz", "2026-09-16", "1"],
        )).rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint denied_create");
        await database.query("reset role");
      }
      await database.query("savepoint anonymous");
      await setActor(database, "", "anon");
      await expect(database.query("select id from public.documentation_records where id=$1", [id]))
        .rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint anonymous");
      await database.query("reset role");

      const directWrites = [
        { sql: "insert into public.documentation_records (name) values ($1)", parameters: ["wrong"] },
        { sql: "update public.documentation_records set name=$1 where id=$2", parameters: ["wrong", id] },
        { sql: "delete from public.documentation_records where id=$1", parameters: [id] },
      ];
      for (const { sql, parameters } of directWrites) {
        await database.query("savepoint direct_write");
        await setActor(database, fixture().actors.admin.authUserId);
        await expect(database.query(sql, parameters))
          .rejects.toMatchObject({ code: "42501" });
        await database.query("rollback to savepoint direct_write");
        await database.query("reset role");
      }
    });
  });

  it("rejects invalid categories, dates, negative amount, and unauthorized PDF reference calls", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      const id = await createRecord(database, fixture().actors.admin.authUserId);
      for (const [name, category, date, amount] of [
        [" ", "uvoz", "2026-09-16", "1"],
        ["Name", "other", "2026-09-16", "1"],
        ["Name", "uvoz", null, "1"],
        ["Name", "uvoz", "2026-09-16", "-1"],
      ]) {
        await database.query("savepoint invalid_input");
        await setActor(database, fixture().actors.admin.authUserId);
        await expect(database.query(
          "select public.create_documentation_record($1,$2,$3::date,$4::numeric)",
          [name, category, date, amount],
        )).rejects.toMatchObject({ code: "22023" });
        await database.query("rollback to savepoint invalid_input");
        await database.query("reset role");
      }
      await database.query("savepoint direct_pdf_reference");
      await setActor(database, fixture().actors.admin.authUserId);
      await expect(database.query(
        "select public.set_documentation_pdf_reference_admin($1,$2,$3,$4)",
        [id, null, `${id}/${randomUUID()}.pdf`, fixture().actors.admin.authUserId],
      )).rejects.toMatchObject({ code: "42501" });
      await database.query("rollback to savepoint direct_pdf_reference");
      await database.query("reset role");
      await database.query("savepoint service_pdf_reference");
      await setActor(database, fixture().actors.admin.authUserId, "service_role");
      await expect(database.query(
        "select public.set_documentation_pdf_reference_admin($1,$2,$3,$4)",
        [id, null, `${id}/${randomUUID()}.pdf`, fixture().actors.admin.authUserId],
      )).rejects.toMatchObject({ code: "DOC02" });
      await database.query("rollback to savepoint service_pdf_reference");
      await database.query("reset role");
    });
  });
});
