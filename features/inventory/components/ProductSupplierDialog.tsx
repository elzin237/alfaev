import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import type {
  ProductSupplierChoice,
  ProductSupplierMutationResult,
} from "../services/productSupplierService";

interface SharedDialogProps {
  open: boolean;
  onClose: () => void;
  onSucceeded: () => void;
}

interface AddDialogProps extends SharedDialogProps {
  mode: "add";
  suppliers: ProductSupplierChoice[];
  isSuppliersLoading: boolean;
  supplierLoadError: string | null;
  onRetrySuppliers: () => void;
  onSubmit: (input: {
    supplierId: string;
    catalogNumber: string | null;
  }) => Promise<ProductSupplierMutationResult>;
}

interface EditDialogProps extends SharedDialogProps {
  mode: "edit";
  supplierName: string;
  initialCatalogNumber: string | null;
  onSubmit: (input: {
    catalogNumber: string | null;
  }) => Promise<ProductSupplierMutationResult>;
}

export type ProductSupplierDialogProps = AddDialogProps | EditDialogProps;

function ProductSupplierDialog(props: ProductSupplierDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const supplierErrorId = useId();
  const firstControlRef = useRef<HTMLSelectElement | HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const submissionLockRef = useRef(false);
  const [supplierId, setSupplierId] = useState("");
  const [catalogNumber, setCatalogNumber] = useState("");
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const title = props.mode === "add" ? "Add Supplier Link" : "Edit Catalog Number";
  const initialCatalogNumber = props.mode === "edit"
    ? props.initialCatalogNumber
    : null;
  const onClose = props.onClose;

  const resetForm = useCallback(() => {
    setSupplierId("");
    setCatalogNumber(initialCatalogNumber ?? "");
    setSupplierError(null);
    setSubmissionError(null);
  }, [initialCatalogNumber]);

  const closeSafely = useCallback(() => {
    if (submissionLockRef.current) return;
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  useEffect(() => {
    if (!props.open) return;

    resetForm();
    queueMicrotask(() => firstControlRef.current?.focus());
  }, [props.open, resetForm]);

  useEffect(() => {
    if (!props.open) return;

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
  }, [closeSafely, props.open]);

  if (!props.open) return null;

  const activeSuppliers = props.mode === "add" ? props.suppliers : [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionLockRef.current) return;

    if (props.mode === "add" && !supplierId) {
      setSupplierError("Select a Supplier.");
      return;
    }

    submissionLockRef.current = true;
    setIsSubmitting(true);
    setSupplierError(null);
    setSubmissionError(null);

    try {
      const normalizedCatalogNumber = catalogNumber.trim() || null;
      const result = props.mode === "add"
        ? await props.onSubmit({ supplierId, catalogNumber: normalizedCatalogNumber })
        : await props.onSubmit({ catalogNumber: normalizedCatalogNumber });

      if (!result.ok) {
        setSubmissionError(result.error.message);
        return;
      }

      resetForm();
      props.onSucceeded();
      props.onClose();
    } finally {
      submissionLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  const addIsBlocked = props.mode === "add" &&
    (props.isSuppliersLoading || Boolean(props.supplierLoadError));

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
          {title}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-500">
          {props.mode === "add"
            ? "Link an active Supplier to this Product."
            : `Update the Supplier Catalog Number for ${props.supplierName}.`}
        </p>

        <form className="mt-6 space-y-5" noValidate onSubmit={(event) => void submit(event)}>
          {props.mode === "add" && (
            <div>
              <label htmlFor="product-supplier" className="block text-sm font-semibold text-zinc-800">
                Supplier
              </label>
              {props.isSuppliersLoading ? (
                <p role="status" className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                  Loading active Suppliers...
                </p>
              ) : props.supplierLoadError ? (
                <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <p>{props.supplierLoadError}</p>
                  <button type="button" onClick={props.onRetrySuppliers} className="mt-2 font-semibold underline underline-offset-2">
                    Try again
                  </button>
                </div>
              ) : (
                <select
                  ref={firstControlRef as RefObject<HTMLSelectElement>}
                  id="product-supplier"
                  value={supplierId}
                  onChange={(event) => {
                    setSupplierId(event.target.value);
                    setSupplierError(null);
                  }}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(supplierError)}
                  aria-describedby={supplierError ? supplierErrorId : undefined}
                  className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
                >
                  <option value="">Select a Supplier</option>
                  {activeSuppliers.map((supplier) => (
                    <option key={supplier.supplierId} value={supplier.supplierId}>
                      {supplier.supplierName}
                    </option>
                  ))}
                </select>
              )}
              {supplierError && (
                <p id={supplierErrorId} className="mt-2 text-sm text-red-600">
                  {supplierError}
                </p>
              )}
            </div>
          )}

          <div>
            <label htmlFor="product-supplier-catalog-number" className="block text-sm font-semibold text-zinc-800">
              Catalog Number <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <input
              ref={props.mode === "edit"
                ? firstControlRef as RefObject<HTMLInputElement>
                : undefined}
              id="product-supplier-catalog-number"
              type="text"
              value={catalogNumber}
              onChange={(event) => setCatalogNumber(event.target.value)}
              disabled={isSubmitting}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
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
              disabled={isSubmitting || addIsBlocked}
              className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting
                ? "Saving..."
                : props.mode === "add" ? "Add Supplier" : "Save Changes"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default ProductSupplierDialog;
