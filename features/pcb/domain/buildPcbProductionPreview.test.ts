import { describe, expect, it } from "vitest";
import { buildPcbProductionPreview, type PcbPreviewInput } from "./buildPcbProductionPreview";

const input = (availableQuantity: string, overrides: Partial<PcbPreviewInput> = {}): PcbPreviewInput => ({
  productId: "product-1", name: "Resistor", serialNumber: "0000001", isActive: true,
  quantityPerCard: "2", availableQuantity, ...overrides,
});

describe("PCB production preview", () => {
  it.each([
    ["15", "0", true], ["10", "0", true], ["3", "7", false],
  ])("uses physical Available %s for Required 10 and Missing %s", (available, missing, ready) => {
    const result = buildPcbProductionPreview([input(available)], "5", true);
    expect(result).toMatchObject({ ok: true, ready, rows: [{
      requiredQuantity: "10", availableQuantity: available, missingQuantity: missing,
    }] });
  });

  it("preserves BOM order and exact values above Number.MAX_SAFE_INTEGER", () => {
    const rows = Object.freeze([
      Object.freeze(input("9007199254740993", { quantityPerCard: "9007199254740993" })),
      Object.freeze(input("2", { productId: "product-2", quantityPerCard: "3" })),
    ]);
    expect(buildPcbProductionPreview(rows, "1", true)).toMatchObject({ ok: true, ready: false, rows: [
      { productId: "product-1", requiredQuantity: "9007199254740993", missingQuantity: "0" },
      { productId: "product-2", requiredQuantity: "3", missingQuantity: "1" },
    ] });
    expect(rows[0]?.availableQuantity).toBe("9007199254740993");
  });

  it("accepts maximum bigint production quantity without Number conversion", () => {
    expect(buildPcbProductionPreview([
      input("9223372036854775807", { quantityPerCard: "1" }),
    ], "9223372036854775807", true)).toMatchObject({ ok: true, ready: true,
      rows: [{ requiredQuantity: "9223372036854775807", missingQuantity: "0" }] });
  });

  it("blocks readiness for archived input/output and empty BOM", () => {
    expect(buildPcbProductionPreview([input("10", { isActive: false })], "5", true))
      .toMatchObject({ ok: true, ready: false, insufficient: false });
    expect(buildPcbProductionPreview([input("10")], "5", false))
      .toMatchObject({ ok: true, ready: false });
    expect(buildPcbProductionPreview([], "5", true))
      .toEqual({ ok: true, rows: [], ready: false, insufficient: false });
  });

  it.each(["0", "-1", "1.5", "1e2", "+1", "9223372036854775808"])(
    "rejects invalid production quantity %s", (quantity) => {
      expect(buildPcbProductionPreview([input("10")], quantity, true))
        .toEqual({ ok: false, code: "invalid_quantity" });
    },
  );

  it("rejects multiplication overflow and malformed physical stock", () => {
    expect(buildPcbProductionPreview([input("0", { quantityPerCard: "9223372036854775807" })], "2", true))
      .toEqual({ ok: false, code: "overflow" });
    expect(buildPcbProductionPreview([input("1.5")], "2", true))
      .toEqual({ ok: false, code: "invalid_source" });
  });
});
