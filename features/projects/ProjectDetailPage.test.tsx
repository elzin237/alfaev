import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

const projectDetailPageMocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
  reopen: vi.fn(),
  useProjectDetail: vi.fn(),
}));

vi.mock("./hooks/useProjectDetail", () => ({
  useProjectDetail: projectDetailPageMocks.useProjectDetail,
}));
vi.mock("./components/ProjectPlanningSection", () => ({
  ProjectPlanningSection: () => null,
}));
vi.mock("./components/ProjectMaterialUsageSection", () => ({
  ProjectMaterialUsageSection: () => (
    <section aria-label="Material Usage">
      <h2>Material Usage</h2>
      <p>Material usage read</p>
    </section>
  ),
}));
vi.mock("./components/ProjectActivitySection", () => ({
  ProjectActivitySection: ({ projectId, status }: { projectId: string; status: string }) => (
    <section aria-label="Project Activity">
      <h2>Project Activity</h2>
      <p>{projectId} / {status}</p>
    </section>
  ),
}));

import ProjectDetailPage from "./ProjectDetailPage";
import type { ProjectDetail } from "./services/projectService";

const projectId = "00000000-0000-4000-8000-000000000001";
const project: ProjectDetail = {
  id: projectId,
  name: "Control Cabinet",
  customerName: "Alfa Customer",
  status: "planned",
  startDate: "2026-09-01",
  deliveryDate: "2026-09-30",
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-10T09:30:00.000Z",
};

function setQueryState(options: {
  data?:
    | { ok: true; value: ProjectDetail }
    | { ok: false; error: { code: string; message: string } };
  isError?: boolean;
  isPending?: boolean;
  canEdit?: boolean;
  canCancel?: boolean;
  canReopen?: boolean;
} = {}) {
  projectDetailPageMocks.useProjectDetail.mockReturnValue({
    projectQuery: {
      data: options.data ?? { ok: true, value: project },
      isError: options.isError ?? false,
      isPending: options.isPending ?? false,
      refetch: projectDetailPageMocks.refetch,
    },
    canEdit: options.canEdit ?? false,
    canCancel: options.canCancel ?? false,
    canReopen: options.canReopen ?? false,
    update: projectDetailPageMocks.update,
    cancel: projectDetailPageMocks.cancel,
    reopen: projectDetailPageMocks.reopen,
  });
}

