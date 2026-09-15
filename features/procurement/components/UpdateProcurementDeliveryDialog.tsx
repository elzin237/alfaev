import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import type {
  ProcurementDeliveryUpdateResult,
  ProcurementRequestListItem,
  UpdateProcurementDeliveredQuantityInput,
} from "../services/procurementService";
import {
  createProcurementDeliverySchema,
  type ProcurementDeliveryFormInput,
  type ProcurementDeliveryFormOutput,
} from "../validation/procurementDeliverySchema";

interface UpdateProcurementDeliveryDialogProps {
  request: ProcurementRequestListItem | null;
  onClose: () => void;
  onSubmit: (
    input: UpdateProcurementDeliveredQuantityInput,
  ) => Promise<ProcurementDeliveryUpdateResult>;
  onUpdated: () => void;
}

function previewRemaining(value: string, requestedQuantity: number) {
  const normalized = value.trim();
  if (!/^[0-9]+$/.test(normalized)) return null;

  const deliveredQuantity = Number(normalized);
  if (!Number.isSafeInteger(deliveredQuantity) ||
    deliveredQuantity > requestedQuantity) {
    return null;
  }

  return requestedQuantity - deliveredQuantity;
}

function UpdateProcurementDeliveryDialog({
  request,
  onClose,
  onSubmit,
  onUpdated,
}: UpdateProcurementDeliveryDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const submissionLockRef = useRef(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const requestedQuantity = request?.requestedQuantity ?? 0;
  const schema = useMemo(
    () => createProcurementDeliverySchema(requestedQuantity),
    [requestedQuantity],
  );
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<
    ProcurementDeliveryFormInput,
    unknown,
    ProcurementDeliveryFormOutput
  >({
    resolver: zodResolver(schema),
    defaultValues: { deliveredQuantity: "" },
  });
  const deliveredRegistration = register("deliveredQuantity");
  const deliveredInput = watch("deliveredQuantity");
  const remainingPreview = previewRemaining(
    deliveredInput,
    requestedQuantity,
  );

  const closeSafely = useCallback(() => {
    if (submissionLockRef.current || isSubmitting) return;
    setSubmissionError(null);
    reset({ deliveredQuantity: "" });
    onClose();
  }, [isSubmitting, onClose, reset]);

  useEffect(() => {
    if (!request) return;

    setSubmissionError(null);
    reset({ deliveredQuantity: String(request.deliveredQuantity) });
    queueMicrotask(() => inputRef.current?.focus());
  }, [request, reset]);

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

      if (event.shiftKey && document.activeElement === inputRef.current) {
        event.preventDefault();
        submitRef.current?.focus();
      } else if (!event.shiftKey && document.activeElement === submitRef.current) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeSafely, isSubmitting, request]);

  const submit = handleSubmit(async ({ deliveredQuantity }) => {
    if (!request || submissionLockRef.current) return;

    submissionLockRef.current = true;
    setSubmissionError(null);
    try {
      const result = await onSubmit({
        requestId: request.requestId,
        deliveredQuantity,
      });
      if (!result.ok) {
        setSubmissionError(result.error.message);
        return;
      }

      reset({ deliveredQuantity: "" });
      onUpdated();
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
        className="w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl sm:p-8"
      >
        <h2 id={titleId} className="text-2xl font-bold text-zinc-900">
          Update Delivery
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-500">
          Enter the total delivered so far, not the quantity received now.
          Status is updated by AlfaEV and full delivery does not resolve the request.
        </p>

        <dl className="mt-6 grid grid-cols-3 gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-center">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Requested
            </dt>
            <dd className="mt-2 text-lg font-bold text-zinc-900">
              {request.requestedQuantity}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Current Delivered
            </dt>
            <dd className="mt-2 text-lg font-bold text-zinc-900">
              {request.deliveredQuantity}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Current Remaining
            </dt>
            <dd className="mt-2 text-lg font-bold text-zinc-900">
              {request.remainingQuantity}
            </dd>
          </div>
        </dl>

        <form
          className="mt-6 space-y-5"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <div>
            <label
              htmlFor="procurement-delivered-so-far"
              className="block text-sm font-semibold text-zinc-800"
            >
              Delivered So Far
            </label>
            <input
              {...deliveredRegistration}
              ref={(element) => {
                deliveredRegistration.ref(element);
                inputRef.current = element;
              }}
              id="procurement-delivered-so-far"
              type="number"
              min="0"
              max={request.requestedQuantity}
              step="1"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.deliveredQuantity)}
              aria-describedby={errors.deliveredQuantity ? errorId : undefined}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
            />
            {errors.deliveredQuantity && (
              <p id={errorId} className="mt-2 text-sm text-red-600">
                {errors.deliveredQuantity.message}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
            <span className="text-sm font-medium text-zinc-600">
              Remaining after update
            </span>
            <strong className="float-right text-zinc-900">
              {remainingPreview ?? "—"}
            </strong>
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
              ref={submitRef}
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Updating…" : "Save Delivery"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default UpdateProcurementDeliveryDialog;
