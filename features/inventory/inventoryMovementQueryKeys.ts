export function inventoryMovementListQueryKey(
  profileId: string | undefined,
  productId: string,
) {
  return [
    "inventory",
    "movements",
    "product",
    profileId,
    productId,
  ] as const;
}
