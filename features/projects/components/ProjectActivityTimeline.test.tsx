import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ProjectActivityImage", () => ({
  default: ({ title }: { title: string }) => <div>Private image for {title}</div>,
}));

import ProjectActivityTimeline from "./ProjectActivityTimeline";
import { PROJECT_ACTIVITY_TARGET_HIGHLIGHT_MS } from "./ProjectActivityTimeline";
import { projectActivityDomId } from "../projectActivityDeepLink";
import type { ProjectActivityItem } from "../services/projectActivityService";

const projectId = "00000000-0000-4000-8000-000000000001";
const items: ProjectActivityItem[] = [{
  activityId: "00000000-0000-4000-8000-000000000002",
  projectId,
  authorUserId: "00000000-0000-4000-8000-000000000003",
  authorFullName: "Inactive Historical Author",
  title: "Commissioning issue",
  description: "First line\nSecond line",
  activityKind: "general",
  createdAt: "2026-10-19T10:00:00.000Z",
  alertSent: true,
  attachment: {
    attachmentId: "00000000-0000-4000-8000-000000000004",
    mimeType: "image/jpeg",
    byteSize: 42,
    altText: null,
  },
  resolution: null,
}];
const scrollTo = vi.fn();
const windowScrollTo = vi.fn();
const scrollIntoView = vi.fn();
let reduceMotion = false;
let containerBounds = makeRect(100, 500);
const activityBounds = new Map<string, DOMRect>();

function makeRect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom,
    left: 0,
    right: 600,
    width: 600,
    height: bottom - top,
    toJSON: () => ({}),
  };
}

function renderTimeline(overrides: Partial<React.ComponentProps<typeof ProjectActivityTimeline>> = {}) {
  const props: React.ComponentProps<typeof ProjectActivityTimeline> = {
    projectId,
    labelledBy: "recent-activity-heading",
    items,
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    onRetry: vi.fn(),
    onLoadMore: vi.fn(),
    ...overrides,
  };
  const rendered = render(
    <>
      <h3 id="recent-activity-heading">Recent activity</h3>
      <ProjectActivityTimeline {...props} />
    </>,
  );
  return { ...props, rerender: rendered.rerender };
}

