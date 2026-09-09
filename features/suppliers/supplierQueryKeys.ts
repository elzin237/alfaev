export function supplierListQueryKey(profileId: string | undefined) {
  return ["suppliers", "list", profileId] as const;
}

export function supplierDetailQueryKey(
  profileId: string | undefined,
  supplierId: string,
) {
  return ["suppliers", "detail", profileId, supplierId] as const;
}
