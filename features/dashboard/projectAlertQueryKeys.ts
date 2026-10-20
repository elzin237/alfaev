export function projectAlertQueryPrefix(profileId: string) {
  return ["dashboard", "project-alerts", profileId] as const;
}

export function projectAlertInboxQueryKey(profileId: string) {
  return [...projectAlertQueryPrefix(profileId), "inbox"] as const;
}

export function projectAlertUnreadCountQueryKey(profileId: string) {
  return [...projectAlertQueryPrefix(profileId), "unread-count"] as const;
}
