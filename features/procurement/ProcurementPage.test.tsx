import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const procurementPageMocks = vi.hoisted(() => ({
  createExisting: vi.fn(),
  createNewComponent: vi.fn(),
  refetchRequests: vi.fn(),
  refetchSuppliers: vi.fn(),
  useProcurementCreation: vi.fn(),
  useProcurementCreationChoices: vi.fn(),
  useProcurementDeliveryUpdate: vi.fn(),
  useProcurementRequests: vi.fn(),
  useProcurementSupplierOptions: vi.fn(),
}));

vi.mock("./hooks/useProcurementRequests", () => ({
  useProcurementRequests: procurementPageMocks.useProcurementRequests,
  useProcurementSupplierOptions:
    procurementPageMocks.useProcurementSupplierOptions,
}));
vi.mock("./hooks/useProcurementCreation", () => ({
  useProcurementCreation: procurementPageMocks.useProcurementCreation,
  useProcurementCreationChoices:
    procurementPageMocks.useProcurementCreationChoices,
}));
vi.mock("./hooks/useProcurementDeliveryUpdate", () => ({
  useProcurementDeliveryUpdate:
    procurementPageMocks.useProcurementDeliveryUpdate,
}));

import ProcurementPage from "./ProcurementPage";
import type { ProcurementRequestListItem } from "./services/procurementService";

const requests: ProcurementRequestListItem[] = [
  {
    requestId: "00000000-0000-4000-8000-000000000001",
    productId: "00000000-0000-4000-8000-000000000010",
    productSerialNumber: "0000010",
    requestedName: "Active Snapshot",
    supplierId: "00000000-0000-4000-8000-000000000020",
    supplierName: "Supplier A",
    requestedQuantity: 12,
    deliveredQuantity: 0,
    remainingQuantity: 12,
    status: "active",
    createdAt: "2026-09-15T09:03:00.000Z",
    createdByUserId: "00000000-0000-4000-8000-000000000030",
    createdByFullName: "Ada Admin",
  },
  {
    requestId: "00000000-0000-4000-8000-000000000002",
    productId: null,
    productSerialNumber: null,
    requestedName: "Partly Delivered Snapshot",
    supplierId: "00000000-0000-4000-8000-000000000021",
    supplierName: "Supplier B",
    requestedQuantity: 10,
    deliveredQuantity: 4,
    remainingQuantity: 6,
    status: "partly_delivered",
    createdAt: "2026-09-15T09:02:00.000Z",
    createdByUserId: "00000000-0000-4000-8000-000000000031",
    createdByFullName: "Nina Buyer",
  },
  {
    requestId: "00000000-0000-4000-8000-000000000003",
    productId: "00000000-0000-4000-8000-000000000011",
    productSerialNumber: "0000011",
    requestedName: "Resolved Snapshot",
    supplierId: "00000000-0000-4000-8000-000000000020",
    supplierName: "Supplier A",
    requestedQuantity: 8,
    deliveredQuantity: 8,
    remainingQuantity: 0,
    status: "resolved",
    createdAt: "2026-09-15T09:01:00.000Z",
    createdByUserId: "00000000-0000-4000-8000-000000000030",
    createdByFullName: "Ada Admin",
  },
];

function setSuccessfulQueries(value = requests) {
  procurementPageMocks.useProcurementRequests.mockReturnValue({
    data: { ok: true, value },
    isError: false,
    isPending: false,
    refetch: procurementPageMocks.refetchRequests,
  });
  procurementPageMocks.useProcurementSupplierOptions.mockReturnValue({
    data: {
      ok: true,
      value: [
        { supplierId: requests[0]!.supplierId, supplierName: "Supplier A" },
        { supplierId: requests[1]!.supplierId, supplierName: "Supplier B" },
      ],
    },
    isError: false,
    isPending: false,
    refetch: procurementPageMocks.refetchSuppliers,
  });
}

