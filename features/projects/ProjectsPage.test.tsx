import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectsPageMocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  useProjects: vi.fn(),
}));

vi.mock("./hooks/useProjects", () => ({
  useProjects: projectsPageMocks.useProjects,
}));

import ProjectsPage from "./ProjectsPage";
import type { ProjectStatus, ProjectStatusFilter } from "./projectStatus";
import type { ProjectListItem } from "./services/projectService";

const projects: ProjectListItem[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Planning Project",
    customerName: "Customer A",
    status: "planned",
    startDate: "2026-09-01",
    deliveryDate: "2026-09-10",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Active Project",
    customerName: "Customer B",
    status: "in_progress",
    startDate: "2026-09-02",
    deliveryDate: "2026-09-11",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "Held Project",
    customerName: "Customer C",
    status: "on_hold",
    startDate: "2026-09-03",
    deliveryDate: "2026-09-12",
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    name: "Completed Project",
    customerName: "Customer D",
    status: "completed",
    startDate: "2026-09-04",
    deliveryDate: "2026-09-13",
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    name: "Cancelled Project",
    customerName: "Customer E",
    status: "cancelled",
    startDate: "2026-09-05",
    deliveryDate: "2026-09-14",
  },
];

function setQueryState(options: {
  data?:
    | { ok: true; value: ProjectListItem[] }
    | { ok: false; error: { code: string; message: string } };
  isError?: boolean;
  isPending?: boolean;
} = {}) {
  projectsPageMocks.useProjects.mockReturnValue({
    data: options.data ?? { ok: true, value: projects },
    isError: options.isError ?? false,
    isPending: options.isPending ?? false,
    refetch: projectsPageMocks.refetch,
  });
}

function visibleProjectNames(): string[] {
  return within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getByRole("rowheader").textContent ?? "");
}

beforeEach(() => setQueryState());

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("ProjectsPage", () => {
  it("renders authorized rows, all canonical status labels, and lifecycle Projects", () => {
    const { container } = render(<ProjectsPage />);

    expect(visibleProjectNames()).toEqual(projects.map((project) => project.name));
    for (const label of [
      "Planned",
      "In Progress",
      "On Hold",
      "Completed",
      "Cancelled",
    ]) {
      expect(within(screen.getByRole("table")).getByText(label))
        .toBeInTheDocument();
    }
    expect(screen.getByText("Customer D")).toBeInTheDocument();
    expect(screen.getByText("Customer E")).toBeInTheDocument();
    expect(container.querySelector('time[datetime="2026-09-01"]'))
      .toBeInTheDocument();
    expect(container.querySelector('time[datetime="2026-09-14"]'))
      .toBeInTheDocument();
  });

  it("filters every canonical status and clearing returns to All", () => {
    render(<ProjectsPage />);
    const filter = screen.getByLabelText("Filter by status");
    const expected: ReadonlyArray<{
      filter: ProjectStatus;
      name: string;
    }> = [
      { filter: "planned", name: "Planning Project" },
      { filter: "in_progress", name: "Active Project" },
      { filter: "on_hold", name: "Held Project" },
      { filter: "completed", name: "Completed Project" },
      { filter: "cancelled", name: "Cancelled Project" },
    ];

    expect(filter).toHaveValue("all");
    expect(visibleProjectNames()).toHaveLength(5);

    for (const item of expected) {
      fireEvent.change(filter, { target: { value: item.filter } });
      expect(visibleProjectNames()).toEqual([item.name]);
    }

    const allFilter: ProjectStatusFilter = "all";
    fireEvent.change(filter, { target: { value: allFilter } });
    expect(visibleProjectNames()).toEqual(projects.map((project) => project.name));
  });

  it("distinguishes filtered no-results and clears the filter", () => {
    setQueryState({ data: { ok: true, value: [projects[0]!] } });
    render(<ProjectsPage />);

    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "cancelled" },
    });
    expect(screen.getByRole("heading", { name: "No matching Projects" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all Projects" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by status")).toHaveValue("all");
  });

  it("renders loading, safe retryable error, and true empty states", () => {
    setQueryState({ isPending: true });
    const rendered = render(<ProjectsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Projects...");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    setQueryState({
      data: {
        ok: false,
        error: {
          code: "project_list_failed",
          message: "The Project list could not be loaded.",
        },
      },
    });
    rendered.rerender(<ProjectsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Project list could not be loaded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(projectsPageMocks.refetch).toHaveBeenCalledOnce();

    setQueryState({ data: { ok: true, value: [] } });
    rendered.rerender(<ProjectsPage />);
    expect(screen.getByRole("heading", { name: "No Projects found" }))
      .toBeInTheDocument();
    expect(screen.queryByLabelText("Filter by status")).not.toBeInTheDocument();
  });

  it("is read-only and adds no Task 070+ controls or detail navigation", () => {
    render(<ProjectsPage />);

    expect(screen.queryByRole("button", {
      name: /create|add|edit|status|archive|cancel|reopen/i,
    })).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
