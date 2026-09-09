import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import { productListQueryKey } from "../productQueryKeys";
import { createProduct } from "../services/productService";

export function useProductCreation() {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const listQueryKey = productListQueryKey(profile?.id);
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

  async function create(input: Parameters<typeof createProduct>[0]) {
    const result = await createProduct(input);

    if (result.ok) {
      await queryClient.invalidateQueries({
        queryKey: listQueryKey,
        exact: true,
      });
    }

    return result;
  }

  return {
    canCreate,
    create,
  };
}
