import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: {
    rpc: serviceMocks.rpc,
    from: serviceMocks.from,
  },
}));

import {
  adjustInventory,
  getInventoryBalance,
} from "./inventoryBalanceService";

beforeEach(() => {
  vi.resetAllMocks();
  serviceMocks.from.mockReturnValue({ select: serviceMocks.select });
  serviceMocks.select.mockReturnValue({ eq: serviceMocks.eq });
  serviceMocks.eq.mockReturnValue({ maybeSingle: serviceMocks.maybeSingle });
});

describe("inventoryBalanceService", () => {
  it("reads and strictly maps one Product balance", async () => {
    serviceMocks.maybeSingle.mockResolvedValue({
      data: {
        product_id: "product-1",
        quantity: "42",
        updated_at: "2026-09-14T10:00:00.000Z",
      },
      error: null,
    });

    await expect(getInventoryBalance("product-1")).resolves.toEqual({
      ok: true,
      value: {
        productId: "product-1",
        quantity: 42,
        updatedAt: "2026-09-14T10:00:00.000Z",
      },
    });
    expect(serviceMocks.from).toHaveBeenCalledWith("inventory_balances");
    expect(serviceMocks.select).toHaveBeenCalledWith(
      "product_id,quantity,updated_at",
    );
    expect(serviceMocks.eq).toHaveBeenCalledWith("product_id", "product-1");
    expect(serviceMocks.maybeSingle).toHaveBeenCalledOnce();
  });

  it("distinguishes a missing balance from safe load failures", async () => {
    serviceMocks.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "raw database details" },
      })
      .mockResolvedValueOnce({
        data: {
          product_id: "product-1",
          quantity: -1,
          updated_at: "invalid",
        },
        error: null,
      });

    await expect(getInventoryBalance("missing")).resolves.toEqual({
      ok: false,
      error: {
        code: "inventory_balance_not_found",
        message: "The Inventory balance could not be found.",
      },
    });
    const failed = await getInventoryBalance("product-1");
    const malformed = await getInventoryBalance("product-1");
    expect(failed).toEqual({
      ok: false,
      error: {
        code: "inventory_balance_load_failed",
        message: "The Inventory balance could not be loaded.",
      },
    });
    expect(malformed).toEqual(failed);
    expect(JSON.stringify(failed)).not.toContain("raw database details");
  });

  it("calls only manual_adjust_inventory with normalized input and maps its result", async () => {
    serviceMocks.rpc.mockResolvedValue({
      data: [{
        movement_id: "movement-1",
        quantity_before: "10",
        quantity_after: 15,
      }],
      error: null,
    });

    await expect(adjustInventory("product-1", {
      adjustmentType: "add",
      quantity: 5,
      reason: "  Counted delivery  ",
    })).resolves.toEqual({
      ok: true,
      value: {
        movementId: "movement-1",
        quantityBefore: 10,
        quantityAfter: 15,
      },
    });
    expect(serviceMocks.rpc).toHaveBeenCalledWith("manual_adjust_inventory", {
      p_product_id: "product-1",
      p_adjustment_type: "add",
      p_quantity: 5,
      p_reason: "Counted delivery",
    });
    expect(serviceMocks.from).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", "access_denied", "Only an Admin can adjust Inventory."],
    ["MIA01", "adjustment_invalid", "Enter a valid Inventory adjustment."],
    ["22023", "adjustment_invalid", "Enter a valid Inventory adjustment."],
    ["MIA02", "adjustment_no_op", "The correction target must differ from the current quantity."],
    ["IVB01", "balance_unavailable", "The Inventory balance is unavailable."],
    ["IVB02", "insufficient_stock", "The requested removal exceeds the available stock."],
    ["P0002", "product_unavailable", "This Product is unavailable for Inventory adjustment."],
    ["PRD01", "product_unavailable", "This Product is unavailable for Inventory adjustment."],
    ["unexpected", "inventory_adjustment_failed", "The Inventory adjustment could not be completed. Please try again."],
  ] as const)("maps %s to a safe adjustment error", async (
    providerCode,
    code,
    message,
  ) => {
    serviceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: providerCode, message: "raw provider details" },
    });

    const result = await adjustInventory("product-1", {
      adjustmentType: "remove",
      quantity: 2,
      reason: "Reason",
    });
    expect(result).toEqual({ ok: false, error: { code, message } });
    expect(JSON.stringify(result)).not.toContain("raw provider details");
  });

  it("fails safely for malformed adjustment results", async () => {
    serviceMocks.rpc.mockResolvedValue({
      data: [{ movement_id: "movement-1", quantity_before: 1 }],
      error: null,
    });

    await expect(adjustInventory("product-1", {
      adjustmentType: "correction",
      quantity: 0,
      reason: "Counted",
    })).resolves.toEqual({
      ok: false,
      error: {
        code: "inventory_adjustment_failed",
        message: "The Inventory adjustment could not be completed. Please try again.",
      },
    });
  });
});
