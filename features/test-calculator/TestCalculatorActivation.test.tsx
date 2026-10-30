import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// This integration tests Test Save/holds, not the independent WO commitment release.
vi.mock("../../app/config/workOrderCommitmentReadsActivation",()=>({isWorkOrderCommitmentReadsEnabled:()=>false}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), enabled: vi.fn(), search: vi.fn(), preview: vi.fn(), save: vi.fn(), reconcile: vi.fn(), list: vi.fn(), detail: vi.fn(), inventory: vi.fn() }));
vi.mock("../../app/auth/AuthProvider", () => ({ useAuth: mocks.auth }));
vi.mock("../../app/auth/permissionService", () => ({ hasPermission: mocks.permission }));
vi.mock("../../app/config/testCalculatorActivation", () => ({ isTestCalculatorEnabled: mocks.enabled }));
vi.mock("./services/testCalculatorSearchService", () => ({ searchTestCalculatorProducts: mocks.search }));
vi.mock("./services/testCalculationPreviewService", () => ({ previewTestCalculation: mocks.preview }));
vi.mock("./services/testCalculationSaveService", async original => ({ ...await original<typeof import("./services/testCalculationSaveService")>(), saveTestCalculation: mocks.save, reconcileTestCalculation: mocks.reconcile }));
vi.mock("./services/testCalculationHistoryService", async original => ({ ...await original<typeof import("./services/testCalculationHistoryService")>(), listTestCalculations: mocks.list, getTestCalculation: mocks.detail }));
vi.mock("../inventory/services/inventoryTestCommitmentService", async original => ({ ...await original<typeof import("../inventory/services/inventoryTestCommitmentService")>(), getInventoryTestCommitments: mocks.inventory }));
vi.mock("../../app/config/testCalculationImportActivation", () => ({ isTestCalculationImportEnabled: () => false }));
import TestCalculatorRoute from "../../app/guards/TestCalculatorRoute";
import TestCalculatorPage from "./TestCalculatorPage";
import InventoryTestProductList from "../inventory/components/InventoryTestProductList";
import { installRecoveryBrowser } from "../../test/finishedGoodsRecoveryBrowser";
import { prepareTestRecovery, readTestRecovery } from "./services/testCalculationRecoveryStore";
import { INVENTORY_WAREHOUSES } from "../inventory/inventoryWarehouses";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const auth = { session: { user: { id: id(1) }, access_token: "memory-token" }, profile: { id: id(2), authUserId: id(1), isActive: true }, isActive: true, isAdmin: true, isLoading: false, error: null };
const product = { productId: id(3), name: "Test Component", serialNumber: "0000123", productKind: "component", sourcePolicy: "raw_customs_fg" } as const;
const header = { calculationId: id(4), name: "Wired Test", creatorFullName: "Test Creator", createdAt: "2026-10-27T11:00:00Z", deadlineDate: "2090-01-01", deadlineTimezone: "Europe/Sarajevo", expiresAt: "2090-01-01T23:00:00Z", asOf: "2026-10-27T12:00:00Z", status: "active" } as const;
let saved = false;
function renderPage(inventory = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/pcb/test"]}>
    <Routes><Route element={<TestCalculatorRoute />}><Route path="/pcb/test" element={<TestCalculatorPage enabledAfterActivation={mocks.enabled()} />} /></Route></Routes>
    {inventory && <InventoryTestProductList enabledAfterActivation products={[{ id: product.productId, name: product.name, serialNumber: product.serialNumber, category: "Component", brandName: null, productKind: "component", isActive: true, quantity: 3 }]}
      warehouseId={INVENTORY_WAREHOUSES[0]!.id} warehouseCode="raw_materials" search="" authorizedWarehouseIds={INVENTORY_WAREHOUSES.map(w => w.id)} showCommitments={false} />}
  </MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks(); installRecoveryBrowser(); saved = false;
  mocks.auth.mockReturnValue(auth); mocks.enabled.mockReturnValue(true); mocks.permission.mockResolvedValue({ ok: true, value: false });
  mocks.search.mockResolvedValue({ ok: true, value: [product] });
  mocks.preview.mockResolvedValue({ ok: true, value: { asOf: header.asOf, saveWillRecalculate: true, rows: [{ ...product, required: "2", eligibleFree: "3", projectPriority: "0", available: "3", reservable: "2", missing: "0", warehouses: [] }] } });
  mocks.reconcile.mockResolvedValue(true);
  mocks.save.mockImplementation(async request => { saved = true; return { ok: true, value: { calculationId: header.calculationId, requestId: request.requestId, name: request.name, deadlineDate: request.deadlineDate, expiresAt: header.expiresAt, createdAt: header.createdAt, items: [{ ...product, required: "2", held: "2", missing: "0", warehouses: [] }] } }; });
  mocks.list.mockImplementation(async () => ({ ok: true, value: { rows: saved ? [header] : [], nextCursor: null } }));
  mocks.detail.mockResolvedValue({ ok: true, value: { ...header, items: [] } });
  mocks.inventory.mockImplementation(async () => ({ ok: true, value: [{ productId: product.productId, warehouseId: INVENTORY_WAREHOUSES[0]!.id, quantityScope: "raw_customs_planning", physicalQuantity: "3", projectCommitmentQuantity: "0", availableAfterProjects: "3", committedToTests: saved ? "2" : "0", availableAfterProjectsAndTests: saved ? "1" : "3", asOf: header.asOf, nextExpiry: saved ? header.expiresAt : null }] }));
});
afterEach(cleanup);
describe("activation-ready Test page integration (mock services only)", () => {
  it("closed release mounts no editor, permission reads or Test RPCs even for Admin", () => {
    mocks.enabled.mockReturnValue(false); renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("not activated");
    for (const fn of [mocks.permission, mocks.search, mocks.preview, mocks.save, mocks.list, mocks.detail, mocks.inventory]) expect(fn).not.toHaveBeenCalled();
  });
  it("connects Create → search → preview → durable Save → history/detail and Inventory refresh", async () => {
    renderPage(true);
    fireEvent.click(screen.getByRole("button", { name: "Create Test Calculation" }));
    fireEvent.change(screen.getByLabelText("Calculation name"), { target: { value: "Wired Test" } });
    fireEvent.change(screen.getByLabelText("Deadline (Europe/Sarajevo)"), { target: { value: header.deadlineDate } });
    fireEvent.change(screen.getByLabelText("Search eligible Products"), { target: { value: "Test Component" } });
    fireEvent.click(await screen.findByRole("button", { name: "Add Test Component" }));
    fireEvent.change(screen.getByLabelText("Required quantity for Test Component"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Prove Calculation" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save Test Calculation" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save Test Calculation" }));
    expect(await screen.findByRole("heading", { name: "Test Calculation saved and reconciled" })).toBeInTheDocument();
    expect(mocks.preview).toHaveBeenCalledWith([{ product_id: product.productId, quantity: "2" }]);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({ name: header.name, deadlineDate: header.deadlineDate, items: [{ product_id: product.productId, quantity: "2" }] });
    expect(readTestRecovery({ authUserId: id(1), profileId: id(2) })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: header.name }));
    expect(await screen.findByRole("region", { name: "Saved calculation detail" })).toBeInTheDocument();
    expect(mocks.list.mock.calls.length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(mocks.inventory.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText("1", { selector: "span" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create another Test Calculation" }));
    expect(screen.getByLabelText("Calculation name")).toHaveValue("");
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("permits shared history for view-only users but never mounts mutation/search controls", async () => {
    saved = true; mocks.auth.mockReturnValue({ ...auth, isAdmin: false });
    mocks.permission.mockImplementation(async key => ({ ok: true, value: key === "test_calculator.view" }));
    renderPage();
    expect(await screen.findByRole("button", { name: header.name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Test Calculation" })).toBeDisabled();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    for (const fn of [mocks.search, mocks.preview, mocks.save]) expect(fn).not.toHaveBeenCalled();
  });
  it("denies manage-only users before mounting history or editor", async () => {
    mocks.auth.mockReturnValue({ ...auth, isAdmin: false });
    mocks.permission.mockImplementation(async key => ({ ok: true, value: key === "test_calculator.manage" }));
    renderPage(); expect(await screen.findByRole("alert")).toHaveTextContent("view permission is required");
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("reopens the existing recovery journal without auto-replay or a replacement UUID", async () => {
    const original = { requestId: id(6), name: header.name, deadlineDate: header.deadlineDate, items: [{ product_id: product.productId, quantity: "2" }] };
    prepareTestRecovery({ authUserId: id(1), profileId: id(2) }, original);
    renderPage(); fireEvent.click(screen.getByRole("button", { name: "Create Test Calculation" }));
    const recover = await screen.findByRole("button", { name: "Recover original Test Save" });
    await waitFor(() => expect(recover).toBeEnabled()); expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(recover);
    expect(await screen.findByRole("heading", { name: "Test Calculation saved and reconciled" })).toBeInTheDocument();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(original, "memory-token");
  });
});
