import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: {
    rpc: serviceMocks.rpc,
  },
}));

import {
  archiveProductSupplier,
  createProductSupplier,
  listActiveSupplierChoices,
  listProductSuppliers,
  updateProductSupplier,
} from "./productSupplierService";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("productSupplierService", () => {
  it("reads, strictly maps, and deterministically orders current and historical Supplier links", async () => {
    serviceMocks.rpc.mockResolvedValue({
      data: [
        {
          relationship_id: "relation-3",
          supplier_id: "supplier-3",
          supplier_name: "Legacy Supplier",
          supplier_is_active: false,
          catalog_number: null,
          relationship_is_active: false,
        },
        {
          relationship_id: "relation-2",
          supplier_id: "supplier-2",
          supplier_name: "Beta",
          supplier_is_active: true,
          catalog_number: "Z-20",
          relationship_is_active: true,
        },
        {
          relationship_id: "relation-1",
          supplier_id: "supplier-1",
          supplier_name: "Alpha",
          supplier_is_active: false,
          catalog_number: null,
          relationship_is_active: true,
        },
      ],
      error: null,
    });

    await expect(listProductSuppliers("product-1")).resolves.toEqual({
      ok: true,
      value: [
        {
          relationId: "relation-1",
          supplierId: "supplier-1",
          supplierName: "Alpha",
          catalogNumber: null,
          isActive: true,
          supplierIsActive: false,
        },
        {
          relationId: "relation-2",
          supplierId: "supplier-2",
          supplierName: "Beta",
          catalogNumber: "Z-20",
          isActive: true,
          supplierIsActive: true,
        },
        {
          relationId: "relation-3",
          supplierId: "supplier-3",
          supplierName: "Legacy Supplier",
          catalogNumber: null,
          isActive: false,
          supplierIsActive: false,
        },
      ],
    });
    expect(serviceMocks.rpc).toHaveBeenCalledWith(
      "get_product_suppliers_for_product",
      { p_product_id: "product-1" },
    );
  });

  it("fails reads safely when relationship data is malformed or the provider fails", async () => {
    serviceMocks.rpc
      .mockResolvedValueOnce({
        data: [{ relationship_id: "relation-1", supplier_name: null }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "raw database details" },
      });

    const malformed = await listProductSuppliers("product-1");
    const failed = await listProductSuppliers("product-1");

    expect(malformed).toEqual({
      ok: false,
      error: {
        code: "relationship_list_failed",
        message: "The Supplier links could not be loaded.",
      },
    });
    expect(failed).toEqual(malformed);
    expect(JSON.stringify(failed)).not.toContain("raw database details");
  });

  it("loads only minimal active Supplier choices through the trusted lookup RPC", async () => {
    serviceMocks.rpc.mockResolvedValue({
      data: [
        { supplier_id: "supplier-1", supplier_name: "ABB" },
        { supplier_id: "supplier-2", supplier_name: "Bosch" },
      ],
      error: null,
    });

    await expect(listActiveSupplierChoices()).resolves.toEqual({
      ok: true,
      value: [
        { supplierId: "supplier-1", supplierName: "ABB" },
        { supplierId: "supplier-2", supplierName: "Bosch" },
      ],
    });
    expect(serviceMocks.rpc).toHaveBeenCalledWith(
      "list_active_supplier_choices_for_product_supplier",
    );
    expect(JSON.stringify(serviceMocks.rpc.mock.calls[0])).not.toMatch(
      /country|contact|phone|email/i,
    );
  });

  it("fails malformed Supplier-choice responses safely", async () => {
    serviceMocks.rpc.mockResolvedValue({
      data: [{ supplier_id: "supplier-1", supplier_name: null }],
      error: null,
    });

    await expect(listActiveSupplierChoices()).resolves.toEqual({
      ok: false,
      error: {
        code: "supplier_choice_list_failed",
        message: "The active Supplier choices could not be loaded.",
      },
    });
  });

  it("creates through the trusted RPC with normalized Catalog Number only", async () => {
    serviceMocks.rpc.mockResolvedValue({ data: "relation-1", error: null });

    await expect(createProductSupplier({
      productId: "product-1",
      supplierId: "supplier-1",
      catalogNumber: "  AbC-42  ",
    })).resolves.toEqual({
      ok: true,
      value: { relationId: "relation-1" },
    });
    expect(serviceMocks.rpc).toHaveBeenCalledWith("create_product_supplier", {
      p_product_id: "product-1",
      p_supplier_id: "supplier-1",
      p_catalog_number: "AbC-42",
    });
  });

  it("stores blank Catalog Number as null and edit changes only that field", async () => {
    serviceMocks.rpc.mockResolvedValue({ data: "relation-1", error: null });

    await updateProductSupplier("relation-1", { catalogNumber: "   " });

    expect(serviceMocks.rpc).toHaveBeenCalledWith("update_product_supplier", {
      p_product_supplier_id: "relation-1",
      p_catalog_number: null,
    });
    expect(serviceMocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_product_id");
    expect(serviceMocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_supplier_id");
  });

  it.each([
    ["42501", "access_denied"],
    ["PSR02", "product_unavailable"],
    ["PSR03", "supplier_unavailable"],
    ["PSR04", "relationship_duplicate"],
    ["unexpected", "relationship_create_failed"],
  ] as const)("maps create error %s safely", async (providerCode, expectedCode) => {
    serviceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: providerCode, message: "raw provider details" },
    });

    const result = await createProductSupplier({
      productId: "product-1",
      supplierId: "supplier-1",
      catalogNumber: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(expectedCode);
    expect(JSON.stringify(result)).not.toContain("raw provider details");
  });

  it.each([
    ["PSR01", "relationship_archived"],
    ["PSR04", "relationship_duplicate"],
    ["P0002", "relationship_not_found"],
    ["unexpected", "relationship_update_failed"],
  ] as const)("maps update error %s safely", async (providerCode, expectedCode) => {
    serviceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: providerCode, message: "raw provider details" },
    });

    const result = await updateProductSupplier("relation-1", {
      catalogNumber: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(expectedCode);
  });

  it("archives only through the trusted archive RPC and maps known failures", async () => {
    serviceMocks.rpc
      .mockResolvedValueOnce({ data: "relation-1", error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PSR01", message: "raw provider details" },
      });

    await expect(archiveProductSupplier("relation-1")).resolves.toEqual({
      ok: true,
      value: { relationId: "relation-1" },
    });
    expect(serviceMocks.rpc).toHaveBeenCalledWith("archive_product_supplier", {
      p_product_supplier_id: "relation-1",
    });

    const failed = await archiveProductSupplier("relation-1");
    expect(failed).toEqual({
      ok: false,
      error: {
        code: "relationship_archived",
        message: "Archived Supplier links cannot be changed.",
      },
    });
  });
});
