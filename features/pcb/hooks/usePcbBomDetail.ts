import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import { pcbBomDetailQueryKey } from "../pcbQueryKeys";
import {
  getPcbBomEditor, isPcbCardId, saveInitialPcbBom,
  type PcbBomSaveItem,
} from "../services/pcbBomService";

export function usePcbBomDetail(cardId: string) {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const detailQueryKey = pcbBomDetailQueryKey(profile?.id, cardId);
  const detailQuery = useQuery({
    queryKey: detailQueryKey,
    queryFn: () => getPcbBomEditor(cardId),
    enabled: Boolean(profile?.id && isPcbCardId(cardId)),
    staleTime: 60_000,
  });
  const permissionQuery = useQuery({
    queryKey: permissionQueryKey(session?.user.id, profile?.id, "pcb.edit"),
    queryFn: () => hasPermission("pcb.edit"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const detail = detailQuery.data?.ok ? detailQuery.data.value : null;
  const canEdit = Boolean(profile?.isActive && detail?.isActive && (
    isAdmin || (permissionQuery.data?.ok === true && permissionQuery.data.value)
  ));

  async function save(items: PcbBomSaveItem[]) {
    if (!canEdit) {
      return { ok: false as const, error: { code: "access_denied" as const,
        message: "You do not have permission to edit this PCB BOM." } };
    }
    const result = await saveInitialPcbBom(cardId, items);
    if (result.ok) {
      await queryClient.invalidateQueries({ queryKey: detailQueryKey, exact: true });
    }
    return result;
  }

  return { detailQuery, canEdit, save, profileId: profile?.id };
}
