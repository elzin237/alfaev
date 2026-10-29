import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), gate: vi.fn() }));
vi.mock("../hooks/useAllInventory", () => ({ useAllInventory: mocks.read }));
vi.mock("../../../app/config/inventoryStockHealthActivation", () => ({ isInventoryStockHealthEnabled: mocks.gate }));
import AllInventoryView, { AllInventoryTable } from "./AllInventoryView";
import type { AllInventoryRow } from "../hooks/useAllInventory";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";
function row(index: number, id = "same"): AllInventoryRow {
  return { warehouse: INVENTORY_WAREHOUSES[index]!, product: { id, name: index === 1 ? "Calculator" : "Component", serialNumber: "0000001", category: "Part", brandName: null, productKind: index === 1 ? "pcb_finished_good" : "component", isActive: index !== 2, quantity: 9223372036854775807n }, commitment: undefined, test: undefined, health: undefined };
}
const defaults = () => ({ rows: [row(0), row(1), row(2)], active: true, pending: false, failure: null, healthReady: true, refresh: vi.fn().mockResolvedValue(undefined) });
beforeEach(() => { vi.resetAllMocks(); mocks.read.mockReturnValue(defaults()); mocks.gate.mockReturnValue(true); });
afterEach(cleanup);
const renderView = (ids: string[] = INVENTORY_WAREHOUSES.map(w => w.id)) => render(<MemoryRouter><AllInventoryView authorizedWarehouseIds={ids} search="part" testsEnabled /></MemoryRouter>);
describe("All Inventory union table", () => {
  it("uses Not Set badges for all warehouse rows while keeping the Not Configured filter", () => {
    const rows=defaults().rows.map(item=>({...item,health:{productId:item.product.id,warehouseId:item.warehouse.id,productName:item.product.name,isActive:item.product.isActive,physicalQuantity:item.product.quantity.toString(),minimumQuantity:null,version:null,status:"NOT_CONFIGURED" as const}}));
    mocks.read.mockReturnValue({...defaults(),rows});
    renderView();
    const badges=within(screen.getByRole("table")).getAllByText("Not Set");
    expect(badges).toHaveLength(3);
    for(const badge of badges)expect(badge).toHaveClass("bg-zinc-100","text-zinc-700","border-zinc-200");
    expect(screen.getByRole("option",{name:"Not Configured"})).toHaveValue("NOT_CONFIGURED");
    fireEvent.change(screen.getByRole("combobox",{name:"Stock Health"}),{target:{value:"NOT_CONFIGURED"}});
    expect(within(screen.getByRole("table")).getAllByText("Not Set")).toHaveLength(3);
  });
  it("uses compact centered headers with keyboard-accessible full meanings", () => {
    render(<MemoryRouter><AllInventoryTable rows={[row(0)]} testsEnabled /></MemoryRouter>);
    expect(screen.getAllByRole("columnheader").map(header => header.getAttribute("aria-label"))).toEqual([
      "WH", "Serial", "Product", "Category", "Brand", "Physical", "Project Demand", "FG Reserved", "Available", "Available FG", "Test Holds", "After Tests", "Health", "Status",
    ]);
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header).toHaveClass("text-center", "px-2");
      const label = header.querySelector("[tabindex='0']")!;
      expect(label).toHaveClass("focus-visible:outline-2");
      expect(label).toHaveAttribute("title");
      expect(document.getElementById(label.getAttribute("aria-describedby")!)).toHaveAttribute("role", "tooltip");
    }
    expect(screen.getByRole("columnheader", { name: "Available" })).toHaveAccessibleDescription(/Raw \+ Customs.*minus outstanding Project demand/);
    expect(screen.getByRole("columnheader", { name: "FG Reserved" })).toHaveAccessibleDescription(/active hard Finished Goods/);
    expect(screen.getByRole("columnheader", { name: "After Tests" })).toHaveAccessibleDescription(/Customs minus Customs Test holds/);
  });
  it("centers identifiers, quantities, badges and Product names without changing links or widths", () => {
    render(<MemoryRouter><AllInventoryTable rows={[row(0)]} testsEnabled /></MemoryRouter>);
    const record = screen.getAllByRole("row")[1]!;
    expect(within(record).getByRole("rowheader")).toHaveClass("text-center");
    within(record).getAllByRole("cell").forEach((cell, index) => {
      expect(cell).toHaveClass("text-center", "px-2");
      if (index >= 4) expect(cell).toHaveClass("min-w-24", "whitespace-nowrap");
    });
    expect(within(record).getByText("9223372036854775807")).toBeInTheDocument();
    expect(within(record).getByRole("link", { name: "Component" })).toHaveClass("mx-auto", "text-center", "font-semibold", "w-50");
    expect(within(record).getByRole("link", { name: "Component" })).toHaveAttribute("href", "/inventory/same?warehouse=raw_materials");
  });
  it("contains all rows in a focusable, approximately ten-row two-axis viewport with sticky headers", () => {
    render(<MemoryRouter><AllInventoryTable rows={Array.from({ length: 20 }, (_, i) => row(0, `scroll-${i}`))} testsEnabled /></MemoryRouter>);
    const viewport = screen.getByRole("region", { name: "All Inventory results" });
    expect(viewport).toHaveAttribute("tabindex", "0");
    expect(viewport).toHaveClass("max-h-[min(34rem,70dvh)]", "overflow-auto", "overscroll-contain", "scroll-pt-12", "[scrollbar-gutter:stable]");
    const help = document.getElementById(viewport.getAttribute("aria-describedby")!);
    expect(help).toHaveTextContent("arrow keys or Page Up / Page Down");
    expect(viewport).not.toContainElement(help);
    expect(within(viewport).getAllByRole("row")).toHaveLength(21);
    for (const header of within(viewport).getAllByRole("columnheader")) expect(header).toHaveClass("sticky", "top-0", "h-12", "bg-zinc-50");
    for (const record of within(viewport).getAllByRole("row").slice(1)) expect(record).toHaveClass("h-12");
  });
  it("pins aligned identity columns with opaque backgrounds and distinct header/body stacking", () => {
    const long = row(1); long.product.name = "A very long Product identity that must remain accessible without increasing the row height";
    render(<MemoryRouter><AllInventoryTable rows={[long]} testsEnabled /></MemoryRouter>);
    const headers = screen.getAllByRole("columnheader"), record = screen.getAllByRole("row")[1]!;
    const identity = [within(record).getByRole("rowheader"), ...within(record).getAllByRole("cell").slice(0, 2)];
    expect(headers[0]).toHaveClass("left-0", "z-40", "w-12");
    expect(headers[1]).toHaveClass("left-12", "z-40", "w-24");
    expect(headers[2]).toHaveClass("md:left-36", "md:z-40", "w-56");
    expect(identity[0]).toHaveClass("sticky", "left-0", "z-10", "bg-white", "w-12");
    expect(identity[1]).toHaveClass("sticky", "left-12", "z-10", "bg-white", "w-24");
    expect(identity[2]).toHaveClass("md:sticky", "md:left-36", "md:z-10", "bg-white", "w-56");
    const link = within(record).getByRole("link", { name: long.product.name });
    expect(link).toHaveClass("truncate", "w-50"); expect(link).toHaveAttribute("title", long.product.name);
    expect(link).toHaveAttribute("href", "/inventory/same?warehouse=finished_goods");
  });
  it("keeps filters and page navigation outside the internal table scroll region", () => {
    renderView(); const viewport = screen.getByRole("region", { name: "All Inventory results" });
    for (const label of ["Warehouse", "Product status", "Stock Health"]) expect(viewport).not.toContainElement(screen.getByLabelText(label));
    expect(viewport).not.toContainElement(screen.getByRole("navigation", { name: "All Inventory pages" }));
    expect(viewport).not.toContainElement(screen.getByRole("button", { name: "Refresh All Inventory" }));
  });
  it("keeps pre-activation Test and Low Stock columns disabled", () => {
    mocks.gate.mockReturnValue(false);
    render(<MemoryRouter><AllInventoryTable rows={[row(0)]} testsEnabled={false} /></MemoryRouter>);
    expect(screen.queryByRole("columnheader", { name: "Test Holds" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Minimum Stock" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Health" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Physical" })).toBeInTheDocument();
  });
  it("renders authoritative union fields without merging Raw physical with planning or FG reservations", () => {
    const raw = row(0), fg = row(1), customs = row(2);
    raw.product.quantity = 20; fg.product.quantity = 3; customs.product.quantity = 3;
    raw.commitment = { productId: "same", physicalQuantity: 23n, committedToProjects: 5n, availableAfterCommitments: 18n };
    fg.commitment = { productId: "same", physicalQuantity: 3n, committedToProjects: 2n, availableAfterCommitments: 1n };
    raw.health = { productId: "same", warehouseId: raw.warehouse.id, productName: "Component", isActive: true, physicalQuantity: "20", minimumQuantity: "4", version: "9007199254740993", status: "HEALTHY" };
    raw.test = { productId: "same", warehouseId: raw.warehouse.id, quantityScope: "raw_customs_planning", physicalQuantity: "23", projectCommitmentQuantity: "5", availableAfterProjects: "18", committedToTests: "2", availableAfterProjectsAndTests: "16", asOf: "2026-10-28T12:00:00Z", nextExpiry: "2026-10-29T12:00:00Z" };
    render(<MemoryRouter><AllInventoryTable rows={[raw, fg, customs]} testsEnabled /></MemoryRouter>);
    const records = screen.getAllByRole("row").slice(1);
    const cells = (i: number) => within(records[i]!).getAllByRole("cell").map(cell => cell.textContent);
    expect(cells(0).slice(4, 12)).toEqual(["20", "5", "—", "18", "—", "2", "16", "Healthy"]);
    expect(screen.queryByRole("columnheader", { name: "Minimum Stock" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Health" })).toBeInTheDocument();
    expect(cells(1).slice(4, 9)).toEqual(["3", "—", "2", "—", "1"]);
    expect(cells(2).slice(4, 9)).toEqual(["3", "—", "—", "—", "—"]);
    expect(within(records[0]!).getByText("2")).toHaveClass("text-blue-700");
  });
  it("keeps duplicate Products in separate canonical R/F/C rows with exact quantities and originating links", () => {
    render(<MemoryRouter><AllInventoryTable rows={[row(0), row(1), row(2)]} testsEnabled /></MemoryRouter>);
    expect(screen.getAllByRole("columnheader")[0]).toHaveAccessibleName("WH");
    for (const [i, label] of ["R", "F", "C"].entries()) {
      const record = screen.getAllByRole("row")[i + 1]!;
      expect(within(record).getByRole("rowheader")).toHaveTextContent(label);
      expect(within(record).getByLabelText(INVENTORY_WAREHOUSES[i]!.label)).toHaveAttribute("title", INVENTORY_WAREHOUSES[i]!.label);
      expect(within(record).getByRole("link")).toHaveAttribute("href", `/inventory/same?warehouse=${INVENTORY_WAREHOUSES[i]!.code}`);
      expect(within(record).getByText("9223372036854775807")).toBeInTheDocument();
      expect(within(record).getAllByText("Unavailable").length).toBeGreaterThan(0);
      expect(within(record).getAllByText("—").length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole("button", { name: /Adjust|Save|Configure/ })).not.toBeInTheDocument();
  });
  it("filters warehouse scope and lifecycle without exposing denied warehouse choices", () => {
    renderView([INVENTORY_WAREHOUSES[0]!.id]);
    expect(screen.queryByRole("option", { name: /Finished Goods|Customs/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Warehouse"), { target: { value: "raw_materials" } });
    expect(mocks.read).toHaveBeenLastCalledWith([INVENTORY_WAREHOUSES[0]!.id], "part", "raw_materials", true);
    fireEvent.change(screen.getByLabelText("Product status"), { target: { value: "archived" } });
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });
  it("keeps the authoritative Stock Health filter after removing the minimum column", () => {
    const healthy = row(0, "healthy"), low = row(1, "low");
    healthy.health = { productId: "healthy", warehouseId: healthy.warehouse.id, productName: "Component", isActive: true, physicalQuantity: "20", minimumQuantity: "4", version: "1", status: "HEALTHY" };
    low.health = { ...healthy.health, productId: "low", warehouseId: low.warehouse.id, productName: "Calculator", status: "LOW_STOCK" };
    mocks.read.mockReturnValue({ ...defaults(), rows: [healthy, low] }); renderView();
    fireEvent.change(screen.getByLabelText("Stock Health"), { target: { value: "LOW_STOCK" } });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Calculator" })).toHaveAttribute("href", "/inventory/low?warehouse=finished_goods");
    expect(screen.queryByRole("link", { name: "Component" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Minimum Stock" })).not.toBeInTheDocument();
  });
  it("paginates Product/warehouse pairs without omission or duplication", () => {
    mocks.read.mockReturnValue({ ...defaults(), rows: Array.from({ length: 51 }, (_, i) => row(0, `id-${i}`)) });
    renderView(); expect(screen.getAllByRole("row")).toHaveLength(51);
    expect(screen.getByText("Page 1 of 2 · 51 Product/warehouse rows")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" })); expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Component" })).toHaveAttribute("href", "/inventory/id-50?warehouse=raw_materials");
    fireEvent.change(screen.getByLabelText("Product status"), { target: { value: "active" } });
    expect(screen.getByText("Page 1 of 2 · 51 Product/warehouse rows")).toBeInTheDocument();
  });
  it.each(["pending", "failure", "empty", "denied", "health"])("distinguishes %s without presenting fabricated zero", state => {
    mocks.read.mockReturnValue({ ...defaults(), rows: [], pending: state === "pending", active: state !== "denied", failure: state === "failure" ? "Incomplete response" : null, healthReady: state !== "health" });
    renderView(); if (state === "health") fireEvent.change(screen.getByLabelText("Stock Health"), { target: { value: "LOW_STOCK" } });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText({pending:"Loading complete authorized Inventory…",failure:"Incomplete response",empty:"No Products match the authorized Inventory filters.",denied:"Access denied",health:"Stock health unavailable"}[state]!)).toBeInTheDocument();
  });
});
