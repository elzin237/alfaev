import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.auth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.permission }));
import { useTestCalculatorAccess } from "./useTestCalculatorAccess";
const auth = { session: { user: { id: "actor" }, access_token: "memory-token" }, profile: { id: "profile", authUserId: "actor", isActive: true }, isActive: true, isAdmin: false, isLoading: false, error: null };
function wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>; }
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockReturnValue(auth); mocks.permission.mockResolvedValue({ ok: true, value: false }); });
afterEach(cleanup);
describe("coordinated Test access", () => {
  it("does not query undeployed permissions behind the closed gate", async () => {
    const r = renderHook(() => useTestCalculatorAccess(false), { wrapper });
    await act(async () => {}); expect(mocks.permission).not.toHaveBeenCalled();
    expect(r.result.current).toMatchObject({ canView: false, canManage: false });
  });
  it("active Admin bypass still requires a verified identity", () => {
    mocks.auth.mockReturnValue({ ...auth, isAdmin: true });
    const r = renderHook(() => useTestCalculatorAccess(true), { wrapper });
    expect(r.result.current).toMatchObject({ canView: true, canManage: true }); expect(mocks.permission).not.toHaveBeenCalled();
    mocks.auth.mockReturnValue({ ...auth, isAdmin: true, profile: { ...auth.profile, authUserId: "other" } }); r.rerender();
    expect(r.result.current).toMatchObject({ canView: false, canManage: false });
  });
  it.each([[true, false], [true, true], [false, true], [false, false]])("view=%s/manage=%s never substitutes pcb.edit or manage for view", async (view, manage) => {
    mocks.permission.mockImplementation(async p => ({ ok: true, value: p === "test_calculator.view" ? view : manage }));
    const r = renderHook(() => useTestCalculatorAccess(true), { wrapper });
    await waitFor(() => expect(r.result.current.isLoading).toBe(false));
    expect(r.result.current.canView).toBe(view); expect(r.result.current.canManage).toBe(view && manage);
    expect(mocks.permission.mock.calls.map(c => c[0]).sort()).toEqual(["test_calculator.manage", "test_calculator.view"]);
  });
  it("denies inactive, missing-token and failed permission reads", async () => {
    mocks.permission.mockResolvedValue({ ok: false, error: { message: "Denied" } });
    const r = renderHook(() => useTestCalculatorAccess(true), { wrapper });
    await waitFor(() => expect(r.result.current.isLoading).toBe(false));
    expect(r.result.current.canView).toBe(false);
    mocks.auth.mockReturnValue({ ...auth, isAdmin: true, isActive: false }); r.rerender(); expect(r.result.current.canView).toBe(false);
    mocks.auth.mockReturnValue({ ...auth, isAdmin: true, session: { ...auth.session, access_token: "" } }); r.rerender(); expect(r.result.current.canManage).toBe(false);
  });
});
