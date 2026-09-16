import { randomUUID } from "node:crypto";

export function createTestSerialNumber(): string {
  const randomValue = Number.parseInt(
    randomUUID().replace(/-/g, "").slice(0, 12),
    16,
  ) % 10_000_000;

  return randomValue.toString().padStart(7, "0");
}
