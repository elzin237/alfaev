import type { PermissionKey } from "../../../app/auth/permissions";
import { supabase } from "../../../lib/supabase/client";

export interface SaveUserPermissionsInput {
  userId: string;
  expectedPermissionKeys: readonly PermissionKey[];
  desiredPermissionKeys: readonly PermissionKey[];
}

export interface SaveUserPermissionsSuccess {
  changed: boolean;
}

export interface UserPermissionSaveError {
  code:
    | "access_denied"
    | "self_permission_change"
    | "admin_target"
    | "invalid_permissions"
    | "stale_permissions"
    | "user_not_found"
    | "permission_save_failed";
  message: string;
}

export type SaveUserPermissionsResult =
  | { ok: true; value: SaveUserPermissionsSuccess }
  | { ok: false; error: UserPermissionSaveError };

function failure(
  code: UserPermissionSaveError["code"],
  message: string,
): SaveUserPermissionsResult {
  return { ok: false, error: { code, message } };
}

function mapError(code: string | undefined): SaveUserPermissionsResult {
  switch (code) {
    case "42501":
      return failure(
        "access_denied",
        "You do not have permission to change user permissions.",
      );
    case "PRM01":
      return failure(
        "self_permission_change",
        "You cannot change your own permissions.",
      );
    case "PRM02":
      return failure(
        "admin_target",
        "Admin permissions cannot be changed through this matrix.",
      );
    case "PRM03":
    case "22023":
      return failure(
        "invalid_permissions",
        "The requested permission selection is invalid.",
      );
    case "PRM04":
      return failure(
        "stale_permissions",
        "Permissions changed since you opened this page. Reload and review before saving.",
      );
    case "P0002":
      return failure("user_not_found", "The AlfaEV user could not be found.");
    default:
      return failure(
        "permission_save_failed",
        "The user's permissions could not be saved. Please try again.",
      );
  }
}

export async function saveUserPermissionsAdmin(
  input: SaveUserPermissionsInput,
): Promise<SaveUserPermissionsResult> {
  try {
    const { data, error } = await supabase.rpc(
      "save_user_permissions_admin",
      {
        p_user_id: input.userId,
        p_expected_permission_keys: [...input.expectedPermissionKeys],
        p_desired_permission_keys: [...input.desiredPermissionKeys],
      },
    );

    if (error) {
      return mapError(error.code);
    }

    if (typeof data !== "boolean") {
      return mapError(undefined);
    }

    return { ok: true, value: { changed: data } };
  } catch {
    return mapError(undefined);
  }
}
