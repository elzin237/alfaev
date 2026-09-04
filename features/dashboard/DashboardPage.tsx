import DashboardStats from "./components/DashboardStats";
import DashboardProjects from "./components/DashboardProjects";
import DashboardAlerts from "./components/DashboardAlerts";
import DashboardProjectProgress from "./components/project-progress/DashboardProjectProgress";
import DashboardLowStock from "./components/DashboardLowStock";

function DashboardPage() {
  return (
    <div className="space-y-6">
      <DashboardStats />

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <DashboardProjects />
        <DashboardAlerts />
      </div>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <DashboardProjectProgress />
        <DashboardLowStock />
      </div>
    </div>
  );
}

export default DashboardPage;
