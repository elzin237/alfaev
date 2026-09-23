export function workOrderListQueryKey(profileId: string | undefined) {
  return ["work-orders", "list", profileId] as const;
}

export function workOrderDetailQueryKey(
  profileId: string | undefined,
  workOrderId: string,
) {
  return ["work-orders", "detail", profileId, workOrderId] as const;
}

export function workOrderProjectChoicesQueryKey(
  profileId: string | undefined,
) {
  return ["work-orders", "project-choices", profileId] as const;
}
