import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { inventorySourceChoicesQueryKey, inventorySourceLotsQueryKey } from "../inventorySourceQueryKeys";
import { listInventorySourceChoices, listInventorySourceLots } from "../services/inventorySourceService";

export function useInventorySourceChoices(productId: string, warehouseId: string, enabled: boolean) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: inventorySourceChoicesQueryKey(profile?.id, warehouseId, productId),
    queryFn: () => listInventorySourceChoices(productId, warehouseId),
    enabled: Boolean(enabled && profile?.id && productId && warehouseId),
  });
}

export function useInventorySourceLots(productId: string, warehouseId: string) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: inventorySourceLotsQueryKey(profile?.id, warehouseId, productId),
    queryFn: () => listInventorySourceLots(productId, warehouseId),
    enabled: Boolean(profile?.id && productId && warehouseId),
  });
}
