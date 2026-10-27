import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectFinishedGoods } from "../services/projectFinishedGoodsService";

const mocks = vi.hoisted(() => ({ hook: vi.fn(), refetch: vi.fn(), retry: vi.fn() }));
vi.mock("../hooks/useProjectFinishedGoods", () => ({ useProjectFinishedGoods: mocks.hook }));
vi.mock("../hooks/useProjectFinishedGoodsMutations", () => ({
  useProjectFinishedGoodsMutations: () => ({ authorized: false, selection: null }),
}));
import { ProjectFinishedGoodsSection } from "./ProjectFinishedGoodsSection";

const projectId = "00000000-0000-4000-8000-000000000001";
const row: ProjectFinishedGoods = { productId: "00000000-0000-4000-8000-000000000003", productName: "Archived Calculator",
  serialNumber: "007", plannedRequirement: 20n, actualProjectConsumption: 2n, outstandingDemand: 18n,
  physicalQuantity: 20n, globallyReservedQuantity: 8n, availableQuantity: 12n, projectReservedQuantity: 3n,
  reservationId: "00000000-0000-4000-8000-000000000008", reservationVersion: 2n };
const query = (value: ProjectFinishedGoods[] = [row]) => ({ data: { ok: true, value }, isPending: false,
  isError: false, isFetching: false, refetch: mocks.refetch });
function state(overrides = {}) {
  mocks.hook.mockReturnValue({ contextQuery: query(), canView: true, checkingPermissions: false,
    permissionError: false, retryPermissions: mocks.retry, ...overrides });
}
beforeEach(() => { vi.resetAllMocks(); state(); });
afterEach(cleanup);

describe("Project Finished Goods read-only section", () => {
  it("shows one authoritative Project/Product total without global stock or group-level duplication", () => {
    render(<ProjectFinishedGoodsSection projectId={projectId} status="planned" />);
    expect(mocks.hook).toHaveBeenCalledWith(projectId);
    expect(screen.getAllByRole("columnheader").map(cell => cell.textContent)).toEqual([
      "Product / Serial Number", "Outstanding demand", "Reserved Finished Goods", "Unreserved Project demand",
    ]);
    expect(screen.getByText("Archived Calculator")).toBeInTheDocument();
    expect(screen.getByText("007")).toBeInTheDocument();
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells.map(cell => cell.textContent)).toEqual(["18", "3", "15"]);
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText(/One row per Product/)).toHaveTextContent("totals across all requirement groups");
    expect(screen.getByText(/Available stock is not a reservation for this Project/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Finished Goods requirements table" })).toHaveClass("max-h-[28rem]", "overflow-auto");
    expect(screen.getByRole("region", { name: "Finished Goods requirements table" })).toHaveAttribute("tabindex", "0");
    expect(screen.queryByRole("button", { name: /reserve|release|fulfill/i })).not.toBeInTheDocument();
  });
  it("does not invent a reservation when stock is available; retains zero-state distinctions", () => {
    state({ contextQuery: query([{ ...row, reservationId: null, reservationVersion: 0n, projectReservedQuantity: 0n }]) });
    const view = render(<ProjectFinishedGoodsSection projectId={projectId} status="planned" />);
    expect(screen.getByTitle("No reservation")).toHaveTextContent("0");
    state({ contextQuery: query([{ ...row, projectReservedQuantity: 0n, reservationVersion: 3n }]) });
    view.rerender(<ProjectFinishedGoodsSection projectId={projectId} status="planned" />);
    expect(screen.getByTitle("No quantity currently reserved")).toHaveTextContent("0");
  });
  it("displays zero stock and very large exact decimal values without rounding", () => {
    state({ contextQuery: query([{ ...row, plannedRequirement: 18446744073709551614n, actualProjectConsumption: 9007199254740993n,
      outstandingDemand: 18437736874454810621n, physicalQuantity: 0n, globallyReservedQuantity: 0n,
      availableQuantity: 0n, projectReservedQuantity: 0n, reservationId: null, reservationVersion: 0n }]) });
    render(<ProjectFinishedGoodsSection projectId={projectId} status="planned" />);
    expect(screen.getAllByRole("cell").map(cell => cell.textContent)).toEqual([
      "18437736874454810621", "0", "18437736874454810621",
    ]);
    expect(screen.queryByText("18446744073709551614")).not.toBeInTheDocument();
    expect(screen.queryByText("9007199254740993")).not.toBeInTheDocument();
  });
  it.each(["completed", "cancelled"] as const)("retains rows on %s Projects with truthful historical/current-stock wording", status => {
    render(<ProjectFinishedGoodsSection projectId={projectId} status={status} />);
    expect(screen.getByText("Archived Calculator")).toBeInTheDocument();
    expect(screen.getByText(/Closed Project history/)).toHaveTextContent("does not contribute to open-Project commitments");
    expect(screen.queryByRole("button", { name: /reserve|release|fulfill|reopen/i })).not.toBeInTheDocument();
  });
  it("clamps unreserved demand at zero", () => {
    state({ contextQuery: query([{ ...row, outstandingDemand: 0n }]) });
    render(<ProjectFinishedGoodsSection projectId={projectId} status="planned" />);
    expect(screen.getAllByRole("cell").map(cell => cell.textContent)).toEqual(["0", "3", "0"]);
  });
  it("shows loading and empty states", () => {
    state({ contextQuery: { ...query(), isPending: true } });
    const view = render(<ProjectFinishedGoodsSection projectId={projectId} status="planned" />);
    expect(screen.getByText("Loading Project Finished Goods...")).toBeInTheDocument();
    state({ contextQuery: query([]) }); view.rerender(<ProjectFinishedGoodsSection projectId={projectId} status="planned" />);
    expect(screen.getByText("No explicit Finished Goods requirements")).toBeInTheDocument();
    expect(screen.getByText(/group name does not create demand/)).toBeInTheDocument();
  });
  it.each([
    { canView: false },
    { canView: false, checkingPermissions: true },
    { canView: false, permissionError: true },
  ])("never shows cached protected rows without current authorization %j", access => {
    state(access); render(<ProjectFinishedGoodsSection projectId={projectId} status="planned" />);
    expect(screen.queryByText("Archived Calculator")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh Finished Goods" })).not.toBeInTheDocument();
  });
  it.each(["access_denied", "project_not_found", "not_available", "load_failed"])("handles %s without showing cached rows", code => {
    state({ contextQuery: { ...query(), data: { ok: false, error: { code, message: "Safe read error" } } } });
    render(<ProjectFinishedGoodsSection projectId={projectId} status="planned" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Safe read error");
    expect(screen.queryByText("Archived Calculator")).not.toBeInTheDocument();
    expect(Boolean(screen.queryByRole("button", { name: "Try again" }))).toBe(!["access_denied", "project_not_found"].includes(code));
  });
  it("handles transport errors, permission retry and explicit read refresh", () => {
    state({ contextQuery: { ...query(), isError: true } });
    const view = render(<ProjectFinishedGoodsSection projectId={projectId} status="planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(mocks.refetch).toHaveBeenCalledOnce();
    state({ canView: false, permissionError: true }); view.rerender(<ProjectFinishedGoodsSection projectId={projectId} status="planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(mocks.retry).toHaveBeenCalledOnce();
    state(); view.rerender(<ProjectFinishedGoodsSection projectId={projectId} status="planned" />);
    const refresh = screen.getByRole("button", { name: "Refresh Finished Goods" });
    refresh.focus(); expect(refresh).toHaveFocus(); fireEvent.click(refresh); expect(mocks.refetch).toHaveBeenCalledTimes(2);
  });
});
