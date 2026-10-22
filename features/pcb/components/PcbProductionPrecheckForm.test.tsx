import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PcbProductionPrecheckForm from "./PcbProductionPrecheckForm";
import type { PcbProductionSource } from "../services/pcbProductionPrecheckService";

const source: PcbProductionSource = {
  cardId: "11111111-1111-4111-8111-111111111111", cardName: "Controller",
  outputProductId: "22222222-2222-4222-8222-222222222222", outputSerialNumber: "0000001",
  outputIsActive: true, versionId: "33333333-3333-4333-8333-333333333333", versionNumber: "2",
  inputs: [{ productId: "44444444-4444-4444-8444-444444444444", name: "Resistor",
    serialNumber: "0000002", isActive: true, quantityPerCard: "2", availableQuantity: "3" }],
};
const success = { ok: true as const, value: {
  workOrderId: "66666666-6666-4666-8666-666666666666", workOrderNumber: "RN-2026-0001",
} };
const submit = vi.fn();
const onProduced = vi.fn();
function show(precheckSource = source) {
  return render(<PcbProductionPrecheckForm source={precheckSource}
    isRefreshing={false} submit={submit} onProduced={onProduced} />);
}
beforeEach(() => { submit.mockResolvedValue(success); vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "77777777-7777-4777-8777-777777777777") }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("PCB production Work Order precheck", () => {
  it("shows planned requirements and allows creation despite current shortage", () => {
    show();
    expect(screen.getByText("Enter planned quantity")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Planned Production Quantity" }), { target: { value: "5" } });
    expect(within(screen.getByRole("row", { name: /Resistor/ })).getAllByRole("cell").map((cell) => cell.textContent))
      .toEqual(["Resistor 0000002", "2", "10", "3", "7"]);
    expect(screen.getByText(/You may create the Work Order/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Production Work Order" })).toBeEnabled();
  });

  it("creates a General Stock Draft with exact text and durable request UUID", async () => {
    show({ ...source, inputs: [{ ...source.inputs[0]!, availableQuantity: "999999999999999999" }] });
    const huge = "9007199254740993";
    fireEvent.change(screen.getByRole("textbox", { name: "Planned Production Quantity" }), { target: { value: huge } });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Production Work Order" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("creates a Draft Work Order");
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create Work Order" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      pcbCardId: source.cardId, plannedQuantity: huge,
      creationRequestId: "77777777-7777-4777-8777-777777777777",
    }));
    expect(onProduced).toHaveBeenCalledWith({
      workOrderId: success.value.workOrderId, workOrderNumber: success.value.workOrderNumber,
      cardName: "Controller", plannedQuantity: huge, projectName: null,
    });
  });

  it("accepts an empty BOM and makes no fabricated input row", () => {
    show({ ...source, inputs: [] });
    fireEvent.change(screen.getByRole("textbox", { name: "Planned Production Quantity" }), { target: { value: "1" } });
    expect(screen.getByText(/no input Products/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Production Work Order" })).toBeEnabled();
  });

  it.each(["0", "-1", "1.5", "1e2", "9223372036854775808"])("rejects invalid planned quantity %s", (value) => {
    show(source);
    fireEvent.change(screen.getByRole("textbox", { name: "Planned Production Quantity" }), { target: { value } });
    expect(screen.getByRole("button", { name: "Create Production Work Order" })).toBeDisabled();
  });

  it("reuses the request UUID after an unknown outcome for the same payload", async () => {
    submit.mockResolvedValue({ ok: false, error: { code: "unknown_outcome", message: "Creation could not be confirmed." } });
    show({ ...source, inputs: [] });
    fireEvent.change(screen.getByRole("textbox", { name: "Planned Production Quantity" }), { target: { value: "005" } });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Create Production Work Order" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create Work Order" }));
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(attempt + 1));
    }
    expect(submit.mock.calls[0]?.[0].creationRequestId).toBe(submit.mock.calls[1]?.[0].creationRequestId);
    expect(onProduced).not.toHaveBeenCalled();
  });

  it("blocks archived Products and never claims Inventory changed", () => {
    show({ ...source, outputIsActive: false });
    expect(screen.getByText(/output Product is archived/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Production Work Order" })).toBeDisabled();
    expect(screen.queryByText(/Production completed/)).not.toBeInTheDocument();
  });
});
