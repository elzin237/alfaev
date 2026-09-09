import { beforeEach, describe, expect, it, vi } from "vitest";

const productServiceMocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: productServiceMocks.rpc },
}));

import { createProduct } from "./productService";

beforeEach(() => {
  vi.resetAllMocks();
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
});
