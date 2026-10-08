import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { projectSearchQueryKey } from "../projectQueryKeys";
import { searchProjects } from "../services/projectService";

export function useProjectSearch(search: string, enabled: boolean) {
  const { profile } = useAuth();
  const normalizedSearch = search.trim();

  return useQuery({
    queryKey: projectSearchQueryKey(profile?.id, normalizedSearch),
    queryFn: () => searchProjects(normalizedSearch),
    enabled: Boolean(profile?.id && enabled && normalizedSearch),
    staleTime: 30_000,
    gcTime: 60_000,
    retry: false,
  });
}
