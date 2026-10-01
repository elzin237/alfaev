export function calendarEntriesQueryKey(profileId: string | undefined) {
  return ["calendar", profileId, "entries"] as const;
}

export function calendarBirthdaysQueryKey(profileId: string | undefined) {
  return ["calendar", profileId, "birthdays"] as const;
}

export function calendarEmployeeChoicesQueryKey(profileId: string | undefined) {
  return ["calendar", profileId, "employee-choices"] as const;
}
