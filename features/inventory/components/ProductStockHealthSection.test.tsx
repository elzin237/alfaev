import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";
import type { InventoryStockHealth } from "../services/inventoryStockHealthService";

const mocks = vi.hoisted(() => ({ hook: vi.fn(), gate: vi.fn(), save: vi.fn(), refetch: vi.fn() }));
vi.mock("../../../app/config/inventoryStockHealthActivation", () => ({ isInventoryStockHealthEnabled: mocks.gate }));
vi.mock("../hooks/useInventoryStockHealth", () => ({ useInventoryStockHealth: mocks.hook }));
import ProductStockHealthSection from "./ProductStockHealthSection";

const row: InventoryStockHealth = { productId: "product-1", warehouseId: INVENTORY_WAREHOUSES[0]!.id,
  productName: "Resistor", isActive: true, physicalQuantity: "10", minimumQuantity: "9007199254740993",
  version: "9007199254740993", status: "LOW_STOCK" };
const props = { productId: row.productId, serialNumber: "001", productIsActive: true, warehouseId: row.warehouseId };
function show(patch = {}) { return render(<ProductStockHealthSection {...props} {...patch} />); }
beforeEach(() => {
  vi.resetAllMocks(); mocks.gate.mockReturnValue(true); mocks.save.mockResolvedValue({ ok: true, value: {} });
  mocks.hook.mockReturnValue({ allowed: true, canEdit: true, rows: [row], save: mocks.save,
    query: { isFetching: false, refetch: mocks.refetch } });
});
afterEach(cleanup);

