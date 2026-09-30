import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { renderToStaticMarkup } from "react-dom/server";

const pageMocks = vi.hoisted(() => ({
  deleteDraft: vi.fn(),
  detailRefetch: vi.fn(),
  materialsRefetch: vi.fn(),
  projectChoicesRefetch: vi.fn(),
  reloadLatestDraft: vi.fn(),
  loadMaterial: vi.fn(),
  saveDraft: vi.fn(),
  useWorkOrderDetail: vi.fn(),
}));

vi.mock("./hooks/useWorkOrderDetail", () => ({
  useWorkOrderDetail: pageMocks.useWorkOrderDetail,
}));

import WorkOrderDetailPage from "./WorkOrderDetailPage";
import WorkOrderDraftShell from "./components/WorkOrderDraftShell";

const workOrderId = "00000000-0000-4000-8000-000000000010";
const projectId = "00000000-0000-4000-8000-000000000020";
const replacementProjectId = "00000000-0000-4000-8000-000000000021";
const draft = {
  id: workOrderId,
  workOrderNumber: "RN-2026-0042",
  status: "draft" as const,
  projectId,
  projectName: "Alpha Project",
  customerName: "Alpha Customer Snapshot",
  description: "Build enclosure",
  createdAt: "2026-09-22T09:00:00.000Z",
  updatedAt: "2026-09-22T10:00:00.000Z",
};
const projectChoices = [
  {
    id: projectId,
    name: "Alpha Project",
    customerName: "Alpha Current Customer",
    status: "planned" as const,
  },
  {
    id: replacementProjectId,
    name: "Beta Project",
    customerName: "Beta Customer",
    status: "in_progress" as const,
  },
];

function successfulHook(overrides: Record<string, unknown> = {}) {
  return {
    canDeleteDraft: false,
    canEditDraft: true,
    canFinishDraft: false,
    detailQuery: {
      data: { ok: true, value: draft },
      isError: false,
      isPending: false,
      refetch: pageMocks.detailRefetch,
    },
    projectChoicesQuery: {
      data: { ok: true, value: projectChoices },
      isError: false,
      isPending: false,
      refetch: pageMocks.projectChoicesRefetch,
    },
    materialsQuery: {
      data: { ok: true, value: [] },
      isError: false,
      isPending: false,
      refetch: pageMocks.materialsRefetch,
    },
    isSaving: false,
    isDeleting: false,
    isLoadingMaterial: false,
    reloadLatestDraft: pageMocks.reloadLatestDraft,
    loadMaterial: pageMocks.loadMaterial,
    saveDraft: pageMocks.saveDraft,
    deleteDraft: pageMocks.deleteDraft,
    ...overrides,
  };
}

