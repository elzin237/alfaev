import { describe, expect, it } from "vitest";
import { calculatePcbRequirements } from "./calculatePcbRequirements";

const maxBigint = "9223372036854775807";
const item = (quantityPerCard: string, productId = "product-1") => ({
  productId, quantityPerCard,
});

describe("calculatePcbRequirements", () => {
  it.each([
    ["1", "1", "1"],
    ["2", "5", "10"],
    ["7", "12", "84"],
    ["9007199254740993", "1", "9007199254740993"],
    [maxBigint, "1", maxBigint],
    ["1", maxBigint, maxBigint],
  ])("calculates %s per card × %s cards exactly", (perCard, production, required) => {
    expect(calculatePcbRequirements([item(perCard)], production)).toEqual({
      ok: true,
      value: [{ productId: "product-1", quantityPerCard: perCard,
        productionQuantity: production, requiredQuantity: required }],
    });
  });

  it("calculates each BOM row independently, retaining input order and opaque IDs", () => {
    const bom = Object.freeze([
      Object.freeze(item("2", "second-product")),
      Object.freeze(item("7", "first-product")),
    ]);
    const result = calculatePcbRequirements(bom, "12");
    expect(result).toEqual({ ok: true, value: [
      { productId: "second-product", quantityPerCard: "2", productionQuantity: "12", requiredQuantity: "24" },
      { productId: "first-product", quantityPerCard: "7", productionQuantity: "12", requiredQuantity: "84" },
    ] });
    expect(calculatePcbRequirements(bom, "12")).toEqual(result);
    expect(bom).toEqual([item("2", "second-product"), item("7", "first-product")]);
  });

  it("validates production quantity before returning an empty BOM", () => {
    expect(calculatePcbRequirements([], "1")).toEqual({ ok: true, value: [] });
    expect(calculatePcbRequirements([], "0")).toEqual({
      ok: false, error: { code: "invalid_production_quantity" },
    });
  });

  it("keeps valid leading-zero operand text while returning canonical required text", () => {
    expect(calculatePcbRequirements([item("002")], "005")).toEqual({
      ok: true, value: [{ productId: "product-1", quantityPerCard: "002",
        productionQuantity: "005", requiredQuantity: "10" }],
    });
  });

  it.each([
    ["4611686018427387904", "2"],
    [maxBigint, "2"],
    ["9007199254740993", "9007199254740993"],
  ])("rejects product overflow for %s × %s", (perCard, production) => {
    expect(calculatePcbRequirements([item(perCard)], production)).toEqual({
      ok: false, error: { code: "required_quantity_overflow", itemIndex: 0 },
    });
  });

  const invalidQuantities = [
    "", " ", "0", "000", "-1", "1.5", "1e3", "+1", "NaN", "Infinity",
    " 1", "1 ", "abc", "9223372036854775808",
  ];

  it.each(invalidQuantities)("rejects invalid quantity-per-card text %j", (quantity) => {
    expect(calculatePcbRequirements([item("1"), item(quantity)], "1")).toEqual({
      ok: false, error: { code: "invalid_quantity_per_card", itemIndex: 1 },
    });
  });

  it.each(invalidQuantities)("rejects invalid production-quantity text %j", (quantity) => {
    expect(calculatePcbRequirements([item("1")], quantity)).toEqual({
      ok: false, error: { code: "invalid_production_quantity" },
    });
  });
});
