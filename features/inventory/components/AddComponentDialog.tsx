import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import type { Brand } from "../services/brandService";
import type {
  CreatedProduct,
  ProductCreationResult,
} from "../services/productService";
import {
  addComponentSchema,
  type AddComponentFormInput,
  type AddComponentInput,
} from "../validation/productSchema";

export interface AddComponentDialogProps {
  open: boolean;
  brands: Brand[];
  isBrandsLoading: boolean;
  brandLoadError: string | null;
  onRetryBrands: () => void;
  onClose: () => void;
  onSubmit: (input: AddComponentInput) => Promise<ProductCreationResult>;
  onSucceeded: (product: CreatedProduct) => void;
}

function AddComponentDialog({
  open,
  brands,
  isBrandsLoading,
  brandLoadError,
  onRetryBrands,
  onClose,
  onSubmit,
  onSucceeded,
}: AddComponentDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const nameErrorId = useId();
  const categoryErrorId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const submissionLockRef = useRef(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const activeBrands = brands.filter((brand) => brand.isActive);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddComponentFormInput, unknown, AddComponentInput>({
    resolver: zodResolver(addComponentSchema),
    defaultValues: { name: "", category: "", brandId: "" },
  });
  const nameRegistration = register("name");

  const closeSafely = useCallback(() => {
    if (submissionLockRef.current || isSubmitting) return;

    setSubmissionError(null);
    reset({ name: "", category: "", brandId: "" });
    onClose();
  }, [isSubmitting, onClose, reset]);

  useEffect(() => {
    if (!open) return;

    setSubmissionError(null);
    reset({ name: "", category: "", brandId: "" });
    queueMicrotask(() => nameInputRef.current?.focus());
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

      const firstControl = nameInputRef.current;
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
    if (
      submissionLockRef.current ||
      isBrandsLoading ||
      brandLoadError
    ) return;

    submissionLockRef.current = true;
    setSubmissionError(null);

    try {
      const result = await onSubmit(input);
      if (!result.ok) {
        setSubmissionError(result.error.message);
        return;
      }

      reset({ name: "", category: "", brandId: "" });
      onSucceeded(result.value);
      onClose();
    } finally {
      submissionLockRef.current = false;
    }
  });

  if (!open) return null;

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
          Add Component
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-500">
          Add a Component to Inventory. AlfaEV generates its Serial Number automatically.
        </p>

        <form
          className="mt-6 space-y-5"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <div>
            <label htmlFor="component-name" className="block text-sm font-semibold text-zinc-800">
              Name
            </label>
            <input
              {...nameRegistration}
              ref={(element) => {
                nameRegistration.ref(element);
                nameInputRef.current = element;
              }}
              id="component-name"
              type="text"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? nameErrorId : undefined}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
            />
            {errors.name && (
              <p id={nameErrorId} className="mt-2 text-sm text-red-600">
                {errors.name.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="component-category" className="block text-sm font-semibold text-zinc-800">
              Category
            </label>
            <input
              {...register("category")}
              id="component-category"
              type="text"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.category)}
              aria-describedby={errors.category ? categoryErrorId : undefined}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
            />
            {errors.category && (
              <p id={categoryErrorId} className="mt-2 text-sm text-red-600">
                {errors.category.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="component-brand" className="block text-sm font-semibold text-zinc-800">
              Brand <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            {isBrandsLoading ? (
              <p role="status" className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                Loading active Brands...
              </p>
            ) : brandLoadError ? (
              <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <p>{brandLoadError}</p>
                <button
                  type="button"
                  onClick={onRetryBrands}
                  className="mt-2 font-semibold underline underline-offset-2"
                >
                  Try again
                </button>
              </div>
            ) : (
              <select
                {...register("brandId")}
                id="component-brand"
                disabled={isSubmitting}
                className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
              >
                <option value="">No Brand</option>
                {activeBrands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
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
              disabled={isSubmitting || isBrandsLoading || Boolean(brandLoadError)}
              className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Adding Component…" : "Add Component"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default AddComponentDialog;
