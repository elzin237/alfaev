import { frontendEnv } from "../../lib/config/env";

// Coordinated release only: no URL/storage override or backend readiness probe.
export const ACTIVE_ALERTS_V2_RELEASE = Object.freeze({
  enabled: true, // Authorized DEV-only activation; other backend origins fail closed.
  backendOrigin: "https://yzysgbrpbhiapalgetau.supabase.co",
  requiredMigration: "20261031130000", // reviewed sequence through 186
  verifiedMigration: "20261031130000" as string | null,
});
export function activeAlertsV2EnabledFor(backend: string, release: {
  enabled: boolean; backendOrigin: string; requiredMigration: string; verifiedMigration: string | null;
} = ACTIVE_ALERTS_V2_RELEASE): boolean {
  try { return release.enabled && release.requiredMigration === ACTIVE_ALERTS_V2_RELEASE.requiredMigration && release.verifiedMigration === release.requiredMigration &&
    release.backendOrigin === ACTIVE_ALERTS_V2_RELEASE.backendOrigin &&
    new URL(backend).origin === release.backendOrigin; } catch { return false; }
}
export function isActiveAlertsV2Enabled(): boolean {
  return activeAlertsV2EnabledFor(frontendEnv.supabaseUrl);
}
