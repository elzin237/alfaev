import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import DashboardProjects from "./DashboardProjects";
import type { DashboardProjectsSection } from "../services/dashboardService";

const section: DashboardProjectsSection = {
  statusCounts: {
    planned: 1,
    inProgress: 2,
    onHold: 3,
    completed: 4,
    cancelled: 5,
  },
  recent: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Newest Project",
      customerName: "Customer B",
      status: "in_progress",
      deliveryDate: "2026-10-20",
      updatedAt: "2026-10-02T10:00:00Z",
    },
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Older Project",
      customerName: "Customer A",
      status: "on_hold",
      deliveryDate: "2026-10-18",
      updatedAt: "2026-10-01T10:00:00Z",
    },
  ],
};

afterEach(cleanup);

describe("DashboardProjects", () => {
  it("renders nothing for a backend-hidden section", () => {
    const { container } = render(<DashboardProjects section={null} />, {
      wrapper: MemoryRouter,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every status count and human-readable recent status", () => {
    render(<DashboardProjects section={section} />, { wrapper: MemoryRouter });
    const widget = screen.getByRole("region", { name: "Projects Overview" });

    for (const [label, count] of [
      ["Planned", "1"],
      ["In Progress", "2"],
      ["On Hold", "3"],
      ["Completed", "4"],
      ["Cancelled", "5"],
    ] as const) {
      const term = within(widget).getByText(label, { selector: "dt span:last-child" })
        .closest("dt");
      expect(term).not.toBeNull();
      expect(term!.nextElementSibling).toHaveTextContent(count);
    }
    expect(within(widget).getByText("In Progress", { selector: "span.inline-flex" }))
      .toBeInTheDocument();
    expect(within(widget).getByText("On Hold", { selector: "span.inline-flex" }))
      .toBeInTheDocument();
  });

  it("preserves row order, links exact IDs, and formats delivery dates", () => {
    const { container } = render(<DashboardProjects section={section} />, {
      wrapper: MemoryRouter,
    });
    const links = screen.getAllByRole("link").filter((link) =>
      link.getAttribute("href")?.startsWith("/projects/"));
    expect(links.map((link) => link.textContent)).toEqual([
      "Newest Project",
      "Older Project",
    ]);
    expect(links[0]).toHaveAttribute("href", `/projects/${section.recent[0]!.id}`);
    expect(links[1]).toHaveAttribute("href", `/projects/${section.recent[1]!.id}`);
    expect(screen.getByRole("link", { name: "View all projects" }))
      .toHaveAttribute("href", "/projects");
    expect(container.querySelector('time[datetime="2026-10-20"]'))
      .toHaveTextContent("20 Oct 2026");
  });

  it("keeps the status summary for an authorized empty section without mutation controls", () => {
    render(<DashboardProjects section={{ ...section, recent: [] }} />, {
      wrapper: MemoryRouter,
    });
    expect(screen.getByText("No projects yet.")).toBeInTheDocument();
    expect(screen.getByText("Planned", { selector: "dt span:last-child" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/planning|material|create|archive/i)).not.toBeInTheDocument();
  });

  it("renders a real-count distribution and handles a zero total without fake segments", () => {
    const { rerender } = render(<DashboardProjects section={section} />, {
      wrapper: MemoryRouter,
    });
    expect(screen.getByRole("img", {
      name: "Project status distribution based on 15 projects",
    }).querySelectorAll("[data-project-segment]")).toHaveLength(5);

    rerender(<DashboardProjects section={{
      statusCounts: {
        planned: 0,
        inProgress: 0,
        onHold: 0,
        completed: 0,
        cancelled: 0,
      },
      recent: [],
    }} />);
    expect(screen.getByRole("img", {
      name: "Project status distribution based on 0 projects",
    }).querySelectorAll("[data-project-segment]")).toHaveLength(0);
  });
});
