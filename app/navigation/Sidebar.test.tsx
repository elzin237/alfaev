import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const sidebarMocks = vi.hoisted(() => ({
  activeTracking: false,
  hasPermission: vi.fn(),
  useProjectAlertUnreadCount: vi.fn(),
  useProcurementSidebarBadge: vi.fn(),
  useAuth: vi.fn(),
}));
vi.mock("../config/workOrderActiveShortagesActivation", () => ({
  isWorkOrderActiveShortagesEnabled: () => sidebarMocks.activeTracking,
}));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: sidebarMocks.useAuth,
}));
vi.mock("../auth/permissionService", () => ({
  hasPermission: sidebarMocks.hasPermission,
}));
vi.mock("../../features/procurement/hooks/useProcurementSidebarBadge", () => ({
  useProcurementSidebarBadge: sidebarMocks.useProcurementSidebarBadge,
}));
vi.mock("../../features/dashboard/hooks/useProjectAlerts", () => ({
  useProjectAlertUnreadCount: sidebarMocks.useProjectAlertUnreadCount,
}));

import Sidebar from "./Sidebar";
import type { AuthState } from "../auth/AuthProvider";
import type { PermissionServiceResult } from "../auth/permissionService";
import type { UserProfile } from "../auth/profileService";

const firstUser: User = {
  id: "00000000-0000-0000-0000-000000000001",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-09-07T00:00:00.000Z",
};

function createSession(user: User): Session {
  return {
    access_token: `sidebar-access-${user.id}`,
    token_type: "bearer",
    expires_in: 3_600,
    refresh_token: `sidebar-refresh-${user.id}`,
    user,
  };
}

function createProfile(user: User): UserProfile {
  return {
    id: `profile-${user.id}`,
    authUserId: user.id,
    fullName: "Sidebar User",
    email: "sidebar@example.com",
    birthday: "1990-01-01",
    isAdmin: false,
    isActive: true,
    createdAt: "2026-09-07T00:00:00.000Z",
    lastLoginAt: null,
  };
}

function createAuthState(
  overrides: Partial<AuthState> = {},
): AuthState {
  return {
    session: createSession(firstUser),
    profile: createProfile(firstUser),
    isAdmin: false,
    isActive: true,
    isLoading: false,
    error: null,
    ...overrides,
  };
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderSidebar(
  setSidebarOpen = vi.fn(),
  queryClient = createQueryClient(),
  sidebarOpen = true,
  returnFocusRef = createRef<HTMLButtonElement>(),
) {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Sidebar
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          returnFocusRef={returnFocusRef}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...view, queryClient, returnFocusRef, setSidebarOpen };
}

