import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import { inventoryCommitmentsQueryKey } from "../../inventory/inventoryCommitmentQueryKeys";
import { useInventoryCommitments } from "../../inventory/hooks/useInventoryCommitments";
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
import { projectFinishedGoodsQueryKeys } from "../projectFinishedGoodsQueryKeys";
import { useProjectRequirementMutations } from "./useProjectRequirementMutations";

export function useProjectPlanning(
  projectId: string,
  status: ProjectStatus,
  choicesOpen: boolean,
  choiceSearch: string,
) {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const requirementRecovery = useProjectRequirementMutations(projectId);
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
  const groups = planningQuery.data?.ok ? planningQuery.data.value : [];
  const finishedGoodsCommitmentsQuery = useInventoryCommitments(
    Boolean(session && groups.some(group => group.requirements.some(
      requirement => requirement.productKind === "pcb_finished_good",
    ))),
    "finished_goods",
  );
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: planningKey, exact: true }),
        queryClient.invalidateQueries({ queryKey: projectFinishedGoodsQueryKeys.profile(profile?.id) }),
        queryClient.invalidateQueries({
          queryKey: inventoryCommitmentsQueryKey(profile?.id),
        }),
      ]);
    }
    return result;
  }

  const locate = (id: string) => groups.flatMap(group => group.requirements.map(requirement => ({group,requirement})))
    .find(item => item.requirement.id === id);
  const isFinished = (id: string) => groups.some(group => group.requirements.some(r => r.productId === id && r.productKind === "pcb_finished_good")) ||
    (choicesQuery.data?.ok && choicesQuery.data.value.some(p => p.productId === id && p.productKind === "pcb_finished_good"));

  return {
    planningQuery,
    finishedGoodsCommitmentsQuery,
    choicesQuery,
    canManage,
    requirementRecovery,
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
      groupId: string, productId: string, quantity: number | string,
    ) => changed(
      () => isFinished(productId) ? requirementRecovery.execute({operation:"create",projectId,groupId,
        componentId:null,productId,quantity:String(quantity),expectedProductId:null,expectedQuantity:null})
        : createProjectRequirement(groupId, productId, quantity),
    ),
    updateRequirement: (
      id: string, productId: string, quantity: number | string,
    ) => changed(
      () => {
        const old=locate(id);
        return old && (old.requirement.productKind === "pcb_finished_good" || isFinished(productId))
          ? requirementRecovery.execute({operation:"update",projectId,groupId:old.group.id,componentId:id,productId,
            quantity:String(quantity),expectedProductId:old.requirement.productId,expectedQuantity:old.requirement.requiredQuantity.toString()})
          : updateProjectRequirement(id, productId, quantity);
      },
    ),
    removeRequirement: (id: string) => changed(
      () => {
        const old=locate(id);
        return old?.requirement.productKind === "pcb_finished_good"
          ? requirementRecovery.execute({operation:"remove",projectId,groupId:old.group.id,componentId:id,productId:null,
            quantity:null,expectedProductId:old.requirement.productId,expectedQuantity:old.requirement.requiredQuantity.toString()})
          : removeProjectRequirement(id);
      },
    ),
  };
}
