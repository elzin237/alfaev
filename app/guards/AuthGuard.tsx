import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router";

import { getSession } from "../auth/authService";

function AuthGuard() {
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    let isCurrent = true;

    void getSession()
      .then((result) => {
        if (isCurrent) {
          setHasSession(result.ok && result.value !== null);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setHasSession(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  if (hasSession === null) {
    return null;
  }

  if (!hasSession) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export default AuthGuard;
