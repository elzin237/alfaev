import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useAuth } from "./AuthProvider";
import { permissionQueryPrefix } from "./permissionQueryKeys";
import { subscribeToUserPermissionChanges } from "./permissionRealtimeService";
import { dashboardQueryKey } from "../../features/dashboard/dashboardQueryKeys";

function PermissionRuntimeSync() {
  const { session, profile, isAdmin, isActive } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (
      !session ||
      !profile ||
      !profile.isActive ||
      !isActive ||
      isAdmin
    ) {
      return;
    }

    const authUserId = session.user.id;
    const profileId = profile.id;
    const subscription = subscribeToUserPermissionChanges(
      profileId,
      () => {
        void queryClient.invalidateQueries({
          queryKey: permissionQueryPrefix(authUserId, profileId),
        });
        void queryClient.invalidateQueries({
          queryKey: dashboardQueryKey(profileId),
          exact: true,
        });
      },
    );

    return () => subscription.unsubscribe();
  }, [isActive, isAdmin, profile, queryClient, session]);

  return null;
}

export default PermissionRuntimeSync;
