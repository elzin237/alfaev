import { frontendEnv } from "../../lib/config/env";

// Coordinated release only: no URL, environment or browser-storage override.
export const WORK_ORDER_AVAILABILITY_RELEASE = Object.freeze({
  enabled: true,
  backendOrigin: "https://yzysgbrpbhiapalgetau.supabase.co",
  requiredMigration: "20261028130000",
});
export function isWorkOrderAvailabilityEnabled(): boolean {
  return WORK_ORDER_AVAILABILITY_RELEASE.enabled &&
    new URL(frontendEnv.supabaseUrl).origin === WORK_ORDER_AVAILABILITY_RELEASE.backendOrigin;
}
