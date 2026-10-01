import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { dashboardQueryKey } from "../dashboardQueryKeys";
import { getDashboardReadModel } from "../services/dashboardService";

export function useDashboard() {
  const { profile } = useAuth();

  return useQuery({
    queryKey: dashboardQueryKey(profile?.id),
    queryFn: getDashboardReadModel,
    enabled: Boolean(profile?.id),
    staleTime: 60_000,
  });
}
