export function projectActivityQueryKey(
  profileId: string | undefined,
  projectId: string,
) {
  return ["projects", "activity", profileId, projectId] as const;
}

export function projectActivityImageQueryKey(
  profileId: string | undefined,
  projectId: string,
  activityId: string,
) {
  return ["projects", "activity-image", profileId, projectId, activityId] as const;
}
