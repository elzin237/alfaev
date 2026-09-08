import { supabase } from "../../../lib/supabase/client";

interface AdminUserDetailRow {
  id: string;
  full_name: string;
  email: string;
  birthday: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface AdminUserDetail {
  id: string;
  fullName: string;
  email: string;
  birthday: string;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface UserDetailServiceError {
  code: "user_not_found" | "user_detail_failed";
  message: string;
}

export type UserDetailResult =
  | { ok: true; value: AdminUserDetail }
  | { ok: false; error: UserDetailServiceError };

function isAdminUserDetailRow(value: unknown): value is AdminUserDetailRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "id" in value &&
    typeof value.id === "string" &&
    "full_name" in value &&
    typeof value.full_name === "string" &&
    "email" in value &&
    typeof value.email === "string" &&
    "birthday" in value &&
    typeof value.birthday === "string" &&
    "is_active" in value &&
    typeof value.is_active === "boolean" &&
    "is_admin" in value &&
    typeof value.is_admin === "boolean" &&
    "created_at" in value &&
    typeof value.created_at === "string" &&
    "last_login_at" in value &&
    (typeof value.last_login_at === "string" || value.last_login_at === null)
  );
}

export async function getUserAdmin(userId: string): Promise<UserDetailResult> {
  const { data, error } = await supabase.rpc("get_user_admin", {
    p_user_id: userId,
  });

  if (error) {
    if (error.code === "P0002") {
      return {
        ok: false,
        error: {
          code: "user_not_found",
          message: "The AlfaEV user could not be found.",
        },
      };
    }

    return {
      ok: false,
      error: {
        code: "user_detail_failed",
        message: "The AlfaEV user profile could not be loaded.",
      },
    };
  }

  if (!Array.isArray(data) || data.length !== 1 || !isAdminUserDetailRow(data[0])) {
    return {
      ok: false,
      error: {
        code: "user_detail_failed",
        message: "The AlfaEV user profile could not be loaded.",
      },
    };
  }

  const user = data[0];

  return {
    ok: true,
    value: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      birthday: user.birthday,
      isActive: user.is_active,
      isAdmin: user.is_admin,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
    },
  };
}
