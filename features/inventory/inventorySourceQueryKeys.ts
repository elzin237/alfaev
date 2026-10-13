export function inventorySourceLotsQueryKey(userId: string | undefined, productId: string) {
  return ["inventory-source-lots", userId ?? "anonymous", productId] as const;
}

export function inventorySourceChoicesQueryKey(userId: string | undefined, productId: string) {
  return ["inventory-source-choices", userId ?? "anonymous", productId] as const;
}
