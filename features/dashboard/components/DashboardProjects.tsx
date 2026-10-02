import { FolderKanban } from "lucide-react";
import { Link } from "react-router";

import StatusBadge from "../../../shared/components/StatusBadge";
import { getProjectStatusPresentation } from "../../projects/projectStatus";
import type { DashboardProjectsSection } from "../services/dashboardService";
import DashboardSectionHeader from "./DashboardSectionHeader";

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
      className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04),0_12px_30px_rgba(24,24,27,0.04)]"
    >
      <DashboardSectionHeader
        actionLabel="View all projects"
        actionTo="/projects"
        icon={FolderKanban}
        title="Projects"
        titleId="dashboard-projects-title"
      />

      <div className="border-b border-zinc-100 px-5 py-4">
        <div className="flex items-end justify-between gap-4">
          <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-zinc-500">
            Project status overview
          </h3>
          <p className="text-xs font-medium tabular-nums text-zinc-500">
            {totalProjects} {totalProjects === 1 ? "project" : "projects"}
          </p>
        </div>
        <div
          role="img"
          aria-label={`Project status distribution based on ${totalProjects} ${totalProjects === 1 ? "project" : "projects"}`}
          className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-zinc-100 ring-1 ring-inset ring-zinc-200"
        >
          {totalProjects > 0 && statusCounts.map(({ key, label, segmentClassName }) => {
            const count = section.statusCounts[key];
            if (count === 0) return null;
            return (
              <span
                key={key}
                title={`${label}: ${count}`}
                className={segmentClassName}
                style={{ width: `${(count / totalProjects) * 100}%` }}
              />
            );
          })}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
          {statusCounts.map(({ key, label, markerClassName }) => (
            <div key={key} className="min-w-0">
              <dt className="flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-wide text-zinc-500">
                <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${markerClassName}`} />
                <span className="truncate">{label}</span>
              </dt>
              <dd className="mt-1 pl-4 text-lg font-bold leading-none tabular-nums text-zinc-950">
                {section.statusCounts[key]}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="px-5 py-4">
        <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-zinc-500">
          Recent Projects
        </h3>
        {section.recent.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No projects yet.</p>
        ) : (
          <ul className="mt-1.5 divide-y divide-zinc-100">
            {section.recent.map((project) => {
              const status = getProjectStatusPresentation(project.status);
              return (
                <li
                  key={project.id}
                  className="grid gap-2 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
                >
                  <div className="min-w-0">
                    <Link
                      to={`/projects/${project.id}`}
                      className="rounded-sm font-semibold text-zinc-900 underline-offset-4 transition hover:text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2"
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
