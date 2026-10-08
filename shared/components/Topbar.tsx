import { useState, type RefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Menu, UserCircle2 } from "lucide-react";
import { useNavigate } from "react-router";

import { signOut } from "../../app/auth/authService";
import { useAuth } from "../../app/auth/AuthProvider";
import { hasPermission } from "../../app/auth/permissionService";
import { permissionQueryKey } from "../../app/auth/permissionQueryKeys";
import ProjectQuickSearch from "./ProjectQuickSearch";

interface TopbarProps {
  sidebarOpen?: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarToggleRef?: RefObject<HTMLButtonElement | null>;
}

function Topbar({
  sidebarOpen = false,
  setSidebarOpen,
  sidebarToggleRef,
}: TopbarProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, profile, isAdmin, isActive } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const canCheckProjectPermission = Boolean(
    session && profile?.isActive && isActive && !isAdmin,
  );
  const projectViewPermission = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "projects.view",
    ),
    queryFn: () => hasPermission("projects.view"),
    enabled: canCheckProjectPermission,
    staleTime: 60_000,
  });
  const canSearchProjects = Boolean(
    session && profile?.isActive && isActive && (
      isAdmin || (
        projectViewPermission.data?.ok && projectViewPermission.data.value
      )
    ),
  );

  const handleLogout = async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    setLogoutError(null);

    try {
      const result = await signOut();

      if (!result.ok) {
        setLogoutError(result.error.message);
        return;
      }

      queryClient.clear();
      navigate("/login", { replace: true });
    } catch {
      setLogoutError("The authentication request could not be completed.");
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <header className="flex h-20 items-center justify-between border-b border-zinc-200 bg-white px-4 lg:px-8">
      <div className="flex items-center gap-4">
        <button
          ref={sidebarToggleRef}
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open navigation menu"
          aria-controls="app-sidebar"
          aria-expanded={sidebarOpen}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 lg:hidden"
        >
          <Menu size={20} />
        </button>

        <div>
          <h2 className="text-xl font-semibold text-zinc-900 lg:text-2xl">
            Dashboard
          </h2>

          <p className="hidden text-sm text-zinc-500 sm:block">
            Dobrodošli u ALFAEV sistem
          </p>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-3 lg:gap-4">
        <ProjectQuickSearch enabled={canSearchProjects} />

        {profile && (
          <div
            aria-label={`Signed in as ${profile.fullName}${
              isAdmin ? ", Admin" : ""
            }`}
            className="hidden min-w-0 items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 sm:flex"
          >
            <UserCircle2 size={22} aria-hidden="true" className="shrink-0" />
            <span className="max-w-36 truncate text-sm font-medium text-zinc-800">
              {profile.fullName}
            </span>
            {isAdmin && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600">
                Admin
              </span>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={isSigningOut}
          aria-busy={isSigningOut}
          className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <LogOut size={18} />
          <span>{isSigningOut ? "Odjava u toku..." : "Odjava"}</span>
        </button>

        {logoutError && (
          <p className="max-w-48 text-sm font-medium text-red-700" role="alert">
            {logoutError}
          </p>
        )}
      </div>
    </header>
  );
}

export default Topbar;
