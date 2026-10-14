import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

import type {
  ProductSupplierChoice,
  ProductSupplierMutationResult,
} from "../services/productSupplierService";

export interface ProductSupplierDialogProps {
  open: boolean;
  suppliers: ProductSupplierChoice[];
  isSuppliersLoading: boolean;
  supplierLoadError: string | null;
  onRetrySuppliers: () => void;
  onClose: () => void;
  onSubmit: (input: { supplierId: string }) => Promise<ProductSupplierMutationResult>;
  onSucceeded: () => void;
}

export default function ProductSupplierDialog({
  open,
  suppliers,
  isSuppliersLoading,
  supplierLoadError,
  onRetrySuppliers,
  onClose,
  onSubmit,
  onSucceeded,
}: ProductSupplierDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const supplierErrorId = useId();
  const firstControlRef = useRef<HTMLSelectElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const submissionLockRef = useRef(false);
  const [supplierId, setSupplierId] = useState("");
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setSupplierId("");
    setSupplierError(null);
    setSubmissionError(null);
  }, []);

  const closeSafely = useCallback(() => {
    if (submissionLockRef.current) return;
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  useEffect(() => {
    if (!open) return;
    resetForm();
    queueMicrotask(() => firstControlRef.current?.focus());
  }, [open, resetForm]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSafely();
        return;
      }

      if (event.key !== "Tab") return;
      if (submissionLockRef.current) {
        event.preventDefault();
        return;
      }

      const firstControl = firstControlRef.current;
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
  }, [closeSafely, open]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionLockRef.current) return;
    if (!supplierId) {
      setSupplierError("Select a Supplier.");
      return;
    }
    submissionLockRef.current = true;
    setIsSubmitting(true);
    setSupplierError(null);
    setSubmissionError(null);
    try {
      const result = await onSubmit({ supplierId });
      if (!result.ok) {
        setSubmissionError(result.error.message);
        return;
      }
      resetForm();
      onSucceeded();
      onClose();
    } finally {
      submissionLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  const blocked = isSuppliersLoading || Boolean(supplierLoadError);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={isSubmitting} className="w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl sm:p-8">
        <h2 id={titleId} className="text-2xl font-bold text-zinc-900">Add Supplier Link</h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-500">
          Link an active Supplier to this Product. Catalog Number and Description come from the Supplier.
        </p>
        <form className="mt-6 space-y-5" noValidate onSubmit={(event) => void submit(event)}>
          <div>
            <label htmlFor="product-supplier" className="block text-sm font-semibold text-zinc-800">Supplier</label>
            {isSuppliersLoading ? (
              <p role="status" className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">Loading active Suppliers...</p>
            ) : supplierLoadError ? (
              <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <p>{supplierLoadError}</p>
                <button type="button" onClick={onRetrySuppliers} className="mt-2 font-semibold underline underline-offset-2">Try again</button>
              </div>
            ) : (
              <select ref={firstControlRef} id="product-supplier" value={supplierId} onChange={(event) => { setSupplierId(event.target.value); setSupplierError(null); }} disabled={isSubmitting} aria-invalid={Boolean(supplierError)} aria-describedby={supplierError ? supplierErrorId : undefined} className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100">
                <option value="">Select a Supplier</option>
                {suppliers.map((supplier) => <option key={supplier.supplierId} value={supplier.supplierId}>{supplier.supplierName}</option>)}
              </select>
            )}
            {supplierError && <p id={supplierErrorId} className="mt-2 text-sm text-red-600">{supplierError}</p>}
          </div>
          {submissionError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submissionError}</p>}
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={closeSafely} disabled={isSubmitting} className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
            <button ref={submitButtonRef} type="submit" disabled={isSubmitting || blocked} className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Saving..." : "Add Supplier"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
