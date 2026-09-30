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

export function workOrderDraftMaterialsQueryKey(
  profileId: string | undefined,
  workOrderId: string,
) {
  return ["work-orders", "draft-materials", profileId, workOrderId] as const;
}

export function finishedWorkOrderDetailQueryKey(
  profileId: string | undefined,
  workOrderId: string,
) {
  return ["work-orders", "finished-detail", profileId, workOrderId] as const;
}

export function finishedWorkOrderMaterialsQueryKey(
  profileId: string | undefined,
  workOrderId: string,
) {
  return ["work-orders", "finished-materials", profileId, workOrderId] as const;
}

export function finishedWorkOrderMovementsQueryKey(
  profileId: string | undefined,
  workOrderId: string,
) {
  return ["work-orders", "finished-movements", profileId, workOrderId] as const;
}
