const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workOrderNumberPattern = /^RN-[0-9]{4}-[0-9]{4}$/;

export function isWorkOrderId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function isWorkOrderNumber(value: unknown): value is string {
  return typeof value === "string" && workOrderNumberPattern.test(value);
}
