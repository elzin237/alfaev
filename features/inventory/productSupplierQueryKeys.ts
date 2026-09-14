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

export function supplierProductListQueryKey(
  profileId: string | undefined,
  supplierId: string,
) {
  return [
    "suppliers",
    "product-suppliers",
    profileId,
    supplierId,
  ] as const;
}

export function supplierProductChoiceQueryKey(
  profileId: string | undefined,
) {
  return ["suppliers", "product-suppliers", "choices", profileId] as const;
}
