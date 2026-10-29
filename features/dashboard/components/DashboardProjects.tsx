import { FolderKanban } from "lucide-react";
import { Link } from "react-router";

import StatusBadge from "../../../shared/components/StatusBadge";
import { getProjectStatusPresentation } from "../../projects/projectStatus";
import type { DashboardProjectsSection } from "../services/dashboardService";
import DashboardSectionHeader from "./DashboardSectionHeader";
import DashboardEmptyState from "./DashboardEmptyState";
import DashboardProjectDonut from "./DashboardProjectDonut";

export interface DashboardProjectsProps {
  section: DashboardProjectsSection | null;
}

const statusCounts: ReadonlyArray<{
  key: keyof DashboardProjectsSection["statusCounts"];
  label: string;
  segmentClassName: string;
  markerClassName: string;
}> = [
  {
    key: "planned",
    label: "Planned",
    segmentClassName: "bg-sky-500",
    markerClassName: "bg-sky-500",
  },
  {
    key: "inProgress",
    label: "In Progress",
    segmentClassName: "bg-red-500",
    markerClassName: "bg-red-500",
  },
  {
    key: "onHold",
    label: "On Hold",
    segmentClassName: "bg-amber-400",
    markerClassName: "bg-amber-400",
  },
  {
    key: "completed",
    label: "Completed",
    segmentClassName: "bg-emerald-500",
    markerClassName: "bg-emerald-500",
  },
  {
    key: "cancelled",
    label: "Cancelled",
    segmentClassName: "bg-zinc-400",
    markerClassName: "bg-zinc-400",
  },
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

  const totalProjects = statusCounts.reduce(
    (total, status) => total + section.statusCounts[status.key],
    0,
  );

  return (
    <section
      aria-labelledby="dashboard-projects-title"
      className="h-full min-w-0 overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm"
    >
      <DashboardSectionHeader
        actionLabel="View all projects"
        actionTo="/projects"
        icon={FolderKanban}
        title="Projects Overview"
        titleId="dashboard-projects-title"
      />

      <div className="grid gap-5 px-4 pb-4 @5xl:grid-cols-[minmax(15rem,.9fr)_minmax(0,1fr)]">
      <div className="flex flex-wrap items-center justify-center gap-4 py-2">
        <DashboardProjectDonut total={totalProjects} segments={statusCounts.map((status, index) => ({
          label: status.label, value: section.statusCounts[status.key],
          color: ["#0ea5e9", "#ef4444", "#fbbf24", "#10b981", "#a1a1aa"][index]!,
        }))} />
        <dl className="min-w-28 flex-1 space-y-2.5">
          {statusCounts.map(({ key, label, markerClassName }) => (
            <div key={key} className="flex min-w-0 items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-xs text-zinc-600">
                <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${markerClassName}`} />
                <span className="break-words">{label}</span>
              </dt>
              <dd className="text-xs font-bold tabular-nums text-zinc-800">
                {section.statusCounts[key]}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="min-w-0">
        <h3 className="mb-2 text-xs font-semibold text-zinc-700">
          Recent Projects
        </h3>
        {section.recent.length === 0 ? (
          <DashboardEmptyState icon={FolderKanban} title="No projects yet." description="Your authorized Project overview will appear here as work gets underway." />
        ) : (
          <ul className="mt-1.5 divide-y divide-zinc-100">
            {section.recent.map((project) => {
              const status = getProjectStatusPresentation(project.status);
              return (
                <li
                  key={project.id}
                  className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1 basis-40">
                    <Link
                      to={`/projects/${project.id}`}
                      className="break-words rounded-sm text-xs font-semibold text-zinc-900 underline-offset-4 transition hover:text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2"
                    >
                      {project.name}
                    </Link>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">
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
      </div>
    </section>
  );
}

export default DashboardProjects;
