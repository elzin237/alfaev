import { useRef, useState } from "react";

import ConfirmDialog from "../../../shared/components/ConfirmDialog";
import type { AdminUserDetail } from "../services/userDetailService";
import { setUserAdminStatus } from "../services/userAdminStatusService";

export interface UserAdminStatusControlProps {
  user: AdminUserDetail;
  currentProfileId: string;
  onChanged: (message: string) => void;
}

function confirmationDescription(
  isCurrentlyAdmin: boolean,
  isActive: boolean,
): string {
  if (!isActive) {
    return isCurrentlyAdmin
      ? "This removes Admin bypass but preserves explicit permissions. The account will remain inactive."
      : "This grants Admin status, but the account will remain inactive until it is explicitly reactivated.";
  }

  return isCurrentlyAdmin
    ? "This removes Admin bypass. Existing explicit permissions are preserved and become effective again."
    : "This grants full Admin access to AlfaEV. Existing explicit permissions will remain preserved.";
}

function UserAdminStatusControl({
  user,
  currentProfileId,
  onChanged,
}: UserAdminStatusControlProps) {
  const mutationLockRef = useRef(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isOwnProfile = user.id === currentProfileId;
  const requestedAdminStatus = !user.isAdmin;

  const confirmChange = async () => {
    if (mutationLockRef.current) {
      return;
    }

    mutationLockRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await setUserAdminStatus(
        user.id,
        requestedAdminStatus,
      );

      if (!result.ok) {
        setErrorMessage(result.error.message);
        return;
      }

      setIsConfirmOpen(false);
      onChanged(
        requestedAdminStatus
          ? "User promoted to Admin."
          : "User demoted from Admin.",
      );
    } finally {
      mutationLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (isOwnProfile) {
    return (
      <p className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
        You cannot change your own Admin status.
      </p>
    );
  }

  const actionLabel = user.isAdmin ? "Demote from Admin" : "Promote to Admin";

  return (
    <div className="mt-6 border-t border-zinc-200 pt-6">
      <button
        type="button"
        onClick={() => {
          setErrorMessage(null);
          setIsConfirmOpen(true);
        }}
        disabled={isSubmitting}
        className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
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
        title={user.isAdmin ? "Demote user from Admin?" : "Promote user to Admin?"}
        description={confirmationDescription(user.isAdmin, user.isActive)}
        confirmLabel={actionLabel}
        confirmVariant={user.isAdmin ? "danger" : "primary"}
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

export default UserAdminStatusControl;
