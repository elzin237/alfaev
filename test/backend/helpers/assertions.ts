import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";

export function expectPermissionDenied(error: PostgrestError | null): void {
  expect(error).not.toBeNull();
  expect(error?.code).toBe("42501");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function expectAdminStatus(
  client: SupabaseClient,
  expected: boolean,
): Promise<void> {
  const { data, error } = await client.rpc("current_user_is_admin");

  expect(error).toBeNull();
  expect(data).toBe(expected);
}

export async function expectPermission(
  client: SupabaseClient,
  permissionKey: string,
  expected: boolean,
): Promise<void> {
  const { data, error } = await client.rpc("has_permission", {
    permission_key: permissionKey,
  });

  expect(error).toBeNull();
  expect(data).toBe(expected);
}
