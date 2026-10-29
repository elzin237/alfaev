import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { inventoryBalanceQueryKey } from "../inventoryBalanceQueryKeys";
import { inventoryCommitmentsQueryKey } from "../inventoryCommitmentQueryKeys";
import { inventoryMovementListQueryKey } from "../inventoryMovementQueryKeys";
import { inventorySourceLotsQueryKey } from "../inventorySourceQueryKeys";
import { productDetailQueryKey, productListQueryPrefix } from "../productQueryKeys";
import { invalidatePhysicalStockHealth } from "../stockHealthQueryKeys";
import { pcbBomDetailQueryPrefix, pcbCardListQueryKey } from "../../pcb/pcbQueryKeys";
import {
  adjustInventory,
  getInventoryBalance,
  transferInventory,
  type InventoryAdjustmentInput,
  type InventoryTransferInput,
} from "../services/inventoryBalanceService";

export function useInventoryBalance(
  productId: string,
  warehouseId = "10000000-0000-4000-8000-000000000001",
  enabled = true,
) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const balanceQueryKey = inventoryBalanceQueryKey(profile?.id, warehouseId, productId);
  const listQueryPrefix = productListQueryPrefix(profile?.id);
  const balanceQuery = useQuery({
    queryKey: balanceQueryKey,
    queryFn: () => getInventoryBalance(productId, warehouseId),
    enabled: Boolean(enabled && profile?.id && productId && warehouseId),
    staleTime: 30_000,
  });

  async function adjust(input: InventoryAdjustmentInput) {
    const result = await adjustInventory(productId, warehouseId, input);

    if (result.ok) {
      await invalidatePhysicalStockHealth(queryClient, profile?.id);
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
        }),
        queryClient.invalidateQueries({
          queryKey: inventoryMovementListQueryKey(profile?.id, warehouseId, productId),
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: inventorySourceLotsQueryKey(profile?.id, warehouseId, productId),
          exact: true,
        }),
        queryClient.invalidateQueries({ queryKey: pcbCardListQueryKey(profile?.id), exact: true }),
        queryClient.invalidateQueries({ queryKey: pcbBomDetailQueryPrefix(profile?.id) }),
        queryClient.invalidateQueries({ queryKey: ["pcb", "bom-choices", profile?.id] }),
        queryClient.invalidateQueries({ queryKey: ["pcb", "production-source", profile?.id] }),
        queryClient.invalidateQueries({ queryKey: productDetailQueryKey(profile?.id, warehouseId, productId), exact: true }),
      ]);
    }

    return result;
  }

  async function transfer(input: InventoryTransferInput) {
    const result = await transferInventory(productId, warehouseId, input);
    if (result.ok) {
      await invalidatePhysicalStockHealth(queryClient, profile?.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: listQueryPrefix }),
        queryClient.invalidateQueries({
          queryKey: ["inventory", "products", "detail", profile?.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["inventory", "balances", "detail", profile?.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["inventory", "movements", "product", profile?.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["inventory-source-lots", profile?.id ?? "anonymous"],
        }),
        queryClient.invalidateQueries({ queryKey: inventoryCommitmentsQueryKey(profile?.id) }),
        queryClient.invalidateQueries({ queryKey: pcbCardListQueryKey(profile?.id), exact: true }),
        queryClient.invalidateQueries({ queryKey: pcbBomDetailQueryPrefix(profile?.id) }),
        queryClient.invalidateQueries({ queryKey: ["pcb", "bom-choices", profile?.id] }),
        queryClient.invalidateQueries({ queryKey: ["pcb", "production-source", profile?.id] }),
      ]);
    }
    return result;
  }

  return { balanceQuery, adjust, transfer };
}
