import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const topbarMocks = vi.hoisted(() => ({
  auth: {
    session: { user: { id: "auth-user-1" } },
    profile: {
      id: "profile-1",
      fullName: "Ada Admin",
      isActive: true,
    },
    isAdmin: true,
    isActive: true,
  },
  clear: vi.fn(),
  navigate: vi.fn(),
  signOut: vi.fn(),
  permissionResult: { ok: true, value: true },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: topbarMocks.clear }),
  useQuery: () => ({ data: topbarMocks.permissionResult }),
}));
vi.mock("react-router", () => ({
  useNavigate: () => topbarMocks.navigate,
}));
vi.mock("../../app/auth/authService", () => ({
  signOut: topbarMocks.signOut,
}));
vi.mock("../../app/auth/AuthProvider", () => ({
  useAuth: () => topbarMocks.auth,
}));
vi.mock("./ProjectQuickSearch", () => ({
  default: ({ enabled }: { enabled: boolean }) => enabled
    ? <input aria-label="Search projects" />
    : null,
}));

import Topbar from "./Topbar";

beforeEach(() => {
  vi.resetAllMocks();
  topbarMocks.auth.session = { user: { id: "auth-user-1" } };
  topbarMocks.auth.profile = {
    id: "profile-1",
    fullName: "Ada Admin",
    isActive: true,
  };
  topbarMocks.auth.isAdmin = true;
  topbarMocks.auth.isActive = true;
  topbarMocks.permissionResult = { ok: true, value: true };
});

afterEach(() => {
  cleanup();
});

describe("Topbar", () => {
  it("renders the Dashboard heading", () => {
    const setSidebarOpen = vi.fn();

    render(<Topbar setSidebarOpen={setSidebarOpen} />);

    expect(
      screen.getByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
  });

  it("exposes mobile navigation state without dead notification or account buttons", () => {
    const setSidebarOpen = vi.fn();
    render(<Topbar sidebarOpen={false} setSidebarOpen={setSidebarOpen} />);

    const menuButton = screen.getByRole("button", {
      name: "Open navigation menu",
    });
    expect(menuButton).toHaveAttribute("aria-controls", "app-sidebar");
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Notifications" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "User account" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search projects" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Signed in as Ada Admin, Admin"))
      .toHaveTextContent("Ada Admin");

    fireEvent.click(menuButton);
    expect(setSidebarOpen).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("renders truthful non-clickable identity and permission-aware Project search", () => {
    topbarMocks.auth.profile = {
      id: "profile-2",
      fullName: "Nina Worker",
      isActive: true,
    };
    topbarMocks.auth.isAdmin = false;
    topbarMocks.permissionResult = { ok: true, value: false };

    render(<Topbar setSidebarOpen={vi.fn()} />);

    const identity = screen.getByLabelText("Signed in as Nina Worker");
    expect(identity).toHaveTextContent("Nina Worker");
    expect(identity).not.toHaveTextContent("Admin");
    expect(screen.queryByRole("button", { name: /Nina Worker/i }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Search projects" }))
      .not.toBeInTheDocument();
  });

  it("signs out, clears protected query data, and redirects to login", async () => {
    topbarMocks.signOut.mockResolvedValue({ ok: true, value: undefined });

    render(<Topbar setSidebarOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Log Out" }));

    await waitFor(() => {
      expect(topbarMocks.signOut).toHaveBeenCalledOnce();
      expect(topbarMocks.clear).toHaveBeenCalledOnce();
      expect(topbarMocks.navigate).toHaveBeenCalledWith("/login", {
        replace: true,
      });
    });
  });

  it("blocks duplicate logout clicks while sign-out is pending", async () => {
    let resolveSignOut:
      | ((result: { ok: true; value: undefined }) => void)
      | undefined;
    topbarMocks.signOut.mockReturnValue(
      new Promise((resolve) => {
        resolveSignOut = resolve;
      }),
    );

    render(<Topbar setSidebarOpen={vi.fn()} />);
    const logoutButton = screen.getByRole("button", { name: "Log Out" });

    fireEvent.click(logoutButton);
    fireEvent.click(logoutButton);

    expect(topbarMocks.signOut).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Logging out..." }))
      .toBeDisabled();

    resolveSignOut?.({ ok: true, value: undefined });

    await waitFor(() => {
      expect(topbarMocks.clear).toHaveBeenCalledOnce();
      expect(topbarMocks.navigate).toHaveBeenCalledOnce();
    });
  });

  it("keeps the session context and cache in place when logout fails", async () => {
    topbarMocks.signOut.mockResolvedValue({
      ok: false,
      error: {
        code: "auth_request_failed",
        message: "The authentication request could not be completed.",
      },
    });

    render(<Topbar setSidebarOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Log Out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The authentication request could not be completed.",
    );
    expect(topbarMocks.clear).not.toHaveBeenCalled();
    expect(topbarMocks.navigate).not.toHaveBeenCalled();
  });
});
