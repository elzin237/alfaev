import { supabase } from "../../../lib/supabase/client";
import type { UserProfileEditInput } from "../validation/userProfileEditSchema";

export interface UserProfileUpdateInput extends UserProfileEditInput {
  userId: string;
}

export interface UserProfileUpdateSuccess {
  profileId: string;
}

export interface UserProfileUpdateServiceError {
  code:
    | "duplicate_user"
    | "identity_mismatch"
    | "user_not_found"
    | "update_failed";
  message: string;
}

export type UserProfileUpdateResult =
  | { ok: true; value: UserProfileUpdateSuccess }
  | { ok: false; error: UserProfileUpdateServiceError };

interface UpdateSuccessResponse {
  code: "user_updated";
  message: string;
  data: {
    profileId: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUpdateSuccessResponse(value: unknown): value is UpdateSuccessResponse {
  return (
    isRecord(value) &&
    value.code === "user_updated" &&
    typeof value.message === "string" &&
    isRecord(value.data) &&
    typeof value.data.profileId === "string" &&
    value.data.profileId.length > 0
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

function updateFailed(): UserProfileUpdateResult {
  return {
    ok: false,
    error: {
      code: "update_failed",
      message: "The user profile could not be updated. Please try again.",
    },
  };
}

export async function updateUserProfileAdmin(
  input: UserProfileUpdateInput,
): Promise<UserProfileUpdateResult> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "admin-update-user-profile",
      {
        body: {
          userId: input.userId,
          fullName: input.fullName,
          email: input.email,
          birthday: input.birthday,
        },
      },
    );

    if (error) {
      const backendErrorCode = await readBackendErrorCode(error);

      if (backendErrorCode === "user_exists") {
        return {
          ok: false,
          error: {
            code: "duplicate_user",
            message: "An AlfaEV user with this email already exists.",
          },
        };
      }

      if (backendErrorCode === "identity_mismatch") {
        return {
          ok: false,
          error: {
            code: "identity_mismatch",
            message:
              "The user identity could not be safely updated. Contact an administrator.",
          },
        };
      }

      if (backendErrorCode === "user_not_found") {
        return {
          ok: false,
          error: {
            code: "user_not_found",
            message: "The AlfaEV user could not be found.",
          },
        };
      }

      return updateFailed();
    }

    const responseData: unknown = data;

    if (!isUpdateSuccessResponse(responseData)) {
      return updateFailed();
    }

    return {
      ok: true,
      value: { profileId: responseData.data.profileId },
    };
  } catch {
    return updateFailed();
  }
}
