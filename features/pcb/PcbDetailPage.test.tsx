import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ usePcbBomDetail: vi.fn(), refetch: vi.fn(), save: vi.fn() }));
vi.mock("./hooks/usePcbBomDetail", () => ({ usePcbBomDetail: mocks.usePcbBomDetail }));
const produceAccess = vi.hoisted(() => ({ usePcbProduceAccess: vi.fn() }));
vi.mock("./hooks/usePcbProduceAccess", () => ({ usePcbProduceAccess: produceAccess.usePcbProduceAccess }));
vi.mock("./components/PcbBomEditor", () => ({ default: ({ canEdit }: { canEdit: boolean }) =>
  <div>Editor authority: {canEdit ? "editable" : "read-only"}</div> }));
vi.mock("./components/PcbBomHistory", () => ({ default: () => <section>BOM History section</section> }));
vi.mock("./components/PcbProductionHistory", () => ({ default: () => <section>Production History section</section> }));

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
    produceAccess.usePcbProduceAccess.mockReturnValue(false);
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
    expect(screen.getByText("Finished Goods stock")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to Product Calculator/ })).toHaveAttribute("href", "/pcb");
    expect(screen.getByText("Editor authority: editable")).toBeInTheDocument();
    expect(screen.getByText("BOM History section")).toBeInTheDocument();
    expect(screen.getByText("Production History section")).toBeInTheDocument();
    expect(screen.getByText("BOM History section").compareDocumentPosition(
      screen.getByText("Production History section")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders version 1 and archived card as read-only", () => {
    produceAccess.usePcbProduceAccess.mockReturnValue(true);
    mocks.usePcbBomDetail.mockReturnValue({ detailQuery: { isPending: false, isError: false,
      data: { ok: true, value: { ...detail, isActive: false, versionNumber: 1,
        versionId: "33333333-3333-4333-8333-333333333333" } } },
    canEdit: false, save: mocks.save, profileId: "profile" });
    renderPage();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("Editor authority: read-only")).toBeInTheDocument();
    expect(screen.getByText("Production History section")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create Production Work Order" })).not.toBeInTheDocument();
  });

  it("links authorized active-card readers to the separate production precheck", () => {
    produceAccess.usePcbProduceAccess.mockReturnValue(true);
    renderPage();
    expect(screen.getByRole("link", { name: "Create Production Work Order" }))
      .toHaveAttribute("href", `/pcb/${cardId}/produce`);
  });

  it("handles loading, retryable error, not-found and invalid IDs safely", () => {
    mocks.usePcbBomDetail.mockReturnValueOnce({ detailQuery: { isPending: true } });
    const loading = renderPage();
    expect(screen.getByText("Loading finished-product definition...")).toBeInTheDocument();
    loading.unmount();
    mocks.usePcbBomDetail.mockReturnValueOnce({ detailQuery: { isPending: false, isError: true,
      refetch: mocks.refetch } });
    const error = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalled();
    error.unmount();
    mocks.usePcbBomDetail.mockReturnValueOnce({ detailQuery: { isPending: false, isError: false,
      data: { ok: false, error: { code: "not_found", message: "Finished-product definition not found." } } } });
    const missing = renderPage();
    expect(screen.getByText("Finished-product definition not found.")).toBeInTheDocument();
    missing.unmount();
    renderPage("bad-id");
    expect(screen.getByText("The Product Calculator definition could not be found.")).toBeInTheDocument();
  });
});
