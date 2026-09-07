import { supabase } from "../../lib/supabase/client";
import type { PermissionKey } from "./permissions";

export interface PermissionServiceError {
  code: "permission_check_failed";
  message: string;
}

export type PermissionServiceResult =
  | { ok: true; value: boolean }
  | { ok: false; error: PermissionServiceError };

export async function hasPermission(
  permissionKey: PermissionKey,
): Promise<PermissionServiceResult> {
  const { data, error } = await supabase.rpc("has_permission", {
    permission_key: permissionKey,
  });

  if (error || typeof data !== "boolean") {
    return {
      ok: false,
      error: {
        code: "permission_check_failed",
        message: "Your access could not be verified.",
      },
    };
  }

  return { ok: true, value: data };
}