it("keeps settings compact, collapsed and keyboard-accessible without technical metadata", () => {
  show();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getAllByRole("heading", { name: "Stock Health" })).toHaveLength(1);
  expect(screen.getAllByText("Low Stock")).toHaveLength(1);
  const edit = screen.getByRole("button", { name: "Edit Minimum" });
  expect(edit).toHaveClass("rounded-xl", "focus-visible:ring-2");
  fireEvent.click(edit);
  const input = screen.getByRole("textbox", { name: /Minimum for/ });
  expect(input).toHaveFocus(); expect(input).toHaveAttribute("inputmode", "numeric");
  expect(input).toHaveClass("max-w-xs", "focus:ring-2");
  expect(screen.getByRole("form", { name: "Edit minimum stock" })).toHaveClass("max-w-md", "rounded-xl");
  expect(screen.queryByText(/Version:/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save minimum" })).toHaveClass("bg-zinc-900", "focus-visible:ring-2");
  expect(screen.getByRole("button", { name: "Clear minimum" })).toHaveClass("border-zinc-300", "focus-visible:ring-2");
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("focus-visible:ring-2");
  expect(screen.getByRole("button", { name: "Refresh stock health" })).toHaveClass("text-xs", "text-zinc-500");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("does not mount undeployed reads when the existing feature gate is OFF", () => {
  mocks.gate.mockReturnValue(false); show(); expect(mocks.hook).not.toHaveBeenCalled();
  expect(screen.queryByText("Minimum Stock")).not.toBeInTheDocument();
});
it.each(INVENTORY_WAREHOUSES)("uses the exact authorized $label Product/warehouse pair", warehouse => {
  mocks.hook.mockReturnValue({ ...mocks.hook(), rows: [{ ...row, warehouseId: warehouse.id }] });
  show({ warehouseId: warehouse.id });
  expect(mocks.hook).toHaveBeenLastCalledWith(warehouse.id, "001", null, true);
  expect(screen.getByText(row.minimumQuantity!)).toBeInTheDocument();
  expect(screen.getByText("Low Stock")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit Minimum" })).toBeInTheDocument();
});
it("updates and clears using exact bigint strings and the displayed version", async () => {
  show(); fireEvent.click(screen.getByRole("button", { name: "Edit Minimum" }));
  fireEvent.change(screen.getByRole("textbox", { name: /Minimum for/ }), { target: { value: "9223372036854775807" } });
  fireEvent.click(screen.getByRole("button", { name: "Save minimum" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(row.productId, "9223372036854775807", row.version));
  await waitFor(() => expect(screen.getByRole("button", { name: "Edit Minimum" })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Edit Minimum" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear minimum" }));
  await waitFor(() => expect(mocks.save).toHaveBeenLastCalledWith(row.productId, null, row.version));
});
it("shows Not Configured and supports first-write null version", async () => {
  mocks.hook.mockReturnValue({ ...mocks.hook(), rows: [{ ...row, minimumQuantity: null, version: null, status: "NOT_CONFIGURED" }] });
  show(); expect(screen.getAllByText("Not Configured")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Configure Minimum" }));
  fireEvent.change(screen.getByRole("textbox", { name: /Minimum for/ }), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Save minimum" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(row.productId, "5", null));
});
it.each(["0", "-1", "1.5", "abc", "9223372036854775808"])("rejects invalid minimum %s without dispatch", value => {
  show(); fireEvent.click(screen.getByRole("button", { name: "Edit Minimum" }));
  fireEvent.change(screen.getByRole("textbox", { name: /Minimum for/ }), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save minimum" }));
  expect(screen.getByRole("alert")).toHaveTextContent("positive whole number"); expect(mocks.save).not.toHaveBeenCalled();
});
it.each(["archived", "permission"])("keeps %s Products read-only", state => {
  mocks.hook.mockReturnValue({ ...mocks.hook(), canEdit: state !== "permission" });
  show({ productIsActive: state !== "archived" });
  expect(screen.getByText(row.minimumQuantity!)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Minimum/ })).not.toBeInTheDocument();
});
it("removes open editing controls after permission revocation", () => {
  const view = show(); fireEvent.click(screen.getByRole("button", { name: "Edit Minimum" }));
  mocks.hook.mockReturnValue({ ...mocks.hook(), canEdit: false });
  view.rerender(<ProductStockHealthSection {...props} />);
  expect(screen.queryByRole("button", { name: "Save minimum" })).not.toBeInTheDocument();
});
it("shows conflicts, prevents duplicate saves and preserves refresh", async () => {
  let finish!: (value: unknown) => void;
  mocks.save.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  show(); fireEvent.click(screen.getByRole("button", { name: "Edit Minimum" }));
  fireEvent.click(screen.getByRole("button", { name: "Save minimum" }));
  fireEvent.click(screen.getByRole("button", { name: "Save minimum" })); expect(mocks.save).toHaveBeenCalledTimes(1);
  finish({ ok: false, error: { message: "This minimum changed. Refresh and review." } });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("minimum changed"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh stock health" })); expect(mocks.refetch).toHaveBeenCalled();
});
it.each(["loading", "denied", "missing", "wrong warehouse"])("fails closed for %s data", state => {
  mocks.hook.mockReturnValue({ ...mocks.hook(), allowed: state !== "denied", rows: state === "wrong warehouse" ? [{ ...row, warehouseId: "other" }] : undefined,
    query: { isFetching: state === "loading", refetch: mocks.refetch, data: state === "denied" ? { ok: false, error: { message: "Denied" } } : undefined } });
  show(); expect(screen.getAllByText("Unavailable")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: /Minimum/ })).not.toBeInTheDocument();
});
it("does not carry an open edit or previous minimum into another warehouse", () => {
  const view = show(); fireEvent.click(screen.getByRole("button", { name: "Edit Minimum" }));
  const warehouseId = INVENTORY_WAREHOUSES[1]!.id;
  mocks.hook.mockReturnValue({ ...mocks.hook(), rows: [{ ...row, warehouseId, minimumQuantity: "7" }] });
  view.rerender(<ProductStockHealthSection {...props} warehouseId={warehouseId} />);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(screen.getByText("7")).toBeInTheDocument();
});
it("renders the refreshed authoritative configuration after clear without changing physical stock", async () => {
  const view = show(); fireEvent.click(screen.getByRole("button", { name: "Edit Minimum" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear minimum" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(row.productId, null, row.version));
  mocks.hook.mockReturnValue({ ...mocks.hook(), rows: [{ ...row, minimumQuantity: null, version: "9007199254740994", status: "NOT_CONFIGURED" }] });
  view.rerender(<ProductStockHealthSection {...props} />);
  expect(screen.getAllByText("Not Configured")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Configure Minimum" })).toBeInTheDocument();
  expect(screen.queryByText(row.minimumQuantity!)).not.toBeInTheDocument();
});
