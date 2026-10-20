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
    linkedActivity,
  }: {
    labelledBy: string;
    scrollToActivityId: string | null;
    linkedActivity?: ProjectActivityItem | null;
  }) => (
    <div role="region" tabIndex={0} aria-labelledby={labelledBy}>
      Timeline history / scroll {scrollToActivityId ?? "none"}
      {linkedActivity && (
        <section role="region" aria-label="Linked activity">
          <p>{linkedActivity.title}</p>
          <p>{linkedActivity.authorFullName}</p>
          {linkedActivity.alertSent && <p>Alert sent</p>}
          {linkedActivity.attachment && (
            <p>Private image for {linkedActivity.title}</p>
          )}
        </section>
      )}
    </div>
  ),
}));
vi.mock("./ProjectActivityImage", () => ({
  default: ({ title }: { title: string }) => <div>Private image for {title}</div>,
}));

import { ProjectActivitySection } from "./ProjectActivitySection";
import type { ProjectActivityHash } from "../projectActivityDeepLink";
import type { ProjectActivityItem } from "../services/projectActivityService";

const projectId = "00000000-0000-4000-8000-000000000001";
const linkedActivity: ProjectActivityItem = {
  activityId: "00000000-0000-4000-8000-000000000009",
  projectId,
  authorUserId: "00000000-0000-4000-8000-000000000010",
  authorFullName: "Historical Author",
  title: "Linked update",
  description: "Linked description",
  createdAt: "2026-10-19T10:00:00.000Z",
  alertSent: true,
  attachment: {
    attachmentId: "00000000-0000-4000-8000-000000000011",
    mimeType: "image/jpeg",
    byteSize: 42,
    altText: "Linked image",
  },
};
const targetRefetch = vi.fn();

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
    linkedActivity: null,
    targetIsLoaded: false,
    targetQuery: {
      isPending: false,
      data: undefined,
      refetch: targetRefetch,
    },
    reconcilePostedActivity: vi.fn().mockResolvedValue({
      activityId: "00000000-0000-4000-8000-000000000009",
    }),
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("ProjectActivitySection", () => {
  function renderSection(
    status: "planned" | "completed" = "planned",
    activityTarget: ProjectActivityHash = { kind: "none" },
  ) {
    return render(
      <StrictMode>
        <ProjectActivitySection
          projectId={projectId}
          status={status}
          activityTarget={activityTarget}
        />
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

  it("shows a malformed Activity hash safely without target retrieval", () => {
    renderSection("planned", { kind: "invalid" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This Activity link is invalid.",
    );
    expect(mocks.useProjectActivity).toHaveBeenCalledWith(projectId, null);
  });

  it("renders an older direct target as a separate Linked activity with image metadata", () => {
    mocks.useProjectActivity.mockReturnValue({
      ...mocks.useProjectActivity(),
      linkedActivity,
      targetQuery: {
        isPending: false,
        data: { ok: true, value: linkedActivity },
        refetch: targetRefetch,
      },
    });
    renderSection("planned", {
      kind: "activity",
      activityId: linkedActivity.activityId,
    });

    const linked = screen.getByRole("region", { name: "Linked activity" });
    expect(within(linked).getByText("Linked update")).toBeInTheDocument();
    expect(within(linked).getByText(/Historical Author/)).toBeInTheDocument();
    expect(within(linked).getByText("Alert sent")).toBeInTheDocument();
    expect(within(linked).getByText("Private image for Linked update"))
      .toBeInTheDocument();
    expect(linked.querySelector("ol")).not.toBeInTheDocument();
  });

  it("shows safe target failures and retries only a transient failure", () => {
    mocks.useProjectActivity.mockReturnValue({
      ...mocks.useProjectActivity(),
      targetQuery: {
        isPending: false,
        data: {
          ok: false,
          error: {
            code: "activity_load_failed",
            message: "Couldn't load the linked Activity.",
          },
        },
        refetch: targetRefetch,
      },
    });
    const target: ProjectActivityHash = {
      kind: "activity",
      activityId: linkedActivity.activityId,
    };
    const transient = renderSection("planned", target);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load the linked Activity.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(targetRefetch).toHaveBeenCalledOnce();
    transient.unmount();

    mocks.useProjectActivity.mockReturnValue({
      ...mocks.useProjectActivity(),
      targetQuery: {
        isPending: false,
        data: {
          ok: false,
          error: {
            code: "activity_unavailable",
            message: "This Project Activity is unavailable.",
          },
        },
        refetch: targetRefetch,
      },
    });
    renderSection("planned", target);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This Project Activity is unavailable.",
    );
    expect(screen.queryByRole("button", { name: "Try again" }))
      .not.toBeInTheDocument();
  });
});
