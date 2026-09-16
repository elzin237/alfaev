export function inventoryCommitmentsQueryKey(profileId: string | undefined) {
  return ["inventory", "commitments", profileId] as const;
}

export function productProjectCommitmentsQueryKey(
  profileId: string | undefined,
  productId: string,
) {
  return [...inventoryCommitmentsQueryKey(profileId), "product", productId] as const;
}
