import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import { inventoryCommitmentsQueryKey } from "../../inventory/inventoryCommitmentQueryKeys";
import { productListQueryPrefix } from "../../inventory/productQueryKeys";
import { pcbCardListQueryKey } from "../pcbQueryKeys";
import { createPcbCard } from "../services/pcbService";
import { inventoryTestCommitmentsPrefix } from "../../test-calculator/services/testCalculationRecoveryStore";
import { dashboardStockHealthPrefix, stockHealthPrefix } from "../../inventory/stockHealthQueryKeys";

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
    const identity = session?.user.id && profile?.isActive && profile.authUserId === session.user.id
      ? { authUserId: session.user.id, profileId: profile.id } : null;
    const result = await createPcbCard(name, serialNumber);
    if (result.ok) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pcbCardListQueryKey(profile?.id), exact: true }),
        queryClient.invalidateQueries({ queryKey: productListQueryPrefix(profile?.id) }),
        queryClient.invalidateQueries({ queryKey: inventoryCommitmentsQueryKey(profile?.id) }),
        ...(identity ? [
          queryClient.invalidateQueries({ queryKey: inventoryTestCommitmentsPrefix(identity) }),
          queryClient.invalidateQueries({ queryKey: stockHealthPrefix(identity.authUserId, identity.profileId) }),
          queryClient.invalidateQueries({ queryKey: dashboardStockHealthPrefix(identity.authUserId, identity.profileId) }),
        ] : []),
      ]);
    }
    return result;
  }

  return { canCreate, create };
}
