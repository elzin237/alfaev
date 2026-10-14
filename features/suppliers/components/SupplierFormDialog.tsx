import { zodResolver } from "@hookform/resolvers/zod";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useForm } from "react-hook-form";

import type {
  SupplierMutationInput,
  SupplierUpdateResult,
} from "../services/supplierService";
import {
  supplierCreateSchema,
  type SupplierCreateFormInput,
  type SupplierCreateValues,
} from "../validation/supplierCreateSchema";

export interface SupplierFormDialogProps {
  open: boolean;
  mode: "create" | "edit";
  initialValues?: SupplierMutationInput;
  onClose: () => void;
  onSubmit: (input: SupplierCreateValues) => Promise<SupplierUpdateResult>;
  onSucceeded: () => void;
}

const emptyValues: SupplierCreateFormInput = {
  name: "",
  catalogNumber: "",
  description: "",
  country: "",
  contactPersonName: "",
  contactPhone: "",
  contactEmail: "",
};

function SupplierFormDialog({
  open,
  mode,
  initialValues,
  onClose,
  onSubmit,
  onSucceeded,
}: SupplierFormDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const nameErrorId = useId();
  const countryErrorId = useId();
  const catalogNumberErrorId = useId();
  const descriptionErrorId = useId();
  const emailErrorId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const submissionLockRef = useRef(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const formValues = useMemo<SupplierCreateFormInput>(() => ({
    name: initialValues?.name ?? "",
    catalogNumber: initialValues?.catalogNumber ?? "",
    description: initialValues?.description ?? "",
    country: initialValues?.country ?? "",
    contactPersonName: initialValues?.contactPersonName ?? "",
    contactPhone: initialValues?.contactPhone ?? "",
    contactEmail: initialValues?.contactEmail ?? "",
  }), [
    initialValues?.contactEmail,
    initialValues?.contactPersonName,
    initialValues?.contactPhone,
    initialValues?.country,
    initialValues?.catalogNumber,
    initialValues?.description,
    initialValues?.name,
  ]);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SupplierCreateFormInput, unknown, SupplierCreateValues>({
    resolver: zodResolver(supplierCreateSchema),
    defaultValues: formValues,
  });
  const nameRegistration = register("name");
  const isCreate = mode === "create";
  const title = isCreate ? "Add Supplier" : "Edit Supplier";
  const submitLabel = isCreate ? "Add Supplier" : "Save Changes";

  const closeSafely = useCallback(() => {
    if (submissionLockRef.current || isSubmitting) return;

    setSubmissionError(null);
    reset(formValues);
    onClose();
  }, [formValues, isSubmitting, onClose, reset]);

  useEffect(() => {
    if (!open) return;

    setSubmissionError(null);
    reset(formValues);
    queueMicrotask(() => nameInputRef.current?.focus());
  }, [formValues, open, reset]);

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
    if (submissionLockRef.current) return;

    submissionLockRef.current = true;
    setSubmissionError(null);

    try {
      const result = await onSubmit(input);
      if (!result.ok) {
        setSubmissionError(result.error.message);
        return;
      }

      reset(emptyValues);
      onSucceeded();
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
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl sm:p-8"
      >
        <h2 id={titleId} className="text-2xl font-bold text-zinc-900">
          {title}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-500">
          {isCreate
            ? "Add a Supplier, its Catalog Number, and optional details."
            : "Update this active Supplier's master data and contact details."}
        </p>

        <form
          className="mt-6 space-y-5"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="supplier-name" className="block text-sm font-semibold text-zinc-800">
                Supplier Name
              </label>
              <input
                {...nameRegistration}
                ref={(element) => {
                  nameRegistration.ref(element);
                  nameInputRef.current = element;
                }}
                id="supplier-name"
                type="text"
                autoComplete="organization"
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? nameErrorId : undefined}
                className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
              />
              {errors.name && <p id={nameErrorId} className="mt-2 text-sm text-red-600">{errors.name.message}</p>}
            </div>

            <div>
              <label htmlFor="supplier-catalog-number" className="block text-sm font-semibold text-zinc-800">
                Catalog Number
              </label>
              <input
                {...register("catalogNumber")}
                id="supplier-catalog-number"
                type="text"
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.catalogNumber)}
                aria-describedby={errors.catalogNumber ? catalogNumberErrorId : undefined}
                className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 font-mono text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
              />
              {errors.catalogNumber && <p id={catalogNumberErrorId} className="mt-2 text-sm text-red-600">{errors.catalogNumber.message}</p>}
            </div>

            <div>
              <label htmlFor="supplier-country" className="block text-sm font-semibold text-zinc-800">
                Country
              </label>
              <input
                {...register("country")}
                id="supplier-country"
                type="text"
                autoComplete="country-name"
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.country)}
                aria-describedby={errors.country ? countryErrorId : undefined}
                className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
              />
              {errors.country && <p id={countryErrorId} className="mt-2 text-sm text-red-600">{errors.country.message}</p>}
            </div>

            <div>
              <label htmlFor="supplier-contact-person" className="block text-sm font-semibold text-zinc-800">
                Contact Person
              </label>
              <input
                {...register("contactPersonName")}
                id="supplier-contact-person"
                type="text"
                autoComplete="name"
                disabled={isSubmitting}
                className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
              />
            </div>

            <div>
              <label htmlFor="supplier-phone" className="block text-sm font-semibold text-zinc-800">
                Phone
              </label>
              <input
                {...register("contactPhone")}
                id="supplier-phone"
                type="tel"
                autoComplete="tel"
                disabled={isSubmitting}
                className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
              />
            </div>
          </div>

          <div>
            <label htmlFor="supplier-description" className="block text-sm font-semibold text-zinc-800">
              Description <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <textarea
              {...register("description")}
              id="supplier-description"
              rows={3}
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? descriptionErrorId : undefined}
              className="mt-2 w-full resize-y rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
            />
            {errors.description && <p id={descriptionErrorId} className="mt-2 text-sm text-red-600">{errors.description.message}</p>}
          </div>

          <div>
            <label htmlFor="supplier-email" className="block text-sm font-semibold text-zinc-800">
              Email
            </label>
            <input
              {...register("contactEmail")}
              id="supplier-email"
              type="email"
              autoComplete="email"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.contactEmail)}
              aria-describedby={errors.contactEmail ? emailErrorId : undefined}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
            />
            {errors.contactEmail && <p id={emailErrorId} className="mt-2 text-sm text-red-600">{errors.contactEmail.message}</p>}
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
              disabled={isSubmitting}
              className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? `${submitLabel}…` : submitLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default SupplierFormDialog;
