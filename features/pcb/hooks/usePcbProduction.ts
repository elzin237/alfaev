import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { inventoryBalanceQueryKey } from "../../inventory/inventoryBalanceQueryKeys";
import { inventoryCommitmentsQueryKey } from "../../inventory/inventoryCommitmentQueryKeys";
import { productDetailQueryKey, productListQueryPrefix } from "../../inventory/productQueryKeys";
import { projectPlanningQueryKey } from "../../projects/projectPlanningQueryKeys";
import { projectMaterialUsageQueryKey } from "../../projects/projectMaterialUsageQueryKeys";
import {
  pcbBomDetailQueryKey, pcbBomHistoryQueryKey, pcbCardListQueryKey,
  pcbProductionHistoryQueryKey, pcbProductionProjectsQueryKey, pcbProductionSourceQueryKey,
} from "../pcbQueryKeys";
import { producePcb, type ProducePcbInput, type ProducePcbResult } from "../services/pcbProductionService";

export interface ProductionSubmission extends ProducePcbInput {
  affectedProductIds: readonly string[];
}

export function usePcbProduction(cardId: string) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const profileId = profile?.id;
  const mutation = useMutation({
    mutationFn: (submission: ProductionSubmission) => producePcb(submission),
    retry: false,
  });

  async function refreshPrecheck(projectChoices: boolean) {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: pcbProductionSourceQueryKey(profileId, cardId), exact: true }),
      ...(projectChoices ? [queryClient.invalidateQueries({
        queryKey: pcbProductionProjectsQueryKey(profileId), exact: true,
      })] : []),
    ]);
  }

  async function submit(submission: ProductionSubmission) {
    let result: ProducePcbResult;
    try {
      result = await mutation.mutateAsync(submission);
    } catch (error) {
      await refreshPrecheck(true);
      throw error;
    }
    if (!result.ok) {
      await refreshPrecheck(result.error.code === "project_unavailable" || result.error.code === "unknown_outcome");
      return result;
    }
    const affectedProductIds = [...new Set(submission.affectedProductIds)];
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: pcbProductionSourceQueryKey(profileId, cardId), exact: true }),
      queryClient.invalidateQueries({ queryKey: pcbBomDetailQueryKey(profileId, cardId), exact: true }),
      queryClient.invalidateQueries({ queryKey: pcbBomHistoryQueryKey(profileId, cardId), exact: true }),
      queryClient.invalidateQueries({ queryKey: pcbProductionHistoryQueryKey(profileId, cardId), exact: true }),
      queryClient.invalidateQueries({ queryKey: pcbCardListQueryKey(profileId), exact: true }),
      queryClient.invalidateQueries({ queryKey: productListQueryPrefix(profileId) }),
      queryClient.invalidateQueries({ queryKey: inventoryCommitmentsQueryKey(profileId) }),
      ...(submission.projectId ? [queryClient.invalidateQueries({
        queryKey: projectPlanningQueryKey(profileId, submission.projectId), exact: true,
      }), queryClient.invalidateQueries({
        queryKey: projectMaterialUsageQueryKey(profileId, submission.projectId), exact: true,
      })] : []),
      ...affectedProductIds.flatMap((productId) => [
        queryClient.invalidateQueries({ queryKey: inventoryBalanceQueryKey(profileId, productId), exact: true }),
        queryClient.invalidateQueries({ queryKey: productDetailQueryKey(profileId, productId), exact: true }),
      ]),
    ]);
    return result;
  }

  return { submit, isSubmitting: mutation.isPending };
}
