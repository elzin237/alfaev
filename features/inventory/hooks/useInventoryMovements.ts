import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { inventoryMovementListQueryKey } from "../inventoryMovementQueryKeys";
import { listInventoryMovements } from "../services/inventoryMovementService";

export function useInventoryMovements(productId: string, warehouseId = "10000000-0000-4000-8000-000000000001") {
  const { profile } = useAuth();

  return useQuery({
    queryKey: inventoryMovementListQueryKey(profile?.id, warehouseId, productId),
    queryFn: () => listInventoryMovements(productId, warehouseId),
    enabled: Boolean(profile?.id && productId && warehouseId),
    staleTime: 30_000,
  });
}
