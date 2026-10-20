import { useEffect, useLayoutEffect, useRef, useState } from "react";

import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import { projectActivityDomId } from "../projectActivityDeepLink";
import type { ProjectActivityItem } from "../services/projectActivityService";
import { ProjectActivityEntry } from "./ProjectActivityEntry";

export const PROJECT_ACTIVITY_TARGET_HIGHLIGHT_MS = 2_500;
const outerViewportMargin = 16;

interface ProjectActivityTimelineProps {
  projectId: string;
  labelledBy: string;
  items: ProjectActivityItem[];
  linkedActivity?: ProjectActivityItem | null;
  targetActivityId?: string | null;
  targetContextKey?: string;
  targetNavigationKey?: string;
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
  linkedActivity = null,
  targetActivityId = null,
  targetContextKey = "",
  targetNavigationKey = "default",
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
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const completedTargetEventRef = useRef<string | null>(null);
  const [highlightedTarget, setHighlightedTarget] = useState<{
    activityId: string;
    eventKey: string;
  } | null>(null);
  const safeLinkedActivity = linkedActivity?.projectId.toLowerCase() ===
      projectId.toLowerCase()
    ? linkedActivity
    : null;
  const resolvedTarget = targetActivityId
    ? items.find((item) =>
      item.projectId.toLowerCase() === projectId.toLowerCase() &&
      item.activityId.toLowerCase() === targetActivityId.toLowerCase()
    ) ?? (
      safeLinkedActivity?.activityId.toLowerCase() === targetActivityId.toLowerCase()
        ? safeLinkedActivity
        : null
    )
    : null;

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

  useLayoutEffect(() => {
    if (!targetActivityId || !resolvedTarget) {
      setHighlightedTarget(null);
      return;
    }
    const eventKey = [
      targetContextKey,
      targetActivityId,
      targetNavigationKey,
    ].join(":");
    if (completedTargetEventRef.current === eventKey) return;

    const element = itemRefs.current.get(targetActivityId);
    const container = scrollContainerRef.current;
    if (!element || !container || !container.contains(element)) return;

    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches ?? false;
    const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const containerStyle = window.getComputedStyle(container);
    const paddingTop = Number.parseFloat(containerStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(containerStyle.paddingBottom) || 0;
    const visibleTop = containerRect.top + paddingTop;
    const visibleBottom = containerRect.bottom - paddingBottom;
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    let internalDelta = 0;

    if (elementRect.height > visibleHeight || elementRect.top < visibleTop) {
      internalDelta = elementRect.top - visibleTop;
    } else if (elementRect.bottom > visibleBottom) {
      internalDelta = elementRect.bottom - visibleBottom;
    }

    let appliedInternalDelta = 0;
    if (Math.abs(internalDelta) > 1) {
      const desiredTop = container.scrollTop + internalDelta;
      const maximumTop = container.scrollHeight > container.clientHeight
        ? container.scrollHeight - container.clientHeight
        : desiredTop;
      const boundedTop = Math.max(0, Math.min(desiredTop, maximumTop));
      appliedInternalDelta = boundedTop - container.scrollTop;
      if (Math.abs(appliedInternalDelta) > 1) {
        container.scrollTo({ top: boundedTop, behavior });
      }
    }

    const projectedTop = elementRect.top - appliedInternalDelta;
    const projectedBottom = elementRect.bottom - appliedInternalDelta;
    let outerDelta = 0;
    if (projectedTop < outerViewportMargin) {
      outerDelta = projectedTop - outerViewportMargin;
    } else if (projectedBottom > window.innerHeight - outerViewportMargin) {
      outerDelta = projectedBottom - (window.innerHeight - outerViewportMargin);
    }
    if (Math.abs(outerDelta) > 1) {
      window.scrollTo({
        top: Math.max(0, window.scrollY + outerDelta),
        behavior,
      });
    }

    completedTargetEventRef.current = eventKey;
    setHighlightedTarget({ activityId: targetActivityId, eventKey });
    element.focus({ preventScroll: true });
  }, [
    resolvedTarget,
    targetActivityId,
    targetContextKey,
    targetNavigationKey,
  ]);

  useEffect(() => {
    if (!highlightedTarget) return;
    const timeout = window.setTimeout(() => {
      setHighlightedTarget((current) =>
        current?.eventKey === highlightedTarget.eventKey ? null : current
      );
    }, PROJECT_ACTIVITY_TARGET_HIGHLIGHT_MS);
    return () => window.clearTimeout(timeout);
  }, [highlightedTarget]);

  const setItemRef = (activityId: string, element: HTMLElement | null) => {
    if (element) itemRefs.current.set(activityId, element);
    else itemRefs.current.delete(activityId);
  };

  const targetClassName = (activityId: string) =>
    `rounded-2xl border p-4 shadow-sm focus:outline-none sm:p-5 ${
      highlightedTarget?.activityId === activityId
        ? "border-red-300 bg-red-50/60"
        : "border-zinc-200 bg-white focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
    }`;

  if (isPending && !safeLinkedActivity) {
    return <LoadingState message="Loading Project Activity..." />;
  }
  if (isError && !safeLinkedActivity) {
    return (
      <ErrorState
        title="Unable to load Activity"
        message="Project Activity could not be loaded."
        onRetry={onRetry}
      />
    );
  }
  if (items.length === 0 && !safeLinkedActivity) {
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
      {safeLinkedActivity && (
        <section
          aria-labelledby={`linked-${projectActivityDomId(projectId, safeLinkedActivity.activityId)}`}
          className="mb-4 rounded-2xl border border-red-200 bg-red-50/40 p-4 sm:p-5"
        >
          <h4
            id={`linked-${projectActivityDomId(projectId, safeLinkedActivity.activityId)}`}
            className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-red-700"
          >
            Linked activity
          </h4>
          <article
            id={projectActivityDomId(projectId, safeLinkedActivity.activityId)}
            ref={(element) => setItemRef(safeLinkedActivity.activityId, element)}
            data-activity-id={safeLinkedActivity.activityId}
            tabIndex={-1}
            aria-label={`Project Activity: ${safeLinkedActivity.title} by ${safeLinkedActivity.authorFullName}`}
            className={targetClassName(safeLinkedActivity.activityId)}
          >
            <ProjectActivityEntry projectId={projectId} item={safeLinkedActivity} />
          </article>
        </section>
      )}
      {isError && (
        <div className="mb-4">
          <ErrorState
            title="Unable to load Activity"
            message="Project Activity could not be loaded."
            onRetry={onRetry}
          />
        </div>
      )}
      {items.length > 0 && (
        <ol aria-label="Project Activity timeline" className="space-y-3">
        {items.map((item) => (
          <li
            id={projectActivityDomId(projectId, item.activityId)}
            key={item.activityId}
            ref={(element) => setItemRef(item.activityId, element)}
            data-activity-id={item.activityId}
            tabIndex={-1}
            aria-label={`Project Activity: ${item.title} by ${item.authorFullName}`}
            className={targetClassName(item.activityId)}
          >
            <ProjectActivityEntry projectId={projectId} item={item} />
          </li>
        ))}
        </ol>
      )}
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
