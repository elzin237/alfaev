import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import type { ProjectStatus } from "../projectStatus";
import {
  projectPlanningChoicesQueryKey,
  projectPlanningQueryKey,
} from "../projectPlanningQueryKeys";
import {
  createProjectProduct,
  createProjectRequirement,
  getProjectPlanning,
  removeProjectProduct,
  removeProjectRequirement,
  searchPlanningProductChoices,
  updateProjectProduct,
  updateProjectRequirement,
  type PlanningResult,
} from "../services/projectPlanningService";
import { isProjectId } from "../services/projectService";

export function useProjectPlanning(
  projectId: string,
  status: ProjectStatus,
  choicesOpen: boolean,
  choiceSearch: string,
) {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const planningKey = projectPlanningQueryKey(profile?.id, projectId);
  const permission = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id, profile?.id, "projects.edit",
    ),
    queryFn: () => hasPermission("projects.edit"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const canManage = Boolean(
    session && profile?.isActive &&
    ["planned", "in_progress", "on_hold"].includes(status) &&
    (isAdmin || (permission.data?.ok === true && permission.data.value)),
  );
  const planningQuery = useQuery({
    queryKey: planningKey,
    queryFn: () => getProjectPlanning(projectId),
    enabled: Boolean(profile?.isActive && isProjectId(projectId)),
    staleTime: 60_000,
  });
  const normalizedSearch = choiceSearch.trim();
  const choicesQuery = useQuery({
    queryKey: projectPlanningChoicesQueryKey(
      profile?.id, projectId, normalizedSearch,
    ),
    queryFn: () => searchPlanningProductChoices(normalizedSearch),
    enabled: canManage && choicesOpen,
    staleTime: 60_000,
  });

  async function changed(
    operation: () => Promise<PlanningResult<{ id: string }>>,
  ): Promise<PlanningResult<{ id: string }>> {
    const result = await operation();
    if (result.ok) {
      await queryClient.invalidateQueries({
        queryKey: planningKey,
        exact: true,
      });
    }
    return result;
  }

  return {
    planningQuery,
    choicesQuery,
    canManage,
    createGroup: (name: string) => changed(
      () => createProjectProduct(projectId, name),
    ),
    updateGroup: (id: string, name: string) => changed(
      () => updateProjectProduct(id, name),
    ),
    removeGroup: (id: string) => changed(
      () => removeProjectProduct(id),
    ),
    createRequirement: (
      groupId: string, productId: string, quantity: number,
    ) => changed(
      () => createProjectRequirement(groupId, productId, quantity),
    ),
    updateRequirement: (
      id: string, productId: string, quantity: number,
    ) => changed(
      () => updateProjectRequirement(id, productId, quantity),
    ),
    removeRequirement: (id: string) => changed(
      () => removeProjectRequirement(id),
    ),
  };
}
