import { ClipboardList, FolderKanban, Package, ShoppingCart } from "lucide-react";

import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import DashboardActivity from "./components/DashboardActivity";
import DashboardCalendar from "./components/DashboardCalendar";
import DashboardInventory from "./components/DashboardInventory";
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
    const task141Visible = projects !== null || workOrders !== null;
    const task142Visible = procurement !== null || inventory !== null;
    const summaryVisible = task141Visible || task142Visible;
    const activeProjectCount = projects === null
      ? null
      : projects.statusCounts.planned
        + projects.statusCounts.inProgress
        + projects.statusCounts.onHold;
    content = (
      <div className="space-y-6">
        {summaryVisible && (
          <section
            aria-label="Dashboard summary"
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
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
        {task141Visible && (
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <DashboardProjects section={projects} />
            <DashboardWorkOrders section={workOrders} />
          </div>
        )}
        {task142Visible && (
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <DashboardProcurement section={procurement} />
            <DashboardInventory section={inventory} />
          </div>
        )}
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <DashboardActivity section={activity} />
          <DashboardCalendar section={calendar} />
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <header className="border-b border-zinc-200 pb-5 pt-1">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-950">
          Dashboard
        </h1>
        <p className="mt-1.5 text-sm leading-6 text-zinc-600 sm:text-base">
          Overview of the work and projects available to you.
        </p>
      </header>
      {content}
    </section>
  );
}

export default DashboardPage;
