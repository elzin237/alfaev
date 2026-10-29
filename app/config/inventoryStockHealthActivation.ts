import { frontendEnv } from "../../lib/config/env";

// Coordinated release switch only. No environment, URL or storage override.
// Authorized localhost activation after verified DEV migrations 159–160.
export const INVENTORY_STOCK_HEALTH_RELEASE = Object.freeze({
  enabled: true,
  backendOrigin: "https://yzysgbrpbhiapalgetau.supabase.co",
  requiredMigration: "20261028110000",
});
export function isInventoryStockHealthEnabled(): boolean {
  return INVENTORY_STOCK_HEALTH_RELEASE.enabled &&
    new URL(frontendEnv.supabaseUrl).origin === INVENTORY_STOCK_HEALTH_RELEASE.backendOrigin;
}
