import { useRef, useState } from "react";

import ConfirmDialog from "../../../shared/components/ConfirmDialog";
import type { AdminUserDetail } from "../services/userDetailService";
import { setUserActiveStateAdmin } from "../services/userActiveStateService";

export interface UserActiveStateControlProps {
  user: AdminUserDetail;
  currentProfileId: string;
  onChanged: (message: string) => void;
}

function UserActiveStateControl({
  user,
  currentProfileId,
  onChanged,
}: UserActiveStateControlProps) {
  const mutationLockRef = useRef(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isOwnProfile = user.id === currentProfileId;
  const requestedActiveState = !user.isActive;

  const confirmChange = async () => {
    if (mutationLockRef.current) {
      return;
    }

    mutationLockRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await setUserActiveStateAdmin({
        userId: user.id,
        isActive: requestedActiveState,
      });

      if (!result.ok) {
        setErrorMessage(result.error.message);
        return;
      }

      setIsConfirmOpen(false);
      onChanged(
        requestedActiveState
          ? "User reactivated."
          : "User deactivated.",
      );
    } finally {
      mutationLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (isOwnProfile) {
    return (
      <p className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
        You cannot deactivate your own account.
      </p>
    );
  }

  const actionLabel = user.isActive ? "Deactivate User" : "Reactivate User";

  return (
    <div className="mt-6 border-t border-zinc-200 pt-6">
      <button
        type="button"
        onClick={() => {
          setErrorMessage(null);
          setIsConfirmOpen(true);
        }}
        disabled={isSubmitting}
        className={
          user.isActive
            ? "w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            : "w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {actionLabel}
      </button>

      {errorMessage && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}

      <ConfirmDialog
        open={isConfirmOpen}
        title={user.isActive ? "Deactivate user?" : "Reactivate user?"}
        description={
          user.isActive
            ? "This user will be blocked from future sign-in and all AlfaEV access. Their account and history will be preserved."
            : "This user will regain future sign-in and AlfaEV access according to their account permissions."
        }
        confirmLabel={user.isActive ? "Deactivate User" : "Reactivate User"}
        confirmVariant={user.isActive ? "danger" : "primary"}
        isSubmitting={isSubmitting}
        onCancel={() => {
          if (!isSubmitting) {
            setIsConfirmOpen(false);
          }
        }}
        onConfirm={() => void confirmChange()}
      />
    </div>
  );
}

export default UserActiveStateControl;
