import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import type {
  InventoryAdjustment,
  InventoryAdjustmentInput,
  InventoryAdjustmentResult,
  InventoryAdjustmentType,
} from "../services/inventoryBalanceService";
import {
  createInventoryAdjustmentSchema,
  type InventoryAdjustmentFormInput,
  type InventoryAdjustmentFormOutput,
} from "../validation/inventoryAdjustmentSchema";
import type { InventorySourceChoice } from "../services/inventorySourceService";

export interface InventoryAdjustmentDialogProps {
  open: boolean;
  currentQuantity: number;
  sourceChoices?: InventorySourceChoice[];
  isSourceChoicesLoading?: boolean;
  sourceChoicesError?: string | null;
  onRetrySourceChoices?: () => void;
  onClose: () => void;
  onSubmit: (input: InventoryAdjustmentInput) => Promise<InventoryAdjustmentResult>;
  onSucceeded: (adjustment: InventoryAdjustment) => void;
}

interface AdjustmentPreview {
  adjustment: string;
  resultingQuantity: number | null;
}

const defaultValues: InventoryAdjustmentFormInput = {
  adjustmentType: "add",
  quantity: "",
  reason: "",
};

function getPreview(
  adjustmentType: InventoryAdjustmentType,
  quantityInput: string,
  currentQuantity: number,
): AdjustmentPreview {
  const normalizedQuantity = quantityInput.trim();
  if (!/^-?[0-9]+$/.test(normalizedQuantity)) {
    return { adjustment: "—", resultingQuantity: null };
  }

  const quantity = Number(normalizedQuantity);
  if (!Number.isSafeInteger(quantity)) {
    return { adjustment: "—", resultingQuantity: null };
  }

  const delta = adjustmentType === "add"
    ? quantity
    : adjustmentType === "remove"
      ? -quantity
      : quantity - currentQuantity;
  const resultingQuantity = adjustmentType === "correction"
    ? quantity
    : currentQuantity + delta;

  return {
    adjustment: delta > 0 ? `+${delta}` : String(delta),
    resultingQuantity,
  };
}

