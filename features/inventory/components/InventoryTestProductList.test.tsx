import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ hook: vi.fn() }));
vi.mock("../hooks/useInventoryTestCommitments", () => ({ useInventoryTestCommitments: mocks.hook }));
import InventoryTestProductList from "./InventoryTestProductList";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";
import type { InventoryTestCommitment } from "../services/inventoryTestCommitmentService";
import type { ProductListItem } from "../services/productService";
const product: ProductListItem = { id: "00000000-0000-4000-8000-000000000001", serialNumber: "007", name: "Historical Output", category: "PCB", brandName: null, quantity: 12, productKind: "pcb_finished_good", isActive: false };
const row: InventoryTestCommitment = { productId: product.id, warehouseId: INVENTORY_WAREHOUSES[0]!.id, quantityScope: "raw_customs_planning", physicalQuantity: "12", projectCommitmentQuantity: "10", availableAfterProjects: "2", committedToTests: "9007199254740993", availableAfterProjectsAndTests: "-9007199254740991", asOf: "2026-10-27T12:00:00.123456Z", nextExpiry: "2026-10-28T23:00:00Z" };
const renderList = (code = "raw_materials", enabled = true, ids = INVENTORY_WAREHOUSES.map(w => w.id), products = [product]) => {
  const warehouse = INVENTORY_WAREHOUSES.find(w => w.code === code)!;
  return render(<MemoryRouter><InventoryTestProductList products={products} warehouseCode={code} warehouseId={warehouse.id}
    search="resistor" authorizedWarehouseIds={ids} enabledAfterActivation={enabled} showCommitments={code !== "customs"}
    commitments={new Map([[product.id, { productId: product.id, physicalQuantity: 12n, committedToProjects: 10n, availableAfterCommitments: 2n }]])} /></MemoryRouter>);
};
beforeEach(() => { vi.resetAllMocks(); mocks.hook.mockReturnValue({ allowed: true, rows: [row], query: { isFetching: false, refetch: vi.fn() } }); });
afterEach(cleanup);
describe("gated Inventory Test columns", () => {
  it.each(INVENTORY_WAREHOUSES.map(w => w.code))("keeps %s unchanged and mounts no new read while gate is closed", code => {
    renderList(code, false);
    expect(mocks.hook).not.toHaveBeenCalled(); expect(screen.queryByText("Committed to Tests")).not.toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });
  it.each(INVENTORY_WAREHOUSES.map(w => w.code))("adds exact blue/signed columns without altering existing %s figures", code => {
    renderList(code);
    const headings = screen.getAllByRole("columnheader").map(x => x.textContent);
    expect(headings.slice(-3)).toEqual(["Committed to Tests", "Available After Projects and Tests", "Status"]);
    expect(screen.getByRole("columnheader", { name: "Committed to Tests" })).toHaveClass("text-blue-700");
    expect(screen.getByText("9007199254740993")).toHaveClass("text-blue-700");
    expect(screen.getByText("-9007199254740991")).toHaveClass("text-red-700");
    expect(screen.getByText("12")).toBeInTheDocument(); expect(screen.getByText("Archived")).toBeInTheDocument();
    if (code !== "customs") for (const value of ["10", "2"]) expect(screen.getByText(value)).toBeInTheDocument();
    expect(screen.getByRole("table").parentElement).toHaveClass("overflow-x-auto");
    expect(screen.getByRole("link", { name: product.name })).toHaveAttribute("href", `/inventory/${product.id}?warehouse=${code}`);
    expect(screen.getByText(row.asOf)).toHaveAttribute("dateTime", row.asOf);
  });
  it("requires both Raw and Customs view while FG and Customs require only their own", () => {
    const raw = INVENTORY_WAREHOUSES[0]!, fg = INVENTORY_WAREHOUSES[1]!, customs = INVENTORY_WAREHOUSES[2]!;
    const r = renderList("raw_materials", true, [raw.id]); expect(mocks.hook).toHaveBeenLastCalledWith(raw.id, "resistor", false, true); r.unmount();
    const f = renderList("finished_goods", true, [fg.id]); expect(mocks.hook).toHaveBeenLastCalledWith(fg.id, "resistor", true, true); f.unmount();
    renderList("customs", true, [customs.id]); expect(mocks.hook).toHaveBeenLastCalledWith(customs.id, "resistor", true, true);
  });
  it.each(["pending", "error", "denied"])("shows unavailable, not zero, during %s while physical quantity remains visible", state => {
    mocks.hook.mockReturnValue({ allowed: state !== "denied", rows: undefined,
      query: { isFetching: state === "pending", data: state === "error" ? { result: { ok: false, error: { message: "Read failed" } } } : undefined, refetch: vi.fn() } });
    renderList(); expect(screen.getAllByText("Unavailable")).toHaveLength(2); expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    const retry = screen.queryByRole("button", { name: "Retry Test commitments" });
    if (state === "error") expect(retry).toBeInTheDocument();
    if (state === "denied" || state === "pending") expect(retry).not.toBeInTheDocument();
  });
  it("preserves Product order, Product search scope and unavailable missing rows without synthesizing values", () => {
    const second = { ...product, id: "00000000-0000-4000-8000-000000000002", serialNumber: "001", name: "Second" };
    renderList("raw_materials", true, undefined, [product, second]);
    expect(screen.getAllByRole("row").slice(1).map(r => within(r).getByRole("rowheader").textContent)).toEqual(["007", "001"]);
    expect(within(screen.getByRole("row", { name: /Second/ })).getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.getByRole("alert")).toHaveTextContent("No missing figures are assumed to be zero");
    expect(mocks.hook).toHaveBeenCalledWith(INVENTORY_WAREHOUSES[0]!.id, "resistor", true, true);
  });
});
