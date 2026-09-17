import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { pcbBomHistoryQueryKey } from "../pcbQueryKeys";
import { isPcbCardId } from "../services/pcbBomService";
import { listPcbBomVersions } from "../services/pcbBomHistoryService";

export function usePcbBomHistory(cardId: string) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: pcbBomHistoryQueryKey(profile?.id, cardId),
    queryFn: () => listPcbBomVersions(cardId),
    enabled: Boolean(profile?.isActive && isPcbCardId(cardId)),
    staleTime: 60_000,
  });
}
