import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import {
  getWorkOrderDetail,
  isWorkOrderId,
  listWorkOrderProjectChoices,
  updateDraftWorkOrder,
  type DraftWorkOrderUpdateInput,
} from "../services/workOrderService";
import {
  workOrderDetailQueryKey,
  workOrderListQueryKey,
  workOrderProjectChoicesQueryKey,
} from "../workOrderQueryKeys";

export function useWorkOrderDetail(workOrderId: string) {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const hasActiveIdentity = Boolean(session && profile?.isActive);
  const hasValidWorkOrderId = isWorkOrderId(workOrderId);
  const detailKey = workOrderDetailQueryKey(profile?.id, workOrderId);
  const listKey = workOrderListQueryKey(profile?.id);
  const editPermissionKey = permissionQueryKey(
    session?.user.id,
    profile?.id,
    "work_orders.edit_draft",
  );
  const detailQuery = useQuery({
    queryKey: detailKey,
    queryFn: () => getWorkOrderDetail(workOrderId),
    enabled: Boolean(profile?.id && profile.isActive && hasValidWorkOrderId),
    staleTime: 60_000,
  });
  const editPermissionQuery = useQuery({
    queryKey: editPermissionKey,
    queryFn: () => hasPermission("work_orders.edit_draft"),
    enabled: Boolean(hasActiveIdentity && !isAdmin),
    staleTime: 60_000,
  });
  const detail = detailQuery.data?.ok ? detailQuery.data.value : undefined;
  const hasEditPermission = hasActiveIdentity && (
    isAdmin || (
      editPermissionQuery.data?.ok === true && editPermissionQuery.data.value
    )
  );
  const canEditDraft = Boolean(
    hasEditPermission && detail?.status === "draft",
  );
  const projectChoicesQuery = useQuery({
    queryKey: workOrderProjectChoicesQueryKey(profile?.id),
    queryFn: listWorkOrderProjectChoices,
    enabled: Boolean(profile?.id && canEditDraft),
    staleTime: 60_000,
  });
  const saveMutation = useMutation({
    mutationFn: (input: DraftWorkOrderUpdateInput) =>
      updateDraftWorkOrder(workOrderId, input),
    onSuccess: async (result) => {
      if (result.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: detailKey, exact: true }),
          queryClient.invalidateQueries({ queryKey: listKey, exact: true }),
        ]);
        return;
      }

      if (result.error.code === "work_order_not_editable") {
        void queryClient.invalidateQueries({ queryKey: detailKey, exact: true })
          .catch(() => undefined);
      } else if (result.error.code === "access_denied") {
        void queryClient.invalidateQueries({
          queryKey: editPermissionKey,
          exact: true,
        }).catch(() => undefined);
      }
    },
  });

  async function reloadLatestDraft(): Promise<void> {
    await detailQuery.refetch();
  }

  return {
    canEditDraft,
    detailQuery,
    isSaving: saveMutation.isPending,
    projectChoicesQuery,
    reloadLatestDraft,
    saveDraft: saveMutation.mutateAsync,
  };
}
