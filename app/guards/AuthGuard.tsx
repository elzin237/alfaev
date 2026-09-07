import { useEffect, useRef } from "react";
import { Navigate, Outlet, useNavigate } from "react-router";

import { useAuth } from "../auth/AuthProvider";
import { signOut } from "../auth/authService";

function InactiveAccountLockout() {
  const navigate = useNavigate();
  const signOutStartedRef = useRef(false);

  useEffect(() => {
    if (signOutStartedRef.current) {
      return;
    }

    signOutStartedRef.current = true;
    const signOutRequest = signOut();

    navigate("/login", {
      replace: true,
      state: { authReason: "inactive_account" },
    });
    void signOutRequest.catch(() => undefined);
  }, [navigate]);

  return null;
}

function AuthGuard() {
  const { session, profile, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!profile) {
    return null;
  }

  if (!profile.isActive) {
    return <InactiveAccountLockout />;
  }

  return <Outlet />;
}

export default AuthGuard;
