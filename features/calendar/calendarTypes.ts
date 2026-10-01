export const calendarCategories = [
  "birthday",
  "business_trip",
  "event",
  "vacation",
] as const;

export type CalendarCategory = (typeof calendarCategories)[number];
export type CalendarEntryType = Exclude<CalendarCategory, "birthday">;

export interface CalendarEntry {
  id: string;
  entryType: CalendarEntryType;
  title: string;
  startDate: string;
  endDate: string;
  description: string | null;
  relatedUserId: string | null;
}

export interface CalendarBirthday {
  userId: string;
  fullName: string;
  birthday: string;
}

export interface CalendarDisplayEvent {
  id: string;
  category: CalendarCategory;
  title: string;
  label: string;
  startDate: string;
  endDate: string;
  description: string | null;
}

export const calendarCategoryLabels: Record<CalendarCategory, string> = {
  birthday: "Birthday",
  business_trip: "Business Trip",
  event: "Event",
  vacation: "Vacation",
};

export const calendarCategoryFilterLabels: Record<CalendarCategory, string> = {
  birthday: "Birthdays",
  business_trip: "Business Trips",
  event: "Events",
  vacation: "Vacations",
};
