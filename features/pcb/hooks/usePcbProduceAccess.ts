import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";

export function usePcbProduceAccess(): boolean {
  const { session, profile, isAdmin } = useAuth();
  const permissionQuery = useQuery({
    queryKey: permissionQueryKey(session?.user.id, profile?.id, "pcb.produce"),
    queryFn: () => hasPermission("pcb.produce"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  return Boolean(profile?.isActive && (isAdmin ||
    (permissionQuery.data?.ok === true && permissionQuery.data.value)));
}
