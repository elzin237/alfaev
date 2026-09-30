export function projectMaterialUsageQueryKey(
  profileId: string | undefined,
  projectId: string,
) {
  return ["projects", "material-usage", profileId, projectId] as const;
}
