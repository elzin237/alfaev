import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadBackendTestEnvironment } from "./env";
import { createSecurityFixtureHarness, type SecurityFixtureHarness } from "./security-fixtures";

const environment = loadBackendTestEnvironment();
let harness: SecurityFixtureHarness | undefined;
function fixture(): SecurityFixtureHarness {
  if (!harness) throw new Error("Security fixtures are not ready");
  return harness;
}

async function setActor(database: PoolClient, authUserId: string, role: "authenticated" | "anon" = "authenticated") {
  await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [authUserId]);
  await database.query(`set local role ${role}`);
}

async function createAsset(database: PoolClient, name = `Asset ${randomUUID()}`, category = "oprema", quantity = 2) {
  await setActor(database, fixture().actors.admin.authUserId);
  const result = await database.query<{ id: string }>(
    "select public.create_fixed_asset($1,$2,$3::date,$4::bigint) as id",
    [`  ${name}  `, category, "2026-09-16", quantity],
  );
  await database.query("reset role");
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Fixed Asset fixture creation returned no ID");
  return id;
}

async function auditActions(database: PoolClient, id: string) {
  const result = await database.query<{ action_type: string; actor_user_id: string }>(
    "select action_type,actor_user_id from public.audit_logs where entity_id=$1 order by created_at,id", [id],
  );
  return result.rows;
}

async function assertRejected(database: PoolClient, sql: string, parameters: readonly unknown[], code: string) {
  await database.query("savepoint rejected_fixed_asset_operation");
  await expect(database.query(sql, [...parameters])).rejects.toMatchObject({ code });
  await database.query("rollback to savepoint rejected_fixed_asset_operation");
}

