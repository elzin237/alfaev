import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import { projectFinishedGoodsQueryKeys } from "../projectFinishedGoodsQueryKeys";
import { getProjectFinishedGoods } from "../services/projectFinishedGoodsService";
import { isProjectId } from "../services/projectService";

export function useProjectFinishedGoods(projectId: string) {
  const { session, profile, isAdmin } = useAuth();
  const active = Boolean(session && profile?.isActive);
  const projectView = useQuery({
    queryKey: permissionQueryKey(session?.user.id, profile?.id, "projects.view"),
    queryFn: () => hasPermission("projects.view"),
    enabled: active && !isAdmin, staleTime: 60_000,
  });
  const fgView = useQuery({
    queryKey: permissionQueryKey(session?.user.id, profile?.id, "inventory.finished_goods.view"),
    queryFn: () => hasPermission("inventory.finished_goods.view"),
    enabled: active && !isAdmin, staleTime: 60_000,
  });
  const permissions = [projectView, fgView];
  const checkingPermissions = active && !isAdmin && permissions.some(query => query.isPending);
  const permissionError = active && !isAdmin && permissions.some(query => query.isError || query.data?.ok === false);
  const canView = active && (isAdmin || (!permissionError && permissions.every(query => query.data?.ok && query.data.value)));
  const contextQuery = useQuery({
    queryKey: projectFinishedGoodsQueryKeys.context(profile?.id, projectId),
    queryFn: () => getProjectFinishedGoods(projectId),
    enabled: canView && isProjectId(projectId),
    staleTime: 0,
  });
  async function retryPermissions() { await Promise.all(permissions.map(query => query.refetch())); }
  return { contextQuery, canView, checkingPermissions, permissionError, retryPermissions };
}
