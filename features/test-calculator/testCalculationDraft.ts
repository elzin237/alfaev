import type { TestCalculatorProduct } from "./services/testCalculatorSearchService";

export interface TestCalculationDraft {
  name: string;
  deadlineDate: string;
  items: { product: TestCalculatorProduct; quantity: string }[];
}
export function sarajevoToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sarajevo",
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function validTestQuantity(quantity: string): boolean {
  return /^[1-9][0-9]{0,18}$/.test(quantity) && BigInt(quantity) <= 9223372036854775807n;
}
export function validateTestCalculationDraft(draft: TestCalculationDraft, now = new Date()): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("Calculation name is required.");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(draft.deadlineDate)
    ? new Date(`${draft.deadlineDate}T12:00:00Z`) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== draft.deadlineDate ||
    draft.deadlineDate < "0001-01-01" || draft.deadlineDate < sarajevoToday(now))
    errors.push("Choose a valid Sarajevo deadline with a future expiry (today or later).");
  if (draft.items.length < 1 || draft.items.length > 100) errors.push("Select 1 to 100 distinct Products.");
  const ids = draft.items.map(item => item.product.productId.toLowerCase());
  if (new Set(ids).size !== ids.length) errors.push("Each Product may only be selected once.");
  for (const item of draft.items) if (!validTestQuantity(item.quantity))
    errors.push(`${item.product.name}: required quantity must be a positive whole number up to 9223372036854775807.`);
  return errors;
}
