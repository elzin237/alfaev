import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), rpc: vi.fn(), filter: vi.fn(), header: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.auth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.permission }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
import { useDashboardRawCatalog } from "./useDashboardRawCatalog";

const raw = "10000000-0000-4000-8000-000000000001";
const first = "00000000-0000-4000-8000-000000000001", output = "00000000-0000-4000-8000-000000000002";
const candidates = [first, output].map((productId, i) => ({ productId, name: i ? "Calculator output" : "Component",
  serialNumber: String(i), category: "Catalog", quantity: "999", updatedAt: "2026-10-02T10:00:00Z" }));
const row = { id: first, warehouse_id: raw, name: "Component", serial_number: "0", category: "Catalog", is_active: true, quantity: "9007199254740993" };
const identity = { session: { user: { id: "actor" }, access_token: "mock-token" },
  profile: { id: "profile", authUserId: "actor", isActive: true }, isActive: true, isAdmin: true, isLoading: false, error: null };
let response: { data: unknown; error: unknown };
function context() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
beforeEach(() => {
  vi.resetAllMocks(); response = { data: [row], error: null };
  mocks.auth.mockReturnValue(identity); mocks.permission.mockResolvedValue({ ok: true, value: true });
  const chain = { select: vi.fn().mockReturnThis(), in: mocks.filter.mockReturnThis(), limit: vi.fn().mockReturnThis(),
    setHeader: mocks.header.mockReturnThis(), abortSignal: vi.fn(async () => response) };
  mocks.rpc.mockReturnValue(chain);
});
afterEach(cleanup);

it("uses one bounded canonical warehouse RPC, retains order/precision and excludes non-members", async () => {
  const view = renderHook(() => useDashboardRawCatalog(candidates), context());
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("search_inventory_products_by_warehouse", { p_warehouse_id: raw, p_search: null });
  expect(mocks.filter).toHaveBeenCalledWith("id", [first, output]);
  expect(mocks.header).toHaveBeenCalledWith("Authorization", "Bearer mock-token");
  expect(view.result.current.products).toEqual([{ ...candidates[0], quantity: row.quantity }]);
  expect(mocks.permission).not.toHaveBeenCalled();
});
it("reports an empty candidate window honestly without querying Inventory", async () => {
  const view = renderHook(() => useDashboardRawCatalog([]), context());
  await waitFor(() => expect(view.result.current.products).toEqual([]));
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("retains no Calculator outputs when canonical membership returns no rows", async () => {
  response.data = [];
  const view = renderHook(() => useDashboardRawCatalog(candidates), context());
  await waitFor(() => expect(view.result.current.products).toEqual([]));
});
it.each([null, [null], [{ ...row, quantity: 42 }], [{ ...row, quantity: "-1" }], [{ ...row, quantity: "9223372036854775808" }], [{ ...row, warehouse_id: output }], [row, row]])(
  "fails closed on malformed or mis-scoped responses (%j)", async data => {
    response.data = data; const view = renderHook(() => useDashboardRawCatalog(candidates), context());
    await waitFor(() => expect(view.result.current.status).toBe("error"));
    expect(view.result.current.products).toBeUndefined();
  },
);
it("denies non-Admins lacking the Raw warehouse view without an Inventory request", async () => {
  mocks.auth.mockReturnValue({ ...identity, isAdmin: false });
  mocks.permission.mockResolvedValue({ ok: true, value: false });
  const view = renderHook(() => useDashboardRawCatalog(candidates), context());
  await waitFor(() => expect(view.result.current.status).toBe("denied"));
  await act(async () => { await view.result.current.query.refetch(); });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("allows authorized non-Admins and hides prior data after identity changes", async () => {
  mocks.auth.mockReturnValue({ ...identity, isAdmin: false });
  const ctx = context(), view = renderHook(() => useDashboardRawCatalog(candidates), ctx);
  await waitFor(() => expect(view.result.current.products).toHaveLength(1));
  expect(mocks.permission).toHaveBeenCalledWith("inventory.raw_materials.view");
  mocks.auth.mockReturnValue({ ...identity, session: null, profile: null, isActive: false });
  view.rerender(); expect(view.result.current.products).toBeUndefined();
  expect(view.result.current.status).toBe("denied");
});
it("does not substitute legacy quantities on transport failure", async () => {
  response = { data: null, error: { code: "network" } };
  const view = renderHook(() => useDashboardRawCatalog(candidates), context());
  await waitFor(() => expect(view.result.current.status).toBe("error"));
  expect(view.result.current.products).toBeUndefined();
});
it("omits archived candidates without changing canonical warehouse membership", async () => {
  response.data = [{ ...row, is_active: false }];
  const view = renderHook(() => useDashboardRawCatalog(candidates), context());
  await waitFor(() => expect(view.result.current.products).toEqual([]));
});
it("rejects duplicate candidate windows before dispatch", async () => {
  const view = renderHook(() => useDashboardRawCatalog([...candidates, candidates[0]!]), context());
  await waitFor(() => expect(view.result.current.status).toBe("error"));
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("rejects oversized candidate windows before dispatch", async () => {
  const oversized = Array.from({ length: 6 }, (_, i) => ({ ...candidates[0]!,
    productId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}` }));
  const view = renderHook(() => useDashboardRawCatalog(oversized), context());
  await waitFor(() => expect(view.result.current.status).toBe("error"));
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("does not render an old identity's response while the next profile verifies membership", async () => {
  const ctx = context(), view = renderHook(() => useDashboardRawCatalog(candidates), ctx);
  await waitFor(() => expect(view.result.current.products).toHaveLength(1));
  let finish: ((value: typeof response) => void) | undefined;
  mocks.rpc.mockReturnValue({ select: () => ({ in: () => ({ limit: () => ({ setHeader: () => ({
    abortSignal: () => new Promise(resolve => { finish = resolve; }),
  }) }) }) }) });
  mocks.auth.mockReturnValue({ ...identity, session: { ...identity.session, user: { id: "actor-2" } },
    profile: { ...identity.profile, id: "profile-2", authUserId: "actor-2" } });
  view.rerender();
  expect(view.result.current.products).toBeUndefined();
  await waitFor(() => expect(finish).toBeDefined());
  act(() => finish?.({ data: [{ ...row, quantity: "2" }], error: null }));
  await waitFor(() => expect(view.result.current.products?.[0]?.quantity).toBe("2"));
});
