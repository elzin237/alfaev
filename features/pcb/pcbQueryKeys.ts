export function pcbCardListQueryKey(profileId: string | undefined) {
  return ["pcb", "cards", profileId] as const;
}

export function pcbBomDetailQueryKey(profileId: string | undefined, cardId: string) {
  return ["pcb", "bom", profileId, cardId] as const;
}

export function pcbBomChoicesQueryKey(profileId: string | undefined, cardId: string, search: string) {
  return ["pcb", "bom-choices", profileId, cardId, search.trim()] as const;
}
