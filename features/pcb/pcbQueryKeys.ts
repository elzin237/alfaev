export function pcbCardListQueryKey(profileId: string | undefined) {
  return ["pcb", "cards", profileId] as const;
}
