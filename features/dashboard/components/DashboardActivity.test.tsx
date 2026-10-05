import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import DashboardActivity from "./DashboardActivity";
import type { DashboardActivitySection } from "../services/dashboardService";

const section: DashboardActivitySection = {
  recent: [
    {
      auditLogId: "00000000-0000-4000-8000-000000000002",
      actorUserId: "00000000-0000-4000-8000-000000000010",
      actorFullName: "Historical Actor",
      actionType: "project.updated",
      entityType: "project",
      entityId: "00000000-0000-4000-8000-000000000020",
      summary: "Updated delivery date for Project Alpha",
      createdAt: "2026-10-02T10:00:00Z",
    },
    {
      auditLogId: "00000000-0000-4000-8000-000000000001",
      actorUserId: "00000000-0000-4000-8000-000000000011",
      actorFullName: "Active Actor",
      actionType: "calendar.created",
      entityType: "calendar_entry",
      entityId: null,
      summary: "Created company event",
      createdAt: "2026-10-01T09:00:00Z",
    },
  ],
};

afterEach(cleanup);

describe("DashboardActivity", () => {
  it("renders trusted summaries, actors, timestamps, and backend order", () => {
    const { container } = render(<DashboardActivity section={section} />, {
      wrapper: MemoryRouter,
    });

    const summaries = section.recent.map((activity) =>
      screen.getByText(activity.summary));
    expect(summaries.map((node) => node.textContent)).toEqual([
      "Updated delivery date for Project Alpha",
      "Created company event",
    ]);
    expect(summaries[0]!.compareDocumentPosition(summaries[1]!))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("Historical Actor")).toBeInTheDocument();
    expect(container.querySelector('time[datetime="2026-10-02T10:00:00Z"]'))
      .toBeInTheDocument();
  });

  it("renders new or unfamiliar list-safe audit identifiers with the neutral presentation", () => {
    const pcbSection: DashboardActivitySection = {
      recent: [{
        auditLogId: "00000000-0000-4000-8000-000000000030",
        actorUserId: "00000000-0000-4000-8000-000000000031",
        actorFullName: "Vladan Markovic",
        actionType: "pcb_production.completed",
        entityType: "pcb_production_run",
        entityId: "00000000-0000-4000-8000-000000000032",
        summary: "Completed PCB production Work Order RN-2026-0013",
        createdAt: "2026-10-05T11:20:04.934482+00:00",
      }, {
        auditLogId: "00000000-0000-4000-8000-000000000033",
        actorUserId: "00000000-0000-4000-8000-000000000031",
        actorFullName: "Vladan Markovic",
        actionType: "future_module.recorded",
        entityType: "future_module_record",
        entityId: null,
        summary: "Future list-safe activity summary",
        createdAt: "2026-10-05T11:15:47.246966+00:00",
      }],
    };

    const { container } = render(<DashboardActivity section={pcbSection} />, {
      wrapper: MemoryRouter,
    });

    expect(screen.getByText("Completed PCB production Work Order RN-2026-0013"))
      .toBeInTheDocument();
    expect(screen.getByText("Future list-safe activity summary")).toBeInTheDocument();
    expect(container.querySelectorAll("li svg")).toHaveLength(2);
    expect(screen.queryByText("pcb_production.completed")).not.toBeInTheDocument();
    expect(screen.queryByText("future_module_record")).not.toBeInTheDocument();
  });

  it("uses only list-safe presentation and the existing Archive route", () => {
    render(<DashboardActivity section={section} />, { wrapper: MemoryRouter });

    expect(screen.getByRole("link", { name: "View all activity" }))
      .toHaveAttribute("href", "/archive");
    expect(screen.queryByText("project.updated")).not.toBeInTheDocument();
    expect(screen.queryByText("project", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(section.recent[0]!.actorUserId)).not.toBeInTheDocument();
    expect(screen.queryByText(section.recent[0]!.entityId!)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/before_data|after_data|metadata|email|birthday|is_admin|permissions/i);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("renders the authorized empty state", () => {
    render(<DashboardActivity section={{ recent: [] }} />, { wrapper: MemoryRouter });
    expect(screen.getByText("No recent activity.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recent Activity" }))
      .toBeInTheDocument();
  });

  it("renders nothing for a backend-hidden Activity section", () => {
    const { container } = render(<DashboardActivity section={null} />, {
      wrapper: MemoryRouter,
    });
    expect(container).toBeEmptyDOMElement();
  });
});
