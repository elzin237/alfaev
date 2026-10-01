import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calendarPageMocks = vi.hoisted(() => ({
  createMutateAsync: vi.fn(),
  deleteMutateAsync: vi.fn(),
  refetchBirthdays: vi.fn(),
  refetchEntries: vi.fn(),
  updateMutateAsync: vi.fn(),
  useCalendarData: vi.fn(),
  useCalendarManagement: vi.fn(),
}));

vi.mock("./useCalendarData", () => ({
  useCalendarData: calendarPageMocks.useCalendarData,
}));
vi.mock("./useCalendarManagement", () => ({
  useCalendarManagement: calendarPageMocks.useCalendarManagement,
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
    updatedAt: "2026-09-01T10:00:00.123456+00:00",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    entryType: "business_trip",
    title: "Supplier visit",
    startDate: "2026-09-14",
    endDate: "2026-09-16",
    description: null,
    relatedUserId: null,
    updatedAt: "2026-09-02T10:00:00.123456+00:00",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    entryType: "vacation",
    title: "Annual leave",
    startDate: "2026-08-31",
    endDate: "2026-09-01",
    description: null,
    relatedUserId: "00000000-0000-4000-8000-000000000030",
    updatedAt: "2026-09-03T10:00:00.123456+00:00",
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

function setAdminManagement() {
  calendarPageMocks.useCalendarManagement.mockReturnValue({
    canManage: true,
    employeesQuery: {
      data: {
        ok: true,
        value: [{
          userId: "00000000-0000-4000-8000-000000000030",
          fullName: "Related Employee",
        }],
      },
      isError: false,
      isPending: false,
    },
    createMutation: { mutateAsync: calendarPageMocks.createMutateAsync, isPending: false },
    updateMutation: { mutateAsync: calendarPageMocks.updateMutateAsync, isPending: false },
    deleteMutation: { mutateAsync: calendarPageMocks.deleteMutateAsync, isPending: false },
  });
}

function dayCell(container: HTMLElement, date: string): HTMLElement {
  const cell = container.querySelector<HTMLElement>(`[data-calendar-date="${date}"]`);
  if (!cell) throw new Error(`Calendar cell ${date} was not rendered`);
  return cell;
}

beforeEach(() => {
  setLoadedData();
  calendarPageMocks.createMutateAsync.mockResolvedValue({
    ok: true,
    value: { id: entries[0]!.id, updatedAt: entries[0]!.updatedAt },
  });
  calendarPageMocks.updateMutateAsync.mockResolvedValue({
    ok: true,
    value: { id: entries[0]!.id, updatedAt: entries[0]!.updatedAt },
  });
  calendarPageMocks.deleteMutateAsync.mockResolvedValue({
    ok: true,
    value: { id: entries[0]!.id, updatedAt: entries[0]!.updatedAt },
  });
  calendarPageMocks.useCalendarManagement.mockReturnValue({
    canManage: false,
    employeesQuery: {
      data: undefined,
      isError: false,
      isPending: false,
    },
    createMutation: { mutateAsync: calendarPageMocks.createMutateAsync, isPending: false },
    updateMutation: { mutateAsync: calendarPageMocks.updateMutateAsync, isPending: false },
    deleteMutation: { mutateAsync: calendarPageMocks.deleteMutateAsync, isPending: false },
  });
});

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

  it("keeps non-admin Calendar viewing usable without management controls", () => {
    renderCalendar();

    expect(screen.queryByRole("button", { name: /add calendar entry|edit|remove|archive/i }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Event: Safety review" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Quarterly safety review");
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("shows Admin management and submits an exact normalized create payload without losing view state", async () => {
    setAdminManagement();
    renderCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Birthdays" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Calendar Entry" }));

    const dialog = screen.getByRole("dialog", { name: "Add Calendar Entry" });
    expect(within(dialog).getByLabelText("Category")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Title")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Start Date")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("End Date")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Description/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Related employee/)).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "Business Trip" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("option", { name: "Birthday" })).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "business_trip" } });
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: " Supplier visit " } });
    fireEvent.change(within(dialog).getByLabelText("Start Date"), { target: { value: "2026-10-20" } });
    fireEvent.change(within(dialog).getByLabelText("End Date"), { target: { value: "2026-10-21" } });
    fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: " Visit " } });
    fireEvent.change(within(dialog).getByLabelText(/Related employee/), {
      target: { value: "00000000-0000-4000-8000-000000000030" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Calendar Entry" }));

    await waitFor(() => expect(calendarPageMocks.createMutateAsync).toHaveBeenCalledWith({
      entryType: "business_trip",
      title: "Supplier visit",
      startDate: "2026-10-20",
      endDate: "2026-10-21",
      description: "Visit",
      relatedUserId: "00000000-0000-4000-8000-000000000030",
    }));
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Birthdays" })).not.toBeChecked();
    expect(screen.getByText("Calendar entry added.")).toBeInTheDocument();
  });

  it("preloads and updates an Admin-opened non-Birthday entry", async () => {
    setAdminManagement();
    renderCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Event: Safety review" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("dialog", { name: "Edit Calendar Entry" });
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Safety review");
    expect(within(dialog).getByLabelText("Start Date")).toHaveValue("2026-09-15");
    expect(within(dialog).getByLabelText(/Description/)).toHaveValue("Quarterly safety review");
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Updated review" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Calendar Entry" }));

    await waitFor(() => expect(calendarPageMocks.updateMutateAsync).toHaveBeenCalledWith({
      entry: entries[0],
      input: expect.objectContaining({ title: "Updated review" }),
    }));
    expect(screen.getByRole("status")).toHaveTextContent("Calendar entry updated.");
  });

  it("requires confirmation for Remove and keeps stale failure visible", async () => {
    setAdminManagement();
    calendarPageMocks.deleteMutateAsync.mockResolvedValue({
      ok: false,
      error: {
        code: "stale_entry",
        message: "This Calendar entry changed. Review the latest version and try again.",
      },
    });
    renderCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Event: Safety review" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const confirmation = screen.getByRole("dialog", { name: "Remove Calendar Entry?" });
    expect(confirmation).toHaveTextContent("Safety review");
    expect(confirmation).toHaveTextContent("Event");
    expect(confirmation).toHaveTextContent("permanently removed");
    expect(calendarPageMocks.deleteMutateAsync).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calendarPageMocks.deleteMutateAsync).toHaveBeenCalledWith(entries[0]));
    expect(screen.getByRole("alert")).toHaveTextContent("changed");
    expect(screen.queryByText("Calendar entry removed.")).not.toBeInTheDocument();
  });

  it("completes confirmed Remove without approval workflow controls", async () => {
    setAdminManagement();
    renderCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Event: Safety review" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(calendarPageMocks.deleteMutateAsync).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Remove Calendar Entry?" }))
      .getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calendarPageMocks.deleteMutateAsync).toHaveBeenCalledWith(entries[0]));
    expect(screen.getByText("Calendar entry removed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve|reject/i })).not.toBeInTheDocument();
  });

  it("never exposes Edit or Remove for a derived Birthday, even to Admin", () => {
    setAdminManagement();
    renderCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Birthday: Birthday Person" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Birthday Person");
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("shows stale edit safely without closing the form or claiming success", async () => {
    setAdminManagement();
    calendarPageMocks.updateMutateAsync.mockResolvedValue({
      ok: false,
      error: {
        code: "stale_entry",
        message: "This Calendar entry changed. Review the latest version and try again.",
      },
    });
    renderCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Event: Safety review" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "My unsaved edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Calendar Entry" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("changed"));
    expect(screen.getByLabelText("Title")).toHaveValue("My unsaved edit");
    expect(screen.queryByText("Calendar entry updated.")).not.toBeInTheDocument();
  });
});
