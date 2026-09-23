import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import {
  getWorkOrderDetail,
  isWorkOrderId,
  listWorkOrderProjectChoices,
} from "../services/workOrderService";
import {
  workOrderDetailQueryKey,
  workOrderProjectChoicesQueryKey,
} from "../workOrderQueryKeys";

export function useWorkOrderDetail(workOrderId: string) {
  const { session, profile, isAdmin } = useAuth();
  const hasActiveIdentity = Boolean(session && profile?.isActive);
  const hasValidWorkOrderId = isWorkOrderId(workOrderId);
  const detailQuery = useQuery({
    queryKey: workOrderDetailQueryKey(profile?.id, workOrderId),
    queryFn: () => getWorkOrderDetail(workOrderId),
    enabled: Boolean(profile?.id && profile.isActive && hasValidWorkOrderId),
    staleTime: 60_000,
  });
  const editPermissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "work_orders.edit_draft",
    ),
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

  return {
    canEditDraft,
    detailQuery,
    projectChoicesQuery,
  };
}
