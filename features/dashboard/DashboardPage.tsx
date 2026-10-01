import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import DashboardProjects from "./components/DashboardProjects";
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
    const { projects, workOrders } = dashboardQuery.data.value;
    content = projects === null && workOrders === null ? (
      <EmptyState title="No Project or Work Order overview is available for your account." />
    ) : (
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <DashboardProjects section={projects} />
        <DashboardWorkOrders section={workOrders} />
      </div>
    );
  }

  return (
    <section className="space-y-5">
      <header className="pt-1">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-950 lg:text-4xl">
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
