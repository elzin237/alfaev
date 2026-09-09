import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Product } from "../services/productService";
import ProductList from "./ProductList";

const products: Product[] = [
  {
    id: "product-1",
    serialNumber: "0000001",
    name: "Resistor",
    category: "Passive",
    brandId: null,
    brandName: null,
    productKind: "component",
    isActive: true,
  },
  {
    id: "product-2",
    serialNumber: "0000002",
    name: "Legacy Controller",
    category: "Control",
    brandId: "brand-archived",
    brandName: "Archived Brand",
    productKind: "pcb_finished_good",
    isActive: false,
  },
];

afterEach(cleanup);

describe("ProductList", () => {
  it("renders Product fields, nullable Brands, archived Brand history, and status text", () => {
    render(<ProductList products={products} />);

    const activeRow = screen.getByRole("row", {
      name: /0000001 Resistor Passive — Active/,
    });
    const archivedRow = screen.getByRole("row", {
      name: /0000002 Legacy Controller Control Archived Brand Archived/,
    });

    expect(within(activeRow).getByText("—")).toBeInTheDocument();
    expect(within(activeRow).getByText("Active")).toBeInTheDocument();
    expect(within(archivedRow).getByText("Archived Brand")).toBeInTheDocument();
    expect(within(archivedRow).getByText("Archived")).toBeInTheDocument();
  });

  it("contains no quantity, edit, archive, or detail behavior", () => {
    render(<ProductList products={products} />);

    expect(screen.queryByText("Quantity")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
