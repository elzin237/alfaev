import { useQueries, useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";

export function useInventoryWarehouseAccess() {
  const { session, profile, isAdmin } = useAuth();
  const canCheck = Boolean(session && profile?.isActive && !isAdmin);
  const permissionQueries = useQueries({
    queries: INVENTORY_WAREHOUSES.flatMap((warehouse) => [
      {
        queryKey: permissionQueryKey(
          session?.user.id,
          profile?.id,
          warehouse.viewPermission,
        ),
        queryFn: () => hasPermission(warehouse.viewPermission),
        enabled: canCheck,
        staleTime: 60_000,
      },
      {
        queryKey: permissionQueryKey(
          session?.user.id,
          profile?.id,
          warehouse.adjustPermission,
        ),
        queryFn: () => hasPermission(warehouse.adjustPermission),
        enabled: canCheck,
        staleTime: 60_000,
      },
    ]),
  });

  const authorizedWarehouses = isAdmin
    ? [...INVENTORY_WAREHOUSES]
    : INVENTORY_WAREHOUSES.filter((_, index) => {
      const result = permissionQueries[index * 2]?.data;
      return result?.ok === true && result.value;
    });
  const adjustableWarehouseIds = new Set(
    (isAdmin ? INVENTORY_WAREHOUSES : INVENTORY_WAREHOUSES.filter((_, index) => {
      const result = permissionQueries[index * 2 + 1]?.data;
      return result?.ok === true && result.value;
    })).map((warehouse) => warehouse.id),
  );
  const isPending = canCheck && permissionQueries.some((query) => query.isPending);
  const hasPermissionError = canCheck && permissionQueries.some(
    (query) => query.isError || query.data?.ok === false,
  );
  const authorizedWarehouseCodes = new Set(
    authorizedWarehouses.map((warehouse) => warehouse.code),
  );

  return {
    profileId: profile?.id,
    authorizedWarehouses,
    adjustableWarehouseIds,
    canReadProjectAvailability:
      authorizedWarehouseCodes.has("raw_materials") &&
      authorizedWarehouseCodes.has("customs"),
    isPending,
    isError: !isPending && authorizedWarehouses.length === 0 && hasPermissionError,
  };
}

export function useInventoryLegacyViewPermission() {
  const { session, profile, isAdmin } = useAuth();
  const query = useQuery({
    queryKey: permissionQueryKey(session?.user.id, profile?.id, "inventory.view"),
    queryFn: () => hasPermission("inventory.view"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  return {
    canReadLegacyInventory: Boolean(
      isAdmin || (query.data?.ok === true && query.data.value),
    ),
    isPending: !isAdmin && query.isPending,
  };
}
