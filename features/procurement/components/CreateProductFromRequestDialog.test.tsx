import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Brand } from "../../inventory/services/brandService";
import type {
  ProcurementProductCreationResult,
  ProcurementRequestListItem,
} from "../services/procurementService";
import CreateProductFromRequestDialog from "./CreateProductFromRequestDialog";

const request: ProcurementRequestListItem = {
  requestId: "00000000-0000-4000-8000-000000000001",
  productId: null,
  productSerialNumber: null,
  requestedName: "Request-time Relay Name",
  supplierId: "00000000-0000-4000-8000-000000000002",
  supplierName: "Fixed Supplier",
  requestedQuantity: 10,
  deliveredQuantity: 4,
  remainingQuantity: 6,
  status: "partly_delivered",
  createdAt: "2026-09-15T10:00:00.000Z",
  createdByUserId: "00000000-0000-4000-8000-000000000003",
  createdByFullName: "Procurement Worker",
};

const brands: Brand[] = [
  {
    id: "brand-active",
    name: "ABB",
    isActive: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    archivedAt: null,
  },
  {
    id: "brand-archived",
    name: "Archived Bosch",
    isActive: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    archivedAt: "2026-08-02T00:00:00.000Z",
  },
];

function renderDialog(options: {
  onSubmit?: (
    input: Parameters<React.ComponentProps<
      typeof CreateProductFromRequestDialog
    >["onSubmit"]>[0],
  ) => Promise<ProcurementProductCreationResult>;
  isBrandsLoading?: boolean;
  brandLoadError?: string | null;
  request?: ProcurementRequestListItem;
} = {}) {
  const onClose = vi.fn();
  const onRetryBrands = vi.fn();
  const onSucceeded = vi.fn();
  const onSubmit = vi.fn(options.onSubmit ?? (async () => ({
    ok: true as const,
    value: {
      productId: "00000000-0000-4000-8000-000000000004",
      serialNumber: "0000123",
    },
  })));

  render(
    <CreateProductFromRequestDialog
      request={options.request ?? request}
      brands={brands}
      isBrandsLoading={options.isBrandsLoading ?? false}
      brandLoadError={options.brandLoadError ?? null}
      onRetryBrands={onRetryBrands}
      onClose={onClose}
      onSubmit={onSubmit}
      onSucceeded={onSucceeded}
    />,
  );

  return { onClose, onRetryBrands, onSubmit, onSucceeded };
}

afterEach(cleanup);

describe("CreateProductFromRequestDialog", () => {
  it("prefills editable Name and fixed Supplier while exposing no forbidden choices", () => {
    renderDialog();

    expect(screen.getByLabelText("Name")).toHaveValue(request.requestedName);
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText("Supplier")).toHaveValue("Fixed Supplier");
    expect(screen.getByLabelText("Supplier")).toHaveAttribute("readonly");
    expect(screen.queryByRole("combobox", { name: "Supplier" }))
      .not.toBeInTheDocument();
    expect(screen.getByLabelText("Serial Number")).toHaveValue(
      "Generated automatically",
    );
    expect(screen.getByLabelText("Serial Number")).toHaveAttribute("readonly");
    expect(screen.queryByLabelText(/Product kind/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Inventory quantity|stock/i))
      .not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "stays in its current lifecycle",
    );
  });

  it("creates from an unassigned request without inventing Supplier or Catalog Number", async () => {
    const unassignedRequest = {
      ...request,
      supplierId: null,
      supplierName: null,
    };
    const { onSubmit } = renderDialog({ request: unassignedRequest });

    expect(screen.getByText("Not assigned")).toBeInTheDocument();
    expect(screen.queryByLabelText("Supplier")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Catalog Number/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "Components" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Component" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      requestId: request.requestId,
      name: request.requestedName,
      category: "Components",
      brandId: null,
    }));
  });

  it("offers only active Brands and validates required trimmed Product fields", async () => {
    const { onSubmit } = renderDialog();
    const brandSelect = screen.getByLabelText(/Brand/);
    expect(within(brandSelect).getByRole("option", { name: "ABB" }))
      .toBeInTheDocument();
    expect(within(brandSelect).queryByRole("option", {
      name: "Archived Bosch",
    })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Component" }));

    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    expect(screen.getByText("Category is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("uses the request Supplier without asking for relationship metadata", async () => {
    const { onSubmit, onClose, onSucceeded } = renderDialog();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "  Final Relay  " },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "  Control Components  " },
    });
    expect(screen.queryByLabelText(/Catalog Number/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Component" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      requestId: request.requestId,
      name: "Final Relay",
      category: "Control Components",
      brandId: null,
    }));
    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty("supplierId");
    expect(payload).not.toHaveProperty("serialNumber");
    expect(payload).not.toHaveProperty("productKind");
    expect(payload).not.toHaveProperty("quantity");
    expect(onSucceeded).toHaveBeenCalledWith({
      productId: "00000000-0000-4000-8000-000000000004",
      serialNumber: "0000123",
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("submits an active Brand and blocks duplicates", async () => {
    let finish: ((result: ProcurementProductCreationResult) => void) | undefined;
    const pending = new Promise<ProcurementProductCreationResult>((resolve) => {
      finish = resolve;
    });
    const onSubmit = vi.fn().mockReturnValue(pending);
    renderDialog({ onSubmit });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "Components" },
    });
    fireEvent.change(screen.getByLabelText(/Brand/), {
      target: { value: "brand-active" },
    });
    expect(screen.queryByLabelText(/Catalog Number/)).not.toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Create Component" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      brandId: "brand-active",
    }));
    expect(submit).toBeDisabled();
    finish?.({
      ok: true,
      value: {
        productId: "00000000-0000-4000-8000-000000000004",
        serialNumber: "0000123",
      },
    });
    await pending;
  });

  it("fails closed for Brand loading/errors and keeps safe mutation failures visible", async () => {
    const loading = renderDialog({ isBrandsLoading: true });
    expect(screen.getByRole("button", { name: "Create Component" }))
      .toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading active Brands...",
    );
    loading.onClose.mockClear();
    cleanup();

    const failedBrands = renderDialog({
      brandLoadError: "The Brand list could not be loaded.",
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(failedBrands.onRetryBrands).toHaveBeenCalledOnce();
    cleanup();

    const failedMutation = renderDialog({
      onSubmit: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "request_already_linked",
          message: "This Procurement request already has a Product.",
        },
      }),
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "Components" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Component" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already has a Product",
    );
    expect(failedMutation.onClose).not.toHaveBeenCalled();
  });
});
