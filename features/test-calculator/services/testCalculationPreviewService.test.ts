import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
import { previewTestCalculation } from "./testCalculationPreviewService";
const id = "20000000-0000-4000-8000-000000000001";
const warehouses = [
  { warehouse_id: "10000000-0000-4000-8000-000000000001", warehouse_code: "raw_materials", quantity: "3" },
  { warehouse_id: "10000000-0000-4000-8000-000000000003", warehouse_code: "customs", quantity: "0" },
  { warehouse_id: "10000000-0000-4000-8000-000000000002", warehouse_code: "finished_goods", quantity: "0" },
];
const row = { product_id: id, name: "Component", serial_number: "0000123", product_kind: "component",
  required_quantity: "5", eligible_free_quantity: "4", project_priority_quantity: "1", eligible_availability: "3",
  reservable_quantity: "3", missing_quantity: "2", provisional_warehouse_quantities: warehouses,
  as_of: "2026-10-27T11:00:00.123456+00:00", save_will_recalculate: true };
beforeEach(() => vi.resetAllMocks());
describe("Test Calculation Preview exact contract", () => {
  it("calls only Preview with exact p_items and retains timestamp and warehouse allocations", async () => {
    mocks.rpc.mockResolvedValue({ data: [row], error: null });
    expect(await previewTestCalculation([{ product_id: id, quantity: "5" }])).toMatchObject({ ok: true, value: {
      asOf: row.as_of, saveWillRecalculate: true, rows: [{ productId: id, serialNumber: "0000123", required: "5", available: "3", reservable: "3", missing: "2", warehouses: [{ quantity: "3" },{ quantity: "0" },{ quantity: "0" }] }],
    } });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("preview_test_calculation", { p_items: [{ product_id: id, quantity: "5" }] });
  });
  it.each(["0","3","5"])("accepts zero/partial/full capacity %s", available => {
    mocks.rpc.mockResolvedValue({ data: [{ ...row, eligible_free_quantity: available, project_priority_quantity: "0", eligible_availability: available,
      reservable_quantity: available, missing_quantity: (5n-BigInt(available)).toString(), provisional_warehouse_quantities: warehouses.map((w,i) => ({ ...w, quantity: i === 0 ? available : "0" })) }], error: null });
    return expect(previewTestCalculation([{ product_id: id, quantity: "5" }])).resolves.toMatchObject({ ok: true, value: { rows: [{ available }] } });
  });
  it("preserves bigint input/output and aggregates beyond bigint without Number decoding", async () => {
    const max = "9223372036854775807";
    mocks.rpc.mockResolvedValue({ data: [{ ...row, required_quantity: max, eligible_free_quantity: "18446744073709551614", project_priority_quantity: "0",
      eligible_availability: "18446744073709551614", reservable_quantity: max, missing_quantity: "0",
      provisional_warehouse_quantities: warehouses.map((w,i) => ({ ...w, quantity: i === 0 ? max : "0" })) }], error: null });
    expect(await previewTestCalculation([{ product_id: id, quantity: max }])).toMatchObject({ ok: true, value: { rows: [{ required: max, available: "18446744073709551614" }] } });
    expect(mocks.rpc.mock.calls[0]![1].p_items[0].quantity).toBe(max);
  });
  it("accepts FG-only projection and never substitutes Raw/Customs stock", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...row, product_kind: "pcb_finished_good", serial_number: "007", project_priority_quantity: "0", eligible_free_quantity: "3",
      provisional_warehouse_quantities: [{ ...warehouses[2], quantity: "3" }] }], error: null });
    expect((await previewTestCalculation([{ product_id: id, quantity: "5" }])).ok).toBe(true);
  });
  it("rejects mismatched identities, arithmetic, numbers, incomplete rows and allocation leaks", async () => {
    for (const data of [[], [row,row], [{ ...row, product_id: "20000000-0000-4000-8000-000000000002" }],
      [{ ...row, required_quantity: 5 }], [{ ...row, required_quantity: "6" }], [{ ...row, missing_quantity: "0" }],
      [{ ...row, save_will_recalculate: false }], [{ ...row, receipt: {} }], [{ ...row, as_of: "invalid" }],
      [{ ...row, provisional_warehouse_quantities: [] }], [{ ...row, provisional_warehouse_quantities: [warehouses[0],warehouses[0],warehouses[0]] }]]) {
      mocks.rpc.mockResolvedValueOnce({ data, error: null });
      expect((await previewTestCalculation([{ product_id: id, quantity: "5" }])).ok).toBe(false);
    }
  });
  it("fails closed on invalid input, permission/network errors and never leaks details", async () => {
    expect((await previewTestCalculation([])).ok).toBe(false);
    expect((await previewTestCalculation([{ product_id: id, quantity: "9223372036854775808" }])).ok).toBe(false);
    expect((await previewTestCalculation([{ product_id: id, quantity: "1" },{ product_id: id, quantity: "1" }])).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "private" } });
    expect(await previewTestCalculation([{ product_id: id, quantity: "5" }])).toMatchObject({ ok: false, error: { code: "access_denied" } });
    mocks.rpc.mockRejectedValueOnce(new Error("private connection"));
    expect(JSON.stringify(await previewTestCalculation([{ product_id: id, quantity: "5" }]))).not.toContain("private connection");
  });
  it("requires an exact multi-Product response set and one consistent server snapshot", async () => {
    const other="20000000-0000-4000-8000-000000000002";
    const items=[{ product_id:id,quantity:"5" },{ product_id:other,quantity:"5" }];
    mocks.rpc.mockResolvedValueOnce({ data:[{ ...row,product_id:other },row],error:null });
    expect(await previewTestCalculation(items)).toMatchObject({ ok:true,value:{ rows:[{ productId:other },{ productId:id }],asOf:row.as_of } });
    mocks.rpc.mockResolvedValueOnce({ data:[row,{ ...row,product_id:other,as_of:"2026-10-27T11:00:01Z" }],error:null });
    expect((await previewTestCalculation(items)).ok).toBe(false);
  });
});
