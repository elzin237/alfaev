import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const localOnlyDescribe = process.env.SUPABASE_LOCAL_TEST === "1"
  ? describe
  : describe.skip;

const maintenanceSql = readFileSync(
  resolve(
    process.cwd(),
    "scripts/maintenance/task-001h-correct-dev-pcb-names.sql",
  ),
  "utf8",
);

const transactionBody = maintenanceSql
  .replace(/^\s*begin;\s*/i, "")
  .replace(/\s*commit;\s*$/i, "");

const actorProfileId = "edef95b5-7307-4bcf-aa3e-a85a074e1df7";
const actorAuthUserId = "25b6ab42-94ad-4a0e-9016-d9506986686d";

const mapping = [
  {
    cardId: "a5eea566-7363-4cd8-a39e-3226d152d460",
    productId: "54b4255b-f182-4536-9d73-f53591cb0107",
    serialNumber: "4181345",
    oldCardName: "Concurrent BOM Card",
    oldProductName: "Concurrent BOM Product",
    newName: "Concurrent BOM Card - Test 2",
  },
  {
    cardId: "7f9b04c9-226e-45b0-ab2b-bfcca3aa77f5",
    productId: "7cc24553-4200-4bae-83cb-076808012d83",
    serialNumber: "1450331",
    oldCardName: "History-lock Card",
    oldProductName: "History-lock Product",
    newName: "History-lock Card - Test 2",
  },
  {
    cardId: "c9b01975-7af5-4a47-b452-6a721f26a575",
    productId: "7a4c80fa-dec2-4567-a023-27bfe5f6b17f",
    serialNumber: "7117065",
    oldCardName: "Save-race Card",
    oldProductName: "Save-race Product",
    newName: "Save-race Card - Test 2",
  },
  {
    cardId: "17d0fc01-89f5-4815-8832-4e3d2fe7f50f",
    productId: "c8672aab-a7f2-45c0-a11d-ca875ccadedb",
    serialNumber: "0346915",
    oldCardName: "Version-lock Card",
    oldProductName: "Version-lock output",
    newName: "Version-lock Card - Test 2",
  },
  {
    cardId: "9581157e-ac14-4a8b-afe4-5259d7091d58",
    productId: "82427337-6a73-465b-93bd-124234f2bac4",
    serialNumber: "0028803",
    oldCardName: "EK-503",
    oldProductName: "EK-503",
    newName: "EK-503 (0028803)",
  },
] as const;

const duplicateCounterparts = [
  {
    cardId: "51e21f73-9ce4-48fe-b71a-2e67bbb0b2b2",
    productId: "3ea6df67-2546-4410-b226-86d9160ae3a5",
    serialNumber: "6758978",
    cardName: "Concurrent BOM Card",
    productName: "Concurrent BOM Product",
  },
  {
    cardId: "451d8aa9-8d2e-4f34-9c54-5ac624d34776",
    productId: "417ee49d-ae9c-454d-87a2-7f32dae4fb54",
    serialNumber: "4956596",
    cardName: "History-lock Card",
    productName: "History-lock Product",
  },
  {
    cardId: "495a53ec-e758-4772-b2a4-72fe1352942d",
    productId: "0544b5a4-0c8c-430e-893d-4407f77ce3cb",
    serialNumber: "5941047",
    cardName: "Save-race Card",
    productName: "Save-race Product",
  },
  {
    cardId: "85d39200-3b45-42c1-8704-e88895d9e33f",
    productId: "6dfef012-59db-474c-8d80-8c428a069917",
    serialNumber: "2032697",
    cardName: "Version-lock Card",
    productName: "Version-lock output",
  },
  {
    cardId: "c7fd4f63-64df-47df-a631-dc316d86fde8",
    productId: "b5cd48d1-fc6a-4759-b115-50713a793381",
    serialNumber: "0027068",
    cardName: "EK-503",
    productName: "EK-503",
  },
] as const;

const bomFixtures = [
  {
    id: "512c9de9-afcf-4b3b-b5f9-fc33d119e9a3",
    cardId: "7f9b04c9-226e-45b0-ab2b-bfcca3aa77f5",
    version: "1",
  },
  {
    id: "763f5bca-ebc9-44a8-b7e9-2e28f75f7032",
    cardId: "c9b01975-7af5-4a47-b452-6a721f26a575",
    version: "1",
  },
  {
    id: "f483504e-2508-4adf-a179-f6ae48d41516",
    cardId: "17d0fc01-89f5-4815-8832-4e3d2fe7f50f",
    version: "2",
  },
  {
    id: "19ca674a-a95f-4ca0-8046-744096695148",
    cardId: "9581157e-ac14-4a8b-afe4-5259d7091d58",
    version: "1",
  },
] as const;