function InventoryAdjustmentDialog({
  open,
  currentQuantity,
  sourceChoices = [],
  isSourceChoicesLoading = false,
  sourceChoicesError = null,
  onRetrySourceChoices = () => undefined,
  onClose,
  onSubmit,
  onSucceeded,
}: InventoryAdjustmentDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const quantityErrorId = useId();
  const reasonErrorId = useId();
  const typeSelectRef = useRef<HTMLSelectElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const submissionLockRef = useRef(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [productSupplierId, setProductSupplierId] = useState("");
  const schema = useMemo(
    () => createInventoryAdjustmentSchema(currentQuantity),
    [currentQuantity],
  );
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<
    InventoryAdjustmentFormInput,
    unknown,
    InventoryAdjustmentFormOutput
  >({
    resolver: zodResolver(schema),
    defaultValues,
  });
  const typeRegistration = register("adjustmentType");
  const adjustmentType = watch("adjustmentType");
  const quantityInput = watch("quantity");
  const preview = getPreview(
    adjustmentType,
    quantityInput,
    currentQuantity,
  );

  const closeSafely = useCallback(() => {
    if (submissionLockRef.current || isSubmitting) return;

    setSubmissionError(null);
    setProductSupplierId("");
    reset(defaultValues);
    onClose();
  }, [isSubmitting, onClose, reset]);

  useEffect(() => {
    if (!open) return;

    setSubmissionError(null);
    setProductSupplierId("");
    reset(defaultValues);
    queueMicrotask(() => typeSelectRef.current?.focus());
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSafely();
        return;
      }

      if (event.key !== "Tab") return;
      if (submissionLockRef.current || isSubmitting) {
        event.preventDefault();
        return;
      }

      const firstControl = typeSelectRef.current;
      const lastControl = submitButtonRef.current;
      if (!firstControl || !lastControl) return;

      if (event.shiftKey && document.activeElement === firstControl) {
        event.preventDefault();
        lastControl.focus();
      } else if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault();
        firstControl.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeSafely, isSubmitting, open]);

  const submit = handleSubmit(async (input) => {
    if (submissionLockRef.current) return;

    const requiresSource = input.adjustmentType === "add" ||
      (input.adjustmentType === "correction" && input.quantity > currentQuantity);
    if (requiresSource && !productSupplierId) {
      setSubmissionError("Select the Supplier Catalog Source for inbound stock.");
      return;
    }
    submissionLockRef.current = true;
    setSubmissionError(null);

    try {
      const result = await onSubmit({
        ...input,
        productSupplierId: requiresSource ? productSupplierId : null,
      });
      if (!result.ok) {
        setSubmissionError(result.error.message);
        return;
      }

      reset(defaultValues);
      setProductSupplierId("");
      onSucceeded(result.value);
      onClose();
    } finally {
      submissionLockRef.current = false;
    }
  });

  if (!open) return null;

  const sourceRequired = adjustmentType === "add" ||
    (adjustmentType === "correction" &&
      preview.resultingQuantity !== null && preview.resultingQuantity > currentQuantity);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={isSubmitting}
        className="w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl sm:p-8"
      >
        <h2 id={titleId} className="text-2xl font-bold text-zinc-900">
          Adjust Inventory
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-500">
          Add or remove stock, or correct Inventory to a final whole-number quantity.
        </p>

        <dl className="mt-6 grid grid-cols-3 gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-center">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Current Quantity
            </dt>
            <dd className="mt-2 text-lg font-bold text-zinc-900">
              {currentQuantity}
            </dd>
          </div>

          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Adjustment
            </dt>
            <dd className="mt-2 text-lg font-bold text-zinc-900">
              {preview.adjustment}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Resulting Quantity
            </dt>
            <dd className="mt-2 text-lg font-bold text-zinc-900">
              {preview.resultingQuantity ?? "—"}
            </dd>
          </div>
        </dl>

        <form
          className="mt-6 space-y-5"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <div>
            <label htmlFor="inventory-adjustment-type" className="block text-sm font-semibold text-zinc-800">
              Adjustment Type
            </label>
            <select
              {...typeRegistration}
              ref={(element) => {
                typeRegistration.ref(element);
                typeSelectRef.current = element;
              }}
              id="inventory-adjustment-type"
              disabled={isSubmitting}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
            >
              <option value="add">Add</option>
              <option value="remove">Remove</option>
              <option value="correction">Correction</option>
            </select>
          </div>

          {sourceRequired && (
            <div>
              <label htmlFor="inventory-product-supplier-source" className="block text-sm font-semibold text-zinc-800">
                Supplier Catalog Source
              </label>
              {isSourceChoicesLoading ? (
                <p role="status" className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">Loading source choices...</p>
              ) : sourceChoicesError ? (
                <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <p>{sourceChoicesError}</p>
                  <button type="button" onClick={onRetrySourceChoices} className="mt-2 font-semibold underline underline-offset-2">Try again</button>
                </div>
              ) : (
                <select
                  id="inventory-product-supplier-source"
                  value={productSupplierId}
                  onChange={(event) => setProductSupplierId(event.target.value)}
                  disabled={isSubmitting}
                  required
                  className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
                >
                  <option value="">Select a Supplier Catalog Source</option>
                  {sourceChoices.map((source) => (
                    <option key={source.productSupplierId} value={source.productSupplierId}>
                      {source.supplierName} — {source.catalogNumber}{source.description ? ` — ${source.description}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div>
            <label htmlFor="inventory-adjustment-quantity" className="block text-sm font-semibold text-zinc-800">
              Quantity
            </label>
            <input
              {...register("quantity")}
              id="inventory-adjustment-quantity"
              type="number"
              step="1"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.quantity)}
              aria-describedby={errors.quantity ? quantityErrorId : undefined}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
            />
            {errors.quantity && (
              <p id={quantityErrorId} className="mt-2 text-sm text-red-600">
                {errors.quantity.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="inventory-adjustment-reason" className="block text-sm font-semibold text-zinc-800">
              Reason
            </label>
            <textarea
              {...register("reason")}
              id="inventory-adjustment-reason"
              rows={3}
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.reason)}
              aria-describedby={errors.reason ? reasonErrorId : undefined}
              className="mt-2 w-full resize-y rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
            />
            {errors.reason && (
              <p id={reasonErrorId} className="mt-2 text-sm text-red-600">
                {errors.reason.message}
              </p>
            )}
          </div>

          {submissionError && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {submissionError}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closeSafely}
              disabled={isSubmitting}
              className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              ref={submitButtonRef}
              type="submit"
              disabled={isSubmitting || (sourceRequired && (isSourceChoicesLoading || Boolean(sourceChoicesError)))}
              className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Adjusting Inventory…" : "Adjust Inventory"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default InventoryAdjustmentDialog;
