import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import {
  procurementBadgeQueryKey,
  procurementListQueryPrefix,
} from "../procurementQueryKeys";
import { resolveProcurementRequest } from "../services/procurementService";

export function useProcurementResolve() {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const permissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "procurement.resolve",
    ),
    queryFn: () => hasPermission("procurement.resolve"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const mutation = useMutation({
    mutationFn: resolveProcurementRequest,
    onSuccess: async (result) => {
      if (!result.ok) return;

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: procurementListQueryPrefix(profile?.id),
        }),
        queryClient.invalidateQueries({
          queryKey: procurementBadgeQueryKey(profile?.id),
          exact: true,
        }),
      ]);
    },
  });
  const canResolve = Boolean(
    session &&
    profile?.isActive &&
    (isAdmin || (
      permissionQuery.data?.ok === true && permissionQuery.data.value
    )),
  );

  return {
    canResolve,
    isResolving: mutation.isPending,
    resolveRequest: mutation.mutateAsync,
  };
}
