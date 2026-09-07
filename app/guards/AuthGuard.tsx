import { Navigate, Outlet } from "react-router";

import { useAuth } from "../auth/AuthProvider";

function AuthGuard() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export default AuthGuard;
