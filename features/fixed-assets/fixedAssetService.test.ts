import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), order: vi.fn(), rpc: vi.fn() }));
vi.mock("../../lib/supabase/client", () => ({
  supabase: { from: () => ({ select: mocks.select }), rpc: mocks.rpc },
}));

import {
  archiveFixedAsset, createFixedAsset, listFixedAssets,
  normalizeFixedAssetQuantity, updateFixedAsset,
} from "./fixedAssetService";

const id = "00000000-0000-0000-0000-000000000001";
const row = {
  id, name: "Company lathe", category: "oprema", purchase_date: "2026-09-16",
  quantity: "9007199254740991", is_active: true,
  created_at: "2026-09-16T00:00:00Z", updated_at: "2026-09-16T00:00:00Z", archived_at: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.select.mockReturnValue({ order: () => ({ order: mocks.order }) });
  mocks.order.mockResolvedValue({ data: [row], error: null });
});

describe("Fixed Asset service", () => {
  it("validates safe whole-number quantity without rounding", () => {
    expect(normalizeFixedAssetQuantity(" 00042 ")).toBe("42");
    expect(normalizeFixedAssetQuantity("9007199254740991")).toBe("9007199254740991");
    for (const input of ["", "0", "-1", "1.2", "1e3", "9007199254740992", "abc"]) {
      expect(normalizeFixedAssetQuantity(input)).toBeNull();
    }
  });

  it("reads bigint through a text cast and maps approved fields", async () => {
    expect(await listFixedAssets()).toEqual({ ok: true, value: [{
      id, name: "Company lathe", category: "oprema", purchaseDate: "2026-09-16",
      quantity: Number.MAX_SAFE_INTEGER, isActive: true,
      createdAt: row.created_at, updatedAt: row.updated_at, archivedAt: null,
    }] });
    expect(mocks.select).toHaveBeenCalledWith(expect.stringContaining("quantity::text"));
  });

  it("fails safely on unsafe/malformed rows and provider errors", async () => {
    mocks.order.mockResolvedValueOnce({ data: [{ ...row, quantity: "9007199254740992" }], error: null });
    expect((await listFixedAssets()).ok).toBe(false);
    mocks.order.mockResolvedValueOnce({ data: [{ ...row, quantity: 5 }], error: null });
    expect((await listFixedAssets()).ok).toBe(false);
    mocks.order.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "SQL internals" } });
    expect(await listFixedAssets()).toEqual({ ok: false, error: "Unable to load Fixed Assets. Please try again." });
  });

  it("sends only trusted RPC inputs, with normalized name and quantity", async () => {
    mocks.rpc.mockResolvedValue({ data: id, error: null });
    const input = { name: "  Lathe  ", category: "alati" as const,
      purchaseDate: "2026-09-16", quantity: "00012" };
    await createFixedAsset(input);
    expect(mocks.rpc).toHaveBeenCalledWith("create_fixed_asset", {
      p_name: "Lathe", p_category: "alati", p_purchase_date: "2026-09-16", p_quantity: "12",
    });
    await updateFixedAsset(id, input);
    expect(mocks.rpc).toHaveBeenCalledWith("update_fixed_asset", {
      p_asset_id: id, p_name: "Lathe", p_category: "alati",
      p_purchase_date: "2026-09-16", p_quantity: "12",
    });
    await archiveFixedAsset(id);
    expect(mocks.rpc).toHaveBeenCalledWith("archive_fixed_asset", { p_asset_id: id });
  });

  it("maps domain errors safely without raw provider messages", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "raw auth" } })
      .mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "raw row" } })
      .mockResolvedValueOnce({ data: null, error: { code: "FAS01", message: "raw trigger" } })
      .mockResolvedValueOnce({ data: null, error: { code: "22023", message: "raw input" } });
    const input = { name: "Lathe", category: "oprema" as const,
      purchaseDate: "2026-09-16", quantity: "1" };
    expect(await createFixedAsset(input)).toEqual({ ok: false, error: "Access denied." });
    expect(await updateFixedAsset(id, input)).toEqual({ ok: false, error: "Fixed Asset not found." });
    expect(await archiveFixedAsset(id)).toEqual({ ok: false, error: "Archived Fixed Assets cannot be changed." });
    expect(await createFixedAsset(input)).toEqual({ ok: false, error: "Check the Fixed Asset fields and try again." });
  });
});
