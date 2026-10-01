import type { ReactNode } from "react";

import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import {
  compactArchiveRecordId,
  formatArchiveAction,
  formatArchiveDateTime,
  formatArchiveModule,
} from "./archiveFormatting";
import { useArchiveAuditLog } from "./archiveQuery";

function ArchivePage() {
  const query = useArchiveAuditLog();
  const rows = query.data?.pages.flat() ?? [];
  let content: ReactNode;

  if (query.isPending) {
    content = <LoadingState message="Loading Archive activity..." />;
  } else if (query.isError && rows.length === 0) {
    content = (
      <ErrorState
        title="Unable to load Archive"
        message="Archive activity could not be loaded."
        onRetry={() => void query.refetch()}
      />
    );
  } else if (rows.length === 0) {
    content = (
      <EmptyState
        title="No audit activity yet."
        description="Meaningful AlfaEV activity will appear here."
      />
    );
  } else {
    content = (
      <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[980px] divide-y divide-zinc-200 text-left text-sm">
            <thead className="bg-zinc-50">
              <tr>
                {["Date/Time", "User", "Module", "Action", "Record", "Summary"].map(
                  (heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-zinc-500"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {rows.map((row) => (
                <tr key={row.auditLogId} className="align-top text-zinc-700">
                  <td className="whitespace-nowrap px-5 py-4">
                    <time dateTime={row.createdAt}>
                      {formatArchiveDateTime(row.createdAt)}
                    </time>
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 font-medium text-zinc-900">
                    {row.actorFullName}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4">
                    {formatArchiveModule(row.entityType)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4">
                    {formatArchiveAction(row.actionType)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 font-mono text-xs">
                    {row.entityId ? (
                      <span title={row.entityId} aria-label={`Record ${row.entityId}`}>
                        {compactArchiveRecordId(row.entityId)}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="max-w-xl whitespace-normal break-words px-5 py-4 leading-6">
                    {row.summary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-zinc-100 px-5 py-4 text-center">
          {query.isFetchNextPageError && (
            <div role="alert" className="mb-3 text-sm text-red-700">
              <span>More Archive activity could not be loaded.</span>{" "}
              <button
                type="button"
                onClick={() => {
                  if (!query.isFetchingNextPage) void query.fetchNextPage();
                }}
                className="font-semibold underline underline-offset-4"
              >
                Retry load more
              </button>
            </div>
          )}
          {query.hasNextPage && !query.isFetchNextPageError && (
            <button
              type="button"
              disabled={query.isFetchingNextPage}
              onClick={() => {
                if (!query.isFetchingNextPage) void query.fetchNextPage();
              }}
              className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {query.isFetchingNextPage ? "Loading more..." : "Load more"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Archive"
        description="Permanent history of meaningful AlfaEV activity."
      />
      {content}
    </section>
  );
}

export default ArchivePage;
