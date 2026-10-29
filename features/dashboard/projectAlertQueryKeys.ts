import { isWorkOrderNotificationsEnabled } from "../../app/config/workOrderNotificationsActivation";
import { isWorkOrderActiveShortagesEnabled } from "../../app/config/workOrderActiveShortagesActivation";

export function projectAlertQueryPrefix(profileId: string) {
  return ["dashboard", isWorkOrderActiveShortagesEnabled() ? "shortage-tracking" : isWorkOrderNotificationsEnabled() ? "combined-alerts" : "project-alerts", profileId] as const;
}

export function projectAlertInboxQueryKey(profileId: string) {
  return [...projectAlertQueryPrefix(profileId), "inbox"] as const;
}

export function projectAlertUnreadCountQueryKey(profileId: string) {
  return [...projectAlertQueryPrefix(profileId), "unread-count"] as const;
}
