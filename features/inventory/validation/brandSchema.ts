import { z } from "zod";

export const brandSchema = z.object({
  name: z.string().trim().min(1, "Brand Name is required."),
});

export type BrandFormInput = z.input<typeof brandSchema>;
export type BrandInput = z.output<typeof brandSchema>;
