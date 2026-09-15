import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import type {
  CreateProcurementRequestForNewComponentInput,
  CreateProcurementRequestForProductInput,
  ProcurementActiveSupplierChoice,
  ProcurementCreationResult,
  ProcurementProductChoice,
} from "../services/procurementService";
import {
  procurementRequestSchema,
  type ProcurementRequestFormInput,
  type ProcurementRequestValues,
} from "../validation/procurementRequestSchema";

interface CreateExistingProductRequestDialogProps {
  open: boolean;
  productSearch: string;
  onProductSearchChange: (search: string) => void;
  products: ProcurementProductChoice[];
  suppliers: ProcurementActiveSupplierChoice[];
  isProductsLoading: boolean;
  isSuppliersLoading: boolean;
  productLoadError: string | null;
  supplierLoadError: string | null;
  onRetryProducts: () => void;
  onRetrySuppliers: () => void;
  onClose: () => void;
  onSubmitExisting: (
    input: CreateProcurementRequestForProductInput,
  ) => Promise<ProcurementCreationResult>;
  onSubmitNewComponent: (
    input: CreateProcurementRequestForNewComponentInput,
  ) => Promise<ProcurementCreationResult>;
  onCreated: () => void;
}

const emptyValues: ProcurementRequestFormInput = {
  requestMode: "existing",
  productId: "",
  requestedName: "",
  supplierId: "",
  requestedQuantity: "",
};

