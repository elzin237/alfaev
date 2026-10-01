import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../app/auth/AuthProvider";
import {
  calendarBirthdaysQueryKey,
  calendarEntriesQueryKey,
} from "./calendarQueryKeys";
import {
  listCalendarBirthdays,
  listCalendarEntries,
} from "./calendarService";

export function useCalendarData() {
  const { profile } = useAuth();
  const enabled = Boolean(profile?.id);

  const entriesQuery = useQuery({
    queryKey: calendarEntriesQueryKey(profile?.id),
    queryFn: listCalendarEntries,
    enabled,
    staleTime: 60_000,
  });
  const birthdaysQuery = useQuery({
    queryKey: calendarBirthdaysQueryKey(profile?.id),
    queryFn: listCalendarBirthdays,
    enabled,
    staleTime: 60_000,
  });

  return { entriesQuery, birthdaysQuery };
}
