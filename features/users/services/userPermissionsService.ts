import {
  PERMISSION_KEYS,
  type PermissionKey,
} from "../../../app/auth/permissions";
import { supabase } from "../../../lib/supabase/client";

export const USER_PERMISSION_MODULES = [
  "dashboard",
  "projects",
  "procurement",
  "suppliers",
  "inventory",
  "pcb",
  "work_orders",
  "archive",
] as const;

export type UserPermissionModule = (typeof USER_PERMISSION_MODULES)[number];

interface UserPermissionMatrixRow {
  permission_key: PermissionKey;
  module: UserPermissionModule;
  label: string;
  description: string;
  granted: boolean;
}

export interface UserPermissionMatrixItem {
  permissionKey: PermissionKey;
  module: UserPermissionModule;
  label: string;
  description: string;
  granted: boolean;
}

export interface UserPermissionsServiceError {
  code: "user_not_found" | "permission_matrix_failed";
  message: string;
}

export type UserPermissionsResult =
  | { ok: true; value: UserPermissionMatrixItem[] }
  | { ok: false; error: UserPermissionsServiceError };

function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEYS.some((permissionKey) => permissionKey === value);
}

function isPermissionModule(value: string): value is UserPermissionModule {
  return USER_PERMISSION_MODULES.some((module) => module === value);
}

function isPermissionMatrixRow(
  value: unknown,
): value is UserPermissionMatrixRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const expectedKeys = [
    "description",
    "granted",
    "label",
    "module",
    "permission_key",
  ];

  return (
    Object.keys(value).sort().every((key, index) => key === expectedKeys[index]) &&
    "permission_key" in value &&
    typeof value.permission_key === "string" &&
    isPermissionKey(value.permission_key) &&
    "module" in value &&
    typeof value.module === "string" &&
    isPermissionModule(value.module) &&
    "label" in value &&
    typeof value.label === "string" &&
    value.label.length > 0 &&
    "description" in value &&
    typeof value.description === "string" &&
    value.description.length > 0 &&
    "granted" in value &&
    typeof value.granted === "boolean" &&
    value.module ===
      value.permission_key.slice(0, value.permission_key.indexOf("."))
  );
}

function isCompletePermissionMatrix(
  rows: unknown,
): rows is UserPermissionMatrixRow[] {
  if (!Array.isArray(rows) || rows.length !== PERMISSION_KEYS.length) {
    return false;
  }

  if (!rows.every(isPermissionMatrixRow)) {
    return false;
  }

  return PERMISSION_KEYS.every(
    (permissionKey, index) => rows[index]?.permission_key === permissionKey,
  );
}

function failure(
  code: UserPermissionsServiceError["code"],
  message: string,
): UserPermissionsResult {
  return { ok: false, error: { code, message } };
}

export async function getUserPermissionsAdmin(
  userId: string,
): Promise<UserPermissionsResult> {
  try {
    const { data, error } = await supabase.rpc(
      "get_user_permissions_admin",
      { p_user_id: userId },
    );

    if (error) {
      return error.code === "P0002"
        ? failure("user_not_found", "The AlfaEV user could not be found.")
        : failure(
            "permission_matrix_failed",
            "The user's permissions could not be loaded.",
          );
    }

    if (!isCompletePermissionMatrix(data)) {
      return failure(
        "permission_matrix_failed",
        "The user's permissions could not be loaded.",
      );
    }

    return {
      ok: true,
      value: data.map((permission) => ({
        permissionKey: permission.permission_key,
        module: permission.module,
        label: permission.label,
        description: permission.description,
        granted: permission.granted,
      })),
    };
  } catch {
    return failure(
      "permission_matrix_failed",
      "The user's permissions could not be loaded.",
    );
  }
}
