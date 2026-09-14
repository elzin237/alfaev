import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

const projectDetailPageMocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  useProjectDetail: vi.fn(),
}));

vi.mock("./hooks/useProjectDetail", () => ({
  useProjectDetail: projectDetailPageMocks.useProjectDetail,
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
} = {}) {
  projectDetailPageMocks.useProjectDetail.mockReturnValue({
    data: options.data ?? { ok: true, value: project },
    isError: options.isError ?? false,
    isPending: options.isPending ?? false,
    refetch: projectDetailPageMocks.refetch,
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

beforeEach(() => setQueryState());

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

  it("shows only honest empty placeholders for canonical related domains", () => {
    renderDetail();

    expect(screen.getByRole("heading", { name: "Material Usage" }))
      .toBeInTheDocument();
    expect(screen.getByText(
      "No material usage data is available in this section yet.",
    )).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Related Work Orders" }))
      .toBeInTheDocument();
    expect(screen.getByText(
      "Project work orders will appear here when that module is connected.",
    )).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "PCB Production" }))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Activity" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
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
});
