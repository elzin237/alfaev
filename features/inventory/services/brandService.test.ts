import { beforeEach, describe, expect, it, vi } from "vitest";

const brandServiceMocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: {
    from: brandServiceMocks.from,
    rpc: brandServiceMocks.rpc,
  },
}));

import {
  archiveBrand,
  createBrand,
  listBrands,
  updateBrand,
} from "./brandService";

beforeEach(() => {
  vi.resetAllMocks();
  brandServiceMocks.from.mockReturnValue({ select: brandServiceMocks.select });
});

describe("brandService", () => {
  it("maps Brand rows and orders active first, then alphabetically", async () => {
    brandServiceMocks.select.mockResolvedValue({
      data: [
        {
          id: "brand-3",
          name: "Zebra",
          is_active: false,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-03T00:00:00.000Z",
          archived_at: "2026-09-03T00:00:00.000Z",
        },
        {
          id: "brand-2",
          name: "Bosch",
          is_active: true,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-02T00:00:00.000Z",
          archived_at: null,
        },
        {
          id: "brand-1",
          name: "ABB",
          is_active: true,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
          archived_at: null,
        },
        {
          id: "brand-4",
          name: "Archived Alpha",
          is_active: false,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-04T00:00:00.000Z",
          archived_at: "2026-09-04T00:00:00.000Z",
        },
      ],
      error: null,
    });

    const result = await listBrands();

    expect(brandServiceMocks.from).toHaveBeenCalledWith("brands");
    expect(brandServiceMocks.select).toHaveBeenCalledWith(
      "id,name,is_active,created_at,updated_at,archived_at",
    );
    expect(result).toEqual({
      ok: true,
      value: [
        expect.objectContaining({ id: "brand-1", name: "ABB", isActive: true }),
        expect.objectContaining({ id: "brand-2", name: "Bosch", isActive: true }),
        expect.objectContaining({ id: "brand-4", name: "Archived Alpha", isActive: false }),
        expect.objectContaining({ id: "brand-3", name: "Zebra", isActive: false }),
      ],
    });
  });

  it("returns a safe list error for malformed or failed responses", async () => {
    brandServiceMocks.select.mockResolvedValue({
      data: null,
      error: { message: "raw database details" },
    });

    await expect(listBrands()).resolves.toEqual({
      ok: false,
      error: {
        code: "brand_list_failed",
        message: "The Brand list could not be loaded.",
      },
    });
  });

  it("calls the trusted create, update, and archive RPCs with normalized inputs", async () => {
    brandServiceMocks.rpc
      .mockResolvedValueOnce({ data: "brand-created", error: null })
      .mockResolvedValueOnce({ data: "brand-updated", error: null })
      .mockResolvedValueOnce({ data: "brand-archived", error: null });

    await expect(createBrand("  Bosch  ")).resolves.toEqual({
      ok: true,
      value: { brandId: "brand-created" },
    });
    await expect(updateBrand("brand-updated", "  ABB  ")).resolves.toEqual({
      ok: true,
      value: { brandId: "brand-updated" },
    });
    await expect(archiveBrand("brand-archived")).resolves.toEqual({
      ok: true,
      value: { brandId: "brand-archived" },
    });

    expect(brandServiceMocks.rpc).toHaveBeenNthCalledWith(1, "create_brand", {
      p_name: "Bosch",
    });
    expect(brandServiceMocks.rpc).toHaveBeenNthCalledWith(2, "update_brand", {
      p_brand_id: "brand-updated",
      p_name: "ABB",
    });
    expect(brandServiceMocks.rpc).toHaveBeenNthCalledWith(3, "archive_brand", {
      p_brand_id: "brand-archived",
    });
  });

  it("maps BRN02 without exposing backend details", async () => {
    brandServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "BRN02", message: "raw SQL details" },
    });

    await expect(createBrand("Bosch")).resolves.toEqual({
      ok: false,
      error: {
        code: "brand_duplicate",
        message: "A Brand with this name already exists.",
      },
    });
    await expect(updateBrand("brand-1", "Bosch")).resolves.toEqual({
      ok: false,
      error: {
        code: "brand_duplicate",
        message: "A Brand with this name already exists.",
      },
    });
  });
});
