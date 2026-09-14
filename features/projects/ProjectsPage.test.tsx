import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const projectsPageMocks = vi.hoisted(() => ({
  create: vi.fn(),
  refetch: vi.fn(),
  useProjectCreation: vi.fn(),
  useProjects: vi.fn(),
}));

vi.mock("./hooks/useProjects", () => ({
  useProjects: projectsPageMocks.useProjects,
}));
vi.mock("./hooks/useProjectCreation", () => ({
  useProjectCreation: projectsPageMocks.useProjectCreation,
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

beforeEach(() => {
  setQueryState();
  projectsPageMocks.create.mockResolvedValue({
    ok: true,
    value: { projectId: "00000000-0000-4000-8000-000000000010" },
  });
  projectsPageMocks.useProjectCreation.mockReturnValue({
    canCreate: true,
    create: projectsPageMocks.create,
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("ProjectsPage", () => {
  it("renders authorized rows, all canonical status labels, and lifecycle Projects", () => {
    const { container } = render(<ProjectsPage />, { wrapper: MemoryRouter });

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
    render(<ProjectsPage />, { wrapper: MemoryRouter });
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
    render(<ProjectsPage />, { wrapper: MemoryRouter });

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
    const rendered = render(<ProjectsPage />, { wrapper: MemoryRouter });
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

  it("hides Create Project when the viewer lacks creation authority", () => {
    projectsPageMocks.useProjectCreation.mockReturnValue({
      canCreate: false,
      create: projectsPageMocks.create,
    });

    render(<ProjectsPage />, { wrapper: MemoryRouter });

    expect(screen.queryByRole("button", { name: "Create Project" }))
      .not.toBeInTheDocument();
  });

  it("opens the authorized create form and confirms successful creation", async () => {
    render(<ProjectsPage />, { wrapper: MemoryRouter });

    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    expect(screen.getByRole("dialog", { name: "Create Project" }))
      .toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Project Name"), {
      target: { value: "New Project" },
    });
    fireEvent.change(screen.getByLabelText("Customer"), {
      target: { value: "Customer" },
    });
    fireEvent.change(screen.getByLabelText("Start Date"), {
      target: { value: "2026-09-15" },
    });
    fireEvent.change(screen.getByLabelText("Delivery Date"), {
      target: { value: "2026-09-30" },
    });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {
      name: "Create Project",
    }));

    await waitFor(() => expect(projectsPageMocks.create).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Project created.");
  });

  it("links Project names to detail without adding later mutation controls", () => {
    render(<ProjectsPage />, { wrapper: MemoryRouter });

    expect(screen.queryByRole("button", {
      name: /edit|archive|cancel|reopen/i,
    })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Planning Project" }))
      .toHaveAttribute(
        "href",
        "/projects/00000000-0000-4000-8000-000000000001",
      );
  });
});
