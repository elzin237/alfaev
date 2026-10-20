import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { ChevronDown, ImagePlus, Plus } from "lucide-react";

import {
  postProjectActivity,
  PROJECT_ACTIVITY_IMAGE_MAX_BYTES,
  PROJECT_ACTIVITY_IMAGE_TYPES,
  uploadProjectActivityImage,
  type ProjectActivityPostSuccess,
} from "../services/projectActivityService";

type SubmissionStatus =
  | "idle"
  | "posting"
  | "post_retry_required"
  | "uploading_image"
  | "image_retry_required"
  | "completed";

interface LogicalSubmission {
  requestId: string;
  title: string;
  description: string;
  sendAlert: boolean;
  file: File | null;
  altText: string | null;
  posted: ProjectActivityPostSuccess | null;
}

interface ProjectActivityComposerProps {
  projectId: string;
  canSendAlert: boolean;
  visible?: boolean;
  onActivityChanged: (
    activityId: string,
    shouldScroll: boolean,
    alertSent: boolean,
  ) => Promise<unknown> | unknown;
  onCompleted: (sendAlert: boolean) => void;
  onProjectUnavailable?: () => Promise<unknown> | unknown;
}

interface FormErrors {
  title?: string;
  description?: string;
  image?: string;
  altText?: string;
}

function validateImage(file: File): string | null {
  if (!PROJECT_ACTIVITY_IMAGE_TYPES.includes(
    file.type as (typeof PROJECT_ACTIVITY_IMAGE_TYPES)[number],
  )) return "Select a JPEG, PNG, or WebP image.";
  if (file.size < 1 || file.size > PROJECT_ACTIVITY_IMAGE_MAX_BYTES) {
    return "Select an image up to 5 MiB.";
  }
  return null;
}

