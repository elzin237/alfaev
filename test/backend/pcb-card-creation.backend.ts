import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadBackendTestEnvironment } from "./env";
import { createSecurityFixtureHarness, type SecurityFixtureHarness } from "./security-fixtures";

const environment = loadBackendTestEnvironment();
const committedConcurrencyIt = environment.projectRef === "local" ? it : it.skip;
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

async function createCard(
  database: PoolClient,
  authUserId: string,
  name: string,
  serialNumber: string,
): Promise<CreationRow> {
  await setActor(database, authUserId);
  const result = await database.query<CreationRow>(
    "select * from public.create_pcb_card($1, $2)",
    [name, serialNumber],
  );
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

async function findUnusedThreeDigitSerials(
  database: PoolClient,
  count: number,
): Promise<string[]> {
  return (await database.query<{ serial_number: string }>(
    `select pg_catalog.lpad(candidate::text, 3, '0') as serial_number
     from pg_catalog.generate_series(0, 999) as candidate
     where not exists (
       select 1 from public.products as product
       where product.serial_number = pg_catalog.lpad(candidate::text, 3, '0')
     )
     order by candidate limit $1`,
    [count],
  )).rows.map((row) => row.serial_number);
}

describe("trusted PCB Card creation", () => {
  beforeAll(async () => { harness = await createSecurityFixtureHarness(environment); });
  afterAll(async () => {
    if (harness) expect(await harness.cleanup()).toMatchObject({
      auditLogsRemaining: 0, authUsersRemaining: 0, profilesRemaining: 0,
      permissionsRemaining: 0, postgresClosed: true,
    });
  });

  it("derives one Product, three zero balances and exactly two trusted audits for an Admin", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      const before = await counts(database);
      const [serial] = await findUnusedThreeDigitSerials(database, 1);
      if (!serial || !serial.startsWith("0")) throw new Error("An unused leading-zero Serial is required");
      const created = await createCard(database, fixture().actors.admin.authUserId, "  Controller PCB  ", serial);
      expect(created.serial_number).toBe(serial);
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
      const balance = await database.query<{ code: string; quantity: string }>(
        `select warehouse.code, balance.quantity
         from public.inventory_balances as balance
         join public.inventory_warehouses as warehouse on warehouse.id=balance.warehouse_id
         where balance.product_id=$1 order by warehouse.sort_order`, [created.product_id],
      );
      expect(balance.rows).toEqual([
        { code: "raw_materials", quantity: "0" },
        { code: "finished_goods", quantity: "0" },
        { code: "customs", quantity: "0" },
      ]);
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
      expect(Number(after?.balances) - Number(before?.balances)).toBe(3);
      expect(after?.movements).toBe(before?.movements);
      expect(after?.suppliers).toBe(before?.suppliers);
      expect(after?.product_suppliers).toBe(before?.product_suppliers);
      expect(Number(after?.audits) - Number(before?.audits)).toBe(2);
    });
  });

  it("preserves historical seven-digit definitions and both-length trusted lookup", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture().actors.admin;
      const historicalSerial = (await database.query<{ serial_number: string }>(
        "select public.allocate_product_serial_number() as serial_number",
      )).rows[0]?.serial_number;
      if (!historicalSerial) throw new Error("Historical Serial fixture is unavailable");
      const historicalProductId = randomUUID();
      const historicalCardId = randomUUID();
      await database.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind,
           created_by_user_id, updated_by_user_id
         ) values ($1,$2,$3,'PCB','pcb_finished_good',$4,$4)`,
        [historicalProductId, historicalSerial, `Historical ${randomUUID()}`, actor.profileId],
      );
      await database.query(
        `insert into public.pcb_cards (
           id, name, output_product_id, created_by_user_id, updated_by_user_id
         ) values ($1,$2,$3,$4,$4)`,
        [historicalCardId, `Historical definition ${randomUUID()}`, historicalProductId, actor.profileId],
      );
      const [calculatorSerial] = await findUnusedThreeDigitSerials(database, 1);
      if (!calculatorSerial) throw new Error("Calculator Serial fixture is unavailable");
      const calculator = await createCard(
        database,
        actor.authUserId,
        `Calculator ${randomUUID()}`,
        calculatorSerial,
      );
      await setActor(database, actor.authUserId);
      const draft = (await database.query<{ work_order_id: string }>(
        "select work_order_id from public.create_draft_work_order()",
      )).rows[0];
      if (!draft) throw new Error("Draft Work Order fixture is unavailable");
      const resolved = await database.query<{ serial_number: string }>(
        `select serial_number from public.resolve_work_order_product_barcode($1,$2)
         union all
         select serial_number from public.resolve_work_order_product_barcode($1,$3)
         order by serial_number`,
        [draft.work_order_id, calculator.serial_number, historicalSerial],
      );
      const listed = await database.query<{ serial_number: string }>(
        "select serial_number from public.list_pcb_cards() where pcb_card_id=any($1::uuid[]) order by serial_number",
        [[calculator.pcb_card_id, historicalCardId]],
      );
      await database.query("reset role");
      expect(resolved.rows.map((row) => row.serial_number).sort())
        .toEqual([calculatorSerial, historicalSerial].sort());
      expect(listed.rows.map((row) => row.serial_number).sort())
        .toEqual([calculatorSerial, historicalSerial].sort());
    });
  });

  it("exposes only the new authenticated trusted creation signature", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      const metadata = await database.query<{
        anonymous_execute: boolean;
        authenticated_execute: boolean;
        old_signature: string | null;
        public_execute: boolean;
        settings: string[] | null;
      }>(
        `select
           pg_catalog.has_function_privilege('anon','public.create_pcb_card(text,text)','EXECUTE') as anonymous_execute,
           pg_catalog.has_function_privilege('authenticated','public.create_pcb_card(text,text)','EXECUTE') as authenticated_execute,
           pg_catalog.to_regprocedure('public.create_pcb_card(text)')::text as old_signature,
           pg_catalog.has_function_privilege('public','public.create_pcb_card(text,text)','EXECUTE') as public_execute,
           routine.proconfig as settings
         from pg_catalog.pg_proc as routine
         where routine.oid='public.create_pcb_card(text,text)'::pg_catalog.regprocedure`,
      );
      expect(metadata.rows).toEqual([{
        anonymous_execute: false,
        authenticated_execute: true,
        old_signature: null,
        public_execute: false,
        settings: ["search_path=\"\""],
      }]);
    });
  });

  it("allows pcb.create without read or Inventory grants and rejects case-insensitive active/archived names", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture().actors.unpermitted;
      await grantPermission(database, actor.profileId, "pcb.create");
      const grants = await database.query<{ key: string }>(
        `select definition.key from public.user_permissions as permission
         join public.permission_definitions as definition on definition.id=permission.permission_definition_id
         where permission.user_id=$1 order by definition.key`, [actor.profileId],
      );
      expect(grants.rows.map((row) => row.key)).toEqual(["pcb.create"]);
      const name = `Unique card ${randomUUID()}`;
      const [firstSerial, secondSerial, thirdSerial] = await findUnusedThreeDigitSerials(database, 3);
      if (!firstSerial || !secondSerial || !thirdSerial) throw new Error("Three Serials are required");
      const first = await createCard(database, actor.authUserId, name, firstSerial);
      await setActor(database, actor.authUserId);
      await assertRejected(database, "select * from public.create_pcb_card($1,$2)",
        [name.toUpperCase(), secondSerial], "PCB14");
      await database.query("reset role");
      await database.query(
        `update public.pcb_cards set is_active=false, archived_at=now(),
           archived_by_user_id=$2, updated_at=now(), updated_by_user_id=$2 where id=$1`,
        [first.pcb_card_id, actor.profileId],
      );
      await setActor(database, actor.authUserId);
      await assertRejected(database, "select * from public.create_pcb_card($1,$2)",
        [name.toLowerCase(), thirdSerial], "PCB14");
      await database.query("reset role");
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
        await assertRejected(database, "select * from public.create_pcb_card($1,$2)",
          [`Denied ${randomUUID()}`, "101"], "42501");
        await database.query("rollback to savepoint permission_case");
        expect(await counts(database)).toEqual(before);
      }
      await setActor(database, fixture().actors.inactive.authUserId);
      await assertRejected(database, "select * from public.create_pcb_card($1,$2)", ["Inactive", "102"], "42501");
      await database.query("reset role");
      await setActor(database, "", "anon");
      await assertRejected(database, "select * from public.create_pcb_card($1,$2)", ["Anonymous", "103"], "42501");
      await database.query("reset role");
      expect(await counts(database)).toEqual(before);
    });
  });

  it("rejects invalid Name/Code and Serial formats and preserves Product/PcbCard invariants", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      await setActor(database, fixture().actors.admin.authUserId);
      for (const name of [null, "", "   "]) {
        await assertRejected(database, "select * from public.create_pcb_card($1,$2)", [name, "104"], "22023");
      }
      for (const serial of [null, "", "12", "1234", "12345", " 123", "123 ", "１２３", "١٢٣", "abc"]) {
        await assertRejected(database, "select * from public.create_pcb_card($1,$2)",
          [`Invalid Serial ${String(serial)}`, serial], "22023");
      }
      await database.query("reset role");

      const [firstSerial, secondSerial] = await findUnusedThreeDigitSerials(database, 2);
      if (!firstSerial || !secondSerial) throw new Error("Two Serials are required");
      const created = await createCard(database, fixture().actors.admin.authUserId, "Invariant card", firstSerial);
      const other = await createCard(database, fixture().actors.admin.authUserId, "Other card", secondSerial);
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

  it("rejects globally colliding active and archived Product Serials", async () => {
    await fixture().withRollbackDatabaseTransaction(async (database) => {
      const actor = fixture().actors.admin;
      const [serial] = await findUnusedThreeDigitSerials(database, 1);
      if (!serial) throw new Error("A three-digit Serial is required");
      const active = await createCard(database, actor.authUserId, "Active Serial owner", serial);
      await setActor(database, actor.authUserId);
      await assertRejected(database, "select * from public.create_pcb_card($1,$2)",
        ["Active collision", active.serial_number], "PRD06");
      await database.query("reset role");

      await setActor(database, actor.authUserId);
      await database.query("select public.archive_product($1::uuid)", [active.product_id]);
      await database.query("reset role");
      await setActor(database, actor.authUserId);
      await assertRejected(database, "select * from public.create_pcb_card($1,$2)",
        ["Archived collision", active.serial_number], "PRD06");
      await database.query("reset role");
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
      const [serial] = await findUnusedThreeDigitSerials(database, 1);
      if (!serial) throw new Error("A three-digit Serial is required");
      await setActor(database, fixture().actors.admin.authUserId);
      await assertRejected(database, "select * from public.create_pcb_card($1,$2)", ["Rollback card", serial], "PCB90");
      await database.query("reset role");
      expect(await counts(database)).toEqual(before);
      await database.query("drop trigger reject_pcb_card_audit_test on public.audit_logs");
      const created = await createCard(database, fixture().actors.admin.authUserId, "After rollback", serial);
      expect(created.serial_number).toBe(serial);
    });
  });

  it("creates distinct manual Serials and coherent rows across independent concurrent transactions", async () => {
    await fixture().withDatabaseClients(2, async (clients) => {
      const [first, second] = clients;
      if (!first || !second) throw new Error("Concurrency clients are unavailable");
      await Promise.all([first.query("begin"), second.query("begin")]);
      const actor = fixture().actors.admin.authUserId;
      const [firstSerial, secondSerial] = await findUnusedThreeDigitSerials(first, 2);
      if (!firstSerial || !secondSerial) throw new Error("Two Serials are required");
      const [one, two] = await Promise.all([
        createCard(first, actor, `Concurrent PCB A ${randomUUID()}`, firstSerial),
        createCard(second, actor, `Concurrent PCB B ${randomUUID()}`, secondSerial),
      ]);
      expect(one.serial_number).toBe(firstSerial);
      expect(two.serial_number).toBe(secondSerial);
      expect(one.serial_number).not.toBe(two.serial_number);
      expect(one.product_id).not.toBe(two.product_id);
      expect(one.pcb_card_id).not.toBe(two.pcb_card_id);
      for (const [database, created] of [[first, one], [second, two]] as const) {
        const relation = await database.query<{ name: string; output_product_id: string }>(
          "select name,output_product_id from public.pcb_cards where id=$1", [created.pcb_card_id],
        );
        expect(relation.rows).toHaveLength(1);
        expect(relation.rows[0]?.output_product_id).toBe(created.product_id);
        const balance = await database.query<{ count: string }>(
          "select count(*)::text as count from public.inventory_balances where product_id=$1 and quantity=0",
          [created.product_id],
        );
        expect(balance.rows).toEqual([{ count: "3" }]);
        const audits = await database.query<{ action_type: string }>(
          "select action_type from public.audit_logs where entity_id=any($1::uuid[]) order by action_type",
          [[created.product_id, created.pcb_card_id]],
        );
        expect(audits.rows.map((row) => row.action_type)).toEqual(["pcb_card.created", "product.created"]);
      }
    });
  });

  committedConcurrencyIt("rejects concurrent identical Serial creation at the global Product boundary", async () => {
    await fixture().withDatabaseClients(2, async ([first, second]) => {
      if (!first || !second) throw new Error("Concurrency clients are unavailable");
      const [serial] = await findUnusedThreeDigitSerials(first, 1);
      if (!serial) throw new Error("No three-digit Serial is available");
      await Promise.all([first.query("begin"), second.query("begin")]);
      const actor = fixture().actors.admin.authUserId;
      const created = await createCard(first, actor, `Serial owner ${randomUUID()}`, serial);
      const conflict = createCard(second, actor, `Serial contender ${randomUUID()}`, serial);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await first.query("commit");
      await expect(conflict).rejects.toMatchObject({ code: "PRD06" });
      await second.query("rollback");
      const persisted = await first.query<{ count: string }>(
        "select count(*)::text as count from public.products where serial_number=$1",
        [serial],
      );
      expect(persisted.rows).toEqual([{ count: "1" }]);
      expect(created.serial_number).toBe(serial);
    });
  });

  committedConcurrencyIt("rejects concurrent case-insensitive Name/Code creation without an orphan Product", async () => {
    await fixture().withDatabaseClients(2, async ([first, second]) => {
      if (!first || !second) throw new Error("Concurrency clients are unavailable");
      const [firstSerial, secondSerial] = await findUnusedThreeDigitSerials(first, 2);
      if (!firstSerial || !secondSerial) throw new Error("Two three-digit Serials are required");
      await Promise.all([first.query("begin"), second.query("begin")]);
      const actor = fixture().actors.admin.authUserId;
      const name = `Concurrent Name ${randomUUID()}`;
      await createCard(first, actor, name, firstSerial);
      const conflict = createCard(second, actor, name.toUpperCase(), secondSerial);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await first.query("commit");
      await expect(conflict).rejects.toMatchObject({ code: "PCB14" });
      await second.query("rollback");
      const persisted = await first.query<{ cards: string; products: string }>(
        `select
           (select count(*)::text from public.pcb_cards where lower(name)=lower($1)) as cards,
           (select count(*)::text from public.products where serial_number=$2) as products`,
        [name, secondSerial],
      );
      expect(persisted.rows).toEqual([{ cards: "1", products: "0" }]);
    });
  });
});
