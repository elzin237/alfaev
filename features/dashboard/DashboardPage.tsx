import { ClipboardList, FolderKanban, Package, ShoppingCart } from "lucide-react";

import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import DashboardAlertsControl from "./components/DashboardAlertsControl";
import DashboardOperations from "./components/DashboardOperations";
import DashboardSummaryMetric from "./components/DashboardSummaryMetric";
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
                description="Planned, in progress and on hold"
              />
            )}
            {workOrders !== null && (
              <DashboardSummaryMetric
                icon={ClipboardList}
                label="Recent Work Orders"
                value={workOrders.recent.length}
                description="Most recently updated Work Orders"
              />
            )}
            {procurement !== null && (
              <DashboardSummaryMetric
                icon={ShoppingCart}
                label="Unresolved Procurement"
                value={procurement.unresolvedCount}
                description="Requests awaiting completion"
              />
            )}
            {inventory !== null && (
              <DashboardSummaryMetric
                icon={Package}
                label="Active Products"
                value={inventory.activeProductCount}
                description="Active Products in the catalog"
              />
            )}
          </section>
        )}
        <DashboardOperations data={dashboardQuery.data.value} />
      </div>
    );
  }

  return (
    <section className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
            Operations Dashboard
          </h1>
          <p className="mt-1 text-sm leading-5 text-zinc-500">
            Production, inventory and procurement at a glance.
          </p>
        </div>
        <DashboardAlertsControl />
      </header>
      {content}
    </section>
  );
}

export default DashboardPage;
