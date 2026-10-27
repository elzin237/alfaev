import { describe, expect, it } from "vitest";
import { sarajevoToday, validateTestCalculationDraft, validTestQuantity, type TestCalculationDraft } from "./testCalculationDraft";
const product = { productId: "10000000-0000-4000-8000-000000000001", name: "Component", serialNumber: "0000123", productKind: "component", sourcePolicy: "raw_customs_fg" } as const;
const now = new Date("2026-10-27T12:00:00Z");
const draft: TestCalculationDraft = { name: "Test", deadlineDate: "2030-01-01", items: [{ product, quantity: "1" }] };
describe("Test Calculation draft validation", () => {
  it.each(["1","9007199254740993","9223372036854775807"])("keeps exact valid quantity %s", value => expect(validTestQuantity(value)).toBe(true));
  it.each(["","0","-1","01","1.5","1e3"," 1","9223372036854775808","9".repeat(100)])("rejects invalid quantity %s", value => expect(validTestQuantity(value)).toBe(false));
  it("requires name, 1–100 distinct Products and a real date", () => {
    expect(validateTestCalculationDraft(draft,now)).toEqual([]);
    expect(validateTestCalculationDraft({ ...draft, name: " ", items: [], deadlineDate: "" },now)).toHaveLength(3);
    expect(validateTestCalculationDraft({ ...draft, items: [draft.items[0]!,draft.items[0]!] },now)).toContain("Each Product may only be selected once.");
    expect(validateTestCalculationDraft({ ...draft, items: Array(101).fill(draft.items[0]) },now)).toContain("Select 1 to 100 distinct Products.");
    for (const deadlineDate of ["2026-02-30","2027-02-29","0000-01-01","2026-10-26","invalid"])
      expect(validateTestCalculationDraft({ ...draft, deadlineDate },now).length).toBeGreaterThan(0);
    expect(validateTestCalculationDraft({ ...draft, deadlineDate: "2028-02-29" },now)).toEqual([]);
  });
  it("uses Sarajevo calendar days, including DST and included deadline day", () => {
    expect(sarajevoToday(new Date("2026-10-27T23:30:00Z"))).toBe("2026-10-28");
    expect(sarajevoToday(new Date("2026-03-29T22:30:00Z"))).toBe("2026-03-30");
    expect(validateTestCalculationDraft({ ...draft, deadlineDate: "2026-10-27" },now)).toEqual([]);
    expect(validateTestCalculationDraft({ ...draft, deadlineDate: "2026-10-27" },new Date("2026-10-27T23:30:00Z"))).not.toEqual([]);
  });
});
