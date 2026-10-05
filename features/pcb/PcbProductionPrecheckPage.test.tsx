import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ hook: vi.fn(), productionHook: vi.fn(), viewAccess: vi.fn(), sourceRetry: vi.fn(), projectsRetry: vi.fn() }));
vi.mock("./hooks/usePcbProductionPrecheck", () => ({ usePcbProductionPrecheck: mocks.hook }));
vi.mock("./hooks/usePcbProduction", () => ({ usePcbProduction: mocks.productionHook }));
vi.mock("../work-orders/hooks/useWorkOrderViewAccess", () => ({ useWorkOrderViewAccess: mocks.viewAccess }));
vi.mock("./components/PcbProductionPrecheckForm", () => ({ default: ({ onProduced }: {
  onProduced: (summary: { workOrderId: string; workOrderNumber: string; cardName: string; plannedQuantity: string; projectName: string | null }) => void;
}) => <button onClick={() => onProduced({ workOrderId: "33333333-3333-4333-8333-333333333333",
  workOrderNumber: "RN-2026-0001", cardName: "Controller", plannedQuantity: "9007199254740993", projectName: null })}>Precheck form</button> }));
import PcbProductionPrecheckPage from "./PcbProductionPrecheckPage";

const cardId = "11111111-1111-4111-8111-111111111111";
const source = { cardName: "Controller", outputSerialNumber: "0000001", versionNumber: "2" };
function show(id = cardId) {
  render(<MemoryRouter initialEntries={[`/pcb/${id}/produce`]}><Routes>
    <Route path="/pcb/:pcbCardId/produce" element={<PcbProductionPrecheckPage />} />
  </Routes></MemoryRouter>);
}
beforeEach(() => {
  mocks.productionHook.mockReturnValue({ submit: vi.fn(), isSubmitting: false });
  mocks.viewAccess.mockReturnValue({ canView: false, isChecking: false });
  mocks.hook.mockReturnValue({
  sourceQuery: { isPending: false, isError: false, data: { ok: true, value: source }, refetch: mocks.sourceRetry },
  projectsQuery: { isPending: false, isError: false, data: { ok: true, value: [] }, refetch: mocks.projectsRetry },
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("PCB production precheck page", () => {
  it("shows card identity, active version and read-only form", () => {
    show();
    expect(screen.getByText("Produce Controller")).toBeInTheDocument();
    expect(screen.getByText(/Output Serial Number: 0000001 · Active BOM v2/)).toBeInTheDocument();
    expect(screen.getByText("Precheck form")).toBeInTheDocument();
  });

  it("distinguishes loading, source error, missing card, and Project-choice failure", () => {
    mocks.hook.mockReturnValueOnce({ sourceQuery: { isPending: true }, projectsQuery: {} });
    show();
    expect(screen.getByText("Loading production precheck...")).toBeInTheDocument();
    cleanup();
    mocks.hook.mockReturnValueOnce({ sourceQuery: { isPending: false, isError: true, refetch: mocks.sourceRetry }, projectsQuery: {} });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.sourceRetry).toHaveBeenCalled();
    cleanup();
    mocks.hook.mockReturnValueOnce({ sourceQuery: { isPending: false, data: { ok: false,
      error: { code: "not_found", message: "PCB Card not found." } } }, projectsQuery: {} });
    show();
    expect(screen.getByText("PCB Card not found.")).toBeInTheDocument();
    cleanup();
    mocks.hook.mockReturnValueOnce({ sourceQuery: { isPending: false, data: { ok: true, value: source } },
      projectsQuery: { isPending: false, isError: true, refetch: mocks.projectsRetry } });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.projectsRetry).toHaveBeenCalled();
    expect(screen.queryByText("Precheck form")).not.toBeInTheDocument();
    cleanup();
    show("invalid");
    expect(screen.getByText("The PCB Card could not be found.")).toBeInTheDocument();
  });

  it("shows a safe created Work Order reference without unauthorized navigation", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Precheck form" }));
    expect(screen.getByText("Draft Work Order RN-2026-0001 was created.")).toBeInTheDocument();
    expect(screen.getByText("Planned quantity: 9007199254740993")).toBeInTheDocument();
    expect(screen.getByText("Destination: General Stock")).toBeInTheDocument();
    expect(screen.getByText(/Inventory has not changed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Precheck form" })).not.toBeInTheDocument();
  });
});
