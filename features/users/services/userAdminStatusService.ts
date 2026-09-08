import { supabase } from "../../../lib/supabase/client";

export interface SetUserAdminStatusSuccess {
  profileId: string;
  isAdmin: boolean;
}

export interface UserAdminStatusServiceError {
  code:
    | "access_denied"
    | "self_admin_status_change"
    | "last_active_admin"
    | "user_not_found"
    | "admin_status_update_failed";
  message: string;
}

export type SetUserAdminStatusResult =
  | { ok: true; value: SetUserAdminStatusSuccess }
  | { ok: false; error: UserAdminStatusServiceError };

function failure(
  code: UserAdminStatusServiceError["code"],
  message: string,
): SetUserAdminStatusResult {
  return { ok: false, error: { code, message } };
}

function mapError(code: string | undefined): SetUserAdminStatusResult {
  switch (code) {
    case "42501":
      return failure(
        "access_denied",
        "You do not have permission to change this Admin status.",
      );
    case "AUS01":
      return failure(
        "self_admin_status_change",
        "You cannot change your own Admin status.",
      );
    case "AUS02":
      return failure(
        "last_active_admin",
        "The last active administrator cannot be demoted.",
      );
    case "P0002":
      return failure("user_not_found", "The AlfaEV user could not be found.");
    default:
      return failure(
        "admin_status_update_failed",
        "The Admin status could not be changed. Please try again.",
      );
  }
}

export async function setUserAdminStatus(
  userId: string,
  isAdmin: boolean,
): Promise<SetUserAdminStatusResult> {
  try {
    const { data, error } = await supabase.rpc(
      "set_user_admin_status_admin",
      { p_user_id: userId, p_is_admin: isAdmin },
    );

    if (error) {
      return mapError(error.code);
    }

    if (typeof data !== "string" || data !== userId) {
      return mapError(undefined);
    }

    return { ok: true, value: { profileId: data, isAdmin } };
  } catch {
    return mapError(undefined);
  }
}
