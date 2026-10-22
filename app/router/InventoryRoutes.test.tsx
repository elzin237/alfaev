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
vi.mock("../../features/inventory/InventoryPage", () => ({
  default: () => <h1>Inventory route content</h1>,
}));
vi.mock("../../features/inventory/ProductDetailPage", () => ({
  default: () => <h1>Product detail route content</h1>,
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

describe("Inventory routes", () => {
  it("wires Product detail behind any warehouse-view permission", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/inventory/product-1"]}>
          <AppRouter />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", {
      name: "Product detail route content",
    })).toBeInTheDocument();
    await waitFor(() => expect(routeMocks.hasPermission).toHaveBeenCalledWith(
      "inventory.raw_materials.view",
    ));
    expect(routeMocks.hasPermission).toHaveBeenCalledWith("inventory.finished_goods.view");
    expect(routeMocks.hasPermission).toHaveBeenCalledWith("inventory.customs.view");
  });
});
