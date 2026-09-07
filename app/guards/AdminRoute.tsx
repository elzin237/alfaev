import { Outlet } from "react-router";

import { useAuth } from "../auth/AuthProvider";
import ErrorState from "../../shared/components/ErrorState";

function AdminRoute() {
  const { session, profile, isAdmin } = useAuth();

  if (!session || !profile || !profile.isActive) {
    return (
      <ErrorState
        title="Unable to verify access"
        message="Your access could not be verified."
      />
    );
  }

  if (!isAdmin) {
    return (
      <ErrorState
        title="Access denied"
        message="You do not have permission to view this area."
      />
    );
  }

  return <Outlet />;
}

export default AdminRoute;
