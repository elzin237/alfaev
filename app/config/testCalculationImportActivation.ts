import { frontendEnv } from "../../lib/config/env";
import { isTestCalculatorEnabled } from "./testCalculatorActivation";

// Authorized local DEV activation after verified migrations 167–170. No runtime overrides.
export const TEST_CALCULATION_IMPORT_RELEASE = Object.freeze({
  enabled: true,
  backendOrigin: "https://yzysgbrpbhiapalgetau.supabase.co",
  requiredMigration: "20261030100000",
});
export function isTestCalculationImportEnabled(): boolean {
  return TEST_CALCULATION_IMPORT_RELEASE.enabled && isTestCalculatorEnabled() &&
    new URL(frontendEnv.supabaseUrl).origin === TEST_CALCULATION_IMPORT_RELEASE.backendOrigin;
}
