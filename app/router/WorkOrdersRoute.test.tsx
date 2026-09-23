import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const routeMocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../auth/AuthProvider", () => ({ useAuth: routeMocks.useAuth }));
vi.mock("../auth/permissionService", () => ({
  hasPermission: routeMocks.hasPermission,
}));
vi.mock("../../pages/work-orders/WorkOrdersPage", () => ({
  default: () => <h1>Work Orders route content</h1>,
}));
vi.mock("../../pages/work-orders/NewWorkOrderPage", () => ({
  default: () => <h1>New Work Order route content</h1>,
}));
vi.mock("../../pages/work-orders/WorkOrderDetailPage", () => ({
  default: () => <h1>Work Order detail route content</h1>,
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

describe("Work Orders route", () => {
  it("keeps /work-orders behind work_orders.view only", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/work-orders"]}>
          <AppRouter />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", {
      name: "Work Orders route content",
    })).toBeInTheDocument();
    await waitFor(() => expect(routeMocks.hasPermission).toHaveBeenCalledWith(
      "work_orders.view",
    ));
    expect(routeMocks.hasPermission).not.toHaveBeenCalledWith("projects.view");
  });

  it("protects /work-orders/new with work_orders.create and never projects.view", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/work-orders/new"]}>
          <AppRouter />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", {
      name: "New Work Order route content",
    })).toBeInTheDocument();
    await waitFor(() => expect(routeMocks.hasPermission).toHaveBeenCalledWith(
      "work_orders.create",
    ));
    expect(routeMocks.hasPermission).not.toHaveBeenCalledWith("projects.view");
  });

  it("keeps the Work Order detail route behind work_orders.view", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[
          "/work-orders/00000000-0000-4000-8000-000000000010",
        ]}>
          <AppRouter />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", {
      name: "Work Order detail route content",
    })).toBeInTheDocument();
    await waitFor(() => expect(routeMocks.hasPermission).toHaveBeenCalledWith(
      "work_orders.view",
    ));
    expect(routeMocks.hasPermission).not.toHaveBeenCalledWith("projects.view");
  });
});