function pageTree(path = `/work-orders/${workOrderId}`, state?: unknown) {
  return (
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/work-orders" element={<p>Work Orders destination</p>} />
        <Route path="/work-orders/:workOrderId" element={<WorkOrderDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderPage(path = `/work-orders/${workOrderId}`, state?: unknown) {
  return render(pageTree(path, state));
}

beforeEach(() => {
  pageMocks.reloadLatestDraft.mockResolvedValue({
    ok: true,
    detail: draft,
    materials: [],
  });
  pageMocks.saveDraft.mockResolvedValue({
    ok: true,
    value: {
      workOrderId,
      updatedAt: "2026-09-22T10:01:00.123456+00:00",
    },
  });
  pageMocks.deleteDraft.mockResolvedValue({
    ok: true,
    value: { workOrderId, workOrderNumber: draft.workOrderNumber },
  });
  pageMocks.loadMaterial.mockResolvedValue({
    ok: true,
    value: {
      productId: "00000000-0000-4000-8000-000000000030",
      serialNumber: "0000123",
      productName: "Relay Module",
      currentInventory: "17",
    },
  });
  pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook());
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("WorkOrderDetailPage", () => {
  it("keeps a successful material query gated until local hydration is established", async () => {
    const persistedMaterial = {
      productId: "00000000-0000-4000-8000-000000000030",
      serialNumber: "0000123",
      productName: "Relay Module",
      quantity: "2",
      currentInventory: "17",
    };
    const onSave = vi.fn().mockResolvedValue({
      ok: true,
      value: { workOrderId, updatedAt: draft.updatedAt },
    });
    const props = {
      workOrder: draft,
      canEdit: true,
      canDelete: true,
      canFinish: false,
      projectChoices,
      projectChoicesError: null,
      projectChoicesLoading: false,
      persistedMaterials: [persistedMaterial],
      materialsLoading: false,
      materialsError: null,
      materialsReady: true,
      isSaving: false,
      isDeleting: false,
      isLoadingMaterial: false,
      onReloadLatest: vi.fn().mockResolvedValue({ ok: false }),
      onRetryMaterials: vi.fn(),
      onRetryProjectChoices: vi.fn(),
      onLoadMaterial: vi.fn(),
      onSave,
      onDelete: pageMocks.deleteDraft,
    };

    const beforeHydration = document.createElement("div");
    beforeHydration.innerHTML = renderToStaticMarkup(
      <WorkOrderDraftShell {...props} />,
    );
    expect(within(beforeHydration).getByRole("button", {
      name: "Save for Later",
    })).toBeDisabled();
    expect(within(beforeHydration).queryByRole("textbox", {
      name: "Scan Product Barcode",
    })).not.toBeInTheDocument();
    expect(within(beforeHydration).getByRole("status"))
      .toHaveTextContent("Preparing Draft materials...");
    expect(within(beforeHydration).queryByText("No materials added yet."))
      .not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    render(<WorkOrderDraftShell {...props} />);
    expect(await screen.findByText("Relay Module")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save for Later" }))
      .toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Scan Product Barcode" }))
      .toBeEnabled();
  });

  it("enables a truly empty material baseline only after local hydration", async () => {
    const props = {
      workOrder: draft,
      canEdit: true,
      canDelete: true,
      canFinish: false,
      projectChoices,
      projectChoicesError: null,
      projectChoicesLoading: false,
      persistedMaterials: [],
      materialsLoading: false,
      materialsError: null,
      materialsReady: true,
      isSaving: false,
      isDeleting: false,
      isLoadingMaterial: false,
      onReloadLatest: vi.fn().mockResolvedValue({ ok: false }),
      onRetryMaterials: vi.fn(),
      onRetryProjectChoices: vi.fn(),
      onLoadMaterial: vi.fn(),
      onSave: vi.fn(),
      onDelete: pageMocks.deleteDraft,
    };
    const beforeHydration = document.createElement("div");
    beforeHydration.innerHTML = renderToStaticMarkup(
      <WorkOrderDraftShell {...props} />,
    );
    expect(within(beforeHydration).queryByText("No materials added yet."))
      .not.toBeInTheDocument();
    expect(within(beforeHydration).getByRole("button", {
      name: "Save for Later",
    })).toBeDisabled();

    render(<WorkOrderDraftShell {...props} />);
    expect(await screen.findByText("No materials added yet."))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save for Later" }))
      .toBeEnabled();
  });

  it("shows not found for an invalid route ID", () => {
    renderPage("/work-orders/not-a-uuid");

    expect(screen.getByRole("heading", { name: "Work Order not found" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" }))
      .not.toBeInTheDocument();
  });

  it("shows loading, retryable failure, and safe missing states", () => {
    pageMocks.useWorkOrderDetail.mockReturnValueOnce(successfulHook({
      detailQuery: {
        data: undefined,
        isError: false,
        isPending: true,
        refetch: pageMocks.detailRefetch,
      },
    }));
    const loading = renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading Work Order...");
    loading.unmount();

    pageMocks.useWorkOrderDetail.mockReturnValueOnce(successfulHook({
      detailQuery: {
        data: {
          ok: false,
          error: {
            code: "work_order_detail_failed",
            message: "The Work Order details could not be loaded.",
          },
        },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
    }));
    const failed = renderPage();
    expect(screen.getByRole("heading", { name: "Unable to load Work Order" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(pageMocks.detailRefetch).toHaveBeenCalledOnce();
    failed.unmount();

    pageMocks.useWorkOrderDetail.mockReturnValueOnce(successfulHook({
      detailQuery: {
        data: {
          ok: false,
          error: {
            code: "work_order_not_found",
            message: "The Work Order could not be found.",
          },
        },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
    }));
    renderPage();
    expect(screen.getByRole("heading", { name: "Work Order not found" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" }))
      .not.toBeInTheDocument();
  });

  it("uses authoritative detail on a direct route and ignores navigation-state data", () => {
    renderPage(`/work-orders/${workOrderId}`, {
      createdWorkOrder: {
        workOrderId,
        workOrderNumber: "RN-1999-9999",
      },
    });

    expect(screen.getByRole("heading", { name: "RN-2026-0042" }))
      .toBeInTheDocument();
    expect(screen.queryByText("RN-1999-9999")).not.toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Work Orders" }))
      .toHaveAttribute("href", "/work-orders");
  });

  it("renders the editable local shell and previews Customer from a new Project", () => {
    renderPage();

    expect(screen.getByLabelText("Customer")).toHaveValue(
      "Alpha Customer Snapshot",
    );
    expect(screen.getByLabelText("Short Description")).toHaveValue(
      "Build enclosure",
    );
    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: replacementProjectId },
    });
    expect(screen.getByLabelText("Customer")).toHaveValue("Beta Customer");
    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "Local description" },
    });
    expect(screen.getByLabelText("Short Description")).toHaveValue(
      "Local description",
    );
    expect(screen.getByRole("button", { name: "Save for Later" }))
      .toBeEnabled();
    expect(screen.getByRole("heading", { name: "Materials" }))
      .toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Scan Product Barcode" }))
      .toBeInTheDocument();
    expect(screen.getByText("No materials added yet."))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /finish|delete/i }))
      .not.toBeInTheDocument();
  });

  it("adds distinct scanned Products as local material rows with exact Inventory", async () => {
    renderPage();
    const scanner = screen.getByRole("textbox", {
      name: "Scan Product Barcode",
    });
    scanner.focus();
    fireEvent.change(scanner, { target: { value: "0000123" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(pageMocks.loadMaterial)
      .toHaveBeenCalledExactlyOnceWith("0000123"));
    expect(screen.getByRole("columnheader", { name: "Serial Number" }))
      .toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Product Name" }))
      .toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Quantity" }))
      .toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Current Inventory" }))
      .toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Remove" }))
      .toBeInTheDocument();
    expect(screen.getByText("0000123")).toBeInTheDocument();
    expect(screen.getByText("Relay Module")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    const firstQuantity = screen.getByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    });
    expect(firstQuantity).toHaveValue("");
    expect(scanner).toHaveValue("");
    expect(firstQuantity).toHaveFocus();
    expect(pageMocks.saveDraft).not.toHaveBeenCalled();

    pageMocks.loadMaterial.mockResolvedValueOnce({
      ok: true,
      value: {
        productId: "00000000-0000-4000-8000-000000000031",
        serialNumber: "7654321",
        productName: "Controller Board",
        currentInventory: "0",
      },
    });
    fireEvent.change(scanner, { target: { value: "7654321" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });
    expect(await screen.findByText("Controller Board"))
      .toBeInTheDocument();
    expect(screen.getByText("7654321")).toBeInTheDocument();
    expect(screen.getByText("0000123")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(pageMocks.saveDraft).not.toHaveBeenCalled();
  });

  it("focuses an existing Product without replacing its Quantity or Inventory snapshot", async () => {
    renderPage();
    const scanner = screen.getByRole("textbox", {
      name: "Scan Product Barcode",
    });
    fireEvent.change(scanner, { target: { value: "0000123" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });
    const quantity = await screen.findByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    });
    fireEvent.change(quantity, { target: { value: "25" } });
    scanner.focus();

    pageMocks.loadMaterial.mockResolvedValueOnce({
      ok: true,
      value: {
        productId: "00000000-0000-4000-8000-000000000030",
        serialNumber: "0000123",
        productName: "Relay Module",
        currentInventory: "999",
      },
    });
    fireEvent.change(scanner, { target: { value: "0000123" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(pageMocks.loadMaterial).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    })).toHaveLength(1);
    expect(quantity).toHaveValue("25");
    expect(quantity).toHaveFocus();
    const row = screen.getByText("0000123").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("17")).toBeInTheDocument();
    expect(within(row!).queryByText("999")).not.toBeInTheDocument();
  });

  it("uses stable Product identity across multiple rows, removal, and rescan", async () => {
    renderPage();
    const scanner = screen.getByRole("textbox", {
      name: "Scan Product Barcode",
    });
    const scan = (serialNumber: string) => {
      fireEvent.change(scanner, { target: { value: serialNumber } });
      fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });
    };

    scan("0000123");
    const quantityA = await screen.findByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    });
    pageMocks.loadMaterial.mockResolvedValueOnce({
      ok: true,
      value: {
        productId: "00000000-0000-4000-8000-000000000031",
        serialNumber: "0000456",
        productName: "Controller Board",
        currentInventory: "8",
      },
    });
    scan("0000456");
    const quantityB = await screen.findByRole("textbox", {
      name: "Quantity for Controller Board (0000456)",
    });
    expect(quantityB).toHaveFocus();
    pageMocks.loadMaterial.mockResolvedValueOnce({
      ok: true,
      value: {
        productId: "00000000-0000-4000-8000-000000000032",
        serialNumber: "0000789",
        productName: "Power Board",
        currentInventory: "9",
      },
    });
    scan("0000789");
    const quantityC = await screen.findByRole("textbox", {
      name: "Quantity for Power Board (0000789)",
    });
    fireEvent.change(quantityC, { target: { value: "7" } });
    expect(quantityC).toHaveFocus();
    const stableQuantityCId = quantityC.id;

    fireEvent.click(screen.getByRole("button", {
      name: "Remove Controller Board (0000456)",
    }));
    expect(screen.queryByText("Controller Board")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", {
      name: "Quantity for Power Board (0000789)",
    })).toHaveAttribute("id", stableQuantityCId);

    pageMocks.loadMaterial.mockResolvedValueOnce({
      ok: true,
      value: {
        productId: "00000000-0000-4000-8000-000000000030",
        serialNumber: "0000123",
        productName: "Relay Module",
        currentInventory: "99",
      },
    });
    scan("0000123");
    await waitFor(() => expect(quantityA).toHaveFocus());
    expect(quantityC).toHaveValue("7");
    expect(screen.getAllByRole("textbox", { name: /^Quantity for / }))
      .toHaveLength(2);

    fireEvent.click(screen.getByRole("button", {
      name: "Remove Relay Module (0000123)",
    }));
    pageMocks.loadMaterial.mockResolvedValueOnce({
      ok: true,
      value: {
        productId: "00000000-0000-4000-8000-000000000030",
        serialNumber: "0000123",
        productName: "Relay Module",
        currentInventory: "44",
      },
    });
    scan("0000123");
    const readdedQuantityA = await screen.findByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    });
    expect(readdedQuantityA).toHaveValue("");
    expect(readdedQuantityA).toHaveFocus();
    const readdedRow = screen.getByText("0000123").closest("tr");
    expect(within(readdedRow!).getByText("44")).toBeInTheDocument();
  });

  it("keeps Quantity local, validates whole-number text, and removes without a mutation", async () => {
    renderPage();
    const scanner = screen.getByRole("textbox", {
      name: "Scan Product Barcode",
    });
    fireEvent.change(scanner, { target: { value: "0000123" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });

    const quantity = await screen.findByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    });
    fireEvent.change(quantity, { target: { value: "1.5" } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Quantity must be a positive whole number.",
    );
    fireEvent.change(quantity, { target: { value: "0" } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Quantity must be a positive whole number.",
    );
    fireEvent.change(quantity, { target: { value: "9223372036854775808" } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Quantity is above the supported whole-number range.",
    );
    fireEvent.change(quantity, { target: { value: "18" } });
    expect(screen.queryByText("Quantity must be a positive whole number."))
      .not.toBeInTheDocument();
    expect(quantity).toHaveValue("18");
    expect(pageMocks.saveDraft).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {
      name: "Remove Relay Module (0000123)",
    }));
    expect(screen.getByText("No materials added yet.")).toBeInTheDocument();
    expect(pageMocks.loadMaterial).toHaveBeenCalledOnce();
    expect(pageMocks.saveDraft).not.toHaveBeenCalled();
  });

  it("atomically saves local materials with Draft header fields", async () => {
    renderPage();
    const scanner = screen.getByRole("textbox", {
      name: "Scan Product Barcode",
    });
    fireEvent.change(scanner, { target: { value: "0000123" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });
    const quantity = await screen.findByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    });
    fireEvent.change(quantity, { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));

    await waitFor(() => expect(pageMocks.saveDraft)
      .toHaveBeenCalledExactlyOnceWith({
        projectId,
        description: "Build enclosure",
        expectedUpdatedAt: draft.updatedAt,
        items: [{
          productId: "00000000-0000-4000-8000-000000000030",
          quantity: "5",
        }],
        materialSnapshot: [{
          productId: "00000000-0000-4000-8000-000000000030",
          serialNumber: "0000123",
          productName: "Relay Module",
          quantity: "5",
          currentInventory: "17",
        }],
      }));
    expect(screen.getByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    })).toHaveValue("5");
  });

  it("does not append a partial row when Inventory loading fails", async () => {
    renderPage();
    const scanner = screen.getByRole("textbox", {
      name: "Scan Product Barcode",
    });
    fireEvent.change(scanner, { target: { value: "0000123" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });
    expect(await screen.findByText("Relay Module")).toBeInTheDocument();

    pageMocks.loadMaterial.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "inventory_unavailable",
        message: "Current Inventory could not be loaded for this Product.",
      },
    });
    fireEvent.change(scanner, { target: { value: "7654321" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Current Inventory could not be loaded for this Product.",
    );
    expect(screen.getByText("Relay Module")).toBeInTheDocument();
    expect(screen.queryByText("7654321")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(1);
    expect(scanner).toHaveFocus();
    expect(screen.getByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    })).not.toHaveFocus();
  });

  it("blocks overlapping scans and finishes with the new Quantity focused", async () => {
    let finishResolution: ((value: unknown) => void) | undefined;
    pageMocks.loadMaterial.mockReturnValue(new Promise((resolve) => {
      finishResolution = resolve;
    }));
    const page = renderPage();
    let scanner = screen.getByRole("textbox", {
      name: "Scan Product Barcode",
    });
    fireEvent.change(scanner, { target: { value: "0000123" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });
    fireEvent.change(scanner, { target: { value: "0000124" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });
    expect(pageMocks.loadMaterial).toHaveBeenCalledExactlyOnceWith("0000123");

    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      isLoadingMaterial: true,
    }));
    page.rerender(pageTree());
    scanner = screen.getByRole("textbox", { name: "Scan Product Barcode" });
    expect(scanner).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Loading material...");

    finishResolution?.({
      ok: true,
      value: {
        productId: "00000000-0000-4000-8000-000000000030",
        serialNumber: "0000123",
        productName: "Relay Module",
        currentInventory: "17",
      },
    });
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook());
    page.rerender(pageTree());
    const quantity = await screen.findByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    });
    await waitFor(() => expect(quantity).toHaveFocus());
    expect(screen.getByRole("textbox", { name: "Scan Product Barcode" }))
      .not.toHaveFocus();
  });

  it.each([
    ["product_not_found", "No Product was found for this Serial Number."],
    [
      "product_unavailable",
      "This Product is archived or unavailable for this Work Order.",
    ],
    [
      "product_resolution_failed",
      "The Product could not be resolved. Please try again.",
    ],
    [
      "material_inventory_failed",
      "Current Inventory could not be loaded. Please try again.",
    ],
  ])("shows safe inline %s feedback without fake resolved state", async (
    code,
    message,
  ) => {
    pageMocks.loadMaterial.mockResolvedValue({
      ok: false,
      error: { code, message },
    });
    renderPage();
    const scanner = screen.getByRole("textbox", {
      name: "Scan Product Barcode",
    });
    fireEvent.change(scanner, { target: { value: "0000123" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByText("No materials added yet.")).toBeInTheDocument();
    expect(scanner).not.toBeDisabled();
    expect(pageMocks.saveDraft).not.toHaveBeenCalled();
  });

  it("keeps invalid scanner input local and does not trigger Save for Later", () => {
    renderPage();
    const scanner = screen.getByRole("textbox", {
      name: "Scan Product Barcode",
    });
    fireEvent.change(scanner, { target: { value: "123" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a 7-digit Serial Number.",
    );
    expect(scanner).toHaveValue("123");
    expect(pageMocks.saveDraft).not.toHaveBeenCalled();
    expect(screen.queryByText(/Captured Serial Number/)).not.toBeInTheDocument();
  });

  it("saves local Project and Description with the exact authoritative timestamp", async () => {
    const preciseDraft = {
      ...draft,
      updatedAt: "2026-09-22T10:00:00.123456+00:00",
    };
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      detailQuery: {
        data: { ok: true, value: preciseDraft },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
    }));
    const page = renderPage();

    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: replacementProjectId },
    });
    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "  Backend trims this  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));

    await waitFor(() => expect(pageMocks.saveDraft)
      .toHaveBeenCalledExactlyOnceWith({
        projectId: replacementProjectId,
        description: "  Backend trims this  ",
        expectedUpdatedAt: "2026-09-22T10:00:00.123456+00:00",
        items: [],
        materialSnapshot: [],
      }));
    expect(screen.getByRole("status")).toHaveTextContent("Draft saved.");
    expect(screen.getByLabelText("Project")).toHaveValue(replacementProjectId);
    expect(screen.getByRole("heading", { name: "Materials" }))
      .toBeInTheDocument();

    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      detailQuery: {
        data: {
          ok: true,
          value: {
            ...preciseDraft,
            projectId: replacementProjectId,
            projectName: "Beta Project",
            customerName: "Authoritative Beta Customer",
            description: "Backend trims this",
            updatedAt: "2026-09-22T10:01:00.654321+00:00",
          },
        },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
    }));
    page.rerender(pageTree());
    expect(screen.getByLabelText("Customer")).toHaveValue("Beta Customer");
    expect(screen.getByLabelText("Short Description")).toHaveValue(
      "Backend trims this",
    );
  });

  it("synchronizes a normalized no-op Description after successful save", async () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      detailQuery: {
        data: { ok: true, value: { ...draft, description: "Test" } },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
    }));
    renderPage();

    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "  Test  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Draft saved.");
    expect(screen.getByLabelText("Short Description")).toHaveValue("Test");
    expect(pageMocks.saveDraft).toHaveBeenCalledExactlyOnceWith({
      projectId,
      description: "  Test  ",
      expectedUpdatedAt: draft.updatedAt,
      items: [],
      materialSnapshot: [],
    });
  });

  it("synchronizes a whitespace-only normalized no-op to an empty Description", async () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      detailQuery: {
        data: { ok: true, value: { ...draft, description: null } },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
    }));
    renderPage();

    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Draft saved.");
    expect(screen.getByLabelText("Short Description")).toHaveValue("");
    expect(pageMocks.saveDraft).toHaveBeenCalledExactlyOnceWith({
      projectId,
      description: "   ",
      expectedUpdatedAt: draft.updatedAt,
      items: [],
      materialSnapshot: [],
    });
  });

  it("blocks duplicate submission and shows the pending save state", async () => {
    let resolveSave: ((value: unknown) => void) | undefined;
    pageMocks.saveDraft.mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve;
    }));
    renderPage();

    const saveButton = screen.getByRole("button", { name: "Save for Later" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(pageMocks.saveDraft).toHaveBeenCalledOnce();
    resolveSave?.({
      ok: true,
      value: { workOrderId, updatedAt: draft.updatedAt },
    });
    await waitFor(() => expect(screen.getByText("Draft saved."))
      .toBeInTheDocument());

    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      isSaving: true,
    }));
    cleanup();
    renderPage();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  });

  it("preserves local state after a stale save and reloads only on explicit action", async () => {
    pageMocks.saveDraft.mockResolvedValue({
      ok: false,
      error: {
        code: "stale_work_order",
        message:
          "This Draft changed since you loaded it. Reload the latest version before saving.",
      },
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: replacementProjectId },
    });
    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "Unsaved local value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This Draft changed since you loaded it.",
    );
    expect(screen.getByLabelText("Project")).toHaveValue(replacementProjectId);
    expect(screen.getByLabelText("Short Description")).toHaveValue(
      "Unsaved local value",
    );
    expect(pageMocks.reloadLatestDraft).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reload latest Draft" }));
    await waitFor(() => expect(pageMocks.reloadLatestDraft).toHaveBeenCalledOnce());
  });

  it("keeps local fields intact and never shows success after an ordinary save failure", async () => {
    pageMocks.saveDraft.mockResolvedValue({
      ok: false,
      error: {
        code: "work_order_update_failed",
        message: "The Draft could not be saved. Please try again.",
      },
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "Keep this value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The Draft could not be saved. Please try again.",
    );
    expect(screen.getByLabelText("Short Description")).toHaveValue(
      "Keep this value",
    );
    expect(screen.queryByText("Draft saved.")).not.toBeInTheDocument();
  });

  it("preserves the complete local Draft after WOR06 and allows a corrected retry", async () => {
    const persistedMaterial = {
      productId: "00000000-0000-4000-8000-000000000030",
      serialNumber: "0000123",
      productName: "Relay Module",
      quantity: "4",
      currentInventory: "17",
    };
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      materialsQuery: {
        data: { ok: true, value: [persistedMaterial] },
        isError: false,
        isPending: false,
        refetch: pageMocks.materialsRefetch,
      },
    }));
    pageMocks.saveDraft
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "project_requirement_exceeded",
          message: "These materials exceed the remaining requirement for the selected Project. Reduce the quantities or review the Project plan.",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          workOrderId,
          updatedAt: "2026-09-22T10:01:00.123456+00:00",
        },
      });
    renderPage();

    const quantity = await screen.findByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    });
    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: replacementProjectId },
    });
    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "Keep this local description" },
    });
    fireEvent.change(quantity, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "These materials exceed the remaining requirement for the selected Project. Reduce the quantities or review the Project plan.",
    );
    expect(screen.getByLabelText("Project")).toHaveValue(replacementProjectId);
    expect(screen.getByLabelText("Short Description"))
      .toHaveValue("Keep this local description");
    expect(quantity).toHaveValue("12");
    expect(screen.queryByText("Draft saved.")).not.toBeInTheDocument();
    expect(screen.queryByText("Work Orders destination")).not.toBeInTheDocument();
    expect(pageMocks.reloadLatestDraft).not.toHaveBeenCalled();
    expect(pageMocks.saveDraft).toHaveBeenCalledExactlyOnceWith({
      projectId: replacementProjectId,
      description: "Keep this local description",
      expectedUpdatedAt: draft.updatedAt,
      items: [{ productId: persistedMaterial.productId, quantity: "12" }],
      materialSnapshot: [{ ...persistedMaterial, quantity: "12" }],
    });

    fireEvent.change(quantity, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Draft saved.");
    expect(pageMocks.saveDraft).toHaveBeenCalledTimes(2);
    expect(pageMocks.saveDraft.mock.calls[1]?.[0]).toMatchObject({
      projectId: replacementProjectId,
      description: "Keep this local description",
      expectedUpdatedAt: draft.updatedAt,
      items: [{ productId: persistedMaterial.productId, quantity: "5" }],
    });
  });

  it("renders a Draft read-only when edit authority is unavailable", () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canEditDraft: false,
      projectChoicesQuery: {
        data: undefined,
        isError: false,
        isPending: false,
        refetch: pageMocks.projectChoicesRefetch,
      },
    }));
    renderPage();

    expect(screen.queryByRole("combobox", { name: "Project" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Short Description" }))
      .not.toBeInTheDocument();
    expect(screen.getByText("Alpha Project")).toBeInTheDocument();
    expect(screen.getByText("Alpha Customer Snapshot")).toBeInTheDocument();
    expect(screen.getByText("Build enclosure")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Scan Product Barcode" }))
      .not.toBeInTheDocument();
    expect(screen.getByText("No materials added yet."))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save for Later" }))
      .not.toBeInTheDocument();
  });

  it("shows Delete independently for an authorized read-only Draft and requires confirmation", () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canEditDraft: false,
      canDeleteDraft: true,
    }));
    renderPage();

    const deleteButton = screen.getByRole("button", { name: "Delete Draft" });
    expect(screen.queryByRole("button", { name: "Save for Later" }))
      .not.toBeInTheDocument();
    fireEvent.click(deleteButton);
    expect(pageMocks.deleteDraft).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog", {
      name: "Delete Draft Work Order?",
    });
    expect(dialog).toHaveTextContent("RN-2026-0042");
    expect(dialog).toHaveTextContent("permanently");
    expect(dialog).toHaveTextContent("number will not be reused");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(pageMocks.deleteDraft).not.toHaveBeenCalled();
  });

  it("confirms once with the exact current version and navigates only after success", async () => {
    let finishDelete: ((value: unknown) => void) | undefined;
    pageMocks.deleteDraft.mockReturnValue(new Promise((resolve) => {
      finishDelete = resolve;
    }));
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canDeleteDraft: true,
    }));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Delete Draft" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete Draft" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(pageMocks.deleteDraft).toHaveBeenCalledExactlyOnceWith(
      draft.updatedAt,
    );
    expect(screen.queryByText("Work Orders destination")).not.toBeInTheDocument();

    finishDelete?.({
      ok: true,
      value: { workOrderId, workOrderNumber: draft.workOrderNumber },
    });
    expect(await screen.findByText("Work Orders destination"))
      .toBeInTheDocument();
  });

  it("returns safely to the list when the backend reports the Draft is gone", async () => {
    pageMocks.deleteDraft.mockResolvedValue({
      ok: false,
      error: {
        code: "work_order_not_found",
        message: "The Work Order could not be found.",
      },
    });
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canDeleteDraft: true,
    }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Draft" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {
      name: "Delete Draft",
    }));
    expect(await screen.findByText("Work Orders destination"))
      .toBeInTheDocument();
    expect(pageMocks.deleteDraft).toHaveBeenCalledOnce();
  });

  it("uses the exact save-returned timestamp for a later delete", async () => {
    const savedTimestamp = "2026-09-22T10:01:00.654321+00:00";
    pageMocks.saveDraft.mockResolvedValue({
      ok: true,
      value: { workOrderId, updatedAt: savedTimestamp },
    });
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canDeleteDraft: true,
    }));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Draft saved.");
    fireEvent.click(screen.getByRole("button", { name: "Delete Draft" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {
      name: "Delete Draft",
    }));

    await waitFor(() => expect(pageMocks.deleteDraft)
      .toHaveBeenCalledExactlyOnceWith(savedTimestamp));
  });

  it("preserves local edits on stale delete and requires reload plus reconfirmation", async () => {
    const reloadedTimestamp = "2026-09-22T10:05:00.987654+00:00";
    pageMocks.deleteDraft
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "stale_work_order",
          message:
            "This Draft changed somewhere else. Reload the latest Draft before deleting it.",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { workOrderId, workOrderNumber: draft.workOrderNumber },
      });
    pageMocks.reloadLatestDraft.mockResolvedValue({
      ok: true,
      detail: {
        ...draft,
        description: "Latest description",
        updatedAt: reloadedTimestamp,
      },
      materials: [],
    });
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canDeleteDraft: true,
    }));
    renderPage();
    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "Unsaved local edit" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Draft" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {
      name: "Delete Draft",
    }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This Draft changed somewhere else",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Short Description"))
      .toHaveValue("Unsaved local edit");
    expect(pageMocks.deleteDraft).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Reload latest Draft" }));
    await waitFor(() => expect(screen.getByLabelText("Short Description"))
      .toHaveValue("Latest description"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Draft" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {
      name: "Delete Draft",
    }));
    await waitFor(() => expect(pageMocks.deleteDraft)
      .toHaveBeenLastCalledWith(reloadedTimestamp));
    expect(pageMocks.deleteDraft).toHaveBeenCalledTimes(2);
  });

  it("disables all conflicting Draft controls while deletion is pending", async () => {
    const persistedMaterial = {
      productId: "00000000-0000-4000-8000-000000000030",
      serialNumber: "0000123",
      productName: "Relay Module",
      quantity: "2",
      currentInventory: "17",
    };
    pageMocks.deleteDraft.mockReturnValue(new Promise(() => undefined));
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canDeleteDraft: true,
      materialsQuery: {
        data: { ok: true, value: [persistedMaterial] },
        isError: false,
        isPending: false,
        refetch: pageMocks.materialsRefetch,
      },
    }));
    const page = renderPage();
    expect(await screen.findByText("Relay Module")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Draft" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {
      name: "Delete Draft",
    }));

    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canDeleteDraft: true,
      isDeleting: true,
      materialsQuery: {
        data: { ok: true, value: [persistedMaterial] },
        isError: false,
        isPending: false,
        refetch: pageMocks.materialsRefetch,
      },
    }));
    page.rerender(pageTree());
    expect(screen.getByRole("button", { name: "Save for Later" })).toBeDisabled();
    expect(screen.getByLabelText("Project")).toBeDisabled();
    expect(screen.getByLabelText("Short Description")).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Scan Product Barcode" })).toBeDisabled();
    expect(screen.getByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    })).toBeDisabled();
    expect(screen.getByRole("button", {
      name: "Remove Relay Module (0000123)",
    })).toBeDisabled();
  });

  it("disables Delete while Save for Later is pending", () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canDeleteDraft: true,
      isSaving: true,
    }));
    renderPage();
    expect(screen.getByRole("button", { name: "Delete Draft" })).toBeDisabled();
    expect(pageMocks.deleteDraft).not.toHaveBeenCalled();
  });

  it("hides Delete without authority and for Finished Work Orders", () => {
    const draftPage = renderPage();
    expect(screen.queryByRole("button", { name: "Delete Draft" }))
      .not.toBeInTheDocument();
    draftPage.unmount();

    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canDeleteDraft: true,
      detailQuery: {
        data: { ok: true, value: { ...draft, status: "finished" } },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
    }));
    renderPage();
    expect(screen.queryByRole("button", { name: "Delete Draft" }))
      .not.toBeInTheDocument();
    expect(pageMocks.deleteDraft).not.toHaveBeenCalled();
  });

  it("hydrates persisted materials exactly and includes them in the atomic save", async () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      materialsQuery: {
        data: {
          ok: true,
          value: [{
            productId: "00000000-0000-4000-8000-000000000030",
            serialNumber: "0000123",
            productName: "Relay Module",
            quantity: "9223372036854775807",
            currentInventory: "9007199254740993",
          }],
        },
        isError: false,
        isPending: false,
        refetch: pageMocks.materialsRefetch,
      },
    }));
    renderPage();

    expect(await screen.findByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    })).toHaveValue("9223372036854775807");
    expect(screen.getByText("9007199254740993")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));
    await waitFor(() => expect(pageMocks.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{
          productId: "00000000-0000-4000-8000-000000000030",
          quantity: "9223372036854775807",
        }],
      }),
    ));
  });

  it("blocks scanner and Save until the persisted-material baseline loads", () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      materialsQuery: {
        data: undefined,
        isError: false,
        isPending: true,
        refetch: pageMocks.materialsRefetch,
      },
    }));
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading Draft materials...",
    );
    expect(screen.queryByRole("textbox", { name: "Scan Product Barcode" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save for Later" }))
      .toBeDisabled();
  });

  it("shows a retryable material error without presenting an empty baseline", () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      materialsQuery: {
        data: {
          ok: false,
          error: {
            code: "draft_materials_load_failed",
            message: "Draft materials could not be loaded. Please try again.",
          },
        },
        isError: false,
        isPending: false,
        refetch: pageMocks.materialsRefetch,
      },
    }));
    renderPage();

    expect(screen.getByRole("heading", { name: "Unable to load Materials" }))
      .toBeInTheDocument();
    expect(screen.queryByText("No materials added yet."))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save for Later" }))
      .toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(pageMocks.materialsRefetch).toHaveBeenCalledOnce();
  });

  it("renders persisted Draft materials read-only for a viewer", async () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canEditDraft: false,
      materialsQuery: {
        data: {
          ok: true,
          value: [{
            productId: "00000000-0000-4000-8000-000000000030",
            serialNumber: "0000123",
            productName: "Relay Module",
            quantity: "4",
            currentInventory: "17",
          }],
        },
        isError: false,
        isPending: false,
        refetch: pageMocks.materialsRefetch,
      },
    }));
    renderPage();

    expect(await screen.findByText("Relay Module")).toBeInTheDocument();
    expect(screen.getByText("0000123")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^Quantity for/ }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove / }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Scan Product Barcode" }))
      .not.toBeInTheDocument();
  });

  it("blocks an empty material Quantity and preserves exact save versions", async () => {
    renderPage();
    const scanner = screen.getByRole("textbox", { name: "Scan Product Barcode" });
    fireEvent.change(scanner, { target: { value: "0000123" } });
    fireEvent.keyDown(scanner, { key: "Enter", code: "Enter" });
    await screen.findByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    });

    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));
    expect(pageMocks.saveDraft).not.toHaveBeenCalled();
    expect(screen.getByText("Quantity is required.")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));
    await waitFor(() => expect(pageMocks.saveDraft).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));
    await waitFor(() => expect(pageMocks.saveDraft).toHaveBeenCalledTimes(2));
    expect(pageMocks.saveDraft.mock.calls[1]?.[0].expectedUpdatedAt)
      .toBe("2026-09-22T10:01:00.123456+00:00");
  });

  it("does not overwrite unsaved material edits during a routine query update", async () => {
    const originalMaterial = {
      productId: "00000000-0000-4000-8000-000000000030",
      serialNumber: "0000123",
      productName: "Relay Module",
      quantity: "2",
      currentInventory: "17",
    };
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      materialsQuery: {
        data: { ok: true, value: [originalMaterial] },
        isError: false,
        isPending: false,
        refetch: pageMocks.materialsRefetch,
      },
    }));
    const page = renderPage();
    const quantity = await screen.findByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    });
    fireEvent.change(quantity, { target: { value: "9" } });

    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      materialsQuery: {
        data: { ok: true, value: [{ ...originalMaterial, quantity: "4" }] },
        isError: false,
        isPending: false,
        refetch: pageMocks.materialsRefetch,
      },
    }));
    page.rerender(pageTree());
    expect(screen.getByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    })).toHaveValue("9");
  });

  it("explicit stale reload replaces header and complete material state", async () => {
    const persistedMaterial = {
      productId: "00000000-0000-4000-8000-000000000030",
      serialNumber: "0000123",
      productName: "Relay Module",
      quantity: "2",
      currentInventory: "17",
    };
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      materialsQuery: {
        data: { ok: true, value: [persistedMaterial] },
        isError: false,
        isPending: false,
        refetch: pageMocks.materialsRefetch,
      },
    }));
    pageMocks.saveDraft.mockResolvedValue({
      ok: false,
      error: {
        code: "stale_work_order",
        message: "This Draft changed somewhere else. Reload the latest Draft before saving.",
      },
    });
    pageMocks.reloadLatestDraft.mockResolvedValue({
      ok: true,
      detail: {
        ...draft,
        projectId: null,
        projectName: null,
        customerName: null,
        description: "Server description",
        updatedAt: "2026-09-22T11:00:00.654321+00:00",
      },
      materials: [{
        productId: "00000000-0000-4000-8000-000000000031",
        serialNumber: "0000456",
        productName: "Server Product",
        quantity: "7",
        currentInventory: "8",
      }],
    });
    renderPage();
    const quantity = await screen.findByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    });
    fireEvent.change(quantity, { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "Local description" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save for Later" }));
    await screen.findByRole("button", { name: "Reload latest Draft" });
    expect(quantity).toHaveValue("9");

    fireEvent.click(screen.getByRole("button", { name: "Reload latest Draft" }));
    expect(await screen.findByText("Server Product")).toBeInTheDocument();
    expect(screen.queryByText("Relay Module")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", {
      name: "Quantity for Server Product (0000456)",
    })).toHaveValue("7");
    expect(screen.getByLabelText("Short Description"))
      .toHaveValue("Server description");
  });

  it("preserves an existing historical Project absent from new choices", () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      detailQuery: {
        data: {
          ok: true,
          value: {
            ...draft,
            projectName: "Completed Historical Project",
          },
        },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
      projectChoicesQuery: {
        data: { ok: true, value: projectChoices.slice(1) },
        isError: false,
        isPending: false,
        refetch: pageMocks.projectChoicesRefetch,
      },
    }));
    renderPage();

    expect(screen.getByRole("combobox", { name: "Project" })).toHaveValue(
      projectId,
    );
    expect(screen.getByRole("option", {
      name: "Completed Historical Project (current)",
    })).toBeDisabled();
    expect(screen.getByRole("option", { name: "Beta Project" }))
      .toBeInTheDocument();
  });

  it("keeps loaded Draft data visible when Project choices fail", () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      projectChoicesQuery: {
        data: {
          ok: false,
          error: {
            code: "work_order_project_choices_failed",
            message: "Project choices could not be loaded.",
          },
        },
        isError: false,
        isPending: false,
        refetch: pageMocks.projectChoicesRefetch,
      },
    }));
    renderPage();

    expect(screen.getByRole("heading", { name: "RN-2026-0042" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Short Description")).toHaveValue(
      "Build enclosure",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Project choices could not be loaded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(pageMocks.projectChoicesRefetch).toHaveBeenCalledOnce();
  });

  it("shows a minimal read-only Finished state without Draft controls", () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canEditDraft: false,
      canFinishDraft: true,
      detailQuery: {
        data: { ok: true, value: { ...draft, status: "finished" } },
        isError: false,
        isPending: false,
        refetch: pageMocks.detailRefetch,
      },
    }));
    renderPage();

    expect(screen.getByText("Finished")).toBeInTheDocument();
    expect(screen.getByText(/Finished Work Order detail experience is not implemented/i))
      .toBeInTheDocument();
    expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Short Description")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Scan Product Barcode" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save|delete|finish/i }))
      .not.toBeInTheDocument();
  });

  it("shows Finish independently of edit/delete authority and explains the saved Draft", async () => {
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canEditDraft: false,
      canDeleteDraft: false,
      canFinishDraft: true,
      materialsQuery: {
        data: {
          ok: true,
          value: [{
            productId: "00000000-0000-4000-8000-000000000030",
            serialNumber: "0000123",
            productName: "Relay Module",
            quantity: "2",
            currentInventory: "17",
          }],
        },
        isError: false,
        isPending: false,
        refetch: pageMocks.materialsRefetch,
      },
    }));
    renderPage();

    const finishButton = await screen.findByRole("button", {
      name: "Finish Work Order",
    });
    expect(screen.queryByRole("button", { name: "Save for Later" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Draft" }))
      .not.toBeInTheDocument();
    fireEvent.click(finishButton);

    const dialog = screen.getByRole("dialog", { name: "Finish Work Order?" });
    expect(dialog).toHaveTextContent("RN-2026-0042");
    expect(dialog).toHaveTextContent("Alpha Project");
    expect(dialog).toHaveTextContent("1 saved material");
    expect(dialog).toHaveTextContent("deduct the saved material quantities from Inventory");
    expect(dialog).toHaveTextContent("generate and finalize the official PDF");
    expect(dialog).toHaveTextContent("permanently lock the Work Order as read-only");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Finish Work Order?" }))
      .not.toBeInTheDocument();
    expect(pageMocks.saveDraft).not.toHaveBeenCalled();
    expect(pageMocks.deleteDraft).not.toHaveBeenCalled();
  });

  it("hides Finish without authority", async () => {
    renderPage();
    await screen.findByText("No materials added yet.");

    expect(screen.queryByRole("button", { name: "Finish Work Order" }))
      .not.toBeInTheDocument();
  });

  it("requires saving Project, Description, and material changes before Finish", async () => {
    const persistedMaterial = {
      productId: "00000000-0000-4000-8000-000000000030",
      serialNumber: "0000123",
      productName: "Relay Module",
      quantity: "2",
      currentInventory: "17",
    };
    pageMocks.useWorkOrderDetail.mockReturnValue(successfulHook({
      canFinishDraft: true,
      materialsQuery: {
        data: { ok: true, value: [persistedMaterial] },
        isError: false,
        isPending: false,
        refetch: pageMocks.materialsRefetch,
      },
    }));
    renderPage();

    const finishButton = await screen.findByRole("button", {
      name: "Finish Work Order",
    });
    expect(finishButton).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: replacementProjectId },
    });
    expect(finishButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: projectId },
    });
    expect(finishButton).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: "Unsaved description" },
    });
    expect(finishButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Short Description"), {
      target: { value: draft.description },
    });
    expect(finishButton).toBeEnabled();

    fireEvent.change(screen.getByRole("textbox", {
      name: "Quantity for Relay Module (0000123)",
    }), { target: { value: "3" } });
    expect(finishButton).toBeDisabled();
    expect(screen.getByText("Save Draft changes before finishing."))
      .toBeInTheDocument();
    fireEvent.click(finishButton);
    expect(screen.queryByRole("dialog", { name: "Finish Work Order?" }))
      .not.toBeInTheDocument();
  });

  it("guards Save, Delete, and editing while local Finish confirmation is active", async () => {
    let resolveFinish: (() => void) | undefined;
    const onFinishConfirm = vi.fn().mockReturnValue(new Promise<void>((resolve) => {
      resolveFinish = resolve;
    }));
    const onSave = vi.fn().mockResolvedValue({
      ok: true,
      value: { workOrderId, updatedAt: draft.updatedAt },
    });
    const onDelete = vi.fn().mockResolvedValue({
      ok: true,
      value: { workOrderId, workOrderNumber: draft.workOrderNumber },
    });
    render(<WorkOrderDraftShell
      workOrder={draft}
      canEdit
      canDelete
      canFinish
      projectChoices={projectChoices}
      projectChoicesError={null}
      projectChoicesLoading={false}
      persistedMaterials={[]}
      materialsLoading={false}
      materialsError={null}
      materialsReady
      isSaving={false}
      isDeleting={false}
      isLoadingMaterial={false}
      onReloadLatest={vi.fn().mockResolvedValue({ ok: false })}
      onRetryMaterials={vi.fn()}
      onRetryProjectChoices={vi.fn()}
      onLoadMaterial={vi.fn()}
      onSave={onSave}
      onDelete={onDelete}
      onFinishConfirm={onFinishConfirm}
    />);

    const finishButton = await screen.findByRole("button", {
      name: "Finish Work Order",
    });
    fireEvent.click(finishButton);
    const dialog = screen.getByRole("dialog", { name: "Finish Work Order?" });
    expect(screen.getByRole("button", { name: "Save for Later" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Draft" })).toBeDisabled();
    expect(screen.getByLabelText("Project")).toBeDisabled();
    expect(screen.getByLabelText("Short Description")).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Scan Product Barcode" }))
      .toBeDisabled();

    const confirm = within(dialog).getByRole("button", {
      name: "Finish Work Order",
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onFinishConfirm).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();

    resolveFinish?.();
    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Finish Work Order?",
    })).not.toBeInTheDocument());
    expect(screen.queryByRole("status", { name: /finished/i }))
      .not.toBeInTheDocument();
  });
});
