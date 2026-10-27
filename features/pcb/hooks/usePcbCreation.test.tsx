import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), hasPermission: vi.fn(), createPcbCard: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("../services/pcbService", () => ({ createPcbCard: mocks.createPcbCard }));

import { usePcbCreation } from "./usePcbCreation";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(usePcbCreation, { wrapper }), client };
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ session: { user: { id: "auth-1" } }, profile: { id: "profile-1", isActive: true }, isAdmin: false });
  mocks.hasPermission.mockResolvedValue({ ok: true, value: false });
  mocks.createPcbCard.mockResolvedValue({ ok: true, value: { pcbCardId: "card", productId: "product", serialNumber: "0000001" } });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("PCB creation permission and cache", () => {
  it("allows Admin without a permission RPC", () => {
    mocks.useAuth.mockReturnValue({ session: { user: { id: "admin" } }, profile: { id: "admin-profile", isActive: true }, isAdmin: true });
    const { result } = setup();
    expect(result.current.canCreate).toBe(true);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });

  it("fails closed until pcb.create resolves and on error", async () => {
    mocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    const allowed = setup();
    expect(allowed.result.current.canCreate).toBe(false);
    await waitFor(() => expect(allowed.result.current.canCreate).toBe(true));
    expect(mocks.hasPermission).toHaveBeenCalledWith("pcb.create");
    allowed.unmount();
    mocks.hasPermission.mockResolvedValue({ ok: false, error: { message: "safe" } });
    const failed = setup();
    await waitFor(() => expect(mocks.hasPermission).toHaveBeenCalled());
    expect(failed.result.current.canCreate).toBe(false);
  });

  it("invalidates PCB list and affected Product caches only after success", async () => {
    const { result, client } = setup();
    const pcbKey = ["pcb", "cards", "profile-1"];
    const productKey = ["inventory", "products", "profile-1", ""];
    const commitmentKey = ["inventory", "commitments", "profile-1"];
    const fgKey=[...commitmentKey,"warehouse","finished_goods"];
    const foreign=["inventory","commitments","profile-2","warehouse","finished_goods"];
    for (const key of [pcbKey, productKey, commitmentKey, fgKey, foreign]) client.setQueryData(key, "cached");
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await act(async () => { await result.current.create("Card", "007"); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: pcbKey, exact: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["inventory", "products", "profile-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: commitmentKey });
    expect(client.getQueryState(fgKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(foreign)?.isInvalidated).toBe(false);
    invalidate.mockClear();
    mocks.createPcbCard.mockResolvedValue({ ok: false, error: { code: "pcb_create_failed", message: "Failed" } });
    await act(async () => { await result.current.create("Card", "007"); });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
