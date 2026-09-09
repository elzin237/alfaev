import { z } from "zod";

const basicEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const optionalText = z
  .string()
  .transform((value) => value.trim() || null);

export const supplierCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Supplier Name is required."),
    country: z.string().trim().min(1, "Country is required."),
    contactPersonName: optionalText,
    contactPhone: optionalText,
    contactEmail: z
      .string()
      .trim()
      .refine(
        (value) => value === "" || basicEmailPattern.test(value),
        "Enter a valid Supplier email address.",
      )
      .transform((value) => value.toLowerCase() || null),
  })
  .strict();

export type SupplierCreateFormInput = z.input<typeof supplierCreateSchema>;
export type SupplierCreateValues = z.output<typeof supplierCreateSchema>;
