import { Navigate, Outlet } from "react-router";

function AuthGuard() {
  const isAuthenticated = localStorage.getItem("alfaev_auth");

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export default AuthGuard;