describe("Fixed Asset Admin backend", () => {
  beforeAll(async () => { harness = await createSecurityFixtureHarness(environment); });
  afterAll(async () => {
    if (harness) expect(await harness.cleanup()).toMatchObject({
      auditLogsRemaining: 0, authUsersRemaining: 0, profilesRemaining: 0,
      permissionsRemaining: 0, postgresClosed: true,
    });
  });

  it("creates, no-ops, edits and archives with exact lifecycle metadata and one audit per change", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      const id = await createAsset(database, "  Company lathe  ");
      const original = await database.query<{ name: string; is_active: boolean; archived_at: Date | null;
        archived_by_user_id: string | null; updated_at: Date; updated_by_user_id: string }>(
        "select name,is_active,archived_at,archived_by_user_id,updated_at,updated_by_user_id from public.fixed_assets where id=$1", [id],
      );
      expect(original.rows[0]).toMatchObject({ name: "Company lathe", is_active: true,
        archived_at: null, archived_by_user_id: null, updated_by_user_id: fixture().actors.admin.profileId });
      await setActor(database, fixture().actors.admin.authUserId);
      await database.query("select public.update_fixed_asset($1,$2,$3,$4::date,$5::bigint)",
        [id, " Company lathe ", "oprema", "2026-09-16", 2]);
      await database.query("reset role");
      const afterNoop = await database.query<{ updated_at: Date; updated_by_user_id: string }>(
        "select updated_at,updated_by_user_id from public.fixed_assets where id=$1", [id],
      );
      expect(afterNoop.rows[0]).toEqual({ updated_at: original.rows[0]?.updated_at,
        updated_by_user_id: original.rows[0]?.updated_by_user_id });
      expect((await auditActions(database, id)).map((row) => row.action_type)).toEqual(["fixed_asset.created"]);

      await setActor(database, fixture().actors.admin.authUserId);
      await database.query("select public.update_fixed_asset($1,$2,$3,$4::date,$5::bigint)",
        [id, "  New lathe  ", "alati", "2026-09-17", 4]);
      await database.query("select public.archive_fixed_asset($1)", [id]);
      await database.query("reset role");
      const final = await database.query<{ name: string; category: string; purchase_date: Date; quantity: string;
        is_active: boolean; archived_at: Date | null; archived_by_user_id: string;
        updated_at: Date; updated_by_user_id: string }>(
        "select name,category,purchase_date,quantity,is_active,archived_at,archived_by_user_id,updated_at,updated_by_user_id from public.fixed_assets where id=$1", [id],
      );
      expect(final.rows[0]).toMatchObject({ name: "New lathe", category: "alati", quantity: "4",
        is_active: false, archived_by_user_id: fixture().actors.admin.profileId,
        updated_by_user_id: fixture().actors.admin.profileId });
      expect(final.rows[0]?.archived_at).toEqual(final.rows[0]?.updated_at);
      const audit = await auditActions(database, id);
      expect(audit.map((row) => row.action_type).sort()).toEqual([
        "fixed_asset.archived", "fixed_asset.created", "fixed_asset.updated",
      ]);
      expect(audit.every((row) => row.actor_user_id === fixture().actors.admin.profileId)).toBe(true);

      await setActor(database, fixture().actors.admin.authUserId);
      await assertRejected(database, "select public.update_fixed_asset($1,$2,$3,$4::date,$5::bigint)",
        [id, "Again", "oprema", "2026-09-17", 4], "FAS01");
      await assertRejected(database, "select public.archive_fixed_asset($1)", [id], "FAS01");
      await database.query("reset role");
      await assertRejected(database, "update public.fixed_assets set name=$1 where id=$2", ["again", id], "FAS01");
      await assertRejected(database, "delete from public.fixed_assets where id=$1", [id], "FAS01");
      expect((await auditActions(database, id))).toHaveLength(3);
    });
  });

  it("accepts exact categories and duplicate names but rejects malformed name/date/quantity and lifecycle state", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      for (const category of ["oprema", "uredjaji", "alati"]) {
        const id = await createAsset(database, "Duplicate fixed name", category);
        expect(id).toBeTruthy();
      }
      await setActor(database, fixture().actors.admin.authUserId);
      for (const [name, category, date, quantity] of [
        [" ", "oprema", "2026-09-16", 1],
        ["Name", "unknown", "2026-09-16", 1],
        ["Name", "oprema", null, 1],
        ["Name", "oprema", "2026-09-16", 0],
        ["Name", "oprema", "2026-09-16", -1],
      ]) {
        await assertRejected(database, "select public.create_fixed_asset($1,$2,$3::date,$4::bigint)",
          [name, category, date, quantity], "22023");
      }
      await database.query("reset role");
      const actorId = fixture().actors.admin.profileId;
      for (const [isActive, archivedAt, archivedBy] of [
        [false, null, null], [true, new Date(), actorId], [false, new Date(), null],
      ]) {
        await assertRejected(database,
          `insert into public.fixed_assets (
            name,category,purchase_date,quantity,is_active,created_by_user_id,
            updated_by_user_id,archived_at,archived_by_user_id
          ) values ($1,$2,$3::date,$4::bigint,$5,$6,$7,$8,$9)`,
          ["Fixture", "oprema", "2026-09-16", 1, isActive, actorId, actorId, archivedAt, archivedBy], "23514");
      }
      await assertRejected(database,
        `insert into public.fixed_assets (
          name,category,purchase_date,quantity,created_by_user_id,updated_by_user_id
        ) values ($1,$2,$3::date,$4::bigint,$5,$6)`,
        ["Fixture", "oprema", "2026-09-16", 1, randomUUID(), actorId], "23503");
      for (const [name, category, quantity] of [
        [" Untrimmed ", "oprema", 1], ["", "oprema", 1],
        ["Fixture", "unknown", 1], ["Fixture", "oprema", 0],
        ["Fixture", "oprema", -1],
      ]) {
        await assertRejected(database,
          `insert into public.fixed_assets (
            name,category,purchase_date,quantity,created_by_user_id,updated_by_user_id
          ) values ($1,$2,$3::date,$4::bigint,$5,$6)`,
          [name, category, "2026-09-16", quantity, actorId, actorId], "23514");
      }
    });
  });

  it("limits reads and all RPCs to active Admin; direct client writes remain denied", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      const id = await createAsset(database);
      const actors = [fixture().actors.permitted, fixture().actors.brandManager,
        fixture().actors.productEditor, fixture().actors.inactive];
      for (const actor of actors) {
        await setActor(database, actor.authUserId);
        const visible = await database.query("select id from public.fixed_assets where id=$1", [id]);
        expect(visible.rows).toEqual([]);
        await assertRejected(database, "select public.create_fixed_asset($1,$2,$3::date,$4::bigint)",
          ["Denied", "oprema", "2026-09-16", 1], "42501");
        await assertRejected(database, "select public.update_fixed_asset($1,$2,$3,$4::date,$5::bigint)",
          [id, "Denied", "oprema", "2026-09-16", 1], "42501");
        await assertRejected(database, "select public.archive_fixed_asset($1)", [id], "42501");
        await database.query("reset role");
      }
      await setActor(database, "", "anon");
      await assertRejected(database, "select id from public.fixed_assets", [], "42501");
      await assertRejected(database, "select public.create_fixed_asset($1,$2,$3::date,$4::bigint)",
        ["Denied", "oprema", "2026-09-16", 1], "42501");
      await database.query("reset role");

      for (const [sql, parameters] of [
        ["insert into public.fixed_assets(name) values ($1)", ["Denied"]],
        ["update public.fixed_assets set name=$1 where id=$2", ["Denied", id]],
        ["delete from public.fixed_assets where id=$1", [id]],
      ] as const) {
        await setActor(database, fixture().actors.admin.authUserId);
        await assertRejected(database, sql, parameters, "42501");
        await database.query("reset role");
      }
      await setActor(database, fixture().actors.admin.authUserId);
      expect((await database.query("select id from public.fixed_assets where id=$1", [id])).rows).toEqual([{ id }]);
      await database.query("reset role");
      expect((await auditActions(database, id))).toHaveLength(1);

      const permission = await database.query<{ count: string }>(
        "select count(*)::text as count from public.permission_definitions where key like $1", ["%fixed%"],
      );
      expect(permission.rows[0]?.count).toBe("0");
    });
  });

  it("leaves Product, Procurement and warehouse stock untouched by create/edit/archive", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      const counts = async () => {
        const result = await database.query<{ products: string; procurement: string; balances: string; movements: string }>(
          `select
            (select count(*)::text from public.products) as products,
            (select count(*)::text from public.procurement_requests) as procurement,
            (select count(*)::text from public.inventory_balances) as balances,
            (select count(*)::text from public.inventory_movements) as movements`,
        );
        return result.rows[0];
      };
      const before = await counts();
      const id = await createAsset(database);
      await setActor(database, fixture().actors.admin.authUserId);
      await database.query("select public.update_fixed_asset($1,$2,$3,$4::date,$5::bigint)",
        [id, "Updated", "uredjaji", "2026-09-17", 50]);
      await database.query("select public.archive_fixed_asset($1)", [id]);
      await database.query("reset role");
      expect(await counts()).toEqual(before);
      expect((await auditActions(database, id)).map((row) => row.action_type).sort()).toEqual([
        "fixed_asset.archived", "fixed_asset.created", "fixed_asset.updated",
      ]);
    });
  });

  it("rolls back the Fixed Asset row if its atomic audit append fails", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      await database.query(`create function pg_temp.reject_fixed_asset_audit()
        returns trigger language plpgsql as $function$
        begin
          if new.action_type = 'fixed_asset.created' then
            raise exception 'Simulated audit failure' using errcode = 'FAS90';
          end if;
          return new;
        end;
        $function$`);
      await database.query(`create trigger reject_fixed_asset_audit_test
        before insert on public.audit_logs for each row
        execute function pg_temp.reject_fixed_asset_audit()`);
      const name = `Rollback asset ${randomUUID()}`;
      await setActor(database, fixture().actors.admin.authUserId);
      await assertRejected(database,
        "select public.create_fixed_asset($1,$2,$3::date,$4::bigint)",
        [name, "oprema", "2026-09-16", 1], "FAS90");
      await database.query("reset role");
      const assets = await database.query("select id from public.fixed_assets where name=$1", [name]);
      expect(assets.rows).toEqual([]);
      const audit = await database.query("select id from public.audit_logs where action_type=$1 and after_data->>'name'=$2",
        ["fixed_asset.created", name]);
      expect(audit.rows).toEqual([]);
    });
  });
});
