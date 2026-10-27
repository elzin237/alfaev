import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), select: vi.fn(), abort: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
import { reserveFinishedGoods, releaseFinishedGoods, fulfillFinishedGoods, getFinishedGoodsActiveState,
  SQL_BIGINT_MAX, parseReservationQuantity, reservationReceiptProjection, fulfillmentReceiptProjection } from "./projectFinishedGoodsMutationService";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const input = { projectId: id(1), productId: id(2), reservationId: id(3), quantity: 2n, expectedVersion: 4n, requestId: id(4) };
const receipt = { reservation_id: id(3), project_id: id(1), product_id: id(2), reserved_quantity: "5", reservation_version: "5", event_id: id(5) };
beforeEach(() => {
  vi.resetAllMocks(); mocks.rpc.mockReturnValue({ select: mocks.select }); mocks.select.mockReturnValue({ abortSignal: mocks.abort });
  mocks.abort.mockResolvedValue({ data: [receipt], error: null });
});
describe("Finished Goods mutation transport", () => {
  it.each([[reserveFinishedGoods, "reserve_finished_goods_for_project"], [releaseFinishedGoods, "release_finished_goods_project_reservation"]] as const)
    ("uses the exact %s positive-delta contract and lossless receipt projection", async (call, rpc) => {
      expect(await call(input)).toMatchObject({ ok: true, value: { reservedQuantity: 5n, reservationVersion: 5n } });
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(rpc, { p_project_id: id(1), p_product_id: id(2), p_quantity: "2", p_expected_version: "4", p_request_id: id(4) });
      expect(mocks.select).toHaveBeenCalledWith(reservationReceiptProjection);
    });
  it("fulfills using the exact identity and casts all physical quantities", async () => {
    mocks.abort.mockResolvedValue({ data: [{ ...receipt, movement_id: id(6), physical_quantity_before: "9", physical_quantity_after: "7" }], error: null });
    expect(await fulfillFinishedGoods(input)).toMatchObject({ ok: true, value: { movementId: id(6), physicalQuantityBefore: 9n, physicalQuantityAfter: 7n } });
    expect(mocks.rpc).toHaveBeenCalledWith("fulfill_finished_goods_project_reservation", expect.objectContaining({ p_reservation_id: id(3) }));
    expect(mocks.select).toHaveBeenCalledWith(fulfillmentReceiptProjection);
  });
  it("preserves missing version zero and retained zero reservation versions", async () => {
    mocks.abort.mockResolvedValue({ data: [{ ...receipt, reservation_version: "1" }], error: null });
    expect((await reserveFinishedGoods({ ...input, reservationId: null, expectedVersion: 0n })).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ p_expected_version: "0" }));
    mocks.abort.mockResolvedValue({ data: [{ ...receipt, reserved_quantity: "0" }], error: null });
    expect(await releaseFinishedGoods(input)).toMatchObject({ ok: true, value: { reservationId: id(3), reservedQuantity: 0n, reservationVersion: 5n } });
  });
  it("preserves SQL bigint maximum quantities and large versions end-to-end", async () => {
    mocks.abort.mockResolvedValue({ data: [{ ...receipt, reserved_quantity: SQL_BIGINT_MAX.toString(), reservation_version: "9007199254740994" }], error: null });
    expect(await reserveFinishedGoods({ ...input, quantity: SQL_BIGINT_MAX, expectedVersion: 9007199254740993n })).toMatchObject({ ok: true,
      value: { reservedQuantity: SQL_BIGINT_MAX, reservationVersion: 9007199254740994n } });
    expect(mocks.rpc).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ p_quantity: SQL_BIGINT_MAX.toString(), p_expected_version: "9007199254740993" }));
  });
  it.each(["", "0", "-1", "1.5", "1e2", "01", " 1", "9223372036854775808"])("rejects invalid quantity text %j", value => {
    expect(parseReservationQuantity(value)).toBeNull();
  });
  it.each([{ quantity: 0n }, { quantity: -1n }, { quantity: SQL_BIGINT_MAX + 1n }, { expectedVersion: -1n },
    { expectedVersion: SQL_BIGINT_MAX + 1n }, { requestId: "invalid" }, { reservationId: null }, { reservationId: id(3), expectedVersion: 0n }])
    ("rejects invalid parameters before transport %o", async patch => {
      expect(await reserveFinishedGoods({ ...input, ...patch })).toMatchObject({ ok: false, error: { code: "22023", uncertain: false } });
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  it.each([{ reserved_quantity: 5 }, { reserved_quantity: "9223372036854775808" }, { reservation_version: "6" },
    { project_id: id(8) }, { reservation_id: id(8) }, { reserved_quantity: "1.2" }, { protected_field: "secret" }])
    ("treats malformed successful receipts as UNCERTAIN %j", async patch => {
      mocks.abort.mockResolvedValue({ data: [{ ...receipt, ...patch }], error: null });
      expect(await reserveFinishedGoods(input)).toMatchObject({ ok: false, error: { uncertain: true } });
    });
  it.each(["FGR01", "FGR02", "FGR03", "FGR04", "FGR05", "FGR06", "FGR07", "FGR08", "FGR09", "42501", "22023", "P0002", "IVB01", "IVB02", "IVL02", "PGRST202", "42883"])
    ("safely maps atomic database rejection %s", async code => {
      mocks.abort.mockResolvedValue({ data: null, error: { code, message: "SECRET SQL" } });
      const result = await reserveFinishedGoods(input);
      expect(result).toMatchObject({ ok: false, error: { code, uncertain: false } });
      expect(JSON.stringify(result)).not.toContain("SECRET SQL");
    });
  it("retains uncertainty after network failure or unknown errors", async () => {
    mocks.abort.mockRejectedValueOnce(new TypeError("network"));
    expect(await reserveFinishedGoods(input)).toMatchObject({ ok: false, error: { uncertain: true } });
    mocks.abort.mockResolvedValueOnce({ error: { code: "unknown" } });
    expect(await reserveFinishedGoods(input)).toMatchObject({ ok: false, error: { uncertain: true } });
  });
  it("bounds the request and treats aborted transport as uncertain", async () => {
    vi.useFakeTimers();
    try {
      mocks.abort.mockImplementation((signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("timeout")))));
      const pending = reserveFinishedGoods(input); await vi.advanceTimersByTimeAsync(30_000);
      expect(await pending).toMatchObject({ ok: false, error: { uncertain: true } });
    } finally { vi.useRealTimers(); }
  });
  it("reads archive eligibility only through the trusted FG warehouse projection", async () => {
    mocks.abort.mockResolvedValue({ data: [{ product_id: id(2), is_active: false }], error: null });
    expect(await getFinishedGoodsActiveState(id(2))).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith("get_inventory_product_by_warehouse", { p_product_id: id(2), p_warehouse_id: "10000000-0000-4000-8000-000000000002" });
    expect(mocks.select).toHaveBeenCalledWith("product_id,is_active");
  });
  it("uses real SDK transport without bigint JSON numbers (mock HTTP, not database acceptance)", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ ...receipt, reserved_quantity: "9007199254740993" }]), { status: 200, headers: { "Content-Type": "application/json" } }));
    const sdk = createClient("https://unit-test.invalid", "unit-test-key", { global: { fetch: fetcher }, auth: { persistSession: false } });
    mocks.rpc.mockImplementation((name, args) => sdk.rpc(name, args));
    expect(await reserveFinishedGoods({ ...input, quantity: 9007199254740993n }, "captured-identity-token")).toMatchObject({ ok: true, value: { reservedQuantity: 9007199254740993n } });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(new URL(url).searchParams.get("select")).toBe(reservationReceiptProjection);
    expect(JSON.parse(options.body)).toMatchObject({ p_quantity: "9007199254740993", p_expected_version: "4" });
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer captured-identity-token");
  });
});
