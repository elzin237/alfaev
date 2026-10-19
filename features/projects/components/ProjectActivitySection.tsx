import { useState } from "react";
import { CircleCheck } from "lucide-react";

import type { ProjectStatus } from "../projectStatus";
import {
  useProjectActivity,
  useProjectActivityPermissions,
} from "../hooks/useProjectActivity";
import ProjectActivityComposer from "./ProjectActivityComposer";
import ProjectActivityTimeline from "./ProjectActivityTimeline";

interface ProjectActivitySectionProps {
  projectId: string;
  status: ProjectStatus;
  onProjectUnavailable?: () => Promise<unknown> | unknown;
}

export function ProjectActivitySection({
  projectId,
  status,
  onProjectUnavailable,
}: ProjectActivitySectionProps) {
  const { canPost, canSendAlert, permissionsPending } =
    useProjectActivityPermissions(status);
  const { activityQuery, items, reconcilePostedActivity } =
    useProjectActivity(projectId);
  const closed = status === "completed" || status === "cancelled";
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [scrollActivityId, setScrollActivityId] = useState<string | null>(null);

  async function handleActivityChanged(
    activityId: string,
    shouldScroll: boolean,
  ) {
    const item = await reconcilePostedActivity(activityId);
    if (item && shouldScroll) setScrollActivityId(item.activityId);
  }

  return (
    <section aria-labelledby="project-activity-heading" className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-700">
          Activity
        </p>
        <h2 id="project-activity-heading" className="mt-2 text-2xl font-bold text-zinc-900">
          Project Activity
        </h2>
        <p className="mt-2 text-sm text-zinc-600">
          Project updates, discussions, and reported issues.
        </p>
      </header>

      <div className="mt-6 space-y-6">
        <ProjectActivityComposer
          projectId={projectId}
          canSendAlert={canSendAlert}
          visible={canPost}
          onActivityChanged={handleActivityChanged}
          onCompleted={(sendAlert) => setSuccessMessage(
            sendAlert
              ? "Update posted and alert sent"
              : "Update posted successfully",
          )}
          onProjectUnavailable={onProjectUnavailable}
        />
        {!canPost && (permissionsPending ? (
          <p role="status" className="rounded-2xl bg-zinc-50 px-5 py-4 text-sm text-zinc-600">
            Checking Activity permissions...
          </p>
        ) : (
          <p className="rounded-2xl border border-zinc-200 bg-zinc-50 px-5 py-4 text-sm text-zinc-600">
            {closed
              ? "This Project is read-only. Its Activity history remains available."
              : "You can view Project Activity, but you cannot post updates."}
          </p>
        ))}

        {successMessage && (
          <p role="status" aria-live="polite" className="inline-flex max-w-full items-center gap-2 text-sm font-semibold text-emerald-700">
            <CircleCheck aria-hidden="true" size={18} className="shrink-0" />
            {successMessage}
          </p>
        )}

        <div>
          <h3
            id="project-recent-activity-heading"
            className="mb-4 text-lg font-bold text-zinc-900"
          >
            Recent activity
          </h3>
          <ProjectActivityTimeline
            projectId={projectId}
            labelledBy="project-recent-activity-heading"
            items={items}
            isPending={activityQuery.isPending}
            isError={activityQuery.isError}
            hasNextPage={activityQuery.hasNextPage}
            isFetchingNextPage={activityQuery.isFetchingNextPage}
            onRetry={() => void activityQuery.refetch()}
            onLoadMore={() => void activityQuery.fetchNextPage()}
            scrollToActivityId={scrollActivityId}
            onScrollComplete={() => setScrollActivityId(null)}
          />
        </div>
      </div>
    </section>
  );
}