function renderDetail(path = `/projects/${projectId}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  projectDetailPageMocks.update.mockResolvedValue({ ok: true, value: { projectId } });
  projectDetailPageMocks.cancel.mockResolvedValue({ ok: true, value: { projectId } });
  projectDetailPageMocks.reopen.mockResolvedValue({ ok: true, value: { projectId } });
  setQueryState();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("ProjectDetailPage", () => {
  it("renders all canonical core fields and record timestamps", () => {
    const { container } = renderDetail();

    expect(screen.getByRole("heading", { name: "Control Cabinet" }))
      .toBeInTheDocument();
    expect(screen.getByText("Alfa Customer")).toBeInTheDocument();
    expect(screen.getByText("Planned")).toBeInTheDocument();
    expect(container.querySelector('time[datetime="2026-09-01"]'))
      .toBeInTheDocument();
    expect(container.querySelector('time[datetime="2026-09-30"]'))
      .toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Last updated")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Projects" }))
      .toHaveAttribute("href", "/projects");
  });

  it.each([
    ["planned", "Planned"],
    ["in_progress", "In Progress"],
    ["on_hold", "On Hold"],
    ["completed", "Completed"],
    ["cancelled", "Cancelled"],
  ] as const)("renders canonical %s status as %s", (status, label) => {
    setQueryState({ data: { ok: true, value: { ...project, status } } });
    renderDetail();

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Control Cabinet" }))
      .toBeInTheDocument();
  });

  it("shows real Material Usage without obsolete connected-module placeholders", () => {
    renderDetail();

    expect(screen.getByRole("heading", { name: "Material Usage" }))
      .toBeInTheDocument();
    expect(screen.getByText("Material usage read")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Related Work Orders" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText(
      "Project work orders will appear here when that module is connected.",
    )).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "PCB Production" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText(
      "Project PCB production will appear here when that module is connected.",
    )).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project Activity" }))
      .toBeInTheDocument();
    expect(screen.getByText(`${projectId} / planned`)).toBeInTheDocument();
  });

  it("renders loading without Project content", () => {
    setQueryState({ isPending: true });
    renderDetail();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading Project details...",
    );
    expect(screen.queryByText("Control Cabinet")).not.toBeInTheDocument();
  });

  it("renders a safe retryable read error", () => {
    setQueryState({
      data: {
        ok: false,
        error: {
          code: "project_detail_failed",
          message: "The Project details could not be loaded.",
        },
      },
    });
    renderDetail();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Project details could not be loaded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(projectDetailPageMocks.refetch).toHaveBeenCalledOnce();
  });

  it("renders a distinct not-found state without retry", () => {
    setQueryState({
      data: {
        ok: false,
        error: {
          code: "project_not_found",
          message: "The Project could not be found.",
        },
      },
    });
    renderDetail();

    expect(screen.getByRole("alert")).toHaveTextContent("Project not found");
    expect(screen.queryByRole("button", { name: "Try again" }))
      .not.toBeInTheDocument();
  });

  it("fails safely for a malformed route UUID", () => {
    setQueryState({ isPending: true });
    renderDetail("/projects/not-a-project-id");

    expect(screen.getByRole("alert")).toHaveTextContent("Project not found");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("is read-only with no later lifecycle or mutation controls", () => {
    renderDetail();

    expect(screen.queryByRole("button", {
      name: /create|edit|status|archive|cancel|reopen|delete/i,
    })).not.toBeInTheDocument();
  });

  it("shows independently authorized edit and cancellation actions", () => {
    setQueryState({ canEdit: true, canCancel: false });
    const editOnly = renderDetail();
    expect(screen.getByRole("button", { name: "Edit Project" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel Project" })).not.toBeInTheDocument();
    editOnly.unmount();

    setQueryState({ canEdit: false, canCancel: true });
    renderDetail();
    expect(screen.queryByRole("button", { name: "Edit Project" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel Project" })).toBeInTheDocument();
  });

  it("requires cancellation confirmation and allows cancel to be dismissed", () => {
    setQueryState({ canCancel: true });
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Cancel Project" }));
    expect(screen.getByRole("dialog", { name: "Cancel Project" })).toHaveTextContent("cannot be restored");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(projectDetailPageMocks.cancel).not.toHaveBeenCalled();
  });

  it("cancels through the hook and shows safe success or failure feedback", async () => {
    setQueryState({ canCancel: true });
    const view = renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Cancel Project" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Cancel Project" })).getByRole("button", { name: "Cancel Project" }));
    await waitFor(() => expect(projectDetailPageMocks.cancel).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("Project cancelled.");
    view.unmount();

    projectDetailPageMocks.cancel.mockResolvedValueOnce({ ok: false, error: { code: "project_cancel_failed", message: "The Project could not be cancelled. Please try again." } });
    setQueryState({ canCancel: true });
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Cancel Project" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Cancel Project" })).getByRole("button", { name: "Cancel Project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The Project could not be cancelled. Please try again.");
  });

  it("keeps Completed detail locked for a non-Admin", () => {
    setQueryState({
      data: { ok: true, value: { ...project, status: "completed" } },
      canEdit: true,
      canCancel: true,
    });
    renderDetail();
    expect(screen.getByRole("heading", { name: "Control Cabinet" })).toBeInTheDocument();
    expect(screen.getByText("Alfa Customer")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Project" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel Project" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reopen/i })).not.toBeInTheDocument();
  });

  it("shows only Reopen for an Admin viewing a Completed Project", () => {
    setQueryState({
      data: { ok: true, value: { ...project, status: "completed" } },
      canEdit: true,
      canCancel: true,
      canReopen: true,
    });
    renderDetail();

    expect(screen.getByRole("button", { name: "Reopen Project" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Project" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel Project" }))
      .not.toBeInTheDocument();
  });

  it.each(["planned", "in_progress", "on_hold", "cancelled"] as const)(
    "does not expose Reopen for a %s Project",
    (status) => {
      setQueryState({
        data: { ok: true, value: { ...project, status } },
        canReopen: true,
      });
      renderDetail();

      expect(screen.queryByRole("button", { name: "Reopen Project" }))
        .not.toBeInTheDocument();
    },
  );

  it("requires reopen confirmation and shows success or safe failure", async () => {
    setQueryState({
      data: { ok: true, value: { ...project, status: "completed" } },
      canReopen: true,
    });
    const view = renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Reopen Project" }));
    const dialog = screen.getByRole("dialog", { name: "Reopen Project" });
    expect(dialog).toHaveTextContent("back to In Progress");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(projectDetailPageMocks.reopen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reopen Project" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Reopen Project" }))
      .getByRole("button", { name: "Reopen Project" }));
    await waitFor(() => expect(projectDetailPageMocks.reopen).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("Project reopened.");
    view.unmount();

    projectDetailPageMocks.reopen.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "project_reopen_failed",
        message: "The Project could not be reopened. Please try again.",
      },
    });
    setQueryState({
      data: { ok: true, value: { ...project, status: "completed" } },
      canReopen: true,
    });
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Reopen Project" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Reopen Project" }))
      .getByRole("button", { name: "Reopen Project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The Project could not be reopened. Please try again.",
    );
  });

  it("blocks duplicate reopen confirmation while the request is pending", async () => {
    let resolveReopen: ((value: {
      ok: true;
      value: { projectId: string };
    }) => void) | undefined;
    projectDetailPageMocks.reopen.mockReturnValueOnce(new Promise((resolve) => {
      resolveReopen = resolve;
    }));
    setQueryState({
      data: { ok: true, value: { ...project, status: "completed" } },
      canReopen: true,
    });
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Reopen Project" }));
    const confirm = within(
      screen.getByRole("dialog", { name: "Reopen Project" }),
    ).getByRole("button", { name: "Reopen Project" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(projectDetailPageMocks.reopen).toHaveBeenCalledOnce();
    expect(confirm).toBeDisabled();

    resolveReopen?.({ ok: true, value: { projectId } });
    await waitFor(() => expect(screen.getByRole("status"))
      .toHaveTextContent("Project reopened."));
  });

  it("does not expose restore, reopen, delete, or hard-delete controls", () => {
    setQueryState({ canEdit: true, canCancel: true, canReopen: false });
    renderDetail();
    expect(screen.queryByRole("button", { name: /restore|reopen|delete|archive/i })).not.toBeInTheDocument();
  });
});
