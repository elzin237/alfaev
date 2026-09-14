import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { inventoryMovementListQueryKey } from "../inventoryMovementQueryKeys";
import { listInventoryMovements } from "../services/inventoryMovementService";

export function useInventoryMovements(productId: string) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: inventoryMovementListQueryKey(profile?.id, productId),
    queryFn: () => listInventoryMovements(productId),
    enabled: Boolean(profile?.id && productId),
    staleTime: 30_000,
  });
}
