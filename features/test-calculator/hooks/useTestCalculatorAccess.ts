import { useQueries } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { hasPermission } from "../../../app/auth/permissionService";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { TEST_CALCULATOR_PERMISSION_KEYS } from "../../../app/auth/permissions";

export function useTestCalculatorAccess(enabled: boolean) {
  const auth = useAuth();
  const active = enabled && !auth.isLoading && !auth.error && auth.isActive && Boolean(auth.session?.access_token &&
    auth.profile?.isActive && auth.profile.authUserId === auth.session.user.id);
  const queries = useQueries({ queries: TEST_CALCULATOR_PERMISSION_KEYS.map(permission => ({
    queryKey: permissionQueryKey(auth.session?.user.id, auth.profile?.id, permission),
    queryFn: () => active ? hasPermission(permission) : Promise.resolve({ ok: true as const, value: false }),
    enabled: Boolean(active && !auth.isAdmin), retry: false, staleTime: 0,
  })) });
  const granted = (index: number) => queries[index]?.data?.ok === true && queries[index]!.data!.value;
  const canView = Boolean(active && (auth.isAdmin || granted(0)));
  return { canView, canManage: Boolean(canView && (auth.isAdmin || granted(1))),
    isLoading: Boolean(enabled && (auth.isLoading || active && !auth.isAdmin && queries[0]?.isPending)),
    scope: `${auth.session?.user.id ?? ""}:${auth.profile?.id ?? ""}` };
}
