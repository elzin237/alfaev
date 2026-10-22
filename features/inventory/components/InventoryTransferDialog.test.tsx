import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import InventoryTransferDialog from "./InventoryTransferDialog";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";

afterEach(cleanup);

describe("InventoryTransferDialog", () => {
  it("requires a positive quantity/reason and submits exact destination identity", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      ok: true,
      value: { transferId: "transfer-1", sourceQuantityAfter: 4, destinationQuantityAfter: 6 },
    });
    const onClose = vi.fn();
    const onSucceeded = vi.fn();
    render(
      <InventoryTransferDialog
        open
        sourceWarehouse={INVENTORY_WAREHOUSES[0]!}
        destinations={[INVENTORY_WAREHOUSES[1]!]}
        onClose={onClose}
        onSubmit={onSubmit}
        onSucceeded={onSucceeded}
      />,
    );

    const submit = screen.getByRole("button", { name: "Transfer Inventory" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), { target: { value: "  Rebalance  " } });
    fireEvent.click(submit);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      destinationWarehouseId: INVENTORY_WAREHOUSES[1]!.id,
      quantity: 2,
      reason: "Rebalance",
    }));
    expect(onSucceeded).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("contains focus and blocks Escape while submitting", async () => {
    let resolve!: (value: unknown) => void;
    const onSubmit = vi.fn(() => new Promise((done) => { resolve = done; }));
    const onClose = vi.fn();
    render(
      <InventoryTransferDialog
        open
        sourceWarehouse={INVENTORY_WAREHOUSES[0]!}
        destinations={[INVENTORY_WAREHOUSES[1]!]}
        onClose={onClose}
        onSubmit={onSubmit as never}
        onSucceeded={vi.fn()}
      />,
    );
    const destination = screen.getByRole("combobox", { name: "Destination warehouse" });
    destination.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), { target: { value: "Move" } });
    fireEvent.click(screen.getByRole("button", { name: "Transfer Inventory" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    resolve({ ok: false, error: { code: "inventory_adjustment_failed", message: "Safe error" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Safe error");
  });
});
