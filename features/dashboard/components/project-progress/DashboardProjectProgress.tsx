import ProjectProgressHeader from "./ProjectProgressHeader";
import ProjectProgressTable from "./ProjectProgressTable";

function DashboardProjectProgress() {
  return (
    <section className="h-full overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <ProjectProgressHeader />
      <ProjectProgressTable />
    </section>
  );
}

export default DashboardProjectProgress;
