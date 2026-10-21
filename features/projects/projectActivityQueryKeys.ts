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

export function projectIssueResolutionImageQueryKey(
  profileId: string | undefined,
  projectId: string,
  activityId: string,
  resolutionId: string,
) {
  return [
    "projects",
    "issue-resolution-image",
    profileId,
    projectId,
    activityId,
    resolutionId,
  ] as const;
}

export function projectActivityTargetQueryKey(
  profileId: string | undefined,
  projectId: string,
  activityId: string,
) {
  return ["projects", "activity-target", profileId, projectId, activityId] as const;
}
