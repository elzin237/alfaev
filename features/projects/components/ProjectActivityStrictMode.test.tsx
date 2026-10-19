import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  listProjectActivity: vi.fn(),
  getProjectActivity: vi.fn(),
  postProjectActivity: vi.fn(),
  uploadProjectActivityImage: vi.fn(),
  getProjectActivityImageAccess: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../services/projectActivityService", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../services/projectActivityService")
  >();
  return {
    ...original,
    listProjectActivity: mocks.listProjectActivity,
    getProjectActivity: mocks.getProjectActivity,
    postProjectActivity: mocks.postProjectActivity,
    uploadProjectActivityImage: mocks.uploadProjectActivityImage,
    getProjectActivityImageAccess: mocks.getProjectActivityImageAccess,
  };
});

import { projectActivityQueryKey } from "../projectActivityQueryKeys";
import type {
  ProjectActivityItem,
  ProjectActivityPage,
} from "../services/projectActivityService";
import { ProjectActivitySection } from "./ProjectActivitySection";

const projectId = "00000000-0000-4000-8000-000000000001";
const activityId = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";
const actorId = "00000000-0000-4000-8000-000000000004";
const profileId = "00000000-0000-4000-8000-000000000005";

const activity: ProjectActivityItem = {
  activityId,
  projectId,
  authorUserId: actorId,
  authorFullName: "AlfaEV Admin",
  title: "Status update",
  description: "Immediate timeline update",
  createdAt: "2026-10-19T10:00:00.000Z",
  alertSent: false,
  attachment: null,
};

function wrapper(client: QueryClient, children: ReactNode) {
  return (
    <StrictMode>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </StrictMode>
  );
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-user" } },
    profile: { id: profileId, isActive: true },
    isAdmin: true,
  });
  mocks.listProjectActivity
    .mockResolvedValueOnce({
      ok: true,
      value: { items: [], hasMore: false },
    })
    .mockResolvedValue({
      ok: true,
      value: { items: [activity], hasMore: false },
    });
  mocks.getProjectActivity.mockResolvedValue({ ok: true, value: activity });
  mocks.postProjectActivity.mockResolvedValue({
    ok: true,
    value: {
      activityId,
      projectId,
      requestId,
      title: activity.title,
      description: activity.description,
      createdAt: activity.createdAt,
      authorUserId: actorId,
      alertSent: false,
      alertId: null,
      recipientCount: "0",
    },
  });
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => requestId) });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  HTMLElement.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("Project Activity Strict Mode completion", () => {
  it("reconciles the authoritative Activity into the timeline and keeps success visible", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(wrapper(
      client,
      <ProjectActivitySection projectId={projectId} status="planned" />,
    ));
    expect(await screen.findByText("No project updates yet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {
      name: "Share an update or report an issue...",
    }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: activity.title },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: activity.description },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));

    await waitFor(() => expect(mocks.getProjectActivity)
      .toHaveBeenCalledExactlyOnceWith(projectId, activityId));
    expect(mocks.postProjectActivity).toHaveBeenCalledOnce();
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", { name: activity.title }))
      .toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Update posted successfully",
    );
    expect(screen.getByRole("button", {
      name: "Share an update or report an issue...",
    })).toHaveAttribute("aria-expanded", "false");

    const cached = client.getQueryData<{
      pages: ProjectActivityPage[];
    }>(projectActivityQueryKey(profileId, projectId));
    expect(cached?.pages.flatMap((page) => page.items).filter(
      (item) => item.activityId === activityId,
    )).toHaveLength(1);
    expect(screen.getAllByRole("heading", { name: activity.title })).toHaveLength(1);
  });
});
