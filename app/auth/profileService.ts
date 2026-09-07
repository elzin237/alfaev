import { supabase } from "../../lib/supabase/client";

export interface UserProfile {
  id: string;
  authUserId: string;
  fullName: string;
  email: string;
  birthday: string;
  isAdmin: boolean;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface UserProfileRow {
  id: string;
  auth_user_id: string;
  full_name: string;
  email: string;
  birthday: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export type ProfileServiceErrorCode =
  | "profile_not_found"
  | "profile_load_failed";

export interface ProfileServiceError {
  code: ProfileServiceErrorCode;
  message: string;
}

export type ProfileServiceResult =
  | { ok: true; value: UserProfile }
  | { ok: false; error: ProfileServiceError };

const profileColumns = [
  "id",
  "auth_user_id",
  "full_name",
  "email",
  "birthday",
  "is_admin",
  "is_active",
  "created_at",
  "last_login_at",
].join(",");

export async function loadUserProfile(
  authUserId: string,
): Promise<ProfileServiceResult> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select(profileColumns)
    .eq("auth_user_id", authUserId)
    .single<UserProfileRow>();

  if (error) {
    return {
      ok: false,
      error: error.code === "PGRST116"
        ? {
            code: "profile_not_found",
            message: "No AlfaEV profile is linked to this account.",
          }
        : {
            code: "profile_load_failed",
            message: "The AlfaEV profile could not be loaded.",
        },
    };
  }

  if (!data) {
    return {
      ok: false,
      error: {
        code: "profile_not_found",
        message: "No AlfaEV profile is linked to this account.",
      },
    };
  }

  return {
    ok: true,
    value: {
      id: data.id,
      authUserId: data.auth_user_id,
      fullName: data.full_name,
      email: data.email,
      birthday: data.birthday,
      isAdmin: data.is_admin,
      isActive: data.is_active,
      createdAt: data.created_at,
      lastLoginAt: data.last_login_at,
    },
  };
}
