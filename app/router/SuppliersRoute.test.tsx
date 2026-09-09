import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const routeMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock("../auth/AuthProvider", () => ({ useAuth: routeMocks.useAuth }));
vi.mock("../auth/permissionService", () => ({
  hasPermission: routeMocks.hasPermission,
}));
vi.mock("../../features/suppliers/SuppliersPage", () => ({
  default: () => <h1>Suppliers route content</h1>,
}));

import AppRouter from "./AppRouter";

beforeEach(() => {
  routeMocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-user-1" } },
    profile: { id: "profile-1", isActive: true, isAdmin: false },
    isAdmin: false,
    isActive: true,
    isLoading: false,
    error: null,
  });
  routeMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Suppliers route", () => {
  it("wires /suppliers behind the canonical suppliers.view permission", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/suppliers"]}>
          <AppRouter />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Suppliers route content" }))
      .toBeInTheDocument();
    await waitFor(() => expect(routeMocks.hasPermission).toHaveBeenCalledWith(
      "suppliers.view",
    ));
  });

  it("does not add a Supplier detail route", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/suppliers/supplier-1"]}>
          <AppRouter />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Suppliers route content" }))
        .not.toBeInTheDocument();
    });
  });
});
