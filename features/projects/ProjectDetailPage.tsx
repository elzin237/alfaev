import type { ReactNode } from "react";
import { Link, useParams } from "react-router";

import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import { useProjectDetail } from "./hooks/useProjectDetail";
import { getProjectStatusPresentation } from "./projectStatus";
import { isProjectId } from "./services/projectService";

const projectDateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

const timestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

const relatedPlaceholders = [
  {
    title: "Material Usage",
    description: "No material usage data is available in this section yet.",
  },
  {
    title: "Related Work Orders",
    description: "Project work orders will appear here when that module is connected.",
  },
  {
    title: "PCB Production",
    description: "Project PCB production will appear here when that module is connected.",
  },
  {
    title: "Activity",
    description: "Project activity will appear here when audit history is connected.",
  },
] as const;

function formatProjectDate(value: string): string {
  return projectDateFormatter.format(new Date(`${value}T00:00:00.000Z`));
}

function formatTimestamp(value: string): string {
  return timestampFormatter.format(new Date(value));
}

function ProjectDetailPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const projectQuery = useProjectDetail(projectId);
  let content: ReactNode;

  if (!isProjectId(projectId)) {
    content = (
      <ErrorState
        title="Project not found"
        message="The Project could not be found."
      />
    );
  } else if (projectQuery.isPending) {
    content = <LoadingState message="Loading Project details..." />;
  } else if (projectQuery.isError || !projectQuery.data?.ok) {
    const isNotFound = projectQuery.data?.ok === false &&
      projectQuery.data.error.code === "project_not_found";
    content = (
      <ErrorState
        title={isNotFound ? "Project not found" : "Unable to load Project"}
        message={
          projectQuery.data?.ok === false
            ? projectQuery.data.error.message
            : "The Project details could not be loaded."
        }
        onRetry={isNotFound ? undefined : () => void projectQuery.refetch()}
      />
    );
  } else {
    const project = projectQuery.data.value;
    const status = getProjectStatusPresentation(project.status);

    content = (
      <>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Project
            </p>
            <h2 className="mt-2 text-2xl font-bold text-zinc-900">
              {project.name}
            </h2>

            <dl className="mt-8 grid gap-6 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Customer
                </dt>
                <dd className="mt-2 text-sm font-medium text-zinc-900">
                  {project.customerName}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Status
                </dt>
                <dd className="mt-2">
                  <StatusBadge label={status.label} tone={status.tone} />
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Start Date
                </dt>
                <dd className="mt-2 text-sm font-medium text-zinc-900">
                  <time dateTime={project.startDate}>
                    {formatProjectDate(project.startDate)}
                  </time>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Delivery Date
                </dt>
                <dd className="mt-2 text-sm font-medium text-zinc-900">
                  <time dateTime={project.deliveryDate}>
                    {formatProjectDate(project.deliveryDate)}
                  </time>
                </dd>
              </div>
            </dl>
          </section>

          <aside className="h-fit rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-zinc-900">Project record</h2>
            <dl className="mt-5 space-y-5">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Created
                </dt>
                <dd className="mt-1 text-sm font-medium text-zinc-900">
                  {formatTimestamp(project.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Last updated
                </dt>
                <dd className="mt-1 text-sm font-medium text-zinc-900">
                  {formatTimestamp(project.updatedAt)}
                </dd>
              </div>
            </dl>
          </aside>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          {relatedPlaceholders.map((placeholder) => (
            <section key={placeholder.title} aria-label={placeholder.title}>
              <EmptyState
                title={placeholder.title}
                description={placeholder.description}
              />
            </section>
          ))}
        </div>
      </>
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Project Detail"
        description="View Project dates, lifecycle status, and related sections."
        actions={
          <Link
            to="/projects"
            className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-300 focus:ring-offset-2"
          >
            Back to Projects
          </Link>
        }
      />

      {content}
    </section>
  );
}

export default ProjectDetailPage;
