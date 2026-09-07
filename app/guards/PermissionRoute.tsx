import { useQuery } from "@tanstack/react-query";
import { Outlet } from "react-router";

import { useAuth } from "../auth/AuthProvider";
import { hasPermission } from "../auth/permissionService";
import type { PermissionKey } from "../auth/permissions";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";

interface PermissionRouteProps {
  permission: PermissionKey;
}

function PermissionRoute({ permission }: PermissionRouteProps) {
  const { session, profile, isAdmin } = useAuth();
  const canCheckPermission = Boolean(
    session && profile?.isActive && !isAdmin,
  );
  const permissionQuery = useQuery({
    queryKey: [
      "permission",
      session?.user.id,
      profile?.id,
      permission,
    ],
    queryFn: () => hasPermission(permission),
    enabled: canCheckPermission,
    staleTime: 60_000,
  });

  if (!session || !profile || !profile.isActive) {
    return (
      <ErrorState
        title="Unable to verify access"
        message="Your access could not be verified."
      />
    );
  }

  if (isAdmin) {
    return <Outlet />;
  }

  if (permissionQuery.isPending) {
    return <LoadingState message="Checking your access..." />;
  }

  if (permissionQuery.isError || !permissionQuery.data?.ok) {
    return (
      <ErrorState
        title="Unable to verify access"
        message={
          permissionQuery.data?.ok === false
            ? permissionQuery.data.error.message
            : "Your access could not be verified."
        }
      />
    );
  }

  if (!permissionQuery.data.value) {
    return (
      <ErrorState
        title="Access denied"
        message="You do not have permission to view this area."
      />
    );
  }

  return <Outlet />;
}

export default PermissionRoute;
