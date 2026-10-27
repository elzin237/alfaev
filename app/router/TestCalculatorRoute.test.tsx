import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), hasPermission: vi.fn(), rpc: vi.fn() }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../auth/permissionService", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
// Retain closed-switch regression coverage independently of the authorized release.
vi.mock("../config/testCalculatorActivation", () => ({ isTestCalculatorEnabled: () => false }));
vi.mock("../guards/AuthGuard", () => ({ default: () => <Outlet /> }));
vi.mock("../guards/PermissionRoute", () => ({
  default: ({ permission }: { permission: string }) =>
    <div data-testid="permission-route" data-permission={permission}><Outlet /></div>,
}));
vi.mock("../../features/pcb/PcbPage", () => ({ default: () => <h1>Existing Normal Calculator</h1> }));
vi.mock("../../features/pcb/PcbDetailPage", () => ({ default: () => <h1>Existing PCB detail</h1> }));

import AppRouter from "./AppRouter";

const active = {
  session: { user: { id: "auth-a" } }, profile: { id: "profile-a", authUserId: "auth-a", isActive: true },
  isActive: true, isAdmin: false, isLoading: false, error: null,
};
const renderRoute = (path = "/pcb/test") => render(<MemoryRouter initialEntries={[path]}><AppRouter /></MemoryRouter>);
beforeEach(() => { mocks.useAuth.mockReturnValue(active); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("closed Test Calculator activation route", () => {
  it.each([false, true])("blocks Test access even when isAdmin=%s without querying undeployed permissions or RPCs", isAdmin => {
    mocks.useAuth.mockReturnValue({ ...active, isAdmin });
    renderRoute();
    expect(screen.getByRole("alert")).toHaveTextContent("Test Calculator is not activated");
    expect(screen.queryByRole("button", { name: "Create Test Calculation" })).not.toBeInTheDocument();
    expect(screen.queryByText("Existing PCB detail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("permission-route")).not.toBeInTheDocument();
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps loading closed", () => {
    mocks.useAuth.mockReturnValue({ ...active, isLoading: true }); renderRoute();
    expect(screen.getByRole("status")).toHaveTextContent("Checking your access");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
  it.each([
    { session: null }, { profile: null }, { isActive: false },
    { profile: { ...active.profile, isActive: false } },
    { profile: { ...active.profile, authUserId: "another-auth" } },
    { error: { code: "profile_load_failed", message: "Failed" } },
  ])("denies unverifiable or inactive identities: %j", override => {
    mocks.useAuth.mockReturnValue({ ...active, ...override }); renderRoute();
    expect(screen.getByRole("alert")).toHaveTextContent("Access denied");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps /pcb and existing definition routes under pcb.view", () => {
    const normal = renderRoute("/pcb");
    expect(screen.getByRole("heading", { name: "Existing Normal Calculator" })).toBeInTheDocument();
    expect(screen.getByTestId("permission-route")).toHaveAttribute("data-permission", "pcb.view");
    normal.unmount(); renderRoute("/pcb/11111111-1111-4111-8111-111111111111");
    expect(screen.getByRole("heading", { name: "Existing PCB detail" })).toBeInTheDocument();
    expect(screen.getByTestId("permission-route")).toHaveAttribute("data-permission", "pcb.view");
  });
});
