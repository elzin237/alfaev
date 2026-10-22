export function inventorySourceLotsQueryKey(userId: string | undefined, warehouseId: string, productId: string) {
  return ["inventory-source-lots", userId ?? "anonymous", warehouseId, productId] as const;
}

export function inventorySourceChoicesQueryKey(userId: string | undefined, warehouseId: string, productId: string) {
  return ["inventory-source-choices", userId ?? "anonymous", warehouseId, productId] as const;
}
