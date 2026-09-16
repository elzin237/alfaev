export function projectPlanningQueryKey(
  profileId: string | undefined,
  projectId: string,
) {
  return ["projects", "planning", profileId, projectId] as const;
}

export function projectPlanningChoicesQueryKey(
  profileId: string | undefined,
  projectId: string,
  search: string,
) {
  return [
    ...projectPlanningQueryKey(profileId, projectId),
    "product-choices",
    search.trim(),
  ] as const;
}
