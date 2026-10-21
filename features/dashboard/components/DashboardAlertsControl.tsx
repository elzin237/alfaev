import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router";

import ConfirmDialog from "../../../shared/components/ConfirmDialog";
import {
  ProjectAlertRequestError,
  useDismissProjectAlertNotification,
  useMarkProjectAlertRead,
  useProjectAlertInbox,
  useProjectAlertUnreadCount,
} from "../hooks/useProjectAlerts";
import type {
  ProjectAlertNotification,
  ProjectAlertDismissReceipt,
  ProjectAlertReadReceipt,
  ProjectAlertResult,
} from "../services/projectAlertService";
import DashboardAlertsPanel from "./DashboardAlertsPanel";

interface PanelPosition {
  left: number;
  top: number;
}

function DashboardAlertsControl() {
  const navigate = useNavigate();
  const panelId = useId();
  const panelTitleId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelTitleRef = useRef<HTMLHeadingElement>(null);
  const dismissReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const previousProfileIdRef = useRef<string | null>(null);
  const currentProfileIdRef = useRef<string | null>(null);
  const currentCanReadRef = useRef(false);
  const mountedRef = useRef(false);
  const interactionLockRef = useRef(false);
  const interactionSequenceRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const [pendingNotificationId, setPendingNotificationId] = useState<string | null>(null);
  const [dismissTarget, setDismissTarget] = useState<ProjectAlertNotification | null>(null);
  const [dismissError, setDismissError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{
    notificationId: string;
    message: string;
  } | null>(null);
  const [mutationAccessDenied, setMutationAccessDenied] = useState(false);
  const { access, unreadCountQuery } = useProjectAlertUnreadCount();
  const { access: inboxAccess, inboxQuery, items } = useProjectAlertInbox(open);
  const markReadMutation = useMarkProjectAlertRead();
  const dismissMutation = useDismissProjectAlertNotification();
  const unreadCount = unreadCountQuery.data;
  const canRead = access.canRead && inboxAccess.canRead &&
    markReadMutation.access.canRead && dismissMutation.access.canRead;
  const permissionsPending = access.permissionsPending ||
    inboxAccess.permissionsPending || markReadMutation.access.permissionsPending ||
    dismissMutation.access.permissionsPending;
  const inboxAccessDenied = inboxQuery.error instanceof ProjectAlertRequestError &&
    inboxQuery.error.alertError.code === "access_denied";
  currentProfileIdRef.current = access.profileId;
  currentCanReadRef.current = canRead && !inboxAccessDenied &&
    !mutationAccessDenied;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      interactionSequenceRef.current += 1;
      interactionLockRef.current = false;
    };
  }, []);

  function closePanel(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => buttonRef.current?.focus());
  }

  function positionPanel() {
    const button = buttonRef.current;
    const panel = panelRef.current;
    if (!button || !panel) return;
    const edge = 12;
    const gap = 8;
    const buttonBounds = button.getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    const maxLeft = Math.max(edge, window.innerWidth - panelBounds.width - edge);
    const left = Math.min(
      Math.max(edge, buttonBounds.right - panelBounds.width),
      maxLeft,
    );
    const maxTop = Math.max(edge, window.innerHeight - panelBounds.height - edge);
    const below = buttonBounds.bottom + gap;
    const top = below + panelBounds.height <= window.innerHeight - edge
      ? below
      : Math.max(edge, Math.min(buttonBounds.top - panelBounds.height - gap, maxTop));
    setPosition({ left, top });
  }

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    positionPanel();
  }, [open, items.length, inboxQuery.isPending]);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (event: MouseEvent) => {
      if (dismissTarget) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (target instanceof Element && target.closest("[data-dashboard-alert-layer]")) {
        return;
      }
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        closePanel(true);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || dismissTarget) return;
      event.preventDefault();
      closePanel(true);
    };
    const handlePositionChange = () => positionPanel();
    document.addEventListener("mousedown", handleOutsidePointer);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handlePositionChange);
    window.addEventListener("scroll", handlePositionChange, true);
    return () => {
      document.removeEventListener("mousedown", handleOutsidePointer);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handlePositionChange);
      window.removeEventListener("scroll", handlePositionChange, true);
    };
  }, [dismissTarget, open]);

  useEffect(() => {
    const nextProfileId = access.profileId;
    const previousProfileId = previousProfileIdRef.current;
    if (previousProfileId && previousProfileId !== nextProfileId) {
      setOpen(false);
      setPendingNotificationId(null);
      setRowError(null);
      setDismissTarget(null);
      setDismissError(null);
      dismissReturnFocusRef.current = null;
      setMutationAccessDenied(false);
      interactionSequenceRef.current += 1;
      interactionLockRef.current = false;
    }
    previousProfileIdRef.current = nextProfileId;
  }, [access.profileId]);

  useEffect(() => {
    if (open && !permissionsPending && !canRead) setOpen(false);
  }, [canRead, open, permissionsPending]);

  async function selectNotification(item: ProjectAlertNotification) {
    if (interactionLockRef.current || !access.profileId || !canRead) return;
    interactionLockRef.current = true;
    const sequence = interactionSequenceRef.current + 1;
    interactionSequenceRef.current = sequence;
    const profileId = access.profileId;
    const destination = item.activityId
      ? `/projects/${item.projectId}#activity-${item.activityId}`
      : `/projects/${item.projectId}`;
    setRowError(null);

    if (item.readAt !== null) {
      setOpen(false);
      navigate(destination);
      return;
    }

    setPendingNotificationId(item.notificationId);
    let result: ProjectAlertResult<ProjectAlertReadReceipt>;
    try {
      result = await markReadMutation.markRead(item.notificationId);
    } catch {
      result = {
        ok: false,
        error: {
          code: "mark_read_failed",
          message: "The notification could not be marked as read. Please try again.",
        },
      };
    }

    const requestIsCurrent = mountedRef.current &&
      interactionSequenceRef.current === sequence &&
      currentProfileIdRef.current === profileId && currentCanReadRef.current;
    if (!requestIsCurrent) {
      if (interactionSequenceRef.current === sequence) {
        interactionLockRef.current = false;
        setPendingNotificationId(null);
      }
      return;
    }

    if (result.ok) {
      if (result.value.notificationId !== item.notificationId) {
        setRowError({
          notificationId: item.notificationId,
          message: "The notification could not be marked as read. Please try again.",
        });
      } else {
        setOpen(false);
        navigate(destination);
      }
    } else if (result.error.code === "access_denied") {
      setMutationAccessDenied(true);
      setRowError(null);
    } else if (result.error.code !== "request_pending") {
      setRowError({
        notificationId: item.notificationId,
        message: result.error.message,
      });
    }

    if (interactionSequenceRef.current === sequence) {
      interactionLockRef.current = false;
      setPendingNotificationId(null);
    }
  }

  function requestDismiss(
    item: ProjectAlertNotification,
    returnFocusTo: HTMLButtonElement,
  ) {
    if (interactionLockRef.current || !access.profileId || !canRead) return;
    dismissReturnFocusRef.current = returnFocusTo;
    setDismissError(null);
    setDismissTarget(item);
  }

  function cancelDismiss() {
    if (pendingNotificationId !== null) return;
    const returnFocusTo = dismissReturnFocusRef.current;
    setDismissTarget(null);
    setDismissError(null);
    dismissReturnFocusRef.current = null;
    queueMicrotask(() => returnFocusTo?.isConnected && returnFocusTo.focus());
  }

  async function confirmDismiss() {
    const target = dismissTarget;
    if (interactionLockRef.current || !target || !access.profileId || !canRead) return;
    interactionLockRef.current = true;
    const sequence = interactionSequenceRef.current + 1;
    interactionSequenceRef.current = sequence;
    const profileId = access.profileId;
    setDismissError(null);
    setRowError(null);
    setPendingNotificationId(target.notificationId);

    let result: ProjectAlertResult<ProjectAlertDismissReceipt>;
    try {
      result = await dismissMutation.dismiss(target.notificationId);
    } catch {
      result = {
        ok: false,
        error: {
          code: "dismiss_failed",
          message: "The notification could not be dismissed. Please try again.",
        },
      };
    }

    const requestIsCurrent = mountedRef.current &&
      interactionSequenceRef.current === sequence &&
      currentProfileIdRef.current === profileId && currentCanReadRef.current;
    if (!requestIsCurrent) {
      if (interactionSequenceRef.current === sequence) {
        interactionLockRef.current = false;
        setPendingNotificationId(null);
      }
      return;
    }

    if (result.ok) {
      if (result.value.notificationId !== target.notificationId) {
        setDismissError("The notification could not be dismissed. Please try again.");
      } else {
        setDismissTarget(null);
        setDismissError(null);
        dismissReturnFocusRef.current = null;
        queueMicrotask(() => panelTitleRef.current?.focus());
      }
    } else if (result.error.code === "access_denied") {
      setDismissTarget(null);
      setDismissError(null);
      dismissReturnFocusRef.current = null;
      setMutationAccessDenied(true);
    } else if (result.error.code !== "request_pending") {
      setDismissError(result.error.message);
    }

    if (interactionSequenceRef.current === sequence) {
      interactionLockRef.current = false;
      setPendingNotificationId(null);
    }
  }

  if (permissionsPending || !canRead) return null;

  const countLabel = unreadCountQuery.isPending
    ? "unread count loading"
    : unreadCountQuery.isError
      ? "unread count unavailable"
      : unreadCount?.hasUnread
        ? `${unreadCount.displayValue} unread notification${
          unreadCount.exactValue === 1n ? "" : "s"
        }`
        : "no unread notifications";
  const accessDenied = mutationAccessDenied || inboxAccessDenied;
  const initialError = inboxQuery.isError && !inboxQuery.isFetchNextPageError;

  const panel = open && createPortal(
    <DashboardAlertsPanel
      panelId={panelId}
      titleId={panelTitleId}
      panelRef={panelRef}
      titleRef={panelTitleRef}
      position={position}
      items={accessDenied ? [] : items}
      isPending={inboxQuery.isPending}
      isInitialError={initialError}
      isAccessDenied={accessDenied}
      hasNextPage={Boolean(inboxQuery.hasNextPage)}
      isFetchingNextPage={inboxQuery.isFetchingNextPage}
      isNextPageError={inboxQuery.isFetchNextPageError}
      pendingNotificationId={pendingNotificationId}
      interactionPending={pendingNotificationId !== null || dismissTarget !== null}
      rowError={rowError}
      onNotificationSelect={(item) => void selectNotification(item)}
      onDismissRequest={requestDismiss}
      onRetry={() => void inboxQuery.refetch()}
      onLoadMore={() => void inboxQuery.fetchNextPage()}
    />,
    document.body,
  );

  return (
    <div className="shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Alerts, ${countLabel}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (!open) void unreadCountQuery.refetch();
          setOpen((current) => !current);
        }}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-zinc-400 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
      >
        <Bell aria-hidden="true" className="size-4.5 text-zinc-600" strokeWidth={1.9} />
        <span>Alerts</span>
        {unreadCount?.hasUnread && (
          <span
            aria-hidden="true"
            className="inline-flex min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-bold leading-5 text-white"
          >
            {unreadCount.displayValue}
          </span>
        )}
      </button>
      {panel}
      <ConfirmDialog
        open={dismissTarget !== null}
        title="Dismiss notification?"
        description="This removes the notification from your inbox. It cannot be restored."
        confirmLabel="Dismiss notification"
        onCancel={cancelDismiss}
        onConfirm={() => void confirmDismiss()}
        isSubmitting={pendingNotificationId === dismissTarget?.notificationId}
        confirmVariant="danger"
        errorMessage={dismissError}
        layerClassName="z-[80]"
      />
    </div>
  );
}

export default DashboardAlertsControl;
