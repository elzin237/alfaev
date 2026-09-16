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

    expect(screen.getByText("Physical Quantity")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Resistor" })).toHaveAttribute(
      "href",
      "/inventory/product-1",
    );
    expect(screen.getByRole("link", { name: "Legacy Controller" }))
      .toHaveAttribute("href", "/inventory/product-2");
  });
});
