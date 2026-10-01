import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../auth/permissionService", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("../../features/archive/ArchivePage", () => ({
  default: () => <h1>Archive route content</h1>,
}));

import AppRouter from "./AppRouter";

function authState(isAdmin = false) {
  return {
    session: { user: { id: "auth-user-1" } },
    profile: { id: "profile-1", isActive: true, isAdmin },
    isAdmin,
    isActive: true,
    isLoading: false,
    error: null,
  };
}

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/archive"]}>
        <AppRouter />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue(authState());
  mocks.hasPermission.mockResolvedValue({ ok: true, value: true });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Archive route", () => {
  it("allows an active Admin through the normal permission-route bypass", () => {
    mocks.useAuth.mockReturnValue(authState(true));
    renderRoute();
    expect(screen.getByRole("heading", { name: "Archive route content" }))
      .toBeInTheDocument();
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });

  it("allows an active archive.view non-admin", async () => {
    renderRoute();
    expect(await screen.findByRole("heading", { name: "Archive route content" }))
      .toBeInTheDocument();
    expect(mocks.hasPermission).toHaveBeenCalledWith("archive.view");
  });

  it.each([
    ["unpermitted", { ok: true, value: false }],
    ["zero-permission", { ok: true, value: false }],
  ])("denies an active %s non-admin", async (_label, result) => {
    mocks.hasPermission.mockResolvedValue(result);
    renderRoute();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Access denied"));
    expect(screen.queryByText("Archive route content")).not.toBeInTheDocument();
  });
});
