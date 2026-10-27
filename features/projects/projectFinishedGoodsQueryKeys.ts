export const projectFinishedGoodsQueryKeys = {
  profile: (profileId: string | undefined) => ["projects", "finished-goods", profileId] as const,
  context: (profileId: string | undefined, projectId: string) =>
    ["projects", "finished-goods", profileId, projectId] as const,
};
