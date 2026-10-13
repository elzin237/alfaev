import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { inventorySourceChoicesQueryKey, inventorySourceLotsQueryKey } from "../inventorySourceQueryKeys";
import { listInventorySourceChoices, listInventorySourceLots } from "../services/inventorySourceService";

export function useInventorySourceChoices(productId: string, enabled: boolean) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: inventorySourceChoicesQueryKey(profile?.id, productId),
    queryFn: () => listInventorySourceChoices(productId),
    enabled: Boolean(enabled && profile?.id && productId),
  });
}

export function useInventorySourceLots(productId: string) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: inventorySourceLotsQueryKey(profile?.id, productId),
    queryFn: () => listInventorySourceLots(productId),
    enabled: Boolean(profile?.id && productId),
  });
}
