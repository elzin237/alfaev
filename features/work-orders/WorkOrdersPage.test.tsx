import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pageMocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  useWorkOrders: vi.fn(),
}));

vi.mock("./hooks/useWorkOrders", () => ({
  useWorkOrders: pageMocks.useWorkOrders,
}));

import WorkOrdersPage from "./WorkOrdersPage";
import type { WorkOrderListItem } from "./services/workOrderService";

const workOrders: WorkOrderListItem[] = [
  {
    id: "00000000-0000-4000-8000-000000000002",
    workOrderNumber: "RN-2026-0002",
    status: "finished",
    projectId: "00000000-0000-4000-8000-000000000020",
    projectName: "Alpha Project",
    customerName: "Alpha Customer",
    createdAt: "2026-09-22T10:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000001",
    workOrderNumber: "RN-2026-0001",
    status: "draft",
    projectId: null,
    projectName: null,
    customerName: null,
    createdAt: "2026-09-22T09:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    workOrderNumber: "RN-2025-0003",
    status: "draft",
    projectId: "00000000-0000-4000-8000-000000000030",
    projectName: "Beta Project",
    customerName: "Beta Customer",
    createdAt: "2026-09-21T09:00:00.000Z",
  },
];

function setQueryState(options: {
  data?:
    | { ok: true; value: WorkOrderListItem[] }
    | { ok: false; error: { code: string; message: string } };
  isError?: boolean;
  isPending?: boolean;
} = {}) {
  pageMocks.useWorkOrders.mockReturnValue({
    data: options.data ?? { ok: true, value: workOrders },
    isError: options.isError ?? false,
    isPending: options.isPending ?? false,
    refetch: pageMocks.refetch,
  });
}

function visibleNumbers(): string[] {
  return within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getByRole("rowheader").textContent ?? "");
}

beforeEach(() => setQueryState());

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("WorkOrdersPage", () => {
  it("renders the expected columns, rows, badges, date-times, and incomplete Draft values", () => {
    const { container } = render(<WorkOrdersPage />);

    expect(screen.getByRole("heading", { name: "Work Orders" })).toBeInTheDocument();
    for (const column of [
      "Work Order Number",
      "Project",
      "Customer",
      "Status",
      "Created Date",
    ]) {
      expect(screen.getByRole("columnheader", { name: column })).toBeInTheDocument();
    }
    expect(visibleNumbers()).toEqual(workOrders.map((item) => item.workOrderNumber));
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Finished")).toBeInTheDocument();
    expect(table.getAllByText("Draft")).toHaveLength(2);
    expect(screen.getByText("Not selected")).toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(container.querySelector('time[datetime="2026-09-22T10:00:00.000Z"]'))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create work order/i }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /RN-/ })).not.toBeInTheDocument();
  });

  it("searches Work Order number, Project, and Customer", () => {
    render(<WorkOrdersPage />);
    const search = screen.getByLabelText("Search Work Orders");

    fireEvent.change(search, { target: { value: "2026-0001" } });
    expect(visibleNumbers()).toEqual(["RN-2026-0001"]);

    fireEvent.change(search, { target: { value: " alpha project " } });
    expect(visibleNumbers()).toEqual(["RN-2026-0002"]);

    fireEvent.change(search, { target: { value: "BETA CUSTOMER" } });
    expect(visibleNumbers()).toEqual(["RN-2025-0003"]);
  });

  it("filters Draft and Finished and composes with search", () => {
    render(<WorkOrdersPage />);
    const filter = screen.getByLabelText("Filter by status");

    expect(filter).toHaveValue("all");
    fireEvent.change(filter, { target: { value: "draft" } });
    expect(visibleNumbers()).toEqual(["RN-2026-0001", "RN-2025-0003"]);

    fireEvent.change(screen.getByLabelText("Search Work Orders"), {
      target: { value: "2026" },
    });
    expect(visibleNumbers()).toEqual(["RN-2026-0001"]);

    fireEvent.change(filter, { target: { value: "finished" } });
    expect(visibleNumbers()).toEqual(["RN-2026-0002"]);
  });

  it("shows no matches and clears search and status together", () => {
    render(<WorkOrdersPage />);
    fireEvent.change(screen.getByLabelText("Search Work Orders"), {
      target: { value: "nothing" },
    });
    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "finished" },
    });

    expect(screen.getByRole("heading", { name: "No matching Work Orders" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(screen.getByLabelText("Search Work Orders")).toHaveValue("");
    expect(screen.getByLabelText("Filter by status")).toHaveValue("all");
    expect(visibleNumbers()).toEqual(workOrders.map((item) => item.workOrderNumber));
  });

  it("renders loading, safe retryable error, and true empty states", () => {
    setQueryState({ isPending: true });
    const rendered = render(<WorkOrdersPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Work Orders...");

    setQueryState({
      data: {
        ok: false,
        error: {
          code: "work_order_list_failed",
          message: "The Work Order list could not be loaded.",
        },
      },
    });
    rendered.rerender(<WorkOrdersPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load Work Orders");
    expect(screen.getByRole("alert")).not.toHaveTextContent("raw postgres");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(pageMocks.refetch).toHaveBeenCalledOnce();

    setQueryState({ data: { ok: true, value: [] } });
    rendered.rerender(<WorkOrdersPage />);
    expect(screen.getByRole("heading", { name: "No Work Orders yet." }))
      .toBeInTheDocument();
    expect(screen.queryByLabelText("Search Work Orders")).not.toBeInTheDocument();
  });
});
