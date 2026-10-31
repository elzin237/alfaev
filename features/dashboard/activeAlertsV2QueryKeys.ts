import { frontendEnv } from "../../lib/config/env";
import { isActiveAlertsV2Enabled } from "../../app/config/activeAlertsV2Activation";
import type { QueryClient } from "@tanstack/react-query";

export interface ActiveAlertScope { backendOrigin: string; authUserId: string; profileId: string; permissions: string }
export const activeAlertBackend = () => new URL(frontendEnv.supabaseUrl).origin;
export const activeAlertV2Prefix = (s:ActiveAlertScope) => ["dashboard","active-alerts-v2",s.backendOrigin,s.authUserId,s.profileId,s.permissions] as const;
export const activeAlertScopeId = (s:ActiveAlertScope|null) => s ? JSON.stringify(activeAlertV2Prefix(s)) : "disabled";
export function invalidateActiveAlertV2Queries(client:QueryClient,scope:ActiveAlertScope) {
  return isActiveAlertsV2Enabled() && scope.backendOrigin===activeAlertBackend()
    ? client.invalidateQueries({queryKey:activeAlertV2Prefix(scope)}) : Promise.resolve();
}
export function removeActiveAlertV2Queries(client:QueryClient,scope:ActiveAlertScope) {
  void client.cancelQueries({queryKey:activeAlertV2Prefix(scope)});
  client.removeQueries({queryKey:activeAlertV2Prefix(scope)});
}
