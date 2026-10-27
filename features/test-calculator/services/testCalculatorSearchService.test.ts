import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
import { searchTestCalculatorProducts } from "./testCalculatorSearchService";
const row = { product_id: "10000000-0000-4000-8000-000000000001", name: "Component", serial_number: "0000123", product_kind: "component", source_policy: "raw_customs_fg" };
beforeEach(() => vi.resetAllMocks());
describe("Test Calculator Product search contract", () => {
  it("calls only the trusted search RPC and preserves identity, serial and source policy", async () => {
    mocks.rpc.mockResolvedValue({ data: [row], error: null });
    expect(await searchTestCalculatorProducts("  Component  ", 25)).toEqual({ ok: true, value: [{
      productId: row.product_id, name: row.name, serialNumber: "0000123", productKind: "component", sourcePolicy: "raw_customs_fg",
    }] });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("search_test_calculator_products", { p_search: "Component", p_limit: 25 });
    mocks.rpc.mockResolvedValue({ data: [{ ...row, serial_number: "007", product_kind: "pcb_finished_good", source_policy: "finished_goods_only" }], error: null });
    expect(await searchTestCalculatorProducts("")).toMatchObject({ ok: true, value: [{ serialNumber: "007", sourcePolicy: "finished_goods_only" }] });
  });
  it("rejects malformed, duplicate, private-extra and inconsistent rows instead of fabricating data", async () => {
    for (const data of [null, {}, [row,row], [{ ...row, product_id: "invalid" }], [{ ...row, serial_number: 123 }],
      [{ ...row, name: " " }], [{ ...row, source_policy: "finished_goods_only" }], [{ ...row, private_receipt: {} }]]) {
      mocks.rpc.mockResolvedValueOnce({ data, error: null });
      expect((await searchTestCalculatorProducts("x")).ok).toBe(false);
    }
  });
  it("reports permission and network failures without leaking backend errors", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "private detail" } });
    expect(await searchTestCalculatorProducts("x")).toMatchObject({ ok: false, error: { code: "access_denied" } });
    mocks.rpc.mockRejectedValueOnce(new Error("private connection"));
    expect(JSON.stringify(await searchTestCalculatorProducts("x"))).not.toContain("private connection");
  });
  it("validates search bounds before dispatch", async () => {
    for (const limit of [0,101,1.5]) expect((await searchTestCalculatorProducts("x",limit)).ok).toBe(false);
    expect((await searchTestCalculatorProducts("x".repeat(201))).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
