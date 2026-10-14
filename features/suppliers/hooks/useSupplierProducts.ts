import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import {
  supplierProductChoiceQueryKey,
  supplierProductListQueryKey,
} from "../../inventory/productSupplierQueryKeys";
import {
  archiveProductSupplier,
  createProductSupplier,
  listActiveProductChoices,
  listSupplierProducts,
} from "../../inventory/services/productSupplierService";

export function useSupplierProducts(
  supplierId: string,
  supplierIsActive: boolean,
) {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const relationListQueryKey = supplierProductListQueryKey(
    profile?.id,
    supplierId,
  );
  const relationQuery = useQuery({
    queryKey: relationListQueryKey,
    queryFn: () => listSupplierProducts(supplierId),
    enabled: Boolean(profile?.id && supplierId),
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
  const canAdd = canManage && supplierIsActive;
  const productsQuery = useQuery({
    queryKey: supplierProductChoiceQueryKey(profile?.id),
    queryFn: listActiveProductChoices,
    enabled: Boolean(profile?.id && canAdd),
    staleTime: 60_000,
  });

  async function invalidateRelations(): Promise<void> {
    await queryClient.invalidateQueries({
      queryKey: relationListQueryKey,
      exact: true,
    });
  }

  async function create(input: { productId: string }) {
    const result = await createProductSupplier({ supplierId, ...input });
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
    productsQuery,
    canManage,
    canAdd,
    create,
    archive,
  };
}
