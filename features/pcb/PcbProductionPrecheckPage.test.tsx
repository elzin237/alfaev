import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ hook: vi.fn(), sourceRetry: vi.fn(), projectsRetry: vi.fn() }));
vi.mock("./hooks/usePcbProductionPrecheck", () => ({ usePcbProductionPrecheck: mocks.hook }));
vi.mock("./components/PcbProductionPrecheckForm", () => ({ default: () => <div>Precheck form</div> }));
import PcbProductionPrecheckPage from "./PcbProductionPrecheckPage";

const cardId = "11111111-1111-4111-8111-111111111111";
const source = { cardName: "Controller", outputSerialNumber: "0000001", versionNumber: "2" };
function show(id = cardId) {
  render(<MemoryRouter initialEntries={[`/pcb/${id}/produce`]}><Routes>
    <Route path="/pcb/:pcbCardId/produce" element={<PcbProductionPrecheckPage />} />
  </Routes></MemoryRouter>);
}
beforeEach(() => mocks.hook.mockReturnValue({
  sourceQuery: { isPending: false, isError: false, data: { ok: true, value: source }, refetch: mocks.sourceRetry },
  projectsQuery: { isPending: false, isError: false, data: { ok: true, value: [] }, refetch: mocks.projectsRetry },
}));
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
});
