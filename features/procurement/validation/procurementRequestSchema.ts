import { z } from "zod";

const requestedQuantity = z.string()
  .trim()
  .min(1, "Requested Quantity is required.")
  .regex(/^[0-9]+$/, "Requested Quantity must be a whole number.")
  .transform(Number)
  .refine(Number.isSafeInteger, "Requested Quantity is too large.")
  .refine((value) => value > 0, "Requested Quantity must be greater than zero.");

export const procurementRequestSchema = z.discriminatedUnion("requestMode", [
  z.object({
    requestMode: z.literal("existing"),
    productId: z.string().min(1, "Select a Product."),
    requestedName: z.string(),
    requestedQuantity,
  }),
  z.object({
    requestMode: z.literal("new"),
    productId: z.string(),
    requestedName: z.string()
      .trim()
      .min(1, "Component Name is required."),
    requestedQuantity,
  }),
]);

export type ProcurementRequestFormInput = z.input<
  typeof procurementRequestSchema
>;
export type ProcurementRequestValues = z.output<
  typeof procurementRequestSchema
>;
