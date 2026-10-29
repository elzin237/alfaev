import { ClipboardList, FolderKanban, Package, ShoppingCart } from "lucide-react";

import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import DashboardActivity from "./components/DashboardActivity";
import DashboardAlertsControl from "./components/DashboardAlertsControl";
import DashboardCalendar from "./components/DashboardCalendar";
import DashboardStockHealthPanels from "./components/DashboardStockHealthPanels";
import DashboardProcurement from "./components/DashboardProcurement";
import DashboardProjects from "./components/DashboardProjects";
import DashboardSummaryMetric from "./components/DashboardSummaryMetric";
import DashboardWorkOrders from "./components/DashboardWorkOrders";
import { useDashboard } from "./hooks/useDashboard";

function DashboardPage() {
  const dashboardQuery = useDashboard();

  let content;
  if (dashboardQuery.isPending) {
    content = <LoadingState message="Loading Dashboard..." />;
  } else if (dashboardQuery.isError || !dashboardQuery.data?.ok) {
    content = (
      <ErrorState
        title="Unable to load Dashboard"
        message={dashboardQuery.data?.ok === false
          ? dashboardQuery.data.error.message
          : "The Dashboard overview could not be loaded."}
        onRetry={() => void dashboardQuery.refetch()}
      />
    );
  } else {
    const {
      projects,
      workOrders,
      procurement,
      inventory,
      activity,
      calendar,
    } = dashboardQuery.data.value;
    const summaryVisible = projects !== null || workOrders !== null || procurement !== null || inventory !== null;
    const activeProjectCount = projects === null
      ? null
      : projects.statusCounts.planned
        + projects.statusCounts.inProgress
        + projects.statusCounts.onHold;
    content = (
      <div className="@container space-y-4">
        {summaryVisible && (
          <section
            aria-label="Dashboard summary"
            className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-4"
          >
            {activeProjectCount !== null && (
              <DashboardSummaryMetric
                icon={FolderKanban}
                label="Active Projects"
                value={activeProjectCount}
              />
            )}
            {workOrders !== null && (
              <DashboardSummaryMetric
                icon={ClipboardList}
                label="Recent Work Orders"
                value={workOrders.recent.length}
              />
            )}
            {procurement !== null && (
              <DashboardSummaryMetric
                icon={ShoppingCart}
                label="Unresolved Procurement"
                value={procurement.unresolvedCount}
              />
            )}
            {inventory !== null && (
              <DashboardSummaryMetric
                icon={Package}
                label="Active Products"
                value={inventory.activeProductCount}
              />
            )}
          </section>
        )}
        <DashboardStockHealthPanels legacyInventory={inventory} />
        {(projects !== null || procurement !== null) && (
          <div className={`grid items-stretch gap-4 ${projects !== null && procurement !== null ? "@4xl:grid-cols-[1.45fr_1fr]" : ""}`}>
            <DashboardProjects section={projects} />
            <DashboardProcurement section={procurement} />
          </div>
        )}
        <div className="grid items-stretch gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
          <DashboardWorkOrders section={workOrders} />
          <DashboardActivity section={activity} />
          <DashboardCalendar section={calendar} />
        </div>
      </div>
    );
  }

  return (
    <section className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950">
            Dashboard
          </h1>
          <p className="mt-1 text-sm leading-5 text-zinc-500">
            Overview of your operations, inventory, procurement and projects.
          </p>
        </div>
        <DashboardAlertsControl />
      </header>
      {content}
    </section>
  );
}

export default DashboardPage;
