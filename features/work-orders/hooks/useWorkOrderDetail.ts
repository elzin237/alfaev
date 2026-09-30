import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import {
  projectDetailQueryKey,
  projectListQueryKey,
} from "../../projects/projectQueryKeys";
import {
  deleteDraftWorkOrder,
  getWorkOrderDetail,
  getWorkOrderMaterialInventory,
  isWorkOrderId,
  listDraftWorkOrderMaterials,
  listWorkOrderProjectChoices,
  resolveWorkOrderProductBarcode,
  saveDraftWorkOrder,
  type PersistedDraftWorkOrderMaterial,
  type SaveDraftWorkOrderInput,
  type WorkOrderMaterialLoadResult,
} from "../services/workOrderService";
import {
  finishWorkOrder,
  type FinishWorkOrderInput,
} from "../services/workOrderFinishService";
import {
  workOrderDetailQueryKey,
  workOrderDraftMaterialsQueryKey,
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
  const materialsKey = workOrderDraftMaterialsQueryKey(
    profile?.id,
    workOrderId,
  );
  const editPermissionKey = permissionQueryKey(
    session?.user.id,
    profile?.id,
    "work_orders.edit_draft",
  );
  const deletePermissionKey = permissionQueryKey(
    session?.user.id,
    profile?.id,
    "work_orders.delete_draft",
  );
  const finishPermissionKey = permissionQueryKey(
    session?.user.id,
    profile?.id,
    "work_orders.finish",
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
  const deletePermissionQuery = useQuery({
    queryKey: deletePermissionKey,
    queryFn: () => hasPermission("work_orders.delete_draft"),
    enabled: Boolean(hasActiveIdentity && !isAdmin),
    staleTime: 60_000,
  });
  const finishPermissionQuery = useQuery({
    queryKey: finishPermissionKey,
    queryFn: () => hasPermission("work_orders.finish"),
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
  const hasDeletePermission = hasActiveIdentity && (
    isAdmin || (
      deletePermissionQuery.data?.ok === true &&
      deletePermissionQuery.data.value
    )
  );
  const canDeleteDraft = Boolean(
    hasDeletePermission && detail?.status === "draft",
  );
  const hasFinishPermission = hasActiveIdentity && (
    isAdmin || (
      finishPermissionQuery.data?.ok === true &&
      finishPermissionQuery.data.value
    )
  );
  const canFinishDraft = Boolean(
    hasFinishPermission && detail?.status === "draft",
  );
  const projectChoicesQuery = useQuery({
    queryKey: workOrderProjectChoicesQueryKey(profile?.id),
    queryFn: listWorkOrderProjectChoices,
    enabled: Boolean(profile?.id && canEditDraft),
    staleTime: 60_000,
  });
  const materialsQuery = useQuery({
    queryKey: materialsKey,
    queryFn: () => listDraftWorkOrderMaterials(workOrderId),
    enabled: Boolean(
      profile?.id && profile.isActive && hasValidWorkOrderId &&
        detail?.status === "draft",
    ),
    staleTime: 60_000,
  });
  const saveMutation = useMutation({
    mutationFn: (input: SaveDraftWorkOrderInput & {
      materialSnapshot: PersistedDraftWorkOrderMaterial[];
    }) => {
      const { materialSnapshot: _materialSnapshot, ...serviceInput } = input;
      return saveDraftWorkOrder(workOrderId, serviceInput);
    },
    onSuccess: async (result, input) => {
      if (result.ok) {
        const selectedProject = projectChoicesQuery.data?.ok
          ? projectChoicesQuery.data.value.find((choice) =>
            choice.id === input.projectId
          )
          : undefined;
        queryClient.setQueryData(detailKey, (current: typeof detailQuery.data) =>
          current?.ok
            ? {
              ok: true as const,
              value: {
                ...current.value,
                projectId: input.projectId,
                projectName: selectedProject?.name ??
                  (input.projectId === current.value.projectId
                    ? current.value.projectName
                    : null),
                customerName: selectedProject?.customerName ??
                  (input.projectId === current.value.projectId
                    ? current.value.customerName
                    : null),
                description: input.description.trim() || null,
                updatedAt: result.value.updatedAt,
              },
            }
            : current
        );
        queryClient.setQueryData(materialsKey, {
          ok: true as const,
          value: input.materialSnapshot,
        });
        await queryClient.invalidateQueries({ queryKey: listKey, exact: true });
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
  const materialLoadMutation = useMutation({
    mutationFn: async (
      serialNumber: string,
    ): Promise<WorkOrderMaterialLoadResult> => {
      const productResult = await resolveWorkOrderProductBarcode(
        workOrderId,
        serialNumber,
      );
      if (!productResult.ok) return productResult;

      const inventoryResult = await getWorkOrderMaterialInventory(
        workOrderId,
        productResult.value.id,
      );
      if (!inventoryResult.ok) return inventoryResult;

      return {
        ok: true,
        value: {
          productId: productResult.value.id,
          serialNumber: productResult.value.serialNumber,
          productName: productResult.value.name,
          currentInventory: inventoryResult.value.currentInventory,
        },
      };
    },
    retry: false,
    onSuccess: (result) => {
      if (result.ok) return;

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
  const deleteMutation = useMutation({
    mutationFn: (expectedUpdatedAt: string) =>
      deleteDraftWorkOrder(workOrderId, expectedUpdatedAt),
    retry: false,
    onSuccess: async (result) => {
      if (result.ok || result.error.code === "work_order_not_found") {
        await Promise.all([
          queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
          queryClient.cancelQueries({ queryKey: materialsKey, exact: true }),
        ]);
        queryClient.removeQueries({ queryKey: detailKey, exact: true });
        queryClient.removeQueries({ queryKey: materialsKey, exact: true });
        await queryClient.invalidateQueries({ queryKey: listKey, exact: true });
        return;
      }

      if (result.error.code === "work_order_not_deletable") {
        void queryClient.invalidateQueries({ queryKey: detailKey, exact: true })
          .catch(() => undefined);
      } else if (result.error.code === "delete_access_denied") {
        void queryClient.invalidateQueries({
          queryKey: deletePermissionKey,
          exact: true,
        }).catch(() => undefined);
      }
    },
  });
  const finishMutation = useMutation({
    mutationFn: (input: Omit<FinishWorkOrderInput, "workOrderId">) =>
      finishWorkOrder({ workOrderId, ...input }),
    retry: false,
    onSuccess: async (result) => {
      if (result.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: detailKey, exact: true }),
          queryClient.invalidateQueries({ queryKey: listKey, exact: true }),
          queryClient.invalidateQueries({
            queryKey: projectDetailQueryKey(
              profile?.id,
              result.value.projectId,
            ),
            exact: true,
          }),
          queryClient.invalidateQueries({
            queryKey: projectListQueryKey(profile?.id),
            exact: true,
          }),
        ]);
        await queryClient.cancelQueries({
          queryKey: materialsKey,
          exact: true,
        });
        queryClient.removeQueries({ queryKey: materialsKey, exact: true });
        return;
      }

      if (result.error.code === "access_denied") {
        void queryClient.invalidateQueries({
          queryKey: finishPermissionKey,
          exact: true,
        }).catch(() => undefined);
      } else if (
        result.error.code === "work_order_already_finished" ||
        result.error.code === "finish_outcome_unknown" ||
        result.error.code === "finish_response_invalid" ||
        result.error.code === "work_order_not_found"
      ) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: detailKey, exact: true }),
          queryClient.invalidateQueries({ queryKey: listKey, exact: true }),
        ]).catch(() => undefined);
      }
    },
  });

  async function reloadLatestDraft() {
    const [latestDetail, latestMaterials] = await Promise.all([
      detailQuery.refetch(),
      materialsQuery.refetch(),
    ]);
    if (
      latestDetail.data?.ok &&
      latestDetail.data.value.status === "draft" &&
      latestMaterials.data?.ok
    ) {
      return {
        ok: true as const,
        detail: latestDetail.data.value,
        materials: latestMaterials.data.value,
      };
    }
    return { ok: false as const };
  }

  const finishStoppedDraft = finishMutation.data?.ok === true || (
    finishMutation.data?.ok === false && (
      finishMutation.data.error.code === "work_order_already_finished" ||
      finishMutation.data.error.code === "finish_response_invalid" ||
      finishMutation.data.error.code === "work_order_not_found"
    )
  );

  return {
    canDeleteDraft: canDeleteDraft && !finishStoppedDraft,
    canEditDraft: canEditDraft && !finishStoppedDraft,
    canFinishDraft: canFinishDraft && !finishStoppedDraft,
    deleteDraft: deleteMutation.mutateAsync,
    detailQuery,
    finishDraft: finishMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    isFinishing: finishMutation.isPending,
    isLoadingMaterial: materialLoadMutation.isPending,
    isSaving: saveMutation.isPending,
    materialsQuery,
    projectChoicesQuery,
    reloadLatestDraft,
    loadMaterial: materialLoadMutation.mutateAsync,
    saveDraft: saveMutation.mutateAsync,
  };
}
