import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ProjectActivityImage", () => ({
  default: ({ title }: { title: string }) => <div>Private image for {title}</div>,
}));

import ProjectActivityTimeline from "./ProjectActivityTimeline";
import type { ProjectActivityItem } from "../services/projectActivityService";

const projectId = "00000000-0000-4000-8000-000000000001";
const items: ProjectActivityItem[] = [{
  activityId: "00000000-0000-4000-8000-000000000002",
  projectId,
  authorUserId: "00000000-0000-4000-8000-000000000003",
  authorFullName: "Inactive Historical Author",
  title: "Commissioning issue",
  description: "First line\nSecond line",
  createdAt: "2026-10-19T10:00:00.000Z",
  alertSent: true,
  attachment: {
    attachmentId: "00000000-0000-4000-8000-000000000004",
    mimeType: "image/jpeg",
    byteSize: 42,
    altText: null,
  },
}];
const scrollTo = vi.fn();
const scrollIntoView = vi.fn();
let reduceMotion = false;

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
});
