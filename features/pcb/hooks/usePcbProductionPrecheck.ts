import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { pcbProductionProjectsQueryKey, pcbProductionSourceQueryKey } from "../pcbQueryKeys";
import { isPcbCardId } from "../services/pcbBomService";
import { getPcbProductionPrecheck, listPcbProductionProjectChoices } from "../services/pcbProductionPrecheckService";

export function usePcbProductionPrecheck(cardId: string) {
  const { profile } = useAuth();
  const enabled = Boolean(profile?.isActive && isPcbCardId(cardId));
  const sourceQuery = useQuery({
    queryKey: pcbProductionSourceQueryKey(profile?.id, cardId),
    queryFn: () => getPcbProductionPrecheck(cardId),
    enabled,
    staleTime: 60_000,
  });
  const projectsQuery = useQuery({
    queryKey: pcbProductionProjectsQueryKey(profile?.id),
    queryFn: listPcbProductionProjectChoices,
    enabled,
    staleTime: 60_000,
  });
  return { sourceQuery, projectsQuery };
}
