import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), hasPermission: vi.fn(), signOut: vi.fn() }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../auth/permissionService", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("../auth/authService", () => ({ signOut: mocks.signOut }));
vi.mock("../../features/pcb/PcbProductionPrecheckPage", () => ({ default: () => <h1>PCB precheck route</h1> }));
import AppRouter from "./AppRouter";

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter
    initialEntries={["/pcb/11111111-1111-4111-8111-111111111111/produce"]}>
    <AppRouter />
  </MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  mocks.useAuth.mockReturnValue({ session: { user: { id: "actor" } },
    profile: { id: "profile", isActive: true }, isAdmin: false, isLoading: false, error: null });
  mocks.hasPermission.mockResolvedValue({ ok: true, value: true });
  mocks.signOut.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("PCB production route", () => {
  it("allows an active Admin without another permission lookup", async () => {
    mocks.useAuth.mockReturnValue({ session: { user: { id: "actor" } },
      profile: { id: "profile", isActive: true }, isAdmin: true, isLoading: false, error: null });
    show();
    expect(await screen.findByText("PCB precheck route")).toBeInTheDocument();
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });

  it("allows pcb.produce without requiring PCB, Project, or Inventory read permissions", async () => {
    show();
    expect(await screen.findByText("PCB precheck route")).toBeInTheDocument();
    expect(mocks.hasPermission).toHaveBeenCalledWith("pcb.produce");
    expect(mocks.hasPermission).toHaveBeenCalledTimes(1);
  });

  it.each(["pcb.view", "pcb.edit", "projects.view", "inventory.view", "unrelated"])(
    "does not accept %s in place of pcb.produce", async () => {
      mocks.hasPermission.mockResolvedValue({ ok: true, value: false });
      show();
      expect(await screen.findByText("Access denied")).toBeInTheDocument();
      expect(screen.queryByText("PCB precheck route")).not.toBeInTheDocument();
      expect(mocks.hasPermission).toHaveBeenCalledWith("pcb.produce");
    },
  );

  it("denies an inactive actor through the existing AuthGuard", async () => {
    mocks.useAuth.mockReturnValue({ session: { user: { id: "actor" } },
      profile: { id: "profile", isActive: false }, isAdmin: false, isLoading: false, error: null });
    show();
    expect(screen.queryByText("PCB precheck route")).not.toBeInTheDocument();
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });
});
