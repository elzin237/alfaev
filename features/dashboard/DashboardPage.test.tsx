import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const mocks = vi.hoisted(() => ({ refetch: vi.fn(), useDashboard: vi.fn() }));

vi.mock("./hooks/useDashboard", () => ({ useDashboard: mocks.useDashboard }));
vi.mock("./components/DashboardAlertsControl", () => ({
  default: () => <button type="button">Alerts test control</button>,
}));

import DashboardPage from "./DashboardPage";
import type { DashboardReadModel } from "./services/dashboardService";

const projects: NonNullable<DashboardReadModel["projects"]> = {
  statusCounts: {
    planned: 1,
    inProgress: 0,
    onHold: 0,
    completed: 0,
    cancelled: 0,
  },
  recent: [{
    id: "00000000-0000-4000-8000-000000000001",
    name: "Dashboard Project",
    customerName: "Customer",
    status: "planned",
    deliveryDate: "2026-10-20",
    updatedAt: "2026-10-01T10:00:00Z",
  }],
};

const workOrders: NonNullable<DashboardReadModel["workOrders"]> = {
  recent: [{
    id: "00000000-0000-4000-8000-000000000002",
    workOrderNumber: "RN-2026-0001",
    status: "draft",
    projectId: null,
    customerNameSnapshot: null,
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
    finishedAt: null,
  }],
};

const procurement: NonNullable<DashboardReadModel["procurement"]> = {
  unresolvedCount: 1,
  unresolved: [{
    id: "00000000-0000-4000-8000-000000000003",
    requestedName: "Dashboard Request",
    status: "active",
    requestedQuantity: "2",
    deliveredQuantity: "0",
    remainingQuantity: "2",
    productSerialNumber: null,
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
  }],
};

const inventory: NonNullable<DashboardReadModel["inventory"]> = {
  activeProductCount: 1,
  recent: [{
    productId: "00000000-0000-4000-8000-000000000004",
    serialNumber: "1234567",
    name: "Dashboard Product",
    category: "Component",
    quantity: "8",
    updatedAt: "2026-10-01T10:00:00Z",
  }],
};

const activity: NonNullable<DashboardReadModel["activity"]> = {
  recent: [{
    auditLogId: "00000000-0000-4000-8000-000000000005",
    actorUserId: "00000000-0000-4000-8000-000000000010",
    actorFullName: "Dashboard Actor",
    actionType: "project.updated",
    entityType: "project",
    entityId: "00000000-0000-4000-8000-000000000001",
    summary: "Updated Dashboard Project",
    createdAt: "2026-10-01T10:00:00Z",
  }],
};

const calendar: DashboardReadModel["calendar"] = {
  upcoming: [{
    kind: "event",
    id: "00000000-0000-4000-8000-000000000006",
    title: "Dashboard Event",
    startDate: "2026-10-20",
    endDate: "2026-10-20",
    relatedUserId: null,
  }],
};

function model(
  projectSection: DashboardReadModel["projects"],
  workOrderSection: DashboardReadModel["workOrders"],
  procurementSection: DashboardReadModel["procurement"],
  inventorySection: DashboardReadModel["inventory"],
  activitySection: DashboardReadModel["activity"],
  calendarSection: DashboardReadModel["calendar"],
): DashboardReadModel {
  return {
    projects: projectSection,
    workOrders: workOrderSection,
    procurement: procurementSection,
    inventory: inventorySection,
    activity: activitySection,
    calendar: calendarSection,
  };
}

function setSuccess(
  projectSection: DashboardReadModel["projects"] = projects,
  workOrderSection: DashboardReadModel["workOrders"] = workOrders,
  procurementSection: DashboardReadModel["procurement"] = procurement,
  inventorySection: DashboardReadModel["inventory"] = inventory,
  activitySection: DashboardReadModel["activity"] = activity,
  calendarSection: DashboardReadModel["calendar"] = calendar,
) {
  mocks.useDashboard.mockReturnValue({
    data: {
      ok: true,
      value: model(
        projectSection,
        workOrderSection,
        procurementSection,
        inventorySection,
        activitySection,
        calendarSection,
      ),
    },
    isError: false,
    isPending: false,
    refetch: mocks.refetch,
  });
}

function renderPage() {
  return render(<DashboardPage />, { wrapper: MemoryRouter });
}

