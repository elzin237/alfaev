import { useQueries } from "@tanstack/react-query";
import { Outlet } from "react-router";

import { useAuth } from "../auth/AuthProvider";
import { hasPermission } from "../auth/permissionService";
import type { PermissionKey } from "../auth/permissions";
import { permissionQueryKey } from "../auth/permissionQueryKeys";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";

interface PermissionRouteProps {
  permission?: PermissionKey;
  anyOf?: readonly PermissionKey[];
}

function PermissionRoute({ permission, anyOf }: PermissionRouteProps) {
  const { session, profile, isAdmin } = useAuth();
  const permissions = anyOf ?? (permission ? [permission] : []);
  const canCheckPermission = Boolean(
    session && profile?.isActive && !isAdmin,
  );
  const permissionQueries = useQueries({
    queries: permissions.map((permissionKey) => ({
      queryKey: permissionQueryKey(
        session?.user.id,
        profile?.id,
        permissionKey,
      ),
      queryFn: () => hasPermission(permissionKey),
      enabled: canCheckPermission,
      staleTime: 60_000,
    })),
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

  if (permissionQueries.some((query) => query.isPending)) {
    return <LoadingState message="Checking your access..." />;
  }

  const failedQuery = permissionQueries.find(
    (query) => query.isError || query.data?.ok === false,
  );
  if (failedQuery) {
    return (
      <ErrorState
        title="Unable to verify access"
        message={
          failedQuery.data?.ok === false
            ? failedQuery.data.error.message
            : "Your access could not be verified."
        }
      />
    );
  }

  if (!permissionQueries.some((query) => query.data?.ok === true && query.data.value)) {
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
