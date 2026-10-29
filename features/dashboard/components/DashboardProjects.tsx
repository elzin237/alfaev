import { FolderKanban } from "lucide-react";
import { Link } from "react-router";

import StatusBadge from "../../../shared/components/StatusBadge";
import { getProjectStatusPresentation } from "../../projects/projectStatus";
import type { DashboardProjectsSection } from "../services/dashboardService";
import DashboardSectionHeader from "./DashboardSectionHeader";
import DashboardEmptyState from "./DashboardEmptyState";

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

  const featured = section.recent[0];
  const totalProjects = statusCounts.reduce((total, status) => total + section.statusCounts[status.key], 0);

  return (
    <section
      aria-labelledby="dashboard-projects-title"
      className="@container/project flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm"
    >
      <DashboardSectionHeader
        actionLabel="View all projects"
        actionTo="/projects"
        icon={FolderKanban}
        title="Projects & Production"
        description="Current projects and upcoming deliveries."
        titleId="dashboard-projects-title"
      />

      <div role="region" aria-label="Projects overview content" tabIndex={0} className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-4 focus-visible:outline-2 focus-visible:outline-red-500">
      <div className="overflow-hidden rounded-lg border border-zinc-200/70 bg-gradient-to-b from-white to-slate-50/60">
        {featured && <div className="flex flex-wrap items-center gap-3 p-3">
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-600"><FolderKanban className="size-5" strokeWidth={1.5} /></span>
          <div className="min-w-0 flex-1"><p title={featured.name} className="line-clamp-1 text-sm font-bold text-zinc-950">{featured.name}</p><p title={featured.customerName} className="mt-1 truncate text-xs text-zinc-500">{featured.customerName}</p></div>
          <div className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-2"><StatusBadge {...getProjectStatusPresentation(featured.status)} /><p className="text-right text-[11px] text-zinc-500">Delivery <time className="font-semibold text-zinc-700" dateTime={featured.deliveryDate}>{formatDate(featured.deliveryDate)}</time></p></div>
        </div>}
        <div className="flex flex-wrap justify-between gap-2 border-t border-zinc-100 px-3 pt-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-500"><p>All Project statuses</p><span>{totalProjects} total</span></div>
        <dl className="grid grid-cols-5 gap-x-2 gap-y-2 p-3">
          {statusCounts.map(({ key, label, markerClassName }) => (
            <div key={key} className="min-w-0">
              <dt className="flex min-w-0 flex-col items-start gap-1 text-[9px] leading-3 text-zinc-600">
                <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${markerClassName}`} />
                <span title={label} className="h-6 w-full break-words">{label}</span>
              </dt>
              <dd className="mt-1 text-base font-bold tabular-nums text-zinc-800">
                {section.statusCounts[key]}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="min-w-0">
        <h3 className="mb-2 text-xs font-bold text-zinc-900">
          Recent Projects
        </h3>
        {section.recent.length === 0 ? (
          <DashboardEmptyState icon={FolderKanban} title="No projects yet." description="Your authorized Project overview will appear here as work gets underway." />
        ) : (
          <div role="region" aria-label="Recent Projects table" tabIndex={0} className="overflow-x-auto rounded-lg border border-zinc-100 focus-visible:outline-2 focus-visible:outline-red-500"><table className="w-full min-w-80 text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-zinc-500"><tr>{["Project", "Customer", "Status", "Delivery"].map(label=><th scope="col" key={label} className="px-2 py-2 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-zinc-100">
            {section.recent.map((project) => {
              const status = getProjectStatusPresentation(project.status);
              return (
                <tr
                  key={project.id}
                  className="text-xs"
                >
                  <td className="min-w-24 max-w-40 px-2 py-3">
                    <Link
                      to={`/projects/${project.id}`}
                      title={project.name}
                      className="line-clamp-2 break-words rounded-sm text-xs font-semibold text-zinc-900 underline-offset-4 transition hover:text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2"
                    >
                      {project.name}
                    </Link>
                  </td>
                  <td className="max-w-28 break-words px-2 py-3 text-[11px] text-zinc-500">{project.customerName}</td>
                  <td className="px-2 py-3"><StatusBadge label={status.label} tone={status.tone} /></td>
                  <td className="px-2 py-3 text-[11px] text-zinc-500">
                    <time dateTime={project.deliveryDate}>{formatDate(project.deliveryDate)}</time>
                  </td>
                </tr>
              );
            })}
          </tbody></table></div>
        )}
      </div>
      </div>
    </section>
  );
}

export default DashboardProjects;
