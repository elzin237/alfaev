import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
import { producePcb } from "./pcbProductionService";

const pcbCardId = "11111111-1111-4111-8111-111111111111";
const workOrderId = "33333333-3333-4333-8333-333333333333";
const creationRequestId = "44444444-4444-4444-8444-444444444444";
const input = { pcbCardId, plannedQuantity: "9007199254740993", creationRequestId };
beforeEach(() => vi.clearAllMocks());

describe("PCB production Work Order creation service", () => {
  it("calls only the trusted idempotent creation RPC with exact quantity text", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ work_order_id: workOrderId, work_order_number: "RN-2026-0001" }], error: null });
    expect(await producePcb(input)).toEqual({ ok: true, value: { workOrderId, workOrderNumber: "RN-2026-0001" } });
    expect(mocks.rpc).toHaveBeenCalledWith("create_pcb_production_work_order", {
      p_pcb_card_id: pcbCardId, p_planned_quantity: input.plannedQuantity,
      p_project_id: null, p_creation_request_id: creationRequestId,
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith("produce_pcb", expect.anything());
  });

  it.each([
    ["42501", "access_denied"], ["PCB06", "bom_unavailable"], ["PCB07", "card_unavailable"],
    ["PCB10", "project_unavailable"], ["PCB04", "product_unavailable"], ["PRD01", "product_unavailable"],
    ["P0002", "not_found"], ["22023", "invalid_production"], ["PCB13", "invalid_production"],
    ["unexpected", "unknown_outcome"],
  ])("maps %s without leaking provider details", async (sqlstate, expectedCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: sqlstate, message: "private provider detail" } });
    const result = await producePcb({ ...input, plannedQuantity: "1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(expectedCode);
      expect(result.error.message).not.toContain("private provider detail");
    }
  });

  it("treats transport and malformed success as an unknown outcome without retry", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("secret transport detail"));
    expect(await producePcb(input)).toMatchObject({ ok: false, error: { code: "unknown_outcome" } });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await producePcb(input)).toMatchObject({ ok: false, error: { code: "unknown_outcome" } });
  });

  it("preserves leading-zero decimal text and always submits a null Project", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ work_order_id: workOrderId, work_order_number: "RN-2026-0001" }], error: null });
    await producePcb({ ...input, plannedQuantity: "005" });
    expect(mocks.rpc).toHaveBeenCalledWith("create_pcb_production_work_order", expect.objectContaining({
      p_planned_quantity: "005", p_project_id: null,
    }));
  });

  it.each(["0", "000", "-1", "1.2", "1e3", "9223372036854775808", " 1"])("rejects invalid quantity %s before RPC", async (plannedQuantity) => {
    expect((await producePcb({ ...input, plannedQuantity })).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
