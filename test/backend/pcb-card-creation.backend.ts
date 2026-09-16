import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadBackendTestEnvironment } from "./env";
import { createSecurityFixtureHarness, type SecurityFixtureHarness } from "./security-fixtures";

const environment = loadBackendTestEnvironment();
let harness: SecurityFixtureHarness | undefined;

function fixture(): SecurityFixtureHarness {
  if (!harness) throw new Error("PCB security fixtures are not ready");
  return harness;
}

interface CreationRow {
  pcb_card_id: string;
  product_id: string;
  serial_number: string;
}

async function setActor(database: PoolClient, authUserId: string, role: "authenticated" | "anon" = "authenticated") {
  await database.query("select pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [authUserId]);
  await database.query(`set local role ${role}`);
}

async function createCard(database: PoolClient, authUserId: string, name: string): Promise<CreationRow> {
  await setActor(database, authUserId);
  const result = await database.query<CreationRow>("select * from public.create_pcb_card($1)", [name]);
  await database.query("reset role");
  const created = result.rows[0];
  if (!created) throw new Error("PCB Card creation returned no row");
  return created;
}

async function grantPermission(database: PoolClient, profileId: string, permissionKey: string) {
  await database.query(
    `insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
     select $1, definition.id, $2 from public.permission_definitions as definition
     where definition.key=$3`,
    [profileId, fixture().actors.admin.profileId, permissionKey],
  );
}

async function counts(database: PoolClient) {
  const result = await database.query<{
    products: string; cards: string; balances: string; movements: string;
    suppliers: string; product_suppliers: string; audits: string;
  }>(`select
    (select count(*)::text from public.products) as products,
    (select count(*)::text from public.pcb_cards) as cards,
    (select count(*)::text from public.inventory_balances) as balances,
    (select count(*)::text from public.inventory_movements) as movements,
    (select count(*)::text from public.suppliers) as suppliers,
    (select count(*)::text from public.product_suppliers) as product_suppliers,
    (select count(*)::text from public.audit_logs) as audits`);
  return result.rows[0];
}

async function assertRejected(database: PoolClient, sql: string, params: readonly unknown[], code: string) {
  await database.query("savepoint rejected_pcb_create");
  await expect(database.query(sql, [...params])).rejects.toMatchObject({ code });
  await database.query("rollback to savepoint rejected_pcb_create");
}

describe("trusted PCB Card creation", () => {
  beforeAll(async () => { harness = await createSecurityFixtureHarness(environment); });
  afterAll(async () => {
    if (harness) expect(await harness.cleanup()).toMatchObject({
      auditLogsRemaining: 0, authUsersRemaining: 0, profilesRemaining: 0,
      permissionsRemaining: 0, postgresClosed: true,
    });
  });

  it("derives one Product, zero balance and exactly two trusted audits for an Admin", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      const before = await counts(database);
      const created = await createCard(database, fixture().actors.admin.authUserId, "  Controller PCB  ");
      expect(created.serial_number).toMatch(/^[0-9]{7}$/);
      const product = await database.query<{
        name: string; category: string; brand_id: string | null; product_kind: string;
        is_active: boolean; serial_number: string; created_by_user_id: string;
      }>(`select name,category,brand_id,product_kind,is_active,serial_number,created_by_user_id
          from public.products where id=$1`, [created.product_id]);
      expect(product.rows).toEqual([{
        name: "Controller PCB", category: "PCB", brand_id: null,
        product_kind: "pcb_finished_good", is_active: true,
        serial_number: created.serial_number, created_by_user_id: fixture().actors.admin.profileId,
      }]);
      const card = await database.query<{
        name: string; output_product_id: string; is_active: boolean;
        archived_at: Date | null; archived_by_user_id: string | null;
        created_by_user_id: string; updated_by_user_id: string;
      }>(`select name,output_product_id,is_active,archived_at,archived_by_user_id,
          created_by_user_id,updated_by_user_id from public.pcb_cards where id=$1`, [created.pcb_card_id]);
      expect(card.rows).toEqual([{
        name: "Controller PCB", output_product_id: created.product_id, is_active: true,
        archived_at: null, archived_by_user_id: null,
        created_by_user_id: fixture().actors.admin.profileId,
        updated_by_user_id: fixture().actors.admin.profileId,
      }]);
      const balance = await database.query<{ quantity: string }>(
        "select quantity from public.inventory_balances where product_id=$1", [created.product_id],
      );
      expect(balance.rows).toEqual([{ quantity: "0" }]);
      const audits = await database.query<{
        action_type: string; actor_user_id: string; entity_id: string;
        after_data: Record<string, unknown>;
      }>(`select action_type,actor_user_id,entity_id,after_data from public.audit_logs
          where entity_id=any($1::uuid[]) order by action_type`,
        [[created.product_id, created.pcb_card_id]]);
      expect(audits.rows.map((row) => row.action_type)).toEqual(["pcb_card.created", "product.created"]);
      expect(audits.rows.every((row) => row.actor_user_id === fixture().actors.admin.profileId)).toBe(true);
      expect(audits.rows.find((row) => row.action_type === "product.created")?.after_data)
        .toMatchObject({ name: "Controller PCB", category: "PCB", brand_id: null,
          product_kind: "pcb_finished_good", serial_number: created.serial_number });
      expect(audits.rows.find((row) => row.action_type === "pcb_card.created")?.after_data)
        .toMatchObject({ pcb_card_id: created.pcb_card_id, name: "Controller PCB",
          output_product_id: created.product_id, serial_number: created.serial_number });
      const after = await counts(database);
      expect(Number(after?.products) - Number(before?.products)).toBe(1);
      expect(Number(after?.cards) - Number(before?.cards)).toBe(1);
      expect(Number(after?.balances) - Number(before?.balances)).toBe(1);
      expect(after?.movements).toBe(before?.movements);
      expect(after?.suppliers).toBe(before?.suppliers);
      expect(after?.product_suppliers).toBe(before?.product_suppliers);
      expect(Number(after?.audits) - Number(before?.audits)).toBe(2);
    });
  });

  it("allows pcb.create without read or Inventory grants, and allows duplicate card names", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture().actors.unpermitted;
      await grantPermission(database, actor.profileId, "pcb.create");
      const grants = await database.query<{ key: string }>(
        `select definition.key from public.user_permissions as permission
         join public.permission_definitions as definition on definition.id=permission.permission_definition_id
         where permission.user_id=$1 order by definition.key`, [actor.profileId],
      );
      expect(grants.rows.map((row) => row.key)).toEqual(["pcb.create"]);
      const name = `Duplicate card ${randomUUID()}`;
      const first = await createCard(database, actor.authUserId, name);
      const second = await createCard(database, actor.authUserId, name);
      expect(first.pcb_card_id).not.toBe(second.pcb_card_id);
      expect(first.product_id).not.toBe(second.product_id);
      expect(first.serial_number).not.toBe(second.serial_number);
      const cards = await database.query<{ name: string }>(
        "select name from public.pcb_cards where id=any($1::uuid[])", [[first.pcb_card_id, second.pcb_card_id]],
      );
      expect(cards.rows).toEqual([{ name }, { name }]);
    });
  });

  it("denies unrelated permissions, inactive Admin and anon without creating rows or audits", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture().actors.unpermitted;
      const before = await counts(database);
      for (const permissionKey of [
        null, "pcb.view", "pcb.edit", "pcb.produce", "pcb.archive", "inventory.products.create",
      ]) {
        await database.query("savepoint permission_case");
        if (permissionKey) await grantPermission(database, actor.profileId, permissionKey);
        await setActor(database, actor.authUserId);
        await assertRejected(database, "select * from public.create_pcb_card($1)",
          [`Denied ${randomUUID()}`], "42501");
        await database.query("rollback to savepoint permission_case");
        expect(await counts(database)).toEqual(before);
      }
      await setActor(database, fixture().actors.inactive.authUserId);
      await assertRejected(database, "select * from public.create_pcb_card($1)", ["Inactive"], "42501");
      await database.query("reset role");
      await setActor(database, "", "anon");
      await assertRejected(database, "select * from public.create_pcb_card($1)", ["Anonymous"], "42501");
      await database.query("reset role");
      expect(await counts(database)).toEqual(before);
    });
  });

  it("rejects missing/blank name before serial allocation and preserves Product/PcbCard invariants", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      await setActor(database, fixture().actors.admin.authUserId);
      for (const name of [null, "", "   "]) {
        await assertRejected(database, "select * from public.create_pcb_card($1)", [name], "22023");
      }
      await database.query("reset role");

      const created = await createCard(database, fixture().actors.admin.authUserId, "Invariant card");
      const other = await createCard(database, fixture().actors.admin.authUserId, "Other card");
      await assertRejected(database,
        "update public.products set product_kind='component' where id=$1", [created.product_id], "PRD02");
      await assertRejected(database,
        "update public.pcb_cards set output_product_id=$2 where id=$1",
        [created.pcb_card_id, other.product_id], "PCB02");
      await assertRejected(database,
        `insert into public.pcb_cards(name,output_product_id,created_by_user_id,updated_by_user_id)
         values ($1,$2,$3,$3)`, ["Duplicate output", created.product_id, fixture().actors.admin.profileId], "23505");
      await setActor(database, fixture().actors.admin.authUserId);
      await assertRejected(database,
        "insert into public.pcb_cards(name) values ($1)", ["Direct"], "42501");
      await database.query("reset role");
      await setActor(database, fixture().actors.admin.authUserId);
      const normal = await database.query<{ product_id: string; serial_number: string }>(
        "select * from public.create_product($1,$2,$3::uuid)", ["Normal component", "Parts", null],
      );
      await database.query("reset role");
      expect(normal.rows).toHaveLength(1);
      const normalProduct = await database.query<{ product_kind: string }>(
        "select product_kind from public.products where id=$1", [normal.rows[0]?.product_id],
      );
      expect(normalProduct.rows).toEqual([{ product_kind: "component" }]);
    });
  });

  it("rolls back Product, zero balance, card and first audit if the second audit fails", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      await database.query(`create function pg_temp.reject_pcb_card_audit()
        returns trigger language plpgsql as $function$
        begin
          if new.action_type = 'pcb_card.created' then
            raise exception 'Simulated PCB audit failure' using errcode = 'PCB90';
          end if;
          return new;
        end;
        $function$`);
      await database.query(`create trigger reject_pcb_card_audit_test
        before insert on public.audit_logs for each row
        execute function pg_temp.reject_pcb_card_audit()`);
      const before = await counts(database);
      await setActor(database, fixture().actors.admin.authUserId);
      await assertRejected(database, "select * from public.create_pcb_card($1)", ["Rollback card"], "PCB90");
      await database.query("reset role");
      expect(await counts(database)).toEqual(before);
      const consumed = await database.query<{ value: string }>(
        "select pg_catalog.currval('public.product_serial_number_seq'::pg_catalog.regclass)::text as value",
      );
      await database.query("drop trigger reject_pcb_card_audit_test on public.audit_logs");
      const created = await createCard(database, fixture().actors.admin.authUserId, "After rollback");
      expect(Number(created.serial_number)).toBeGreaterThan(Number(consumed.rows[0]?.value));
    });
  });

  it("allocates distinct serials and coherent rows across independent concurrent transactions", async () => {
    await fixture().withDatabaseClients(2, async (clients) => {
      const [first, second] = clients;
      if (!first || !second) throw new Error("Concurrency clients are unavailable");
      await Promise.all([first.query("begin"), second.query("begin")]);
      const actor = fixture().actors.admin.authUserId;
      const name = `Concurrent PCB ${randomUUID()}`;
      const [one, two] = await Promise.all([
        createCard(first, actor, name), createCard(second, actor, name),
      ]);
      expect(one.serial_number).toMatch(/^[0-9]{7}$/);
      expect(two.serial_number).toMatch(/^[0-9]{7}$/);
      expect(one.serial_number).not.toBe(two.serial_number);
      expect(one.product_id).not.toBe(two.product_id);
      expect(one.pcb_card_id).not.toBe(two.pcb_card_id);
      for (const [database, created] of [[first, one], [second, two]] as const) {
        const relation = await database.query<{ name: string; output_product_id: string }>(
          "select name,output_product_id from public.pcb_cards where id=$1", [created.pcb_card_id],
        );
        expect(relation.rows).toEqual([{ name, output_product_id: created.product_id }]);
        const balance = await database.query<{ quantity: string }>(
          "select quantity from public.inventory_balances where product_id=$1", [created.product_id],
        );
        expect(balance.rows).toEqual([{ quantity: "0" }]);
        const audits = await database.query<{ action_type: string }>(
          "select action_type from public.audit_logs where entity_id=any($1::uuid[]) order by action_type",
          [[created.product_id, created.pcb_card_id]],
        );
        expect(audits.rows.map((row) => row.action_type)).toEqual(["pcb_card.created", "product.created"]);
      }
    });
  });
});
