import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import DashboardProcurement from "./DashboardProcurement";
import type {
  DashboardProcurementRequest,
  DashboardProcurementSection,
} from "../services/dashboardService";

const requests: DashboardProcurementRequest[] = [
  {
    id: "00000000-0000-4000-8000-000000000005",
    requestedName: "Newest Request",
    status: "partly_delivered",
    requestedQuantity: "9007199254740993",
    deliveredQuantity: "1",
    remainingQuantity: "9007199254740992",
    productSerialNumber: "1234567",
    createdAt: "2026-09-30T08:00:00Z",
    updatedAt: "2026-10-02T10:00:00Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    requestedName: "Second Request",
    status: "active",
    requestedQuantity: "12",
    deliveredQuantity: "0",
    remainingQuantity: "12",
    productSerialNumber: null,
    createdAt: "2026-09-29T08:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
  },
  ...[3, 2, 1].map((number): DashboardProcurementRequest => ({
    id: `00000000-0000-4000-8000-00000000000${number}`,
    requestedName: `Request ${number}`,
    status: "active",
    requestedQuantity: String(number),
    deliveredQuantity: "0",
    remainingQuantity: String(number),
    productSerialNumber: null,
    createdAt: "2026-09-28T08:00:00Z",
    updatedAt: `2026-09-${27 + number}T08:00:00Z`,
  })),
];

const section: DashboardProcurementSection = {
  unresolvedCount: 17,
  unresolved: requests,
};

afterEach(cleanup);

describe("DashboardProcurement", () => {
  it("keeps exact request quantities, statuses and timestamps available in compact Action Center details", () => {
    const {container}=render(<DashboardProcurement section={section} compact />,{wrapper:MemoryRouter});
    expect(screen.getByText("9007199254740992 remaining")).toBeInTheDocument();
    expect(screen.getByText("9007199254740993")).toBeInTheDocument();
    expect(screen.getAllByText("Request details")).toHaveLength(requests.length);
    expect(screen.getByText("Partly Delivered")).toBeInTheDocument();
    expect(screen.getByText("Procurement trends · unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"Newest Request"})).toHaveAttribute("href","/procurement");
    expect(container.querySelector('time[datetime="2026-10-02T10:00:00Z"]')).toBeInTheDocument();
    expect(container.querySelector('a[href^="/procurement/"]')).toBeNull();
  });
  it("renders nothing when the backend section is unauthorized", () => {
    const { container } = render(<DashboardProcurement section={null} />, {
      wrapper: MemoryRouter,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps all backend rows in order without repeating the summary KPI", () => {
    render(<DashboardProcurement section={section} />, { wrapper: MemoryRouter });

    expect(screen.queryByText("Unresolved", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("Unresolved requests · Recently updated")).toBeInTheDocument();
    const renderedNames = requests.map((request) =>
      screen.getByText(request.requestedName));
    expect(renderedNames.map((node) => node.textContent))
      .toEqual(requests.map((request) => request.requestedName));
    for (let index = 1; index < renderedNames.length; index += 1) {
      expect(renderedNames[index - 1]!.compareDocumentPosition(renderedNames[index]!))
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it("shows canonical statuses, assigned and unassigned serials, and exact quantities", () => {
    render(<DashboardProcurement section={section} />, { wrapper: MemoryRouter });

    expect(screen.getByText("Partly Delivered", { selector: "span.inline-flex" }))
      .toBeInTheDocument();
    expect(screen.getAllByText("Active", { selector: "span.inline-flex" }))
      .toHaveLength(4);
    expect(screen.getByText("1234567")).toBeInTheDocument();
    expect(screen.getAllByText("Not assigned")).toHaveLength(4);
    expect(screen.getByText("9007199254740993")).toBeInTheDocument();
    expect(screen.getByText("9007199254740992")).toBeInTheDocument();
    const firstRequestRow = screen.getByText("Newest Request").closest("li");
    expect(firstRequestRow).not.toBeNull();
    expect(within(firstRequestRow!).getByText("1", { selector: "dd" }))
      .toBeInTheDocument();
    expect(screen.queryByText("Resolved", { selector: "span.inline-flex" })).not.toBeInTheDocument();
  });

  it("formats the updated timestamp and provides only the implemented list route", () => {
    const { container } = render(<DashboardProcurement section={section} />, {
      wrapper: MemoryRouter,
    });
    expect(container.querySelector('time[datetime="2026-10-02T10:00:00Z"]'))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all" }))
      .toHaveAttribute("href", "/procurement");
    expect(container.querySelector('a[href^="/procurement/"]')).toBeNull();
  });

  it("keeps an authorized empty section visible without unsupported data or actions", () => {
    render(
      <DashboardProcurement section={{ unresolvedCount: 0, unresolved: [] }} />,
      { wrapper: MemoryRouter },
    );
    expect(screen.getByText("No unresolved procurement requests."))
      .toBeInTheDocument();
    expect(screen.queryByText("Unresolved", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/supplier|contact|urgent|overdue|critical/i))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
