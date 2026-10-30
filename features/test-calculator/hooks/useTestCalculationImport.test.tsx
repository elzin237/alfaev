import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), gate: vi.fn(), import: vi.fn(), permission: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.auth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.permission }));
vi.mock("../../../app/config/testCalculationImportActivation", () => ({ isTestCalculationImportEnabled: mocks.gate }));
vi.mock("../services/testCalculationImportService", async original => ({ ...await original<typeof import("../services/testCalculationImportService")>(), importTestCalculation: mocks.import }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: {} }));
import { useTestCalculationImport } from "./useTestCalculationImport";
import { readTestImportRecovery, testImportRecoveryKey } from "../services/testCalculationImportRecoveryStore";
import { importIdentity as identity, importRequest, importReceipt, importId } from "../../../test/testCalculationImportFixtures";
import { installRecoveryBrowser } from "../../../test/finishedGoodsRecoveryBrowser";
import { testCalculationHistoryPrefix, inventoryTestCommitmentsPrefix } from "../services/testCalculationRecoveryStore";
import { workOrderAvailabilityPrefix } from "../../work-orders/hooks/useWorkOrderAvailability";
import { projectAlertQueryPrefix } from "../../dashboard/projectAlertQueryKeys";
const auth = { session: { user: { id: identity.authUserId }, access_token: "memory-token" },
  profile: { id: identity.profileId, authUserId: identity.authUserId, isActive: true }, isActive: true, isAdmin: true, isLoading: false, error: null };
