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
  useProcurementResolve: vi.fn(),
  useProcurementProductCreation: vi.fn(),
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
vi.mock("./hooks/useProcurementResolve", () => ({
  useProcurementResolve: procurementPageMocks.useProcurementResolve,
}));
vi.mock("./hooks/useProcurementProductCreation", () => ({
  useProcurementProductCreation:
    procurementPageMocks.useProcurementProductCreation,
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
  });
  procurementPageMocks.useProcurementDeliveryUpdate.mockReturnValue({
    canUpdateDelivery: false,
    updateDelivery: vi.fn(),
  });
  procurementPageMocks.useProcurementResolve.mockReturnValue({
    canResolve: false,
    isResolving: false,
    resolveRequest: vi.fn(),
  });
  procurementPageMocks.useProcurementProductCreation.mockReturnValue({
    brandsQuery: {
      data: { ok: true, value: [] },
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    },
    canCreateProduct: false,
    createProduct: vi.fn(),
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

  it("renders a nullable Supplier using the canonical empty-value label", () => {
    setSuccessfulQueries([{
      ...requests[1]!,
      supplierId: null,
      supplierName: null,
    }]);
    render(<ProcurementPage />);

    const row = screen.getByText("Partly Delivered Snapshot").closest("tr");
    expect(within(row!).getAllByText("Not assigned")).toHaveLength(2);
    expect(screen.queryByText("null")).not.toBeInTheDocument();
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

  it("shows Resolve for active, partial, and fully delivered unresolved requests only", () => {
    procurementPageMocks.useProcurementResolve.mockReturnValue({
      canResolve: true,
      isResolving: false,
      resolveRequest: vi.fn(),
    });
    const fullyDeliveredUnresolved = {
      ...requests[1]!,
      deliveredQuantity: 10,
      remainingQuantity: 0,
    };
    setSuccessfulQueries([requests[0]!, fullyDeliveredUnresolved, requests[2]!]);
    render(<ProcurementPage />);

    expect(screen.getAllByRole("button", { name: "Resolve" })).toHaveLength(2);
    expect(within(screen.getByText("Active Snapshot").closest("tr")!)
      .getByRole("button", { name: "Resolve" })).toBeInTheDocument();
    expect(within(screen.getByText("Partly Delivered Snapshot").closest("tr")!)
      .getByRole("button", { name: "Resolve" })).toBeInTheDocument();
    expect(within(screen.getByText("Resolved Snapshot").closest("tr")!)
      .queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
  });

  it("requires confirmation, supports cancellation, and preserves Update Delivery separately", () => {
    const resolveRequest = vi.fn();
    procurementPageMocks.useProcurementResolve.mockReturnValue({
      canResolve: true,
      isResolving: false,
      resolveRequest,
    });
    procurementPageMocks.useProcurementDeliveryUpdate.mockReturnValue({
      canUpdateDelivery: true,
      updateDelivery: vi.fn(),
    });
    render(<ProcurementPage />);

    const activeRow = screen.getByText("Active Snapshot").closest("tr")!;
    expect(within(activeRow).getByRole("button", { name: "Update Delivery" }))
      .toBeInTheDocument();
    fireEvent.click(within(activeRow).getByRole("button", { name: "Resolve" }));
    const dialog = screen.getByRole("dialog", {
      name: "Resolve Procurement request",
    });
    expect(dialog).toHaveTextContent("cannot currently be reopened");
    expect(dialog).toHaveTextContent("Delivered Quantity and Inventory will not change");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(resolveRequest).not.toHaveBeenCalled();
  });

  it("confirms once, reports success, and sends only the request ID", async () => {
    let finish: ((value: {
      ok: true;
      value: { requestId: string };
    }) => void) | undefined;
    const resolveRequest = vi.fn(() => new Promise<{
      ok: true;
      value: { requestId: string };
    }>((resolve) => {
      finish = resolve;
    }));
    procurementPageMocks.useProcurementResolve.mockReturnValue({
      canResolve: true,
      isResolving: false,
      resolveRequest,
    });
    render(<ProcurementPage />);

    fireEvent.click(screen.getAllByRole("button", { name: "Resolve" })[0]!);
    const dialog = screen.getByRole("dialog", {
      name: "Resolve Procurement request",
    });
    const confirm = within(dialog).getByRole("button", { name: "Resolve" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(resolveRequest).toHaveBeenCalledTimes(1);
    expect(resolveRequest).toHaveBeenCalledWith(requests[0]!.requestId);

    finish?.({ ok: true, value: { requestId: requests[0]!.requestId } });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Procurement request resolved.",
    );
    expect(screen.queryByRole("dialog", {
      name: "Resolve Procurement request",
    })).not.toBeInTheDocument();
  });

  it("shows a safe Resolve failure and keeps confirmation open", async () => {
    procurementPageMocks.useProcurementResolve.mockReturnValue({
      canResolve: true,
      isResolving: false,
      resolveRequest: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "already_resolved",
          message: "This Procurement request is already resolved.",
        },
      }),
    });
    render(<ProcurementPage />);

    fireEvent.click(screen.getAllByRole("button", { name: "Resolve" })[0]!);
    const dialog = screen.getByRole("dialog", {
      name: "Resolve Procurement request",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Resolve" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This Procurement request is already resolved.",
    );
    expect(dialog).toBeInTheDocument();
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
    const dialog = screen.getByRole("dialog", {
      name: "Add Procurement Request",
    });
    expect(within(dialog).queryByLabelText("Supplier")).not.toBeInTheDocument();
  });

  it("shows Create component only to Admin UX for active/partial unlinked requests", () => {
    const activeUnlinked = {
      ...requests[0]!,
      requestId: "00000000-0000-4000-8000-000000000099",
      productId: null,
      productSerialNumber: null,
      requestedName: "Active Unlinked Snapshot",
    };
    const resolvedUnlinked = {
      ...requests[2]!,
      requestId: "00000000-0000-4000-8000-000000000098",
      productId: null,
      productSerialNumber: null,
    };
    setSuccessfulQueries([
      activeUnlinked,
      requests[0]!,
      requests[1]!,
      resolvedUnlinked,
    ]);
    procurementPageMocks.useProcurementProductCreation.mockReturnValue({
      brandsQuery: {
        data: { ok: true, value: [] },
        isError: false,
        isPending: false,
        refetch: vi.fn(),
      },
      canCreateProduct: true,
      createProduct: vi.fn(),
    });
    render(<ProcurementPage />);

    expect(screen.getAllByRole("button", {
      name: "Create component from request",
    })).toHaveLength(2);
    expect(within(screen.getByText("Active Snapshot").closest("tr")!)
      .queryByRole("button", { name: "Create component from request" }))
      .not.toBeInTheDocument();
    expect(within(screen.getByText("Resolved Snapshot").closest("tr")!)
      .queryByRole("button", { name: "Create component from request" }))
      .not.toBeInTheDocument();
  });

  it("hides Product creation for non-Admin UX and already-linked requests", () => {
    procurementPageMocks.useProcurementProductCreation.mockReturnValue({
      brandsQuery: {
        data: { ok: true, value: [] },
        isError: false,
        isPending: false,
        refetch: vi.fn(),
      },
      canCreateProduct: false,
      createProduct: vi.fn(),
    });
    render(<ProcurementPage />);
    expect(screen.queryByRole("button", {
      name: "Create component from request",
    })).not.toBeInTheDocument();
  });

  it("opens the request-prefilled dialog and reports the generated Serial", async () => {
    const createProduct = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        productId: "00000000-0000-4000-8000-000000000090",
        serialNumber: "0000789",
      },
    });
    procurementPageMocks.useProcurementProductCreation.mockReturnValue({
      brandsQuery: {
        data: { ok: true, value: [] },
        isError: false,
        isPending: false,
        refetch: vi.fn(),
      },
      canCreateProduct: true,
      createProduct,
    });
    render(<ProcurementPage />);

    fireEvent.click(screen.getByRole("button", {
      name: "Create component from request",
    }));
    const dialog = screen.getByRole("dialog", {
      name: "Create component from request",
    });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveValue(
      "Partly Delivered Snapshot",
    );
    expect(within(dialog).getByLabelText("Supplier")).toHaveValue("Supplier B");
    fireEvent.change(within(dialog).getByLabelText("Category"), {
      target: { value: "Components" },
    });
    fireEvent.change(within(dialog).getByLabelText(/Catalog Number/), {
      target: { value: "CAT-789" },
    });
    fireEvent.click(within(dialog).getByRole("button", {
      name: "Create Component",
    }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Component created. Serial Number: 0000789.",
    );
    expect(screen.queryByRole("dialog", {
      name: "Create component from request",
    })).not.toBeInTheDocument();
  });
});
