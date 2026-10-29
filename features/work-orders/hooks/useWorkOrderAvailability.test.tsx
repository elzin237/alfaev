import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), permission: vi.fn(), gate: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.auth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.permission }));
vi.mock("../../../app/config/workOrderAvailabilityActivation", () => ({ isWorkOrderAvailabilityEnabled: mocks.gate }));
vi.mock("../services/workOrderAvailabilityService", async original => ({ ...await original<typeof import("../services/workOrderAvailabilityService")>(), getWorkOrderAvailability: mocks.read }));
import { useWorkOrderAvailability, workOrderAvailabilityPrefix } from "./useWorkOrderAvailability";
const id = "00000000-0000-4000-8000-000000000010", version = "2026-10-28T10:00:00.000001Z";
const auth = { session: { user: { id: "actor-1" }, access_token: "token-1" }, profile: { id: "profile-1", authUserId: "actor-1", isActive: true }, isAdmin: true, isLoading: false, error: null };
const value = { workOrderId: id, workOrderNumber: "RN-2026-0001", updatedAt: version, asOf: version, materials: [] };
function context() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockReturnValue(auth); mocks.gate.mockReturnValue(true); mocks.permission.mockResolvedValue({ ok: true, value: true }); mocks.read.mockResolvedValue({ ok: true, value }); });
afterEach(() => { cleanup(); focusManager.setFocused(undefined); onlineManager.setOnline(true); });
it("gate OFF prevents reads and permission requests, including forced refetch", async () => {
  mocks.gate.mockReturnValue(false); const r = renderHook(() => useWorkOrderAvailability(id, version, "saved", false), context());
  await act(async () => { await r.result.current.query.refetch(); });
  expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.permission).not.toHaveBeenCalled(); expect(r.result.current.value).toBeUndefined();
});
it.each([{ session: null }, { profile: null }, { isLoading: true }, { error: {} }, { profile: { ...auth.profile, isActive: false } }, { profile: { ...auth.profile, authUserId: "other" } }])("fails closed for identity %j", async patch => {
  mocks.auth.mockReturnValue({ ...auth, ...patch }); const r = renderHook(() => useWorkOrderAvailability(id, version, "saved", false), context());
  await act(async () => { await r.result.current.query.refetch(); }); expect(mocks.read).not.toHaveBeenCalled();
});
it("requires Work Order view for non-Admins and never substitutes Inventory permission", async () => {
  mocks.auth.mockReturnValue({ ...auth, isAdmin: false }); mocks.permission.mockResolvedValue({ ok: true, value: false });
  const r = renderHook(() => useWorkOrderAvailability(id, version, "saved", false), context());
  await waitFor(() => expect(mocks.permission).toHaveBeenCalledWith("work_orders.view"));
  await act(async () => { await r.result.current.query.refetch(); }); expect(mocks.read).not.toHaveBeenCalled();
});
it("reads for authorized viewers with the captured token and scopes cache by backend, actor, profile and WO", async () => {
  mocks.auth.mockReturnValue({ ...auth, isAdmin: false }); const ctx = context();
  const r = renderHook(() => useWorkOrderAvailability(id, version, "saved", false), ctx);
  await waitFor(() => expect(r.result.current.value).toEqual(value));
  expect(mocks.read).toHaveBeenCalledWith(id, "token-1", expect.any(AbortSignal));
  expect(ctx.client.getQueryState([...workOrderAvailabilityPrefix("actor-1", "profile-1"), id, version, "saved"])?.data).toMatchObject({ ok: true });
});
it("hides old observations during local edits and refreshes after the saved version changes", async () => {
  const r = renderHook(({ v, dirty }) => useWorkOrderAvailability(id, v, dirty ? "edited" : "saved", dirty), { ...context(), initialProps: { v: version, dirty: false } });
  await waitFor(() => expect(r.result.current.value).toBeDefined());
  r.rerender({ v: version, dirty: true }); expect(r.result.current.value).toBeUndefined(); expect(mocks.read).toHaveBeenCalledTimes(1);
  const next = "2026-10-28T10:00:00.000002Z"; mocks.read.mockResolvedValue({ ok: true, value: { ...value, updatedAt: next } });
  r.rerender({ v: next, dirty: false }); await waitFor(() => expect(r.result.current.value?.updatedAt).toBe(next)); expect(mocks.read).toHaveBeenCalledTimes(2);
});
it("does not present a response for a stale saved Draft version", async () => {
  mocks.read.mockResolvedValue({ ok: true, value: { ...value, updatedAt: "2026-10-28T10:00:00.000002Z" } });
  const r = renderHook(() => useWorkOrderAvailability(id, version, "saved", false), context());
  await waitFor(() => expect(r.result.current.query.isFetched).toBe(true)); expect(r.result.current.value).toBeUndefined();
});
it("ignores late pre-save responses and refreshes a no-op save with the same backend version", async () => {
  let finish!: (r: unknown) => void;
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const r = renderHook(({ revision }) => useWorkOrderAvailability(id, version, revision, false), { ...context(), initialProps: { revision: "save-0" } });
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
  r.rerender({ revision: "save-1" }); await waitFor(() => expect(r.result.current.value).toEqual(value));
  await act(async () => { finish({ ok: true, value: { ...value, materials: ["obsolete"] } }); });
  expect(r.result.current.value).toEqual(value); expect(mocks.read).toHaveBeenCalledTimes(2);
});
it("does not let a late old-identity response replace the current identity", async () => {
  let finish!: (r: unknown) => void; mocks.read.mockImplementation((_id, token) => token === "token-1" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ok: true, value }));
  const r = renderHook(() => useWorkOrderAvailability(id, version, "saved", false), context());
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
  mocks.auth.mockReturnValue({ ...auth, session: { ...auth.session, user: { id: "actor-2" }, access_token: "token-2" }, profile: { ...auth.profile, id: "profile-2", authUserId: "actor-2" } });
  r.rerender(); await waitFor(() => expect(r.result.current.value).toEqual(value));
  await act(async () => { finish({ ok: true, value: { ...value, materials: ["wrong actor"] } }); }); expect(r.result.current.value).toEqual(value);
});
it("refreshes on relevant stock invalidation only for the current profile, without loops", async () => {
  const ctx = context(); const r = renderHook(() => useWorkOrderAvailability(id, version, "saved", false), ctx);
  await waitFor(() => expect(r.result.current.value).toBeDefined());
  ctx.client.setQueryData(["inventory", "products", "profile-2"], []);
  await act(async () => { await ctx.client.invalidateQueries({ queryKey: ["inventory", "products", "profile-2"] }); }); expect(mocks.read).toHaveBeenCalledTimes(1);
  ctx.client.setQueryData(["inventory", "products", "profile-1"], []);
  await act(async () => { await ctx.client.invalidateQueries({ queryKey: ["inventory", "products", "profile-1"] }); });
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
});
it("refreshes on window focus and reconnect", async () => {
  const r = renderHook(() => useWorkOrderAvailability(id, version, "saved", false), context()); await waitFor(() => expect(r.result.current.value).toBeDefined());
  await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
  await act(async () => { onlineManager.setOnline(false); onlineManager.setOnline(true); }); await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(3));
  await act(async () => { window.dispatchEvent(new Event("focus")); }); await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(4));
});
it("hides previous values on denied refetch rather than retaining fabricated availability", async () => {
  const r = renderHook(() => useWorkOrderAvailability(id, version, "saved", false), context()); await waitFor(() => expect(r.result.current.value).toBeDefined());
  mocks.read.mockResolvedValue({ ok: false, error: { code: "access_denied", message: "Availability unavailable" } });
  await act(async () => { await r.result.current.query.refetch(); }); await waitFor(() => expect(r.result.current.value).toBeUndefined());
});
