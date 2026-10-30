import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ usePcbCards: vi.fn(), usePcbCreation: vi.fn(), refetch: vi.fn(), create: vi.fn() }));
vi.mock("./hooks/usePcbCards", () => ({ usePcbCards: mocks.usePcbCards }));
vi.mock("./hooks/usePcbCreation", () => ({ usePcbCreation: mocks.usePcbCreation }));
vi.mock("../../app/config/testCalculationImportActivation", () => ({ isTestCalculationImportEnabled: () => false }));

import PcbPage from "./PcbPage";

function renderPage() {
  return render(<MemoryRouter><PcbPage /></MemoryRouter>);
}

describe("PCB list and creation", () => {
  beforeEach(() => {
    mocks.usePcbCards.mockReturnValue({ isPending: false, isError: false, data: { ok: true, value: [
      { id: "a", name: "Active Card", serialNumber: "0000001", currentStock: 0, isActive: true },
      { id: "b", name: "Legacy Card", serialNumber: "0000002", currentStock: 3, isActive: false },
    ] }, refetch: mocks.refetch });
    mocks.usePcbCreation.mockReturnValue({ canCreate: true, create: mocks.create });
    mocks.create.mockResolvedValue({ ok: true, value: { pcbCardId: "a", productId: "p", serialNumber: "007" } });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("renders active and archived Cards, stock, serials and creator action", () => {
    renderPage();
    expect(screen.getByText("Active Card")).toBeInTheDocument();
    expect(screen.getByText("Legacy Card")).toBeInTheDocument();
    expect(screen.getByText("0000001")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Finished Goods stock" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Current Stock" })).not.toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Product Calculator" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import from Test" })).not.toBeInTheDocument();
  });

  it("fails closed for a view-only creator", () => {
    mocks.usePcbCreation.mockReturnValue({ canCreate: false, create: mocks.create });
    renderPage();
    expect(screen.queryByRole("button", { name: "Create Product Calculator" })).not.toBeInTheDocument();
  });

  it("shows loading, error with retry, and empty states", () => {
    mocks.usePcbCards.mockReturnValueOnce({ isPending: true });
    const view = renderPage();
    expect(screen.getByText("Loading Product Calculator...")).toBeInTheDocument();
    view.unmount();
    mocks.usePcbCards.mockReturnValueOnce({ isPending: false, isError: true, refetch: mocks.refetch });
    const errorView = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalled();
    errorView.unmount();
    mocks.usePcbCards.mockReturnValueOnce({ isPending: false, isError: false, data: { ok: true, value: [] } });
    renderPage();
    expect(screen.getByText("No finished-product definitions found")).toBeInTheDocument();
  });

  it("validates name and exact three-digit Serial, preserving leading zeroes", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Create Product Calculator" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll("input")).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Product Calculator" }));
    expect(screen.getByRole("alert")).toHaveTextContent("required");
    fireEvent.change(screen.getByLabelText("Name / Code"), { target: { value: "  Controller  " } });
    fireEvent.change(screen.getByLabelText("Three-digit Serial Number"), { target: { value: "07" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Product Calculator" }));
    expect(screen.getByRole("alert")).toHaveTextContent("exact three-digit");
    fireEvent.change(screen.getByLabelText("Three-digit Serial Number"), { target: { value: "007" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Product Calculator" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith("Controller", "007"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("007");
  });

  it("prevents duplicate submits and keeps safe backend errors visible", async () => {
    let finish: ((result: { ok: false; error: { code: string; message: string } }) => void) | undefined;
    mocks.create.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Create Product Calculator" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name / Code"), { target: { value: "Card" } });
    fireEvent.change(within(dialog).getByLabelText("Three-digit Serial Number"), { target: { value: "123" } });
    const submit = within(dialog).getByRole("button", { name: "Create Product Calculator" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    finish?.({ ok: false, error: { code: "pcb_create_failed", message: "Product Calculator could not be created." } });
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("could not be created"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the PCB detail route from a card name", () => {
    render(<MemoryRouter initialEntries={["/pcb"]}><Routes>
      <Route path="/pcb" element={<PcbPage />} />
      <Route path="/pcb/:pcbCardId" element={<div>PCB detail route</div>} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: "Active Card" }));
    expect(screen.getByText("PCB detail route")).toBeInTheDocument();
  });
});
