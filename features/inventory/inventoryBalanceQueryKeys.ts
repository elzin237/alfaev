export function inventoryBalanceQueryKey(
  profileId: string | undefined,
  warehouseIdOrProductId: string,
  productId?: string,
) {
  const warehouseId = productId === undefined ? "all-warehouses" : warehouseIdOrProductId;
  const resolvedProductId = productId ?? warehouseIdOrProductId;
  return [
    "inventory",
    "balances",
    "detail",
    profileId,
    warehouseId,
    resolvedProductId,
  ] as const;
}
