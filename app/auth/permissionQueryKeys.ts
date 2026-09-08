import type { PermissionKey } from "./permissions";

export function permissionQueryPrefix(
  authUserId: string,
  profileId: string,
) {
  return ["permission", authUserId, profileId] as const;
}

export function permissionQueryKey(
  authUserId: string | undefined,
  profileId: string | undefined,
  permission: PermissionKey,
) {
  return ["permission", authUserId, profileId, permission] as const;
}
