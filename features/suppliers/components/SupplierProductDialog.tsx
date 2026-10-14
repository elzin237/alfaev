import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

import type {
  ProductSupplierMutationResult,
  ProductSupplierProductChoice,
} from "../../inventory/services/productSupplierService";

export interface SupplierProductDialogProps {
  open: boolean;
  products: ProductSupplierProductChoice[];
  isProductsLoading: boolean;
  productLoadError: string | null;
  onRetryProducts: () => void;
  onClose: () => void;
  onSubmit: (input: { productId: string }) => Promise<ProductSupplierMutationResult>;
  onSucceeded: () => void;
}

export default function SupplierProductDialog({
  open,
  products,
  isProductsLoading,
  productLoadError,
  onRetryProducts,
  onClose,
  onSubmit,
  onSucceeded,
}: SupplierProductDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const productErrorId = useId();
  const firstControlRef = useRef<HTMLSelectElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const submissionLockRef = useRef(false);
  const [productId, setProductId] = useState("");
  const [productError, setProductError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setProductId("");
    setProductError(null);
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
    if (!productId) {
      setProductError("Select a Product.");
      return;
    }
    submissionLockRef.current = true;
    setIsSubmitting(true);
    setProductError(null);
    setSubmissionError(null);
    try {
      const result = await onSubmit({ productId });
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

  const blocked = isProductsLoading || Boolean(productLoadError);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={isSubmitting} className="w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl sm:p-8">
        <h2 id={titleId} className="text-2xl font-bold text-zinc-900">Add Product Link</h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-500">Link an active Product to this Supplier.</p>
        <form className="mt-6 space-y-5" noValidate onSubmit={(event) => void submit(event)}>
          <div>
            <label htmlFor="supplier-product" className="block text-sm font-semibold text-zinc-800">Product</label>
            {isProductsLoading ? (
              <p role="status" className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">Loading active Products...</p>
            ) : productLoadError ? (
              <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <p>{productLoadError}</p>
                <button type="button" onClick={onRetryProducts} className="mt-2 font-semibold underline underline-offset-2">Try again</button>
              </div>
            ) : (
              <select ref={firstControlRef} id="supplier-product" value={productId} onChange={(event) => { setProductId(event.target.value); setProductError(null); }} disabled={isSubmitting} aria-invalid={Boolean(productError)} aria-describedby={productError ? productErrorId : undefined} className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100">
                <option value="">Select a Product</option>
                {products.map((product) => <option key={product.productId} value={product.productId}>{product.serialNumber} — {product.productName}</option>)}
              </select>
            )}
            {productError && <p id={productErrorId} className="mt-2 text-sm text-red-600">{productError}</p>}
          </div>
          {submissionError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submissionError}</p>}
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={closeSafely} disabled={isSubmitting} className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
            <button ref={submitButtonRef} type="submit" disabled={isSubmitting || blocked} className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Saving..." : "Add Product"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
