import { useEffect, useId, useRef } from "react";
import { Link } from "react-router";

import { archiveContextPath } from "./archiveContext";
import {
  formatArchiveAction,
  formatArchiveDateTime,
  formatArchiveModule,
} from "./archiveFormatting";
import ArchiveJsonValue from "./ArchiveJsonValue";
import { useArchiveAuditDetail } from "./archiveQuery";
import type {
  ArchiveAuditLogItem,
  ArchiveJsonValue as ArchiveJsonData,
} from "./archiveService";

function DetailSection({
  title,
  value,
}: {
  title: string;
  value: ArchiveJsonData;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <h3 className="text-sm font-bold text-zinc-900">{title}</h3>
      <div className="mt-3"><ArchiveJsonValue value={value} /></div>
    </section>
  );
}

export default function ArchiveDetailDialog({
  selected,
  onClose,
}: {
  selected: ArchiveAuditLogItem | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const query = useArchiveAuditDetail(selected?.auditLogId ?? null);

  useEffect(() => {
    if (!selected) return;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, selected]);

  if (!selected) return null;
  const detail = query.data;
  const hasAdditionalDetail = detail?.beforeData !== null ||
    detail?.afterData !== null || detail?.metadata !== null;
  const contextPath = detail?.targetViewAuthorized && detail.contextKind && detail.contextId
    ? archiveContextPath(detail.contextKind, detail.contextId)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl sm:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-red-700">
              {formatArchiveModule(selected.entityType)} · {formatArchiveAction(selected.actionType)}
            </p>
            <h2 id={titleId} className="mt-1 text-2xl font-bold text-zinc-900">
              Archive detail
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
          >
            Close
          </button>
        </div>

        <dl className="mt-6 grid gap-4 rounded-2xl border border-zinc-200 p-4 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold text-zinc-500">Date/Time</dt><dd className="mt-1 text-zinc-900">{formatArchiveDateTime(selected.createdAt)}</dd></div>
          <div><dt className="font-semibold text-zinc-500">User</dt><dd className="mt-1 text-zinc-900">{selected.actorFullName}</dd></div>
          <div className="sm:col-span-2"><dt className="font-semibold text-zinc-500">Summary</dt><dd className="mt-1 whitespace-pre-wrap text-zinc-900">{selected.summary}</dd></div>
          {selected.entityId && <div className="sm:col-span-2"><dt className="font-semibold text-zinc-500">Record ID</dt><dd className="mt-1 break-all font-mono text-xs text-zinc-900">{selected.entityId}</dd></div>}
        </dl>

        {query.isPending && (
          <div role="status" className="mt-6 rounded-2xl bg-zinc-50 p-5 text-sm text-zinc-600">
            Loading Archive detail...
          </div>
        )}
        {query.isError && (
          <div role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            <p>Archive detail could not be loaded.</p>
            <button type="button" onClick={() => void query.refetch()} className="mt-2 font-semibold underline underline-offset-4">Try again</button>
          </div>
        )}
        {detail && !detail.detailAuthorized && (
          <p className="mt-6 rounded-2xl bg-zinc-100 p-5 text-sm text-zinc-700">
            Additional details are restricted for this record.
          </p>
        )}
        {detail?.detailAuthorized && (
          <div className="mt-6 space-y-4">
            {detail.beforeData !== null && <DetailSection title="Before" value={detail.beforeData} />}
            {detail.afterData !== null && <DetailSection title="After" value={detail.afterData} />}
            {detail.metadata !== null && <DetailSection title="Metadata" value={detail.metadata} />}
            {!hasAdditionalDetail && (
              <p className="rounded-2xl bg-zinc-100 p-5 text-sm text-zinc-600">
                No additional audit detail was recorded.
              </p>
            )}
          </div>
        )}

        {contextPath && (
          <div className="mt-6 flex justify-end">
            <Link to={contextPath} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
              Open record
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
