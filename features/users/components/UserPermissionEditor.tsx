import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  PERMISSION_KEYS,
  type PermissionKey,
} from "../../../app/auth/permissions";
import { saveUserPermissionsAdmin } from "../services/userPermissionSaveService";
import type { UserPermissionMatrixItem } from "../services/userPermissionsService";
import { userPermissionsQueryKey } from "../userQueryKeys";
import UserPermissionMatrix from "./UserPermissionMatrix";

export interface UserPermissionEditorProps {
  permissions: readonly UserPermissionMatrixItem[];
  userId: string;
  currentAdminProfileId: string;
  isAdminTarget: boolean;
  onSaved: (message: string) => void;
}

function samePermissionKeys(
  first: readonly PermissionKey[],
  second: readonly PermissionKey[],
): boolean {
  return (
    first.length === second.length &&
    first.every((permissionKey, index) => permissionKey === second[index])
  );
}

function UserPermissionEditor({
  permissions,
  userId,
  currentAdminProfileId,
  isAdminTarget,
  onSaved,
}: UserPermissionEditorProps) {
  const queryClient = useQueryClient();
  const mutationLockRef = useRef(false);
  const loadedPermissionKeys = useMemo(
    () => permissions
      .filter((permission) => permission.granted)
      .map((permission) => permission.permissionKey),
    [permissions],
  );
  const loadedPermissionSignature = loadedPermissionKeys.join("|");
  const [draftPermissionKeys, setDraftPermissionKeys] = useState<PermissionKey[]>(
    loadedPermissionKeys,
  );
  const [baselinePermissionKeys, setBaselinePermissionKeys] = useState<
    PermissionKey[]
  >(loadedPermissionKeys);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const permissionsQueryKey = userPermissionsQueryKey(
    currentAdminProfileId,
    userId,
  );

  useEffect(() => {
    setBaselinePermissionKeys(loadedPermissionKeys);
    setDraftPermissionKeys(loadedPermissionKeys);
    setIsStale(false);
  }, [loadedPermissionSignature]);

  const isDirty = !samePermissionKeys(
    baselinePermissionKeys,
    draftPermissionKeys,
  );
  const displayedPermissions = permissions.map((permission) => ({
    ...permission,
    granted: draftPermissionKeys.includes(permission.permissionKey),
  }));

  const updateDraft = (permissionKey: PermissionKey, granted: boolean) => {
    const nextPermissionKeys = new Set(draftPermissionKeys);

    if (granted) {
      nextPermissionKeys.add(permissionKey);
    } else {
      nextPermissionKeys.delete(permissionKey);
    }

    setDraftPermissionKeys(
      PERMISSION_KEYS.filter((key) => nextPermissionKeys.has(key)),
    );
    setErrorMessage(null);
  };

  const savePermissions = async () => {
    if (
      mutationLockRef.current ||
      isAdminTarget ||
      !isDirty ||
      isStale
    ) {
      return;
    }

    mutationLockRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await saveUserPermissionsAdmin({
        userId,
        expectedPermissionKeys: baselinePermissionKeys,
        desiredPermissionKeys: draftPermissionKeys,
      });

      if (!result.ok) {
        setErrorMessage(result.error.message);

        if (result.error.code === "stale_permissions") {
          setIsStale(true);
          await queryClient.refetchQueries({
            queryKey: permissionsQueryKey,
            exact: true,
          });
        }

        return;
      }

      setBaselinePermissionKeys(draftPermissionKeys);
      await queryClient.invalidateQueries({
        queryKey: permissionsQueryKey,
        exact: true,
      });
      onSaved("Permissions updated.");
    } finally {
      mutationLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <UserPermissionMatrix
        permissions={displayedPermissions}
        isAdminTarget={isAdminTarget}
        isSubmitting={isSubmitting}
        onPermissionChange={isAdminTarget ? undefined : updateDraft}
      />

      {!isAdminTarget && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          {errorMessage && (
            <p role="alert" className="mb-4 text-sm text-red-700">
              {errorMessage}
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!isDirty || isSubmitting || isStale}
              onClick={() => void savePermissions()}
              className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Saving Permissions…" : "Save Permissions"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserPermissionEditor;
