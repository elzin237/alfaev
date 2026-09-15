import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import {
  projectEditableStatusOptions,
  type ProjectStatus,
} from "../projectStatus";
import type {
  ProjectUpdateInput,
  ProjectUpdateResult,
} from "../services/projectService";
import {
  projectEditSchema,
  type ProjectEditFormInput,
  type ProjectEditValues,
} from "../validation/projectEditSchema";

export interface ProjectEditDialogProps {
  open: boolean;
  currentStatus: ProjectStatus;
  initialValues: ProjectUpdateInput;
  onClose: () => void;
  onSubmit: (input: ProjectUpdateInput) => Promise<ProjectUpdateResult>;
  onSucceeded: () => void;
}

function ProjectEditDialog({
  open,
  currentStatus,
  initialValues,
  onClose,
  onSubmit,
  onSucceeded,
}: ProjectEditDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const nameErrorId = useId();
  const customerErrorId = useId();
  const startDateErrorId = useId();
  const deliveryDateErrorId = useId();
  const statusErrorId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const submissionLockRef = useRef(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const formValues = useMemo<ProjectEditFormInput>(() => ({
    ...initialValues,
  }), [initialValues]);
  const statusOptions = projectEditableStatusOptions;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProjectEditFormInput, unknown, ProjectEditValues>({
    resolver: zodResolver(projectEditSchema),
    defaultValues: formValues,
  });
  const nameRegistration = register("name");

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
      reset(formValues);
      onSucceeded();
      onClose();
    } finally {
      submissionLockRef.current = false;
    }
  });

  if (!open || currentStatus === "completed" || currentStatus === "cancelled") {
    return null;
  }

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
        <h2 id={titleId} className="text-2xl font-bold text-zinc-900">Edit Project</h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-500">
          Update Project details and its normal lifecycle status.
        </p>

        <form className="mt-6 space-y-5" noValidate onSubmit={(event) => void submit(event)}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="project-edit-name" className="block text-sm font-semibold text-zinc-800">Project Name</label>
              <input
                {...nameRegistration}
                ref={(element) => {
                  nameRegistration.ref(element);
                  nameInputRef.current = element;
                }}
                id="project-edit-name"
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? nameErrorId : undefined}
                className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:bg-zinc-100"
              />
              {errors.name && <p id={nameErrorId} className="mt-2 text-sm text-red-600">{errors.name.message}</p>}
            </div>
            <div>
              <label htmlFor="project-edit-customer" className="block text-sm font-semibold text-zinc-800">Customer</label>
              <input
                {...register("customerName")}
                id="project-edit-customer"
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.customerName)}
                aria-describedby={errors.customerName ? customerErrorId : undefined}
                className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:bg-zinc-100"
              />
              {errors.customerName && <p id={customerErrorId} className="mt-2 text-sm text-red-600">{errors.customerName.message}</p>}
            </div>
            <div>
              <label htmlFor="project-edit-start-date" className="block text-sm font-semibold text-zinc-800">Start Date</label>
              <input
                {...register("startDate")}
                id="project-edit-start-date"
                type="date"
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.startDate)}
                aria-describedby={errors.startDate ? startDateErrorId : undefined}
                className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:bg-zinc-100"
              />
              {errors.startDate && <p id={startDateErrorId} className="mt-2 text-sm text-red-600">{errors.startDate.message}</p>}
            </div>
            <div>
              <label htmlFor="project-edit-delivery-date" className="block text-sm font-semibold text-zinc-800">Delivery Date</label>
              <input
                {...register("deliveryDate")}
                id="project-edit-delivery-date"
                type="date"
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.deliveryDate)}
                aria-describedby={errors.deliveryDate ? deliveryDateErrorId : undefined}
                className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:bg-zinc-100"
              />
              {errors.deliveryDate && <p id={deliveryDateErrorId} className="mt-2 text-sm text-red-600">{errors.deliveryDate.message}</p>}
            </div>
          </div>
          <div>
            <label htmlFor="project-edit-status" className="block text-sm font-semibold text-zinc-800">Status</label>
            <select
              {...register("status")}
              id="project-edit-status"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.status)}
              aria-describedby={errors.status ? statusErrorId : undefined}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:bg-zinc-100"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {errors.status && <p id={statusErrorId} className="mt-2 text-sm text-red-600">{errors.status.message}</p>}
          </div>

          {submissionError && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submissionError}</p>
          )}

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={closeSafely} disabled={isSubmitting} className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60">Cancel</button>
            <button ref={submitButtonRef} type="submit" disabled={isSubmitting} className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60">
              {isSubmitting ? "Saving Changes…" : "Save Changes"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default ProjectEditDialog;
