import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { hasPermission } from "../../../app/auth/permissionService";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { supplierListQueryKey } from "../supplierQueryKeys";
import {
  createSupplier,
  listSuppliers,
  type SupplierCreateInput,
} from "../services/supplierService";

export function useSuppliers() {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const listQueryKey = supplierListQueryKey(profile?.id);
  const suppliersQuery = useQuery({
    queryKey: listQueryKey,
    queryFn: listSuppliers,
    enabled: Boolean(profile?.id),
    staleTime: 60_000,
  });
  const createPermissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "suppliers.create",
    ),
    queryFn: () => hasPermission("suppliers.create"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const canCreate = isAdmin || (
    createPermissionQuery.data?.ok === true &&
    createPermissionQuery.data.value
  );

  async function create(input: SupplierCreateInput) {
    const result = await createSupplier(input);

    if (result.ok) {
      await queryClient.invalidateQueries({
        queryKey: listQueryKey,
        exact: true,
      });
    }

    return result;
  }

  return { suppliersQuery, canCreate, create };
}
