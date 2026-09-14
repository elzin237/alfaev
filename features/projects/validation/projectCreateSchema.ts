import { z } from "zod";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isCanonicalDate(value: string): boolean {
  if (!isoDatePattern.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

const projectDateSchema = (label: "Start Date" | "Delivery Date") =>
  z.string()
    .min(1, `${label} is required.`)
    .refine(
      (value) => value.length === 0 || isCanonicalDate(value),
      `Enter a valid ${label}.`,
    );

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1, "Project Name is required."),
  customerName: z.string().trim().min(1, "Customer is required."),
  startDate: projectDateSchema("Start Date"),
  deliveryDate: projectDateSchema("Delivery Date"),
}).superRefine((value, context) => {
  if (
    isCanonicalDate(value.startDate) &&
    isCanonicalDate(value.deliveryDate) &&
    value.deliveryDate < value.startDate
  ) {
    context.addIssue({
      code: "custom",
      path: ["deliveryDate"],
      message: "Delivery Date cannot be before Start Date.",
    });
  }
});

export type ProjectCreateFormInput = z.input<typeof projectCreateSchema>;
export type ProjectCreateValues = z.output<typeof projectCreateSchema>;
