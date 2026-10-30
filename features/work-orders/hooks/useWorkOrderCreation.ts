import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import { createDraftWorkOrder } from "../services/workOrderService";
import { workOrderListQueryKey } from "../workOrderQueryKeys";
import {refreshUnsignalledWorkOrderCommitments} from "../../inventory/refreshWorkOrderCommitmentReads";

export function useWorkOrderCreation() {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const listQueryKey = workOrderListQueryKey(profile?.id);
  const permissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "work_orders.create",
    ),
    queryFn: () => hasPermission("work_orders.create"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const createMutation = useMutation({
    mutationFn: createDraftWorkOrder,
    onSuccess: async (result) => {
      if (result.ok) {
        await refreshUnsignalledWorkOrderCommitments(queryClient,session?.user.id,profile?.id);
        await queryClient.invalidateQueries({
          queryKey: listQueryKey,
          exact: true,
        });
      }
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
    create: createMutation.mutateAsync,
    isPending: createMutation.isPending,
  };
}
