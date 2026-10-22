import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { workOrderListQueryKey } from "../../work-orders/workOrderQueryKeys";
import { pcbProductionSourceQueryKey } from "../pcbQueryKeys";
import { producePcb, type ProducePcbInput, type ProducePcbResult } from "../services/pcbProductionService";

export type ProductionSubmission = ProducePcbInput;

export function usePcbProduction(cardId: string) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const profileId = profile?.id;
  const mutation = useMutation({
    mutationFn: (submission: ProductionSubmission) => producePcb(submission),
    retry: false,
  });

  async function refreshPrecheck() {
    await queryClient.invalidateQueries({
      queryKey: pcbProductionSourceQueryKey(profileId, cardId), exact: true,
    });
  }

  async function submit(submission: ProductionSubmission) {
    let result: ProducePcbResult;
    try {
      result = await mutation.mutateAsync(submission);
    } catch (error) {
      await refreshPrecheck();
      throw error;
    }
    if (!result.ok) {
      await refreshPrecheck();
      return result;
    }
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: pcbProductionSourceQueryKey(profileId, cardId), exact: true }),
      queryClient.invalidateQueries({ queryKey: workOrderListQueryKey(profileId), exact: true }),
    ]);
    return result;
  }

  return { submit, isSubmitting: mutation.isPending };
}
