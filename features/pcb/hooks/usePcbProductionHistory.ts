import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { pcbProductionHistoryQueryKey } from "../pcbQueryKeys";
import { isPcbCardId } from "../services/pcbBomService";
import { listPcbProductionHistory } from "../services/pcbProductionHistoryService";

export function usePcbProductionHistory(cardId: string) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: pcbProductionHistoryQueryKey(profile?.id, cardId),
    queryFn: () => listPcbProductionHistory(cardId),
    enabled: Boolean(profile?.isActive && isPcbCardId(cardId)),
    staleTime: 60_000,
  });
}
