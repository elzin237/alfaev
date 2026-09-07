import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { inviteUserAdmin } from "../services/userInviteService";
import {
  userInviteSchema,
  type UserInviteFormInput,
  type UserInviteInput,
} from "../validation/userInviteSchema";

export interface CreateUserDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const defaultValues: UserInviteFormInput = {
  fullName: "",
  email: "",
  birthday: "",
  isAdmin: false,
};

function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: CreateUserDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const fullNameErrorId = useId();
  const emailErrorId = useId();
  const birthdayErrorId = useId();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const submissionLockRef = useRef(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<UserInviteFormInput, unknown, UserInviteInput>({
    resolver: zodResolver(userInviteSchema),
    defaultValues,
  });
  const fullNameRegistration = register("fullName");
  const isAdmin = watch("isAdmin");

  const closeSafely = useCallback(() => {
    if (submissionLockRef.current || isSubmitting) {
      return;
    }

    setSubmissionError(null);
    reset(defaultValues);
    onClose();
  }, [isSubmitting, onClose, reset]);

  useEffect(() => {
    if (open) {
      firstInputRef.current?.focus();
      return;
    }

    setSubmissionError(null);
    reset(defaultValues);
  }, [open, reset]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSafely();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      if (submissionLockRef.current || isSubmitting) {
        event.preventDefault();
        return;
      }

      const firstControl = firstInputRef.current;
      const lastControl = submitButtonRef.current;

      if (!firstControl || !lastControl) {
        return;
      }

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
    if (submissionLockRef.current) {
      return;
    }

    submissionLockRef.current = true;
    setSubmissionError(null);

    try {
      const result = await inviteUserAdmin(input);

      if (!result.ok) {
        setSubmissionError(result.error.message);
        return;
      }

      reset(defaultValues);
      onCreated();
      onClose();
    } finally {
      submissionLockRef.current = false;
    }
  });

  if (!open) {
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
        className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl sm:p-8"
      >
        <h2 id={titleId} className="text-2xl font-bold text-zinc-900">
          Create User
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-500">
          Send an AlfaEV invitation and create the employee profile.
        </p>

        <form
          className="mt-6 space-y-5"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <div>
            <label
              htmlFor="create-user-full-name"
              className="block text-sm font-semibold text-zinc-800"
            >
              Full Name
            </label>
            <input
              {...fullNameRegistration}
              ref={(element) => {
                fullNameRegistration.ref(element);
                firstInputRef.current = element;
              }}
              id="create-user-full-name"
              type="text"
              autoComplete="name"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.fullName)}
              aria-describedby={errors.fullName ? fullNameErrorId : undefined}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
            />
            {errors.fullName && (
              <p id={fullNameErrorId} className="mt-2 text-sm text-red-600">
                {errors.fullName.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="create-user-email"
              className="block text-sm font-semibold text-zinc-800"
            >
              Email
            </label>
            <input
              {...register("email")}
              id="create-user-email"
              type="email"
              autoComplete="email"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? emailErrorId : undefined}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
            />
            {errors.email && (
              <p id={emailErrorId} className="mt-2 text-sm text-red-600">
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="create-user-birthday"
              className="block text-sm font-semibold text-zinc-800"
            >
              Birthday
            </label>
            <input
              {...register("birthday")}
              id="create-user-birthday"
              type="date"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.birthday)}
              aria-describedby={errors.birthday ? birthdayErrorId : undefined}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
            />
            {errors.birthday && (
              <p id={birthdayErrorId} className="mt-2 text-sm text-red-600">
                {errors.birthday.message}
              </p>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
            <input
              {...register("isAdmin")}
              type="checkbox"
              aria-label="Admin account"
              disabled={isSubmitting}
              className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400 disabled:cursor-not-allowed"
            />
            <span>
              <span className="block text-sm font-semibold text-zinc-900">
                Admin account
              </span>
              <span className="mt-1 block text-sm leading-5 text-zinc-500">
                {isAdmin
                  ? "Admin — full AlfaEV access."
                  : "Non-admin — permissions can be assigned later."}
              </span>
            </span>
          </label>

          {submissionError && (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
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
              {isSubmitting ? "Sending invitation…" : "Send Invitation"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default CreateUserDialog;
