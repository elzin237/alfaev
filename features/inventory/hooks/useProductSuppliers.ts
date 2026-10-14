import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import {
  productSupplierChoiceQueryKey,
  productSupplierListQueryKey,
} from "../productSupplierQueryKeys";
import {
  archiveProductSupplier,
  createProductSupplier,
  listActiveSupplierChoices,
  listProductSuppliers,
} from "../services/productSupplierService";

export function useProductSuppliers(
  productId: string,
  productIsActive: boolean,
) {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const relationListQueryKey = productSupplierListQueryKey(
    profile?.id,
    productId,
  );
  const relationQuery = useQuery({
    queryKey: relationListQueryKey,
    queryFn: () => listProductSuppliers(productId),
    enabled: Boolean(profile?.id && productId),
    staleTime: 60_000,
  });
  const productEditPermissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "inventory.products.edit",
    ),
    queryFn: () => hasPermission("inventory.products.edit"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const supplierEditPermissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "suppliers.edit",
    ),
    queryFn: () => hasPermission("suppliers.edit"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const permissionChecksResolved = isAdmin || (
    !productEditPermissionQuery.isPending &&
    !supplierEditPermissionQuery.isPending &&
    !productEditPermissionQuery.isError &&
    !supplierEditPermissionQuery.isError &&
    productEditPermissionQuery.data?.ok === true &&
    supplierEditPermissionQuery.data?.ok === true
  );
  const hasProductEditPermission =
    productEditPermissionQuery.data?.ok === true &&
    productEditPermissionQuery.data.value;
  const hasSupplierEditPermission =
    supplierEditPermissionQuery.data?.ok === true &&
    supplierEditPermissionQuery.data.value;
  const canManage = Boolean(
    profile?.isActive &&
    (
      isAdmin ||
      (
        permissionChecksResolved &&
        (hasProductEditPermission || hasSupplierEditPermission)
      )
    ),
  );
  const canAdd = canManage && productIsActive;
  const suppliersQuery = useQuery({
    queryKey: productSupplierChoiceQueryKey(profile?.id),
    queryFn: listActiveSupplierChoices,
    enabled: Boolean(profile?.id && canAdd),
    staleTime: 60_000,
  });

  async function invalidateRelations(): Promise<void> {
    await queryClient.invalidateQueries({
      queryKey: relationListQueryKey,
      exact: true,
    });
  }

  async function create(input: { supplierId: string }) {
    const result = await createProductSupplier({ productId, ...input });
    if (result.ok) await invalidateRelations();
    return result;
  }

  async function archive(relationId: string) {
    const result = await archiveProductSupplier(relationId);
    if (result.ok) await invalidateRelations();
    return result;
  }

  return {
    relationQuery,
    suppliersQuery,
    canManage,
    canAdd,
    create,
    archive,
  };
}
