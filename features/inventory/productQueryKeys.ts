export function productListQueryKey(profileId: string | undefined) {
  return ["inventory", "products", profileId] as const;
}