beforeEach(() => {
  sidebarMocks.activeTracking = false;
  sidebarMocks.useAuth.mockReturnValue(createAuthState());
  sidebarMocks.useProcurementSidebarBadge.mockReturnValue({ data: undefined });
  sidebarMocks.useProjectAlertUnreadCount.mockReturnValue({
    access: {
      profileId: createProfile(firstUser).id,
      canRead: false,
      permissionsPending: false,
    },
    unreadCountQuery: {
      data: undefined,
      isError: false,
    },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("WO-10 shared Dashboard badge", () => {
  beforeEach(() => {
    sidebarMocks.activeTracking = true;
    sidebarMocks.useAuth.mockReturnValue(createAuthState({
      profile: { ...createProfile(firstUser), isAdmin: true }, isAdmin: true,
    }));
  });

  function counts(active: bigint, projects: bigint | undefined, state: {
    isError?: boolean; isPending?: boolean; isFetching?: boolean;
    canRead?: boolean; permissionsPending?: boolean;
  } = {}) {
    sidebarMocks.useProjectAlertUnreadCount.mockReturnValue({
      access: { profileId: createProfile(firstUser).id, canRead: state.canRead ?? true,
        permissionsPending: state.permissionsPending ?? false },
      unreadCountQuery: {
        data: { exactValue: active, projectUnread: projects, displayValue: active.toString(), hasUnread: active > 0n },
        isError: state.isError ?? false, isPending: state.isPending ?? false, isFetching: state.isFetching ?? false,
      },
    });
  }

  it("uses the combined count through Project reads, active shortage reads, resolution and zero", () => {
    counts(1n, 2n);
    const view = renderSidebar();
    expect(screen.getByLabelText("3 combined alerts")).toHaveTextContent("3");
    const rerender = () => view.rerender(
      <QueryClientProvider client={view.queryClient}><MemoryRouter>
        <Sidebar sidebarOpen={true} setSidebarOpen={vi.fn()} />
      </MemoryRouter></QueryClientProvider>,
    );
    counts(1n, 1n); rerender();
    expect(screen.getByLabelText("2 combined alerts")).toHaveTextContent("2");
    counts(1n, 1n); rerender(); // Reading an active shortage does not resolve it.
    expect(screen.getByLabelText("2 combined alerts")).toHaveTextContent("2");
    counts(0n, 1n); rerender();
    expect(screen.getByLabelText("1 combined alert")).toHaveTextContent("1");
    counts(0n, 0n); rerender();
    expect(screen.queryByLabelText(/combined alerts/)).not.toBeInTheDocument();
  });

  it.each([
    { isError: true }, { isPending: true }, { isFetching: true },
    { canRead: false }, { permissionsPending: true },
  ])("hides the badge rather than showing a stale/fabricated value: %j", (state) => {
    counts(1n, 2n, state); renderSidebar();
    expect(screen.queryByLabelText(/combined alerts/)).not.toBeInTheDocument();
  });

  it("requires both counts and preserves exact bigint overflow", () => {
    counts(1n, undefined);
    const view = renderSidebar();
    expect(screen.queryByLabelText(/combined alerts/)).not.toBeInTheDocument();
    counts(9007199254740993n, 2n);
    view.rerender(<QueryClientProvider client={view.queryClient}><MemoryRouter>
      <Sidebar sidebarOpen={true} setSidebarOpen={vi.fn()} />
    </MemoryRouter></QueryClientProvider>);
    expect(screen.getByLabelText("9007199254740995 combined alerts")).toHaveTextContent("99+");
  });

  it("counts unread Projects even when there are no active Work Order shortages", () => {
    counts(0n, 2n); renderSidebar();
    expect(screen.getByLabelText("2 combined alerts")).toHaveTextContent("2");
  });
});

describe("Sidebar permission visibility", () => {
  it("fills the dynamic viewport and keeps its own navigation scroll", () => {
    renderSidebar();

    expect(document.querySelector("#app-sidebar")).toHaveClass(
      "h-dvh",
      "overflow-y-auto",
      "lg:sticky",
      "lg:h-dvh",
      "lg:shrink-0",
    );
  });

  it("shows the 12 canonical items to an active Admin in order", () => {
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        profile: { ...createProfile(firstUser), isAdmin: true },
        isAdmin: true,
      }),
    );

    renderSidebar();

    expect(screen.getAllByRole("link").map((link) => link.textContent))
      .toEqual([
        "Dashboard",
        "Projects",
        "Procurement",
        "Suppliers",
        "Inventory",
        "Product Calculator",
        "Work Orders",
        "Documentation",
        "Fixed Assets",
        "Calendar",
        "Archive",
        "Users",
      ]);
    expect(sidebarMocks.hasPermission).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Product Calculator" })).toHaveAttribute("href", "/pcb");
    expect(screen.queryByRole("link", { name: "Finished Product Calculator" })).not.toBeInTheDocument();
  });

  it("shows Calendar to an active non-admin without a Calendar permission check", () => {
    sidebarMocks.hasPermission.mockReturnValue(
      new Promise<PermissionServiceResult>(() => undefined),
    );

    renderSidebar();

    expect(screen.getByRole("link", { name: "Calendar" }))
      .toBeInTheDocument();
    expect(sidebarMocks.hasPermission).not.toHaveBeenCalledWith(
      "calendar.view",
    );
    expect(screen.queryByRole("link", { name: "Users" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Documentation" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Fixed Assets" }))
      .not.toBeInTheDocument();
  });

  it("shows only granted permission-controlled modules to a non-admin", async () => {
    sidebarMocks.hasPermission.mockImplementation(
      async (permission: string): Promise<PermissionServiceResult> => ({
        ok: true,
        value: permission === "projects.view",
      }),
    );

    renderSidebar();

    expect(await screen.findByRole("link", { name: "Projects" }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Calendar" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Dashboard" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" }))
      .not.toBeInTheDocument();
  });

  it("shows Archive only to an active non-admin with archive.view", async () => {
    sidebarMocks.hasPermission.mockImplementation(
      async (permission: string): Promise<PermissionServiceResult> => ({
        ok: true,
        value: permission === "archive.view",
      }),
    );

    renderSidebar();

    expect(await screen.findByRole("link", { name: "Archive" }))
      .toHaveAttribute("href", "/archive");
    expect(screen.getByRole("link", { name: "Calendar" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Projects" })).not.toBeInTheDocument();
  });

  it("does not expose ungranted links after permission checks resolve", async () => {
    sidebarMocks.hasPermission.mockResolvedValue({ ok: true, value: false });

    renderSidebar();

    await waitFor(() => {
      expect(sidebarMocks.hasPermission).toHaveBeenCalledTimes(10);
    });
    expect(screen.getAllByRole("link").map((link) => link.textContent))
      .toEqual(["Calendar"]);
  });

  it("does not expose permission-controlled links while checks are unresolved", () => {
    sidebarMocks.hasPermission.mockReturnValue(
      new Promise<PermissionServiceResult>(() => undefined),
    );

    renderSidebar();

    expect(screen.getAllByRole("link").map((link) => link.textContent))
      .toEqual(["Calendar"]);
  });

  it("fails closed per item when the permission service fails", async () => {
    sidebarMocks.hasPermission.mockResolvedValue({
      ok: false,
      error: {
        code: "permission_check_failed",
        message: "Your access could not be verified.",
      },
    });

    renderSidebar();

    await waitFor(() => {
      expect(sidebarMocks.hasPermission).toHaveBeenCalledTimes(10);
    });
    expect(screen.getAllByRole("link").map((link) => link.textContent))
      .toEqual(["Calendar"]);
  });

  it("fetches and displays the Procurement badge only after view access resolves", async () => {
    sidebarMocks.hasPermission.mockImplementation(
      async (permission: string): Promise<PermissionServiceResult> => ({
        ok: true,
        value: permission === "procurement.view",
      }),
    );
    sidebarMocks.useProcurementSidebarBadge.mockReturnValue({
      data: { ok: true, value: 5 },
    });

    renderSidebar();

    expect(await screen.findByRole("link", { name: /Procurement/ }))
      .toBeInTheDocument();
    await waitFor(() => expect(
      sidebarMocks.useProcurementSidebarBadge,
    ).toHaveBeenLastCalledWith(createProfile(firstUser).id, true));
    expect(screen.getByLabelText("5 unresolved Procurement requests"))
      .toHaveTextContent("5");
  });

  it.each([
    ["1", 1n, "alert"],
    ["99", 99n, "alerts"],
    ["99+", 100n, "alerts"],
  ])("shows %s unread Project alerts beside Dashboard", (
    displayValue,
    exactValue,
    noun,
  ) => {
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        profile: { ...createProfile(firstUser), isAdmin: true },
        isAdmin: true,
      }),
    );
    sidebarMocks.useProjectAlertUnreadCount.mockReturnValue({
      access: {
        profileId: createProfile(firstUser).id,
        canRead: true,
        permissionsPending: false,
      },
      unreadCountQuery: {
        data: { exactValue, displayValue, hasUnread: true },
        isError: false,
      },
    });

    renderSidebar();

    expect(screen.getByLabelText(`${displayValue} unread Project ${noun}`))
      .toHaveTextContent(displayValue);
    expect(screen.getByText("Dashboard").closest("a"))
      .toHaveAttribute("href", "/");
  });

  it("mounts the existing unread-count hook outside Dashboard and hides zero", () => {
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        profile: { ...createProfile(firstUser), isAdmin: true },
        isAdmin: true,
      }),
    );
    sidebarMocks.useProjectAlertUnreadCount.mockReturnValue({
      access: {
        profileId: createProfile(firstUser).id,
        canRead: true,
        permissionsPending: false,
      },
      unreadCountQuery: {
        data: { exactValue: 0n, displayValue: "0", hasUnread: false },
        isError: false,
      },
    });

    renderSidebar();

    expect(sidebarMocks.useProjectAlertUnreadCount).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Dashboard" }))
      .toHaveAttribute("href", "/");
    expect(screen.queryByLabelText(/unread Project alerts/)).not.toBeInTheDocument();
  });

  it.each([
    ["permission denial", false, false],
    ["network error", true, true],
  ])("hides the Dashboard badge on %s", (_label, canRead, isError) => {
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        profile: { ...createProfile(firstUser), isAdmin: true },
        isAdmin: true,
      }),
    );
    sidebarMocks.useProjectAlertUnreadCount.mockReturnValue({
      access: {
        profileId: createProfile(firstUser).id,
        canRead,
        permissionsPending: false,
      },
      unreadCountQuery: {
        data: { exactValue: 8n, displayValue: "8", hasUnread: true },
        isError,
      },
    });

    renderSidebar();

    expect(screen.queryByLabelText(/unread Project alerts/)).not.toBeInTheDocument();
  });

  it("removes the previous profile badge immediately on profile switch", () => {
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        profile: { ...createProfile(firstUser), isAdmin: true },
        isAdmin: true,
      }),
    );
    sidebarMocks.useProjectAlertUnreadCount.mockReturnValue({
      access: {
        profileId: createProfile(firstUser).id,
        canRead: true,
        permissionsPending: false,
      },
      unreadCountQuery: {
        data: { exactValue: 7n, displayValue: "7", hasUnread: true },
        isError: false,
      },
    });
    const rendered = renderSidebar();
    expect(screen.getByLabelText("7 unread Project alerts")).toBeInTheDocument();

    const secondUser: User = { ...firstUser, id: "00000000-0000-0000-0000-000000000002" };
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        session: createSession(secondUser),
        profile: { ...createProfile(secondUser), isAdmin: true },
        isAdmin: true,
      }),
    );
    sidebarMocks.useProjectAlertUnreadCount.mockReturnValue({
      access: {
        profileId: createProfile(secondUser).id,
        canRead: true,
        permissionsPending: false,
      },
      unreadCountQuery: {
        data: undefined,
        isError: false,
      },
    });
    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <MemoryRouter>
          <Sidebar sidebarOpen={true} setSidebarOpen={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.queryByLabelText("7 unread Project alerts")).not.toBeInTheDocument();
  });

  it("hides the Dashboard badge for an inactive profile", () => {
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        profile: { ...createProfile(firstUser), isActive: false, isAdmin: true },
        isAdmin: true,
        isActive: false,
      }),
    );
    sidebarMocks.useProjectAlertUnreadCount.mockReturnValue({
      access: {
        profileId: null,
        canRead: false,
        permissionsPending: false,
      },
      unreadCountQuery: {
        data: { exactValue: 3n, displayValue: "3", hasUnread: true },
        isError: false,
      },
    });

    renderSidebar();

    expect(screen.queryByLabelText(/unread Project alerts/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("keeps the Procurement badge styling and navigation unchanged", () => {
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        profile: { ...createProfile(firstUser), isAdmin: true },
        isAdmin: true,
      }),
    );
    sidebarMocks.useProcurementSidebarBadge.mockReturnValue({
      data: { ok: true, value: 5 },
    });
    sidebarMocks.useProjectAlertUnreadCount.mockReturnValue({
      access: {
        profileId: createProfile(firstUser).id,
        canRead: true,
        permissionsPending: false,
      },
      unreadCountQuery: {
        data: { exactValue: 2n, displayValue: "2", hasUnread: true },
        isError: false,
      },
    });

    renderSidebar();

    const dashboardBadge = screen.getByLabelText("2 unread Project alerts");
    const procurementBadge = screen.getByLabelText("5 unresolved Procurement requests");
    expect(dashboardBadge.className).toBe(procurementBadge.className);
    expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /Procurement/ })).toHaveAttribute(
      "href",
      "/procurement",
    );
  });

  it("renders a zero badge and fails safely when the badge query fails", () => {
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        profile: { ...createProfile(firstUser), isAdmin: true },
        isAdmin: true,
      }),
    );
    sidebarMocks.useProcurementSidebarBadge.mockReturnValue({
      data: { ok: true, value: 0 },
    });
    const rendered = renderSidebar();

    expect(screen.getByLabelText("0 unresolved Procurement requests"))
      .toHaveTextContent("0");

    sidebarMocks.useProcurementSidebarBadge.mockReturnValue({
      data: {
        ok: false,
        error: {
          code: "procurement_badge_failed",
          message: "The Procurement count could not be loaded.",
        },
      },
    });
    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <MemoryRouter>
          <Sidebar sidebarOpen={true} setSidebarOpen={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("link", { name: "Procurement" }))
      .toBeInTheDocument();
    expect(screen.queryByLabelText(/unresolved Procurement requests/))
      .not.toBeInTheDocument();
  });

  it("does not enable the protected badge query for an unauthorized user", async () => {
    sidebarMocks.hasPermission.mockResolvedValue({ ok: true, value: false });

    renderSidebar();

    await waitFor(() => expect(sidebarMocks.hasPermission).toHaveBeenCalledTimes(10));
    expect(sidebarMocks.useProcurementSidebarBadge).toHaveBeenLastCalledWith(
      createProfile(firstUser).id,
      false,
    );
  });

  it("does not expose module links without active authenticated profile state", () => {
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        session: null,
        profile: null,
        isActive: false,
      }),
    );

    renderSidebar();

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(sidebarMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("isolates cached permissions by authenticated user and profile", async () => {
    let permissionAllowed = true;
    sidebarMocks.hasPermission.mockImplementation(
      async (permission: string): Promise<PermissionServiceResult> => ({
        ok: true,
        value: permissionAllowed && permission === "projects.view",
      }),
    );
    const queryClient = createQueryClient();
    const firstView = renderSidebar(vi.fn(), queryClient);

    expect(await screen.findByRole("link", { name: "Projects" }))
      .toBeInTheDocument();
    firstView.unmount();

    const secondUser: User = {
      ...firstUser,
      id: "00000000-0000-0000-0000-000000000002",
    };
    permissionAllowed = false;
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        session: createSession(secondUser),
        profile: createProfile(secondUser),
      }),
    );
    renderSidebar(vi.fn(), queryClient);

    await waitFor(() => {
      expect(sidebarMocks.hasPermission).toHaveBeenCalledTimes(20);
    });
    expect(screen.queryByRole("link", { name: "Projects" }))
      .not.toBeInTheDocument();
    expect(
      queryClient.getQueryData([
        "permission",
        secondUser.id,
        `profile-${secondUser.id}`,
        "projects.view",
      ]),
    ).toEqual({ ok: true, value: false });
  });

  it("refetches visible links after the current identity prefix is invalidated", async () => {
    let projectsAllowed = true;
    sidebarMocks.hasPermission.mockImplementation(
      async (permission: string): Promise<PermissionServiceResult> => ({
        ok: true,
        value: projectsAllowed && permission === "projects.view",
      }),
    );
    const queryClient = createQueryClient();
    renderSidebar(vi.fn(), queryClient);

    expect(await screen.findByRole("link", { name: "Projects" }))
      .toBeInTheDocument();
    projectsAllowed = false;

    await queryClient.invalidateQueries({
      queryKey: [
        "permission",
        firstUser.id,
        createProfile(firstUser).id,
      ],
    });

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Projects" }))
        .not.toBeInTheDocument();
    });
    expect(sidebarMocks.hasPermission).toHaveBeenCalledTimes(20);
  });

  it("preserves close-on-navigation behavior", () => {
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        profile: { ...createProfile(firstUser), isAdmin: true },
        isAdmin: true,
      }),
    );
    const setSidebarOpen = vi.fn();

    renderSidebar(setSidebarOpen);
    fireEvent.click(screen.getByRole("link", { name: "Projects" }));

    expect(setSidebarOpen).toHaveBeenCalledWith(false);
  });

  it("contains mobile focus, closes with Escape, and restores the menu trigger", async () => {
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        profile: { ...createProfile(firstUser), isAdmin: true },
        isAdmin: true,
      }),
    );
    const setSidebarOpen = vi.fn();
    const returnFocusRef = createRef<HTMLButtonElement>();
    const trigger = document.createElement("button");
    trigger.textContent = "Open navigation menu";
    document.body.append(trigger);
    returnFocusRef.current = trigger;
    trigger.focus();
    const rendered = renderSidebar(
      setSidebarOpen,
      createQueryClient(),
      true,
      returnFocusRef,
    );

    const sidebar = screen.getByRole("dialog", { name: "Navigation menu" });
    const close = within(sidebar).getByRole("button", {
      name: "Close navigation menu",
    });
    await waitFor(() => expect(close).toHaveFocus());
    expect(within(sidebar).getByRole("navigation", {
      name: "Primary navigation",
    })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(within(sidebar).getByRole("link", { name: "Users" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(setSidebarOpen).toHaveBeenCalledWith(false);

    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <MemoryRouter>
          <Sidebar
            sidebarOpen={false}
            setSidebarOpen={setSidebarOpen}
            returnFocusRef={returnFocusRef}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.querySelector("#app-sidebar")).toHaveAttribute("inert");
    trigger.remove();
  });
});
