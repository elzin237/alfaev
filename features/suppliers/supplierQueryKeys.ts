export function supplierListQueryKey(profileId: string | undefined) {
  return ["suppliers", "list", profileId] as const;
}
