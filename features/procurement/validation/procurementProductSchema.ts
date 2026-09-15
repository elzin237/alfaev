import { z } from "zod";

export const procurementProductSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  category: z.string().trim().min(1, "Category is required."),
  brandId: z.string().trim().transform((value) => value || null),
  catalogNumber: z.string().trim().transform((value) => value || null),
});

export type ProcurementProductFormInput = z.input<
  typeof procurementProductSchema
>;
export type ProcurementProductInput = z.output<typeof procurementProductSchema>;
