const maxBigintText = "9223372036854775807";
const maxBigint = 9223372036854775807n;

export interface PcbRequirementBomItem {
  productId: string;
  quantityPerCard: string;
}

export interface PcbRequirement {
  productId: string;
  quantityPerCard: string;
  productionQuantity: string;
  requiredQuantity: string;
}

export type PcbRequirementError =
  | { code: "invalid_production_quantity" }
  | { code: "invalid_quantity_per_card"; itemIndex: number }
  | { code: "required_quantity_overflow"; itemIndex: number };

export type PcbRequirementResult =
  | { ok: true; value: PcbRequirement[] }
  | { ok: false; error: PcbRequirementError };

function parsePositiveBigint(value: string): bigint | null {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  const digits = value.replace(/^0+/, "");
  if (!digits || digits.length > maxBigintText.length ||
      (digits.length === maxBigintText.length && digits > maxBigintText)) return null;
  return BigInt(digits);
}

// Production quantity is validated even for an empty BOM.
export function calculatePcbRequirements(
  bomItems: readonly Readonly<PcbRequirementBomItem>[],
  productionQuantity: string,
): PcbRequirementResult {
  const production = parsePositiveBigint(productionQuantity);
  if (production === null) return { ok: false, error: { code: "invalid_production_quantity" } };

  const requirements: PcbRequirement[] = [];
  for (const [itemIndex, item] of bomItems.entries()) {
    const perCard = parsePositiveBigint(item.quantityPerCard);
    if (perCard === null) {
      return { ok: false, error: { code: "invalid_quantity_per_card", itemIndex } };
    }
    const required = perCard * production;
    if (required > maxBigint) {
      return { ok: false, error: { code: "required_quantity_overflow", itemIndex } };
    }
    requirements.push({
      productId: item.productId,
      quantityPerCard: item.quantityPerCard,
      productionQuantity,
      requiredQuantity: required.toString(),
    });
  }
  return { ok: true, value: requirements };
}
