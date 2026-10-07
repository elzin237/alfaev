export function userListQueryKey(profileId: string | undefined) {
  return ["users", "list", profileId] as const;
}

export function userDetailQueryKey(
  profileId: string | undefined,
  userId: string,
) {
  return ["users", "detail", profileId, userId] as const;
}

export function userPermissionsQueryKey(
  profileId: string | undefined,
  userId: string,
) {
  return ["users", "permissions", profileId, userId] as const;
}
