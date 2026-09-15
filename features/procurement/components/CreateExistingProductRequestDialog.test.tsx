import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CreateExistingProductRequestDialog from "./CreateExistingProductRequestDialog";
import type { ProcurementCreationResult } from "../services/procurementService";

const product = {
  productId: "00000000-0000-4000-8000-000000000001",
  serialNumber: "0000123",
  name: "Server Product Name",
};
const supplier = {
  supplierId: "00000000-0000-4000-8000-000000000002",
  supplierName: "Active Supplier",
};

function renderDialog(
  onSubmit = vi.fn<() => Promise<ProcurementCreationResult>>().mockResolvedValue({
    ok: true,
    value: { requestId: "00000000-0000-4000-8000-000000000003" },
  }),
) {
  const props = {
    open: true,
    productSearch: "",
    onProductSearchChange: vi.fn(),
    products: [product],
    suppliers: [supplier],
    isProductsLoading: false,
    isSuppliersLoading: false,
    productLoadError: null,
    supplierLoadError: null,
    onRetryProducts: vi.fn(),
    onRetrySuppliers: vi.fn(),
    onClose: vi.fn(),
    onSubmit,
    onCreated: vi.fn(),
  };
  render(<CreateExistingProductRequestDialog {...props} />);
  return props;
}

function selectRequiredValues(quantity = "5") {
  fireEvent.change(screen.getByLabelText("Product"), {
    target: { value: product.productId },
  });
  fireEvent.change(screen.getByLabelText("Supplier"), {
    target: { value: supplier.supplierId },
  });
  fireEvent.change(screen.getByLabelText("Requested Quantity"), {
    target: { value: quantity },
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("CreateExistingProductRequestDialog", () => {
  it("searches/selects trusted choices and displays immutable Serial and Name", () => {
    const props = renderDialog();

    fireEvent.change(screen.getByLabelText("Search Product"), {
      target: { value: " 00001" },
    });
    expect(props.onProductSearchChange).toHaveBeenCalledWith(" 00001");

    fireEvent.change(screen.getByLabelText("Product"), {
      target: { value: product.productId },
    });
    expect(screen.getByText("0000123")).toBeInTheDocument();
    expect(screen.getByText("Server Product Name")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /serial/i }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /requested name/i }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Active Supplier" }))
      .toBeInTheDocument();
  });

  it.each([
    ["", "Requested Quantity is required."],
    ["0", "Requested Quantity must be greater than zero."],
    ["-1", "Requested Quantity must be a whole number."],
    ["1.5", "Requested Quantity must be a whole number."],
  ])("rejects invalid quantity %s", async (quantity, message) => {
    const props = renderDialog();
    selectRequiredValues(quantity);
    fireEvent.click(screen.getByRole("button", { name: "Create Request" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("submits only IDs and positive quantity, then closes and resets", async () => {
    const props = renderDialog();
    selectRequiredValues("7");

    fireEvent.click(screen.getByRole("button", { name: "Create Request" }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({
      productId: product.productId,
      supplierId: supplier.supplierId,
      requestedQuantity: 7,
    }));
    expect(props.onCreated).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("blocks duplicate submits while pending", async () => {
    let resolveSubmit: ((value: ProcurementCreationResult) => void) | undefined;
    const pending = new Promise<ProcurementCreationResult>((resolve) => {
      resolveSubmit = resolve;
    });
    const onSubmit = vi.fn(() => pending);
    renderDialog(onSubmit);
    selectRequiredValues();
    const form = screen.getByRole("button", { name: "Create Request" })
      .closest("form");
    if (!form) throw new Error("Request form is missing");

    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());

    resolveSubmit?.({
      ok: true,
      value: { requestId: "00000000-0000-4000-8000-000000000003" },
    });
    await waitFor(() => expect(within(form).queryByText("Creating Request…"))
      .not.toBeInTheDocument());
  });

  it("shows safe backend failure and keeps the dialog open", async () => {
    const onSubmit = vi.fn<() => Promise<ProcurementCreationResult>>()
      .mockResolvedValue({
        ok: false,
        error: {
          code: "product_unavailable",
          message: "The selected Product is unavailable. Choose an active Product.",
        },
      });
    const props = renderDialog(onSubmit);
    selectRequiredValues();

    fireEvent.click(screen.getByRole("button", { name: "Create Request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The selected Product is unavailable.",
    );
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
