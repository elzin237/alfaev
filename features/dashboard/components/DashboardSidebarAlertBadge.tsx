import { isActiveAlertsV2Enabled } from "../../../app/config/activeAlertsV2Activation";
import { isWorkOrderActiveShortagesEnabled } from "../../../app/config/workOrderActiveShortagesActivation";
import { useProjectAlertUnreadCount } from "../hooks/useProjectAlerts";
import { useActiveProblemsCountV2 } from "../hooks/useActiveAlertsV2";
import { getDashboardAlertCount, activeProblemBadge } from "../dashboardAlertCount";

const style = "ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold tabular-nums text-white";
function ActiveBadge() {
  const count = useActiveProblemsCountV2();
  const badge = activeProblemBadge(count.value?.activeProblems);
  return badge === null ? null : <span className={style} aria-label={`${count.value!.activeProblems} active problems`}>{badge}</span>;
}
function LegacyBadge() {
  const {access, unreadCountQuery} = useProjectAlertUnreadCount();
  const tracking = isWorkOrderActiveShortagesEnabled();
  const {badgeValue, combinedCount} = getDashboardAlertCount(unreadCountQuery, tracking, access.canRead && !access.permissionsPending);
  return badgeValue === null ? null : <span className={style} aria-label={tracking ? `${combinedCount} combined alert${combinedCount === 1n ? "" : "s"}` : `${badgeValue} unread Project ${badgeValue === "1" ? "alert" : "alerts"}`}>{badgeValue}</span>;
}
export default function DashboardSidebarAlertBadge() {
  return isActiveAlertsV2Enabled() ? <ActiveBadge /> : <LegacyBadge />;
}
