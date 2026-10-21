import type { RefObject } from "react";

import type { ProjectAlertNotification } from "../services/projectAlertService";
import DashboardAlertActionsMenu from "./DashboardAlertActionsMenu";

const alertTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface DashboardAlertsPanelProps {
  panelId: string;
  titleId: string;
  panelRef: RefObject<HTMLDivElement | null>;
  titleRef: RefObject<HTMLHeadingElement | null>;
  position: { left: number; top: number } | null;
  items: ProjectAlertNotification[];
  isPending: boolean;
  isInitialError: boolean;
  isAccessDenied: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isNextPageError: boolean;
  pendingNotificationId: string | null;
  interactionPending: boolean;
  rowError: { notificationId: string; message: string } | null;
  onNotificationSelect: (item: ProjectAlertNotification) => void;
  onDismissRequest: (
    item: ProjectAlertNotification,
    returnFocusTo: HTMLButtonElement,
  ) => void;
  onRetry: () => void;
  onLoadMore: () => void;
}

function DashboardAlertsPanel({
  panelId,
  titleId,
  panelRef,
  titleRef,
  position,
  items,
  isPending,
  isInitialError,
  isAccessDenied,
  hasNextPage,
  isFetchingNextPage,
  isNextPageError,
  pendingNotificationId,
  interactionPending,
  rowError,
  onNotificationSelect,
  onDismissRequest,
  onRetry,
  onLoadMore,
}: DashboardAlertsPanelProps) {
  return (
    <section
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      style={position ? { left: position.left, top: position.top } : undefined}
      className={`fixed z-[60] flex max-h-[min(36rem,calc(100vh-1.5rem))] w-[min(26rem,calc(100vw-1.5rem))] flex-col overflow-hidden overscroll-contain rounded-2xl border border-zinc-200 bg-white shadow-[0_18px_50px_rgba(24,24,27,0.18)] ${
        position ? "visible" : "invisible"
      }`}
    >
      <header className="shrink-0 border-b border-zinc-100 px-5 py-4">
        <h2
          ref={titleRef}
          id={titleId}
          tabIndex={-1}
          className="text-base font-bold text-zinc-950 focus:outline-none"
        >
          Project alerts
        </h2>
      </header>

      <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto">
        {isAccessDenied ? (
          <div role="alert" className="px-5 py-8 text-center">
            <p className="font-semibold text-zinc-900">Alerts are unavailable.</p>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              You no longer have access to Project alerts.
            </p>
          </div>
        ) : isPending ? (
          <div role="status" className="flex items-center justify-center gap-3 px-5 py-10">
            <span
              aria-hidden="true"
              className="size-5 animate-spin rounded-full border-2 border-zinc-200 border-t-red-600"
            />
            <span className="text-sm font-medium text-zinc-600">
              Loading Project alerts...
            </span>
          </div>
        ) : isInitialError ? (
          <div role="alert" className="px-5 py-8 text-center">
            <p className="font-semibold text-zinc-900">Unable to load alerts</p>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Project alerts could not be loaded. Please try again.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div role="status" className="px-5 py-10 text-center">
            <p className="font-semibold text-zinc-900">No Project alerts.</p>
            <p className="mt-1 text-sm text-zinc-500">
              New Project alerts will appear here.
            </p>
          </div>
        ) : (
          <>
            <ol aria-label="Project alert notifications" className="divide-y divide-zinc-100">
              {items.map((item) => {
                const unread = item.readAt === null;
                const notificationTitle = item.notificationKind === "issue_resolved"
                  ? `Issue resolved: ${item.activityTitle ?? "Project Issue"}`
                  : item.notificationKind === "activity"
                    ? item.activityTitle ?? "Project update"
                    : item.shortageEventType === "opened"
                      ? "Component shortage detected"
                      : "Component shortage resolved";
                const attribution = item.notificationKind === "issue_resolved"
                  ? item.resolverFullName
                  : item.notificationKind === "activity"
                    ? item.activityAuthorFullName
                    : null;
                const pending = pendingNotificationId === item.notificationId;
                const itemError = rowError?.notificationId === item.notificationId
                  ? rowError.message
                  : null;
                const errorId = `${panelId}-row-error-${item.notificationId}`;
                return (
                  <li
                    key={item.notificationId}
                    className={unread ? "bg-red-50/45" : undefined}
                  >
                    <div className="flex items-stretch">
                      <button
                        type="button"
                        onClick={() => onNotificationSelect(item)}
                        disabled={interactionPending}
                        aria-busy={pending}
                        aria-describedby={itemError ? errorId : undefined}
                        className="min-w-0 flex-1 px-5 py-4 pr-2 text-left transition hover:bg-zinc-100/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 disabled:cursor-wait disabled:opacity-70"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`break-words text-sm text-zinc-950 ${
                              unread ? "font-bold" : "font-semibold"
                            }`}>
                              {notificationTitle}
                            </p>
                            <p className="mt-1 break-words text-sm font-medium text-zinc-700">
                              {item.projectName}
                            </p>
                            {item.notificationKind === "shortage" && (
                              <div className="mt-2 space-y-1 text-xs leading-5 text-zinc-600">
                                <p className="break-words">
                                  <span className="font-mono font-semibold text-zinc-800">
                                    {item.productSerialNumber}
                                  </span>
                                  {" · "}
                                  <span className="font-medium text-zinc-800">
                                    {item.productName}
                                  </span>
                                </p>
                                <p>
                                  {item.shortageEventType === "opened" ? (
                                    <>
                                      Shared shortage quantity:{" "}
                                      <span className="font-semibold text-red-700">
                                        {item.shortageQuantity}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="font-semibold text-emerald-700">
                                      Resolved
                                    </span>
                                  )}
                                </p>
                                {item.isBaselineDetection && (
                                  <p className="font-medium text-amber-700">
                                    Existing shortage detected
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                          <span
                            role={pending ? "status" : undefined}
                            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                              pending
                                ? "bg-amber-100 text-amber-800"
                                : unread
                                  ? "bg-red-100 text-red-700"
                                  : "bg-zinc-100 text-zinc-600"
                            }`}
                          >
                            {pending ? "Processing" : unread ? "Unread" : "Read"}
                          </span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-zinc-500">
                          {attribution && (
                            <>
                              {item.notificationKind === "issue_resolved" ? "Resolved by " : "By "}
                              <span className="font-medium text-zinc-700">{attribution}</span>
                              {" · "}
                            </>
                          )}
                          <time dateTime={item.createdAt}>
                            {alertTimestampFormatter.format(new Date(item.createdAt))}
                          </time>
                        </p>
                      </button>
                      <DashboardAlertActionsMenu
                        item={item}
                        disabled={interactionPending}
                        onDismissRequest={onDismissRequest}
                      />
                    </div>
                    {itemError && (
                      <p
                        id={errorId}
                        role="alert"
                        className="border-t border-red-100 bg-red-50 px-5 py-2.5 text-sm text-red-700"
                      >
                        {itemError}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>

            {(hasNextPage || isNextPageError) && (
              <div className="border-t border-zinc-100 px-5 py-4 text-center">
                {isNextPageError && (
                  <p role="alert" className="mb-3 text-sm text-red-700">
                    More alerts could not be loaded.
                  </p>
                )}
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={isFetchingNextPage}
                  className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isFetchingNextPage ? "Loading more…" : isNextPageError ? "Retry loading more" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default DashboardAlertsPanel;
