import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../app/auth/AuthProvider";
import {
  invalidateProjectAlertQueries,
  removeProjectAlertQueries,
  useProjectAlertAccess,
} from "./hooks/useProjectAlerts";
import { subscribeToProjectAlertInvalidations } from "./services/projectAlertRealtimeService";

function ProjectAlertRuntimeSync() {
  const { session, profile } = useAuth();
  const access = useProjectAlertAccess();
  const queryClient = useQueryClient();

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
            await invalidateProjectAlertQueries(queryClient, capturedProfileId);
          } catch {
            // The trusted queries retain their own error/retry UI. Realtime is invalidation only.
          }
        } while (active && trailingReconciliationRequested);
        reconciliationInFlight = false;
      })();
    };

    const subscription = subscribeToProjectAlertInvalidations({
      profileId: capturedProfileId,
      accessToken: session.access_token,
      onInvalidate: reconcile,
      onStatusChange: (status) => {
        if (status === "subscribed") reconcile();
      },
    });

    return () => {
      active = false;
      subscription.unsubscribe();
      removeProjectAlertQueries(queryClient, capturedProfileId);
    };
  }, [
    access.canRead,
    access.profileId,
    queryClient,
    session?.access_token,
  ]);

  return null;
}

export default ProjectAlertRuntimeSync;
