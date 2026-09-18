import { calculatePcbRequirements } from "./calculatePcbRequirements";

export interface PcbPreviewInput {
  productId: string;
  name: string;
  serialNumber: string;
  isActive: boolean;
  quantityPerCard: string;
  availableQuantity: string;
}

export interface PcbPreviewRow extends PcbPreviewInput {
  requiredQuantity: string;
  missingQuantity: string;
}

export type PcbPreviewResult =
  | { ok: true; rows: PcbPreviewRow[]; ready: boolean; insufficient: boolean }
  | { ok: false; code: "invalid_quantity" | "invalid_source" | "overflow" };

const maxBigint = 9223372036854775807n;

export function buildPcbProductionPreview(
  inputs: readonly Readonly<PcbPreviewInput>[],
  productionQuantity: string,
  outputIsActive: boolean,
): PcbPreviewResult {
  const calculated = calculatePcbRequirements(inputs, productionQuantity);
  if (!calculated.ok) return { ok: false, code: calculated.error.code === "required_quantity_overflow"
    ? "overflow" : "invalid_quantity" };

  const rows: PcbPreviewRow[] = [];
  let insufficient = false;
  let unavailable = !outputIsActive;
  for (const [index, input] of inputs.entries()) {
    if (!/^(0|[1-9][0-9]*)$/.test(input.availableQuantity) ||
      BigInt(input.availableQuantity) > maxBigint) return { ok: false, code: "invalid_source" };
    const requiredQuantity = calculated.value[index]!.requiredQuantity;
    const difference = BigInt(requiredQuantity) - BigInt(input.availableQuantity);
    const missingQuantity = difference > 0n ? difference.toString() : "0";
    if (difference > 0n) insufficient = true;
    if (!input.isActive) unavailable = true;
    rows.push({ ...input, requiredQuantity, missingQuantity });
  }
  return { ok: true, rows, insufficient, ready: !insufficient && !unavailable };
}
