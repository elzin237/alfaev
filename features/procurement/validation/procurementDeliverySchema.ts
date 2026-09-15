import { z } from "zod";

export function createProcurementDeliverySchema(requestedQuantity: number) {
  return z.object({
    deliveredQuantity: z.string()
      .trim()
      .min(1, "Delivered So Far is required.")
      .regex(/^[0-9]+$/, "Delivered So Far must be a whole number.")
      .transform(Number)
      .refine(Number.isSafeInteger, "Delivered So Far must be a whole number.")
      .refine(
        (quantity) => quantity <= requestedQuantity,
        `Delivered So Far cannot exceed Requested Quantity (${requestedQuantity}).`,
      ),
  });
}

export type ProcurementDeliveryFormInput = {
  deliveredQuantity: string;
};

export type ProcurementDeliveryFormOutput = {
  deliveredQuantity: number;
};
