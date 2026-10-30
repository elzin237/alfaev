import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProcurementList from "./ProcurementList";
import type { ProcurementRequestListItem } from "../services/procurementService";

const request: ProcurementRequestListItem = {
  requestId: "request-1",
  productId: "product-1",
  productSerialNumber: "0000012",
  requestedName: "Precision resistor assembly with a long Product name",
  supplierId: "supplier-1",
  supplierName: "International Electronic Components Supplier",
  requestedQuantity: 120,
  deliveredQuantity: 45,
  remainingQuantity: 75,
  status: "partly_delivered",
  createdAt: "2026-10-29T12:00:00Z",
  createdByUserId: "user-1",
  createdByFullName: "Alexandra Procurement Administrator",
};

afterEach(cleanup);

describe("ProcurementList compact presentation", () => {
  it("uses compact centered headings with accessible full meanings", () => {
    render(<ProcurementList requests={[request]} onResolve={vi.fn()} />);
    expect(screen.getAllByRole("columnheader").map((header) => header.querySelector("[title]")?.textContent))
      .toEqual(["Serial", "Product", "Supplier", "Requested", "Delivered", "Remaining", "Status", "Created By", "Actions"]);
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header).toHaveClass("text-center", "px-2", "py-3", "whitespace-nowrap");
      expect(header).toHaveAttribute("aria-describedby");
    }
    expect(screen.getByRole("columnheader", { name: "Serial" })).toHaveAccessibleDescription("Product Serial Number.");
    expect(screen.getByRole("columnheader", { name: "Requested" })).toHaveAccessibleDescription("Requested Quantity for this Procurement request.");
    expect(screen.getByTitle("Quantity delivered so far.")).toHaveTextContent("Delivered");
  });

  it("centers unchanged values, keeps Product bold and allows long names to wrap", () => {
    render(<ProcurementList requests={[request]} />);
    const row = screen.getByText(request.requestedName).closest("tr")!;
    for (const cell of row.querySelectorAll("th, td")) {
      expect(cell).toHaveClass("text-center", "px-2", "py-3", "align-middle");
    }
    expect(screen.getByText(request.requestedName)).toHaveClass("font-semibold", "min-w-40", "[overflow-wrap:anywhere]");
    expect(screen.getByText(request.supplierName!)).toHaveClass("min-w-36", "[overflow-wrap:anywhere]");
    expect(screen.getByText(request.createdByFullName)).toHaveClass("min-w-32");
    for (const quantity of ["120", "45", "75"]) {
      expect(within(row).getByText(quantity)).toHaveClass("w-20", "min-w-20", "tabular-nums");
    }
    expect(within(row).getByText("Partly Delivered")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument();
  });

  it("keeps actions together and preserves their selected-request callbacks", () => {
    const onUpdateDelivery = vi.fn();
    const onResolve = vi.fn();
    const onCreateProduct = vi.fn();
    const unlinked = { ...request, productId: null, productSerialNumber: null };
    const rendered = render(<ProcurementList requests={[unlinked]} onUpdateDelivery={onUpdateDelivery} onResolve={onResolve} onCreateProduct={onCreateProduct} />);
    const update = screen.getByRole("button", { name: "Update Delivery" });
    expect(update.parentElement).toHaveClass("flex-nowrap", "justify-center", "w-max", "[&>button]:shrink-0");
    fireEvent.click(update);
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    fireEvent.click(screen.getByRole("button", { name: "Create component from request" }));
    expect(onUpdateDelivery).toHaveBeenCalledExactlyOnceWith(unlinked);
    expect(onResolve).toHaveBeenCalledExactlyOnceWith(unlinked);
    expect(onCreateProduct).toHaveBeenCalledExactlyOnceWith(unlinked);
    rendered.rerender(<ProcurementList requests={[{ ...unlinked, status: "resolved" }]} onUpdateDelivery={onUpdateDelivery} onResolve={onResolve} onCreateProduct={onCreateProduct} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("provides keyboard-accessible horizontal scrolling without sticky overlap", () => {
    render(<ProcurementList requests={[request]} />);
    const region = screen.getByRole("region", { name: "Procurement requests table" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("overflow-x-auto", "focus-visible:outline-red-500");
    expect(screen.getByRole("table")).toHaveClass("min-w-full");
    expect(region.querySelector(".sticky")).toBeNull();
  });
});
