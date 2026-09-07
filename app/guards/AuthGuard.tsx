import { useEffect, useRef } from "react";
import { Navigate, Outlet, useNavigate } from "react-router";

import { useAuth } from "../auth/AuthProvider";
import { signOut } from "../auth/authService";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";

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
  const { session, profile, isLoading, error } = useAuth();

  if (isLoading) {
    return <LoadingState message="Restoring your AlfaEV session..." />;
  }

  if (error) {
    return (
      <ErrorState
        title="Unable to access AlfaEV"
        message={error.message}
      />
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!profile) {
    return (
      <ErrorState
        title="Unable to access AlfaEV"
        message="No AlfaEV profile is linked to this account."
      />
    );
  }

  if (!profile.isActive) {
    return <InactiveAccountLockout />;
  }

  return <Outlet />;
}

export default AuthGuard;
