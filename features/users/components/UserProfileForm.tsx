import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";

import type { AdminUserDetail } from "../services/userDetailService";
import { updateUserProfileAdmin } from "../services/userProfileUpdateService";
import {
  userProfileEditSchema,
  type UserProfileEditFormInput,
  type UserProfileEditInput,
} from "../validation/userProfileEditSchema";

export interface UserProfileFormProps {
  user: AdminUserDetail;
  onUpdated: () => void;
}

function UserProfileForm({ user, onUpdated }: UserProfileFormProps) {
  const submissionLockRef = useRef(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UserProfileEditFormInput, unknown, UserProfileEditInput>({
    resolver: zodResolver(userProfileEditSchema),
    defaultValues: {
      fullName: user.fullName,
      email: user.email,
      birthday: user.birthday,
    },
  });

  const submit = handleSubmit(async (input) => {
    if (submissionLockRef.current) {
      return;
    }

    submissionLockRef.current = true;
    setSubmissionError(null);

    try {
      const result = await updateUserProfileAdmin({ userId: user.id, ...input });

      if (!result.ok) {
        setSubmissionError(result.error.message);
        return;
      }

      onUpdated();
    } finally {
      submissionLockRef.current = false;
    }
  });

  return (
    <form
      className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm lg:p-8"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <div>
        <h2 className="text-xl font-bold text-zinc-900">Profile</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Update the user&apos;s AlfaEV identity details.
        </p>
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <label htmlFor="user-profile-full-name" className="block text-sm font-semibold text-zinc-800">
            Full Name
          </label>
          <input
            {...register("fullName")}
            id="user-profile-full-name"
            type="text"
            autoComplete="name"
            disabled={isSubmitting}
            aria-invalid={Boolean(errors.fullName)}
            className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
          />
          {errors.fullName && (
            <p className="mt-2 text-sm text-red-600">{errors.fullName.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="user-profile-email" className="block text-sm font-semibold text-zinc-800">
            Email
          </label>
          <input
            {...register("email")}
            id="user-profile-email"
            type="email"
            autoComplete="email"
            disabled={isSubmitting}
            aria-invalid={Boolean(errors.email)}
            className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
          />
          {errors.email && (
            <p className="mt-2 text-sm text-red-600">{errors.email.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="user-profile-birthday" className="block text-sm font-semibold text-zinc-800">
            Birthday
          </label>
          <input
            {...register("birthday")}
            id="user-profile-birthday"
            type="date"
            disabled={isSubmitting}
            aria-invalid={Boolean(errors.birthday)}
            className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100"
          />
          {errors.birthday && (
            <p className="mt-2 text-sm text-red-600">{errors.birthday.message}</p>
          )}
        </div>
      </div>

      {submissionError && (
        <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {submissionError}
        </p>
      )}

      <div className="mt-6 flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Save Profile"}
        </button>
      </div>
    </form>
  );
}

export default UserProfileForm;
