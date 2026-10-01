import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calendarPageMocks = vi.hoisted(() => ({
  refetchBirthdays: vi.fn(),
  refetchEntries: vi.fn(),
  useCalendarData: vi.fn(),
}));

vi.mock("./useCalendarData", () => ({
  useCalendarData: calendarPageMocks.useCalendarData,
}));

import CalendarPage from "./CalendarPage";
import type { CalendarBirthday, CalendarEntry } from "./calendarTypes";

const entries: CalendarEntry[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    entryType: "event",
    title: "Safety review",
    startDate: "2026-09-15",
    endDate: "2026-09-15",
    description: "Quarterly safety review",
    relatedUserId: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    entryType: "business_trip",
    title: "Supplier visit",
    startDate: "2026-09-14",
    endDate: "2026-09-16",
    description: null,
    relatedUserId: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    entryType: "vacation",
    title: "Annual leave",
    startDate: "2026-08-31",
    endDate: "2026-09-01",
    description: null,
    relatedUserId: "00000000-0000-4000-8000-000000000030",
  },
];
const birthdays: CalendarBirthday[] = [{
  userId: "00000000-0000-4000-8000-000000000020",
  fullName: "Birthday Person",
  birthday: "1990-09-15",
}];

function setLoadedData(
  entryRows: CalendarEntry[] = entries,
  birthdayRows: CalendarBirthday[] = birthdays,
) {
  calendarPageMocks.useCalendarData.mockReturnValue({
    entriesQuery: {
      data: { ok: true, value: entryRows },
      isError: false,
      isPending: false,
      refetch: calendarPageMocks.refetchEntries,
    },
    birthdaysQuery: {
      data: { ok: true, value: birthdayRows },
      isError: false,
      isPending: false,
      refetch: calendarPageMocks.refetchBirthdays,
    },
  });
}

function renderCalendar() {
  return render(<CalendarPage initialMonth="2026-09" today="2026-09-15" />);
}

function dayCell(container: HTMLElement, date: string): HTMLElement {
  const cell = container.querySelector<HTMLElement>(`[data-calendar-date="${date}"]`);
  if (!cell) throw new Error(`Calendar cell ${date} was not rendered`);
  return cell;
}

