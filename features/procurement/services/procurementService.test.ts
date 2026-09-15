import { beforeEach, describe, expect, it, vi } from "vitest";

const procurementServiceMocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: procurementServiceMocks.rpc },
}));

import {
  createProcurementRequestForProduct,
  getProcurementSidebarBadgeCount,
  listActiveProcurementSupplierChoices,
  listProcurementSupplierOptions,
  searchProcurementProductChoices,
  searchProcurementRequests,
} from "./procurementService";

const requestRow = {
  request_id: "00000000-0000-4000-8000-000000000001",
  product_id: "00000000-0000-4000-8000-000000000002",
  product_serial_number: "0000123",
  requested_name: "Request-time Product Name",
  supplier_id: "00000000-0000-4000-8000-000000000003",
  supplier_name: "Historical Supplier",
  requested_quantity: "10",
  delivered_quantity: "4",
  status: "partly_delivered",
  created_at: "2026-09-15T09:00:00.000Z",
  created_by_user_id: "00000000-0000-4000-8000-000000000004",
  created_by_full_name: "Procurement Worker",
};

beforeEach(() => vi.resetAllMocks());

describe("procurementService", () => {
  it("calls the trusted list RPC with normalized filters and maps a derived Remaining value", async () => {
    procurementServiceMocks.rpc.mockResolvedValue({
      data: [requestRow],
      error: null,
    });

    await expect(searchProcurementRequests({
      search: "  00001  ",
      status: "partly_delivered",
      supplierId: requestRow.supplier_id,
    })).resolves.toEqual({
      ok: true,
      value: [{
        requestId: requestRow.request_id,
        productId: requestRow.product_id,
        productSerialNumber: "0000123",
        requestedName: "Request-time Product Name",
        supplierId: requestRow.supplier_id,
        supplierName: "Historical Supplier",
        requestedQuantity: 10,
        deliveredQuantity: 4,
        remainingQuantity: 6,
        status: "partly_delivered",
        createdAt: "2026-09-15T09:00:00.000Z",
        createdByUserId: requestRow.created_by_user_id,
        createdByFullName: "Procurement Worker",
      }],
    });
    expect(procurementServiceMocks.rpc).toHaveBeenCalledWith(
      "search_procurement_requests",
      {
        p_search: "00001",
        p_status: "partly_delivered",
        p_supplier_id: requestRow.supplier_id,
      },
    );
  });

  it("preserves an unlinked request and sends blank search as NULL", async () => {
    procurementServiceMocks.rpc.mockResolvedValue({
      data: [{
        ...requestRow,
        product_id: null,
        product_serial_number: null,
        delivered_quantity: 0,
        status: "active",
      }],
      error: null,
    });

    const result = await searchProcurementRequests({
      search: "   ",
      status: null,
      supplierId: null,
    });

    expect(result.ok && result.value[0]).toMatchObject({
      productId: null,
      productSerialNumber: null,
      remainingQuantity: 10,
    });
    expect(procurementServiceMocks.rpc).toHaveBeenCalledWith(
      "search_procurement_requests",
      { p_search: null, p_status: null, p_supplier_id: null },
    );
  });

  it("fails safely for malformed quantities, identifiers, and provider errors", async () => {
    procurementServiceMocks.rpc
      .mockResolvedValueOnce({
        data: [{ ...requestRow, delivered_quantity: 11 }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ ...requestRow, supplier_id: "invalid" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "raw database details" },
      });

    const invalidQuantity = await searchProcurementRequests({
      search: "",
      status: null,
      supplierId: null,
    });
    const invalidId = await searchProcurementRequests({
      search: "",
      status: null,
      supplierId: null,
    });
    const providerFailure = await searchProcurementRequests({
      search: "",
      status: null,
      supplierId: null,
    });

    for (const result of [invalidQuantity, invalidId, providerFailure]) {
      expect(result).toEqual({
        ok: false,
        error: {
          code: "procurement_list_failed",
          message: "The Procurement request list could not be loaded.",
        },
      });
      expect(JSON.stringify(result)).not.toContain("raw database details");
    }
  });

  it("uses the narrow Supplier-options RPC and maps only ID and Name", async () => {
    procurementServiceMocks.rpc.mockResolvedValue({
      data: [{
        supplier_id: requestRow.supplier_id,
        supplier_name: "Historical Supplier",
      }],
      error: null,
    });

    await expect(listProcurementSupplierOptions()).resolves.toEqual({
      ok: true,
      value: [{
        supplierId: requestRow.supplier_id,
        supplierName: "Historical Supplier",
      }],
    });
    expect(procurementServiceMocks.rpc).toHaveBeenCalledWith(
      "list_procurement_supplier_options",
    );
  });

  it("strictly accepts a non-negative safe row count from the badge RPC", async () => {
    procurementServiceMocks.rpc
      .mockResolvedValueOnce({ data: 5, error: null })
      .mockResolvedValueOnce({ data: "0", error: null })
      .mockResolvedValueOnce({ data: -1, error: null });

    await expect(getProcurementSidebarBadgeCount()).resolves.toEqual({
      ok: true,
      value: 5,
    });
    await expect(getProcurementSidebarBadgeCount()).resolves.toEqual({
      ok: true,
      value: 0,
    });
    await expect(getProcurementSidebarBadgeCount()).resolves.toEqual({
      ok: false,
      error: {
        code: "procurement_badge_failed",
        message: "The Procurement count could not be loaded.",
      },
    });
  });

  it("uses narrow trusted Product and active Supplier choice RPCs", async () => {
    procurementServiceMocks.rpc
      .mockResolvedValueOnce({
        data: [{
          product_id: requestRow.product_id,
          serial_number: requestRow.product_serial_number,
          name: "Server Product Name",
        }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{
          supplier_id: requestRow.supplier_id,
          supplier_name: "Active Supplier",
        }],
        error: null,
      });

    await expect(searchProcurementProductChoices("  00001  ")).resolves.toEqual({
      ok: true,
      value: [{
        productId: requestRow.product_id,
        serialNumber: requestRow.product_serial_number,
        name: "Server Product Name",
      }],
    });
    await expect(listActiveProcurementSupplierChoices()).resolves.toEqual({
      ok: true,
      value: [{
        supplierId: requestRow.supplier_id,
        supplierName: "Active Supplier",
      }],
    });
    expect(procurementServiceMocks.rpc).toHaveBeenNthCalledWith(
      1,
      "search_procurement_product_choices",
      { p_search: "00001" },
    );
    expect(procurementServiceMocks.rpc).toHaveBeenNthCalledWith(
      2,
      "list_active_procurement_supplier_choices",
    );
  });

  it("creates through only the trusted existing-Product RPC without snapshot or lifecycle inputs", async () => {
    procurementServiceMocks.rpc.mockResolvedValue({
      data: requestRow.request_id,
      error: null,
    });

    await expect(createProcurementRequestForProduct({
      productId: requestRow.product_id,
      supplierId: requestRow.supplier_id,
      requestedQuantity: 12,
    })).resolves.toEqual({
      ok: true,
      value: { requestId: requestRow.request_id },
    });
    const payload = procurementServiceMocks.rpc.mock.calls[0]?.[1];
    expect(procurementServiceMocks.rpc).toHaveBeenCalledWith(
      "create_procurement_request_for_product",
      {
        p_product_id: requestRow.product_id,
        p_supplier_id: requestRow.supplier_id,
        p_requested_quantity: 12,
      },
    );
    expect(payload).not.toHaveProperty("requested_name");
    expect(payload).not.toHaveProperty("serial_number");
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("delivered_quantity");
    expect(payload).not.toHaveProperty("actor_user_id");
  });

  it.each([
    ["42501", "access_denied", "You do not have permission to create Procurement requests."],
    ["PRQ03", "product_unavailable", "The selected Product is unavailable. Choose an active Product."],
    ["PRQ04", "supplier_unavailable", "The selected Supplier is unavailable. Choose an active Supplier."],
    ["22023", "invalid_request", "Enter a valid Product, Supplier, and positive whole-number quantity."],
    ["unexpected", "procurement_creation_failed", "The Procurement request could not be created. Please try again."],
  ] as const)("maps %s to a safe creation error", async (providerCode, code, message) => {
    procurementServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: providerCode, message: "raw provider details" },
    });

    const result = await createProcurementRequestForProduct({
      productId: requestRow.product_id,
      supplierId: requestRow.supplier_id,
      requestedQuantity: 1,
    });

    expect(result).toEqual({ ok: false, error: { code, message } });
    expect(JSON.stringify(result)).not.toContain("raw provider details");
  });
});
