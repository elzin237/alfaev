import { useEffect, useId, useRef, useState } from "react";

import type { CalendarMutationResult } from "./calendarService";
import {
  calendarCategoryLabels,
  type CalendarEmployeeChoice,
  type CalendarEntry,
  type CalendarEntryInput,
  type CalendarEntryType,
} from "./calendarTypes";
import { parseDateOnly } from "./calendarDate";

const editableTypes: CalendarEntryType[] = ["business_trip", "event", "vacation"];

interface CalendarEntryFormDialogProps {
  open: boolean;
  entry: CalendarEntry | null;
  employees: readonly CalendarEmployeeChoice[];
  employeesLoading: boolean;
  employeesError: string | null;
  onClose: () => void;
  onSubmit: (input: CalendarEntryInput) => Promise<CalendarMutationResult>;
  onSuccess: () => void;
}

interface CalendarEntryFormState {
  entryType: CalendarEntryType;
  title: string;
  startDate: string;
  endDate: string;
  description: string;
  relatedUserId: string;
}

function formState(entry: CalendarEntry | null): CalendarEntryFormState {
  return {
    entryType: entry?.entryType ?? "event",
    title: entry?.title ?? "",
    startDate: entry?.startDate ?? "",
    endDate: entry?.endDate ?? "",
    description: entry?.description ?? "",
    relatedUserId: entry?.relatedUserId ?? "",
  };
}

function CalendarEntryFormDialog({
  open,
  entry,
  employees,
  employeesLoading,
  employeesError,
  onClose,
  onSubmit,
  onSuccess,
}: CalendarEntryFormDialogProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const [values, setValues] = useState<CalendarEntryFormState>(() => formState(entry));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(formState(entry));
    setFieldError(null);
    setSubmissionError(null);
    queueMicrotask(() => titleRef.current?.focus());
  }, [entry, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingRef.current) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const update = <Key extends keyof CalendarEntryFormState>(
    key: Key,
    value: CalendarEntryFormState[Key],
  ) => setValues((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    const title = values.title.trim();
    const description = values.description.trim();
    if (!title || parseDateOnly(values.startDate) === null ||
      parseDateOnly(values.endDate) === null || values.endDate < values.startDate) {
      setFieldError("Enter a title and a valid date range.");
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setFieldError(null);
    setSubmissionError(null);
    try {
      const result = await onSubmit({
        entryType: values.entryType,
        title,
        startDate: values.startDate,
        endDate: values.endDate,
        description: description || null,
        relatedUserId: values.relatedUserId || null,
      });
      if (!result.ok) {
        setSubmissionError(result.error.message);
        return;
      }
      onSuccess();
      onClose();
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const controlClass = "mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={isSubmitting}
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-xl font-bold text-zinc-900">
          {entry ? "Edit Calendar Entry" : "Add Calendar Entry"}
        </h2>
        <form noValidate onSubmit={(event) => void submit(event)} className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-zinc-700">
            Category
            <select
              value={values.entryType}
              onChange={(event) => update("entryType", event.target.value as CalendarEntryType)}
              className={controlClass}
            >
              {editableTypes.map((type) => (
                <option key={type} value={type}>{calendarCategoryLabels[type]}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-zinc-700">
            Title
            <input
              ref={titleRef}
              value={values.title}
              onChange={(event) => update("title", event.target.value)}
              className={controlClass}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-zinc-700">
              Start Date
              <input type="date" value={values.startDate}
                onChange={(event) => update("startDate", event.target.value)} className={controlClass} />
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              End Date
              <input type="date" value={values.endDate}
                onChange={(event) => update("endDate", event.target.value)} className={controlClass} />
            </label>
          </div>
          <label className="block text-sm font-medium text-zinc-700">
            Description <span className="font-normal text-zinc-500">(optional)</span>
            <textarea value={values.description}
              onChange={(event) => update("description", event.target.value)} rows={4} className={controlClass} />
          </label>
          <label className="block text-sm font-medium text-zinc-700">
            Related employee <span className="font-normal text-zinc-500">(optional)</span>
            <select value={values.relatedUserId}
              onChange={(event) => update("relatedUserId", event.target.value)}
              disabled={employeesLoading} className={controlClass}>
              <option value="">None</option>
              {employees.map((employee) => (
                <option key={employee.userId} value={employee.userId}>{employee.fullName}</option>
              ))}
            </select>
          </label>
          {employeesLoading && <p role="status" className="text-sm text-zinc-500">Loading employees...</p>}
          {employeesError && <p role="alert" className="text-sm text-red-700">{employeesError}</p>}
          {fieldError && <p role="alert" className="text-sm text-red-700">{fieldError}</p>}
          {submissionError && <p role="alert" className="text-sm text-red-700">{submissionError}</p>}
          <div className="flex justify-end gap-3 pt-3">
            <button type="button" disabled={isSubmitting} onClick={onClose}
              className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-60">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {isSubmitting ? "Saving…" : "Save Calendar Entry"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default CalendarEntryFormDialog;
