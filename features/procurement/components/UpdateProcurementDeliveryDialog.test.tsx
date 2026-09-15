import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProcurementRequestListItem } from "../services/procurementService";
import UpdateProcurementDeliveryDialog from "./UpdateProcurementDeliveryDialog";

const request: ProcurementRequestListItem = {
  requestId: "00000000-0000-4000-8000-000000000001",
  productId: null,
  productSerialNumber: null,
  requestedName: "Relay",
  supplierId: "00000000-0000-4000-8000-000000000002",
  supplierName: "Supplier",
  requestedQuantity: 10,
  deliveredQuantity: 4,
  remainingQuantity: 6,
  status: "partly_delivered",
  createdAt: "2026-09-15T10:00:00.000Z",
  createdByUserId: "00000000-0000-4000-8000-000000000003",
  createdByFullName: "Worker",
};

afterEach(cleanup);

function renderDialog(onSubmit = vi.fn().mockResolvedValue({
  ok: true,
  value: { requestId: request.requestId },
})) {
  const onClose = vi.fn();
  const onUpdated = vi.fn();
  render(
    <UpdateProcurementDeliveryDialog
      request={request}
      onClose={onClose}
      onSubmit={onSubmit}
      onUpdated={onUpdated}
    />,
  );
  return { onClose, onSubmit, onUpdated };
}

describe("UpdateProcurementDeliveryDialog", () => {
  it("shows immutable current totals and initializes the absolute Delivered So Far value", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog", { name: "Update Delivery" });

    expect(within(dialog).getByText("Requested").nextSibling).toHaveTextContent("10");
    expect(within(dialog).getByText("Current Delivered").nextSibling).toHaveTextContent("4");
    expect(within(dialog).getByText("Current Remaining").nextSibling).toHaveTextContent("6");
    expect(screen.getByLabelText("Delivered So Far")).toHaveValue(4);
    expect(dialog).toHaveTextContent("total delivered so far, not the quantity received now");
    expect(screen.queryByLabelText(/requested|remaining/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/status/i)).not.toBeInTheDocument();
  });

  it.each([
    ["", "Delivered So Far is required."],
    ["-1", "Delivered So Far must be a whole number."],
    ["2.5", "Delivered So Far must be a whole number."],
    ["11", "Delivered So Far cannot exceed Requested Quantity (10)."],
  ])("rejects invalid value %s", async (value, message) => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByLabelText("Delivered So Far"), {
      target: { value },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Delivery" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ["0", "10"],
    ["5", "5"],
    ["10", "0"],
  ])("accepts %s as an absolute total and previews remaining %s", async (
    delivered,
    remaining,
  ) => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByLabelText("Delivered So Far"), {
      target: { value: delivered },
    });
    expect(screen.getByText("Remaining after update").nextSibling)
      .toHaveTextContent(remaining);
    fireEvent.click(screen.getByRole("button", { name: "Save Delivery" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      requestId: request.requestId,
      deliveredQuantity: Number(delivered),
    }));
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty("status");
  });

  it("shows safe backend failure and keeps the dialog open", async () => {
    const { onClose } = renderDialog(vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "request_resolved",
        message: "Resolved Procurement requests cannot be changed.",
      },
    }));
    fireEvent.click(screen.getByRole("button", { name: "Save Delivery" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Resolved Procurement requests cannot be changed.",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Update Delivery" }))
      .toBeInTheDocument();
  });

  it("closes, resets, and reports success once while duplicate submission is pending", async () => {
    let resolveSubmit: ((value: {
      ok: true;
      value: { requestId: string };
    }) => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<{
      ok: true;
      value: { requestId: string };
    }>((resolve) => {
      resolveSubmit = resolve;
    }));
    const { onClose, onUpdated } = renderDialog(onSubmit);
    const form = screen.getByRole("button", { name: "Save Delivery" })
      .closest("form");

    fireEvent.submit(form!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    fireEvent.submit(form!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Updating…" })).toBeDisabled();

    resolveSubmit?.({ ok: true, value: { requestId: request.requestId } });
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