beforeEach(() => {
  reduceMotion = false;
  containerBounds = makeRect(100, 500);
  activityBounds.clear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: reduceMotion })),
  });
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: windowScrollTo,
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      if (this.getAttribute("role") === "region" &&
        this.getAttribute("aria-labelledby") === "recent-activity-heading") {
        return containerBounds;
      }
      return activityBounds.get(this.dataset.activityId ?? "") ?? makeRect(150, 250);
    },
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("ProjectActivityTimeline", () => {
  it("renders loading, retryable error, and honest compact empty states", () => {
    const loading = renderTimeline({ isPending: true, items: [] });
    expect(screen.getByRole("status")).toHaveTextContent("Loading Project Activity");
    cleanup();
    renderTimeline({ isError: true, items: [] });
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load Activity");
    cleanup();
    renderTimeline({ items: [] });
    expect(screen.getByRole("heading", { name: "No project updates yet." }))
      .toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recent activity" }))
      .not.toBeInTheDocument();
    expect(loading.onRetry).not.toHaveBeenCalled();
  });

  it("bounds only populated history and exposes a labelled keyboard-scrollable region", () => {
    renderTimeline();
    const region = screen.getByRole("region", { name: "Recent activity" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAttribute("aria-labelledby", "recent-activity-heading");
    expect(region).toHaveClass(
      "max-h-[42rem]",
      "max-w-full",
      "overflow-x-hidden",
      "overflow-y-auto",
      "pr-1",
      "focus:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-red-500",
      "focus-visible:ring-offset-2",
    );
    expect(region).not.toHaveClass("h-[42rem]", "min-h-[42rem]");
    expect(within(region).getByRole("list", {
      name: "Project Activity timeline",
    })).toBeInTheDocument();
  });

  it("renders immutable multiline history, inactive author, absolute time, alert and image", () => {
    renderTimeline();
    const timeline = screen.getByRole("list", { name: "Project Activity timeline" });
    expect(within(timeline).getByText("Commissioning issue")).toBeInTheDocument();
    expect(within(timeline).getByText(/Inactive Historical Author/)).toBeInTheDocument();
    expect(within(timeline).getByText("Alert sent")).toBeInTheDocument();
    expect(within(timeline).getByText("First line Second line")).toHaveClass(
      "mt-3",
      "whitespace-pre-wrap",
      "leading-6",
    );
    expect(screen.getByText("Private image for Commissioning issue")).toBeInTheDocument();
    expect(document.querySelector('time[datetime="2026-10-19T10:00:00.000Z"]'))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit|delete|resend/i }))
      .not.toBeInTheDocument();
  });

  it("shows Issue status and permission-gates resolution without affecting General updates", () => {
    const openIssue: ProjectActivityItem = {
      ...items[0]!,
      activityKind: "issue",
      title: "Open issue",
      alertSent: false,
      attachment: null,
    };
    const general = { ...items[0]!, title: "General update" };
    const denied = renderTimeline({ items: [openIssue, general] });
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve issue" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText("Resolved")).not.toBeInTheDocument();
    denied.rerender(<></>);

    renderTimeline({
      items: [openIssue, general],
      canResolveIssue: true,
      onResolveIssue: vi.fn(),
    });
    expect(screen.getByRole("button", { name: "Resolve issue" }))
      .toBeInTheDocument();
  });

  it("renders immutable resolver, timestamp, and description for a resolved Issue", () => {
    const resolvedIssue: ProjectActivityItem = {
      ...items[0]!,
      activityKind: "issue",
      title: "Resolved issue",
      attachment: null,
      resolution: {
        resolutionId: "00000000-0000-4000-8000-000000000011",
        resolvedByUserId: "00000000-0000-4000-8000-000000000012",
        resolverFullName: "Resolution Owner",
        description: "Replaced the damaged contactor.",
        resolvedAt: "2026-10-20T12:30:00.000Z",
        attachment: {
          attachmentId: "00000000-0000-4000-8000-000000000013",
          mimeType: "image/png",
          byteSize: 128,
          altText: "Repaired contactor",
        },
      },
    };
    renderTimeline({
      items: [resolvedIssue],
      canResolveIssue: true,
      onResolveIssue: vi.fn(),
    });
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("Replaced the damaged contactor."))
      .toBeInTheDocument();
    expect(screen.getByText(/Resolved by/)).toHaveTextContent("Resolution Owner");
    expect(screen.getByText("Private image for Resolution evidence for Resolved issue"))
      .toBeInTheDocument();
    expect(document.querySelector('time[datetime="2026-10-20T12:30:00.000Z"]'))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve issue" }))
      .not.toBeInTheDocument();
  });

  it("loads more once and disables repeated page actions while fetching", () => {
    const props = renderTimeline({ hasNextPage: true });
    const region = screen.getByRole("region", { name: "Recent activity" });
    const loadMore = within(region).getByRole("button", { name: "Load more" });
    fireEvent.click(loadMore);
    expect(props.onLoadMore).toHaveBeenCalledOnce();
    expect(scrollTo).not.toHaveBeenCalled();
    cleanup();
    renderTimeline({ hasNextPage: true, isFetchingNextPage: true });
    expect(screen.getByRole("button", { name: "Loading more…" })).toBeDisabled();
  });

  it("scrolls only the internal region to the authoritative newest row and respects reduced motion", () => {
    const onScrollComplete = vi.fn();
    renderTimeline({
      scrollToActivityId: items[0]!.activityId,
      onScrollComplete,
    });
    expect(scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(onScrollComplete).toHaveBeenCalledOnce();
    cleanup();
    scrollTo.mockClear();
    reduceMotion = true;
    renderTimeline({ scrollToActivityId: items[0]!.activityId });
    expect(scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: "auto",
    });
  });

  it("does not reset the internal scroll position when older pages append", () => {
    const { rerender, ...props } = renderTimeline();
    const older = {
      ...items[0]!,
      activityId: "00000000-0000-4000-8000-000000000099",
      title: "Older update",
    };
    scrollTo.mockClear();
    rerender(
      <>
        <h3 id="recent-activity-heading">Recent activity</h3>
        <ProjectActivityTimeline {...props} items={[...items, older]} />
      </>,
    );
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("positions and focuses an exact loaded target inside the nested scroller once", () => {
    activityBounds.set(items[0]!.activityId, makeRect(450, 530));
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const rendered = renderTimeline({
      targetActivityId: items[0]!.activityId,
      targetContextKey: `profile-1:${projectId}`,
      targetNavigationKey: "navigation-1",
    });
    const target = document.getElementById(projectActivityDomId(
      projectId,
      items[0]!.activityId,
    ));

    expect(target).toHaveAttribute("tabindex", "-1");
    expect(target).toHaveAttribute(
      "aria-label",
      "Project Activity: Commissioning issue by Inactive Historical Author",
    );
    expect(target).toHaveClass("border-red-300", "bg-red-50/60");
    expect(target).not.toHaveClass(
      "ring-2",
      "ring-red-300",
      "focus-visible:ring-2",
      "focus-visible:ring-red-500",
      "focus-visible:ring-offset-2",
    );
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
      top: 30,
      behavior: "smooth",
    });
    expect(windowScrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(document.activeElement).toBe(target);

    scrollTo.mockClear();
    focus.mockClear();
    const { rerender, ...props } = rendered;
    rerender(
      <>
        <h3 id="recent-activity-heading">Recent activity</h3>
        <ProjectActivityTimeline {...props} items={[...items]} />
      </>,
    );
    expect(scrollTo).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
  });

  it("renders and targets Linked activity inside the scroller but outside the chronological list", () => {
    const linked = {
      ...items[0]!,
      activityId: "00000000-0000-4000-8000-000000000099",
      title: "Older linked update",
    };
    activityBounds.set(linked.activityId, makeRect(520, 620));
    renderTimeline({
      linkedActivity: linked,
      targetActivityId: linked.activityId,
      targetContextKey: `profile-1:${projectId}`,
      targetNavigationKey: "linked-navigation",
    });

    const linkedRegion = screen.getByRole("region", { name: "Linked activity" });
    const linkedTarget = document.getElementById(projectActivityDomId(
      projectId,
      linked.activityId,
    ));
    expect(linkedTarget).toBe(document.activeElement);
    expect(linkedRegion).toContainElement(linkedTarget);
    expect(linkedTarget).toHaveClass("border-red-300", "bg-red-50/60");
    expect(linkedTarget).not.toHaveClass("ring-2", "ring-red-300");
    expect(within(screen.getByRole("list", { name: "Project Activity timeline" }))
      .queryByText("Older linked update")).not.toBeInTheDocument();
    expect(document.querySelectorAll(`#${projectActivityDomId(
      projectId,
      linked.activityId,
    )}`)).toHaveLength(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 120, behavior: "smooth" });
  });

  it("makes the chronological row canonical after Load more without refocusing", () => {
    const linked = {
      ...items[0]!,
      activityId: "00000000-0000-4000-8000-000000000099",
      title: "Older linked update",
    };
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const initial = renderTimeline({
      linkedActivity: linked,
      targetActivityId: linked.activityId,
      targetContextKey: `profile-1:${projectId}`,
      targetNavigationKey: "same-navigation",
      hasNextPage: true,
    });
    expect(focus).toHaveBeenCalledOnce();
    focus.mockClear();
    scrollTo.mockClear();

    const { rerender, ...props } = initial;
    rerender(
      <>
        <h3 id="recent-activity-heading">Recent activity</h3>
        <ProjectActivityTimeline
          {...props}
          linkedActivity={null}
          items={[...items, linked]}
          hasNextPage={false}
        />
      </>,
    );
    expect(screen.queryByRole("region", { name: "Linked activity" }))
      .not.toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Project Activity timeline" }))
      .getByText("Older linked update")).toBeInTheDocument();
    expect(document.querySelectorAll(`#${projectActivityDomId(
      projectId,
      linked.activityId,
    )}`)).toHaveLength(1);
    expect(focus).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    focus.mockRestore();
  });

  it("repeats targeting only for a genuine new navigation key", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const initial = renderTimeline({
      targetActivityId: items[0]!.activityId,
      targetContextKey: `profile-1:${projectId}`,
      targetNavigationKey: "history-entry-1",
    });
    expect(focus).toHaveBeenCalledOnce();
    focus.mockClear();
    const { rerender, ...props } = initial;

    rerender(
      <>
        <h3 id="recent-activity-heading">Recent activity</h3>
        <ProjectActivityTimeline
          {...props}
          targetNavigationKey="history-entry-2"
        />
      </>,
    );
    expect(focus).toHaveBeenCalledOnce();
    focus.mockClear();

    rerender(
      <>
        <h3 id="recent-activity-heading">Recent activity</h3>
        <ProjectActivityTimeline
          {...props}
          targetNavigationKey="history-entry-1"
        />
      </>,
    );
    expect(focus).toHaveBeenCalledOnce();
    focus.mockRestore();
  });

  it("targets a different Activity on a hash-only navigation without remounting", () => {
    const second = {
      ...items[0]!,
      activityId: "00000000-0000-4000-8000-000000000088",
      title: "Different linked target",
    };
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const initial = renderTimeline({
      items: [...items, second],
      targetActivityId: items[0]!.activityId,
      targetContextKey: `profile-1:${projectId}`,
      targetNavigationKey: "hash-one",
    });
    focus.mockClear();
    const { rerender, ...props } = initial;
    rerender(
      <>
        <h3 id="recent-activity-heading">Recent activity</h3>
        <ProjectActivityTimeline
          {...props}
          items={[...items, second]}
          targetActivityId={second.activityId}
          targetNavigationKey="hash-two"
        />
      </>,
    );
    expect(document.activeElement).toBe(document.getElementById(
      projectActivityDomId(projectId, second.activityId),
    ));
    expect(focus).toHaveBeenCalledOnce();
    expect(document.getElementById(projectActivityDomId(
      projectId,
      items[0]!.activityId,
    ))).not.toHaveClass("border-red-300");
    focus.mockRestore();
  });

  it("clears a target on hash removal and never focuses invalid or stale Project data", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const initial = renderTimeline({
      targetActivityId: items[0]!.activityId,
      targetContextKey: `profile-1:${projectId}`,
      targetNavigationKey: "targeted",
    });
    const { rerender, ...props } = initial;
    focus.mockClear();
    rerender(
      <>
        <h3 id="recent-activity-heading">Recent activity</h3>
        <ProjectActivityTimeline
          {...props}
          targetActivityId={null}
          targetNavigationKey="hash-cleared"
        />
      </>,
    );
    expect(focus).not.toHaveBeenCalled();
    expect(document.querySelector(".border-red-300")).not.toBeInTheDocument();

    cleanup();
    renderTimeline({
      projectId: "00000000-0000-4000-8000-000000000050",
      targetActivityId: items[0]!.activityId,
      targetContextKey: "profile-2:00000000-0000-4000-8000-000000000050",
      targetNavigationKey: "stale-project",
    });
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
  });

  it("expires the restrained highlight and cancels its timer on unmount", () => {
    vi.useFakeTimers();
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    const rendered = renderTimeline({
      targetActivityId: items[0]!.activityId,
      targetContextKey: `profile-1:${projectId}`,
      targetNavigationKey: "highlight",
    });
    const target = document.getElementById(projectActivityDomId(
      projectId,
      items[0]!.activityId,
    ));
    expect(target).toHaveClass("border-red-300", "bg-red-50/60");
    expect(target).not.toHaveClass("ring-2", "ring-red-300");
    expect(document.activeElement).toBe(target);
    act(() => vi.advanceTimersByTime(PROJECT_ACTIVITY_TARGET_HIGHLIGHT_MS));
    expect(target).not.toHaveClass("border-red-300", "bg-red-50/60");
    expect(target).toHaveClass(
      "border-zinc-200",
      "bg-white",
      "focus-visible:ring-2",
      "focus-visible:ring-red-500",
      "focus-visible:ring-offset-2",
    );
    expect(document.activeElement).toBe(target);

    rendered.rerender(
      <>
        <h3 id="recent-activity-heading">Recent activity</h3>
        <ProjectActivityTimeline
          {...rendered}
          targetNavigationKey="highlight-again"
        />
      </>,
    );
    rendered.rerender(<></>);
    expect(clearTimeout).toHaveBeenCalled();
    clearTimeout.mockRestore();
    vi.useRealTimers();
  });

  it("uses immediate positioning for reduced motion and conditionally adjusts only the outer viewport", () => {
    reduceMotion = true;
    containerBounds = makeRect(850, 1_250);
    activityBounds.set(items[0]!.activityId, makeRect(1_100, 1_180));
    renderTimeline({
      targetActivityId: items[0]!.activityId,
      targetContextKey: `profile-1:${projectId}`,
      targetNavigationKey: "reduced-motion",
    });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(windowScrollTo).toHaveBeenCalledExactlyOnceWith({
      top: 428,
      behavior: "auto",
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("focuses only once in StrictMode and image rendering does not retrigger it", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const props: React.ComponentProps<typeof ProjectActivityTimeline> = {
      projectId,
      labelledBy: "recent-activity-heading",
      items,
      targetActivityId: items[0]!.activityId,
      targetContextKey: `profile-1:${projectId}`,
      targetNavigationKey: "strict-navigation",
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      onRetry: vi.fn(),
      onLoadMore: vi.fn(),
    };
    const rendered = render(
      <StrictMode>
        <h3 id="recent-activity-heading">Recent activity</h3>
        <ProjectActivityTimeline {...props} />
      </StrictMode>,
    );
    expect(focus).toHaveBeenCalledOnce();
    focus.mockClear();
    rendered.rerender(
      <StrictMode>
        <h3 id="recent-activity-heading">Recent activity</h3>
        <ProjectActivityTimeline {...props} items={[...items]} />
      </StrictMode>,
    );
    expect(screen.getByText("Private image for Commissioning issue"))
      .toBeInTheDocument();
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
  });
});
