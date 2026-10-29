import { useQueries } from "@tanstack/react-query";
import { NavLink } from "react-router";
import { X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { useAuth } from "../auth/AuthProvider";
import { hasPermission } from "../auth/permissionService";
import { permissionQueryKey } from "../auth/permissionQueryKeys";
import { useProjectAlertUnreadCount } from "../../features/dashboard/hooks/useProjectAlerts";
import { getDashboardAlertCount } from "../../features/dashboard/dashboardAlertCount";
import { isWorkOrderActiveShortagesEnabled } from "../config/workOrderActiveShortagesActivation";
import { useProcurementSidebarBadge } from "../../features/procurement/hooks/useProcurementSidebarBadge";
import { NAVIGATION } from "./navigation";
import type { PermissionKey } from "../auth/permissions";

const permissionNavigationItems = NAVIGATION.reduce<
  { permission: PermissionKey }[]
>((items, item) => {
  if (item.access.kind === "permission") {
    items.push({ permission: item.access.permission });
  } else if (item.access.kind === "any-permission") {
    items.push(...item.access.permissions.map((permission) => ({ permission })));
  }
  return items;
}, []);

interface SidebarProps {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
}

function Sidebar({
  sidebarOpen,
  setSidebarOpen,
  returnFocusRef,
}: SidebarProps) {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(min-width: 1024px)").matches
  );
  const sidebarRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(sidebarOpen);
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
  const projectAlertUnreadCount = useProjectAlertUnreadCount();
  const tracking = isWorkOrderActiveShortagesEnabled();
  const { badgeValue: dashboardAlertBadge, combinedCount } = getDashboardAlertCount(
    projectAlertUnreadCount.unreadCountQuery,
    tracking,
    projectAlertUnreadCount.access.canRead && !projectAlertUnreadCount.access.permissionsPending,
  );
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

    if (item.access.kind === "any-permission") {
      return item.access.permissions.some((permission) => {
        const result = permissionResults.get(permission);
        return result?.ok === true && result.value;
      });
    }

    const result = permissionResults.get(item.access.permission);

    return result?.ok === true && result.value;
  });
  const mobileSidebarActive = sidebarOpen && !isDesktop;

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (wasOpenRef.current && !sidebarOpen && !isDesktop) {
      returnFocusRef?.current?.focus();
    }
    wasOpenRef.current = sidebarOpen;
  }, [isDesktop, returnFocusRef, sidebarOpen]);

  useEffect(() => {
    if (!mobileSidebarActive) return;
    queueMicrotask(() => closeButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSidebarOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const controls = sidebarRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileSidebarActive, setSidebarOpen]);

  return (
    <>
      {sidebarOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        ref={sidebarRef}
        id="app-sidebar"
        role={mobileSidebarActive ? "dialog" : undefined}
        aria-modal={mobileSidebarActive ? "true" : undefined}
        aria-label={mobileSidebarActive ? "Navigation menu" : undefined}
        aria-hidden={!isDesktop && !sidebarOpen ? "true" : undefined}
        inert={!isDesktop && !sidebarOpen ? true : undefined}
        className={`
          fixed left-0 top-0 z-50 h-dvh w-72 overflow-y-auto bg-[#202225] text-white
          transition-transform duration-300
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          lg:sticky lg:top-0 lg:h-dvh lg:shrink-0 lg:translate-x-0
        `}
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

          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-2 lg:hidden"
          >
            <X size={22} />
          </button>
        </div>

        <nav aria-label="Primary navigation" className="p-4">
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
              {path === "/" && dashboardAlertBadge !== null && (
                <span
                  aria-label={tracking ? `${combinedCount?.toString()} combined alert${combinedCount === 1n ? "" : "s"}` : `${dashboardAlertBadge} unread Project ${
                    dashboardAlertBadge === "1" ? "alert" : "alerts"
                  }`}
                  className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold tabular-nums text-white"
                >
                  {dashboardAlertBadge}
                </span>
              )}
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
