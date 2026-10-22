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
  transferInventory,
} from "./inventoryBalanceService";

beforeEach(() => {
  vi.resetAllMocks();
  serviceMocks.from.mockReturnValue({ select: serviceMocks.select });
  serviceMocks.select.mockReturnValue({ eq: serviceMocks.eq });
  serviceMocks.eq.mockReturnValue({ maybeSingle: serviceMocks.maybeSingle });
});

describe("inventoryBalanceService", () => {
  const warehouseId = "10000000-0000-4000-8000-000000000001";
  it("reads and strictly maps one Product balance", async () => {
    serviceMocks.rpc.mockResolvedValue({
      data: [{
        product_id: "product-1",
        warehouse_id: warehouseId,
        quantity: "42",
        balance_updated_at: "2026-09-14T10:00:00.000Z",
      }],
      error: null,
    });

    await expect(getInventoryBalance("product-1")).resolves.toEqual({
      ok: true,
      value: {
        productId: "product-1",
        warehouseId,
        quantity: 42,
        updatedAt: "2026-09-14T10:00:00.000Z",
      },
    });
    expect(serviceMocks.rpc).toHaveBeenCalledWith(
      "get_inventory_product_by_warehouse",
      { p_product_id: "product-1", p_warehouse_id: warehouseId },
    );
  });

  it("distinguishes a missing balance from safe load failures", async () => {
    serviceMocks.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "raw database details" },
      })
      .mockResolvedValueOnce({
        data: [{
          product_id: "product-1",
          quantity: -1,
          warehouse_id: warehouseId,
          balance_updated_at: "invalid",
        }],
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

  it("calls only adjust_inventory_warehouse with normalized input and maps its result", async () => {
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
      productSupplierId: "relation-1",
    })).resolves.toEqual({
      ok: true,
      value: {
        movementId: "movement-1",
        quantityBefore: 10,
        quantityAfter: 15,
      },
    });
    expect(serviceMocks.rpc).toHaveBeenCalledWith("adjust_inventory_warehouse", {
      p_product_id: "product-1",
      p_warehouse_id: warehouseId,
      p_adjustment_type: "add",
      p_quantity: 5,
      p_reason: "Counted delivery",
      p_product_supplier_id: "relation-1",
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
    ["IVL03", "inventory_source_unavailable", "Select an active Supplier Catalog source for inbound stock."],
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

  it("transfers only through the trusted atomic warehouse RPC", async () => {
    const destinationWarehouseId = "10000000-0000-4000-8000-000000000002";
    serviceMocks.rpc.mockResolvedValue({
      data: [{
        transfer_id: "transfer-1",
        outbound_movement_id: "outbound-1",
        inbound_movement_id: "inbound-1",
        source_quantity_after: "7",
        destination_quantity_after: "3",
      }],
      error: null,
    });
    await expect(transferInventory("product-1", warehouseId, {
      destinationWarehouseId,
      quantity: 3,
      reason: "  Rebalance stock  ",
    })).resolves.toEqual({
      ok: true,
      value: {
        transferId: "transfer-1",
        sourceQuantityAfter: 7,
        destinationQuantityAfter: 3,
      },
    });
    expect(serviceMocks.rpc).toHaveBeenCalledWith(
      "transfer_inventory_between_warehouses",
      {
        p_product_id: "product-1",
        p_source_warehouse_id: warehouseId,
        p_destination_warehouse_id: destinationWarehouseId,
        p_quantity: 3,
        p_reason: "Rebalance stock",
      },
    );
  });
});
