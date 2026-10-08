import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import {
  procurementBadgeQueryKey,
  procurementListQueryPrefix,
  procurementProductChoicesQueryKey,
  procurementSupplierOptionsQueryKey,
} from "../procurementQueryKeys";
import {
  createProcurementRequestForNewComponent,
  createProcurementRequestForProduct,
  searchProcurementProductChoices,
} from "../services/procurementService";

export function useProcurementCreation() {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const permissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "procurement.create",
    ),
    queryFn: () => hasPermission("procurement.create"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const invalidateProcurementReads = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: procurementListQueryPrefix(profile?.id),
      }),
      queryClient.invalidateQueries({
        queryKey: procurementBadgeQueryKey(profile?.id),
        exact: true,
      }),
      queryClient.invalidateQueries({
        queryKey: procurementSupplierOptionsQueryKey(profile?.id),
        exact: true,
      }),
    ]);
  };
  const existingProductMutation = useMutation({
    mutationFn: createProcurementRequestForProduct,
    onSuccess: async (result) => {
      if (!result.ok) return;
      await invalidateProcurementReads();
    },
  });
  const newComponentMutation = useMutation({
    mutationFn: createProcurementRequestForNewComponent,
    onSuccess: async (result) => {
      if (!result.ok) return;
      await invalidateProcurementReads();
    },
  });
  const hasActiveIdentity = Boolean(session && profile?.isActive);
  const canCreate = hasActiveIdentity && (
    isAdmin || (
      permissionQuery.data?.ok === true && permissionQuery.data.value
    )
  );

  return {
    canCreate,
    createExistingProductRequest: existingProductMutation.mutateAsync,
    createNewComponentRequest: newComponentMutation.mutateAsync,
  };
}

export function useProcurementCreationChoices(
  search: string,
  enabled: boolean,
) {
  const { profile } = useAuth();
  const normalizedSearch = search.trim();
  const productChoicesQuery = useQuery({
    queryKey: procurementProductChoicesQueryKey(
      profile?.id,
      normalizedSearch,
    ),
    queryFn: () => searchProcurementProductChoices(normalizedSearch),
    enabled: enabled && Boolean(profile?.id),
    staleTime: 60_000,
  });
  return { productChoicesQuery };
}
