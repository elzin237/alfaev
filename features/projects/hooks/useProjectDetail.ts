import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { projectDetailQueryKey } from "../projectQueryKeys";
import { getProject, isProjectId } from "../services/projectService";

export function useProjectDetail(projectId: string) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: projectDetailQueryKey(profile?.id, projectId),
    queryFn: () => getProject(projectId),
    enabled: Boolean(profile?.id && isProjectId(projectId)),
    staleTime: 60_000,
  });
}
