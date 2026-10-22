export function pcbCardListQueryKey(profileId: string | undefined) {
  return ["pcb", "cards", profileId] as const;
}

export function pcbBomDetailQueryPrefix(profileId: string | undefined) {
  return ["pcb", "bom", profileId] as const;
}

export function pcbBomDetailQueryKey(profileId: string | undefined, cardId: string) {
  return [...pcbBomDetailQueryPrefix(profileId), cardId] as const;
}

export function pcbBomHistoryQueryKey(profileId: string | undefined, cardId: string) {
  return ["pcb", "bom-history", profileId, cardId] as const;
}

export function pcbProductionHistoryQueryKey(profileId: string | undefined, cardId: string) {
  return ["pcb", "production-history", profileId, cardId] as const;
}

export function pcbBomChoicesQueryKey(profileId: string | undefined, cardId: string, search: string) {
  return ["pcb", "bom-choices", profileId, cardId, search.trim()] as const;
}

export function pcbProductionSourceQueryKey(profileId: string | undefined, cardId: string) {
  return ["pcb", "production-source", profileId, cardId] as const;
}

export function pcbProductionProjectsQueryKey(profileId: string | undefined) {
  return ["pcb", "production-projects", profileId] as const;
}
