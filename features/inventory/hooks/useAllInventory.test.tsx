import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), products: vi.fn(), commitments: vi.fn(), tests: vi.fn(), health: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.auth }));
vi.mock("../services/productService", () => ({ listCompleteWarehouseProducts: mocks.products }));
vi.mock("./useInventoryCommitments", () => ({ useInventoryCommitments: mocks.commitments }));
vi.mock("./useInventoryTestCommitments", () => ({ useInventoryTestCommitments: mocks.tests }));
vi.mock("./useInventoryStockHealth", () => ({ useInventoryStockHealth: mocks.health }));
vi.mock("../../../app/config/inventoryStockHealthActivation", () => ({ isInventoryStockHealthEnabled: () => true }));
import { useAllInventory } from "./useAllInventory";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";
import { productListQueryPrefix } from "../productQueryKeys";
const ids = INVENTORY_WAREHOUSES.map(w => w.id);
const auth = { session: { user: { id: "actor" }, access_token: "memory-token" }, profile: { id: "profile", authUserId: "actor", isActive: true }, isActive: true, isLoading: false, error: null };
function context() { const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }; }
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockReturnValue(auth);
  mocks.products.mockImplementation(async (id: string) => ({ ok: true, value: [{ id: id === ids[1] ? "output" : "component", name: "Part", serialNumber: "0000001", category: "Part", brandName: null, productKind: id === ids[1] ? "pcb_finished_good" : "component", isActive: true, quantity: 0 }] }));
  mocks.commitments.mockReturnValue({ data: { ok: true, value: [] }, isFetching: false, refetch: vi.fn() });
  mocks.tests.mockImplementation((_w, _s, allowed) => ({ allowed, rows: undefined, query: { refetch: vi.fn() } }));
  mocks.health.mockImplementation((_w, _s, _f, allowed) => ({ allowed, rows: undefined, query: { refetch: vi.fn() } }));
});
afterEach(cleanup);
describe("authorized All Inventory composition", () => {
  it("preserves canonical R/F/C membership, zero FG outputs and duplicate Product/warehouse pairs", async () => {
    const ctx = context(), r = renderHook(() => useAllInventory(ids, "", "all", true), ctx);
    await waitFor(() => expect(r.result.current.rows).toHaveLength(3));
    expect(r.result.current.rows.map(row => [row.warehouse.code, row.product.id])).toEqual([["raw_materials", "component"], ["finished_goods", "output"], ["customs", "component"]]);
    expect(mocks.products).toHaveBeenCalledTimes(3);
    expect(r.result.current.healthReady).toBe(false);
    r.unmount(); ctx.client.clear();
  });
  it("never fetches denied warehouses or Raw combined data without Customs permission", async () => {
    const ctx = context(), r = renderHook(() => useAllInventory([ids[0]!], "literal%", "all", true), ctx);
    await waitFor(() => expect(r.result.current.rows).toHaveLength(1));
    expect(mocks.products).toHaveBeenCalledExactlyOnceWith(ids[0], "literal%", "memory-token", expect.any(AbortSignal));
    expect(mocks.commitments).toHaveBeenCalledWith(false, "raw_materials"); expect(mocks.commitments).toHaveBeenCalledWith(false, "finished_goods");
    for (const id of ids) expect(mocks.tests).toHaveBeenCalledWith(id, "literal%", false, true);
    expect(r.result.current.rows[0]?.commitment).toBeUndefined();
    r.unmount(); ctx.client.clear();
  });
  it("requests only the selected authorized warehouse", async () => {
    const ctx = context(), r = renderHook(() => useAllInventory(ids, "EK", "finished_goods", false), ctx);
    await waitFor(() => expect(r.result.current.rows).toHaveLength(1));
    expect(mocks.products).toHaveBeenCalledExactlyOnceWith(ids[1], "EK", "memory-token", expect.any(AbortSignal));
    expect(mocks.tests).toHaveBeenCalledWith(ids[1], "EK", true, false);
    r.unmount(); ctx.client.clear();
  });
  it.each([{ isActive: false }, { error: "failed" }, { profile: { ...auth.profile, authUserId: "other" } }])("fails closed on invalid identity %j", async patch => {
    mocks.auth.mockReturnValue({ ...auth, ...patch }); const ctx = context();
    const r = renderHook(() => useAllInventory(ids, "", "all", true), ctx);
    expect(r.result.current.active).toBe(false); expect(mocks.products).not.toHaveBeenCalled();
    r.unmount(); ctx.client.clear();
  });
  it("hides the entire result if one authorized warehouse cannot establish completeness", async () => {
    mocks.products.mockResolvedValue({ ok: false, error: { message: "Incomplete warehouse" } });
    const ctx = context(), r = renderHook(() => useAllInventory(ids, "", "all", true), ctx);
    await waitFor(() => expect(r.result.current.failure).toBe("Incomplete warehouse")); expect(r.result.current.rows).toEqual([]);
    r.unmount(); ctx.client.clear();
  });
  it("uses existing profile invalidation prefixes without touching a different identity", async () => {
    const ctx = context(), r = renderHook(() => useAllInventory([ids[1]!], "", "all", false), ctx);
    await waitFor(() => expect(r.result.current.rows).toHaveLength(1));
    ctx.client.setQueryData([...productListQueryPrefix("other"), "all-view", "actor-2"], "private");
    await act(async () => { await ctx.client.invalidateQueries({ queryKey: productListQueryPrefix("profile") }); });
    expect(mocks.products).toHaveBeenCalledTimes(2);
    expect(ctx.client.getQueryState([...productListQueryPrefix("other"), "all-view", "actor-2"])?.isInvalidated).toBe(false);
    r.unmount(); ctx.client.clear();
  });
  it("does not expose an old account's late response after an identity switch", async () => {
    let finish!: (value: unknown) => void; mocks.products.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const ctx = context(), r = renderHook(() => useAllInventory([ids[1]!], "", "all", false), ctx);
    mocks.auth.mockReturnValue({ ...auth, session: { ...auth.session, user: { id: "actor-2" } }, profile: { ...auth.profile, id: "profile-2", authUserId: "actor-2" } }); r.rerender();
    await act(async () => { finish({ ok: true, value: [{ id: "private-old" }] }); });
    await waitFor(() => expect(r.result.current.rows[0]?.product.id).toBe("output"));
    expect(r.result.current.rows.some(row => row.product.id === "private-old")).toBe(false);
    r.unmount(); ctx.client.clear();
  });
});
