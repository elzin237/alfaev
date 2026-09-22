import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { listWorkOrders } from "../services/workOrderService";
import { workOrderListQueryKey } from "../workOrderQueryKeys";

export function useWorkOrders() {
  const { profile } = useAuth();

  return useQuery({
    queryKey: workOrderListQueryKey(profile?.id),
    queryFn: listWorkOrders,
    enabled: Boolean(profile?.id),
    staleTime: 60_000,
  });
}
