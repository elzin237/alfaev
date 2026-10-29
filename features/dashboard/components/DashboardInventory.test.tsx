import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import DashboardInventory from "./DashboardInventory";
import type { DashboardInventorySection } from "../services/dashboardService";
const catalog = vi.hoisted(() => ({ read: vi.fn(), retry: vi.fn() }));
vi.mock("../hooks/useDashboardRawCatalog", () => ({ useDashboardRawCatalog: catalog.read }));

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

beforeEach(() => catalog.read.mockImplementation(products => ({ products, status: "ready", query: { refetch: catalog.retry } })));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("DashboardInventory", () => {
  it("renders nothing when the backend section is unauthorized", () => {
    const { container } = render(<DashboardInventory section={null} />, {
      wrapper: MemoryRouter,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("preserves backend Product order and exact Raw quantities without duplicating the KPI", () => {
    render(<DashboardInventory section={section} />, { wrapper: MemoryRouter });

    expect(screen.queryByText("Active Products")).not.toBeInTheDocument();
    expect(screen.getAllByText("Raw physical quantity")).toHaveLength(2);
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
        .toHaveAttribute("href", `/inventory/${product.productId}?warehouse=raw_materials`);
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
    expect(screen.getByText("No active Raw Materials Products in the recent catalog window.")).toBeInTheDocument();
    expect(screen.getByText("Project-demand attention")).toBeInTheDocument();
    expect(screen.getByText(/Project-demand deficits are unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Products")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /minimum/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/critical|low stock|supplier/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows only canonical Raw members, without treating missing membership as zero", () => {
    catalog.read.mockReturnValue({ products: [section.recent[1]], status: "ready", query: {} });
    render(<DashboardInventory section={section} />, { wrapper: MemoryRouter });
    expect(screen.queryByRole("link", { name: "Newest Product" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Second Product" })).toHaveAttribute("href", `/inventory/${section.recent[1]!.productId}?warehouse=raw_materials`);
  });

  it.each(["loading", "error", "denied"])("does not render legacy candidates when verification is %s", status => {
    catalog.read.mockReturnValue({ products: undefined, status, query: { refetch: catalog.retry } });
    render(<DashboardInventory section={section} />, { wrapper: MemoryRouter });
    expect(screen.queryByRole("link", { name: "Newest Product" })).not.toBeInTheDocument();
    if (status === "error") expect(screen.getByRole("alert")).toHaveTextContent("membership is unavailable");
    if (status === "denied") expect(screen.queryByText(/Recent catalog updates/)).not.toBeInTheDocument();
  });
});
