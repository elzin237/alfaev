import { Link } from "react-router";

import StatusBadge from "../../../shared/components/StatusBadge";
import { getProjectStatusPresentation } from "../../projects/projectStatus";
import type { DashboardProjectsSection } from "../services/dashboardService";

export interface DashboardProjectsProps {
  section: DashboardProjectsSection | null;
}

const statusCounts: ReadonlyArray<{
  key: keyof DashboardProjectsSection["statusCounts"];
  label: string;
  open: boolean;
}> = [
  { key: "planned", label: "Planned", open: true },
  { key: "inProgress", label: "In Progress", open: true },
  { key: "onHold", label: "On Hold", open: true },
  { key: "completed", label: "Completed", open: false },
  { key: "cancelled", label: "Cancelled", open: false },
];

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function DashboardProjects({ section }: DashboardProjectsProps) {
  if (section === null) return null;

  return (
    <section
      aria-labelledby="dashboard-projects-title"
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
    >
      <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-4">
        <h2 id="dashboard-projects-title" className="text-lg font-bold text-zinc-900">
          Projects
        </h2>
        <Link
          to="/projects"
          className="rounded-lg text-sm font-semibold text-red-600 underline-offset-4 transition hover:text-red-700 hover:underline focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2"
        >
          View all projects
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-2.5 border-b border-zinc-200 p-4 sm:grid-cols-5 sm:px-5">
        {statusCounts.map(({ key, label, open }) => (
          <div
            key={key}
            className={`rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 ${
              open ? "border-l-2 border-l-red-500" : ""
            }`}
          >
            <dt className="text-[0.68rem] font-bold uppercase tracking-wide text-zinc-500">
              {label}
            </dt>
            <dd className="mt-0.5 text-2xl font-bold tabular-nums text-zinc-950">
              {section.statusCounts[key]}
            </dd>
          </div>
        ))}
      </dl>

      <div className="px-5 py-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
          Recent Projects
        </h3>
        {section.recent.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No projects yet.</p>
        ) : (
          <ul className="mt-1.5 divide-y divide-zinc-200">
            {section.recent.map((project) => {
              const status = getProjectStatusPresentation(project.status);
              return (
                <li
                  key={project.id}
                  className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
                >
                  <div className="min-w-0">
                    <Link
                      to={`/projects/${project.id}`}
                      className="font-semibold text-zinc-900 underline-offset-4 transition hover:text-red-700 hover:underline focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2"
                    >
                      {project.name}
                    </Link>
                    <p className="mt-0.5 truncate text-sm text-zinc-500">
                      {project.customerName}
                    </p>
                  </div>
                  <p className="text-xs text-zinc-500 sm:text-right">
                    <span className="block font-medium text-zinc-700">Delivery</span>
                    <time dateTime={project.deliveryDate}>{formatDate(project.deliveryDate)}</time>
                  </p>
                  <StatusBadge label={status.label} tone={status.tone} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export default DashboardProjects;
