export const dashboardQueryKey = (profileId: string | undefined) =>
  ["dashboard", "read-model", profileId ?? "anonymous"] as const;
