import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import { productListQueryPrefix } from "../productQueryKeys";
import { inventoryCommitmentsQueryKey } from "../inventoryCommitmentQueryKeys";
import { createProduct } from "../services/productService";
import { inventoryTestCommitmentsPrefix } from "../../test-calculator/services/testCalculationRecoveryStore";

export function useProductCreation() {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const listQueryPrefix = productListQueryPrefix(profile?.id);
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
    const identity = session?.user.id && profile?.isActive && profile.authUserId === session.user.id
      ? { authUserId: session.user.id, profileId: profile.id } : null;
    const result = await createProduct(input);

    if (result.ok) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: listQueryPrefix }),
        queryClient.invalidateQueries({
          queryKey: inventoryCommitmentsQueryKey(profile?.id),
          exact: true,
        }),
        ...(identity ? [queryClient.invalidateQueries({ queryKey: inventoryTestCommitmentsPrefix(identity) })] : []),
      ]);
    }

    return result;
  }

  return {
    canCreate,
    create,
  };
}
