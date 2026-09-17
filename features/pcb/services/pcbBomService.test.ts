import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc } }));

import {
  getPcbBomEditor, parseEditableQuantity, saveInitialPcbBom,
  searchPcbBomProductChoices,
} from "./pcbBomService";

const cardId = "11111111-1111-4111-8111-111111111111";
const outputId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const inputId = "44444444-4444-4444-8444-444444444444";
const itemId = "55555555-5555-4555-8555-555555555555";

const noBom = {
  card_id: cardId, card_name: "Controller", card_is_active: true,
  output_product_id: outputId, output_serial_number: "0000001", output_current_stock: "0",
  active_bom_version_id: null, active_bom_version_number: null,
  bom_item_id: null, input_product_id: null, input_product_name: null,
  input_serial_number: null, input_product_kind: null, input_product_is_active: null,
  input_current_stock: null, quantity_per_card: null,
};

describe("PCB BOM service", () => {
  beforeEach(() => rpc.mockReset());

  it("reads an empty card through only the narrow detail RPC", async () => {
    rpc.mockResolvedValue({ data: [noBom], error: null });
    expect(await getPcbBomEditor(cardId)).toEqual({ ok: true, value: {
      cardId, name: "Controller", isActive: true, outputProductId: outputId,
      outputSerialNumber: "0000001", outputCurrentStock: "0",
      versionId: null, versionNumber: null, items: [],
    } });
    expect(rpc).toHaveBeenCalledWith("get_pcb_bom_editor", { p_pcb_card_id: cardId });
  });

  it("maps archived historical inputs and bigint text without unsafe coercion", async () => {
    rpc.mockResolvedValue({ data: [{ ...noBom,
      active_bom_version_id: versionId, active_bom_version_number: "1",
      bom_item_id: itemId, input_product_id: inputId, input_product_name: "Old Product",
      input_serial_number: "0000002", input_product_kind: "pcb_finished_good",
      input_product_is_active: false, input_current_stock: "9007199254740993",
      quantity_per_card: "9007199254740993",
    }], error: null });
    const result = await getPcbBomEditor(cardId);
    expect(result).toMatchObject({ ok: true, value: { versionId, versionNumber: "1", items: [{
      productId: inputId, isActive: false, currentStock: "9007199254740993",
      quantityPerCard: "9007199254740993",
    }] } });
  });

  it.each(["1", "2", "3", "9223372036854775807"])(
    "preserves active BOM version %s exactly on read", async (versionNumber) => {
      rpc.mockResolvedValue({ data: [{ ...noBom,
        active_bom_version_id: versionId, active_bom_version_number: versionNumber,
      }], error: null });
      expect(await getPcbBomEditor(cardId)).toMatchObject({ ok: true, value: {
        versionId, versionNumber, items: [],
      } });
    },
  );

  it.each(["0", "-1", "1.5", "1e2", "01", "not-a-version", "9223372036854775808", 2])(
    "rejects malformed active BOM version %s on read", async (versionNumber) => {
      rpc.mockResolvedValue({ data: [{ ...noBom,
        active_bom_version_id: versionId, active_bom_version_number: versionNumber,
      }], error: null });
      expect(await getPcbBomEditor(cardId)).toMatchObject({ ok: false, error: { code: "read_failed" } });
    },
  );

  it("fails safely for missing, provider, and malformed detail data", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "private" } })
      .mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "private" } })
      .mockResolvedValueOnce({ data: [{ ...noBom, output_current_stock: 1.5 }], error: null })
      .mockResolvedValueOnce({ data: [{ ...noBom, active_bom_version_id: versionId }], error: null })
      .mockResolvedValueOnce({ data: [{ ...noBom, card_id: outputId }], error: null });
    expect(await getPcbBomEditor(cardId)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await getPcbBomEditor(cardId)).toMatchObject({ ok: false, error: { code: "read_failed" } });
    expect(await getPcbBomEditor(cardId)).toMatchObject({ ok: false, error: { code: "read_failed" } });
    expect(await getPcbBomEditor(cardId)).toMatchObject({ ok: false, error: { code: "read_failed" } });
    expect(await getPcbBomEditor(cardId)).toMatchObject({ ok: false, error: { code: "read_failed" } });
    expect(rpc).toHaveBeenCalledTimes(5);
    expect(await getPcbBomEditor("bad-id")).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(rpc).toHaveBeenCalledTimes(5);
  });

  it("searches active choices through only the narrow RPC and validates stock", async () => {
    rpc.mockResolvedValueOnce({ data: [{ product_id: inputId, product_name: "Input",
      serial_number: "0000002", product_kind: "component", current_stock: "3" }], error: null })
      .mockResolvedValueOnce({ data: [{ product_id: inputId, product_name: "Input",
        serial_number: "0000002", product_kind: "component", current_stock: 3.5 }], error: null });
    expect(await searchPcbBomProductChoices(cardId, "  0000  ")).toMatchObject({ ok: true, value: [{
      productId: inputId, currentStock: "3",
    }] });
    expect(rpc).toHaveBeenCalledWith("search_pcb_bom_product_choices", {
      p_pcb_card_id: cardId, p_search: "0000",
    });
    expect(await searchPcbBomProductChoices(cardId, "")).toMatchObject({ ok: false, error: { code: "choices_failed" } });
  });

  it("saves a complete ID/quantity-only payload, including an empty initial BOM", async () => {
    rpc.mockResolvedValue({ data: [{ bom_version_id: versionId, version_number: "1" }], error: null });
    expect(await saveInitialPcbBom(cardId, [{ productId: inputId, quantityPerCard: "002" }]))
      .toEqual({ ok: true, value: { versionId, versionNumber: "1" } });
    expect(rpc).toHaveBeenCalledWith("save_initial_pcb_bom", {
      p_pcb_card_id: cardId, p_items: [{ product_id: inputId, quantity_per_card: "2" }],
    });
    expect(await saveInitialPcbBom(cardId, [])).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("save_initial_pcb_bom", { p_pcb_card_id: cardId, p_items: [] });
  });

  it.each(["1", "2", "3", "9223372036854775807", 1, 2, 3])(
    "preserves valid save version %s", async (versionNumber) => {
      rpc.mockResolvedValue({ data: [{ bom_version_id: versionId, version_number: versionNumber }], error: null });
      expect(await saveInitialPcbBom(cardId, [])).toEqual({ ok: true, value: {
        versionId, versionNumber: String(versionNumber),
      } });
    },
  );

  it.each(["0", "-1", "1.5", "1e2", "01", "invalid", "9223372036854775808", 0, -1,
    1.5, Number.MAX_SAFE_INTEGER + 1, null])(
    "rejects invalid save version %s", async (versionNumber) => {
      rpc.mockResolvedValue({ data: [{ bom_version_id: versionId, version_number: versionNumber }], error: null });
      expect(await saveInitialPcbBom(cardId, [])).toMatchObject({ ok: false, error: { code: "save_failed" } });
    },
  );

  it("preserves exact bigint quantities in the RPC JSON payload", async () => {
    rpc.mockResolvedValue({ data: [{ bom_version_id: versionId, version_number: "1" }], error: null });
    for (const quantity of ["9007199254740993", "9223372036854775807"]) {
      expect(parseEditableQuantity(quantity)).toBe(quantity);
      expect(await saveInitialPcbBom(cardId, [{ productId: inputId, quantityPerCard: quantity }]))
        .toMatchObject({ ok: true });
      expect(rpc).toHaveBeenLastCalledWith("save_initial_pcb_bom", {
        p_pcb_card_id: cardId, p_items: [{ product_id: inputId, quantity_per_card: quantity }],
      });
    }
  });

  it("rejects malformed, duplicate and overflowing quantities before RPC execution", async () => {
    for (const quantity of ["0", "-1", "1.5", "1e3", "not-a-number", "9223372036854775808"]) {
      expect(parseEditableQuantity(quantity)).toBeNull();
      expect(await saveInitialPcbBom(cardId, [{ productId: inputId, quantityPerCard: quantity }]))
        .toMatchObject({ ok: false, error: { code: "invalid_items" } });
    }
    expect(await saveInitialPcbBom(cardId, [
      { productId: inputId, quantityPerCard: "1" }, { productId: inputId, quantityPerCard: "2" },
    ])).toMatchObject({ ok: false, error: { code: "invalid_items" } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps every expected save error and rejects malformed RPC success", async () => {
    for (const [code, expected] of [
      ["42501", "access_denied"], ["P0002", "not_found"], ["PCB07", "card_archived"],
      ["PCB06", "bom_unavailable"], ["PCB04", "product_unavailable"],
      ["PCB05", "invalid_items"],
      ["22023", "invalid_items"], ["23505", "duplicate_product"], ["XX000", "save_failed"],
    ]) {
      rpc.mockResolvedValueOnce({ data: null, error: { code, message: "private SQL text" } });
      const result = await saveInitialPcbBom(cardId, [{ productId: inputId, quantityPerCard: "1" }]);
      expect(result).toMatchObject({ ok: false, error: { code: expected } });
      if (!result.ok) expect(result.error.message).not.toContain("private");
    }
    rpc.mockResolvedValueOnce({ data: [{ bom_version_id: "bad-id", version_number: "2" }], error: null });
    expect(await saveInitialPcbBom(cardId, [])).toMatchObject({ ok: false, error: { code: "save_failed" } });
  });
});