const input = { calculationId: importRequest.calculationId, serialNumber: "007" };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => useTestCalculationImport(), { wrapper }) };
}
beforeEach(() => {
  vi.resetAllMocks(); installRecoveryBrowser(); mocks.auth.mockReturnValue(auth); mocks.gate.mockReturnValue(true);
  mocks.permission.mockResolvedValue({ ok: true, value: true }); mocks.import.mockResolvedValue({ ok: true, value: importReceipt() });
});
afterEach(cleanup);
it("persists intent before dispatch and invalidates only the captured profile's queries", async () => {
  const r = setup(); await waitFor(() => expect(r.result.current.canImport).toBe(true));
  const invalidate = vi.spyOn(r.client, "invalidateQueries");
  r.client.setQueryData(["pcb", "cards", importId(99)], ["other profile"]);
  mocks.import.mockImplementationOnce(async request => {
    expect(readTestImportRecovery(identity)?.request).toEqual(request);
    expect(readTestImportRecovery(identity)?.state).toBe("uncertain");
    expect(localStorage.getItem(testImportRecoveryKey(identity))).not.toContain("memory-token");
    return { ok: true, value: importReceipt() };
  });
  await act(async () => { await r.result.current.submit(input, true); });
  expect(r.result.current.saved).toEqual(importReceipt()); expect(readTestImportRecovery(identity)).toBeNull();
  for (const key of [testCalculationHistoryPrefix(identity), inventoryTestCommitmentsPrefix(identity),
    workOrderAvailabilityPrefix(identity.authUserId, identity.profileId), projectAlertQueryPrefix(identity.profileId), ["pcb", "cards", identity.profileId]]) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key }, { throwOnError: true });
  }
  expect(r.client.getQueryState(["pcb", "cards", importId(99)])?.isInvalidated).toBe(false);
});
it("requires explicit confirmation and blocks duplicate clicks and replacement payloads after uncertainty", async () => {
  mocks.import.mockResolvedValue({ ok: false, error: { uncertain: true, message: "Lost" } });
  const r = setup(); await waitFor(() => expect(r.result.current.canImport).toBe(true));
  await act(async () => { await r.result.current.submit(input, false); }); expect(mocks.import).not.toHaveBeenCalled();
  await act(async () => { await Promise.all([r.result.current.submit(input, true), r.result.current.submit(input, true)]); });
  expect(mocks.import).toHaveBeenCalledTimes(1);
  await act(async () => { await r.result.current.submit({ ...input, serialNumber: "008" }, true); }); expect(mocks.import).toHaveBeenCalledTimes(1);
});
it("recovers the exact UUID/payload after reload and never automatically retries", async () => {
  mocks.import.mockResolvedValueOnce({ ok: false, error: { uncertain: true, message: "Lost response" } });
  const r = setup(); await waitFor(() => expect(r.result.current.canImport).toBe(true));
  await act(async () => { await r.result.current.submit(input, true); }); const original = mocks.import.mock.calls[0]![0]; r.unmount();
  const reload = setup(); await waitFor(() => expect(reload.result.current.pending).not.toBeNull()); expect(mocks.import).toHaveBeenCalledTimes(1);
  await act(async () => { await reload.result.current.recover(); }); expect(mocks.import.mock.calls[1]![0]).toEqual(original);
  expect(readTestImportRecovery(identity)).toBeNull(); expect(reload.result.current.saved).not.toBeNull();
});
it("clears a fresh terminal rejection but retains original uncertain intent on later authorization failure", async () => {
  const denied = { ok: false, error: { uncertain: false, code: "42501", message: "Denied" } };
  mocks.import.mockResolvedValueOnce(denied); const r = setup(); await waitFor(() => expect(r.result.current.canImport).toBe(true));
  await act(async () => { await r.result.current.submit(input, true); }); expect(readTestImportRecovery(identity)).toBeNull();
  mocks.import.mockResolvedValueOnce({ ok: false, error: { uncertain: true, message: "Lost" } });
  await act(async () => { await r.result.current.submit(input, true); }); const original = readTestImportRecovery(identity);
  mocks.import.mockResolvedValueOnce(denied); await act(async () => { await r.result.current.recover(); });
  expect(readTestImportRecovery(identity)).toEqual(original); expect(r.result.current.canImport).toBe(false);
  expect(r.result.current.error).toMatch(/remains unresolved/);
});
it("retains verified receipt across reload after refresh failure without dispatching again", async () => {
  const r = setup(); await waitFor(() => expect(r.result.current.canImport).toBe(true));
  vi.spyOn(r.client, "invalidateQueries").mockRejectedValueOnce(Error("refresh failed"));
  await act(async () => { await r.result.current.submit(input, true); }); expect(readTestImportRecovery(identity)?.state).toBe("confirmed_success"); r.unmount();
  const reload = setup(); await waitFor(() => expect(reload.result.current.pending).not.toBeNull());
  await act(async () => { await reload.result.current.recover(); }); expect(mocks.import).toHaveBeenCalledTimes(1); expect(reload.result.current.saved).not.toBeNull();
});
it("gate OFF and inactive actors make no permission or import calls", async () => {
  mocks.gate.mockReturnValue(false); const r = setup(); await act(async () => { await r.result.current.submit(input, true); await r.result.current.recover(); });
  expect(mocks.import).not.toHaveBeenCalled(); expect(mocks.permission).not.toHaveBeenCalled(); r.unmount();
  mocks.gate.mockReturnValue(true); mocks.auth.mockReturnValue({ ...auth, isActive: false }); const inactive = setup();
  await act(async () => { await inactive.result.current.submit(input, true); }); expect(mocks.import).not.toHaveBeenCalled();
});
it("requires all five delegated permissions and matching active profile identity", async () => {
  mocks.auth.mockReturnValue({ ...auth, isAdmin: false }); mocks.permission.mockImplementation(async key => ({ ok: true, value: key !== "pcb.edit" }));
  const r = setup(); await waitFor(() => expect(mocks.permission).toHaveBeenCalledTimes(5));
  expect(r.result.current.canImport).toBe(false); await act(async () => { await r.result.current.submit(input, true); }); expect(mocks.import).not.toHaveBeenCalled();
  r.unmount(); mocks.auth.mockReturnValue({ ...auth, profile: { ...auth.profile, authUserId: importId(99) } }); const invalid = setup();
  expect(invalid.result.current.canImport).toBe(false);
});
it("profile switches hide prior intent and late receipts never appear in the new scope", async () => {
  let finish!: (value: unknown) => void; mocks.import.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const r = setup(); await waitFor(() => expect(r.result.current.canImport).toBe(true)); let old!: Promise<void>;
  act(() => { old = r.result.current.submit(input, true); }); await waitFor(() => expect(mocks.import).toHaveBeenCalledTimes(1));
  mocks.auth.mockReturnValue({ ...auth, session: { user: { id: importId(20) }, access_token: "other" }, profile: { id: importId(21), authUserId: importId(20), isActive: true } }); r.rerender();
  expect(r.result.current.pending).toBeNull(); expect(r.result.current.saved).toBeNull();
  await act(async () => { finish({ ok: true, value: importReceipt() }); await old; });
  expect(r.result.current.saved).toBeNull(); expect(readTestImportRecovery(identity)?.state).toBe("confirmed_success");
});
it("missing or altered original persistence blocks recovery, never generating a new UUID", async () => {
  mocks.import.mockResolvedValue({ ok: false, error: { uncertain: true, message: "Lost" } });
  const r = setup(); await waitFor(() => expect(r.result.current.canImport).toBe(true)); await act(async () => { await r.result.current.submit(input, true); });
  localStorage.removeItem(testImportRecoveryKey(identity)); const uuid = vi.spyOn(crypto, "randomUUID");
  await act(async () => { await r.result.current.recover(); }); expect(uuid).not.toHaveBeenCalled(); uuid.mockRestore(); expect(mocks.import).toHaveBeenCalledTimes(1);
  expect(r.result.current.blocked).toBe(true);
});
it("concurrent controllers share the existing exclusive lock and cannot dispatch two imports", async () => {
  let finish!: (value: unknown) => void; mocks.import.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = setup(), second = setup();
  await waitFor(() => expect(first.result.current.canImport && second.result.current.canImport).toBe(true));
  let pending!: Promise<void>; act(() => { pending = first.result.current.submit(input, true); });
  await waitFor(() => expect(mocks.import).toHaveBeenCalledTimes(1));
  await act(async () => { await second.result.current.submit(input, true); }); expect(mocks.import).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ ok: false, error: { uncertain: true, message: "Lost" } }); await pending; });
  await act(async () => { await second.result.current.submit(input, true); }); expect(mocks.import).toHaveBeenCalledTimes(1);
  expect(second.result.current.pending?.request).toEqual(first.result.current.pending?.request);
});
it("a lost post-commit response and exact replay represent only one backend effect", async () => {
  let effect = 0; const committed = new Set<string>();
  mocks.import.mockImplementation(async request => {
    if (!committed.has(request.requestId)) { committed.add(request.requestId); effect++; return { ok: false, error: { uncertain: true, message: "Lost" } }; }
    return { ok: true, value: importReceipt() };
  });
  const first = setup(); await waitFor(() => expect(first.result.current.canImport).toBe(true));
  await act(async () => { await first.result.current.submit(input, true); }); first.unmount();
  const reload = setup(); await waitFor(() => expect(reload.result.current.pending).not.toBeNull());
  await act(async () => { await reload.result.current.recover(); }); expect(effect).toBe(1); expect(reload.result.current.saved).not.toBeNull();
});
