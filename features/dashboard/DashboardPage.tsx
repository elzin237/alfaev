import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import DashboardInventory from "./components/DashboardInventory";
import DashboardProcurement from "./components/DashboardProcurement";
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
    const { projects, workOrders, procurement, inventory } = dashboardQuery.data.value;
    const task141Visible = projects !== null || workOrders !== null;
    const task142Visible = procurement !== null || inventory !== null;
    content = !task141Visible && !task142Visible ? (
      <EmptyState title="No operational overview is available for your account." />
    ) : (
      <div className="space-y-5">
        {task141Visible && (
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <DashboardProjects section={projects} />
            <DashboardWorkOrders section={workOrders} />
          </div>
        )}
        {task142Visible && (
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <DashboardProcurement section={procurement} />
            <DashboardInventory section={inventory} />
          </div>
        )}
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
