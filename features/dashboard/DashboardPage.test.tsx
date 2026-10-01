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

function model(
  projectSection: DashboardReadModel["projects"],
  workOrderSection: DashboardReadModel["workOrders"],
  procurementSection: DashboardReadModel["procurement"],
  inventorySection: DashboardReadModel["inventory"],
): DashboardReadModel {
  return {
    projects: projectSection,
    workOrders: workOrderSection,
    procurement: procurementSection,
    inventory: inventorySection,
    activity: null,
    calendar: { upcoming: [] },
  };
}

function setSuccess(
  projectSection: DashboardReadModel["projects"] = projects,
  workOrderSection: DashboardReadModel["workOrders"] = workOrders,
  procurementSection: DashboardReadModel["procurement"] = procurement,
  inventorySection: DashboardReadModel["inventory"] = inventory,
) {
  mocks.useDashboard.mockReturnValue({
    data: {
      ok: true,
      value: model(
        projectSection,
        workOrderSection,
        procurementSection,
        inventorySection,
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
    expect(screen.queryByRole("region", { name: "Nabavka" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Inventory" })).not.toBeInTheDocument();
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
    setSuccess(projects, null, null, null);
    renderPage();
    expect(screen.getByRole("region", { name: "Projects" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recent Work Orders" }))
      .not.toBeInTheDocument();
  });

  it("renders only Work Orders when Projects are backend-hidden", () => {
    setSuccess(null, workOrders, null, null);
    renderPage();
    expect(screen.queryByRole("region", { name: "Projects" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recent Work Orders" }))
      .toBeInTheDocument();
  });

  it("renders all authorized Task 141 and Task 142 widgets", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recent Work Orders" }))
      .toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Nabavka" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Inventory" })).toBeInTheDocument();
  });

  it("renders Procurement without Inventory when only that Task 142 section is authorized", () => {
    setSuccess(null, null, procurement, null);
    renderPage();
    expect(screen.getByRole("region", { name: "Nabavka" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Inventory" })).not.toBeInTheDocument();
    expect(screen.queryByText("No operational overview is available for your account."))
      .not.toBeInTheDocument();
  });

  it("renders Inventory without Procurement when only that Task 142 section is authorized", () => {
    setSuccess(null, null, null, inventory);
    renderPage();
    expect(screen.queryByRole("region", { name: "Nabavka" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Inventory" })).toBeInTheDocument();
    expect(screen.queryByText("No operational overview is available for your account."))
      .not.toBeInTheDocument();
  });

  it("shows a neutral state only when every implemented protected section is hidden", () => {
    setSuccess(null, null, null, null);
    renderPage();
    expect(screen.getByRole("heading", {
      name: "No operational overview is available for your account.",
    })).toBeInTheDocument();
    expect(screen.queryByText(/no permissions/i)).not.toBeInTheDocument();
  });

  it("does not render Task 143 modules or placeholders", () => {
    renderPage();
    for (const heading of ["Activity", "Calendar"]) {
      expect(screen.queryByRole("heading", { name: heading })).not.toBeInTheDocument();
    }
  });
});