beforeEach(() => setLoadedData());

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("CalendarPage", () => {
  it("renders a real stable month grid with heading, weekdays, today, and outside days", () => {
    const { container } = renderCalendar();

    expect(screen.getByRole("heading", { name: "September 2026" }))
      .toBeInTheDocument();
    for (const weekday of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(screen.getByText(weekday)).toBeInTheDocument();
    }
    expect(container.querySelectorAll("[data-calendar-date]")).toHaveLength(42);
    expect(dayCell(container, "2026-08-31")).toHaveAttribute(
      "data-outside-month",
      "true",
    );
    expect(dayCell(container, "2026-09-15")).toHaveAttribute(
      "aria-current",
      "date",
    );
    expect(screen.getByLabelText("September 15, 2026, today"))
      .toBeInTheDocument();
  });

  it("renders friendly category labels and inclusive multi-day items", () => {
    const { container } = renderCalendar();

    expect(within(dayCell(container, "2026-09-15")).getByText(
      "Event: Safety review",
    )).toBeInTheDocument();
    for (const date of ["2026-09-14", "2026-09-15", "2026-09-16"]) {
      expect(within(dayCell(container, date)).getByText(
        "Business Trip: Supplier visit",
      )).toBeInTheDocument();
    }
    expect(within(dayCell(container, "2026-08-31")).getByText(
      "Vacation: Annual leave",
    )).toBeInTheDocument();
    expect(within(dayCell(container, "2026-09-15")).getByText(
      "Birthday: Birthday Person",
    )).toBeInTheDocument();
    expect(screen.queryByText("business_trip")).not.toBeInTheDocument();
    expect(screen.queryByText(/1990|age|@example\.com/i)).not.toBeInTheDocument();
  });

  it("selects all filters by default and supports independent, multiple, and zero selections", () => {
    const { container } = renderCalendar();
    const birthday = screen.getByRole("checkbox", { name: "Birthdays" });
    const businessTrip = screen.getByRole("checkbox", { name: "Business Trips" });
    const event = screen.getByRole("checkbox", { name: "Events" });
    const vacation = screen.getByRole("checkbox", { name: "Vacations" });

    for (const checkbox of [birthday, businessTrip, event, vacation]) {
      expect(checkbox).toBeChecked();
    }

    fireEvent.click(birthday);
    expect(screen.queryByText("Birthday: Birthday Person")).not.toBeInTheDocument();
    expect(screen.getByText("Event: Safety review")).toBeInTheDocument();

    fireEvent.click(businessTrip);
    expect(screen.queryByText("Business Trip: Supplier visit")).not.toBeInTheDocument();
    expect(screen.getByText("Event: Safety review")).toBeInTheDocument();

    fireEvent.click(event);
    fireEvent.click(vacation);
    expect(screen.getByRole("heading", { name: "No categories selected" }))
      .toBeInTheDocument();
    expect(dayCell(container, "2026-09-15").querySelector("ul")).toBeNull();
    expect(calendarPageMocks.refetchEntries).not.toHaveBeenCalled();
    expect(calendarPageMocks.refetchBirthdays).not.toHaveBeenCalled();
  });

  it("navigates previous, next, and Today without refetching authorized data", () => {
    renderCalendar();

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "October 2026" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("heading", { name: "September 2026" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("heading", { name: "August 2026" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("heading", { name: "September 2026" }))
      .toBeInTheDocument();
    expect(calendarPageMocks.refetchEntries).not.toHaveBeenCalled();
    expect(calendarPageMocks.refetchBirthdays).not.toHaveBeenCalled();
  });

  it("shows an honest no-events state while retaining the month grid", () => {
    setLoadedData([], []);
    const { container } = renderCalendar();

    expect(screen.getByRole("status")).toHaveTextContent(
      "No events in September 2026.",
    );
    expect(container.querySelectorAll("[data-calendar-date]")).toHaveLength(42);
  });

  it("handles initial loading and any source failure as a retryable whole-page error", () => {
    calendarPageMocks.useCalendarData.mockReturnValue({
      entriesQuery: {
        data: undefined,
        isError: false,
        isPending: true,
        refetch: calendarPageMocks.refetchEntries,
      },
      birthdaysQuery: {
        data: { ok: true, value: birthdays },
        isError: false,
        isPending: false,
        refetch: calendarPageMocks.refetchBirthdays,
      },
    });
    const rendered = renderCalendar();
    expect(screen.getByRole("status")).toHaveTextContent("Loading Calendar...");

    calendarPageMocks.useCalendarData.mockReturnValue({
      entriesQuery: {
        data: { ok: true, value: entries },
        isError: false,
        isPending: false,
        refetch: calendarPageMocks.refetchEntries,
      },
      birthdaysQuery: {
        data: {
          ok: false,
          error: {
            code: "calendar_birthdays_failed",
            message: "Calendar birthdays could not be loaded.",
          },
        },
        isError: false,
        isPending: false,
        refetch: calendarPageMocks.refetchBirthdays,
      },
    });
    rendered.rerender(<CalendarPage initialMonth="2026-09" today="2026-09-15" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The complete Calendar could not be loaded.",
    );
    expect(screen.queryByText("Event: Safety review")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(calendarPageMocks.refetchEntries).toHaveBeenCalledOnce();
    expect(calendarPageMocks.refetchBirthdays).toHaveBeenCalledOnce();
  });

  it("remains read-only for every viewer, including Admin", () => {
    renderCalendar();

    expect(screen.queryByRole("button", { name: /add event|edit|delete|archive/i }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /add event|edit|delete|archive/i }))
      .not.toBeInTheDocument();
  });
});
