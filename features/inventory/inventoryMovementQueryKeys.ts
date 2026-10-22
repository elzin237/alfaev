export function inventoryMovementListQueryKey(
  profileId: string | undefined,
  warehouseIdOrProductId: string,
  productId?: string,
) {
  const warehouseId = productId === undefined ? "all-warehouses" : warehouseIdOrProductId;
  const resolvedProductId = productId ?? warehouseIdOrProductId;
  return [
    "inventory",
    "movements",
    "product",
    profileId,
    warehouseId,
    resolvedProductId,
  ] as const;
}
