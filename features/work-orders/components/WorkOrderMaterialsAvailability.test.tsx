import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gate: vi.fn(), hook: vi.fn(), retry: vi.fn(), change: vi.fn(), remove: vi.fn() }));
vi.mock("../../../app/config/workOrderAvailabilityActivation", () => ({ isWorkOrderAvailabilityEnabled: mocks.gate }));
vi.mock("../hooks/useWorkOrderAvailability", () => ({ useWorkOrderAvailability: mocks.hook }));
import WorkOrderMaterialsAvailability from "./WorkOrderMaterialsAvailability";
import WorkOrderDraftShell from "./WorkOrderDraftShell";
const id = "00000000-0000-4000-8000-000000000010", productId = "00000000-0000-4000-8000-000000000030";
const row = { productId, serialNumber: "0000123", productName: "S4-24VDC", quantity: "60", currentInventory: "55", sourceType: "manual" as const };
const material = { productId, serialNumber: row.serialNumber, productName: row.productName, productIsActive: true, required: "60", eligible: "55", missing: "5", hasShortage: true };
const value = { workOrderId: id, workOrderNumber: "RN-2026-0001", updatedAt: "2026-10-28T10:00:00Z", asOf: "2026-10-28T11:00:00Z", materials: [material] };
const base = { workOrderId: id, version: value.updatedAt, revision: "saved", unsaved: false, materials: [row],
  focusRequest: null, onQuantityChange: mocks.change, onRemove: mocks.remove };
beforeEach(() => { vi.resetAllMocks(); mocks.gate.mockReturnValue(true); mocks.hook.mockReturnValue({ allowed: true, value,
  query: { isFetching: false, isPending: false, refetch: mocks.retry } }); });
