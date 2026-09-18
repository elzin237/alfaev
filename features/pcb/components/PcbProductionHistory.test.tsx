import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useHistory: vi.fn(), refetch: vi.fn() }));
vi.mock("../hooks/usePcbProductionHistory", () => ({ usePcbProductionHistory: mocks.useHistory }));
import PcbProductionHistory from "./PcbProductionHistory";

const cardId = "11111111-1111-4111-8111-111111111111";
const general = {
  productionRunId: "22222222-2222-4222-8222-222222222222",
  completedAt: "2026-09-18T10:00:00+00:00", quantityProduced: "9007199254740993",
  projectId: null, projectName: null,
  bomVersionId: "33333333-3333-4333-8333-333333333333", bomVersionNumber: "1",
  producedByUserId: "44444444-4444-4444-8444-444444444444", producedByFullName: "Former Producer",
};
beforeEach(() => mocks.useHistory.mockReturnValue({ isPending: false, isError: false,
  data: { ok: true, value: [general] }, refetch: mocks.refetch }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("PCB Production History section", () => {
  it("shows exact quantity, General Stock, version, actor, date and read-only columns", () => {
    render(<PcbProductionHistory cardId={cardId} />);
    expect(mocks.useHistory).toHaveBeenCalledWith(cardId);
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent))
      .toEqual(["Date", "Quantity", "Project", "BOM Version", "Produced By"]);
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByText("9007199254740993")).toBeInTheDocument();
    expect(within(row).getByText("General Stock")).toBeInTheDocument();
    expect(within(row).getByText("v1")).toBeInTheDocument();
    expect(within(row).getByText("Former Producer")).toBeInTheDocument();
    expect(within(row).getByText(/18 Sept 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("displays Project and exact historical BOM version in returned newest-first order", () => {
    mocks.useHistory.mockReturnValue({ isPending: false, isError: false,
      data: { ok: true, value: [
        { ...general, productionRunId: "55555555-5555-4555-8555-555555555555",
          projectId: "66666666-6666-4666-8666-666666666666", projectName: "Cancelled Project",
          bomVersionNumber: "2", quantityProduced: "3" },
        general,
      ] } });
    render(<PcbProductionHistory cardId={cardId} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("Cancelled Project")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("v2")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("General Stock")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("v1")).toBeInTheDocument();
  });

  it("distinguishes loading, retryable error and honest empty history", () => {
    mocks.useHistory.mockReturnValueOnce({ isPending: true });
    const loading = render(<PcbProductionHistory cardId={cardId} />);
    expect(screen.getByText("Loading PCB production history...")).toBeInTheDocument();
    loading.unmount();
    mocks.useHistory.mockReturnValueOnce({ isPending: false, isError: false,
      data: { ok: false, error: { code: "history_failed", message: "Safe history error." } }, refetch: mocks.refetch });
    const failed = render(<PcbProductionHistory cardId={cardId} />);
    expect(screen.getByText("Safe history error.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    failed.unmount();
    mocks.useHistory.mockReturnValueOnce({ isPending: false, isError: false,
      data: { ok: true, value: [] } });
    render(<PcbProductionHistory cardId={cardId} />);
    expect(screen.getByText("No production history yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
