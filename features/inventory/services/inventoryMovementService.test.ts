import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: {
    rpc: serviceMocks.rpc,
    from: serviceMocks.from,
  },
}));

import { listInventoryMovements } from "./inventoryMovementService";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("inventoryMovementService", () => {
  const warehouseId = "10000000-0000-4000-8000-000000000001";
  it("reads only the trusted history RPC and strictly maps ledger rows in returned order", async () => {
    serviceMocks.rpc.mockResolvedValue({
      data: [
        {
          movement_id: "movement-new",
          warehouse_id: warehouseId,
          created_at: "2026-09-14T12:00:00.000Z",
          movement_type: "manual_remove",
          quantity_delta: "-3",
          quantity_before: "10",
          quantity_after: "7",
          reason: "Issued to workshop",
          source_type: "manual_adjustment",
          source_id: null,
          project_id: null,
          reversal_of_movement_id: null,
          actor_user_id: "profile-1",
          actor_full_name: "Alfa Admin",
        },
        {
          movement_id: "movement-old",
          warehouse_id: warehouseId,
          created_at: "2026-09-14T10:00:00.000Z",
          movement_type: "manual_add",
          quantity_delta: 10,
          quantity_before: 0,
          quantity_after: 10,
          reason: null,
          source_type: null,
          source_id: null,
          project_id: null,
          reversal_of_movement_id: null,
          actor_user_id: "profile-1",
          actor_full_name: "Alfa Admin",
        },
      ],
      error: null,
    });

    await expect(listInventoryMovements("product-1")).resolves.toEqual({
      ok: true,
      value: [
        {
          movementId: "movement-new",
          warehouseId,
          createdAt: "2026-09-14T12:00:00.000Z",
          movementType: "manual_remove",
          quantityDelta: -3,
          quantityBefore: 10,
          quantityAfter: 7,
          reason: "Issued to workshop",
          sourceType: "manual_adjustment",
          sourceId: null,
          projectId: null,
          reversalOfMovementId: null,
          actorUserId: "profile-1",
          actorFullName: "Alfa Admin",
        },
        {
          movementId: "movement-old",
          warehouseId,
          createdAt: "2026-09-14T10:00:00.000Z",
          movementType: "manual_add",
          quantityDelta: 10,
          quantityBefore: 0,
          quantityAfter: 10,
          reason: null,
          sourceType: null,
          sourceId: null,
          projectId: null,
          reversalOfMovementId: null,
          actorUserId: "profile-1",
          actorFullName: "Alfa Admin",
        },
      ],
    });
    expect(serviceMocks.rpc).toHaveBeenCalledWith(
      "get_inventory_movements_for_product_by_warehouse",
      { p_product_id: "product-1", p_warehouse_id: warehouseId },
    );
    expect(serviceMocks.from).not.toHaveBeenCalled();
  });

  it("fails safely for provider failures and malformed ledger arithmetic", async () => {
    serviceMocks.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "raw database details" },
      })
      .mockResolvedValueOnce({
        data: [{
          movement_id: "movement-1",
          warehouse_id: warehouseId,
          created_at: "2026-09-14T12:00:00.000Z",
          movement_type: "manual_add",
          quantity_delta: 5,
          quantity_before: 0,
          quantity_after: 4,
          reason: null,
          source_type: null,
          source_id: null,
          project_id: null,
          reversal_of_movement_id: null,
          actor_user_id: "profile-1",
          actor_full_name: "Alfa Admin",
        }],
        error: null,
      });

    const failed = await listInventoryMovements("product-1");
    const malformed = await listInventoryMovements("product-1");
    expect(failed).toEqual({
      ok: false,
      error: {
        code: "inventory_history_load_failed",
        message: "The Inventory history could not be loaded.",
      },
    });
    expect(malformed).toEqual(failed);
    expect(JSON.stringify(failed)).not.toContain("raw database details");
  });
});
