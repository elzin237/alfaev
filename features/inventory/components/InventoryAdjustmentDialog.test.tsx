import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InventoryAdjustmentDialog, {
  type InventoryAdjustmentDialogProps,
} from "./InventoryAdjustmentDialog";

const successfulAdjustment = {
  ok: true as const,
  value: {
    movementId: "movement-1",
    quantityBefore: 10,
    quantityAfter: 13,
  },
};

function renderDialog(options: {
  currentQuantity?: number;
  onSubmit?: InventoryAdjustmentDialogProps["onSubmit"];
  onClose?: InventoryAdjustmentDialogProps["onClose"];
  onSucceeded?: InventoryAdjustmentDialogProps["onSucceeded"];
} = {}) {
  const onSubmit: InventoryAdjustmentDialogProps["onSubmit"] =
    options.onSubmit ?? vi.fn(async () => successfulAdjustment);
  const onClose: InventoryAdjustmentDialogProps["onClose"] =
    options.onClose ?? vi.fn();
  const onSucceeded: InventoryAdjustmentDialogProps["onSucceeded"] =
    options.onSucceeded ?? vi.fn();

  render(
    <InventoryAdjustmentDialog
      open
      currentQuantity={options.currentQuantity ?? 10}
      sourceChoices={[{
        productSupplierId: "relation-1",
        supplierId: "supplier-1",
        supplierName: "IBP",
        catalogNumber: "CAT-100",
        description: "Control relay",
      }]}
      onClose={onClose}
      onSubmit={onSubmit}
      onSucceeded={onSucceeded}
    />,
  );

  return { onSubmit, onClose, onSucceeded };
}

function enterReason(reason = "  Cycle count  ") {
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: reason },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("InventoryAdjustmentDialog", () => {
  it("calculates Add live and submits normalized whole-number input", async () => {
    const { onSubmit, onClose, onSucceeded } = renderDialog();
    const dialog = screen.getByRole("dialog", { name: "Adjust Inventory" });
    fireEvent.change(within(dialog).getByLabelText("Quantity"), {
      target: { value: "3" },
    });
    fireEvent.change(within(dialog).getByLabelText("Supplier"), {
      target: { value: "relation-1" },
    });
    enterReason();

    expect(within(dialog).getByText("+3")).toBeInTheDocument();
    expect(within(dialog).getByText("13")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Adjust Inventory" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      adjustmentType: "add",
      quantity: 3,
      reason: "Cycle count",
      productSupplierId: "relation-1",
    }));
    expect(onSucceeded).toHaveBeenCalledWith(successfulAdjustment.value);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calculates Remove and blocks a negative resulting quantity", async () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByLabelText("Adjustment Type"), {
      target: { value: "remove" },
    });
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "11" },
    });
    enterReason("Removal");

    expect(screen.getByText("-11")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Adjust Inventory" }));

    expect(await screen.findByText("Resulting quantity cannot be negative."))
      .toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("treats Correction as a final target and allows target zero", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        movementId: "movement-zero",
        quantityBefore: 10,
        quantityAfter: 0,
      },
    });
    renderDialog({ onSubmit });
    fireEvent.change(screen.getByLabelText("Adjustment Type"), {
      target: { value: "correction" },
    });
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "0" },
    });
    enterReason("Correct to zero");

    expect(screen.getByText("-10")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Adjust Inventory" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      adjustmentType: "correction",
      quantity: 0,
      reason: "Correct to zero",
      productSupplierId: null,
    }));
  });

  it("shows the exact Supplier source only for Add and upward Correction", async () => {
    const { onSubmit } = renderDialog();
    expect(screen.getByRole("option", {
      name: "IBP — CAT-100 — Control relay",
    })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "2" },
    });
    enterReason("Inbound");
    fireEvent.click(screen.getByRole("button", { name: "Adjust Inventory" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Select the Supplier for inbound stock.",
    );
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Adjustment Type"), {
      target: { value: "correction" },
    });
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "12" },
    });
    expect(screen.getByLabelText("Supplier")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Supplier"), {
      target: { value: "relation-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adjust Inventory" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      adjustmentType: "correction",
      quantity: 12,
      reason: "Inbound",
      productSupplierId: "relation-1",
    }));
  });

  it("never asks for a new source on Remove or downward Correction", async () => {
    const onSubmit = vi.fn().mockResolvedValue(successfulAdjustment);
    renderDialog({ onSubmit });
    fireEvent.change(screen.getByLabelText("Adjustment Type"), {
      target: { value: "correction" },
    });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "8" } });
    expect(screen.queryByLabelText("Supplier")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Adjustment Type"), {
      target: { value: "remove" },
    });
    expect(screen.queryByLabelText("Supplier")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2" } });
    enterReason("Outbound");
    fireEvent.click(screen.getByRole("button", { name: "Adjust Inventory" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      adjustmentType: "remove",
      quantity: 2,
      reason: "Outbound",
      productSupplierId: null,
    }));
  });

  it("rejects no-op Correction, zero Add, fractional input, and blank reason", async () => {
    const { onSubmit } = renderDialog();
    const type = screen.getByLabelText("Adjustment Type");
    const quantity = screen.getByLabelText("Quantity");
    const submit = screen.getByRole("button", { name: "Adjust Inventory" });

    fireEvent.change(type, { target: { value: "correction" } });
    fireEvent.change(quantity, { target: { value: "10" } });
    enterReason("No change");
    fireEvent.click(submit);
    expect(await screen.findByText(
      "Correction target must differ from the current quantity.",
    )).toBeInTheDocument();

    fireEvent.change(type, { target: { value: "add" } });
    fireEvent.change(quantity, { target: { value: "0" } });
    fireEvent.click(submit);
    expect(await screen.findByText(
      "Add and Remove quantity must be greater than zero.",
    )).toBeInTheDocument();

    fireEvent.change(quantity, { target: { value: "1.5" } });
    fireEvent.click(submit);
    expect(await screen.findByText("Quantity must be a whole number."))
      .toBeInTheDocument();

    fireEvent.change(quantity, { target: { value: "1" } });
    enterReason("   ");
    fireEvent.click(submit);
    expect(await screen.findByText("Reason is required."))
      .toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks duplicate submissions and keeps a safe backend error visible", async () => {
    let resolveSubmission: ((value: typeof successfulAdjustment) => void) | undefined;
    const pending = new Promise<typeof successfulAdjustment>((resolve) => {
      resolveSubmission = resolve;
    });
    const onSubmit = vi.fn().mockReturnValue(pending);
    const { onClose } = renderDialog({ onSubmit });
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Supplier"), {
      target: { value: "relation-1" },
    });
    enterReason("Delivery");
    const submit = screen.getByRole("button", { name: "Adjust Inventory" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Adjusting Inventory…" }))
      .toBeDisabled();
    resolveSubmission?.(successfulAdjustment);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    cleanup();

    const failedSubmit = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "insufficient_stock",
        message: "The requested removal exceeds the available stock.",
      },
    });
    renderDialog({ onSubmit: failedSubmit });
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Supplier"), {
      target: { value: "relation-1" },
    });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Reason" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adjust Inventory" }));
    expect(await screen.findByText(
      "The requested removal exceeds the available stock.",
    )).toBeInTheDocument();
  });
});
