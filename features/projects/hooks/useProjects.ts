import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { projectListQueryKey } from "../projectQueryKeys";
import { listProjects } from "../services/projectService";

export function useProjects() {
  const { profile } = useAuth();

  return useQuery({
    queryKey: projectListQueryKey(profile?.id),
    queryFn: listProjects,
    enabled: Boolean(profile?.id),
    staleTime: 60_000,
  });
}
