import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: serviceMocks.rpc },
}));

import { importComponents } from "./componentImportService";

const rows = [
  { name: "Resistor", category: "Passive", brand: null },
  { name: "Relay", category: "Control", brand: "Omron" },
];
const response = [
  { input_index: 1, product_id: "product-1", serial_number: "0000001" },
  { input_index: 2, product_id: "product-2", serial_number: "0000002" },
];

beforeEach(() => {
  vi.resetAllMocks();
  serviceMocks.rpc.mockResolvedValue({ data: response, error: null });
});

describe("componentImportService", () => {
  it("calls the trusted bulk RPC exactly once with the exact complete row payload", async () => {
    await expect(importComponents(rows)).resolves.toEqual({
      ok: true,
      value: {
        createdCount: 2,
        products: [
          { inputIndex: 1, productId: "product-1", serialNumber: "0000001" },
          { inputIndex: 2, productId: "product-2", serialNumber: "0000002" },
        ],
      },
    });
    expect(serviceMocks.rpc).toHaveBeenCalledOnce();
    expect(serviceMocks.rpc).toHaveBeenCalledWith("bulk_import_components", {
      p_rows: rows,
    });
    expect(serviceMocks.rpc).not.toHaveBeenCalledWith("create_product", expect.anything());
  });

  it.each<readonly [unknown, string]>([
    [null, "non-array"],
    [{}, "wrong response type"],
    [[response[0]], "wrong length"],
    [[{ product_id: "product-1", serial_number: "0000001" }, response[1]], "missing index"],
    [[{ ...response[0], input_index: 0 }, response[1]], "invalid index"],
    [[response[1], response[0]], "out-of-order index"],
    [[{ ...response[0], serial_number: "123" }, response[1]], "invalid serial"],
    [[{ ...response[0], product_id: " " }, response[1]], "blank Product ID"],
    [[response[0], { ...response[1], product_id: "product-1" }], "duplicate Product IDs"],
    [[response[0], { ...response[1], serial_number: "0000001" }], "duplicate Serials"],
  ])("fails safely for malformed authoritative response: %s", async (data, _description) => {
    serviceMocks.rpc.mockResolvedValue({ data, error: null });
    await expect(importComponents(rows)).resolves.toEqual({
      ok: false,
      error: {
        code: "import_failed",
        message: "The Components could not be imported. Please try again.",
      },
    });
  });

  it.each([
    ["42501", "access_denied", "You do not have permission to import Components."],
    ["PRD04", "brand_unavailable", "A Brand in this workbook is no longer available. Refresh Brands and upload the workbook again."],
    ["22023", "import_invalid", "The Component import is no longer valid. Check the workbook and try again."],
    ["XX000", "import_failed", "The Components could not be imported. Please try again."],
  ] as const)("maps %s without exposing raw provider errors", async (providerCode, code, message) => {
    serviceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: providerCode, message: "raw database details" },
    });
    await expect(importComponents(rows)).resolves.toEqual({
      ok: false,
      error: { code, message },
    });
  });

  it("maps thrown network failures safely and never retries", async () => {
    serviceMocks.rpc.mockRejectedValue(new Error("network details"));
    await expect(importComponents(rows)).resolves.toMatchObject({
      ok: false,
      error: { code: "import_failed" },
    });
    expect(serviceMocks.rpc).toHaveBeenCalledOnce();
  });
});
