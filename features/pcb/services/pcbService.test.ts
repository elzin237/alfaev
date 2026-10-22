import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc } }));

import { createPcbCard, listPcbCards } from "./pcbService";

const id = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";

describe("PCB service", () => {
  beforeEach(() => rpc.mockReset());

  it("uses only the trusted list RPC and maps the approved projection", async () => {
    rpc.mockResolvedValue({ error: null, data: [{
      pcb_card_id: id, card_name: "Controller", is_active: true,
      output_product_id: productId, serial_number: "007", current_stock: 0,
    }, {
      pcb_card_id: "33333333-3333-4333-8333-333333333333", card_name: "Legacy", is_active: false,
      output_product_id: "44444444-4444-4444-8444-444444444444", serial_number: "0000001", current_stock: 2,
    }] });
    expect(await listPcbCards()).toEqual({ ok: true, value: [{
      id, name: "Controller", isActive: true, outputProductId: productId,
      serialNumber: "007", currentStock: 0,
    }, {
      id: "33333333-3333-4333-8333-333333333333", name: "Legacy", isActive: false,
      outputProductId: "44444444-4444-4444-8444-444444444444",
      serialNumber: "0000001", currentStock: 2,
    }] });
    expect(rpc).toHaveBeenCalledWith("list_pcb_cards");
  });

  it("fails safely on malformed or failed list data", async () => {
    rpc.mockResolvedValueOnce({ error: null, data: [{ current_stock: null }] })
      .mockResolvedValueOnce({ error: { message: "private" }, data: null });
    expect(await listPcbCards()).toMatchObject({ ok: false, error: { code: "pcb_list_failed" } });
    expect(await listPcbCards()).toMatchObject({ ok: false, error: { code: "pcb_list_failed" } });
  });

  it("creates with a name and exact three-digit Serial", async () => {
    rpc.mockResolvedValue({ error: null, data: [{ pcb_card_id: id, product_id: productId, serial_number: "007" }] });
    expect(await createPcbCard("Controller", "007")).toEqual({ ok: true, value: {
      pcbCardId: id, productId, serialNumber: "007",
    } });
    expect(rpc).toHaveBeenCalledWith("create_pcb_card", {
      p_name: "Controller",
      p_serial_number: "007",
    });
  });

  it("maps authorization, invalid name and malformed results safely", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "42501", message: "private" }, data: null })
      .mockResolvedValueOnce({ error: { code: "22023", message: "private" }, data: null })
      .mockResolvedValueOnce({ error: null, data: [{ pcb_card_id: id, product_id: productId, serial_number: "bad" }] });
    expect(await createPcbCard("x", "123")).toMatchObject({ ok: false, error: { code: "access_denied" } });
    expect(await createPcbCard("x", "123")).toMatchObject({ ok: false, error: { code: "invalid_name" } });
    expect(await createPcbCard("x", "123")).toMatchObject({ ok: false, error: { code: "pcb_create_failed" } });
  });

  it("maps safe duplicate-name and duplicate-serial conflicts", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "PCB14", message: "private" }, data: null })
      .mockResolvedValueOnce({ error: { code: "PRD06", message: "private" }, data: null });
    expect(await createPcbCard("Controller", "007")).toMatchObject({
      ok: false, error: { code: "duplicate_name" },
    });
    expect(await createPcbCard("Controller", "007")).toMatchObject({
      ok: false, error: { code: "duplicate_serial" },
    });
  });
});
