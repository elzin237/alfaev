import StatusBadge from "../../../shared/components/StatusBadge";
import { getProjectStatusPresentation } from "../projectStatus";
import type { ProjectListItem } from "../services/projectService";

export interface ProjectListProps {
  projects: ProjectListItem[];
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function formatProjectDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T00:00:00.000Z`));
}

function ProjectList({ projects }: ProjectListProps) {
  return (
    <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              {["Project Name", "Customer", "Status", "Start Date", "Delivery Date"].map(
                (heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500"
                  >
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {projects.map((project) => {
              const status = getProjectStatusPresentation(project.status);

              return (
                <tr key={project.id} className="text-sm text-zinc-700">
                  <th
                    scope="row"
                    className="px-5 py-4 text-left font-semibold text-zinc-900"
                  >
                    {project.name}
                  </th>
                  <td className="px-5 py-4">{project.customerName}</td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <StatusBadge label={status.label} tone={status.tone} />
                  </td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <time dateTime={project.startDate}>
                      {formatProjectDate(project.startDate)}
                    </time>
                  </td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <time dateTime={project.deliveryDate}>
                      {formatProjectDate(project.deliveryDate)}
                    </time>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ProjectList;
