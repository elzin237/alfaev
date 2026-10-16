import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { projectMaterialUsageQueryKey } from "../projectMaterialUsageQueryKeys";
import { listProjectMaterialUsage } from "../services/projectMaterialUsageService";
import { isProjectId } from "../services/projectService";

export function useProjectMaterialUsage(projectId: string) {
  const { profile } = useAuth();
  const usageQuery = useQuery({
    queryKey: projectMaterialUsageQueryKey(profile?.id, projectId),
    queryFn: () => listProjectMaterialUsage(projectId),
    enabled: Boolean(profile?.isActive && isProjectId(projectId)),
    staleTime: 60_000,
  });

  return { usageQuery };
}
