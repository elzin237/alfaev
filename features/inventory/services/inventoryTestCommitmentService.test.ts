import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), header: vi.fn(), abort: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
import { getInventoryTestCommitments } from "./inventoryTestCommitmentService";
const raw = "10000000-0000-4000-8000-000000000001";
const fg = "10000000-0000-4000-8000-000000000002";
const customs = "10000000-0000-4000-8000-000000000003";
const row = { product_id: "00000000-0000-4000-8000-000000000001", warehouse_id: raw, quantity_scope: "raw_customs_planning",
  physical_quantity: "9223372036854775807", project_commitment_quantity: "18446744073709551614",
  available_after_projects: "-9223372036854775807", committed_to_tests: "9007199254740993",
  available_after_projects_and_tests: "-9232379236109516800", as_of: "2026-10-27T12:00:00.123456Z", next_expiry: "2026-10-28T23:00:00Z" };
beforeEach(() => {
  vi.resetAllMocks(); const chain = { setHeader: mocks.header, abortSignal: mocks.abort };
  mocks.rpc.mockReturnValue(chain); mocks.header.mockReturnValue(chain);
});
describe("authorized Inventory Test commitment transport", () => {
  it("uses only the trusted RPC with exact arguments, pinned actor and cancellation", async () => {
    mocks.abort.mockResolvedValue({ data: [row], error: null });
    const result = await getInventoryTestCommitments(raw, "  resistor  ", "memory-token");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_inventory_test_commitments", { p_warehouse_id: raw, p_search: "resistor" });
    expect(mocks.header).toHaveBeenCalledWith("Authorization", "Bearer memory-token");
    expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(result).toMatchObject({ ok: true, value: [{ committedToTests: "9007199254740993", availableAfterProjectsAndTests: "-9232379236109516800", asOf: row.as_of }] });
  });
  it.each([[fg, "finished_goods_reservations"], [customs, "customs_physical"]])("accepts the correct %s scope without deriving availability", async (warehouseId, scope) => {
    mocks.abort.mockResolvedValue({ data: [{ ...row, warehouse_id: warehouseId, quantity_scope: scope }], error: null });
    expect(await getInventoryTestCommitments(warehouseId, "", "token")).toMatchObject({ ok: true, value: [{ warehouseId, quantityScope: scope }] });
    expect(mocks.rpc.mock.calls[0]![1].p_search).toBeNull();
  });
  it("preserves authoritative zero and empty results, never substitutes zeros for failed reads", async () => {
    mocks.abort.mockResolvedValueOnce({ data: [{ ...row, committed_to_tests: "0", next_expiry: null }], error: null });
    expect(await getInventoryTestCommitments(raw, "", "token")).toMatchObject({ ok: true, value: [{ committedToTests: "0", nextExpiry: null }] });
    mocks.abort.mockResolvedValueOnce({ data: [], error: null });
    expect(await getInventoryTestCommitments(raw, "", "token")).toEqual({ ok: true, value: [] });
    mocks.abort.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "private" } });
    expect(await getInventoryTestCommitments(raw, "", "token")).toMatchObject({ ok: false, error: { code: "access_denied" } });
  });
  it.each([
    { committed_to_tests: 9007199254740993 }, { committed_to_tests: "-1" }, { available_after_projects_and_tests: "-0" },
    { available_after_projects: "01" }, { quantity_scope: "customs_physical" }, { warehouse_id: fg }, { as_of: "invalid" },
    { next_expiry: row.as_of }, { next_expiry: null }, { receipt: "private" },
  ])("fails closed on malformed, mismatched or private fields %j", async patch => {
    mocks.abort.mockResolvedValue({ data: [{ ...row, ...patch }], error: null });
    expect((await getInventoryTestCommitments(raw, "", "token")).ok).toBe(false);
  });
  it("rejects duplicate rows and inconsistent server snapshots", async () => {
    for (const data of [[row, row], [row, { ...row, product_id: "00000000-0000-4000-8000-000000000002", as_of: "2026-10-27T12:00:01Z" }]]) {
      mocks.abort.mockResolvedValueOnce({ data, error: null });
      expect((await getInventoryTestCommitments(raw, "", "token")).ok).toBe(false);
    }
  });
  it("rejects invalid target/token locally and redacts network errors", async () => {
    expect((await getInventoryTestCommitments("unknown", "", "token")).ok).toBe(false);
    expect((await getInventoryTestCommitments(raw, "", "")).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.abort.mockRejectedValueOnce(new Error("sensitive response"));
    expect(JSON.stringify(await getInventoryTestCommitments(raw, "", "token"))).not.toContain("sensitive response");
  });
});
