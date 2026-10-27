import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ supabaseUrl: "https://yzysgbrpbhiapalgetau.supabase.co" }));
vi.mock("../lib/config/env", () => ({ frontendEnv: backend }));
import { TEST_CALCULATOR_RELEASE, isTestCalculatorEnabled } from "../app/config/testCalculatorActivation";
import { PERMISSION_KEYS, SUPPORTED_PERMISSION_KEYS, TEST_CALCULATOR_PERMISSION_KEYS } from "../app/auth/permissions";
const frozen = [
  ["20261027100000_add_test_calculator_foundation.sql", "e8d7b802a4b828cc685ddaaafc33371fa6d8c79ca76cf454fdcc80c6fb603684"],
  ["20261027110000_add_test_calculator_search_and_preview.sql", "1a11b4e6a66c860be33f4fbc526fc38c488b0adc46d94359d0bf98ea00e990d7"],
  ["20261027120000_add_atomic_test_calculator_save.sql", "f1edf06661223a294e5a25002320000a7d065fca3ba19c463ee130b9f8dcc18d"],
  ["20261027130000_protect_test_calculator_warehouse_holds.sql", "2372dbf1bcf5956eb7c5a38fb1f74425af4a7a3339287be0581ef4549f10efd3"],
  ["20261027140000_protect_test_holds_in_production_plans.sql", "85ec4decbd570a7e5784617caec96a341ee94a230d1b13044007d8ae77b679c7"],
  ["20261027150000_protect_test_holds_in_project_reservation_admission.sql", "0b689ad1c11fb93f4e79861d240beb4df0a44406f86b52deab2fe74e2597fe05"],
  ["20261027160000_add_expiry_aware_inventory_test_commitments.sql", "c6562a7c14d48c7752709c8c0e3a748dd1c064721c20c31f3f538ebbe1bf80fc"],
  ["20261027170000_add_test_calculation_history_reads.sql", "a901832f3f1424b3aad3a19f232c5fb836e453028e924585a29fe0f68dfb4533"],
] as const;
describe("Test Calculator activation manifest (connection-free)", () => {
  it("pins all eight approved, ordered and unchanged migration identities", () => {
    const files = readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort();
    expect(files.slice(150)).toEqual(frozen.map(([file]) => file));
    for (const [file, hash] of frozen) expect(createHash("sha256").update(readFileSync(`supabase/migrations/${file}`)).digest("hex")).toBe(hash);
  });
  it("enables the authorized immutable release switch only for DEV, not browser storage or an env override", () => {
    expect(Object.isFrozen(TEST_CALCULATOR_RELEASE)).toBe(true);
    expect(TEST_CALCULATOR_RELEASE).toEqual({ enabled: true, backendOrigin: "https://yzysgbrpbhiapalgetau.supabase.co", requiredMigration: "20261027170000" });
    expect(isTestCalculatorEnabled()).toBe(true);
    const router = readFileSync("app/router/AppRouter.tsx", "utf8");
    expect(router).toContain("const testCalculatorEnabled = isTestCalculatorEnabled()");
    expect(router).toContain("testCommitmentsEnabledAfterActivation={testCalculatorEnabled}");
    expect(router).toContain("enabledAfterActivation={testCalculatorEnabled}");
    const gate = readFileSync("app/config/testCalculatorActivation.ts", "utf8");
    expect(gate).not.toMatch(/localStorage|sessionStorage|searchParams|import\.meta\.env/);
  });
  it.each(["https://different-project.supabase.co", "http://127.0.0.1:54321"])("keeps Test disabled for any non-approved backend: %s", url => {
    const original = backend.supabaseUrl;
    try { backend.supabaseUrl = url; expect(isTestCalculatorEnabled()).toBe(false); }
    finally { backend.supabaseUrl = original; }
  });
  it("registers only two new typed keys while retaining the exact legacy 39-key set", () => {
    expect(PERMISSION_KEYS).toHaveLength(39); expect(SUPPORTED_PERMISSION_KEYS).toHaveLength(41);
    expect(SUPPORTED_PERMISSION_KEYS.slice(0, 39)).toEqual(PERMISSION_KEYS);
    expect(TEST_CALCULATOR_PERMISSION_KEYS).toEqual(["test_calculator.view", "test_calculator.manage"]);
    expect(new Set(SUPPORTED_PERMISSION_KEYS).size).toBe(41);
  });
  it("matches the six frontend RPC names/arguments to their frozen SQL contracts", () => {
    const sql = frozen.map(([f]) => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
    for (const [rpc, params] of [
      ["search_test_calculator_products", ["p_search", "p_limit"]], ["preview_test_calculation", ["p_items"]],
      ["save_test_calculation", ["p_request_id", "p_name", "p_items", "p_deadline_date"]],
      ["list_test_calculations", ["p_limit", "p_before_created_at", "p_before_id"]],
      ["get_test_calculation", ["p_calculation_id"]], ["get_inventory_test_commitments", ["p_warehouse_id", "p_search"]],
    ] as const) {
      const declaration = new RegExp(`create function public\\.${rpc}\\(([^)]*)\\)`, "i").exec(sql)?.[1];
      expect(declaration).toBeDefined();
      for (const param of params) expect(declaration).toContain(param);
    }
  });
});
