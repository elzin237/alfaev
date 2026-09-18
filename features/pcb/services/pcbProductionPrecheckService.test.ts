import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc } }));
import { getPcbProductionPrecheck, listPcbProductionProjectChoices } from "./pcbProductionPrecheckService";

const cardId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const inputId = "44444444-4444-4444-8444-444444444444";
const base = {
  card_id: cardId, card_name: "Controller", output_product_id: productId,
  output_serial_number: "0000001", output_product_is_active: true,
  active_bom_version_id: versionId, active_bom_version_number: "2",
  input_product_id: inputId, input_product_name: "Resistor", input_serial_number: "0000002",
  input_product_is_active: true, quantity_per_card: "9007199254740993",
  available_quantity: "9223372036854775807",
};

describe("PCB production precheck reads", () => {
  beforeEach(() => rpc.mockReset());

  it("reads only the narrow source RPC and preserves exact physical quantities", async () => {
    rpc.mockResolvedValue({ data: [base], error: null });
    expect(await getPcbProductionPrecheck(cardId)).toEqual({ ok: true, value: {
      cardId, cardName: "Controller", outputProductId: productId, outputSerialNumber: "0000001",
      outputIsActive: true, versionId, versionNumber: "2", inputs: [{ productId: inputId,
        name: "Resistor", serialNumber: "0000002", isActive: true,
        quantityPerCard: "9007199254740993", availableQuantity: "9223372036854775807" }],
    } });
    expect(rpc).toHaveBeenCalledWith("get_pcb_production_precheck", { p_pcb_card_id: cardId });
  });

  it("preserves an active empty BOM and archived input visibility", async () => {
    rpc.mockResolvedValueOnce({ data: [{ ...base, input_product_id: null,
      input_product_name: null, input_serial_number: null, input_product_is_active: null,
      quantity_per_card: null, available_quantity: null }], error: null })
      .mockResolvedValueOnce({ data: [{ ...base, input_product_is_active: false }], error: null });
    expect(await getPcbProductionPrecheck(cardId)).toMatchObject({ ok: true, value: { inputs: [] } });
    expect(await getPcbProductionPrecheck(cardId)).toMatchObject({ ok: true,
      value: { inputs: [{ isActive: false }] } });
  });

  it("rejects malformed rows, duplicate inputs, and missing stock safely", async () => {
    for (const rows of [[{ ...base, available_quantity: null }],
      [{ ...base, active_bom_version_number: 2 }], [base, base]]) {
      rpc.mockResolvedValueOnce({ data: rows, error: null });
      expect(await getPcbProductionPrecheck(cardId)).toMatchObject({ ok: false,
        error: { code: "read_failed" } });
    }
  });

  it("maps provider/domain failures without leaking raw messages", async () => {
    for (const [sqlCode, code] of [["P0002", "not_found"], ["PCB07", "unavailable"],
      ["PCB06", "unavailable"], ["XX000", "read_failed"]]) {
      rpc.mockResolvedValueOnce({ data: null, error: { code: sqlCode, message: "private SQL detail" } });
      const result = await getPcbProductionPrecheck(cardId);
      expect(result).toMatchObject({ ok: false, error: { code } });
      if (!result.ok) expect(result.error.message).not.toContain("private");
    }
    expect(await getPcbProductionPrecheck("invalid")).toMatchObject({ ok: false,
      error: { code: "not_found" } });
    expect(rpc).toHaveBeenCalledTimes(4);
  });

  it("loads only open, minimal Project choices", async () => {
    const choices = [
      { project_id: productId, name: "Alpha", status: "planned" },
      { project_id: inputId, name: "Beta", status: "in_progress" },
      { project_id: versionId, name: "Gamma", status: "on_hold" },
    ];
    rpc.mockResolvedValue({ data: choices, error: null });
    expect(await listPcbProductionProjectChoices()).toEqual({ ok: true, value: [
      { projectId: productId, name: "Alpha", status: "planned" },
      { projectId: inputId, name: "Beta", status: "in_progress" },
      { projectId: versionId, name: "Gamma", status: "on_hold" },
    ] });
    expect(rpc).toHaveBeenCalledWith("list_pcb_production_project_choices");
  });

  it.each(["completed", "cancelled", "unknown"])("rejects an ineligible Project status %s", async (status) => {
    rpc.mockResolvedValue({ data: [{ project_id: productId, name: "Private", status }], error: null });
    expect(await listPcbProductionProjectChoices()).toMatchObject({ ok: false,
      error: { code: "read_failed" } });
  });
});
