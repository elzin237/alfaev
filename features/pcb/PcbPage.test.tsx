import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ usePcbCards: vi.fn(), usePcbCreation: vi.fn(), refetch: vi.fn(), create: vi.fn() }));
vi.mock("./hooks/usePcbCards", () => ({ usePcbCards: mocks.usePcbCards }));
vi.mock("./hooks/usePcbCreation", () => ({ usePcbCreation: mocks.usePcbCreation }));

import PcbPage from "./PcbPage";

describe("PCB list and creation", () => {
  beforeEach(() => {
    mocks.usePcbCards.mockReturnValue({ isPending: false, isError: false, data: { ok: true, value: [
      { id: "a", name: "Active Card", serialNumber: "0000001", currentStock: 0, isActive: true },
      { id: "b", name: "Legacy Card", serialNumber: "0000002", currentStock: 3, isActive: false },
    ] }, refetch: mocks.refetch });
    mocks.usePcbCreation.mockReturnValue({ canCreate: true, create: mocks.create });
    mocks.create.mockResolvedValue({ ok: true, value: { pcbCardId: "a", productId: "p", serialNumber: "0000003" } });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("renders active and archived Cards, stock, serials and creator action", () => {
    render(<PcbPage />);
    expect(screen.getByText("Active Card")).toBeInTheDocument();
    expect(screen.getByText("Legacy Card")).toBeInTheDocument();
    expect(screen.getByText("0000001")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create PCB Card" })).toBeInTheDocument();
  });

  it("fails closed for a view-only creator", () => {
    mocks.usePcbCreation.mockReturnValue({ canCreate: false, create: mocks.create });
    render(<PcbPage />);
    expect(screen.queryByRole("button", { name: "Create PCB Card" })).not.toBeInTheDocument();
  });

  it("shows loading, error with retry, and empty states", () => {
    mocks.usePcbCards.mockReturnValueOnce({ isPending: true });
    const view = render(<PcbPage />);
    expect(screen.getByText("Loading PCB Cards...")).toBeInTheDocument();
    view.unmount();
    mocks.usePcbCards.mockReturnValueOnce({ isPending: false, isError: true, refetch: mocks.refetch });
    const errorView = render(<PcbPage />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalled();
    errorView.unmount();
    mocks.usePcbCards.mockReturnValueOnce({ isPending: false, isError: false, data: { ok: true, value: [] } });
    render(<PcbPage />);
    expect(screen.getByText("No PCB Cards found")).toBeInTheDocument();
  });

  it("validates name, submits only normalized name, and shows generated Serial", async () => {
    render(<PcbPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create PCB Card" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll("input")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create PCB Card" }));
    expect(screen.getByRole("alert")).toHaveTextContent("required");
    fireEvent.change(screen.getByLabelText("Name / Code"), { target: { value: "  Controller  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create PCB Card" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith("Controller"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("0000003");
  });

  it("prevents duplicate submits and keeps safe backend errors visible", async () => {
    let finish: ((result: { ok: false; error: { code: string; message: string } }) => void) | undefined;
    mocks.create.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<PcbPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create PCB Card" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name / Code"), { target: { value: "Card" } });
    const submit = within(dialog).getByRole("button", { name: "Create PCB Card" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    finish?.({ ok: false, error: { code: "pcb_create_failed", message: "PCB Card could not be created." } });
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("could not be created"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
