import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), eligible: vi.fn(), mutate: vi.fn(), permission: vi.fn(), refresh: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.auth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.permission }));
vi.mock("../hooks/useProjectFinishedGoods", () => ({ useProjectFinishedGoods: mocks.read }));
vi.mock("../services/projectFinishedGoodsService", () => ({ getProjectFinishedGoods: mocks.refresh }));
vi.mock("../services/projectFinishedGoodsMutationService", async original => ({
  ...await original<typeof import("../services/projectFinishedGoodsMutationService")>(),
  reserveFinishedGoods: mocks.mutate, releaseFinishedGoods: mocks.mutate, fulfillFinishedGoods: mocks.mutate, getFinishedGoodsActiveState: mocks.eligible,
}));
import { ProjectFinishedGoodsSection } from "./ProjectFinishedGoodsSection";
import type { ProjectStatus } from "../projectStatus";
import { installRecoveryBrowser } from "../../../test/finishedGoodsRecoveryBrowser";
import { prepareRecovery, updateRecovery, recoveryKey } from "../services/finishedGoodsRecoveryStore";
const projectId = "00000000-0000-4000-8000-000000000001";
const row = { productId: "00000000-0000-4000-8000-000000000002", productName: "Calculator", serialNumber: "007",
  plannedRequirement: 10n, actualProjectConsumption: 0n, outstandingDemand: 10n, physicalQuantity: 3n,
  globallyReservedQuantity: 3n, availableQuantity: 0n, projectReservedQuantity: 3n,
  reservationId: "00000000-0000-4000-8000-000000000003", reservationVersion: 5n };
