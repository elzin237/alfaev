export const fixedAssetListKey = (profileId: string | undefined) =>
  ["fixed-assets", profileId, "list"] as const;
