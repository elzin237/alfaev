import { useQuery } from "@tanstack/react-query";

import { procurementBadgeQueryKey } from "../procurementQueryKeys";
import { getProcurementSidebarBadgeCount } from "../services/procurementService";

export function useProcurementSidebarBadge(
  profileId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: procurementBadgeQueryKey(profileId),
    queryFn: getProcurementSidebarBadgeCount,
    enabled: enabled && Boolean(profileId),
    staleTime: 60_000,
  });
}
