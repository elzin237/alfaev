import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import { brandListQueryKey } from "../brandQueryKeys";
import {
  productDetailQueryKey,
  productListQueryKey,
} from "../productQueryKeys";
import { listBrands } from "../services/brandService";
import {
  archiveProduct,
  getProduct,
  updateProduct,
  type UpdateProductInput,
} from "../services/productService";

export function useProductDetail(productId: string) {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const detailQueryKey = productDetailQueryKey(profile?.id, productId);
  const listQueryKey = productListQueryKey(profile?.id);
  const productQuery = useQuery({
    queryKey: detailQueryKey,
    queryFn: () => getProduct(productId),
    enabled: Boolean(profile?.id && productId),
    staleTime: 60_000,
  });
  const editPermissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "inventory.products.edit",
    ),
    queryFn: () => hasPermission("inventory.products.edit"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const product = productQuery.data?.ok
    ? productQuery.data.value
    : undefined;
  const hasEditPermission = isAdmin || (
    editPermissionQuery.data?.ok === true && editPermissionQuery.data.value
  );
  const canEdit = Boolean(hasEditPermission && product?.isActive);
  const canArchive = canEdit;
  const brandsQuery = useQuery({
    queryKey: brandListQueryKey(profile?.id),
    queryFn: listBrands,
    enabled: Boolean(profile?.id && canEdit),
    staleTime: 60_000,
  });

  async function invalidateProductQueries(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: detailQueryKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: listQueryKey, exact: true }),
    ]);
  }

  async function update(input: UpdateProductInput) {
    const result = await updateProduct(productId, input);

    if (result.ok) await invalidateProductQueries();

    return result;
  }

  async function archive() {
    const result = await archiveProduct(productId);

    if (result.ok) await invalidateProductQueries();

    return result;
  }

  return { productQuery, brandsQuery, canEdit, canArchive, update, archive };
}
