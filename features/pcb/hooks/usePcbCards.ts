import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { pcbCardListQueryKey } from "../pcbQueryKeys";
import { listPcbCards } from "../services/pcbService";

export function usePcbCards() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: pcbCardListQueryKey(profile?.id),
    queryFn: listPcbCards,
    enabled: Boolean(profile?.id),
    staleTime: 60_000,
  });
}
