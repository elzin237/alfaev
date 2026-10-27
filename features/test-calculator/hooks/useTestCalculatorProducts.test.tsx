import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ search: vi.fn(), auth: vi.fn() }));
vi.mock("../services/testCalculatorSearchService", () => ({ searchTestCalculatorProducts: mocks.search }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.auth }));
import { useTestCalculatorProducts } from "./useTestCalculatorProducts";
const active = { session: { user: { id: "auth-a" } }, profile: { id: "profile-a", authUserId: "auth-a", isActive: true }, isActive: true, isLoading: false, error: null };
const product = { productId: "p", name: "Product", serialNumber: "001", productKind: "pcb_finished_good", sourcePolicy: "finished_goods_only" };
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
beforeEach(() => { mocks.auth.mockReturnValue(active); mocks.search.mockResolvedValue({ ok: true, value: [product] }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("gated Test Product search hook", () => {
  it("does not search by default, even on manual refetch", async () => {
    const context = wrapper(); const { result } = renderHook(() => useTestCalculatorProducts("Product"),context);
    await act(async () => { await result.current.refetch(); });
    expect(mocks.search).not.toHaveBeenCalled(); expect(result.current.data).toBeUndefined();
  });
  it("debounces edits, hides stale results and isolates both authenticated user and profile", async () => {
    const context = wrapper(); const { result, rerender } = renderHook(({ term }) => useTestCalculatorProducts(term,true), { ...context, initialProps: { term: "P" } });
    rerender({ term: " Product " });
    expect(mocks.search).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.data?.ok).toBe(true));
    expect(mocks.search).toHaveBeenCalledExactlyOnceWith("Product");
    expect(context.client.getQueryData(["test-calculator-products","auth-a","profile-a","Product"])).toEqual({ ok: true, value: [product] });
    rerender({ term: "Changed" }); expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(mocks.search).toHaveBeenCalledWith("Changed"));
    mocks.auth.mockReturnValue({ ...active, session: { user: { id: "auth-b" } }, profile: { ...active.profile, id: "profile-b", authUserId: "auth-b" } });
    rerender({ term: "Changed" }); expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(context.client.getQueryData(["test-calculator-products","auth-b","profile-b","Changed"])).toBeDefined());
  });
  it.each([{ session: null }, { profile: null }, { isActive: false }, { isLoading: true },
    { profile: { ...active.profile, isActive: false } }, { profile: { ...active.profile, authUserId: "wrong" } },
    { error: { code: "failed" } }])("denies unverifiable identity %j without dispatch", async override => {
    mocks.auth.mockReturnValue({ ...active, ...override });
    const { result } = renderHook(() => useTestCalculatorProducts("Product",true),wrapper());
    await act(async () => { await result.current.refetch(); });
    expect(mocks.search).not.toHaveBeenCalled(); expect(result.current.data).toBeUndefined();
  });
  it("does not search empty or overlong terms", async () => {
    const { result,rerender } = renderHook(({ term }) => useTestCalculatorProducts(term,true), { ...wrapper(), initialProps: { term: " " } });
    await act(async () => { await result.current.refetch(); }); rerender({ term: "x".repeat(201) });
    await act(async () => { await result.current.refetch(); }); expect(mocks.search).not.toHaveBeenCalled();
  });
});
