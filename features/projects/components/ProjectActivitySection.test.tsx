import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useProjectActivityPermissions: vi.fn(),
  useProjectActivity: vi.fn(),
}));
vi.mock("../hooks/useProjectActivity", () => ({
  useProjectActivityPermissions: mocks.useProjectActivityPermissions,
  useProjectActivity: mocks.useProjectActivity,
}));
vi.mock("./ProjectActivityComposer", () => ({
  default: ({
    canSendAlert,
    visible,
    onActivityChanged,
    onCompleted,
  }: {
    canSendAlert: boolean;
    visible: boolean;
    onActivityChanged: (activityId: string, shouldScroll: boolean) => Promise<unknown>;
    onCompleted: (sendAlert: boolean) => void;
  }) => visible ? (
    <div>
      <span>Composer / alerts {String(canSendAlert)}</span>
      <button type="button" onClick={() => void onActivityChanged(
        "00000000-0000-4000-8000-000000000009",
        true,
      ).then(() => onCompleted(false))}>Complete update</button>
      <button type="button" onClick={() => onCompleted(true)}>Complete alert</button>
    </div>
  ) : null,
}));
vi.mock("./ProjectActivityTimeline", () => ({
  default: ({
    labelledBy,
    scrollToActivityId,
  }: {
    labelledBy: string;
    scrollToActivityId: string | null;
  }) => (
    <div role="region" tabIndex={0} aria-labelledby={labelledBy}>
      Timeline history / scroll {scrollToActivityId ?? "none"}
    </div>
  ),
}));

import { ProjectActivitySection } from "./ProjectActivitySection";

const projectId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  mocks.useProjectActivityPermissions.mockReturnValue({
    canPost: true,
    canSendAlert: false,
    permissionsPending: false,
  });
  mocks.useProjectActivity.mockReturnValue({
    activityQuery: {
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: vi.fn(),
      fetchNextPage: vi.fn(),
    },
    items: [],
    reconcilePostedActivity: vi.fn().mockResolvedValue({
      activityId: "00000000-0000-4000-8000-000000000009",
    }),
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("ProjectActivitySection", () => {
  function renderSection(status: "planned" | "completed" = "planned") {
    return render(
      <StrictMode>
        <ProjectActivitySection projectId={projectId} status={status} />
      </StrictMode>,
    );
  }

  it("renders the focused Activity design and composer for edit-authorized open Projects", () => {
    renderSection();
    expect(screen.getByRole("heading", { name: "Project Activity" })).toBeInTheDocument();
    expect(screen.getByText("Project updates, discussions, and reported issues."))
      .toBeInTheDocument();
    expect(screen.getByText("Composer / alerts false")).toBeInTheDocument();
    expect(screen.getByText(/Timeline history/)).toBeInTheDocument();
    const recentHeading = screen.getByRole("heading", { name: "Recent activity" });
    const timeline = screen.getByRole("region", { name: "Recent activity" });
    expect(recentHeading).toHaveAttribute("id", "project-recent-activity-heading");
    expect(timeline).toHaveAttribute(
      "aria-labelledby",
      "project-recent-activity-heading",
    );
    expect(within(timeline).queryByText("Composer / alerts false"))
      .not.toBeInTheDocument();
  });

  it("keeps completed/cancelled and view-only history visible without a composer", () => {
    mocks.useProjectActivityPermissions.mockReturnValue({
      canPost: false,
      canSendAlert: false,
      permissionsPending: false,
    });
    const completed = renderSection("completed");
    expect(screen.queryByText(/Composer/)).not.toBeInTheDocument();
    expect(screen.getByText(/read-only.*history remains available/i)).toBeInTheDocument();
    expect(screen.getByText(/Timeline history/)).toBeInTheDocument();
    completed.unmount();

    renderSection();
    expect(screen.getByText(/view Project Activity, but you cannot post/i))
      .toBeInTheDocument();
    expect(screen.getByText(/Timeline history/)).toBeInTheDocument();
  });

  it("keeps prominent normal and alert confirmations outside the collapsed composer", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Complete update" }));
    const normalSuccess = await screen.findByRole("status");
    expect(normalSuccess).toHaveTextContent(
      "Update posted successfully",
    );
    expect(normalSuccess).toHaveClass(
      "inline-flex",
      "max-w-full",
      "text-emerald-700",
    );
    expect(normalSuccess).not.toHaveClass(
      "bg-emerald-50",
      "border",
      "rounded-2xl",
      "px-5",
      "py-4",
    );
    expect(screen.getByText(/scroll 00000000-0000-4000-8000-000000000009/))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Complete alert" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(
      "Update posted and alert sent",
    ));
    expect(screen.getByRole("status")).toHaveClass("inline-flex");
    expect(within(screen.getByRole("region", { name: "Recent activity" }))
      .queryByText("Update posted and alert sent"))
      .not.toBeInTheDocument();
  });
});
