import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import DashboardInventory from "./DashboardInventory";
import type { DashboardInventorySection } from "../services/dashboardService";

const section: DashboardInventorySection = {
  activeProductCount: 23,
  recent: [
    {
      productId: "00000000-0000-4000-8000-000000000003",
      serialNumber: "7654321",
      name: "Newest Product",
      category: "PCB",
      quantity: "9223372036854775807",
      updatedAt: "2026-10-02T10:00:00Z",
    },
    {
      productId: "00000000-0000-4000-8000-000000000002",
      serialNumber: "1234567",
      name: "Second Product",
      category: "Component",
      quantity: "0",
      updatedAt: "2026-10-01T10:00:00Z",
    },
  ],
};

afterEach(cleanup);

describe("DashboardInventory", () => {
  it("renders nothing when the backend section is unauthorized", () => {
    const { container } = render(<DashboardInventory section={null} />, {
      wrapper: MemoryRouter,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the active count and backend Product order with exact values", () => {
    render(<DashboardInventory section={section} />, { wrapper: MemoryRouter });

    expect(screen.getByText("Active Products").nextElementSibling)
      .toHaveTextContent("23");
    const links = section.recent.map((product) =>
      screen.getByRole("link", { name: product.name }));
    expect(links.map((link) => link.textContent))
      .toEqual(["Newest Product", "Second Product"]);
    expect(links[0]!.compareDocumentPosition(links[1]!))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("7654321")).toBeInTheDocument();
    expect(screen.getByText("PCB")).toBeInTheDocument();
    expect(screen.getByText("9223372036854775807")).toBeInTheDocument();
    expect(screen.getByText("0", { selector: "dd" })).toBeInTheDocument();
  });

  it("links exact Product IDs, formats dates, and exposes the Inventory list route", () => {
    const { container } = render(<DashboardInventory section={section} />, {
      wrapper: MemoryRouter,
    });
    for (const product of section.recent) {
      expect(screen.getByRole("link", { name: product.name }))
        .toHaveAttribute("href", `/inventory/${product.productId}`);
    }
    expect(screen.getByRole("link", { name: "View all inventory" }))
      .toHaveAttribute("href", "/inventory");
    expect(container.querySelector('time[datetime="2026-10-02T10:00:00Z"]'))
      .toBeInTheDocument();
  });

  it("keeps an authorized empty section visible without invented alerts or actions", () => {
    render(
      <DashboardInventory section={{ activeProductCount: 0, recent: [] }} />,
      { wrapper: MemoryRouter },
    );
    expect(screen.getByText("No active products yet.")).toBeInTheDocument();
    expect(screen.getByText("Active Products").nextElementSibling)
      .toHaveTextContent("0");
    expect(screen.queryByText(/critical|low stock|minimum|shortage|supplier|history/i))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
