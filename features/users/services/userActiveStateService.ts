import { supabase } from "../../../lib/supabase/client";

export interface SetUserActiveStateInput {
  userId: string;
  isActive: boolean;
}

export interface SetUserActiveStateSuccess {
  profileId: string;
  isActive: boolean;
  changed: boolean;
}

export interface UserActiveStateServiceError {
  code:
    | "access_denied"
    | "self_deactivation"
    | "last_active_admin"
    | "user_not_found"
    | "state_mismatch"
    | "state_update_failed";
  message: string;
}

export type SetUserActiveStateResult =
  | { ok: true; value: SetUserActiveStateSuccess }
  | { ok: false; error: UserActiveStateServiceError };

interface ActiveStateSuccessResponse {
  code:
    | "user_deactivated"
    | "user_reactivated"
    | "user_active_state_unchanged";
  message: string;
  data: {
    profileId: string;
    isActive: boolean;
    changed: boolean;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSuccessResponse(value: unknown): value is ActiveStateSuccessResponse {
  return (
    isRecord(value) &&
    (value.code === "user_deactivated" ||
      value.code === "user_reactivated" ||
      value.code === "user_active_state_unchanged") &&
    typeof value.message === "string" &&
    isRecord(value.data) &&
    typeof value.data.profileId === "string" &&
    value.data.profileId.length > 0 &&
    typeof value.data.isActive === "boolean" &&
    typeof value.data.changed === "boolean"
  );
}

async function readBackendErrorCode(error: unknown): Promise<string | null> {
  if (!isRecord(error) || !(error.context instanceof Response)) {
    return null;
  }

  try {
    const responseBody: unknown = await error.context.json();

    return isRecord(responseBody) && typeof responseBody.code === "string"
      ? responseBody.code
      : null;
  } catch {
    return null;
  }
}

function failure(
  code: UserActiveStateServiceError["code"],
  message: string,
): SetUserActiveStateResult {
  return { ok: false, error: { code, message } };
}

function mapBackendError(code: string | null): SetUserActiveStateResult {
  switch (code) {
    case "access_denied":
      return failure(
        "access_denied",
        "You do not have permission to change this account state.",
      );
    case "self_deactivation":
      return failure(
        "self_deactivation",
        "You cannot deactivate your own account.",
      );
    case "last_active_admin":
      return failure(
        "last_active_admin",
        "The last active administrator cannot be deactivated.",
      );
    case "user_not_found":
      return failure("user_not_found", "The AlfaEV user could not be found.");
    case "state_mismatch":
    case "state_rollback_failed":
      return failure(
        "state_mismatch",
        "The account state could not be changed safely. Contact an administrator.",
      );
    default:
      return failure(
        "state_update_failed",
        "The account state could not be changed. Please try again.",
      );
  }
}

export async function setUserActiveStateAdmin(
  input: SetUserActiveStateInput,
): Promise<SetUserActiveStateResult> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "admin-set-user-active",
      { body: { userId: input.userId, isActive: input.isActive } },
    );

    if (error) {
      return mapBackendError(await readBackendErrorCode(error));
    }

    const responseData: unknown = data;

    if (!isSuccessResponse(responseData)) {
      return mapBackendError(null);
    }

    return {
      ok: true,
      value: {
        profileId: responseData.data.profileId,
        isActive: responseData.data.isActive,
        changed: responseData.data.changed,
      },
    };
  } catch {
    return mapBackendError(null);
  }
}
