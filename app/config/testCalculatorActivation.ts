import { frontendEnv } from "../../lib/config/env";

// Release-controlled switch, NOT a URL, storage or browser/environment override.
// Authorized local activation after verified DEV migrations 151–158.
export const TEST_CALCULATOR_RELEASE = Object.freeze({
  enabled: true,
  backendOrigin: "https://yzysgbrpbhiapalgetau.supabase.co",
  requiredMigration: "20261027170000",
});
export function isTestCalculatorEnabled(): boolean {
  return TEST_CALCULATOR_RELEASE.enabled && new URL(frontendEnv.supabaseUrl).origin === TEST_CALCULATOR_RELEASE.backendOrigin;
}