beforeEach(() => setSuccess());

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("DashboardPage", () => {
  it("places Alerts in the content heading independently of Dashboard data", () => {
    mocks.useDashboard.mockReturnValue({
      data: undefined,
      isError: false,
      isPending: true,
      refetch: mocks.refetch,
    });
    renderPage();

    const heading = screen.getByRole("heading", { name: "Dashboard" });
    const header = heading.closest("header");
    expect(header).not.toBeNull();
    expect(within(header!).getByRole("button", { name: "Alerts test control" }))
      .toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading Dashboard...");
  });

  it("derives the four summary metrics only from their existing authorized sections", () => {
    const metricProjects = {
      ...projects,
      statusCounts: {
        planned: 2,
        inProgress: 3,
        onHold: 4,
        completed: 50,
        cancelled: 60,
      },
    };
    const metricWorkOrders = {
      recent: [
        ...workOrders.recent,
        {
          ...workOrders.recent[0]!,
          id: "00000000-0000-4000-8000-000000000012",
          workOrderNumber: "RN-2026-0002",
          status: "finished" as const,
          finishedAt: "2026-10-02T10:00:00Z",
        },
      ],
    };
    setSuccess(
      metricProjects,
      metricWorkOrders,
      { ...procurement, unresolvedCount: 7 },
      { ...inventory, activeProductCount: 23 },
      activity,
      calendar,
    );
    renderPage();

    const summary = screen.getByRole("region", { name: "Dashboard summary" });
    for (const [label, value] of [
      ["Active Projects", "9"],
      ["Recent Work Orders", "2"],
      ["Unresolved Procurement", "7"],
      ["Active Products", "23"],
    ] as const) {
      const term = within(summary).getByText(label, { selector: "dt" });
      expect(term.nextElementSibling).toHaveTextContent(value);
    }
    expect(within(summary).queryByText(/open work orders|total work orders|all work orders/i))
      .not.toBeInTheDocument();
  });

  it("omits each summary metric whose protected section is unavailable", () => {
    setSuccess(null, null, null, null, activity, calendar);
    renderPage();

    expect(screen.queryByRole("region", { name: "Dashboard summary" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText("Active Projects")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent Work Orders")).not.toBeInTheDocument();
    expect(screen.queryByText("Unresolved Procurement")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Products")).not.toBeInTheDocument();
  });

  it("shows one loading state without flashing protected widgets or fake values", () => {
    mocks.useDashboard.mockReturnValue({
      data: undefined,
      isError: false,
      isPending: true,
      refetch: mocks.refetch,
    });
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading Dashboard...");
    expect(screen.queryByRole("region", { name: "Projects" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recent Work Orders" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Procurement" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Inventory" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recent Activity" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Upcoming Calendar" }))
      .not.toBeInTheDocument();
  });

  it("shows a safe retryable error and refetches only the Dashboard query", () => {
    mocks.useDashboard.mockReturnValue({
      data: {
        ok: false,
        error: {
          code: "dashboard_load_failed",
          message: "The Dashboard overview could not be loaded.",
        },
      },
      isError: false,
      isPending: false,
      refetch: mocks.refetch,
    });
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Dashboard overview could not be loaded.",
    );
    for (const widget of [
      "Projects", "Recent Work Orders", "Procurement", "Inventory",
      "Recent Activity", "Upcoming Calendar",
    ]) {
      expect(screen.queryByRole("region", { name: widget })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("region", { name: "Dashboard summary" }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("renders PCB production Activity and a finished General Stock Work Order", () => {
    const productionWorkOrders: DashboardReadModel["workOrders"] = {
      recent: [{
        ...workOrders.recent[0]!,
        workOrderNumber: "RN-2026-0013",
        status: "finished",
        projectId: null,
        customerNameSnapshot: null,
        finishedAt: "2026-10-05T11:20:04.966049+00:00",
      }],
    };
    const productionActivity: DashboardReadModel["activity"] = {
      recent: [{
        ...activity.recent[0]!,
        actionType: "pcb_production.completed",
        entityType: "pcb_production_run",
        summary: "Completed PCB production Work Order RN-2026-0013",
      }],
    };
    setSuccess(
      projects,
      productionWorkOrders,
      procurement,
      inventory,
      productionActivity,
      calendar,
    );

    renderPage();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("RN-2026-0013")).toBeInTheDocument();
    expect(screen.getByText("Completed PCB production Work Order RN-2026-0013"))
      .toBeInTheDocument();
  });

  it("preserves Projects when Work Orders are backend-hidden", () => {
    setSuccess(projects, null, null, null, null, calendar);
    renderPage();
    expect(screen.getByRole("region", { name: "Projects" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recent Work Orders" }))
      .not.toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Dashboard summary" });
    expect(within(summary).getByText("Active Projects")).toBeInTheDocument();
    expect(within(summary).queryByText("Recent Work Orders")).not.toBeInTheDocument();
  });

  it("preserves Work Orders when Projects are backend-hidden", () => {
    setSuccess(null, workOrders, null, null, null, calendar);
    renderPage();
    expect(screen.queryByRole("region", { name: "Projects" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recent Work Orders" }))
      .toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Dashboard summary" });
    expect(within(summary).queryByText("Active Projects")).not.toBeInTheDocument();
    expect(within(summary).getByText("Recent Work Orders")).toBeInTheDocument();
  });

  it("composes Activity and Calendar alongside every Task 141 and Task 142 widget", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recent Work Orders" }))
      .toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Procurement" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Inventory" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recent Activity" }))
      .toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Upcoming Calendar" }))
      .toBeInTheDocument();
  });

  it("renders Procurement without Inventory when only that Task 142 section is authorized", () => {
    setSuccess(null, null, procurement, null, null, calendar);
    renderPage();
    expect(screen.getByRole("region", { name: "Procurement" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Inventory" })).not.toBeInTheDocument();
    expect(screen.queryByText("No operational overview is available for your account."))
      .not.toBeInTheDocument();
  });

  it("renders Inventory without Procurement when only that Task 142 section is authorized", () => {
    setSuccess(null, null, null, inventory, null, calendar);
    renderPage();
    expect(screen.queryByRole("region", { name: "Procurement" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Inventory" })).toBeInTheDocument();
    expect(screen.queryByText("No operational overview is available for your account."))
      .not.toBeInTheDocument();
  });

  it("omits every unavailable protected widget while keeping company Calendar", () => {
    setSuccess(null, null, null, null, null, { upcoming: [] });
    renderPage();
    for (const widget of [
      "Projects", "Recent Work Orders", "Procurement", "Inventory", "Recent Activity",
    ]) {
      expect(screen.queryByRole("region", { name: widget })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("region", { name: "Upcoming Calendar" }))
      .toBeInTheDocument();
    expect(screen.getByText("No upcoming calendar entries."))
      .toBeInTheDocument();
  });

  it("hides Activity when null without hiding company Calendar", () => {
    setSuccess(projects, workOrders, procurement, inventory, null, calendar);
    renderPage();
    expect(screen.queryByRole("region", { name: "Recent Activity" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Upcoming Calendar" }))
      .toBeInTheDocument();
  });
});
