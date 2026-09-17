import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ usePcbBomDetail: vi.fn(), refetch: vi.fn(), save: vi.fn() }));
vi.mock("./hooks/usePcbBomDetail", () => ({ usePcbBomDetail: mocks.usePcbBomDetail }));
vi.mock("./components/PcbBomEditor", () => ({ default: ({ canEdit }: { canEdit: boolean }) =>
  <div>Editor authority: {canEdit ? "editable" : "read-only"}</div> }));
vi.mock("./components/PcbBomHistory", () => ({ default: () => <section>BOM History section</section> }));

import PcbDetailPage from "./PcbDetailPage";

const cardId = "11111111-1111-4111-8111-111111111111";
const detail = {
  cardId, name: "Controller", isActive: true,
  outputProductId: "22222222-2222-4222-8222-222222222222",
  outputSerialNumber: "0000001", outputCurrentStock: "4",
  versionId: null, versionNumber: null, items: [],
};

function renderPage(id = cardId) {
  return render(<MemoryRouter initialEntries={[`/pcb/${id}`]}><Routes>
    <Route path="/pcb/:pcbCardId" element={<PcbDetailPage />} />
  </Routes></MemoryRouter>);
}

describe("PCB detail page", () => {
  beforeEach(() => {
    mocks.usePcbBomDetail.mockReturnValue({ detailQuery: { isPending: false, isError: false,
      data: { ok: true, value: detail }, refetch: mocks.refetch },
    canEdit: true, save: mocks.save, profileId: "profile" });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("renders the PCB header, stock, initial BOM state and back navigation", () => {
    renderPage();
    expect(screen.getByText("Controller")).toBeInTheDocument();
    expect(screen.getByText("0000001")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to PCB Cards/ })).toHaveAttribute("href", "/pcb");
    expect(screen.getByText("Editor authority: editable")).toBeInTheDocument();
    expect(screen.getByText("BOM History section")).toBeInTheDocument();
    expect(screen.queryByText(/Production History|Last Production/)).not.toBeInTheDocument();
  });

  it("renders version 1 and archived card as read-only", () => {
    mocks.usePcbBomDetail.mockReturnValue({ detailQuery: { isPending: false, isError: false,
      data: { ok: true, value: { ...detail, isActive: false, versionNumber: 1,
        versionId: "33333333-3333-4333-8333-333333333333" } } },
    canEdit: false, save: mocks.save, profileId: "profile" });
    renderPage();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("Editor authority: read-only")).toBeInTheDocument();
  });

  it("handles loading, retryable error, not-found and invalid IDs safely", () => {
    mocks.usePcbBomDetail.mockReturnValueOnce({ detailQuery: { isPending: true } });
    const loading = renderPage();
    expect(screen.getByText("Loading PCB Card...")).toBeInTheDocument();
    loading.unmount();
    mocks.usePcbBomDetail.mockReturnValueOnce({ detailQuery: { isPending: false, isError: true,
      refetch: mocks.refetch } });
    const error = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalled();
    error.unmount();
    mocks.usePcbBomDetail.mockReturnValueOnce({ detailQuery: { isPending: false, isError: false,
      data: { ok: false, error: { code: "not_found", message: "PCB Card not found." } } } });
    const missing = renderPage();
    expect(screen.getByText("PCB Card not found.")).toBeInTheDocument();
    missing.unmount();
    renderPage("bad-id");
    expect(screen.getByText("The PCB Card could not be found.")).toBeInTheDocument();
  });
});
