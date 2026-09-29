const POSTGRES_BIGINT_MAX_TEXT = "9223372036854775807";

export function isValidWorkOrderMaterialQuantity(value: string): boolean {
  if (!/^[1-9][0-9]*$/.test(value)) return false;
  return value.length < POSTGRES_BIGINT_MAX_TEXT.length ||
    (value.length === POSTGRES_BIGINT_MAX_TEXT.length &&
      value <= POSTGRES_BIGINT_MAX_TEXT);
}

export function getWorkOrderMaterialQuantityError(
  value: string,
  requireValue = false,
): string | null {
  if (value === "") {
    return requireValue ? "Quantity is required." : null;
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    return "Quantity must be a positive whole number.";
  }
  if (!isValidWorkOrderMaterialQuantity(value)) {
    return "Quantity is above the supported whole-number range.";
  }
  return null;
}