interface CountRow {
  count: string;
}

async function seedEquivalentFixtures(client: PoolClient): Promise<string> {
  await client.query("drop index public.pcb_cards_name_ci_key");
  await client.query(
    `insert into auth.users (id, aud, role)
     values ($1, 'authenticated', 'authenticated')`,
    [actorAuthUserId],
  );
  await client.query(
    `insert into public.user_profiles (
       id, auth_user_id, full_name, email, birthday, is_admin, is_active
     ) values ($1, $2, 'Task 001H local maintenance actor',
       'task-001h-local@example.invalid', '2000-01-01', true, true)`,
    [actorProfileId, actorAuthUserId],
  );

  const productFixtures = [
    ...mapping.map((entry) => ({
      id: entry.productId,
      serialNumber: entry.serialNumber,
      name: entry.oldProductName,
    })),
    ...duplicateCounterparts.map((entry) => ({
      id: entry.productId,
      serialNumber: entry.serialNumber,
      name: entry.productName,
    })),
  ];

  for (const product of productFixtures) {
    await client.query(
      `insert into public.products (
         id, serial_number, name, category, product_kind, is_active,
         created_by_user_id, updated_by_user_id
       ) values ($1, $2, $3, 'PCB', 'pcb_finished_good', true, $4, $4)`,
      [product.id, product.serialNumber, product.name, actorProfileId],
    );
  }

  const componentProductId = randomUUID();
  const componentSerial = `8${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
  await client.query(
    `insert into public.products (
       id, serial_number, name, category, product_kind, is_active,
       created_by_user_id, updated_by_user_id
     ) values ($1, $2, 'Task 001H component', 'Test', 'component', true, $3, $3)`,
    [componentProductId, componentSerial, actorProfileId],
  );

  for (const entry of [...mapping, ...duplicateCounterparts]) {
    const cardName = "oldCardName" in entry ? entry.oldCardName : entry.cardName;
    await client.query(
      `insert into public.pcb_cards (
         id, name, output_product_id, is_active,
         created_by_user_id, updated_by_user_id
       ) values ($1, $2, $3, true, $4, $4)`,
      [entry.cardId, cardName, entry.productId, actorProfileId],
    );
  }

  for (const [index, bom] of bomFixtures.entries()) {
    await client.query(
      `insert into public.pcb_bom_versions (
         id, pcb_card_id, version_number, is_active, created_by_user_id
       ) values ($1, $2, $3, true, $4)`,
      [bom.id, bom.cardId, bom.version, actorProfileId],
    );
    await client.query(
      `insert into public.pcb_bom_items (
         id, bom_version_id, component_product_id, quantity_per_card
       ) values ($1, $2, $3, $4)`,
      [randomUUID(), bom.id, componentProductId, String(index + 1)],
    );
  }

  const existingAuditId = randomUUID();
  await client.query(
    `insert into public.audit_logs (
       id, actor_user_id, action_type, entity_type, entity_id, summary
     ) values ($1, $2, 'fixture.existing', 'product', $3,
       'Existing immutable Task 001H fixture audit')`,
    [existingAuditId, actorProfileId, mapping[0].productId],
  );
  return existingAuditId;
}

async function expectNamesAndNoMaintenanceAudits(
  client: PoolClient,
  expectedProductName: string = mapping[0].oldProductName,
) {
  const names = await client.query<{ card_name: string; product_name: string }>(
    `select card.name card_name, product.name product_name
     from public.pcb_cards as card
     join public.products as product on product.id = card.output_product_id
     where card.id = $1`,
    [mapping[0].cardId],
  );
  expect(names.rows[0]).toEqual({
    card_name: mapping[0].oldCardName,
    product_name: expectedProductName,
  });

  const auditCount = await client.query<CountRow>(
    `select count(*)::text as count
     from public.audit_logs
     where metadata ->> 'maintenance_task' = 'TASK 001H'`,
  );
  expect(auditCount.rows[0]?.count).toBe("0");
}

localOnlyDescribe("Task 001H DEV PCB name correction maintenance", () => {
  let database: Pool;

  beforeAll(() => {
    const databaseUrl = process.env.SUPABASE_TEST_DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("SUPABASE_TEST_DATABASE_URL is required");
    }
    const target = new URL(databaseUrl);
    if (
      target.hostname !== "127.0.0.1" ||
      target.port !== "54322" ||
      target.pathname !== "/postgres" ||
      target.username !== "postgres"
    ) {
      throw new Error("Task 001H proof requires the disposable local database");
    }
    database = new Pool({ connectionString: databaseUrl, max: 1 });
  });

  afterAll(async () => {
    await database?.end();
  });

  it("updates five synchronized pairs, appends ten audits, and passes migration 138 preflight", async () => {
    const client = await database.connect();
    await client.query("begin");
    try {
      const existingAuditId = await seedEquivalentFixtures(client);
      await client.query(transactionBody);

      const corrected = await client.query<{
        card_id: string;
        card_name: string;
        product_name: string;
        serial_number: string;
      }>(
        `select card.id card_id, card.name card_name,
                product.name product_name, product.serial_number
         from public.pcb_cards as card
         join public.products as product on product.id = card.output_product_id
         where card.id = any($1::uuid[])
         order by card.id`,
        [mapping.map((entry) => entry.cardId)],
      );
      expect(corrected.rows).toHaveLength(5);
      for (const row of corrected.rows) {
        const expected = mapping.find((entry) => entry.cardId === row.card_id);
        expect(row).toMatchObject({
          card_name: expected?.newName,
          product_name: expected?.newName,
          serial_number: expected?.serialNumber,
        });
      }

      const audits = await client.query<{
        action_type: string;
        summary: string;
      }>(
        `select action_type, summary
         from public.audit_logs
         where metadata ->> 'maintenance_task' = 'TASK 001H'
         order by action_type, entity_id`,
      );
      expect(audits.rows).toHaveLength(10);
      expect(audits.rows.filter((row) => row.action_type === "product.updated"))
        .toHaveLength(5);
      expect(audits.rows.filter((row) => row.action_type === "pcb_card.updated"))
        .toHaveLength(5);
      expect(audits.rows.every((row) =>
        row.summary.startsWith("Authorized DEV data maintenance:"),
      )).toBe(true);

      const existingAudit = await client.query<CountRow>(
        "select count(*)::text as count from public.audit_logs where id = $1",
        [existingAuditId],
      );
      expect(existingAudit.rows[0]?.count).toBe("1");

      const duplicates = await client.query<CountRow>(
        `select count(*)::text as count
         from (
           select lower(name)
           from public.pcb_cards
           group by lower(name)
           having count(*) > 1
         ) as duplicate_groups`,
      );
      expect(duplicates.rows[0]?.count).toBe("0");

      const preservedEk = await client.query<{
        card_name: string;
        product_name: string;
        serial_number: string;
      }>(
        `select card.name card_name, product.name product_name,
                product.serial_number
         from public.pcb_cards as card
         join public.products as product on product.id = card.output_product_id
         where card.id = 'c7fd4f63-64df-47df-a631-dc316d86fde8'::uuid`,
      );
      expect(preservedEk.rows[0]).toEqual({
        card_name: "EK-503",
        product_name: "EK-503",
        serial_number: "0027068",
      });

      await client.query(
        `create unique index pcb_cards_name_ci_key
         on public.pcb_cards (lower(name))`,
      );
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("fails closed and rolls back on an incorrect expected identity", async () => {
    const client = await database.connect();
    await client.query("begin");
    try {
      await seedEquivalentFixtures(client);
      await client.query(
        "update public.products set name = 'Unexpected Product name' where id = $1",
        [mapping[0].productId],
      );
      await client.query("savepoint before_correction");
      await expect(client.query(transactionBody)).rejects.toMatchObject({
        code: "55000",
      });
      await client.query("rollback to savepoint before_correction");
      await expectNamesAndNoMaintenanceAudits(client, "Unexpected Product name");
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("fails closed and rolls back when a proposed name collides", async () => {
    const client = await database.connect();
    await client.query("begin");
    try {
      await seedEquivalentFixtures(client);
      await client.query(
        `insert into public.products (
           id, serial_number, name, category, product_kind, is_active,
           created_by_user_id, updated_by_user_id
         ) values ($1, '8888888', $2, 'Test', 'component', true, $3, $3)`,
        [randomUUID(), mapping[0].newName.toLowerCase(), actorProfileId],
      );
      await client.query("savepoint before_correction");
      await expect(client.query(transactionBody)).rejects.toMatchObject({
        code: "23505",
      });
      await client.query("rollback to savepoint before_correction");
      await expectNamesAndNoMaintenanceAudits(client);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
