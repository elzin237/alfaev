import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));

import { listInventorySourceChoices, listInventorySourceLots } from "./inventorySourceService";

beforeEach(() => vi.resetAllMocks());

describe("inventorySourceService", () => {
  it("maps exact ProductSupplier choices without broad Supplier fields", async () => {
    mocks.rpc.mockResolvedValue({ data: [{
      product_supplier_id: "10000000-0000-4000-8000-000000000001",
      supplier_id: "20000000-0000-4000-8000-000000000001",
      supplier_name: "IBP",
      catalog_number: "CAT-100",
      description: "Control relay",
    }], error: null });
    await expect(listInventorySourceChoices("product-1")).resolves.toEqual({ ok: true, value: [{
      productSupplierId: "10000000-0000-4000-8000-000000000001",
      supplierName: "IBP",
      catalogNumber: "CAT-100",
      description: "Control relay",
    }] });
  });

  it("preserves exact bigint lots and truthful legacy/internal labels", async () => {
    mocks.rpc.mockResolvedValue({ data: [
      {
        source_lot_id: "30000000-0000-4000-8000-000000000001", source_kind: "supplier",
        received_at: "2026-10-13T08:00:00.123456+00:00",
        supplier_name: "IBP", catalog_number: "CAT-100", description: null,
        received_quantity: "9223372036854775807", remaining_quantity: "9",
        added_by_full_name: "Ada Lovelace",
      },
      {
        source_lot_id: "30000000-0000-4000-8000-000000000002", source_kind: "legacy_unknown",
        received_at: "2026-10-13T09:00:00+00:00",
        supplier_name: "Legacy / Unknown", catalog_number: null, description: null,
        received_quantity: "2", remaining_quantity: "2", added_by_full_name: null,
      },
    ], error: null });
    const result = await listInventorySourceLots("product-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.receivedQuantity).toBe(9_223_372_036_854_775_807n);
      expect(result.value[1]).toMatchObject({ supplierName: "Legacy / Unknown", catalogNumber: null });
    }
  });

  it("fails malformed or overflow rows safely", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ source_lot_id: "lot", received_quantity: "9223372036854775808" }], error: null });
    await expect(listInventorySourceLots("product-1")).resolves.toEqual({
      ok: false,
      error: { message: "Supplier Stock History could not be loaded." },
    });
  });
});