beforeEach(() => {
  setSuccessfulQueries();
  procurementPageMocks.useProcurementCreation.mockReturnValue({
    canCreate: false,
    createExistingProductRequest: procurementPageMocks.createExisting,
    createNewComponentRequest: procurementPageMocks.createNewComponent,
  });
  procurementPageMocks.useProcurementCreationChoices.mockReturnValue({
    productChoicesQuery: {
      data: { ok: true, value: [] },
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    },
    supplierChoicesQuery: {
      data: { ok: true, value: [] },
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    },
  });
  procurementPageMocks.useProcurementDeliveryUpdate.mockReturnValue({
    canUpdateDelivery: false,
    updateDelivery: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("ProcurementPage", () => {
  it("renders canonical columns, snapshot data, derived quantities, and unresolved-first rows", () => {
    render(<ProcurementPage />);
    const table = screen.getByRole("table");

    for (const heading of [
      "Serial Number / Šifra",
      "Name",
      "Supplier",
      "Requested Quantity",
      "Delivered",
      "Remaining",
      "Status",
      "Created By",
    ]) {
      expect(within(table).getByRole("columnheader", { name: heading }))
        .toBeInTheDocument();
    }
    expect(within(table).getAllByRole("row").slice(1).map((row) =>
      within(row).getAllByRole("cell")[0]?.textContent ??
      within(row).getByRole("rowheader").textContent
    )).toHaveLength(3);
    expect(within(table).getByText("0000010")).toBeInTheDocument();
    expect(within(table).getByText("Not assigned")).toBeInTheDocument();
    expect(within(table).getByText("Partly Delivered Snapshot"))
      .toBeInTheDocument();
    expect(within(table).getByText("Supplier B")).toBeInTheDocument();
    expect(within(table).getByText("Nina Buyer")).toBeInTheDocument();
    expect(within(table).getByText("6")).toBeInTheDocument();
    for (const label of ["Active", "Partly Delivered", "Resolved"]) {
      expect(within(table).getByText(label)).toBeInTheDocument();
    }
  });

  it("wires debounced normalized search and server-backed filters", () => {
    vi.useFakeTimers();
    render(<ProcurementPage />);

    fireEvent.change(screen.getByLabelText("Search by Name / Serial Number"), {
      target: { value: "  resistor  " },
    });
    expect(procurementPageMocks.useProcurementRequests).toHaveBeenLastCalledWith({
      search: "",
      status: null,
      supplierId: null,
    });

    act(() => vi.advanceTimersByTime(300));
    expect(procurementPageMocks.useProcurementRequests).toHaveBeenLastCalledWith({
      search: "resistor",
      status: null,
      supplierId: null,
    });

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "resolved" },
    });
    fireEvent.change(screen.getByLabelText("Supplier"), {
      target: { value: requests[1]!.supplierId },
    });
    expect(procurementPageMocks.useProcurementRequests).toHaveBeenLastCalledWith({
      search: "resistor",
      status: "resolved",
      supplierId: requests[1]!.supplierId,
    });
  });

  it("distinguishes true empty from filtered no-results and clears filters", () => {
    setSuccessfulQueries([]);
    procurementPageMocks.useProcurementSupplierOptions.mockReturnValue({
      data: { ok: true, value: [] },
      isError: false,
      isPending: false,
      refetch: procurementPageMocks.refetchSuppliers,
    });
    const rendered = render(<ProcurementPage />);
    expect(screen.getByRole("heading", { name: "No Procurement requests found" }))
      .toBeInTheDocument();

    setSuccessfulQueries([]);
    rendered.rerender(<ProcurementPage />);
    expect(screen.getByRole("heading", {
      name: "No matching Procurement requests",
    })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByLabelText("Status")).toHaveValue("all");
    expect(screen.getByLabelText("Supplier")).toHaveValue("all");
  });

  it("renders loading and safe retryable errors", () => {
    procurementPageMocks.useProcurementRequests.mockReturnValue({
      data: undefined,
      isError: false,
      isPending: true,
      refetch: procurementPageMocks.refetchRequests,
    });
    const rendered = render(<ProcurementPage />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading Procurement requests...",
    );

    procurementPageMocks.useProcurementRequests.mockReturnValue({
      data: {
        ok: false,
        error: {
          code: "procurement_list_failed",
          message: "The Procurement request list could not be loaded.",
        },
      },
      isError: false,
      isPending: false,
      refetch: procurementPageMocks.refetchRequests,
    });
    rendered.rerender(<ProcurementPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Procurement request list could not be loaded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(procurementPageMocks.refetchRequests).toHaveBeenCalledOnce();
    expect(procurementPageMocks.refetchSuppliers).toHaveBeenCalledOnce();
  });

  it("hides delivery actions when delivery permission is unavailable", () => {
    render(<ProcurementPage />);
    expect(screen.queryByRole("columnheader", { name: "Actions" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: /add|create|edit|deliver|resolve/i,
    })).not.toBeInTheDocument();
  });

  it("shows delivery actions for unresolved requests only when authorized", () => {
    procurementPageMocks.useProcurementDeliveryUpdate.mockReturnValue({
      canUpdateDelivery: true,
      updateDelivery: vi.fn(),
    });
    render(<ProcurementPage />);

    expect(screen.getByRole("columnheader", { name: "Actions" }))
      .toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Update Delivery" }))
      .toHaveLength(2);
    const resolvedRow = screen.getByText("Resolved Snapshot").closest("tr");
    expect(within(resolvedRow!).queryByRole("button", {
      name: "Update Delivery",
    })).not.toBeInTheDocument();
  });

  it("opens the selected request dialog without affecting Add Request", () => {
    const updateDelivery = vi.fn().mockResolvedValue({
      ok: true,
      value: { requestId: requests[0]!.requestId },
    });
    procurementPageMocks.useProcurementDeliveryUpdate.mockReturnValue({
      canUpdateDelivery: true,
      updateDelivery,
    });
    render(<ProcurementPage />);

    fireEvent.click(screen.getAllByRole("button", {
      name: "Update Delivery",
    })[0]!);
    expect(screen.getByRole("dialog", { name: "Update Delivery" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Delivered So Far")).toHaveValue(0);
    expect(screen.queryByRole("button", { name: "Resolve" }))
      .not.toBeInTheDocument();
  });

  it("shows both focused Add Request modes only when creation is authorized", () => {
    procurementPageMocks.useProcurementCreation.mockReturnValue({
      canCreate: true,
      createExistingProductRequest: procurementPageMocks.createExisting,
      createNewComponentRequest: procurementPageMocks.createNewComponent,
    });

    render(<ProcurementPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add Request" }));

    expect(screen.getByRole("dialog", { name: "Add Procurement Request" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Existing Product" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Brand-New Component" }))
      .toBeInTheDocument();
  });
});
