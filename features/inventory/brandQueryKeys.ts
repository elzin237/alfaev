export function brandListQueryKey(profileId: string | undefined) {
  return ["inventory", "brands", profileId] as const;
}
