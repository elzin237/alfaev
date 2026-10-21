import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type {
  ProjectActivityItem,
  ProjectIssueResolutionInput,
  ProjectIssueResolutionResult,
  ProjectIssueResolutionSuccess,
} from "../services/projectActivityService";
import {
  PROJECT_ACTIVITY_IMAGE_MAX_BYTES,
  PROJECT_ACTIVITY_IMAGE_TYPES,
  uploadProjectIssueResolutionImage,
} from "../services/projectActivityService";

interface ProjectIssueResolutionDialogProps {
  issue: ProjectActivityItem;
  open: boolean;
  onCancel: () => void;
  onResolve: (
    input: ProjectIssueResolutionInput,
  ) => Promise<ProjectIssueResolutionResult>;
  onImageAttached?: (activityId: string) => Promise<unknown> | unknown;
}

export function ProjectIssueResolutionDialog({
  issue,
  open,
  onCancel,
  onResolve,
  onImageAttached,
}: ProjectIssueResolutionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef<{ requestId: string; description: string } | null>(null);
  const [description, setDescription] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [committedResolution, setCommittedResolution] = useState<
    ProjectIssueResolutionSuccess | undefined
  >();
  const [phase, setPhase] = useState<"resolving" | "uploading" | null>(null);

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  function close() {
    if (isSubmitting) return;
    setDescription("");
    setValidationError(null);
    setOperationError(null);
    setImageFile(null);
    setCommittedResolution(undefined);
    setPhase(null);
    requestRef.current = null;
    onCancel();
  }

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    textareaRef.current?.focus();
    return () => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
      returnFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!isSubmitting) {
          event.preventDefault();
          close();
        }
        return;
      }
      if (event.key !== "Tab") return;
      if (isSubmitting) {
        event.preventDefault();
        return;
      }
      const first = committedResolution ? cancelRef.current : textareaRef.current;
      const last = confirmRef.current;
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [committedResolution, isSubmitting, open]);

  async function uploadImage(
    resolution: NonNullable<typeof committedResolution>,
  ) {
    if (!imageFile) return true;
    setPhase("uploading");
    const upload = await uploadProjectIssueResolutionImage({
      projectId: issue.projectId,
      activityId: issue.activityId,
      resolutionId: resolution.resolutionId,
      requestId: resolution.requestId,
      file: imageFile,
      altText: `Resolution evidence for ${issue.title}`,
    });
    if (!upload.ok) {
      setOperationError(
        `The Issue is resolved, but its image was not attached. ${upload.error.message}`,
      );
      setPhase(null);
      return false;
    }
    await onImageAttached?.(issue.activityId);
    return true;
  }

  async function submit() {
    if (isSubmitting) return;
    if (committedResolution) {
      setIsSubmitting(true);
      setOperationError(null);
      const uploaded = await uploadImage(committedResolution);
      setIsSubmitting(false);
      if (uploaded) closeAfterSuccess();
      return;
    }
    const normalized = description.trim();
    if (normalized.length < 1 || normalized.length > 5000) {
      setValidationError(
        "Enter a resolution description between 1 and 5000 characters.",
      );
      textareaRef.current?.focus();
      return;
    }
    setValidationError(null);
    setOperationError(null);
    const existingRequest = requestRef.current;
    const request = existingRequest?.description === normalized
      ? existingRequest
      : { requestId: crypto.randomUUID(), description: normalized };
    requestRef.current = request;
    setIsSubmitting(true);
    setPhase("resolving");
    const result = await onResolve({
      activityId: issue.activityId,
      requestId: request.requestId,
      description: normalized,
    });
    if (result.ok) {
      setCommittedResolution(result.value);
      if (imageFile) {
        const uploaded = await uploadImage(result.value);
        setIsSubmitting(false);
        if (uploaded) closeAfterSuccess();
      } else {
        setIsSubmitting(false);
        closeAfterSuccess();
      }
      return;
    }
    setIsSubmitting(false);
    setPhase(null);
    setOperationError(result.error.message);
  }

  function closeAfterSuccess() {
    setDescription("");
    setValidationError(null);
    setOperationError(null);
    setImageFile(null);
    setCommittedResolution(undefined);
    setPhase(null);
    requestRef.current = null;
    onCancel();
  }

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/40 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId}${validationError || operationError ? ` ${errorId}` : ""}`}
        aria-busy={isSubmitting}
        className="w-full max-w-xl rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl sm:p-8"
      >
        <h2 id={titleId} className="text-xl font-bold text-zinc-900">
          Resolve issue
        </h2>
        <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-700">
            Issue
          </p>
          <p className="mt-1 break-words font-semibold text-zinc-900">
            {issue.title}
          </p>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-600">
            {issue.description}
          </p>
        </div>

        <label htmlFor={descriptionId} className="mt-5 block text-sm font-semibold text-zinc-800">
          Resolution description
        </label>
        <textarea
          ref={textareaRef}
          id={descriptionId}
          value={description}
          maxLength={5000}
          rows={5}
          disabled={isSubmitting || Boolean(committedResolution)}
          aria-invalid={Boolean(validationError)}
          onChange={(event) => {
            setDescription(event.target.value);
            setValidationError(null);
            setOperationError(null);
          }}
          className="mt-2 w-full resize-y rounded-xl border border-zinc-300 px-4 py-3 text-sm leading-6 text-zinc-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:bg-zinc-100"
        />
        <div className="mt-1 flex justify-between gap-3 text-xs text-zinc-500">
          <span>{description.length}/5000</span>
        </div>

        <div className="mt-5">
          <label htmlFor={`${descriptionId}-image`} className="block text-sm font-semibold text-zinc-800">
            Resolution image <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <input
            ref={fileRef}
            id={`${descriptionId}-image`}
            type="file"
            accept={PROJECT_ACTIVITY_IMAGE_TYPES.join(",")}
            disabled={isSubmitting || Boolean(committedResolution)}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              if (file && (!PROJECT_ACTIVITY_IMAGE_TYPES.includes(
                file.type as (typeof PROJECT_ACTIVITY_IMAGE_TYPES)[number],
              ) || file.size < 1 || file.size > PROJECT_ACTIVITY_IMAGE_MAX_BYTES)) {
                setImageFile(null);
                event.target.value = "";
                setValidationError("Select one JPEG, PNG, or WebP image up to 5 MiB.");
                return;
              }
              setImageFile(file);
              setValidationError(null);
              setOperationError(null);
            }}
            className="mt-2 block w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:font-semibold file:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:bg-zinc-100"
          />
          <p className="mt-1 text-xs text-zinc-500">One JPEG, PNG, or WebP image, up to 5 MiB.</p>
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Resolution evidence preview"
              className="mt-3 max-h-44 max-w-full rounded-xl border border-zinc-200 object-contain"
            />
          )}
        </div>

        {(validationError || operationError) && (
          <p id={errorId} role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {validationError ?? operationError}
          </p>
        )}

        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            disabled={isSubmitting}
            onClick={close}
            className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={isSubmitting}
            onClick={() => void submit()}
            className="rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {phase === "uploading"
              ? "Uploading image…"
              : phase === "resolving"
              ? "Resolving issue…"
              : committedResolution
              ? "Try image again"
              : "Resolve issue"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default ProjectIssueResolutionDialog;
