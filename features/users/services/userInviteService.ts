import { supabase } from "../../../lib/supabase/client";
import type { UserInviteInput } from "../validation/userInviteSchema";

export interface UserInviteSuccess {
  profileId: string;
}

export interface UserInviteServiceError {
  code: "duplicate_user" | "invite_failed";
  message: string;
}

export type UserInviteResult =
  | { ok: true; value: UserInviteSuccess }
  | { ok: false; error: UserInviteServiceError };

interface InviteSuccessResponse {
  code: "user_invited";
  message: string;
  data: {
    profileId: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInviteSuccessResponse(value: unknown): value is InviteSuccessResponse {
  return (
    isRecord(value) &&
    value.code === "user_invited" &&
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

function inviteFailed(): UserInviteResult {
  return {
    ok: false,
    error: {
      code: "invite_failed",
      message: "The user invitation could not be completed. Please try again.",
    },
  };
}

export async function inviteUserAdmin(
  input: UserInviteInput,
): Promise<UserInviteResult> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "admin-invite-user",
      {
        body: {
          fullName: input.fullName,
          email: input.email,
          birthday: input.birthday,
          isAdmin: input.isAdmin,
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

      return inviteFailed();
    }

    const responseData: unknown = data;

    if (!isInviteSuccessResponse(responseData)) {
      return inviteFailed();
    }

    return {
      ok: true,
      value: {
        profileId: responseData.data.profileId,
      },
    };
  } catch {
    return inviteFailed();
  }
}
