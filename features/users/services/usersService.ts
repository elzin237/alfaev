import { supabase } from "../../../lib/supabase/client";

interface AdminUserRow {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface AdminUserListItem {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface UsersServiceError {
  code: "users_list_failed";
  message: string;
}

export type UsersListResult =
  | { ok: true; value: AdminUserListItem[] }
  | { ok: false; error: UsersServiceError };

function isAdminUserRow(value: unknown): value is AdminUserRow {
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

export async function listUsersAdmin(): Promise<UsersListResult> {
  const { data, error } = await supabase.rpc("list_users_admin");

  if (error || !Array.isArray(data) || !data.every(isAdminUserRow)) {
    return {
      ok: false,
      error: {
        code: "users_list_failed",
        message: "The AlfaEV users list could not be loaded.",
      },
    };
  }

  return {
    ok: true,
    value: data.map((user) => ({
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      isActive: user.is_active,
      isAdmin: user.is_admin,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
    })),
  };
}
