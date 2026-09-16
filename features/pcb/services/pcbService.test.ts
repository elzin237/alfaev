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
      output_product_id: productId, serial_number: "0000001", current_stock: 0,
    }] });
    expect(await listPcbCards()).toEqual({ ok: true, value: [{
      id, name: "Controller", isActive: true, outputProductId: productId,
      serialNumber: "0000001", currentStock: 0,
    }] });
    expect(rpc).toHaveBeenCalledWith("list_pcb_cards");
  });

  it("fails safely on malformed or failed list data", async () => {
    rpc.mockResolvedValueOnce({ error: null, data: [{ current_stock: null }] })
      .mockResolvedValueOnce({ error: { message: "private" }, data: null });
    expect(await listPcbCards()).toMatchObject({ ok: false, error: { code: "pcb_list_failed" } });
    expect(await listPcbCards()).toMatchObject({ ok: false, error: { code: "pcb_list_failed" } });
  });

  it("creates with only name and validates the generated identity", async () => {
    rpc.mockResolvedValue({ error: null, data: [{ pcb_card_id: id, product_id: productId, serial_number: "0000001" }] });
    expect(await createPcbCard("Controller")).toEqual({ ok: true, value: {
      pcbCardId: id, productId, serialNumber: "0000001",
    } });
    expect(rpc).toHaveBeenCalledWith("create_pcb_card", { p_name: "Controller" });
  });

  it("maps authorization, invalid name and malformed results safely", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "42501", message: "private" }, data: null })
      .mockResolvedValueOnce({ error: { code: "22023", message: "private" }, data: null })
      .mockResolvedValueOnce({ error: null, data: [{ pcb_card_id: id, product_id: productId, serial_number: "bad" }] });
    expect(await createPcbCard("x")).toMatchObject({ ok: false, error: { code: "access_denied" } });
    expect(await createPcbCard("x")).toMatchObject({ ok: false, error: { code: "invalid_name" } });
    expect(await createPcbCard("x")).toMatchObject({ ok: false, error: { code: "pcb_create_failed" } });
  });
});
