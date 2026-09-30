import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import { projectMaterialUsageQueryKey } from "../projectMaterialUsageQueryKeys";
import { listProjectMaterialUsage } from "../services/projectMaterialUsageService";
import { isProjectId } from "../services/projectService";

export function useProjectMaterialUsage(projectId: string) {
  const { session, profile, isAdmin } = useAuth();
  const workOrderViewPermission = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "work_orders.view",
    ),
    queryFn: () => hasPermission("work_orders.view"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const usageQuery = useQuery({
    queryKey: projectMaterialUsageQueryKey(profile?.id, projectId),
    queryFn: () => listProjectMaterialUsage(projectId),
    enabled: Boolean(profile?.isActive && isProjectId(projectId)),
    staleTime: 60_000,
  });

  return {
    usageQuery,
    canViewWorkOrders: Boolean(
      profile?.isActive &&
      (isAdmin || (
        workOrderViewPermission.data?.ok === true &&
        workOrderViewPermission.data.value
      )),
    ),
  };
}
