import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import type { ProductListItem } from "../services/productService";
import ProductList from "./ProductList";

const products: ProductListItem[] = [
  {
    id: "product-1",
    serialNumber: "0000001",
    name: "Resistor",
    category: "Passive",
    brandName: null,
    productKind: "component",
    isActive: true,
    quantity: 0,
  },
  {
    id: "product-2",
    serialNumber: "0000002",
    name: "Legacy Controller",
    category: "Control",
    brandName: "Archived Brand",
    productKind: "pcb_finished_good",
    isActive: false,
    quantity: 14,
  },
];

afterEach(cleanup);

describe("ProductList", () => {
  it.each(["raw_materials", "finished_goods"])("centers compact %s headings and values with accessible warehouse-specific meanings", warehouseCode => {
    render(<MemoryRouter><ProductList warehouseCode={warehouseCode} products={products} showTestCommitments showStockHealth /></MemoryRouter>);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map(header => header.getAttribute("aria-label"))).toEqual([
      "Serial", "Product", "Category", "Brand", "Physical", warehouseCode === "raw_materials" ? "Project Demand" : "FG Reserved", "Available", "Test Holds", "Net Available", "Health", "Status",
    ]);
    for (const header of headers) {
      expect(header).toHaveClass("text-center", "px-2", "py-3", "whitespace-nowrap");
      const help = header.querySelector("[tabindex='0']")!;
      expect(help).toHaveAttribute("title"); expect(help).toHaveClass("focus-visible:outline-2");
      expect(document.getElementById(help.getAttribute("aria-describedby")!)).toHaveAttribute("role", "tooltip");
    }
    for (const record of screen.getAllByRole("row").slice(1)) {
      for (const cell of [within(record).getByRole("rowheader"), ...within(record).getAllByRole("cell")]) {
        expect(cell).toHaveClass("text-center", "px-2", "py-3");
      }
    }
    const link = screen.getByRole("link", { name: "Legacy Controller" });
    expect(link).toHaveClass("text-center", "max-w-56", "[overflow-wrap:anywhere]");
    expect(link.parentElement).toHaveClass("font-semibold");
    expect(link).toHaveAttribute("href", `/inventory/product-2?warehouse=${warehouseCode}`);
    expect(screen.getByRole("columnheader", { name: "Available" })).toHaveAccessibleDescription(warehouseCode === "raw_materials" ? /Raw and Customs physical stock minus outstanding Project demand/ : /Finished Goods physical stock minus hard FG Project reservations/);
    expect(screen.getByRole("columnheader", { name: "Net Available" })).toHaveAccessibleDescription(warehouseCode === "raw_materials" ? /active Raw\/Customs Test holds/ : /active FG Test holds/);
    expect(screen.getByRole("columnheader", { name: "Test Holds" })).toHaveClass("text-blue-700");
    expect(screen.getByRole("table").parentElement).toHaveClass("overflow-x-auto");
    expect(screen.getByRole("table").parentElement).not.toHaveClass("overflow-auto");
  });
  it("shows one snapshot of FG physical / hard reserved / available without foreign Project identities", () => {
    render(<MemoryRouter><ProductList warehouseCode="finished_goods" products={products}
      commitments={new Map([["product-1", { productId: "product-1", physicalQuantity: 9007199254740993n,
        committedToProjects: 8n, availableAfterCommitments: 9007199254740985n }]])} /></MemoryRouter>);
    expect(screen.getByRole("columnheader", { name: "FG Reserved" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Available" })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Resistor/ });
    for (const value of ["9007199254740993", "8", "9007199254740985"]) expect(within(row).getByText(value)).toBeInTheDocument();
    expect(screen.queryByText("Eligible Stock (Raw + Customs)")).not.toBeInTheDocument();
  });
  it("hides Raw eligible stock while preserving physical, commitments and existing availability values", () => {
    render(<MemoryRouter><ProductList warehouseCode="raw_materials" products={[products[0]!]}
      commitments={new Map([["product-1", { productId: "product-1", physicalQuantity: 12n,
        committedToProjects: 5n, availableAfterCommitments: 7n }]])} /></MemoryRouter>);
    const row = screen.getByRole("row", { name: /Resistor/ });
    expect(screen.getAllByRole("columnheader").map(cell=>cell.getAttribute("aria-label"))).toEqual([
      "Serial","Product","Category","Brand","Physical","Project Demand","Available","Status",
    ]);
    expect(screen.queryByText("Eligible Stock (Raw + Customs)")).not.toBeInTheDocument();
    expect(within(row).queryByText("12")).not.toBeInTheDocument();
    for (const value of ["0", "5", "7"]) expect(within(row).getByText(value)).toBeInTheDocument();
  });
  it.each(["raw_materials","finished_goods"])("uses warehouse-specific quantity headings with consistent spacing and overflow for %s",warehouseCode=>{
    render(<MemoryRouter><ProductList warehouseCode={warehouseCode} products={[products[0]!]}
      commitments={new Map([["product-1",{productId:"product-1",physicalQuantity:12n,committedToProjects:5n,availableAfterCommitments:7n}]])} /></MemoryRouter>);
    expect(screen.getAllByRole("columnheader").slice(4,7).map(cell=>cell.getAttribute("aria-label"))).toEqual(warehouseCode === "finished_goods"
      ? ["Physical","FG Reserved","Available"]
      : ["Physical","Project Demand","Available"]);
    const cells=within(screen.getByRole("row",{name:/Resistor/})).getAllByRole("cell").slice(3,6);
    expect(cells).toHaveLength(3);
    for(const cell of cells)expect(cell).toHaveClass("whitespace-nowrap","px-2","py-3","text-center","min-w-24","tabular-nums");
    expect(screen.getByRole("table").parentElement).toHaveClass("overflow-x-auto");
  });
  it("keeps Customs physical-only columns and warehouse quantity unchanged",()=>{
    render(<MemoryRouter><ProductList warehouseCode="customs" products={[products[1]!]} showCommitments={false} /></MemoryRouter>);
    expect(screen.getAllByRole("columnheader").map(cell=>cell.textContent)).toEqual([
      "Serial Number","Name","Category","Brand","Physical Quantity","Status",
    ]);
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.queryByText("Committed to Projects")).not.toBeInTheDocument();
    expect(screen.getByRole("table").parentElement).toHaveClass("overflow-x-auto");
    for (const header of screen.getAllByRole("columnheader")) expect(header).toHaveClass("px-5", "py-4", "text-left");
  });
  const commitments = new Map([
    ["product-1", { productId: "product-1", physicalQuantity: 0n, committedToProjects: 5n, availableAfterCommitments: -5n }],
    ["product-2", { productId: "product-2", physicalQuantity: 14n, committedToProjects: 0n, availableAfterCommitments: 14n }],
  ]);
  it("renders Product fields, nullable Brands, archived Brand history, and status text", () => {
    render(<MemoryRouter><ProductList products={products} commitments={commitments} /></MemoryRouter>);

    const activeRow = screen.getByRole("row", {
      name: /0000001 Resistor Passive — 0 5 -5 — Shortage: 5 Active/,
    });
    const archivedRow = screen.getByRole("row", {
      name: /0000002 Legacy Controller Control Archived Brand 14 0 14 Archived/,
    });

    expect(within(activeRow).getByText("—")).toBeInTheDocument();
    expect(within(activeRow).getByText("0")).toBeInTheDocument();
    expect(within(activeRow).getByText("Active")).toBeInTheDocument();
    expect(within(archivedRow).getByText("Archived Brand")).toBeInTheDocument();
    expect(within(archivedRow).getAllByText("14").length).toBeGreaterThan(0);
    expect(within(archivedRow).getByText("Archived")).toBeInTheDocument();
  });

  it("links Product names to detail without quantity mutation actions", () => {
    render(<MemoryRouter><ProductList products={products} commitments={commitments} /></MemoryRouter>);

    expect(screen.getByRole("columnheader", { name: "Physical" })).toHaveAccessibleDescription(/Raw Physical Quantity/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Resistor" })).toHaveAttribute(
      "href",
      "/inventory/product-1",
    );
    expect(screen.getByRole("link", { name: "Legacy Controller" }))
      .toHaveAttribute("href", "/inventory/product-2");
  });
});
