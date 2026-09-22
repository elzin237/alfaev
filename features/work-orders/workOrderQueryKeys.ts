export function workOrderListQueryKey(profileId: string | undefined) {
  return ["work-orders", "list", profileId] as const;
}
