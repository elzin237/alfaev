import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import { createProduct } from "../services/productService";

export function useProductCreation() {
  const { session, profile, isAdmin } = useAuth();
  const permissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "inventory.products.create",
    ),
    queryFn: () => hasPermission("inventory.products.create"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const canCreate = isAdmin || (
    permissionQuery.data?.ok === true && permissionQuery.data.value
  );

  return {
    canCreate,
    create: createProduct,
  };
}
