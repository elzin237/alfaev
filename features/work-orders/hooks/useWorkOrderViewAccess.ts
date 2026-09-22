import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";

export function useWorkOrderViewAccess() {
  const { session, profile, isAdmin } = useAuth();
  const canCheckPermission = Boolean(
    session && profile?.isActive && !isAdmin,
  );
  const permissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "work_orders.view",
    ),
    queryFn: () => hasPermission("work_orders.view"),
    enabled: canCheckPermission,
    staleTime: 60_000,
  });
  const hasActiveIdentity = Boolean(session && profile?.isActive);
  const canView = hasActiveIdentity && (
    isAdmin || (
      permissionQuery.data?.ok === true && permissionQuery.data.value
    )
  );

  return {
    canView,
    isChecking: canCheckPermission && permissionQuery.isPending,
  };
}
