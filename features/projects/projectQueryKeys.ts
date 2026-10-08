export function projectListQueryKey(profileId: string | undefined) {
  return ["projects", "list", profileId] as const;
}

export function projectDetailQueryKey(
  profileId: string | undefined,
  projectId: string,
) {
  return ["projects", "detail", profileId, projectId] as const;
}

export function projectSearchQueryKey(
  profileId: string | undefined,
  search: string,
) {
  return ["projects", "search", profileId, search] as const;
}
