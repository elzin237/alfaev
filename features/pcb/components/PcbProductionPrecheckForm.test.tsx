import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PcbProductionPrecheckForm from "./PcbProductionPrecheckForm";
import type { PcbProductionSource } from "../services/pcbProductionPrecheckService";

const source: PcbProductionSource = {
  cardId: "11111111-1111-4111-8111-111111111111", cardName: "Controller",
  outputProductId: "22222222-2222-4222-8222-222222222222", outputSerialNumber: "0000001",
  outputIsActive: true, versionId: "33333333-3333-4333-8333-333333333333", versionNumber: "2",
  inputs: [{ productId: "44444444-4444-4444-8444-444444444444", name: "Resistor",
    serialNumber: "0000002", isActive: true, quantityPerCard: "2", availableQuantity: "3" }],
};
const projects = [{ projectId: "55555555-5555-4555-8555-555555555555", name: "Alpha", status: "planned" as const }];
afterEach(cleanup);
const submit = vi.fn().mockResolvedValue({ ok: true, value: { runId: "66666666-6666-4666-8666-666666666666" } });
const onProduced = vi.fn();
function show(precheckSource = source, choices = projects, isRefreshing = false) {
  return render(<PcbProductionPrecheckForm source={precheckSource} projects={choices}
    isRefreshing={isRefreshing} submit={submit} onProduced={onProduced} />);
}
afterEach(() => { vi.clearAllMocks(); });

