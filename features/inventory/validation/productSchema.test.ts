import { describe, expect, it } from "vitest";

import { addComponentSchema, productNameCategorySchema } from "./productSchema";

describe("Product validation", () => {
  it("shares trimmed required Product Name and Category validation", () => {
    expect(productNameCategorySchema.parse({
      name: "  Resistor  ",
      category: "  Passive  ",
    })).toEqual({ name: "Resistor", category: "Passive" });
    expect(productNameCategorySchema.safeParse({ name: " ", category: "Parts" }).success)
      .toBe(false);
    expect(productNameCategorySchema.safeParse({ name: "Part", category: " " }).success)
      .toBe(false);
  });

  it("preserves normal Add Component transformed output", () => {
    expect(addComponentSchema.parse({
      name: "  Resistor  ",
      category: "  Passive  ",
      brandId: "  brand-1  ",
    })).toEqual({ name: "Resistor", category: "Passive", brandId: "brand-1" });
    expect(addComponentSchema.parse({
      name: "Part",
      category: "Parts",
      brandId: "   ",
    })).toEqual({ name: "Part", category: "Parts", brandId: null });
  });
});
