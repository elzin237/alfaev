import { z } from "zod";

const basicEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const optionalText = z
  .string()
  .transform((value) => value.trim() || null);

export const supplierCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Supplier Name is required."),
    catalogNumber: z.string().trim()
      .min(1, "Catalog Number is required.")
      .max(200, "Catalog Number must not exceed 200 characters."),
    description: z.string().trim()
      .max(2000, "Description must not exceed 2000 characters.")
      .transform((value) => value || null),
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
