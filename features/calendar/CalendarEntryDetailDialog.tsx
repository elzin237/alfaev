import { useId } from "react";

import {
  calendarCategoryLabels,
  type CalendarDisplayEvent,
} from "./calendarTypes";

interface CalendarEntryDetailDialogProps {
  event: CalendarDisplayEvent | null;
  canManage: boolean;
  relatedEmployeeName: string | null;
  onClose: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

function CalendarEntryDetailDialog({
  event,
  canManage,
  relatedEmployeeName,
  onClose,
  onEdit,
  onRemove,
}: CalendarEntryDetailDialogProps) {
  const titleId = useId();
  if (!event) return null;
  const isBirthday = event.category === "birthday";
  const date = event.startDate === event.endDate
    ? event.startDate
    : `${event.startDate} – ${event.endDate}`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl">
        <p className="text-sm font-semibold text-red-700">{calendarCategoryLabels[event.category]}</p>
        <h2 id={titleId} className="mt-1 text-xl font-bold text-zinc-900">{event.title}</h2>
        <dl className="mt-5 space-y-3 text-sm">
          <div>
            <dt className="font-semibold text-zinc-500">Date</dt>
            <dd className="mt-1 text-zinc-900">{date}</dd>
          </div>
          {event.description && <div>
            <dt className="font-semibold text-zinc-500">Description</dt>
            <dd className="mt-1 whitespace-pre-wrap text-zinc-900">{event.description}</dd>
          </div>}
          {relatedEmployeeName && <div>
            <dt className="font-semibold text-zinc-500">Related employee</dt>
            <dd className="mt-1 text-zinc-900">{relatedEmployeeName}</dd>
          </div>}
        </dl>
        <div className="mt-7 flex flex-wrap justify-end gap-3">
          {canManage && !isBirthday && <>
            <button type="button" onClick={onRemove}
              className="rounded-xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
              Remove
            </button>
            <button type="button" onClick={onEdit}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
              Edit
            </button>
          </>}
          <button type="button" onClick={onClose}
            className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
            Close
          </button>
        </div>
      </section>
    </div>
  );
}

export default CalendarEntryDetailDialog;
