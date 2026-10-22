import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { inventoryCommitmentsQueryKey, productProjectCommitmentsQueryKey } from "../inventoryCommitmentQueryKeys";
import { getInventoryCommitments, getProductProjectCommitments } from "../services/inventoryCommitmentService";

export function useInventoryCommitments(enabled = true) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: inventoryCommitmentsQueryKey(profile?.id),
    queryFn: getInventoryCommitments,
    enabled: Boolean(enabled && profile?.isActive),
    staleTime: 30_000,
  });
}

export function useProductProjectCommitments(productId: string, expanded: boolean, enabled = true) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: productProjectCommitmentsQueryKey(profile?.id, productId),
    queryFn: () => getProductProjectCommitments(productId),
    enabled: Boolean(enabled && profile?.isActive && expanded),
    staleTime: 30_000,
  });
}
