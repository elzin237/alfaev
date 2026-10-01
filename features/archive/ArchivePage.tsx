import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import ArchiveDetailDialog from "./ArchiveDetailDialog";
import {
  compactArchiveRecordId,
  formatArchiveAction,
  formatArchiveDateTime,
  formatArchiveModule,
} from "./archiveFormatting";
import {
  countActiveArchiveFilters,
  localDateStartAsUtc,
  type ArchiveFilters,
} from "./archiveFilters";
import {
  useArchiveAuditLog,
  useArchiveFilterOptions,
} from "./archiveQuery";
import type { ArchiveAuditLogItem } from "./archiveService";

const controlClassName =
  "mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500";

function ArchivePage() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [entityType, setEntityType] = useState("");
  const [actionType, setActionType] = useState("");
  const [selectedAudit, setSelectedAudit] = useState<ArchiveAuditLogItem | null>(null);
  const searchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      searchTimerRef.current = null;
    }, 300);
    return () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
      }
    };
  }, [searchInput]);

  const filters = useMemo<ArchiveFilters>(() => ({
    createdFrom: fromDate ? localDateStartAsUtc(fromDate) : null,
    createdBefore: toDate ? localDateStartAsUtc(toDate, true) : null,
    actorUserId: actorUserId || null,
    entityType: entityType || null,
    actionType: actionType || null,
    searchText: debouncedSearch || null,
  }), [actionType, actorUserId, debouncedSearch, entityType, fromDate, toDate]);
  const immediateFilterCount = countActiveArchiveFilters({
    ...filters,
    searchText: searchInput.trim() || null,
  });
  const isSearchSettling = searchInput.trim() !== debouncedSearch;
  const query = useArchiveAuditLog(filters);
  const optionsQuery = useArchiveFilterOptions();
  const options = optionsQuery.data?.ok ? optionsQuery.data.value : null;
  const optionsFailed = optionsQuery.isError || optionsQuery.data?.ok === false;
  const rows = query.data?.pages.flat() ?? [];

  function clearFilters() {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    setSearchInput("");
    setDebouncedSearch("");
    setFromDate("");
    setToDate("");
    setActorUserId("");
    setEntityType("");
    setActionType("");
  }

  let content: ReactNode;

  if (isSearchSettling || query.isPending) {
    content = (
      <LoadingState
        message={isSearchSettling
          ? "Applying Archive filters..."
          : "Loading Archive activity..."}
      />
    );
  } else if (query.isError && rows.length === 0) {
    content = (
      <ErrorState
        title="Unable to load Archive"
        message="Archive activity could not be loaded."
        onRetry={() => void query.refetch()}
      />
    );
  } else if (rows.length === 0) {
    content = immediateFilterCount > 0 ? (
      <EmptyState
        title="No audit activity matches these filters."
        description="Change or clear the filters to view other activity."
        action={{ label: "Clear filters", onClick: clearFilters }}
      />
    ) : (
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
                <tr
                  key={row.auditLogId}
                  tabIndex={0}
                  aria-label={`Open Archive detail: ${row.summary}`}
                  onClick={() => setSelectedAudit(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedAudit(row);
                    }
                  }}
                  className="cursor-pointer align-top text-zinc-700 transition hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-600"
                >
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

      <section
        aria-label="Archive filters"
        className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <label className="text-sm font-semibold text-zinc-800 xl:col-span-2">
            Search
            <input
              type="search"
              value={searchInput}
              maxLength={200}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search Archive activity"
              className={controlClassName}
            />
          </label>
          <label className="text-sm font-semibold text-zinc-800">
            From
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(event) => setFromDate(event.target.value)}
              className={controlClassName}
            />
          </label>
          <label className="text-sm font-semibold text-zinc-800">
            To
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(event) => setToDate(event.target.value)}
              className={controlClassName}
            />
          </label>
          <label className="text-sm font-semibold text-zinc-800">
            User
            <select
              value={actorUserId}
              disabled={!options}
              onChange={(event) => setActorUserId(event.target.value)}
              className={controlClassName}
            >
              <option value="">All users</option>
              {options?.actors.map((actor) => (
                <option key={actor.userId} value={actor.userId}>
                  {actor.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-zinc-800">
            Module
            <select
              value={entityType}
              disabled={!options}
              onChange={(event) => setEntityType(event.target.value)}
              className={controlClassName}
            >
              <option value="">All modules</option>
              {options?.entityTypes.map((value) => (
                <option key={value} value={value}>{formatArchiveModule(value)}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-zinc-800">
            Action
            <select
              value={actionType}
              disabled={!options}
              onChange={(event) => setActionType(event.target.value)}
              className={controlClassName}
            >
              <option value="">All actions</option>
              {options?.actionTypes.map((value) => (
                <option key={value} value={value}>{formatArchiveAction(value)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-500" aria-live="polite">
            {immediateFilterCount > 0
              ? `${immediateFilterCount} active ${immediateFilterCount === 1 ? "filter" : "filters"}`
              : "No active filters"}
          </p>
          <button
            type="button"
            disabled={immediateFilterCount === 0}
            onClick={clearFilters}
            className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear filters
          </button>
        </div>

        {optionsFailed && (
          <div role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            Archive filter options could not be loaded.{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-4"
              onClick={() => void optionsQuery.refetch()}
            >
              Retry filter options
            </button>
          </div>
        )}
      </section>

      {content}
      <ArchiveDetailDialog
        selected={selectedAudit}
        onClose={() => setSelectedAudit(null)}
      />
    </section>
  );
}

export default ArchivePage;
