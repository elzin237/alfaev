import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { inventoryBalanceQueryKey } from "../inventoryBalanceQueryKeys";
import { inventoryCommitmentsQueryKey } from "../inventoryCommitmentQueryKeys";
import { productListQueryPrefix } from "../productQueryKeys";
import {
  adjustInventory,
  getInventoryBalance,
  type InventoryAdjustmentInput,
} from "../services/inventoryBalanceService";

export function useInventoryBalance(productId: string, enabled = true) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const balanceQueryKey = inventoryBalanceQueryKey(profile?.id, productId);
  const listQueryPrefix = productListQueryPrefix(profile?.id);
  const balanceQuery = useQuery({
    queryKey: balanceQueryKey,
    queryFn: () => getInventoryBalance(productId),
    enabled: Boolean(enabled && profile?.id && productId),
    staleTime: 30_000,
  });

  async function adjust(input: InventoryAdjustmentInput) {
    const result = await adjustInventory(productId, input);

    if (result.ok) {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: balanceQueryKey,
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: listQueryPrefix,
        }),
        queryClient.invalidateQueries({
          queryKey: inventoryCommitmentsQueryKey(profile?.id),
          exact: true,
        }),
      ]);
    }

    return result;
  }

  return { balanceQuery, adjust };
}
