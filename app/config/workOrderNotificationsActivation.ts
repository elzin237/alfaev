import { frontendEnv } from "../../lib/config/env";

export const WORK_ORDER_NOTIFICATIONS_RELEASE = Object.freeze({
  enabled: true,
  backendOrigin: "https://yzysgbrpbhiapalgetau.supabase.co",
  requiredMigration: "20261028150000",
});
export function isWorkOrderNotificationsEnabled(): boolean {
  return WORK_ORDER_NOTIFICATIONS_RELEASE.enabled &&
    new URL(frontendEnv.supabaseUrl).origin === WORK_ORDER_NOTIFICATIONS_RELEASE.backendOrigin;
}