describe("PCB production precheck form", () => {
  it("starts without fabricated totals, allows general stock, and calculates insufficient physical stock", () => {
    show();
    expect(screen.getByText("Enter quantity")).toBeInTheDocument();
    expect(screen.queryByText("Requirements")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "No Project / General stock" })).toHaveValue("");
    expect(screen.getByRole("option", { name: "Alpha — Planned" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity to Produce" }), { target: { value: "5" } });
    const row = screen.getByRole("row", { name: /Resistor/ });
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "Resistor 0000002", "2", "10", "3", "7",
    ]);
    expect(screen.getByText("Production cannot be completed because Inventory is insufficient.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm Production/ })).toBeDisabled();
  });

  it("opens explicit confirmation only from ready state and does not submit on first click", () => {
    show({ ...source, inputs: [{ ...source.inputs[0]!, availableQuantity: "10" }] }, []);
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity to Produce" }), { target: { value: "5" } });
    expect(screen.getByText(/Current physical stock meets/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Production" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Produce 5 × Controller?");
    expect(screen.getByRole("dialog")).toHaveTextContent("deduct BOM components and add 5 Controller cards");
    expect(screen.getByRole("dialog")).toHaveTextContent("General Stock");
    expect(screen.getByRole("textbox", { name: "Quantity to Produce" })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it("blocks readiness for archived input or output and describes an empty BOM honestly", () => {
    const archived = show({ ...source, inputs: [{ ...source.inputs[0]!, isActive: false }] }, []);
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity to Produce" }), { target: { value: "1" } });
    expect(screen.getByText("Archived / unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/Current physical stock meets/)).not.toBeInTheDocument();
    archived.unmount();
    const output = show({ ...source, outputIsActive: false }, []);
    expect(screen.getByText(/output Product is archived/)).toBeInTheDocument();
    output.unmount();
    show({ ...source, inputs: [] }, []);
    expect(screen.getByText(/This active BOM has no input Products/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("confirms and completes production with an empty active BOM using only the output Product", async () => {
    show({ ...source, inputs: [] }, []);
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity to Produce" }), { target: { value: "1" } });
    expect(screen.getByRole("button", { name: "Confirm Production" })).toBeEnabled();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Production" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Produce 1 × Controller?");
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Production" }));
    await waitFor(() => expect(onProduced).toHaveBeenCalledWith({
      runId: "66666666-6666-4666-8666-666666666666", cardName: "Controller",
      quantity: "1", projectName: null,
    }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      pcbCardId: source.cardId, quantityToProduce: "1", projectId: null,
      affectedProductIds: [source.outputProductId],
    });
  });

  it("keeps an empty BOM unavailable when output is inactive or quantity is invalid", () => {
    const inactive = show({ ...source, inputs: [], outputIsActive: false }, []);
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity to Produce" }), { target: { value: "1" } });
    expect(screen.getByRole("button", { name: "Confirm Production" })).toBeDisabled();
    inactive.unmount();
    show({ ...source, inputs: [] }, []);
    for (const value of ["0", "9223372036854775808"]) {
      fireEvent.change(screen.getByRole("textbox", { name: "Quantity to Produce" }), { target: { value } });
      expect(screen.getByRole("button", { name: "Confirm Production" })).toBeDisabled();
    }
  });

  it("keeps leading-zero quantity text unchanged through confirmation", async () => {
    show({ ...source, inputs: [] }, []);
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity to Produce" }), { target: { value: "005" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Production" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Produce 005 × Controller?");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm Production" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      quantityToProduce: "005", affectedProductIds: [source.outputProductId],
    })));
  });

  it.each(["0", "-1", "1.5", "1e2", "9223372036854775808"])("rejects invalid quantity %s", (value) => {
    show(source, []);
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity to Produce" }), { target: { value } });
    expect(screen.getByText(/positive whole-number quantity/)).toBeInTheDocument();
    expect(screen.queryByText("Requirements")).not.toBeInTheDocument();
  });

  it("sends one exact bigint quantity with selected Project and blocks rapid duplicate confirmation", async () => {
    const huge = "9007199254740993";
    show({ ...source, inputs: [{ ...source.inputs[0]!, quantityPerCard: "1", availableQuantity: huge }] });
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity to Produce" }), { target: { value: huge } });
    fireEvent.change(screen.getByRole("combobox", { name: "Project (optional)" }), { target: { value: projects[0]!.projectId } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Production" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(`Produce ${huge} × Controller?`);
    expect(dialog).toHaveTextContent("Project: Alpha");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Production" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm Production/ }));
    await waitFor(() => expect(onProduced).toHaveBeenCalledWith({
      runId: "66666666-6666-4666-8666-666666666666", cardName: "Controller",
      quantity: huge, projectName: "Alpha",
    }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({ pcbCardId: source.cardId, quantityToProduce: huge,
      projectId: projects[0]!.projectId, affectedProductIds: [source.inputs[0]!.productId, source.outputProductId] });
  });

  it("shows a safe server rejection and requires fresh quantity entry", async () => {
    submit.mockResolvedValueOnce({ ok: false, error: { code: "insufficient_inventory",
      message: "Production cannot be completed because Inventory is insufficient." } });
    show({ ...source, inputs: [{ ...source.inputs[0]!, availableQuantity: "10" }] });
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity to Produce" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Production" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm Production" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Inventory is insufficient"));
    expect(screen.getByRole("textbox", { name: "Quantity to Produce" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Confirm Production" })).toBeDisabled();
    expect(onProduced).not.toHaveBeenCalled();
  });

  it("keeps confirmation controls disabled while submitting and prevents a second RPC", async () => {
    let finish!: (value: { ok: true; value: { runId: string } }) => void;
    submit.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    show({ ...source, inputs: [{ ...source.inputs[0]!, availableQuantity: "10" }] });
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity to Produce" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Production" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Production" }));
    expect(within(dialog).getByRole("button", { name: "Confirm Production…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Quantity to Produce" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Production…" }));
    expect(submit).toHaveBeenCalledTimes(1);
    finish({ ok: true, value: { runId: "66666666-6666-4666-8666-666666666666" } });
    await waitFor(() => expect(onProduced).toHaveBeenCalledTimes(1));
  });

  it("does not claim success after an unknown transport outcome", async () => {
    submit.mockRejectedValueOnce(new Error("private transport detail"));
    show({ ...source, inputs: [{ ...source.inputs[0]!, availableQuantity: "10" }] });
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity to Produce" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Production" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm Production" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Production status could not be confirmed"));
    expect(screen.queryByText("private transport detail")).not.toBeInTheDocument();
    expect(onProduced).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Quantity to Produce" })).toHaveValue("");
  });
});
