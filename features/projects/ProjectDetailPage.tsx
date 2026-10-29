import { useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";

import ConfirmDialog from "../../shared/components/ConfirmDialog";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import ProjectEditDialog from "./components/ProjectEditDialog";
import { ProjectActivitySection } from "./components/ProjectActivitySection";
import { ProjectMaterialUsageSection } from "./components/ProjectMaterialUsageSection";
import { ProjectPlanningSection } from "./components/ProjectPlanningSection";
import { ProjectFinishedGoodsSection } from "./components/ProjectFinishedGoodsSection";
import { useProjectDetail } from "./hooks/useProjectDetail";
import { parseProjectActivityHash } from "./projectActivityDeepLink";
import {
  getProjectStatusPresentation,
  isProjectEditableStatus,
} from "./projectStatus";
import { isProjectId } from "./services/projectService";

const projectDateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

const timestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatProjectDate(value: string): string {
  return projectDateFormatter.format(new Date(`${value}T00:00:00.000Z`));
}

function formatTimestamp(value: string): string {
  return timestampFormatter.format(new Date(value));
}

function ProjectDetailPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const location = useLocation();
  const activityTarget = parseProjectActivityHash(location.hash);
  const { projectQuery, canEdit, canCancel, canReopen, update, cancel, reopen } =
    useProjectDetail(projectId);
  const cancellationLockRef = useRef(false);
  const reopenLockRef = useRef(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isReopenOpen, setIsReopenOpen] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function confirmCancellation() {
    if (cancellationLockRef.current) return;
    cancellationLockRef.current = true;
    setIsCancelling(true);
    setActionError(null);
    try {
      const result = await cancel();
      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }
      setIsCancelOpen(false);
      setSuccessMessage("Project cancelled.");
    } finally {
      cancellationLockRef.current = false;
      setIsCancelling(false);
    }
  }

  async function confirmReopen() {
    if (reopenLockRef.current) return;
    reopenLockRef.current = true;
    setIsReopening(true);
    setActionError(null);
    try {
      const result = await reopen();
      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }
      setIsReopenOpen(false);
      setSuccessMessage("Project reopened.");
    } finally {
      reopenLockRef.current = false;
      setIsReopening(false);
    }
  }
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
    const showEdit = canEdit && !["completed", "cancelled"].includes(
      project.status,
    );
    const showCancel = canCancel && [
      "planned",
      "in_progress",
      "on_hold",
    ].includes(project.status);
    const showReopen = canReopen && project.status === "completed";

    content = (
      <>
          <section aria-label="Project overview" className="min-w-0 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Project Overview
                </p>
                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <h2 className="min-w-0 text-2xl font-bold tracking-tight text-zinc-900 [overflow-wrap:anywhere] sm:text-3xl">
                    {project.name}
                  </h2>
                  <StatusBadge label={status.label} tone={status.tone} />
                </div>
              </div>
              {(showEdit || showCancel || showReopen) && <div role="group" aria-label="Project actions" className="flex shrink-0 flex-wrap items-center gap-2">
                {showEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setSuccessMessage(null);
                      setActionError(null);
                      setIsEditOpen(true);
                    }}
                    className="min-h-11 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
                  >
                    Edit Project
                  </button>
                )}
                {showCancel && (
                  <button
                    type="button"
                    onClick={() => {
                      setSuccessMessage(null);
                      setActionError(null);
                      setIsCancelOpen(true);
                    }}
                    className="min-h-11 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2"
                  >
                    Cancel Project
                  </button>
                )}
                {showReopen && (
                  <button
                    type="button"
                    onClick={() => {
                      setSuccessMessage(null);
                      setActionError(null);
                      setIsReopenOpen(true);
                    }}
                    className="min-h-11 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
                  >
                    Reopen Project
                  </button>
                )}
              </div>}
            </div>

            <dl className="mt-5 grid min-w-0 gap-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-3 sm:gap-5">
              <div className="min-w-0">
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Customer
                </dt>
                <dd className="mt-1 text-sm font-semibold leading-6 text-zinc-900 [overflow-wrap:anywhere]">
                  {project.customerName}
                </dd>
              </div>
              <div className="min-w-0 sm:border-l sm:border-zinc-200 sm:pl-5">
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Start Date
                </dt>
                <dd className="mt-1 text-sm font-semibold leading-6 text-zinc-900">
                  <time dateTime={project.startDate}>
                    {formatProjectDate(project.startDate)}
                  </time>
                </dd>
              </div>
              <div className="min-w-0 sm:border-l sm:border-zinc-200 sm:pl-5">
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Delivery Date
                </dt>
                <dd className="mt-1 text-sm font-semibold leading-6 text-zinc-900">
                  <time dateTime={project.deliveryDate}>
                    {formatProjectDate(project.deliveryDate)}
                  </time>
                </dd>
              </div>
            </dl>
            <dl aria-label="Project record metadata" className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs leading-5 text-zinc-500">
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium">
                  Created
                </dt>
                <dd>
                  <time dateTime={project.createdAt}>{formatTimestamp(project.createdAt)}</time>
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium">
                  Last updated
                </dt>
                <dd>
                  <time dateTime={project.updatedAt}>{formatTimestamp(project.updatedAt)}</time>
                </dd>
              </div>
            </dl>
          </section>

        <ProjectPlanningSection projectId={project.id} status={project.status} />

        <ProjectFinishedGoodsSection projectId={project.id} status={project.status} />

        <ProjectMaterialUsageSection projectId={project.id} />

        <ProjectActivitySection
          projectId={project.id}
          status={project.status}
          activityTarget={activityTarget}
          activityTargetNavigationKey={location.key}
          onProjectUnavailable={() => projectQuery.refetch()}
        />

        <ProjectEditDialog
          open={isEditOpen}
          currentStatus={project.status}
          initialValues={{
            name: project.name,
            customerName: project.customerName,
            startDate: project.startDate,
            deliveryDate: project.deliveryDate,
            status: isProjectEditableStatus(project.status)
              ? project.status
              : "planned",
          }}
          onClose={() => setIsEditOpen(false)}
          onSubmit={update}
          onSucceeded={() => setSuccessMessage("Project updated.")}
        />

        <ConfirmDialog
          open={isCancelOpen}
          title="Cancel Project"
          description={`Cancel ${project.name}? The Project will remain in historical records and cannot be restored in the current workflow.`}
          confirmLabel="Cancel Project"
          confirmVariant="danger"
          isSubmitting={isCancelling}
          onCancel={() => {
            if (!isCancelling) setIsCancelOpen(false);
          }}
          onConfirm={() => void confirmCancellation()}
        />

        <ConfirmDialog
          open={isReopenOpen}
          title="Reopen Project"
          description={`Reopen ${project.name}? Its status will change from Completed back to In Progress.`}
          confirmLabel="Reopen Project"
          isSubmitting={isReopening}
          onCancel={() => {
            if (!isReopening) setIsReopenOpen(false);
          }}
          onConfirm={() => void confirmReopen()}
        />
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

      {successMessage && (
        <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800">
          {successMessage}
        </p>
      )}
      {actionError && (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
          {actionError}
        </p>
      )}

      {content}
    </section>
  );
}

export default ProjectDetailPage;
