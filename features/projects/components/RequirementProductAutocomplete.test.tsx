import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequirementProductAutocomplete } from "./RequirementProductAutocomplete";
import type { PlanningProductChoice } from "../services/projectPlanningService";

const choices: PlanningProductChoice[] = [
  { productId: "relay", name: "Relay", serialNumber: "0000123", productKind: "component" },
  { productId: "pcb", name: "PCB Output", serialNumber: "0000456", productKind: "pcb_finished_good" },
];
const onSelect = vi.fn();
const onSearch = vi.fn();
const onRetry = vi.fn();

function Harness(props: Partial<Parameters<typeof RequirementProductAutocomplete>[0]> = {}) {
  const [search, setSearch] = useState("");
  return <RequirementProductAutocomplete choices={choices} pending={false} error={null}
    onRetry={onRetry} initialProduct={null} disabled={false} onSelect={onSelect}
    search={search} onSearch={value => { setSearch(value); onSearch(value); }} {...props} />;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("RequirementProductAutocomplete", () => {
  it("focuses one accessible field and opens authorized Product choices with names and serials", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Product" });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Relay.*0000123.*Component/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /PCB Output.*0000456.*Finished PCB Product/ })).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription(/name or serial number/);
  });

  it("matches Product names case-insensitively and serial prefixes using the existing search callback", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "eLa" } });
    expect(onSearch).toHaveBeenLastCalledWith("eLa");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Relay");
    fireEvent.change(input, { target: { value: "00004" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("PCB Output");
    fireEvent.change(input, { target: { value: "456" } });
    expect(screen.getByRole("status")).toHaveTextContent("No products found");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("selects the exact clicked identity, shows its label, closes, and allows clearing or changing", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("option", { name: /PCB Output/ }));
    expect(onSelect).toHaveBeenLastCalledWith("pcb");
    expect(screen.getByRole("combobox")).toHaveValue("PCB Output — 0000456");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear Product selection" }));
    expect(onSelect).toHaveBeenLastCalledWith("");
    expect(onSearch).toHaveBeenLastCalledWith("");
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.click(screen.getByRole("option", { name: /Relay/ }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "PCB" } });
    expect(onSelect).toHaveBeenLastCalledWith("");
    expect(screen.getByRole("option")).toHaveTextContent("PCB Output");
  });

  it("supports arrows, wraparound, Enter selection and scrolls the active option into view", () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.getElementById(input.getAttribute("aria-activedescendant")!)).toHaveTextContent("Relay");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(document.getElementById(input.getAttribute("aria-activedescendant")!)).toHaveTextContent("PCB Output");
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("pcb");
    expect(input).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("pcb");
  });

  it("closes on Escape without closing the dialog, and Enter never submits unselected search text", () => {
    const onKeyDown = vi.fn();
    const onSubmit = vi.fn(event => event.preventDefault());
    render(<form onKeyDown={onKeyDown} onSubmit={onSubmit}><Harness /></form>);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    onKeyDown.mockClear();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("shows loading and error states instead of stale choices, and supports retry", () => {
    const view = render(<Harness pending />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Product choices");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    view.rerender(<Harness error="Product choices could not be loaded." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Product choices could not be loaded");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps the selected label and identity when search results refresh or omit a historical Product", () => {
    const view = render(<Harness initialProduct={choices[0]} choices={[]} />);
    expect(screen.getByRole("combobox")).toHaveValue("Relay — 0000123");
    expect(onSelect).not.toHaveBeenCalled();
    view.rerender(<Harness initialProduct={choices[0]} choices={[choices[1]!]} />);
    expect(screen.getByRole("combobox")).toHaveValue("Relay — 0000123");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("disables changes and hides the popup while saving", () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("option", { name: /Relay/ }));
    view.rerender(<Harness disabled />);
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear Product selection" })).toBeDisabled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("positions a scrollable portal above modal content without clipping and closes on outside interaction", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 650, bottom: 700, left: 16, width: 343, height: 50, right: 359, x: 16, y: 650, toJSON: () => ({}),
    });
    const view = render(<Harness />);
    const popup = screen.getByRole("listbox").parentElement!;
    expect(popup.parentElement).toBe(document.body);
    expect(view.container).not.toContainElement(popup);
    expect(popup).toHaveClass("fixed", "z-[70]", "overflow-y-auto");
    expect(popup).toHaveStyle({ left: "16px", width: "343px", maxHeight: "256px", top: "390px" });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("explains the bounded result window without fetching additional pages or the entire catalog", () => {
    render(<Harness choices={Array.from({ length: 50 }, (_, i) => ({ ...choices[0]!, productId: `p-${i}` }))} />);
    expect(screen.getByText(/Showing up to 50 matches/)).toBeInTheDocument();
    expect(onSearch).not.toHaveBeenCalled();
  });
});
