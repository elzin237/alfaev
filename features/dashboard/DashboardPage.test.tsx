import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const mocks = vi.hoisted(() => ({ refetch: vi.fn(), useDashboard: vi.fn() }));

vi.mock("./hooks/useDashboard", () => ({ useDashboard: mocks.useDashboard }));

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

function model(
  projectSection: DashboardReadModel["projects"],
  workOrderSection: DashboardReadModel["workOrders"],
): DashboardReadModel {
  return {
    projects: projectSection,
    workOrders: workOrderSection,
    procurement: null,
    inventory: null,
    activity: null,
    calendar: { upcoming: [] },
  };
}

function setSuccess(
  projectSection: DashboardReadModel["projects"] = projects,
  workOrderSection: DashboardReadModel["workOrders"] = workOrders,
) {
  mocks.useDashboard.mockReturnValue({
    data: { ok: true, value: model(projectSection, workOrderSection) },
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
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("renders only Projects when Work Orders are backend-hidden", () => {
    setSuccess(projects, null);
    renderPage();
    expect(screen.getByRole("region", { name: "Projects" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recent Work Orders" }))
      .not.toBeInTheDocument();
  });

  it("renders only Work Orders when Projects are backend-hidden", () => {
    setSuccess(null, workOrders);
    renderPage();
    expect(screen.queryByRole("region", { name: "Projects" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recent Work Orders" }))
      .toBeInTheDocument();
  });

  it("renders both authorized Task 141 widgets", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recent Work Orders" }))
      .toBeInTheDocument();
  });

  it("shows a neutral Task 141 state when both sections are hidden", () => {
    setSuccess(null, null);
    renderPage();
    expect(screen.getByRole("heading", {
      name: "No Project or Work Order overview is available for your account.",
    })).toBeInTheDocument();
    expect(screen.queryByText(/no permissions/i)).not.toBeInTheDocument();
  });

  it("does not render Task 142 or Task 143 modules or placeholders", () => {
    renderPage();
    for (const heading of ["Procurement", "Inventory", "Activity", "Calendar"]) {
      expect(screen.queryByRole("heading", { name: heading })).not.toBeInTheDocument();
    }
  });
});