function setup(status: ProjectStatus = "planned") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ProjectFinishedGoodsSection projectId={projectId} status={status} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks(); installRecoveryBrowser();
  mocks.refresh.mockResolvedValue({ ok: true, value: [] });
  mocks.auth.mockReturnValue({ session: { access_token: "test-token", user: { id: "00000000-0000-4000-8000-000000000200" } }, profile: { id: "00000000-0000-4000-8000-000000000100", isActive: true }, isAdmin: true });
  mocks.permission.mockResolvedValue({ ok: true, value: false }); mocks.eligible.mockResolvedValue(true);
  mocks.read.mockReturnValue({ contextQuery: { data: { ok: true, value: [row] }, refetch: vi.fn() }, canView: true });
  mocks.mutate.mockResolvedValue({ ok: true, value: { reservedQuantity: 0n, reservationVersion: 6n } });
});
afterEach(cleanup);
describe("Project Finished Goods mutation UI", () => {
  it("allows Fulfill/Release when global availability is zero, but not Reserve", async () => {
    setup(); expect(screen.getByRole("button", { name: "Reserve Calculator" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fulfill Calculator" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Fulfill Calculator" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Fulfill" })).toBeEnabled());
    expect(screen.getByText(/both this Project's reservation and physical/)).toBeInTheDocument();
    expect(screen.getByText("Maximum change at review: 3.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Quantity to fulfill"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Fulfill" }));
    await waitFor(() => expect(screen.getByText(/Operation confirmed/)).toBeInTheDocument());
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ operation: "fulfill", reservationId: row.reservationId, expectedVersion: 5n, quantity: 3n }), "test-token");
    expect(screen.queryByRole("button", { name: "Fulfill" })).not.toBeInTheDocument();
  });
  it("bounds Reserve by unreserved demand and preserves leading-zero serial text", async () => {
    mocks.read.mockReturnValue({ contextQuery: { data: { ok: true, value: [{ ...row, availableQuantity: 100n, physicalQuantity: 103n, outstandingDemand: 4n }] } }, canView: true });
    setup(); fireEvent.click(screen.getByRole("button", { name: "Reserve Calculator" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reserve" })).toBeEnabled());
    expect(screen.getByText("Maximum change at review: 1.")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("007")).toBeInTheDocument();
  });
  it("archived Product permits Release, denies Fulfill without name-based inference", async () => {
    mocks.eligible.mockResolvedValue(false); setup();
    fireEvent.click(screen.getByRole("button", { name: "Fulfill Calculator" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("archived"));
    expect(screen.getByRole("button", { name: "Fulfill" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Release Calculator" }));
    expect(screen.getByRole("button", { name: "Release" })).toBeEnabled();
    expect(mocks.eligible).toHaveBeenCalledOnce();
  });
  it("contains keyboard focus, Escape cancels safely, and returns focus to the action", () => {
    setup(); const trigger = screen.getByRole("button", { name: "Release Calculator" }); trigger.focus(); fireEvent.click(trigger);
    const input = screen.getByLabelText("Quantity to release"); expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true }); expect(screen.getByRole("button", { name: "Release" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" }); expect(input).toHaveFocus();
    screen.getByRole("button", { name: "Refresh Finished Goods" }).focus(); expect(input).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
  });
  it("locks ambiguous outcomes to exact retry and cannot Escape/cancel/edit into a new operation", async () => {
    mocks.mutate.mockResolvedValueOnce({ ok: false, error: { code: "outcome_uncertain", uncertain: true, message: "Outcome uncertain" } }); setup();
    fireEvent.click(screen.getByRole("button", { name: "Release Calculator" })); fireEvent.change(screen.getByLabelText("Quantity to release"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry exact original request" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled(); expect(screen.getByLabelText("Quantity to release")).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" }); expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry exact original request" }));
    await waitFor(() => expect(screen.getByText(/Operation confirmed/)).toBeInTheDocument());
    expect(mocks.mutate.mock.calls[1]![0]).toBe(mocks.mutate.mock.calls[0]![0]);
  });
  it.each(["completed", "cancelled"] as const)("shows %s history without mutation controls", status => {
    setup(status); expect(screen.queryByRole("columnheader", { name: "Reservation actions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Release Calculator" })).not.toBeInTheDocument();
  });
  it("read-only users never see active mutation controls", async () => {
    mocks.auth.mockReturnValue({ session: { user: { id: "auth" } }, profile: { id: "profile", isActive: true }, isAdmin: false }); setup();
    await waitFor(() => expect(mocks.permission).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Fulfill Calculator" })).not.toBeInTheDocument();
    expect(screen.getByText(/fulfillment is not included in the Material Usage table/)).toBeInTheDocument();
  });
  it("shows unavailable-backend rejection, never pretending activation succeeded", async () => {
    mocks.mutate.mockResolvedValue({ ok: false, error: { code: "42501", uncertain: false, message: "Not activated on this backend" } }); setup();
    fireEvent.click(screen.getByRole("button", { name: "Release Calculator" })); fireEvent.change(screen.getByLabelText("Quantity to release"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Not activated"));
    expect(screen.queryByText(/Operation confirmed/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry exact original request" })).toBeEnabled();
    expect(localStorage.length).toBe(1);
  });
  it("recovered success labels require explicit replay before any success confirmation", async () => {
    const identity = { authUserId: "00000000-0000-4000-8000-000000000200", profileId: "00000000-0000-4000-8000-000000000100", projectId };
    const original = { operation: "fulfill" as const, projectId, productId: row.productId, reservationId: row.reservationId,
      expectedVersion: 5n, quantity: 2n, requestId: "00000000-0000-4000-8000-000000000400" };
    updateRecovery(prepareRecovery(identity, original), "confirmed_success");
    setup(); expect(screen.getByText(/A saved request was recovered/)).toBeInTheDocument();
    expect(screen.queryByText(/Operation confirmed/)).not.toBeInTheDocument(); expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Quantity to fulfill")).toHaveValue("2");
    expect(screen.getByText(original.requestId)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry exact original request" }));
    await waitFor(() => expect(screen.getByText(/Operation confirmed and authoritative state refreshed/)).toBeInTheDocument());
    expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(original, "test-token"); expect(localStorage.getItem(recoveryKey(identity))).toBeNull();
  });
  it("corrupted recovery is visible, blocks actions, and is never silently reset", () => {
    const identity = { authUserId: "00000000-0000-4000-8000-000000000200", profileId: "00000000-0000-4000-8000-000000000100", projectId };
    localStorage.setItem(recoveryKey(identity), "bad-json"); setup();
    expect(screen.getByRole("alert")).toHaveTextContent("Do not clear browser data");
    expect(screen.getByRole("button", { name: "Fulfill Calculator" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Check recovery storage" }));
    expect(localStorage.getItem(recoveryKey(identity))).toBe("bad-json"); expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
