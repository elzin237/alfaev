import { useMemo, useState, type ReactNode } from "react";

import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import CreateProjectDialog from "./components/CreateProjectDialog";
import ProjectList from "./components/ProjectList";
import { useProjectCreation } from "./hooks/useProjectCreation";
import { useProjects } from "./hooks/useProjects";
import {
  isProjectStatusFilter,
  projectStatusOptions,
  type ProjectStatusFilter,
} from "./projectStatus";

function ProjectsPage() {
  const projectsQuery = useProjects();
  const { canCreate, create } = useProjectCreation();
  const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter>("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const projects = projectsQuery.data?.ok ? projectsQuery.data.value : [];
  const filteredProjects = useMemo(
    () => statusFilter === "all"
      ? projects
      : projects.filter((project) => project.status === statusFilter),
    [projects, statusFilter],
  );

  let content: ReactNode;

  if (projectsQuery.isPending) {
    content = <LoadingState message="Loading Projects..." />;
  } else if (projectsQuery.isError || !projectsQuery.data?.ok) {
    content = (
      <ErrorState
        title="Unable to load Projects"
        message={
          projectsQuery.data?.ok === false
            ? projectsQuery.data.error.message
            : "The Project list could not be loaded."
        }
        onRetry={() => void projectsQuery.refetch()}
      />
    );
  } else if (projects.length === 0) {
    content = (
      <EmptyState
        title="No Projects found"
        description="There are no Projects to display."
      />
    );
  } else if (filteredProjects.length === 0) {
    content = (
      <EmptyState
        title="No matching Projects"
        description="No Projects match the selected status."
        action={{ label: "Show all Projects", onClick: () => setStatusFilter("all") }}
      />
    );
  } else {
    content = <ProjectList projects={filteredProjects} />;
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Projects"
        description="Track AlfaEV Projects, current status, and delivery dates."
        actions={canCreate ? (
          <button
            type="button"
            onClick={() => {
              setSuccessMessage(null);
              setIsCreateOpen(true);
            }}
            className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
          >
            Create Project
          </button>
        ) : undefined}
      />

      {successMessage && (
        <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800">
          {successMessage}
        </p>
      )}

      {!projectsQuery.isPending && projectsQuery.data?.ok && projects.length > 0 && (
        <div className="max-w-sm rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
          <label
            htmlFor="project-status-filter"
            className="block text-sm font-semibold text-zinc-800"
          >
            Filter by status
          </label>
          <select
            id="project-status-filter"
            value={statusFilter}
            onChange={(event) => {
              if (isProjectStatusFilter(event.target.value)) {
                setStatusFilter(event.target.value);
              }
            }}
            className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
          >
            {projectStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {content}

      <CreateProjectDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={create}
        onCreated={() => setSuccessMessage("Project created.")}
      />
    </section>
  );
}

export default ProjectsPage;
