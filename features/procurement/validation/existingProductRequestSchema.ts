import { z } from "zod";

export const existingProductRequestSchema = z.object({
  productId: z.string().min(1, "Select a Product."),
  supplierId: z.string().min(1, "Select a Supplier."),
  requestedQuantity: z.string()
    .trim()
    .min(1, "Requested Quantity is required.")
    .regex(/^[0-9]+$/, "Requested Quantity must be a whole number.")
    .transform(Number)
    .refine(Number.isSafeInteger, "Requested Quantity is too large.")
    .refine((value) => value > 0, "Requested Quantity must be greater than zero."),
});

export type ExistingProductRequestFormInput = z.input<
  typeof existingProductRequestSchema
>;
export type ExistingProductRequestValues = z.output<
  typeof existingProductRequestSchema
>;
