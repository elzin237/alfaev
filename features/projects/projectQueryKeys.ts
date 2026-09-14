export function projectListQueryKey(profileId: string | undefined) {
  return ["projects", "list", profileId] as const;
}
