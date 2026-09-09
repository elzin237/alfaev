import { beforeEach, describe, expect, it, vi } from "vitest";

const productServiceMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  order: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: {
    rpc: productServiceMocks.rpc,
    from: productServiceMocks.from,
  },
}));

import {
  archiveProduct,
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
} from "./productService";

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

  it("reads and strictly maps one Product detail with lifecycle dates and Brand state", async () => {
    productServiceMocks.select.mockReturnValue({ eq: productServiceMocks.eq });
    productServiceMocks.eq.mockReturnValue({
      maybeSingle: productServiceMocks.maybeSingle,
    });
    productServiceMocks.maybeSingle.mockResolvedValue({
      data: {
        id: "product-1",
        serial_number: "0000001",
        name: "Controller",
        category: "Control",
        brand_id: "brand-1",
        brand: { name: "Legacy Brand", is_active: false },
        product_kind: "component",
        is_active: true,
        created_at: "2026-09-01T10:00:00.000Z",
        updated_at: "2026-09-02T11:00:00.000Z",
        archived_at: null,
      },
      error: null,
    });

    await expect(getProduct("product-1")).resolves.toEqual({
      ok: true,
      value: {
        id: "product-1",
        serialNumber: "0000001",
        name: "Controller",
        category: "Control",
        brandId: "brand-1",
        brandName: "Legacy Brand",
        brandIsActive: false,
        productKind: "component",
        isActive: true,
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-02T11:00:00.000Z",
        archivedAt: null,
      },
    });
    expect(productServiceMocks.select).toHaveBeenCalledWith(
      "id,serial_number,name,category,brand_id,product_kind,is_active,created_at,updated_at,archived_at,brand:brands(name,is_active)",
    );
    expect(productServiceMocks.eq).toHaveBeenCalledWith("id", "product-1");
    expect(productServiceMocks.maybeSingle).toHaveBeenCalledOnce();
  });

  it("distinguishes missing Product details from safe read failures", async () => {
    productServiceMocks.select.mockReturnValue({ eq: productServiceMocks.eq });
    productServiceMocks.eq.mockReturnValue({
      maybeSingle: productServiceMocks.maybeSingle,
    });
    productServiceMocks.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "raw provider details" },
      })
      .mockResolvedValueOnce({
        data: { id: "product-1", name: "Malformed" },
        error: null,
      });

    await expect(getProduct("missing")).resolves.toEqual({
      ok: false,
      error: {
        code: "product_not_found",
        message: "The Product could not be found.",
      },
    });
    await expect(getProduct("product-1")).resolves.toEqual({
      ok: false,
      error: {
        code: "product_detail_failed",
        message: "The Product details could not be loaded.",
      },
    });
    await expect(getProduct("product-1")).resolves.toEqual({
      ok: false,
      error: {
        code: "product_detail_failed",
        message: "The Product details could not be loaded.",
      },
    });
  });

  it("updates only through the trusted RPC with normalized master data", async () => {
    productServiceMocks.rpc.mockResolvedValue({ data: "product-1", error: null });

    await expect(updateProduct("product-1", {
      name: "  Controller  ",
      category: "  Control  ",
      brandId: " brand-1 ",
    })).resolves.toEqual({
      ok: true,
      value: { productId: "product-1" },
    });

    expect(productServiceMocks.rpc).toHaveBeenCalledWith("update_product", {
      p_product_id: "product-1",
      p_name: "Controller",
      p_category: "Control",
      p_brand_id: "brand-1",
    });
    expect(productServiceMocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty(
      "serial_number",
    );
    expect(productServiceMocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty(
      "product_kind",
    );
  });

  it.each([
    ["42501", "access_denied", "You do not have permission to edit Products."],
    ["PRD01", "product_archived", "Archived Products cannot be edited."],
    ["PRD04", "brand_unavailable", "The selected Brand is unavailable. Choose an active Brand or no Brand."],
    ["22023", "product_invalid", "Enter valid Product information."],
    ["P0002", "product_not_found", "The Product could not be found."],
    ["XX000", "product_update_failed", "The Product could not be updated. Please try again."],
  ] as const)("maps %s update failures without raw details", async (
    backendCode,
    code,
    message,
  ) => {
    productServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: backendCode, message: "raw SQL details" },
    });

    await expect(updateProduct("product-1", {
      name: "Controller",
      category: "Control",
      brandId: null,
    })).resolves.toEqual({ ok: false, error: { code, message } });
  });

  it("archives only through the trusted archive_product RPC", async () => {
    productServiceMocks.rpc.mockResolvedValue({ data: "product-1", error: null });

    await expect(archiveProduct("product-1")).resolves.toEqual({
      ok: true,
      value: { productId: "product-1" },
    });
    expect(productServiceMocks.rpc).toHaveBeenCalledWith("archive_product", {
      p_product_id: "product-1",
    });
    expect(productServiceMocks.from).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", "access_denied", "You do not have permission to archive Products."],
    ["PRD01", "product_archived", "This Product is already archived and cannot be archived again."],
    ["P0002", "product_not_found", "The Product could not be found."],
    ["XX000", "product_archive_failed", "The Product could not be archived. Please try again."],
  ] as const)("maps %s archive failures without raw details", async (
    backendCode,
    code,
    message,
  ) => {
    productServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: backendCode, message: "raw SQL details" },
    });

    await expect(archiveProduct("product-1")).resolves.toEqual({
      ok: false,
      error: { code, message },
    });
  });
});
