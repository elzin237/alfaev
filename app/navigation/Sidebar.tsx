import { useQueries } from "@tanstack/react-query";
import { NavLink } from "react-router";
import { X } from "lucide-react";

import { useAuth } from "../auth/AuthProvider";
import { hasPermission } from "../auth/permissionService";
import { permissionQueryKey } from "../auth/permissionQueryKeys";
import { useProcurementSidebarBadge } from "../../features/procurement/hooks/useProcurementSidebarBadge";
import { NAVIGATION } from "./navigation";

const permissionNavigationItems = NAVIGATION.flatMap((item) =>
  item.access.kind === "permission"
    ? [{ permission: item.access.permission }]
    : [],
);

interface SidebarProps {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

function Sidebar({ sidebarOpen, setSidebarOpen }: SidebarProps) {
  const { session, profile, isAdmin, isActive } = useAuth();
  const canResolvePermissions = Boolean(
    session && profile?.isActive && isActive && !isAdmin,
  );
  const permissionQueries = useQueries({
    queries: permissionNavigationItems.map(({ permission }) => ({
      queryKey: permissionQueryKey(
        session?.user.id,
        profile?.id,
        permission,
      ),
      queryFn: () => hasPermission(permission),
      enabled: canResolvePermissions,
      staleTime: 60_000,
    })),
  });
  const isAuthenticatedActive = Boolean(
    session && profile?.isActive && isActive,
  );
  const permissionResults = new Map(
    permissionNavigationItems.map(({ permission }, index) => [
      permission,
      permissionQueries[index]?.data,
    ]),
  );
  const procurementPermission = permissionResults.get("procurement.view");
  const canReadProcurement = Boolean(
    isAuthenticatedActive &&
      (isAdmin || (procurementPermission?.ok && procurementPermission.value)),
  );
  const procurementBadgeQuery = useProcurementSidebarBadge(
    profile?.id,
    canReadProcurement,
  );
  const procurementBadgeCount =
    canReadProcurement && procurementBadgeQuery.data?.ok
      ? procurementBadgeQuery.data.value
      : null;
  const visibleNavigation = NAVIGATION.filter((item) => {
    if (!isAuthenticatedActive) {
      return false;
    }

    if (isAdmin) {
      return true;
    }

    if (item.access.kind === "authenticated") {
      return true;
    }

    if (item.access.kind === "admin") {
      return false;
    }

    const result = permissionResults.get(item.access.permission);

    return result?.ok === true && result.value;
  });

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`
          fixed left-0 top-0 z-50 h-screen w-72 bg-[#202225] text-white
          transition-transform duration-300
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
lg:relative lg:h-screen lg:translate-x-0        `}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-6">
          <div>
            <h1 className="text-2xl font-bold tracking-wide text-red-600">
              ALFAEV
            </h1>

            <p className="mt-1 text-sm text-zinc-400">
              Project & Production Hub
            </p>
          </div>

          <button onClick={() => setSidebarOpen(false)} className="lg:hidden">
            <X size={22} />
          </button>
        </div>

        <nav className="p-4">
          {visibleNavigation.map(({ label, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `mb-1 flex w-full items-center gap-3 rounded-xl px-4 py-3 transition ${
                  isActive
                    ? "bg-red-600 text-white"
                    : "text-zinc-300 hover:bg-white/5"
                }`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
              {path === "/procurement" && procurementBadgeCount !== null && (
                <span
                  aria-label={`${procurementBadgeCount} unresolved Procurement requests`}
                  className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold tabular-nums text-white"
                >
                  {procurementBadgeCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}

export default Sidebar;