afterEach(cleanup);
it("shows exact shortage with accessible red row, accent and advisory text", () => {
  render(<WorkOrderMaterialsAvailability {...base} />);
  expect(screen.getByRole("columnheader", { name: "Available for Production" })).toBeInTheDocument();
  const r = screen.getByRole("row", { name: /S4-24VDC/ });
  expect(r).toHaveClass("bg-red-50/70"); expect(within(r).getAllByRole("cell")[0]).toHaveClass("border-l-red-500");
  expect(within(r).getByText("Short by 5")).toHaveClass("text-red-800");
  expect(screen.getByText(/not a reservation or a guarantee/)).toBeInTheDocument();
});
it("keeps sufficient material rows normal with no shortage warning", () => {
  mocks.hook.mockReturnValue({ allowed: true, value: { ...value, materials: [{ ...material, eligible: "60", missing: "0", hasShortage: false }] }, query: {} });
  render(<WorkOrderMaterialsAvailability {...base} />);
  expect(screen.getByRole("row", { name: /S4-24VDC/ })).not.toHaveClass("bg-red-50/70");
  expect(screen.queryByText(/Short by/)).not.toBeInTheDocument();
});
it("labels shared BOM/supplemental totals once without changing locked and editable controls", () => {
  render(<WorkOrderMaterialsAvailability {...base} showSource materials={[{ ...row, sourceType: "pcb_bom", quantity: "40" }, { ...row, quantity: "20" }]} />);
  const rows = screen.getAllByRole("row", { name: /S4-24VDC/ });
  expect(rows).toHaveLength(2); expect(screen.getByText(/Shared Product total shown above/)).toHaveTextContent("Short by 5 overall");
  expect(screen.getByText("Locked")).toBeInTheDocument(); expect(screen.getAllByRole("textbox")).toHaveLength(1);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "21" } }); expect(mocks.change).toHaveBeenCalledWith(productId, "manual", "21");
  fireEvent.click(screen.getByRole("button", { name: /Remove S4/ })); expect(mocks.remove).toHaveBeenCalledWith(productId, "manual");
});
it("preserves exact large bigint display", () => {
  mocks.hook.mockReturnValue({ allowed: true, value: { ...value, materials: [{ ...material, required: "9007199254740993", eligible: "9007199254740992", missing: "1" }] }, query: {} });
  render(<WorkOrderMaterialsAvailability {...base} materials={[{ ...row, quantity: "9007199254740993" }]} />);
  expect(screen.getByText("9007199254740992")).toBeInTheDocument(); expect(screen.getByText("Short by 1")).toBeInTheDocument();
});
it("hides observations when quantities are unsaved or no longer match the saved Product set", () => {
  const r = render(<WorkOrderMaterialsAvailability {...base} unsaved />);
  expect(screen.getByText(/Save material changes/)).toBeInTheDocument(); expect(screen.queryByText("Short by 5")).not.toBeInTheDocument();
  r.rerender(<WorkOrderMaterialsAvailability {...base} materials={[{ ...row, quantity: "61" }]} />);
  expect(screen.queryByText("Short by 5")).not.toBeInTheDocument(); expect(screen.getAllByText(/Availability unavailable/)).not.toHaveLength(0);
});
it("distinguishes loading and unavailable data and offers a bounded explicit retry", () => {
  mocks.hook.mockReturnValue({ allowed: true, value: undefined, query: { isFetching: true } });
  const r = render(<WorkOrderMaterialsAvailability {...base} />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading material availability"); expect(screen.queryByText("Short by 5")).not.toBeInTheDocument();
  mocks.hook.mockReturnValue({ allowed: true, value: undefined, query: { isFetching: false, refetch: mocks.retry } }); r.rerender(<WorkOrderMaterialsAvailability {...base} />);
  fireEvent.click(screen.getByRole("button", { name: "Retry availability" })); expect(mocks.retry).toHaveBeenCalledExactlyOnceWith({ cancelRefetch: false });
});
it("denied availability does not fabricate zero or change editable material behavior", () => {
  mocks.hook.mockReturnValue({ allowed: false, value: undefined, query: {} }); render(<WorkOrderMaterialsAvailability {...base} />);
  expect(screen.queryByRole("button", { name: "Retry availability" })).not.toBeInTheDocument();
  expect(screen.getAllByText(/Availability unavailable/)).not.toHaveLength(0); expect(screen.getByRole("textbox")).toHaveValue("60");
});
it("gate OFF preserves the original table and mounts no availability hook", () => {
  mocks.gate.mockReturnValue(false); render(<WorkOrderMaterialsAvailability {...base} />);
  expect(mocks.hook).not.toHaveBeenCalled(); expect(screen.getByRole("columnheader", { name: "Current Inventory" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Available for Production" })).not.toBeInTheDocument(); expect(screen.getByText("55")).toBeInTheDocument();
});
it("does not block Draft saving or change Finish submission when a shortage is shown", async () => {
  const projectId = "00000000-0000-4000-8000-000000000020";
  const save = vi.fn().mockResolvedValue({ ok: true, value: { workOrderId: id, updatedAt: value.updatedAt } });
  const finish = vi.fn().mockResolvedValue({ ok: false, error: { code: "insufficient_inventory", message: "Current stock is insufficient." } });
  render(<WorkOrderDraftShell workOrder={{ id, workOrderNumber: value.workOrderNumber, status: "draft", projectId,
    projectName: "Test Project", customerName: "Test", description: "Build", createdAt: value.updatedAt, updatedAt: value.updatedAt }}
    canEdit canDelete={false} canFinish projectChoices={[{ id: projectId, name: "Test Project", customerName: "Test", status: "planned" }]}
    projectChoicesError={null} projectChoicesLoading={false} persistedMaterials={[row]} materialsLoading={false}
    materialsError={null} materialsReady isSaving={false} isDeleting={false} isFinishing={false} isLoadingMaterial={false}
    onReloadLatest={vi.fn()} onRetryMaterials={vi.fn()} onRetryProjectChoices={vi.fn()} onLoadMaterial={vi.fn()}
    onSave={save} onDelete={vi.fn()} onFinishConfirm={finish} />);
  expect(await screen.findByText("Short by 5")).toBeInTheDocument();
  const saveButton = screen.getByRole("button", { name: "Save for Later" }); expect(saveButton).toBeEnabled();
  fireEvent.click(saveButton); await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mocks.hook).toHaveBeenLastCalledWith(id, value.updatedAt, expect.stringMatching(/^1:/), false));
  await waitFor(() => expect(screen.getByRole("button", { name: "Finish Work Order" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Finish Work Order" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Finish Work Order" }));
  await waitFor(() => expect(finish).toHaveBeenCalledWith(value.updatedAt));
  expect(await screen.findByText("Current stock is insufficient.")).toBeInTheDocument();
});
