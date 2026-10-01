import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../app/auth/AuthProvider";
import {
  calendarEmployeeChoicesQueryKey,
  calendarEntriesQueryKey,
} from "./calendarQueryKeys";
import {
  createCalendarEntry,
  deleteCalendarEntry,
  listCalendarEmployeeChoices,
  updateCalendarEntry,
} from "./calendarService";
import type { CalendarEntry, CalendarEntryInput } from "./calendarTypes";

export function useCalendarManagement() {
  const { profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const canManage = Boolean(profile?.id && profile.isActive && isAdmin);
  const entriesKey = calendarEntriesQueryKey(profile?.id);

  const refreshEntries = () => queryClient.invalidateQueries({
    queryKey: entriesKey,
    exact: true,
  });
  const refreshAfterMutation = async (
    result: Awaited<ReturnType<typeof createCalendarEntry>>,
  ) => {
    if (result.ok || result.error.code === "stale_entry") {
      await refreshEntries();
    }
  };

  const employeesQuery = useQuery({
    queryKey: calendarEmployeeChoicesQueryKey(profile?.id),
    queryFn: listCalendarEmployeeChoices,
    enabled: canManage,
    staleTime: 60_000,
  });
  const createMutation = useMutation({
    mutationFn: createCalendarEntry,
    onSuccess: refreshAfterMutation,
  });
  const updateMutation = useMutation({
    mutationFn: ({ entry, input }: { entry: CalendarEntry; input: CalendarEntryInput }) =>
      updateCalendarEntry(entry.id, entry.updatedAt, input),
    onSuccess: refreshAfterMutation,
  });
  const deleteMutation = useMutation({
    mutationFn: (entry: CalendarEntry) => deleteCalendarEntry(entry.id, entry.updatedAt),
    onSuccess: refreshAfterMutation,
  });

  return {
    canManage,
    employeesQuery,
    createMutation,
    updateMutation,
    deleteMutation,
  };
}
