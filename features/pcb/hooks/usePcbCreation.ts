import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import { inventoryCommitmentsQueryKey } from "../../inventory/inventoryCommitmentQueryKeys";
import { productListQueryPrefix } from "../../inventory/productQueryKeys";
import { pcbCardListQueryKey } from "../pcbQueryKeys";
import { createPcbCard } from "../services/pcbService";

export function usePcbCreation() {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const permissionQuery = useQuery({
    queryKey: permissionQueryKey(session?.user.id, profile?.id, "pcb.create"),
    queryFn: () => hasPermission("pcb.create"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const canCreate = Boolean(session && profile?.isActive && (
    isAdmin || (permissionQuery.data?.ok === true && permissionQuery.data.value)
  ));

  async function create(name: string, serialNumber: string) {
    const result = await createPcbCard(name, serialNumber);
    if (result.ok) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pcbCardListQueryKey(profile?.id), exact: true }),
        queryClient.invalidateQueries({ queryKey: productListQueryPrefix(profile?.id) }),
        queryClient.invalidateQueries({ queryKey: inventoryCommitmentsQueryKey(profile?.id) }),
      ]);
    }
    return result;
  }

  return { canCreate, create };
}
