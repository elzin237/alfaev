export function productSupplierListQueryKey(
  profileId: string | undefined,
  productId: string,
) {
  return [
    "inventory",
    "products",
    "suppliers",
    profileId,
    productId,
  ] as const;
}

export function productSupplierChoiceQueryKey(
  profileId: string | undefined,
) {
  return ["inventory", "product-suppliers", "choices", profileId] as const;
}
