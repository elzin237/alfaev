import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import DashboardWorkOrders from "./DashboardWorkOrders";
import type { DashboardWorkOrdersSection } from "../services/dashboardService";

const section: DashboardWorkOrdersSection = {
  recent: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      workOrderNumber: "RN-2026-0002",
      status: "finished",
      projectId: "00000000-0000-4000-8000-000000000010",
      customerNameSnapshot: "Customer B",
      createdAt: "2026-10-01T08:00:00Z",
      updatedAt: "2026-10-02T09:00:00Z",
      finishedAt: "2026-10-02T10:00:00Z",
    },
    {
      id: "00000000-0000-4000-8000-000000000001",
      workOrderNumber: "RN-2026-0001",
      status: "draft",
      projectId: null,
      customerNameSnapshot: null,
      createdAt: "2026-10-01T07:00:00Z",
      updatedAt: "2026-10-01T11:00:00Z",
      finishedAt: null,
    },
  ],
};

afterEach(cleanup);

describe("DashboardWorkOrders", () => {
  it("renders nothing for a backend-hidden section", () => {
    const { container } = render(<DashboardWorkOrders section={null} />, {
      wrapper: MemoryRouter,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("preserves row order and links every exact Work Order ID", () => {
    render(<DashboardWorkOrders section={section} />, { wrapper: MemoryRouter });
    const links = screen.getAllByRole("link").filter((link) =>
      link.getAttribute("href")?.startsWith("/work-orders/"));
    expect(links.map((link) => link.textContent)).toEqual([
      "RN-2026-0002",
      "RN-2026-0001",
    ]);
    expect(links[0]).toHaveAttribute("href", `/work-orders/${section.recent[0]!.id}`);
    expect(links[1]).toHaveAttribute("href", `/work-orders/${section.recent[1]!.id}`);
    expect(screen.getByRole("link", { name: "View all work orders" }))
      .toHaveAttribute("href", "/work-orders");
  });

  it("uses Finished date for Finished and Updated date for Draft", () => {
    const { container } = render(<DashboardWorkOrders section={section} />, {
      wrapper: MemoryRouter,
    });
    expect(screen.getByText("Finished", { selector: "span.inline-flex" }))
      .toBeInTheDocument();
    expect(screen.getByText("Draft", { selector: "span.inline-flex" }))
      .toBeInTheDocument();
    expect(container.querySelector('time[datetime="2026-10-02T10:00:00Z"]'))
      .toBeInTheDocument();
    expect(container.querySelector('time[datetime="2026-10-01T11:00:00Z"]'))
      .toBeInTheDocument();
    expect(container.querySelector('time[datetime="2026-10-02T09:00:00Z"]'))
      .not.toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });

  it("shows the authorized empty state without material, PDF, or mutation controls", () => {
    render(<DashboardWorkOrders section={{ recent: [] }} />, {
      wrapper: MemoryRouter,
    });
    expect(screen.getByText("No Work Orders yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/materials|PDF|finish|edit|delete/i)).not.toBeInTheDocument();
  });
});