function CreateExistingProductRequestDialog({
  open,
  productSearch,
  onProductSearchChange,
  products,
  suppliers,
  isProductsLoading,
  isSuppliersLoading,
  productLoadError,
  supplierLoadError,
  onRetryProducts,
  onRetrySuppliers,
  onClose,
  onSubmitExisting,
  onSubmitNewComponent,
  onCreated,
}: CreateExistingProductRequestDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const productErrorId = useId();
  const supplierErrorId = useId();
  const quantityErrorId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const submissionLockRef = useRef(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const {
    register,
    clearErrors,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<
    ProcurementRequestFormInput,
    unknown,
    ProcurementRequestValues
  >({
    resolver: zodResolver(procurementRequestSchema),
    defaultValues: emptyValues,
  });
  const requestMode = watch("requestMode");
  const selectedProductId = watch("productId");
  const selectedProduct = products.find(
    (product) => product.productId === selectedProductId,
  ) ?? null;
  const choicesUnavailable = isSuppliersLoading || Boolean(supplierLoadError) ||
    (requestMode === "existing" && (
      isProductsLoading || Boolean(productLoadError)
    ));

  const resetDialog = useCallback(() => {
    setSubmissionError(null);
    reset(emptyValues);
    onProductSearchChange("");
  }, [onProductSearchChange, reset]);

  const closeSafely = useCallback(() => {
    if (submissionLockRef.current || isSubmitting) return;
    resetDialog();
    onClose();
  }, [isSubmitting, onClose, resetDialog]);

  useEffect(() => {
    if (!open) return;

    setSubmissionError(null);
    reset(emptyValues);
    onProductSearchChange("");
    queueMicrotask(() => searchRef.current?.focus());
  }, [onProductSearchChange, open, reset]);

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

      const firstControl = searchRef.current;
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
    if (submissionLockRef.current || choicesUnavailable) return;

    submissionLockRef.current = true;
    setSubmissionError(null);

    try {
      const result = input.requestMode === "existing"
        ? await onSubmitExisting({
          productId: input.productId,
          supplierId: input.supplierId,
          requestedQuantity: input.requestedQuantity,
        })
        : await onSubmitNewComponent({
          requestedName: input.requestedName,
          supplierId: input.supplierId,
          requestedQuantity: input.requestedQuantity,
        });
      if (!result.ok) {
        setSubmissionError(result.error.message);
        return;
      }

      resetDialog();
      onCreated();
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
        className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl sm:p-8"
      >
        <h2 id={titleId} className="text-2xl font-bold text-zinc-900">
          Add Procurement Request
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-500">
          Request an existing Product or a brand-new component from an active Supplier.
        </p>

        <form
          className="mt-6 space-y-5"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <fieldset>
            <legend className="block text-sm font-semibold text-zinc-800">
              Request Type
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={requestMode === "existing"}
                disabled={isSubmitting}
                onClick={() => {
                  setValue("requestMode", "existing");
                  setValue("productId", "");
                  setValue("requestedName", "");
                  clearErrors();
                  setSubmissionError(null);
                }}
                className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                  requestMode === "existing"
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                Existing Product
              </button>
              <button
                type="button"
                aria-pressed={requestMode === "new"}
                disabled={isSubmitting}
                onClick={() => {
                  setValue("requestMode", "new");
                  setValue("productId", "");
                  setValue("requestedName", "");
                  clearErrors();
                  onProductSearchChange("");
                  setSubmissionError(null);
                }}
                className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                  requestMode === "new"
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                Brand-New Component
              </button>
            </div>
          </fieldset>

          {requestMode === "existing" ? <>
          <div>
            <label
              htmlFor="procurement-product-search"
              className="block text-sm font-semibold text-zinc-800"
            >
              Search Product
            </label>
            <input
              ref={searchRef}
              id="procurement-product-search"
              type="search"
              value={productSearch}
              onChange={(event) => {
                onProductSearchChange(event.target.value);
                setValue("productId", "", { shouldValidate: false });
              }}
              disabled={isSubmitting}
              placeholder="Product Name or Serial Number / Šifra"
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
            />
          </div>

          <div>
            <label
              htmlFor="procurement-existing-product"
              className="block text-sm font-semibold text-zinc-800"
            >
              Product
            </label>
            {isProductsLoading ? (
              <p role="status" className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                Loading active Products...
              </p>
            ) : productLoadError ? (
              <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <p>{productLoadError}</p>
                <button type="button" onClick={onRetryProducts} className="mt-2 font-semibold underline underline-offset-2">
                  Try again
                </button>
              </div>
            ) : (
              <select
                {...register("productId")}
                id="procurement-existing-product"
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.productId)}
                aria-describedby={errors.productId ? productErrorId : undefined}
                className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
              >
                <option value="">Select a Product</option>
                {products.map((product) => (
                  <option key={product.productId} value={product.productId}>
                    {product.serialNumber} — {product.name}
                  </option>
                ))}
              </select>
            )}
            {!isProductsLoading && !productLoadError && products.length === 0 && (
              <p className="mt-2 text-sm text-zinc-500">
                No active Products match this search.
              </p>
            )}
            {errors.productId && (
              <p id={productErrorId} className="mt-2 text-sm text-red-600">
                {errors.productId.message}
              </p>
            )}
          </div>

          {selectedProduct && (
            <dl className="grid gap-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Serial Number / Šifra
                </dt>
                <dd className="mt-1 font-mono font-semibold text-zinc-900">
                  {selectedProduct.serialNumber}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Product Name
                </dt>
                <dd className="mt-1 font-semibold text-zinc-900">
                  {selectedProduct.name}
                </dd>
              </div>
            </dl>
          )}
          </> : <>
            <div>
              <label
                htmlFor="procurement-new-component-name"
                className="block text-sm font-semibold text-zinc-800"
              >
                Component Name
              </label>
              <input
                {...register("requestedName")}
                id="procurement-new-component-name"
                type="text"
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.requestedName)}
                className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
              />
              {errors.requestedName && (
                <p className="mt-2 text-sm text-red-600">
                  {errors.requestedName.message}
                </p>
              )}
            </div>

            <dl className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Serial Number / Šifra
                </dt>
                <dd className="mt-1 font-semibold text-zinc-900">
                  Not assigned
                </dd>
                <p className="mt-1 text-sm text-zinc-500">
                  AlfaEV assigns the Serial Number when an Admin creates the Product.
                </p>
              </div>
            </dl>
          </>}

          <div>
            <label
              htmlFor="procurement-active-supplier"
              className="block text-sm font-semibold text-zinc-800"
            >
              Supplier
            </label>
            {isSuppliersLoading ? (
              <p role="status" className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                Loading active Suppliers...
              </p>
            ) : supplierLoadError ? (
              <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <p>{supplierLoadError}</p>
                <button type="button" onClick={onRetrySuppliers} className="mt-2 font-semibold underline underline-offset-2">
                  Try again
                </button>
              </div>
            ) : (
              <select
                {...register("supplierId")}
                id="procurement-active-supplier"
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.supplierId)}
                aria-describedby={errors.supplierId ? supplierErrorId : undefined}
                className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
              >
                <option value="">Select a Supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.supplierId} value={supplier.supplierId}>
                    {supplier.supplierName}
                  </option>
                ))}
              </select>
            )}
            {errors.supplierId && (
              <p id={supplierErrorId} className="mt-2 text-sm text-red-600">
                {errors.supplierId.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="procurement-requested-quantity"
              className="block text-sm font-semibold text-zinc-800"
            >
              Requested Quantity
            </label>
            <input
              {...register("requestedQuantity")}
              id="procurement-requested-quantity"
              type="number"
              step="1"
              min="1"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.requestedQuantity)}
              aria-describedby={
                errors.requestedQuantity ? quantityErrorId : undefined
              }
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
            />
            {errors.requestedQuantity && (
              <p id={quantityErrorId} className="mt-2 text-sm text-red-600">
                {errors.requestedQuantity.message}
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
              disabled={isSubmitting || choicesUnavailable}
              className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Creating Request…" : "Create Request"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default CreateExistingProductRequestDialog;
