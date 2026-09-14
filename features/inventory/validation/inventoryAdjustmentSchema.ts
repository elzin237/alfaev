import { z } from "zod";

const inventoryAdjustmentFields = z.object({
  adjustmentType: z.enum(["add", "remove", "correction"]),
  quantity: z.string()
    .trim()
    .min(1, "Quantity is required.")
    .regex(/^-?[0-9]+$/, "Quantity must be a whole number.")
    .transform(Number)
    .refine(Number.isSafeInteger, "Quantity must be a whole number."),
  reason: z.string().trim().min(1, "Reason is required."),
});

export type InventoryAdjustmentFormInput = z.input<
  typeof inventoryAdjustmentFields
>;
export type InventoryAdjustmentFormOutput = z.output<
  typeof inventoryAdjustmentFields
>;

export function createInventoryAdjustmentSchema(currentQuantity: number) {
  return inventoryAdjustmentFields.superRefine((value, context) => {
    if (value.quantity < 0) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: value.adjustmentType === "correction"
          ? "Correction target cannot be negative."
          : "Quantity must be greater than zero.",
      });
      return;
    }

    if (
      (value.adjustmentType === "add" || value.adjustmentType === "remove") &&
      value.quantity === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Add and Remove quantity must be greater than zero.",
      });
    }

    if (
      value.adjustmentType === "remove" &&
      currentQuantity - value.quantity < 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Resulting quantity cannot be negative.",
      });
    }

    if (
      value.adjustmentType === "correction" &&
      value.quantity === currentQuantity
    ) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Correction target must differ from the current quantity.",
      });
    }
  });
}
