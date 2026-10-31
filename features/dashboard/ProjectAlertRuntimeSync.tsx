import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../app/auth/AuthProvider";
import { isWorkOrderActiveShortagesEnabled } from "../../app/config/workOrderActiveShortagesActivation";
import { isActiveAlertsV2Enabled } from "../../app/config/activeAlertsV2Activation";
import { activeAlertBackend, activeAlertScopeId, invalidateActiveAlertV2Queries, removeActiveAlertV2Queries, type ActiveAlertScope } from "./activeAlertsV2QueryKeys";
import {
  invalidateProjectAlertQueries,
  removeProjectAlertQueries,
  useProjectAlertAccess,
} from "./hooks/useProjectAlerts";
import { subscribeToProjectAlertInvalidations } from "./services/projectAlertRealtimeService";

function ProjectAlertRuntimeSync() {
  const { session, profile, isActive, isLoading, error } = useAuth();
  const access = useProjectAlertAccess(isActiveAlertsV2Enabled());
  const queryClient = useQueryClient();
  const v2Scope:ActiveAlertScope|null=isActiveAlertsV2Enabled()&&!isLoading&&!error&&isActive&&profile?.isActive&&session?.access_token&&
    profile.authUserId===session.user.id&&access.canRead&&!access.permissionsPending&&access.profileId===profile.id?
    {backendOrigin:activeAlertBackend(),authUserId:session.user.id,profileId:profile.id,permissions:access.scope}:null;
  const v2ScopeId=activeAlertScopeId(v2Scope);

  useEffect(() => {
    if (
      access.permissionsPending ||
      access.canRead ||
      !profile?.id
    ) {
      return;
    }

    removeProjectAlertQueries(queryClient, profile.id);
  }, [
    access.canRead,
    access.permissionsPending,
    profile?.id,
    queryClient,
  ]);

  useEffect(() => {
    if (!session || !access.profileId || !access.canRead) return;

    const capturedProfileId = access.profileId;
    let active = true;
    let reconciliationInFlight = false;
    let trailingReconciliationRequested = false;

    const reconcile = () => {
      if (!active) return;
      if (reconciliationInFlight) {
        trailingReconciliationRequested = true;
        return;
      }

      reconciliationInFlight = true;
      void (async () => {
        do {
          trailingReconciliationRequested = false;
          try {
            if(v2Scope)await Promise.all([invalidateProjectAlertQueries(queryClient,capturedProfileId),invalidateActiveAlertV2Queries(queryClient,v2Scope)]);
            else await invalidateProjectAlertQueries(queryClient, capturedProfileId);
          } catch {
            // The trusted queries retain their own error/retry UI. Realtime is invalidation only.
          }
        } while (active && trailingReconciliationRequested);
        reconciliationInFlight = false;
      })();
    };

    const subscription = !(isWorkOrderActiveShortagesEnabled() || isActiveAlertsV2Enabled()) || access.canReadProjects ? subscribeToProjectAlertInvalidations({
      profileId: capturedProfileId,
      accessToken: session.access_token,
      onInvalidate: reconcile,
      onStatusChange: (status) => {
        if (status === "subscribed") reconcile();
      },
    }) : null;
    const shortageSubscription = (isWorkOrderActiveShortagesEnabled() || isActiveAlertsV2Enabled()) && access.canReadWorkOrders
      ? subscribeToProjectAlertInvalidations({profileId:capturedProfileId,accessToken:session.access_token,
        target:"work_order",onInvalidate:reconcile,onStatusChange:status=>{if(status==="subscribed")reconcile();}})
      : null;

    return () => {
      active = false;
      subscription?.unsubscribe();
      shortageSubscription?.unsubscribe();
      removeProjectAlertQueries(queryClient, capturedProfileId);
      if(v2Scope)removeActiveAlertV2Queries(queryClient,v2Scope);
    };
  }, [
    access.canRead,
    access.canReadWorkOrders,
    access.canReadProjects,
    access.profileId,
    queryClient,
    session?.access_token,
    v2ScopeId,
  ]);

  return null;
}

export default ProjectAlertRuntimeSync;
