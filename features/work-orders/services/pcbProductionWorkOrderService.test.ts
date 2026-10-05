import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
import {
  getPcbProductionWorkOrderContext,
  normalizeActualGoodQuantity,
} from "./pcbProductionWorkOrderService";

const workOrderId = "11111111-1111-4111-8111-111111111111";
const row = {
  work_order_id: workOrderId,
  pcb_card_id: "22222222-2222-4222-8222-222222222222",
  pcb_card_name: "Controller",
  bom_version_id: "33333333-3333-4333-8333-333333333333",
  bom_version_number: "9007199254740993",
  planned_quantity: "9223372036854775807",
  output_product_id: "44444444-4444-4444-8444-444444444444",
  output_serial_number: "0000123",
  output_product_name: "Controller",
  actual_good_quantity: "0",
};

beforeEach(() => vi.clearAllMocks());

describe("PCB production Work Order context", () => {
  it("preserves exact bigint strings and narrow output", async () => {
    mocks.rpc.mockResolvedValue({ data: [row], error: null });
    expect(await getPcbProductionWorkOrderContext(workOrderId)).toEqual({ ok: true, value: {
      workOrderId,
      pcbCardId: row.pcb_card_id,
      pcbCardName: "Controller",
      bomVersionId: row.bom_version_id,
      bomVersionNumber: "9007199254740993",
      plannedQuantity: "9223372036854775807",
      outputProductId: row.output_product_id,
      outputSerialNumber: "0000123",
      outputProductName: "Controller",
      actualGoodQuantity: "0",
    } });
  });

  it("returns null for an ordinary Work Order and fails closed on malformed rows", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await getPcbProductionWorkOrderContext(workOrderId)).toEqual({ ok: true, value: null });
    mocks.rpc.mockResolvedValueOnce({ data: [{ ...row, planned_quantity: 5 }], error: null });
    expect(await getPcbProductionWorkOrderContext(workOrderId)).toMatchObject({ ok: false });
  });

  it("normalizes leading zeros without Number coercion and enforces 0..planned", () => {
    expect(normalizeActualGoodQuantity("000", "10")).toBe("0");
    expect(normalizeActualGoodQuantity("008", "10")).toBe("8");
    expect(normalizeActualGoodQuantity("9007199254740993", "9223372036854775807"))
      .toBe("9007199254740993");
    expect(normalizeActualGoodQuantity("11", "10")).toBeNull();
    expect(normalizeActualGoodQuantity("1e1", "10")).toBeNull();
    expect(normalizeActualGoodQuantity("-1", "10")).toBeNull();
  });
});
