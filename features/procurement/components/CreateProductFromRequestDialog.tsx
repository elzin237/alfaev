import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import type { Brand } from "../../inventory/services/brandService";
import type {
  CreatedProductFromProcurementRequest,
  ProcurementProductCreationResult,
  ProcurementRequestListItem,
} from "../services/procurementService";
import {
  procurementProductSchema,
  type ProcurementProductFormInput,
  type ProcurementProductInput,
} from "../validation/procurementProductSchema";

interface CreateProductFromRequestDialogProps {
  request: ProcurementRequestListItem | null;
  brands: Brand[];
  isBrandsLoading: boolean;
  brandLoadError: string | null;
  onRetryBrands: () => void;
  onClose: () => void;
  onSubmit: (
    input: ProcurementProductInput & { requestId: string },
  ) => Promise<ProcurementProductCreationResult>;
  onSucceeded: (product: CreatedProductFromProcurementRequest) => void;
}

function CreateProductFromRequestDialog({
  request,
  brands,
  isBrandsLoading,
  brandLoadError,
  onRetryBrands,
  onClose,
  onSubmit,
  onSucceeded,
}: CreateProductFromRequestDialogProps) {
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
  } = useForm<
    ProcurementProductFormInput,
    unknown,
    ProcurementProductInput
  >({
    resolver: zodResolver(procurementProductSchema),
    defaultValues: {
      name: request?.requestedName ?? "",
      category: "",
      brandId: "",
      catalogNumber: "",
    },
  });
  const nameRegistration = register("name");

  const resetForm = useCallback(() => {
    reset({
      name: request?.requestedName ?? "",
      category: "",
      brandId: "",
      catalogNumber: "",
    });
  }, [request?.requestedName, reset]);

  const closeSafely = useCallback(() => {
    if (submissionLockRef.current || isSubmitting) return;
    setSubmissionError(null);
    resetForm();
    onClose();
  }, [isSubmitting, onClose, resetForm]);

  useEffect(() => {
    if (!request) return;
    setSubmissionError(null);
    resetForm();
    queueMicrotask(() => nameInputRef.current?.focus());
  }, [request, resetForm]);

  useEffect(() => {
    if (!request) return;

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
  }, [closeSafely, isSubmitting, request]);

  const submit = handleSubmit(async (input) => {
    if (
      !request ||
      submissionLockRef.current ||
      isBrandsLoading ||
      brandLoadError
    ) return;

    submissionLockRef.current = true;
    setSubmissionError(null);

    try {
      const result = await onSubmit({
        ...input,
        catalogNumber: request.supplierId === null
          ? null
          : input.catalogNumber,
        requestId: request.requestId,
      });
      if (!result.ok) {
        setSubmissionError(result.error.message);
        return;
      }

      resetForm();
      onSucceeded(result.value);
      onClose();
    } finally {
      submissionLockRef.current = false;
    }
  });

  if (!request) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={isSubmitting}
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl sm:p-8"
      >
        <h2 id={titleId} className="text-2xl font-bold text-zinc-900">
          Create component from request
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-500">
          Create a real Inventory Product. The Procurement request stays in its current lifecycle, and its Serial Number is generated automatically.
        </p>

        <form
          className="mt-6 space-y-5"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <div>
            <label htmlFor="request-product-name" className="block text-sm font-semibold text-zinc-800">
              Name
            </label>
            <input
              {...nameRegistration}
              ref={(element) => {
                nameRegistration.ref(element);
                nameInputRef.current = element;
              }}
              id="request-product-name"
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
            <label htmlFor="request-product-category" className="block text-sm font-semibold text-zinc-800">
              Category
            </label>
            <input
              {...register("category")}
              id="request-product-category"
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
            <label htmlFor="request-product-brand" className="block text-sm font-semibold text-zinc-800">
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
                id="request-product-brand"
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

          {request.supplierId === null ? (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-sm font-semibold text-zinc-800">Supplier</p>
              <p className="mt-1 text-sm text-zinc-600">Not assigned</p>
              <p className="mt-2 text-xs text-zinc-500">
                The Component will be created without a Product-Supplier relationship or Catalog Number.
              </p>
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="request-product-supplier" className="block text-sm font-semibold text-zinc-800">
                  Supplier
                </label>
                <input
                  id="request-product-supplier"
                  type="text"
                  readOnly
                  value={request.supplierName ?? "Not assigned"}
                  className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-3 text-sm text-zinc-700"
                />
                <p className="mt-2 text-xs text-zinc-500">
                  The Supplier is fixed by the Procurement request.
                </p>
              </div>

              <div>
                <label htmlFor="request-product-catalog-number" className="block text-sm font-semibold text-zinc-800">
                  Catalog Number <span className="font-normal text-zinc-500">(optional)</span>
                </label>
                <input
                  {...register("catalogNumber")}
                  id="request-product-catalog-number"
                  type="text"
                  disabled={isSubmitting}
                  className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 font-mono text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
                />
              </div>
            </>
          )}

          <div>
            <label htmlFor="request-product-serial" className="block text-sm font-semibold text-zinc-800">
              Serial Number
            </label>
            <input
              id="request-product-serial"
              type="text"
              readOnly
              value="Generated automatically"
              className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-3 text-sm text-zinc-700"
            />
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
              {isSubmitting ? "Creating Component…" : "Create Component"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default CreateProductFromRequestDialog;
