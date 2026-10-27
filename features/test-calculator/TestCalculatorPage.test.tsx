import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import ProductCalculatorNavigation from "../pcb/components/ProductCalculatorNavigation";
import TestCalculatorPage from "./TestCalculatorPage";

afterEach(cleanup);
describe("Test Calculator presentation foundation", () => {
  it("uses a restrained blue theme with a disabled creation action and truthful history placeholder", () => {
    render(<MemoryRouter initialEntries={["/pcb/test"]}><TestCalculatorPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "Test Calculator" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Test Calculation" })).toBeDisabled();
    expect(screen.getByRole("button")).toHaveAttribute("aria-describedby", "test-calculator-stage");
    expect(screen.getByRole("status")).toHaveTextContent("not activated");
    expect(screen.getByText(/No history has been loaded/)).toBeInTheDocument();
    expect(screen.queryByText("No saved calculations")).not.toBeInTheDocument();
    expect(document.querySelector(".border-blue-600")).toHaveClass("bg-blue-50");
    expect(screen.getByRole("button")).toHaveClass("w-full", "sm:w-auto");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("links to both destinations with an active Test indicator and wrapping responsive layout", () => {
    render(<MemoryRouter initialEntries={["/pcb/test"]}><TestCalculatorPage /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Normal Calculator" })).toHaveAttribute("href", "/pcb");
    expect(screen.getByRole("link", { name: "Test Calculator" })).toHaveAttribute("href", "/pcb/test");
    expect(screen.getByRole("link", { name: "Test Calculator" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Normal Calculator" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("navigation", { name: "Product Calculator" })).toHaveClass("flex", "flex-wrap", "gap-2");
  });
  it("navigates between Normal and Test without changing the Normal path", () => {
    render(<MemoryRouter initialEntries={["/pcb"]}><ProductCalculatorNavigation /><Routes>
      <Route path="/pcb" element={<h1>Normal destination</h1>} />
      <Route path="/pcb/test" element={<h1>Test destination</h1>} />
    </Routes></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Normal Calculator" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("link", { name: "Test Calculator" }));
    expect(screen.getByRole("heading", { name: "Test destination" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Normal Calculator" }));
    expect(screen.getByRole("heading", { name: "Normal destination" })).toBeInTheDocument();
  });
});
