import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), header: vi.fn(), abort: vi.fn(), gate: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("../../../app/config/workOrderAvailabilityActivation", () => ({ isWorkOrderAvailabilityEnabled: mocks.gate }));
import { availabilityTimestamp, getWorkOrderAvailability, parseWorkOrderAvailability } from "./workOrderAvailabilityService";
const id = "00000000-0000-4000-8000-000000000010";
const material = { product_id: "00000000-0000-4000-8000-000000000030", serial_number: "0000123", product_name: "Relay",
  product_is_active: true, required_quantity: "60", eligible_quantity: "55", missing_quantity: "5", has_shortage: true };
const data = { work_order_id: id, work_order_number: "RN-2026-0001", status: "draft",
  updated_at: "2026-10-28T10:00:00.000001+00:00", as_of: "2026-10-28T11:00:00+00:00", materials: [material] };
beforeEach(() => {
  vi.resetAllMocks(); mocks.gate.mockReturnValue(true);
  const chain = { setHeader: mocks.header, abortSignal: mocks.abort };
  mocks.rpc.mockReturnValue(chain); mocks.header.mockReturnValue(chain); mocks.abort.mockResolvedValue({ data, error: null });
});
it("calls only the trusted RPC with the exact Work Order and captured session token", async () => {
  expect(await getWorkOrderAvailability(id, "memory-token")).toMatchObject({ ok: true, value: { workOrderId: id, materials: [{ required: "60", eligible: "55", missing: "5" }] } });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_work_order_material_availability", { p_work_order_id: id });
  expect(mocks.header).toHaveBeenCalledWith("Authorization", "Bearer memory-token");
  expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
});
it("does not call an undeployed RPC when the release gate is OFF", async () => {
  mocks.gate.mockReturnValue(false); expect((await getWorkOrderAvailability(id, "token")).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([0, 55, 60, 65])("maps exact shortage with eligible %s", eligible => {
  const missing = Math.max(60 - eligible, 0);
  expect(parseWorkOrderAvailability({ ...data, materials: [{ ...material, eligible_quantity: String(eligible), missing_quantity: String(missing), has_shortage: missing > 0 }] }, id))
    .toMatchObject({ ok: true, value: { materials: [{ eligible: String(eligible), missing: String(missing) }] } });
});
it("preserves large bigint strings without rounding and supports empty Drafts", () => {
  expect(parseWorkOrderAvailability({ ...data, materials: [{ ...material, required_quantity: "9223372036854775807", eligible_quantity: "9007199254740993", missing_quantity: "9214364837600034814" }] }, id))
    .toMatchObject({ ok: true, value: { materials: [{ missing: "9214364837600034814" }] } });
  expect(parseWorkOrderAvailability({ ...data, materials: [] }, id)).toMatchObject({ ok: true, value: { materials: [] } });
});
it.each([{ required_quantity: 60 }, { eligible_quantity: "-1" }, { missing_quantity: "0" }, { has_shortage: false },
  { eligible_quantity: "9223372036854775808" }, { secret_receipt: {} }])("rejects malformed or inconsistent material %j", patch => {
  expect(parseWorkOrderAvailability({ ...data, materials: [{ ...material, ...patch }] }, id).ok).toBe(false);
});
it("rejects duplicates, wrong identity, finished state and invalid timestamps", () => {
  for (const patch of [{ materials: [material, material] }, { work_order_id: material.product_id }, { status: "finished" }, { as_of: "bad" }])
    expect(parseWorkOrderAvailability({ ...data, ...patch }, id).ok).toBe(false);
});
it("matches timestamp representations without losing stale-version microseconds", () => {
  expect(availabilityTimestamp(data.updated_at)).toBe(availabilityTimestamp("2026-10-28T12:00:00.000001+02:00"));
  expect(availabilityTimestamp(data.updated_at)).not.toBe(availabilityTimestamp("2026-10-28T10:00:00.000002Z"));
});
it("returns denied/network failures without fabricated stock", async () => {
  mocks.abort.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  expect(await getWorkOrderAvailability(id, "token")).toMatchObject({ ok: false, error: { code: "access_denied" } });
  mocks.abort.mockRejectedValueOnce(new Error("network")); expect((await getWorkOrderAvailability(id, "token")).ok).toBe(false);
});
it("does not dispatch an already aborted request", async () => {
  const controller = new AbortController(); controller.abort();
  expect((await getWorkOrderAvailability(id, "token", controller.signal)).ok).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
});
