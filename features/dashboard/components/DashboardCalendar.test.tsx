import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import DashboardCalendar from "./DashboardCalendar";
import type { DashboardCalendarSection } from "../services/dashboardService";

const section: DashboardCalendarSection = {
  upcoming: [
    {
      kind: "birthday",
      id: "00000000-0000-4000-8000-000000000001",
      title: "Alfa User",
      startDate: "2028-02-29",
      endDate: "2028-02-29",
      relatedUserId: "00000000-0000-4000-8000-000000000001",
    },
    {
      kind: "business_trip",
      id: "00000000-0000-4000-8000-000000000002",
      title: "Sarajevo client visit",
      startDate: "2028-03-02",
      endDate: "2028-03-04",
      relatedUserId: null,
    },
    {
      kind: "event",
      id: "00000000-0000-4000-8000-000000000003",
      title: "Company Event",
      startDate: "2028-03-05",
      endDate: "2028-03-05",
      relatedUserId: null,
    },
    {
      kind: "vacation",
      id: "00000000-0000-4000-8000-000000000004",
      title: "Team Vacation",
      startDate: "2028-03-06",
      endDate: "2028-03-10",
      relatedUserId: "00000000-0000-4000-8000-000000000005",
    },
  ],
};

afterEach(cleanup);

describe("DashboardCalendar", () => {
  it("renders every supported kind and preserves backend row order", () => {
    render(<DashboardCalendar section={section} />, { wrapper: MemoryRouter });

    for (const label of ["Birthday", "Business Trip", "Event", "Vacation"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    const titles = section.upcoming.map((item) => screen.getByText(item.title));
    for (let index = 1; index < titles.length; index += 1) {
      expect(titles[index - 1]!.compareDocumentPosition(titles[index]!))
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it("formats a single date and preserves the original multi-day range", () => {
    const { container } = render(<DashboardCalendar section={section} />, {
      wrapper: MemoryRouter,
    });

    expect(container.querySelectorAll('time[datetime="2028-02-29"]')).toHaveLength(1);
    expect(container.querySelector('time[datetime="2028-02-29"]'))
      .toHaveTextContent("29 Feb 2028");
    expect(container.querySelector('time[datetime="2028-03-02"]'))
      .toHaveTextContent("2 Mar 2028");
    expect(container.querySelector('time[datetime="2028-03-04"]'))
      .toHaveTextContent("4 Mar 2028");
    expect(screen.getByText("FEB")).toBeInTheDocument();
    expect(screen.getByText("29", { selector: "div" })).toBeInTheDocument();
  });

  it("shows the projected birthday without calculating age or exposing user data", () => {
    render(<DashboardCalendar section={section} />, { wrapper: MemoryRouter });
    expect(screen.getByText("Alfa User")).toBeInTheDocument();
    expect(screen.queryByText(/age|years old|email|admin|permission/i))
      .not.toBeInTheDocument();
    expect(screen.queryByText(section.upcoming[0]!.relatedUserId!))
      .not.toBeInTheDocument();
  });

  it("uses the existing Calendar route and has no per-item links", () => {
    render(<DashboardCalendar section={section} />, { wrapper: MemoryRouter });
    expect(screen.getByRole("link", { name: "View full calendar" }))
      .toHaveAttribute("href", "/calendar");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("renders the company-wide empty state", () => {
    render(<DashboardCalendar section={{ upcoming: [] }} />, {
      wrapper: MemoryRouter,
    });
    expect(screen.getByText("No upcoming calendar entries."))
      .toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Upcoming Calendar" }))
      .toBeInTheDocument();
  });
});
