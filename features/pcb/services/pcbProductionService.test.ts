import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
import { producePcb } from "./pcbProductionService";

const pcbCardId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
beforeEach(() => vi.clearAllMocks());

describe("producePcb service", () => {
  it("calls only produce_pcb with exact string quantity and nullable Project, and validates the run ID", async () => {
    mocks.rpc.mockResolvedValue({ data: runId, error: null });
    expect(await producePcb({ pcbCardId, quantityToProduce: "9007199254740993", projectId: null }))
      .toEqual({ ok: true, value: { runId } });
    expect(mocks.rpc).toHaveBeenCalledWith("produce_pcb", {
      p_pcb_card_id: pcbCardId, p_quantity_to_produce: "9007199254740993", p_project_id: null,
    });
    await producePcb({ pcbCardId, quantityToProduce: "1", projectId });
    expect(mocks.rpc).toHaveBeenLastCalledWith("produce_pcb", {
      p_pcb_card_id: pcbCardId, p_quantity_to_produce: "1", p_project_id: projectId,
    });
    mocks.rpc.mockResolvedValue({ data: { run_id: runId }, error: null });
    expect((await producePcb({ pcbCardId, quantityToProduce: "1", projectId: null })).ok).toBe(false);
  });

  it.each([
    ["42501", "access_denied"], ["IVB02", "insufficient_inventory"],
    ["PCB06", "bom_unavailable"], ["PCB07", "card_unavailable"],
    ["PCB10", "project_unavailable"], ["PCB04", "product_unavailable"],
    ["PRD01", "product_unavailable"], ["P0002", "not_found"],
    ["22023", "invalid_production"], ["IVB01", "inventory_unavailable"],
    ["PCB01", "invalid_configuration"], ["PCB05", "invalid_configuration"],
    ["unexpected", "unknown_outcome"],
  ])("maps %s without leaking provider details", async (sqlstate, expectedCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: sqlstate, message: "private provider detail" } });
    const result = await producePcb({ pcbCardId, quantityToProduce: "1", projectId: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(expectedCode);
      expect(result.error.message).not.toContain("private provider detail");
    }
  });

  it("treats transport failure and malformed success as unconfirmed, without retry", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("secret transport detail"));
    expect((await producePcb({ pcbCardId, quantityToProduce: "1", projectId: null })).ok).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    const result = await producePcb({ pcbCardId, quantityToProduce: "1", projectId: null });
    expect(result).toMatchObject({ ok: false, error: { code: "unknown_outcome" } });
  });

  it("accepts positive leading-zero text exactly as preview and backend do", async () => {
    mocks.rpc.mockResolvedValue({ data: runId, error: null });
    expect(await producePcb({ pcbCardId, quantityToProduce: "005", projectId: null }))
      .toEqual({ ok: true, value: { runId } });
    expect(mocks.rpc).toHaveBeenCalledWith("produce_pcb", {
      p_pcb_card_id: pcbCardId, p_quantity_to_produce: "005", p_project_id: null,
    });
  });

  it.each(["0", "000", "-1", "1.2", "1e3", "9223372036854775808", " 1"])("rejects invalid quantity %s before RPC", async (quantityToProduce) => {
    expect((await producePcb({ pcbCardId, quantityToProduce, projectId: null })).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
