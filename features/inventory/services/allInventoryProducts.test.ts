import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), select: vi.fn(), header: vi.fn(), range: vi.fn(), abort: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
import { listCompleteWarehouseProducts } from "./productService";
const raw = "10000000-0000-4000-8000-000000000001";
const row = { id: "one", warehouse_id: raw, serial_number: "0000001", name: "Component", category: "Part", brand_name: null, product_kind: "component", is_active: true, quantity: "9223372036854775807" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.rpc.mockReturnValue({ select: mocks.select }); mocks.select.mockReturnValue({ setHeader: mocks.header });
  mocks.header.mockReturnValue({ range: mocks.range }); mocks.range.mockReturnValue({ abortSignal: mocks.abort });
  mocks.abort.mockResolvedValue({ data: [row], count: 1, error: null });
});
describe("complete authorized warehouse reads", () => {
  it("accepts exactly 1,000 distinct rows but refuses larger snapshots without page retries", async () => {
    const makeRows = (n: number) => Array.from({ length: n }, (_, i) => ({ ...row, id: `row-${i}`, serial_number: String(i).padStart(7, "0") }));
    mocks.abort.mockResolvedValue({ data: makeRows(1000), count: 1000, error: null });
    const complete = await listCompleteWarehouseProducts(raw, "", "token");
    expect(complete.ok && complete.value.length).toBe(1000);
    mocks.rpc.mockClear();
    mocks.abort.mockResolvedValue({ data: makeRows(1001), count: 1001, error: null });
    expect(await listCompleteWarehouseProducts(raw, "", "token")).toMatchObject({ ok: false });
    expect(mocks.rpc).toHaveBeenCalledOnce(); expect(mocks.range).toHaveBeenLastCalledWith(0, 999);
  });
  it("uses canonical membership, literal backend search, exact count and lossless SQL text", async () => {
    const signal = new AbortController().signal;
    expect(await listCompleteWarehouseProducts(raw, "  name%  ", "token", signal)).toMatchObject({ ok: true, value: [{ quantity: 9223372036854775807n }] });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("search_inventory_products_by_warehouse", { p_warehouse_id: raw, p_search: "name%" }, { count: "exact" });
    expect(mocks.range).toHaveBeenCalledWith(0, 999); expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(mocks.select).toHaveBeenCalledWith(expect.stringContaining("quantity::text"));
  });
  it.each([
    { data: [row], count: 1001, error: null }, { data: [row], count: null, error: null },
    { data: [row, row], count: 2, error: null }, { data: [{ ...row, warehouse_id: "wrong" }], count: 1, error: null },
    { data: [{ ...row, quantity: 9007199254740992 }], count: 1, error: null }, { data: null, count: null, error: { code: "42501" } },
  ])("fails closed on truncation, unknown totals, duplicate identity or denied/invalid rows: %j", async response => {
    mocks.abort.mockResolvedValue(response);
    expect(await listCompleteWarehouseProducts(raw, "", "token")).toMatchObject({ ok: false });
  });
  it("accepts an authoritative empty warehouse without inventing any rows", async () => {
    mocks.abort.mockResolvedValue({ data: [], count: 0, error: null });
    expect(await listCompleteWarehouseProducts(raw, "", "token")).toEqual({ ok: true, value: [] });
  });
  it("never sends unknown warehouse IDs or missing authentication", async () => {
    await listCompleteWarehouseProducts("wrong", "", "token"); await listCompleteWarehouseProducts(raw, "", "");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("forwards cancellation rather than leaving an obsolete search running", async () => {
    const controller = new AbortController(); controller.abort();
    await listCompleteWarehouseProducts(raw, "old", "token", controller.signal);
    expect(mocks.abort.mock.calls[0]![0].aborted).toBe(true);
  });
});
