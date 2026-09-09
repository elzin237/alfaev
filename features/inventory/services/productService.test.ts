import { beforeEach, describe, expect, it, vi } from "vitest";

const productServiceMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  order: vi.fn(),
}));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: {
    rpc: productServiceMocks.rpc,
    from: productServiceMocks.from,
  },
}));

import { createProduct, listProducts } from "./productService";

beforeEach(() => {
  vi.resetAllMocks();
  productServiceMocks.from.mockReturnValue({
    select: productServiceMocks.select,
  });
  productServiceMocks.select.mockReturnValue({
    order: productServiceMocks.order,
  });
});

describe("productService", () => {
  it("calls only the trusted create_product RPC with normalized allowed inputs", async () => {
    productServiceMocks.rpc.mockResolvedValue({
      data: [{ product_id: "product-1", serial_number: "0000123" }],
      error: null,
    });

    await expect(createProduct({
      name: "  Resistor  ",
      category: "  Passive Components  ",
      brandId: " brand-1 ",
    })).resolves.toEqual({
      ok: true,
      value: { productId: "product-1", serialNumber: "0000123" },
    });

    expect(productServiceMocks.rpc).toHaveBeenCalledWith("create_product", {
      p_name: "Resistor",
      p_category: "Passive Components",
      p_brand_id: "brand-1",
    });
    expect(productServiceMocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty(
      "serial_number",
    );
    expect(productServiceMocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty(
      "product_kind",
    );
  });

  it("sends an optional Brand as null and rejects malformed success data", async () => {
    productServiceMocks.rpc
      .mockResolvedValueOnce({
        data: [{ product_id: "product-1", serial_number: "invalid" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ product_id: "product-2", serial_number: "0000124" }],
        error: null,
      });

    await expect(createProduct({
      name: "Resistor",
      category: "Passive",
      brandId: null,
    })).resolves.toEqual({
      ok: false,
      error: {
        code: "product_creation_failed",
        message: "The Component could not be created. Please try again.",
      },
    });
    await createProduct({ name: "Capacitor", category: "Passive", brandId: "" });

    expect(productServiceMocks.rpc).toHaveBeenLastCalledWith("create_product", {
      p_name: "Capacitor",
      p_category: "Passive",
      p_brand_id: null,
    });
  });

  it.each([
    ["42501", "access_denied", "You do not have permission to add Components."],
    ["PRD04", "brand_unavailable", "The selected Brand is unavailable. Choose an active Brand or no Brand."],
    ["22023", "product_invalid", "Enter valid Component information."],
    ["unexpected", "product_creation_failed", "The Component could not be created. Please try again."],
  ] as const)("maps %s to a safe Product error", async (providerCode, code, message) => {
    productServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: providerCode, message: "raw provider details" },
    });

    await expect(createProduct({
      name: "Resistor",
      category: "Passive",
      brandId: null,
    })).resolves.toEqual({
      ok: false,
      error: { code, message },
    });
  });

  it("reads, validates, maps, and deterministically orders Products with Brand history", async () => {
    productServiceMocks.order.mockResolvedValue({
      data: [
        {
          id: "product-2",
          serial_number: "0000010",
          name: "Controller",
          category: "Control",
          brand_id: "brand-archived",
          brand: { name: "Legacy Brand" },
          product_kind: "pcb_finished_good",
          is_active: false,
        },
        {
          id: "product-1",
          serial_number: "0000002",
          name: "Resistor",
          category: "Passive",
          brand_id: null,
          brand: null,
          product_kind: "component",
          is_active: true,
        },
      ],
      error: null,
    });

    await expect(listProducts()).resolves.toEqual({
      ok: true,
      value: [
        {
          id: "product-1",
          serialNumber: "0000002",
          name: "Resistor",
          category: "Passive",
          brandId: null,
          brandName: null,
          productKind: "component",
          isActive: true,
        },
        {
          id: "product-2",
          serialNumber: "0000010",
          name: "Controller",
          category: "Control",
          brandId: "brand-archived",
          brandName: "Legacy Brand",
          productKind: "pcb_finished_good",
          isActive: false,
        },
      ],
    });
    expect(productServiceMocks.from).toHaveBeenCalledWith("products");
    expect(productServiceMocks.select).toHaveBeenCalledWith(
      "id,serial_number,name,category,brand_id,product_kind,is_active,brand:brands(name)",
    );
    expect(productServiceMocks.order).toHaveBeenCalledWith("serial_number", {
      ascending: true,
    });
  });

  it("fails safely when the Product response is malformed or the read fails", async () => {
    productServiceMocks.order
      .mockResolvedValueOnce({
        data: [{ id: "product-1", serial_number: "invalid" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "raw database details" },
      });

    const malformed = await listProducts();
    const failed = await listProducts();

    expect(malformed).toEqual({
      ok: false,
      error: {
        code: "product_list_failed",
        message: "The Product list could not be loaded.",
      },
    });
    expect(failed).toEqual(malformed);
    expect(JSON.stringify(failed)).not.toContain("raw database details");
  });
});
