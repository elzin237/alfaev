import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { describe, expect, it, vi } from "vitest";

import { assertCommittedConcurrencyTarget } from "./backend/env";

const source = readFileSync(
  "test/backend/inventory-concurrency-committed.backend.ts", "utf8",
);

function hookBody(name: string): string {
  const callback = source.match(new RegExp(
    `    ${name}\\((async \\(\\) => \\{[\\s\\S]*?\\n    \\})(?:, 120_000)?\\);`,
  ))?.[1];
  if (!callback) throw new Error(`Missing campaign ${name} hook`);
  return callback;
}

// Execute the real setup/cleanup bodies, but inject only in-memory doubles. Never
// import the opt-in campaign or load connection material/start a backend campaign.
const hooks = stripTypeScriptTypes(
  `function createHooks() {
     let pool, storage, actor;
     return { setup: ${hookBody("beforeAll")}, cleanup: ${hookBody("afterAll")} };
   }`,
) + "\nreturn createHooks();";

function harness(rows: unknown[], queryError?: Error) {
  const events: string[] = [];
  const createUser = vi.fn(async () => {
    events.push("auth fixture");
    return { data: { user: { id: "mock-auth-id" } }, error: null };
  });
  const connections = Array.from({ length: 15 }, () => ({
    query: vi.fn(async (sql: string) => {
      expect(sql).toBe("set role postgres");
    }),
    release: vi.fn(),
  }));
  let nextConnection = 0;
  const pool = {
    connect: vi.fn(async () => connections[nextConnection++]!),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("supabase_migrations.schema_migrations")) {
        events.push("parity");
        expect(sql.trim()).toMatch(/^select\b/);
        if (queryError) throw queryError;
        return { rows };
      }
      expect(sql.trim()).toMatch(/^insert into public.user_profiles/);
      events.push("profile fixture");
      return { rows: [{ id: "mock-profile-id" }] };
    }),
    end: vi.fn(async () => undefined),
  };
  const createClient = vi.fn(() => ({ auth: { admin: { createUser } } }));
  const dependencies = {
    process: { env: {
      SUPABASE_LOCAL_TEST: "1",
      SUPABASE_TEST_DATABASE_URL: "postgresql://127.0.0.1:54322/postgres",
      SUPABASE_SECRET_KEY: "sb_secret_mock_only",
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
    } },
    assertCommittedConcurrencyTarget,
    disposableProjectRef: "tkzlbxyjbnntrgohpedd",
    Pool: class { constructor() { return pool; } },
    createClient,
    expect,
    randomUUID: () => "mock-uuid",
  };
  const campaign = new Function(...Object.keys(dependencies), hooks)(
    ...Object.values(dependencies),
  ) as { setup: () => Promise<void>; cleanup: () => Promise<void> };
  return { ...campaign, pool, createClient, createUser, connections, events };
}

describe("committed Inventory concurrency preconditions (in-memory only)", () => {
  it.each([
    [{ migration_count: "140", latest: "20261022100000" }],
    [{ migration_count: "141", latest: "20261022140000" }],
    [{ migration_count: "142", latest: "20261022140000" }],
    [{ migration_count: "143", latest: "20261023100000" }],
    [undefined],
  ])("rejects mismatched parity %j before any fixture or Storage client", async (row) => {
    const test = harness(row ? [row] : []);
    await expect(test.setup()).rejects.toThrow();
    expect(test.pool.query).toHaveBeenCalledTimes(1);
    expect(test.events).toEqual(["parity"]);
    expect(test.createClient).not.toHaveBeenCalled();
    expect(test.createUser).not.toHaveBeenCalled();
    await test.cleanup();
    expect(test.pool.end).toHaveBeenCalledOnce();
    test.connections.forEach((connection) => expect(connection.release).toHaveBeenCalledOnce());
  });

  it("fails closed on a parity query error and still closes the pool", async () => {
    const test = harness([], new Error("mock query failure"));
    await expect(test.setup()).rejects.toThrow("mock query failure");
    expect(test.events).toEqual(["parity"]);
    expect(test.createClient).not.toHaveBeenCalled();
    await test.cleanup();
    expect(test.pool.end).toHaveBeenCalledOnce();
  });

  it("accepts exactly local 142 and verifies parity before fixture creation", async () => {
    const test = harness([{ migration_count: "142", latest: "20261022150000" }]);
    await test.setup();
    expect(test.events).toEqual(["parity", "auth fixture", "profile fixture"]);
    expect(test.createUser).toHaveBeenCalledOnce();
    await test.cleanup();
    expect(test.pool.end).toHaveBeenCalledOnce();
  });

  it("preserves the separately pinned disposable-remote migration contract", () => {
    expect(hookBody("beforeAll")).toContain('expectedLatest = "20261005120000"');
    expect(hookBody("beforeAll")).toContain('expectedMigrationCount = "111"');
  });
});
