import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const calendarRouteMocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  signOut: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: calendarRouteMocks.useAuth,
}));
vi.mock("../auth/authService", async (importOriginal) => ({
  ...await importOriginal<typeof import("../auth/authService")>(),
  signOut: calendarRouteMocks.signOut,
}));
vi.mock("../auth/permissionService", () => ({
  hasPermission: calendarRouteMocks.hasPermission,
}));
vi.mock("../../features/calendar/CalendarPage", () => ({
  default: () => <h1>Calendar route content</h1>,
}));

import AppRouter from "./AppRouter";

const activeProfile = {
  id: "00000000-0000-4000-8000-000000000001",
  isActive: true,
  isAdmin: false,
};
const session = { user: { id: "auth-user-1" } };

function setAuthState(options: {
  isActive: boolean;
  isAdmin?: boolean;
  session?: object | null;
}) {
  calendarRouteMocks.useAuth.mockReturnValue({
    session: options.session === undefined ? session : options.session,
    profile: options.session === null
      ? null
      : {
        ...activeProfile,
        isActive: options.isActive,
        isAdmin: options.isAdmin ?? false,
      },
    isAdmin: options.isAdmin ?? false,
    isActive: options.isActive,
    isLoading: false,
    error: null,
  });
}

function renderCalendarRoute() {
  return render(
    <MemoryRouter initialEntries={["/calendar"]}>
      <AppRouter />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setAuthState({ isActive: true });
  calendarRouteMocks.signOut.mockResolvedValue({ ok: true, value: undefined });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Calendar route", () => {
  it.each([
    ["active zero-permission non-admin", false],
    ["active Admin", true],
  ])("allows an %s without a delegable permission", (_label, isAdmin) => {
    setAuthState({ isActive: true, isAdmin });
    renderCalendarRoute();

    expect(screen.getByRole("heading", { name: "Calendar route content" }))
      .toBeInTheDocument();
    expect(calendarRouteMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("redirects an anonymous caller through the existing AuthGuard", () => {
    setAuthState({ isActive: false, session: null });
    renderCalendarRoute();

    expect(screen.getByRole("heading", { name: "Prijava u sistem" }))
      .toBeInTheDocument();
    expect(screen.queryByText("Calendar route content")).not.toBeInTheDocument();
  });

  it("blocks and signs out an inactive caller through the existing AuthGuard", async () => {
    setAuthState({ isActive: false, isAdmin: true });
    renderCalendarRoute();

    expect(await screen.findByRole("heading", { name: "Prijava u sistem" }))
      .toBeInTheDocument();
    expect(calendarRouteMocks.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByText("Calendar route content")).not.toBeInTheDocument();
  });
});