function ProjectActivityComposer({
  projectId,
  canSendAlert,
  visible = true,
  onActivityChanged,
  onCompleted,
  onProjectUnavailable,
}: ProjectActivityComposerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const imageId = useId();
  const altTextId = useId();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<SubmissionStatus>("idle");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<LogicalSubmission | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const expansionButtonRef = useRef<HTMLButtonElement>(null);
  const previousExpandedRef = useRef(false);
  const operationLockRef = useRef(false);
  const completedSubmissionRef = useRef(false);
  const mountedRef = useRef(true);

  const busy = status === "posting" || status === "uploading_image";
  const lockedForRetry = status === "post_retry_required" ||
    status === "image_retry_required";

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (status !== "image_retry_required") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);

  useEffect(() => {
    const wasExpanded = previousExpandedRef.current;
    previousExpandedRef.current = isExpanded;
    if (!wasExpanded && isExpanded) titleInputRef.current?.focus();
    if (wasExpanded && !isExpanded) expansionButtonRef.current?.focus();
  }, [isExpanded]);

  useEffect(() => {
    if (status === "completed" && !isExpanded) {
      operationLockRef.current = false;
      completedSubmissionRef.current = false;
    }
  }, [isExpanded, status]);

  function clearCompletedForm(sendAlert: boolean) {
    completedSubmissionRef.current = true;
    setTitle("");
    setDescription("");
    setFile(null);
    setAltText("");
    setAttempt(null);
    setErrors({});
    setOperationError(null);
    setFeedback(null);
    setStatus("completed");
    setIsExpanded(false);
    onCompleted(sendAlert);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function validateForm(): {
    title: string;
    description: string;
    altText: string | null;
  } | null {
    const normalizedTitle = title.trim();
    const normalizedDescription = description.trim();
    const normalizedAltText = altText.trim();
    const nextErrors: FormErrors = {};
    if (normalizedTitle.length < 1 || normalizedTitle.length > 120) {
      nextErrors.title = "Enter a title between 1 and 120 characters.";
    }
    if (normalizedDescription.length < 1 || normalizedDescription.length > 5000) {
      nextErrors.description = "Enter a description between 1 and 5000 characters.";
    }
    if (normalizedAltText.length > 500) {
      nextErrors.altText = "Image alt text must be 500 characters or fewer.";
    }
    if (file) {
      const imageError = validateImage(file);
      if (imageError) nextErrors.image = imageError;
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0
      ? {
          title: normalizedTitle,
          description: normalizedDescription,
          altText: normalizedAltText || null,
        }
      : null;
  }

  async function attachImage(submission: LogicalSubmission) {
    if (!submission.file || !submission.posted) return;
    if (mountedRef.current) {
      setStatus("uploading_image");
      setOperationError(null);
    }
    const result = await uploadProjectActivityImage({
      projectId,
      activityId: submission.posted.activityId,
      requestId: submission.requestId,
      file: submission.file,
      altText: submission.altText,
    });
    if (!mountedRef.current) return;
    if (!result.ok) {
      setAttempt(submission);
      setStatus("image_retry_required");
      setFeedback(
        submission.sendAlert
          ? "Alert sent. Image attachment failed."
          : "Update posted, but the image was not attached.",
      );
      setOperationError(result.error.message);
      return;
    }
    await onActivityChanged(submission.posted.activityId, false, false);
    if (!mountedRef.current) return;
    clearCompletedForm(submission.sendAlert);
  }

  async function post(submission: LogicalSubmission) {
    if (mountedRef.current) {
      setStatus("posting");
      setFeedback(null);
      setOperationError(null);
    }
    const result = await postProjectActivity({
      projectId,
      requestId: submission.requestId,
      title: submission.title,
      description: submission.description,
      sendAlert: submission.sendAlert,
    });
    if (!mountedRef.current) return;
    if (!result.ok) {
      setOperationError(result.error.message);
      if (result.error.code === "post_outcome_unknown") {
        setAttempt(submission);
        setStatus("post_retry_required");
      } else {
        setAttempt(null);
        setStatus("idle");
        if (result.error.code === "project_closed") {
          void onProjectUnavailable?.();
        }
      }
      return;
    }
    const postedSubmission = { ...submission, posted: result.value };
    setAttempt(postedSubmission);
    await onActivityChanged(
      result.value.activityId,
      true,
      result.value.alertSent,
    );
    if (!mountedRef.current) return;
    if (postedSubmission.file) {
      await attachImage(postedSubmission);
    } else {
      clearCompletedForm(postedSubmission.sendAlert);
    }
  }

  async function beginSubmission(sendAlert: boolean) {
    if (operationLockRef.current || busy || lockedForRetry) return;
    const normalized = validateForm();
    if (!normalized) return;
    operationLockRef.current = true;
    completedSubmissionRef.current = false;
    const submission: LogicalSubmission = {
      requestId: crypto.randomUUID(),
      title: normalized.title,
      description: normalized.description,
      sendAlert,
      file,
      altText: normalized.altText,
      posted: null,
    };
    setAttempt(submission);
    try {
      await post(submission);
    } finally {
      if (!completedSubmissionRef.current) operationLockRef.current = false;
    }
  }

  async function retryPost() {
    if (!attempt || attempt.posted || operationLockRef.current) return;
    operationLockRef.current = true;
    try {
      await post(attempt);
    } finally {
      if (!completedSubmissionRef.current) operationLockRef.current = false;
    }
  }

  async function retryImage() {
    if (!attempt?.posted || !attempt.file || operationLockRef.current) return;
    operationLockRef.current = true;
    try {
      await attachImage(attempt);
    } finally {
      if (!completedSubmissionRef.current) operationLockRef.current = false;
    }
  }

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFeedback(null);
    setOperationError(null);
    if (!selected) {
      setFile(null);
      setErrors((current) => ({ ...current, image: undefined }));
      return;
    }
    const imageError = validateImage(selected);
    if (imageError) {
      setFile(null);
      setErrors((current) => ({ ...current, image: imageError }));
      event.target.value = "";
      return;
    }
    setFile(selected);
    setErrors((current) => ({ ...current, image: undefined }));
  }

  if (!visible) return null;

  return (
    <form
      aria-label="Post Project Activity"
      onSubmit={(event) => {
        event.preventDefault();
        void beginSubmission(false);
      }}
      className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 sm:p-4"
    >
      <button
        ref={expansionButtonRef}
        type="button"
        aria-expanded={isExpanded}
        aria-controls={`${titleId}-composer-fields`}
        disabled={busy || lockedForRetry}
        onClick={() => setIsExpanded((expanded) => !expanded)}
        className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm font-medium text-zinc-600 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
          <Plus aria-hidden="true" size={17} strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1">Share an update or report an issue...</span>
        <ChevronDown
          aria-hidden="true"
          size={18}
          className={`shrink-0 text-zinc-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
        />
      </button>

      {feedback && (
        <p role="status" aria-live="polite" className={`mt-3 rounded-xl px-4 py-3 text-sm font-medium ${status === "image_retry_required" ? "border border-amber-200 bg-amber-50 text-amber-900" : "border border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {feedback}
        </p>
      )}
      {(status === "posting" || status === "uploading_image") && (
        <p role="status" aria-live="polite" className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
          {status === "posting" ? "Posting update..." : "Uploading image..."}
        </p>
      )}

      {isExpanded && (
        <div id={`${titleId}-composer-fields`} className="mt-4 grid gap-4 border-t border-zinc-200 pt-4">
        <div>
          <label htmlFor={titleId} className="text-sm font-semibold text-zinc-800">
            Title
          </label>
          <input
            ref={titleInputRef}
            id={titleId}
            value={title}
            maxLength={120}
            disabled={busy || lockedForRetry}
            onChange={(event) => {
              setTitle(event.target.value);
              setErrors((current) => ({ ...current, title: undefined }));
              setFeedback(null);
              if (status === "completed") setStatus("idle");
            }}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? `${titleId}-error` : undefined}
            className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:bg-zinc-100"
          />
          <div className="mt-1 flex justify-between gap-3 text-xs text-zinc-500">
            {errors.title
              ? <span id={`${titleId}-error`} className="text-red-700">{errors.title}</span>
              : <span />}
            <span>{title.length}/120</span>
          </div>
        </div>

        <div>
          <label htmlFor={descriptionId} className="text-sm font-semibold text-zinc-800">
            Description
          </label>
          <textarea
            id={descriptionId}
            value={description}
            maxLength={5000}
            rows={4}
            disabled={busy || lockedForRetry}
            onChange={(event) => {
              setDescription(event.target.value);
              setErrors((current) => ({ ...current, description: undefined }));
              setFeedback(null);
              if (status === "completed") setStatus("idle");
            }}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description
              ? `${descriptionId}-error`
              : undefined}
            className="mt-2 w-full resize-y rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm leading-6 text-zinc-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:bg-zinc-100"
          />
          <div className="mt-1 flex justify-between gap-3 text-xs text-zinc-500">
            {errors.description
              ? <span id={`${descriptionId}-error`} className="text-red-700">{errors.description}</span>
              : <span />}
            <span>{description.length}/5000</span>
          </div>
        </div>

        <div>
          <label htmlFor={imageId} className="sr-only">Activity image</label>
          <input
            ref={fileInputRef}
            id={imageId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy || lockedForRetry || Boolean(file)}
            onChange={selectImage}
            aria-describedby={`${imageId}-help${errors.image ? ` ${imageId}-error` : ""}`}
            className="sr-only"
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              disabled={busy || lockedForRetry || Boolean(file)}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ImagePlus aria-hidden="true" size={18} />
              Add image
            </button>
            <p id={`${imageId}-help`} className="text-xs text-zinc-500">
              JPEG, PNG or WebP · Max 5 MiB
            </p>
          </div>
          {errors.image && (
            <p id={`${imageId}-error`} role="alert" className="mt-1 text-xs text-red-700">
              {errors.image}
            </p>
          )}
        </div>

        {file && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-3">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="Selected Activity preview"
                  className="h-20 w-28 rounded-xl bg-zinc-100 object-contain"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-900">{file.name}</p>
                <label htmlFor={altTextId} className="mt-3 block text-sm font-semibold text-zinc-800">
                  Image alt text <span className="font-normal text-zinc-500">(optional)</span>
                </label>
                <input
                  id={altTextId}
                  value={altText}
                  maxLength={500}
                  disabled={busy || lockedForRetry}
                  placeholder="Uses the Activity title when blank"
                  onChange={(event) => {
                    setAltText(event.target.value);
                    setErrors((current) => ({ ...current, altText: undefined }));
                  }}
                  className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:bg-zinc-100"
                />
                {errors.altText && (
                  <p role="alert" className="mt-1 text-xs text-red-700">{errors.altText}</p>
                )}
                {!lockedForRetry && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setFile(null);
                      setAltText("");
                      setErrors((current) => ({ ...current, image: undefined, altText: undefined }));
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="mt-3 text-sm font-semibold text-red-700 underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-60"
                  >
                    Remove selected image
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {operationError && (
          <p role="alert" aria-live="assertive" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {operationError}
          </p>
        )}

        {status === "post_retry_required" ? (
          <div>
            <button
              type="button"
              onClick={() => void retryPost()}
              className="rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              Retry same update
            </button>
            <p className="mt-2 text-xs text-zinc-600">
              This retry keeps the original request identity to prevent duplicate Activity or alerts.
            </p>
          </div>
        ) : status === "image_retry_required" ? (
          <div>
            <button
              type="button"
              onClick={() => void retryImage()}
              className="rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              Retry image upload
            </button>
            <p className="mt-2 text-xs text-zinc-600">
              The update is already posted. This page cannot recover the selected image after a reload.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "posting" ? "Posting…" : "Post update"}
              </button>
              {canSendAlert && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void beginSubmission(true)}
                  className="rounded-xl border border-amber-400 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Post &amp; send alert
                </button>
              )}
            </div>
            {canSendAlert && (
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Sends this update to users assigned to receive Project alerts.
              </p>
            )}
          </div>
        )}
        </div>
      )}
    </form>
  );
}

export default ProjectActivityComposer;
