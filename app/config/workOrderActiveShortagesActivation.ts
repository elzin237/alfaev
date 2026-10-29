import { isWorkOrderNotificationsEnabled } from "./workOrderNotificationsActivation";
// Coordinated migration-166 activation only. No storage/URL override.
export const WORK_ORDER_ACTIVE_SHORTAGES_RELEASE = Object.freeze({enabled:true,requiredMigration:"20261029110000"});
export function isWorkOrderActiveShortagesEnabled():boolean {
  return WORK_ORDER_ACTIVE_SHORTAGES_RELEASE.enabled && isWorkOrderNotificationsEnabled();
}
