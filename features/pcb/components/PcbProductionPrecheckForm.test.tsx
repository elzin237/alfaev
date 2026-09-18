import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

describe("PCB production precheck form", () => {
  it("starts without fabricated totals, allows general stock, and calculates insufficient physical stock", () => {
    render(<PcbProductionPrecheckForm source={source} projects={projects} />);
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
    expect(screen.queryByRole("button", { name: /Confirm Production/ })).not.toBeInTheDocument();
  });

  it("shows ready preview but never offers production execution", () => {
    render(<PcbProductionPrecheckForm source={{ ...source, inputs: [{ ...source.inputs[0]!, availableQuantity: "10" }] }} projects={[]} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity to Produce" }), { target: { value: "5" } });
    expect(screen.getByText(/Current physical stock meets/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm Production/ })).not.toBeInTheDocument();
  });

  it("blocks readiness for archived input or output and shows an honest empty BOM", () => {
    const archived = render(<PcbProductionPrecheckForm source={{ ...source, inputs: [{ ...source.inputs[0]!, isActive: false }] }} projects={[]} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity to Produce" }), { target: { value: "1" } });
    expect(screen.getByText("Archived / unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/Current physical stock meets/)).not.toBeInTheDocument();
    archived.unmount();
    const output = render(<PcbProductionPrecheckForm source={{ ...source, outputIsActive: false }} projects={[]} />);
    expect(screen.getByText(/output Product is archived/)).toBeInTheDocument();
    output.unmount();
    render(<PcbProductionPrecheckForm source={{ ...source, inputs: [] }} projects={[]} />);
    expect(screen.getByText("No BOM inputs")).toBeInTheDocument();
  });

  it.each(["0", "-1", "1.5", "1e2", "9223372036854775808"])("rejects invalid quantity %s", (value) => {
    render(<PcbProductionPrecheckForm source={source} projects={[]} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity to Produce" }), { target: { value } });
    expect(screen.getByText(/positive whole-number quantity/)).toBeInTheDocument();
    expect(screen.queryByText("Requirements")).not.toBeInTheDocument();
  });
});
