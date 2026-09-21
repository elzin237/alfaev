import { z } from "zod";

export const productNameCategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  category: z.string().trim().min(1, "Category is required."),
});

export const addComponentSchema = productNameCategorySchema.extend({
  brandId: z.string().trim().transform((value) => value || null),
});

export type AddComponentFormInput = z.input<typeof addComponentSchema>;
export type AddComponentInput = z.output<typeof addComponentSchema>;
