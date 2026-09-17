import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ usePcbBomHistory: vi.fn(), refetch: vi.fn() }));
vi.mock("../hooks/usePcbBomHistory", () => ({ usePcbBomHistory: mocks.usePcbBomHistory }));

import PcbBomHistory from "./PcbBomHistory";

const cardId = "11111111-1111-4111-8111-111111111111";
const v1 = {
  versionId: "22222222-2222-4222-8222-222222222222",
  versionNumber: "1", isActive: true, createdAt: "2026-09-17T12:30:00+00:00",
  createdByUserId: "33333333-3333-4333-8333-333333333333",
  createdByFullName: "Former Admin", productionUsed: false,
};

describe("PCB BOM History section", () => {
  beforeEach(() => mocks.usePcbBomHistory.mockReturnValue({ isPending: false, isError: false,
    data: { ok: true, value: [v1] }, refetch: mocks.refetch }));
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("shows one active unused version with creator and absolute date", () => {
    render(<PcbBomHistory cardId={cardId} />);
    expect(mocks.usePcbBomHistory).toHaveBeenCalledWith(cardId);
    const row = screen.getByRole("row", { name: /v1/ });
    expect(within(row).getByText("v1")).toBeInTheDocument();
    expect(within(row).getByText("17 Sept 2026")).toBeInTheDocument();
    expect(within(row).getByText("Former Admin")).toBeInTheDocument();
    expect(within(row).getByText("No")).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();
  });

  it("shows a used active version and newest-first historical versions read-only", () => {
    mocks.usePcbBomHistory.mockReturnValue({ isPending: false, isError: false,
      data: { ok: true, value: [
        { ...v1, versionId: "55555555-5555-4555-8555-555555555555",
          versionNumber: "3", productionUsed: true },
        { ...v1, versionId: "44444444-4444-4444-8444-444444444444",
          versionNumber: "2", isActive: false, productionUsed: true },
        { ...v1, isActive: false, productionUsed: true },
      ] }, refetch: mocks.refetch });
    render(<PcbBomHistory cardId={cardId} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByText(/^v[123]$/).textContent)).toEqual(["v3", "v2", "v1"]);
    expect(within(rows[0]!).getByText("Active")).toBeInTheDocument();
    for (const row of rows) expect(within(row).getByText("Yes")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Historical")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Historical")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows honest loading, error/retry and empty states independently", () => {
    mocks.usePcbBomHistory.mockReturnValueOnce({ isPending: true });
    const loading = render(<PcbBomHistory cardId={cardId} />);
    expect(screen.getByText("Loading PCB BOM history...")).toBeInTheDocument();
    loading.unmount();
    mocks.usePcbBomHistory.mockReturnValueOnce({ isPending: false, isError: false,
      data: { ok: false, error: { code: "history_failed", message: "Safe history error." } },
      refetch: mocks.refetch });
    const error = render(<PcbBomHistory cardId={cardId} />);
    expect(screen.getByText("Safe history error.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    error.unmount();
    mocks.usePcbBomHistory.mockReturnValueOnce({ isPending: false, isError: false,
      data: { ok: true, value: [] } });
    render(<PcbBomHistory cardId={cardId} />);
    expect(screen.getByText("No BOM history")).toBeInTheDocument();
    expect(screen.queryByText("v1")).not.toBeInTheDocument();
  });

  it("reflects a refetched rollover without constructing history locally", () => {
    const view = render(<PcbBomHistory cardId={cardId} />);
    expect(screen.getByText("v1")).toBeInTheDocument();
    mocks.usePcbBomHistory.mockReturnValue({ isPending: false, isError: false,
      data: { ok: true, value: [
        { ...v1, versionId: "44444444-4444-4444-8444-444444444444",
          versionNumber: "2" },
        { ...v1, isActive: false, productionUsed: true },
      ] } });
    view.rerender(<PcbBomHistory cardId={cardId} />);
    expect(screen.getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([
      expect.stringContaining("v2"), expect.stringContaining("v1"),
    ]);
    expect(within(screen.getByRole("row", { name: /v2/ })).getByText("Active")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /v1/ })).getByText("Historical")).toBeInTheDocument();
  });
});
