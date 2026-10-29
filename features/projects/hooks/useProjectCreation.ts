import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { hasPermission } from "../../../app/auth/permissionService";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { dashboardQueryKey } from "../../dashboard/dashboardQueryKeys";
import { projectListQueryKey } from "../projectQueryKeys";
import { createProject } from "../services/projectService";

export function useProjectCreation() {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const listQueryKey = projectListQueryKey(profile?.id);
  const permissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "projects.create",
    ),
    queryFn: () => hasPermission("projects.create"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });
  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: async (result) => {
      if (result.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: listQueryKey, exact: true }),
          queryClient.invalidateQueries({ queryKey: dashboardQueryKey(profile?.id), exact: true }),
        ]);
      }
    },
  });
  const hasActiveIdentity = Boolean(session && profile?.isActive);
  const canCreate = hasActiveIdentity && (
    isAdmin || (
      permissionQuery.data?.ok === true && permissionQuery.data.value
    )
  );

  return {
    canCreate,
    create: createMutation.mutateAsync,
  };
}
