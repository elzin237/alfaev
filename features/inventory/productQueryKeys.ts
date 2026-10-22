export function normalizeProductSearch(search: string): string {
  return search.trim();
}

export function productListQueryPrefix(profileId: string | undefined) {
  return ["inventory", "products", profileId] as const;
}

export function productListQueryKey(
  profileId: string | undefined,
  warehouseIdOrSearch = "",
  search?: string,
) {
  const warehouseId = search === undefined ? "all-warehouses" : warehouseIdOrSearch;
  const normalizedSearch = search === undefined ? warehouseIdOrSearch : search;
  return [
    ...productListQueryPrefix(profileId),
    warehouseId,
    normalizeProductSearch(normalizedSearch),
  ] as const;
}

export function productDetailQueryKey(
  profileId: string | undefined,
  warehouseIdOrProductId: string,
  productId?: string,
) {
  const warehouseId = productId === undefined ? "all-warehouses" : warehouseIdOrProductId;
  const resolvedProductId = productId ?? warehouseIdOrProductId;
  return [
    "inventory",
    "products",
    "detail",
    profileId,
    warehouseId,
    resolvedProductId,
  ] as const;
}
