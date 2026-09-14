export function inventoryBalanceQueryKey(
  profileId: string | undefined,
  productId: string,
) {
  return [
    "inventory",
    "balances",
    "detail",
    profileId,
    productId,
  ] as const;
}
