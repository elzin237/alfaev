import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { hasPermission } from "../../../app/auth/permissionService";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import {
  supplierDetailQueryKey,
  supplierListQueryKey,
} from "../supplierQueryKeys";
import {
  getSupplier,
  updateSupplier,
  type SupplierMutationInput,
} from "../services/supplierService";

export function useSupplierDetail(supplierId: string) {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const detailQueryKey = supplierDetailQueryKey(profile?.id, supplierId);
  const listQueryKey = supplierListQueryKey(profile?.id);
  const supplierQuery = useQuery({
    queryKey: detailQueryKey,
    queryFn: () => getSupplier(supplierId),
    enabled: Boolean(profile?.id && supplierId),
    staleTime: 60_000,
  });
  const editPermissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "suppliers.edit",
    ),
    queryFn: () => hasPermission("suppliers.edit"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const hasEditPermission = isAdmin || (
    editPermissionQuery.data?.ok === true &&
    editPermissionQuery.data.value
  );
  const supplier = supplierQuery.data?.ok
    ? supplierQuery.data.value
    : undefined;
  const canEdit = Boolean(hasEditPermission && supplier?.isActive);

  async function update(input: SupplierMutationInput) {
    const result = await updateSupplier(supplierId, input);

    if (result.ok) {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: detailQueryKey,
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: listQueryKey,
          exact: true,
        }),
      ]);
    }

    return result;
  }

  return { supplierQuery, canEdit, update };
}
