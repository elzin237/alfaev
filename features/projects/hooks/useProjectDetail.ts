import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { hasPermission } from "../../../app/auth/permissionService";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { projectDetailQueryKey, projectListQueryKey } from "../projectQueryKeys";
import {
  cancelProject,
  getProject,
  isProjectId,
  updateProject,
  type ProjectUpdateInput,
} from "../services/projectService";

export function useProjectDetail(projectId: string) {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const detailQueryKey = projectDetailQueryKey(profile?.id, projectId);
  const listQueryKey = projectListQueryKey(profile?.id);

  const projectQuery = useQuery({
    queryKey: detailQueryKey,
    queryFn: () => getProject(projectId),
    enabled: Boolean(profile?.id && isProjectId(projectId)),
    staleTime: 60_000,
  });
  const editPermissionQuery = useQuery({
    queryKey: permissionQueryKey(session?.user.id, profile?.id, "projects.edit"),
    queryFn: () => hasPermission("projects.edit"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const archivePermissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "projects.archive",
    ),
    queryFn: () => hasPermission("projects.archive"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const project = projectQuery.data?.ok ? projectQuery.data.value : undefined;
  const hasEditPermission = Boolean(profile?.isActive && (
    isAdmin || (
      editPermissionQuery.data?.ok === true && editPermissionQuery.data.value
    )
  ));
  const hasArchivePermission = Boolean(profile?.isActive && (
    isAdmin || (
      archivePermissionQuery.data?.ok === true && archivePermissionQuery.data.value
    )
  ));
  const canEdit = Boolean(
    hasEditPermission &&
    project &&
    !["completed", "cancelled"].includes(project.status),
  );
  const canCancel = Boolean(
    hasArchivePermission &&
    project &&
    ["planned", "in_progress", "on_hold"].includes(project.status),
  );

  async function invalidateProjectQueries(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: detailQueryKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: listQueryKey, exact: true }),
    ]);
  }

  async function update(input: ProjectUpdateInput) {
    const result = await updateProject(projectId, input);
    if (result.ok) await invalidateProjectQueries();
    return result;
  }

  async function cancel() {
    const result = await cancelProject(projectId);
    if (result.ok) await invalidateProjectQueries();
    return result;
  }

  return { projectQuery, canEdit, canCancel, update, cancel };
}
