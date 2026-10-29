import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), create: vi.fn(), import: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.auth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: vi.fn() }));
vi.mock("../services/productService", () => ({ createProduct: mocks.create }));
vi.mock("../services/componentImportService", () => ({ importComponents: mocks.import }));
vi.mock("../services/inventoryTestCommitmentService", async original => ({
  ...await original<typeof import("../services/inventoryTestCommitmentService")>(), getInventoryTestCommitments: mocks.read,
}));
import { useProductCreation } from "./useProductCreation";
import { useComponentImport } from "./useComponentImport";
import { useInventoryTestCommitments } from "./useInventoryTestCommitments";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";
import { inventoryTestCommitmentsPrefix } from "../../test-calculator/services/testCalculationRecoveryStore";
import type { InventoryTestCommitment } from "../services/inventoryTestCommitmentService";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { authUserId: id(1), profileId: id(2) };
const auth = { session: { user: { id: id(1) }, access_token: "mock-token" },
  profile: { id: id(2), authUserId: id(1), isActive: true }, isAdmin: true, isActive: true, isLoading: false, error: null };
function context() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockReturnValue(auth); });
afterEach(cleanup);

describe("Inventory membership refresh", () => {
  it.each(INVENTORY_WAREHOUSES.flatMap(w => ["create", "import"].map(operation => ({ ...w, operation }))))(
    "$operation refreshes mounted $code Test rows without invalidating another identity", async ({ id: warehouseId, code, operation }) => {
      const makeRow = (n: number): InventoryTestCommitment => ({ productId: id(n), warehouseId,
        quantityScope: code === "raw_materials" ? "raw_customs_planning" : code === "finished_goods" ? "finished_goods" : "customs",
        physicalQuantity: "20", projectCommitmentQuantity: "0", availableAfterProjects: "20",
        committedToTests: "0", availableAfterProjectsAndTests: "20", asOf: "2026-10-28T10:00:00Z", nextExpiry: null });
      let rows = [makeRow(3)];
      mocks.read.mockImplementation(async () => ({ ok: true, value: [...rows] }));
      mocks.create.mockImplementation(async () => { rows = [...rows, makeRow(4)]; return { ok: true, value: { productId: id(4), serialNumber: "4" } }; });
      mocks.import.mockImplementation(async () => { rows = [...rows, makeRow(4), makeRow(5)]; return { ok: true, value: { createdCount: 2, products: [] } }; });
      const ctx = context();
      const otherKey = [...inventoryTestCommitmentsPrefix({ authUserId: id(8), profileId: id(9) }), warehouseId, "", 0];
      ctx.client.setQueryData(otherKey, "other-profile-snapshot");
      const r = renderHook(() => ({ creation: useProductCreation(), importer: useComponentImport(),
        commitments: useInventoryTestCommitments(warehouseId, "", true, true) }), ctx);
      await waitFor(() => expect(r.result.current.commitments.rows).toEqual([makeRow(3)]));
      await act(async () => {
        if (operation === "create") await r.result.current.creation.create({ name: "New", category: "Passive", brandId: null });
        else await r.result.current.importer.importBatch([{ name: "New A", category: "Passive", brand: null }, { name: "New B", category: "Passive", brand: null }]);
      });
      await waitFor(() => expect(r.result.current.commitments.rows).toEqual(rows));
      expect(rows).toHaveLength(operation === "create" ? 2 : 3);
      expect(r.result.current.commitments.rows?.[0]).toEqual(makeRow(3));
      await act(async () => { await Promise.resolve(); });
      expect(mocks.read).toHaveBeenCalledTimes(2);
      expect(ctx.client.getQueryData(otherKey)).toBe("other-profile-snapshot");
      expect(ctx.client.getQueryState(otherKey)?.isInvalidated).toBe(false);
      r.unmount(); ctx.client.clear();
    },
  );

  it.each(["create", "import"])("keeps %s completion scoped to the original identity after an account switch", async operation => {
    let finish!: (value: unknown) => void;
    mocks.create.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    if (operation === "import") mocks.import.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const ctx = context();
    const r = renderHook(() => ({ creation: useProductCreation(), importer: useComponentImport() }), ctx);
    const invalidation = vi.spyOn(ctx.client, "invalidateQueries");
    let pending!: Promise<unknown>;
    act(() => { pending = operation === "create"
      ? r.result.current.creation.create({ name: "New", category: "Passive", brandId: null })
      : r.result.current.importer.importBatch([{ name: "New", category: "Passive", brand: null }]); });
    mocks.auth.mockReturnValue({ ...auth, session: { ...auth.session, user: { id: id(8) } }, profile: { ...auth.profile, id: id(9), authUserId: id(8) } });
    r.rerender();
    await act(async () => { finish({ ok: true, value: {} }); await pending; });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: inventoryTestCommitmentsPrefix(identity) });
    expect(invalidation).not.toHaveBeenCalledWith({ queryKey: inventoryTestCommitmentsPrefix({ authUserId: id(8), profileId: id(9) }) });
    r.unmount(); ctx.client.clear();
  });
});
