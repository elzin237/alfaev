export function productListQueryKey(profileId: string | undefined) {
  return ["inventory", "products", profileId] as const;
}

export function productDetailQueryKey(
  profileId: string | undefined,
  productId: string,
) {
  return ["inventory", "products", "detail", profileId, productId] as const;
}
