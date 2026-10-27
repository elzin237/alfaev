import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.auth }));
vi.mock("../services/inventoryTestCommitmentService", async original => ({ ...await original<typeof import("../services/inventoryTestCommitmentService")>(), getInventoryTestCommitments: mocks.read }));
import { useInventoryTestCommitments } from "./useInventoryTestCommitments";
import { inventoryTestCommitmentsPrefix } from "../../test-calculator/services/testCalculationRecoveryStore";
import type { InventoryTestCommitment } from "../services/inventoryTestCommitmentService";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const raw = "10000000-0000-4000-8000-000000000001", fg = "10000000-0000-4000-8000-000000000002";
const auth = { session: { user: { id: id(1) }, access_token: "memory-token" }, profile: { id: id(2), authUserId: id(1), isActive: true }, isActive: true, isLoading: false, error: null };
const row: InventoryTestCommitment = { productId: id(3), warehouseId: raw, quantityScope: "raw_customs_planning", physicalQuantity: "20", projectCommitmentQuantity: "4", availableAfterProjects: "16", committedToTests: "3", availableAfterProjectsAndTests: "13", asOf: "2020-01-01T00:00:00Z", nextExpiry: "2020-01-02T00:00:00Z" };
function context() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockReturnValue(auth); mocks.read.mockResolvedValue({ ok: true, value: [row] }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("expiry-safe scoped Inventory Test reads", () => {
  it("default gate prevents reads even on manual refetch", async () => {
    const r = renderHook(() => useInventoryTestCommitments(raw, "", true), context());
    await act(async () => { await r.result.current.query.refetch(); });
    expect(mocks.read).not.toHaveBeenCalled(); expect(r.result.current.rows).toBeUndefined();
  });
  it.each([{ isActive: false }, { profile: null }, { session: null }, { error: "failed" },
    { profile: { ...auth.profile, authUserId: id(9) } }, { profile: { ...auth.profile, isActive: false } }])("rejects invalid identity %j", async patch => {
    mocks.auth.mockReturnValue({ ...auth, ...patch });
    const r = renderHook(() => useInventoryTestCommitments(raw, "", true, true), context());
    await act(async () => { await r.result.current.query.refetch(); });
    expect(mocks.read).not.toHaveBeenCalled(); expect(r.result.current.rows).toBeUndefined();
  });
  it("denied warehouse scope prevents even a forced read", async () => {
    const r = renderHook(() => useInventoryTestCommitments(raw, "", false, true), context());
    await act(async () => { await r.result.current.query.refetch(); }); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("uses Task 13's exact identity prefix and refreshes after its scoped invalidation", async () => {
    const ctx = context(), r = renderHook(() => useInventoryTestCommitments(raw, "resistor", true, true), ctx);
    await waitFor(() => expect(r.result.current.rows).toEqual([row]));
    const prefix = inventoryTestCommitmentsPrefix({ authUserId: id(1), profileId: id(2) });
    expect(ctx.client.getQueryCache().getAll()[0]!.queryKey).toEqual([...prefix, raw, "resistor", 0]);
    await act(async () => { await ctx.client.invalidateQueries({ queryKey: prefix }); });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.read).toHaveBeenCalledWith(raw, "resistor", "memory-token", expect.any(AbortSignal));
  });
  it("hides old values during retry and on network/permission errors", async () => {
    const r = renderHook(() => useInventoryTestCommitments(raw, "", true, true), context());
    await waitFor(() => expect(r.result.current.rows).toBeDefined());
    let finish!: (v: unknown) => void;
    mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    act(() => { void r.result.current.query.refetch(); });
    await waitFor(() => expect(r.result.current.rows).toBeUndefined());
    await act(async () => { finish({ ok: false, error: { code: "access_denied", message: "Denied" } }); });
    await waitFor(() => expect(r.result.current.query.data?.result.ok).toBe(false));
    expect(r.result.current.rows).toBeUndefined();
  });
  it("refreshes at server expiry, hides cached quantities and never invents zero on refresh failure", async () => {
    mocks.read.mockResolvedValueOnce({ ok: true, value: [{ ...row, nextExpiry: "2020-01-01T00:00:00.080000Z" }] })
      .mockResolvedValue({ ok: false, error: { code: "load_failed", message: "Unavailable" } });
    const r = renderHook(() => useInventoryTestCommitments(raw, "", true, true), context());
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    expect(r.result.current.rows).toBeUndefined();
  });
  it("refreshes after hidden/visible transition and suppresses data/requests in the hidden view", async () => {
    let hidden = false; vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    const r = renderHook(() => useInventoryTestCommitments(raw, "", true, true), context());
    await waitFor(() => expect(r.result.current.rows).toBeDefined());
    act(() => { hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
    expect(r.result.current.rows).toBeUndefined();
    await act(async () => { await r.result.current.query.refetch(); }); expect(mocks.read).toHaveBeenCalledTimes(1);
    act(() => { hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(r.result.current.rows).toBeDefined());
  });
  it("revalidates after returning to an inactive window", async () => {
    const r = renderHook(() => useInventoryTestCommitments(raw, "", true, true), context());
    await waitFor(() => expect(r.result.current.rows).toBeDefined());
    act(() => { window.dispatchEvent(new Event("blur")); });
    expect(r.result.current.rows).toBeUndefined();
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(r.result.current.rows).toBeDefined());
  });
  it("shows zero commitments only after an authoritative post-expiry response", async () => {
    const after = { ...row, committedToTests: "0", availableAfterProjectsAndTests: "16", asOf: "2020-01-01T00:00:00.090000Z", nextExpiry: null };
    mocks.read.mockResolvedValueOnce({ ok: true, value: [{ ...row, nextExpiry: "2020-01-01T00:00:00.080000Z" }] })
      .mockResolvedValue({ ok: true, value: [after] });
    const r = renderHook(() => useInventoryTestCommitments(raw, "", true, true), context());
    await waitFor(() => expect(r.result.current.rows).toEqual([after]));
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it("rejects a response that arrives after its reported expiry instead of presenting stale current holds", async () => {
    let now = 0, finish!: (v: unknown) => void;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const r = renderHook(() => useInventoryTestCommitments(raw, "", true, true), context());
    await act(async () => { now = 100; finish({ ok: true, value: [{ ...row, nextExpiry: "2020-01-01T00:00:00.040000Z" }] }); });
    await waitFor(() => expect(r.result.current.query.data?.result.ok).toBe(false));
    expect(r.result.current.rows).toBeUndefined(); expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it("does not expose late results after warehouse/search/profile changes", async () => {
    let finish!: (v: unknown) => void;
    mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ok: true, value: [] });
    const r = renderHook(({ warehouse, search }) => useInventoryTestCommitments(warehouse, search, true, true), { ...context(), initialProps: { warehouse: raw, search: "a" } });
    mocks.auth.mockReturnValue({ ...auth, profile: { ...auth.profile, id: id(9) } });
    r.rerender({ warehouse: fg, search: "b" });
    await act(async () => { finish({ ok: true, value: [row] }); });
    await waitFor(() => expect(r.result.current.rows).toEqual([]));
  });
  it("will not display a cached snapshot from a prior mount until freshly verified", async () => {
    const ctx = context(); ctx.client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } });
    const first = renderHook(() => useInventoryTestCommitments(raw, "", true, true), ctx);
    await waitFor(() => expect(first.result.current.rows).toBeDefined()); first.unmount();
    mocks.read.mockReturnValueOnce(new Promise(() => {}));
    const second = renderHook(() => useInventoryTestCommitments(raw, "", true, true), ctx);
    expect(second.result.current.rows).toBeUndefined();
  });
});
