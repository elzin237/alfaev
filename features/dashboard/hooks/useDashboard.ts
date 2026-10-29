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
    // General Project edits do not emit the recipient-specific alert broadcasts.
    // One visible Dashboard observer refreshes the trusted snapshot on a bounded interval.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
}
