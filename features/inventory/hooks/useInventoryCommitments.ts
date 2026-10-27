import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { inventoryCommitmentsQueryKey, productProjectCommitmentsQueryKey } from "../inventoryCommitmentQueryKeys";
import { getFinishedGoodsInventoryCommitments, getInventoryCommitments, getProductProjectCommitments } from "../services/inventoryCommitmentService";

export function useInventoryCommitments(enabled = true, warehouseCode = "raw_materials") {
  const { profile } = useAuth();
  const finishedGoods = warehouseCode === "finished_goods";
  return useQuery({
    // Nested under the existing invalidation prefix used by Reserve/Release/Fulfill.
    queryKey: finishedGoods
      ? [...inventoryCommitmentsQueryKey(profile?.id), "warehouse", "finished_goods"]
      : inventoryCommitmentsQueryKey(profile?.id),
    queryFn: finishedGoods ? getFinishedGoodsInventoryCommitments : getInventoryCommitments,
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
