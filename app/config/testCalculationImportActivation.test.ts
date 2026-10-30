import { expect, it, vi } from "vitest";
it.each([
  ["https://yzysgbrpbhiapalgetau.supabase.co", true],
  ["https://other.supabase.co", false],
  ["http://127.0.0.1:54321", false],
] as const)("restricts activation to the approved DEV backend: %s", async (origin, enabled) => {
  vi.resetModules(); vi.doMock("../../lib/config/env", () => ({ frontendEnv: { supabaseUrl: origin } }));
  const gate = await import("./testCalculationImportActivation");
  expect(gate.TEST_CALCULATION_IMPORT_RELEASE.enabled).toBe(true); expect(gate.isTestCalculationImportEnabled()).toBe(enabled);
  expect(gate.TEST_CALCULATION_IMPORT_RELEASE.backendOrigin).toBe("https://yzysgbrpbhiapalgetau.supabase.co");
  expect(Object.isFrozen(gate.TEST_CALCULATION_IMPORT_RELEASE)).toBe(true);
});
it("remains disabled when the prerequisite Test Calculator release is closed", async () => {
  vi.resetModules();
  vi.doMock("../../lib/config/env", () => ({ frontendEnv: { supabaseUrl: "https://yzysgbrpbhiapalgetau.supabase.co" } }));
  vi.doMock("./testCalculatorActivation", () => ({ isTestCalculatorEnabled: () => false }));
  const gate = await import("./testCalculationImportActivation");
  expect(gate.isTestCalculationImportEnabled()).toBe(false);
  vi.doUnmock("./testCalculatorActivation");
});
