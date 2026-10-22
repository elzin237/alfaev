import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { pcbProductionSourceQueryKey } from "../pcbQueryKeys";
import { isPcbCardId } from "../services/pcbBomService";
import { getPcbProductionPrecheck } from "../services/pcbProductionPrecheckService";

export function usePcbProductionPrecheck(cardId: string) {
  const { profile } = useAuth();
  const enabled = Boolean(profile?.isActive && isPcbCardId(cardId));
  const sourceQuery = useQuery({
    queryKey: pcbProductionSourceQueryKey(profile?.id, cardId),
    queryFn: () => getPcbProductionPrecheck(cardId),
    enabled,
    staleTime: 60_000,
  });
  return { sourceQuery };
}
