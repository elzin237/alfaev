import { useEffect, useRef } from "react";

import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import type { ProjectActivityItem } from "../services/projectActivityService";
import ProjectActivityImage from "./ProjectActivityImage";

const activityTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface ProjectActivityTimelineProps {
  projectId: string;
  labelledBy: string;
  items: ProjectActivityItem[];
  isPending: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  scrollToActivityId?: string | null;
  onScrollComplete?: () => void;
}

function ProjectActivityTimeline({
  projectId,
  labelledBy,
  items,
  isPending,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onRetry,
  onLoadMore,
  scrollToActivityId = null,
  onScrollComplete,
}: ProjectActivityTimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    if (!scrollToActivityId) return;
    const element = itemRefs.current.get(scrollToActivityId);
    const container = scrollContainerRef.current;
    if (!element || !container) return;
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches ?? false;
    container.scrollTo({
      top: 0,
      behavior: reduceMotion ? "auto" : "smooth",
    });
    onScrollComplete?.();
  }, [items, onScrollComplete, scrollToActivityId]);

  if (isPending) return <LoadingState message="Loading Project Activity..." />;
  if (isError) {
    return (
      <ErrorState
        title="Unable to load Activity"
        message="Project Activity could not be loaded."
        onRetry={onRetry}
      />
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 px-5 py-7 text-center">
        <h3 className="font-semibold text-zinc-900">No project updates yet.</h3>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      role="region"
      tabIndex={0}
      aria-labelledby={labelledBy}
      className="max-h-[42rem] max-w-full overflow-x-hidden overflow-y-auto pr-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
    >
      <ol aria-label="Project Activity timeline" className="space-y-3">
        {items.map((item) => (
          <li
            key={item.activityId}
            ref={(element) => {
              if (element) itemRefs.current.set(item.activityId, element);
              else itemRefs.current.delete(item.activityId);
            }}
            data-activity-id={item.activityId}
            className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5"
          >
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="break-words text-base font-bold text-zinc-900">
                  {item.title}
                </h3>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {item.authorFullName} ·{" "}
                  <time dateTime={item.createdAt}>
                    {activityTimestampFormatter.format(new Date(item.createdAt))}
                  </time>
                </p>
              </div>
              {item.alertSent && (
                <span className="w-fit shrink-0 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                  Alert sent
                </span>
              )}
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700">
              {item.description}
            </p>
            {item.attachment && (
              <ProjectActivityImage
                projectId={projectId}
                activityId={item.activityId}
                title={item.title}
                altText={item.attachment.altText}
              />
            )}
          </li>
        ))}
      </ol>
      {hasNextPage && (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isFetchingNextPage ? "Loading more…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}

export default ProjectActivityTimeline;
