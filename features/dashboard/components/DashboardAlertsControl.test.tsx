import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useInbox: vi.fn(),
  useUnreadCount: vi.fn(),
  refetchInbox: vi.fn(),
  fetchNextPage: vi.fn(),
  refetchCount: vi.fn(),
  markRead: vi.fn(),
  dismiss: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router")>();
  return { ...original, useNavigate: () => mocks.navigate };
});

vi.mock("../hooks/useProjectAlerts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../hooks/useProjectAlerts")>();
  return {
    ...original,
    useProjectAlertInbox: mocks.useInbox,
    useProjectAlertUnreadCount: mocks.useUnreadCount,
    useMarkProjectAlertRead: () => ({
      access: access(),
      markRead: mocks.markRead,
      isPending: false,
      pendingNotificationId: null,
    }),
    useDismissProjectAlertNotification: () => ({
      access: access(),
      dismiss: mocks.dismiss,
      isPending: false,
      pendingNotificationId: null,
    }),
  };
});

import DashboardAlertsControl from "./DashboardAlertsControl";
import { ProjectAlertRequestError } from "../hooks/useProjectAlerts";
import type {
  ProjectActivityAlertNotification,
  ProjectAlertNotification,
} from "../services/projectAlertService";

const profileOne = "00000000-0000-4000-8000-000000000001";
const profileTwo = "00000000-0000-4000-8000-000000000002";

function notification(
  index: number,
  readAt: string | null = null,
): ProjectActivityAlertNotification {
  return {
    notificationId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    alertId: `00000000-0000-4000-8001-${String(index).padStart(12, "0")}`,
    notificationKind: "activity",
    projectId: "00000000-0000-4000-8000-000000000010",
    projectName: `Project ${index}`,
    activityId: `00000000-0000-4000-8002-${String(index).padStart(12, "0")}`,
    activityTitle: `Activity ${index}`,
    activityAuthorFullName: `Author ${index}`,
    resolutionId: null,
    resolverFullName: null,
    resolvedAt: null,
    productId: null,
    productSerialNumber: null,
    productName: null,
    shortageEventType: null,
    shortageQuantity: null,
    isBaselineDetection: null,
    createdAt: `2026-10-19T10:${String(index).padStart(2, "0")}:00.000Z`,
    readAt,
  };
}

function shortageNotification(
  index: number,
  eventType: "opened" | "resolved",
  options: { baseline?: boolean; quantity?: string; readAt?: string | null } = {},
): ProjectAlertNotification {
  return {
    notificationId: `00000000-0000-4000-8003-${String(index).padStart(12, "0")}`,
    alertId: `00000000-0000-4000-8004-${String(index).padStart(12, "0")}`,
    notificationKind: "shortage",
    projectId: "00000000-0000-4000-8000-000000000010",
    projectName: `Shortage Project ${index}`,
    activityId: null,
    activityTitle: null,
    activityAuthorFullName: null,
    resolutionId: null,
    resolverFullName: null,
    resolvedAt: null,
    productId: `00000000-0000-4000-8005-${String(index).padStart(12, "0")}`,
    productSerialNumber: "1234567",
    productName: `Shared Component ${index}`,
    shortageEventType: eventType,
    shortageQuantity: options.quantity ?? (eventType === "opened" ? "12.5000" : "0"),
    isBaselineDetection: options.baseline ?? false,
    createdAt: `2026-10-21T10:${String(index).padStart(2, "0")}:00.000Z`,
    readAt: options.readAt ?? null,
  };
}

function access(profileId = profileOne, canRead = true, permissionsPending = false) {
  return { profileId, canRead, permissionsPending };
}

function unread(
  displayValue = "0",
  hasUnread = false,
  options: { isError?: boolean; profileId?: string; canRead?: boolean } = {},
) {
  mocks.useUnreadCount.mockReturnValue({
    access: access(options.profileId, options.canRead ?? true),
    unreadCountQuery: {
      data: { exactValue: BigInt(displayValue.replace("+", "") || "0"), displayValue, hasUnread },
      isPending: false,
      isError: options.isError ?? false,
      refetch: mocks.refetchCount,
    },
  });
}

function inbox(
  items: ProjectAlertNotification[] = [],
  options: {
    isPending?: boolean;
    isError?: boolean;
    error?: unknown;
    hasNextPage?: boolean;
    isFetchingNextPage?: boolean;
    isFetchNextPageError?: boolean;
    profileId?: string;
    canRead?: boolean;
  } = {},
) {
  mocks.useInbox.mockReturnValue({
    access: access(options.profileId, options.canRead ?? true),
    items,
    inboxQuery: {
      isPending: options.isPending ?? false,
      isError: options.isError ?? false,
      error: options.error ?? null,
      hasNextPage: options.hasNextPage ?? false,
      isFetchingNextPage: options.isFetchingNextPage ?? false,
      isFetchNextPageError: options.isFetchNextPageError ?? false,
      refetch: mocks.refetchInbox,
      fetchNextPage: mocks.fetchNextPage,
    },
  });
}

beforeEach(() => {
  unread();
  inbox();
  mocks.markRead.mockResolvedValue({
    ok: true,
    value: {
      notificationId: notification(1).notificationId,
      readAt: "2026-10-19T11:00:00.000Z",
    },
  });
  mocks.dismiss.mockResolvedValue({
    ok: true,
    value: {
      notificationId: notification(1).notificationId,
      dismissedAt: "2026-10-19T11:00:00.000Z",
    },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("DashboardAlertsControl", () => {
  it.each([
    ["0", false, "Alerts, no unread notifications", null],
    ["1", true, "Alerts, 1 unread notification", "1"],
    ["99", true, "Alerts, 99 unread notifications", "99"],
    ["99+", true, "Alerts, 99+ unread notifications", "99+"],
  ])("renders the accessible unread badge contract for %s", (
    displayValue,
    hasUnread,
    accessibleName,
    visibleBadge,
  ) => {
    unread(displayValue, hasUnread);
    render(<DashboardAlertsControl />);

    const button = screen.getByRole("button", { name: accessibleName });
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("aria-expanded", "false");
    if (visibleBadge) expect(within(button).getByText(visibleBadge)).toBeInTheDocument();
    else expect(within(button).queryByText(/^0$/)).not.toBeInTheDocument();
  });

  it("opens and toggles the named non-modal panel and refetches the count", () => {
    render(<DashboardAlertsControl />);
    const button = screen.getByRole("button", { name: "Alerts, no unread notifications" });

    fireEvent.click(button);
    const panel = screen.getByRole("dialog", { name: "Project alerts" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-modal", "false");
    expect(panel).toHaveClass("fixed", "w-[min(26rem,calc(100vw-1.5rem))]", "overscroll-contain");
    expect(mocks.refetchCount).toHaveBeenCalledOnce();
    expect(mocks.useInbox).toHaveBeenLastCalledWith(true);

    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("uses native button semantics for keyboard-triggered activation", () => {
    render(<DashboardAlertsControl />);
    const button = screen.getByRole("button", { name: /Alerts,/ });
    button.focus();

    fireEvent.click(button, { detail: 0 });
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Project alerts" })).toBeInTheDocument();
  });

  it("closes on Escape and outside pointer interaction and restores trigger focus", async () => {
    render(
      <div>
        <DashboardAlertsControl />
        <button type="button">Outside</button>
      </div>,
    );
    const trigger = screen.getByRole("button", { name: /Alerts,/ });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders only approved notification fields with textual read status and time semantics", () => {
    const protectedRow = {
      ...notification(1),
      description: "Protected activity description",
      image: "private-image.jpg",
      recipientEmail: "recipient@example.com",
      storagePath: "private/path",
    } as ProjectAlertNotification;
    inbox([protectedRow, notification(2, "2026-10-19T11:00:00.000Z")]);
    render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));

    const list = screen.getByRole("list", { name: "Project alert notifications" });
    expect(within(list).getByText("Activity 1")).toBeInTheDocument();
    expect(within(list).getByText("Project 1")).toBeInTheDocument();
    expect(within(list).getByText("Author 1")).toBeInTheDocument();
    expect(within(list).getByText("Unread")).toBeInTheDocument();
    expect(within(list).getByText("Read")).toBeInTheDocument();
    expect(within(list).getAllByRole("time")[0]).toHaveAttribute(
      "datetime",
      notification(1).createdAt,
    );
    expect(screen.queryByText("Protected activity description")).not.toBeInTheDocument();
    expect(screen.queryByText("private-image.jpg")).not.toBeInTheDocument();
    expect(screen.queryByText("recipient@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("private/path")).not.toBeInTheDocument();
    expect(within(list).getAllByRole("button")).toHaveLength(4);
    expect(within(list).queryByRole("link")).not.toBeInTheDocument();
  });

  it("marks an unread row with its exact UUID and navigates to the authoritative hash URL", async () => {
    inbox([notification(1)]);
    unread("1", true);
    render(<DashboardAlertsControl />);
    const trigger = screen.getByRole("button", { name: /Alerts,/ });
    fireEvent.click(trigger);
    const row = screen.getByRole("button", { name: /^Activity 1/ });
    row.focus();

    fireEvent.click(row);
    expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(
      notification(1).notificationId,
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
      `${`/projects/${notification(1).projectId}`}#activity-${notification(1).activityId}`,
    ));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
  });

  it("renders an Issue resolution safely and marks it read before navigating to the original Issue", async () => {
    const resolved = {
      ...notification(1),
      notificationKind: "issue_resolved" as const,
      resolutionId: "00000000-0000-4000-8000-000000000090",
      resolverFullName: "Issue Resolver",
      resolvedAt: "2026-10-20T12:00:00.000Z",
    };
    inbox([resolved]);
    render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    expect(screen.getByText("Issue resolved: Activity 1")).toBeInTheDocument();
    expect(screen.getByText("Issue Resolver")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {
      name: /^Issue resolved: Activity 1/,
    }));
    expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(resolved.notificationId);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
      `/projects/${resolved.projectId}#activity-${resolved.activityId}`,
    ));
  });

  it("renders a shortage opening with exact shared quantity and baseline indication", () => {
    const opening = shortageNotification(1, "opened", {
      baseline: true,
      quantity: "9007199254740993.1250",
    });
    inbox([opening]);
    render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));

    const row = screen.getByRole("button", { name: /^Component shortage detected/ });
    expect(row).toHaveTextContent("Shortage Project 1");
    expect(row).toHaveTextContent("1234567 · Shared Component 1");
    expect(row).toHaveTextContent(
      "Shared shortage quantity: 9007199254740993.1250",
    );
    expect(row).toHaveTextContent("Existing shortage detected");
    expect(row).not.toHaveTextContent(/allocation/i);
  });

  it("marks a shortage opening read before Project-only navigation", async () => {
    const opening = shortageNotification(2, "opened");
    let resolveMark: ((value: unknown) => void) | undefined;
    mocks.markRead.mockImplementation(() => new Promise((resolve) => {
      resolveMark = resolve;
    }));
    inbox([opening]);
    render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Component shortage detected/ }));

    expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(opening.notificationId);
    expect(mocks.navigate).not.toHaveBeenCalled();
    resolveMark?.({
      ok: true,
      value: {
        notificationId: opening.notificationId,
        readAt: "2026-10-21T11:00:00.000Z",
      },
    });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
      `/projects/${opening.projectId}`,
    ));
    expect(mocks.navigate.mock.calls[0]?.[0]).not.toContain("#activity-");
  });

  it("renders a resolved shortage and directly opens its Project when already read", () => {
    const resolution = shortageNotification(3, "resolved", {
      readAt: "2026-10-21T11:00:00.000Z",
    });
    inbox([resolution]);
    render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));

    const row = screen.getByRole("button", { name: /^Component shortage resolved/ });
    expect(row).toHaveTextContent("1234567 · Shared Component 3");
    expect(row).toHaveTextContent("Resolved");
    expect(row).not.toHaveTextContent("Shared shortage quantity");
    fireEvent.click(row);
    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
      `/projects/${resolution.projectId}`,
    );
  });

  it("navigates an already-read row without another mutation", () => {
    const readItem = notification(2, "2026-10-19T11:00:00.000Z");
    inbox([readItem]);
    render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));

    fireEvent.click(screen.getByRole("button", { name: /^Activity 2/ }));
    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
      `/projects/${readItem.projectId}#activity-${readItem.activityId}`,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("rejects a mismatched authoritative receipt without navigation", async () => {
    inbox([notification(1)]);
    mocks.markRead.mockResolvedValue({
      ok: true,
      value: {
        notificationId: notification(2).notificationId,
        readAt: "2026-10-19T11:00:00.000Z",
      },
    });
    render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Activity 1/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The notification could not be marked as read. Please try again.",
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByText("Unread")).toBeInTheDocument();
  });

  it("keeps the panel and unread row intact on safe failure, then permits retry", async () => {
    inbox([notification(1)]);
    mocks.markRead
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "mark_read_failed",
          message: "The notification could not be marked as read. Please try again.",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          notificationId: notification(1).notificationId,
          readAt: "2026-10-19T11:00:00.000Z",
        },
      });
    render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Activity 1/ }));

    const safeError = await screen.findByRole("alert");
    expect(safeError).toHaveTextContent(
      "The notification could not be marked as read. Please try again.",
    );
    expect(screen.getByText("Unread")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.queryByText(/SQL|network|postgres/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Activity 1/ }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledOnce());
    expect(mocks.markRead).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["notification_unavailable", "This notification is no longer available."],
    ["mark_read_failed", "The notification could not be marked as read. Please try again."],
  ] as const)("does not navigate after %s", async (code, message) => {
    inbox([notification(1)]);
    mocks.markRead.mockResolvedValue({ ok: false, error: { code, message } });
    render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Activity 1/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByText("Unread")).toBeInTheDocument();
  });

  it("hides protected rows and does not navigate after authorization failure", async () => {
    inbox([notification(1)]);
    mocks.markRead.mockResolvedValue({
      ok: false,
      error: {
        code: "access_denied",
        message: "You no longer have access to Project alerts.",
      },
    });
    render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Activity 1/ }));

    await waitFor(() => expect(screen.queryByText("Activity 1")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("You no longer have access");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("synchronously prevents five rapid clicks and blocks other row navigation", async () => {
    let resolveMark: ((value: unknown) => void) | undefined;
    mocks.markRead.mockImplementation(() => new Promise((resolve) => {
      resolveMark = resolve;
    }));
    inbox([
      notification(1),
      notification(2, "2026-10-19T11:00:00.000Z"),
    ]);
    render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    const unreadRow = screen.getByRole("button", { name: /^Activity 1/ });
    const readRow = screen.getByRole("button", { name: /^Activity 2/ });

    for (let index = 0; index < 5; index += 1) fireEvent.click(unreadRow);
    fireEvent.click(readRow);
    expect(mocks.markRead).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(unreadRow).toBeDisabled();
    expect(readRow).toBeDisabled();

    resolveMark?.({
      ok: false,
      error: {
        code: "mark_read_failed",
        message: "The notification could not be marked as read. Please try again.",
      },
    });
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /^Activity 1/ }));
    expect(mocks.markRead).toHaveBeenCalledTimes(2);
  });

  it("ignores an old-profile successful result after profile switch", async () => {
    let resolveMark: ((value: unknown) => void) | undefined;
    mocks.markRead.mockImplementation(() => new Promise((resolve) => {
      resolveMark = resolve;
    }));
    inbox([notification(1)]);
    const rendered = render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Activity 1/ }));

    unread("0", false, { profileId: profileTwo });
    inbox([], { profileId: profileTwo });
    rendered.rerender(<DashboardAlertsControl />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Activity 1")).not.toBeInTheDocument();

    resolveMark?.({
      ok: true,
      value: {
        notificationId: notification(1).notificationId,
        readAt: "2026-10-19T11:00:00.000Z",
      },
    });
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledOnce());
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("keeps inbox fetching closed until the panel opens while count loading is independent", () => {
    render(<DashboardAlertsControl />);
    expect(mocks.useInbox).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    expect(mocks.useInbox).toHaveBeenLastCalledWith(true);
    expect(mocks.refetchCount).toHaveBeenCalledOnce();
  });

  it("shows loading, empty, initial error with retry, and access-denied states", () => {
    inbox([], { isPending: true });
    const rendered = render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading Project alerts...");

    inbox([]);
    rendered.rerender(<DashboardAlertsControl />);
    expect(screen.getByRole("status")).toHaveTextContent("No Project alerts.");

    inbox([], { isError: true });
    rendered.rerender(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetchInbox).toHaveBeenCalledOnce();

    inbox([notification(1)], {
      isError: true,
      error: new ProjectAlertRequestError({
        code: "access_denied",
        message: "You no longer have access to Project alerts.",
      }),
    });
    rendered.rerender(<DashboardAlertsControl />);
    expect(screen.getByRole("alert")).toHaveTextContent("You no longer have access");
    expect(screen.queryByText("Activity 1")).not.toBeInTheDocument();
  });

  it("loads one additional bounded page and exposes pending and retry states", () => {
    inbox([notification(1)], { hasNextPage: true });
    const rendered = render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(mocks.fetchNextPage).toHaveBeenCalledOnce();

    inbox([notification(1)], { hasNextPage: true, isFetchingNextPage: true });
    rendered.rerender(<DashboardAlertsControl />);
    expect(screen.getByRole("button", { name: "Loading more…" })).toBeDisabled();

    inbox([notification(1)], { isFetchNextPageError: true });
    rendered.rerender(<DashboardAlertsControl />);
    expect(screen.getByRole("alert")).toHaveTextContent("More alerts could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Retry loading more" }));
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it("uses separate row and action buttons with keyboard, Escape, outside-click, and focus behavior", async () => {
    inbox([notification(1)]);
    render(
      <div>
        <DashboardAlertsControl />
        <button type="button">Outside</button>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    const row = screen.getByRole("button", { name: /^Activity 1/ });
    const actions = screen.getByRole("button", { name: "Actions for Activity 1" });
    expect(row.contains(actions)).toBe(false);
    expect(actions).toHaveAttribute("aria-haspopup", "menu");
    expect(actions).toHaveAttribute("aria-expanded", "false");

    actions.focus();
    fireEvent.keyDown(actions, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu", { name: "Actions for Activity 1" });
    expect(actions).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(within(menu).getByRole("menuitem")).toHaveFocus());
    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();

    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(actions).toHaveFocus());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Project alerts" })).toBeInTheDocument();

    fireEvent.click(actions);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("requires confirmation and Cancel performs no mutation while restoring action focus", async () => {
    inbox([notification(1)]);
    render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    const actions = screen.getByRole("button", { name: "Actions for Activity 1" });
    fireEvent.click(actions);
    fireEvent.click(screen.getByRole("menuitem", { name: "Dismiss notification" }));

    const confirmation = screen.getByRole("dialog", { name: "Dismiss notification?" });
    expect(confirmation).toHaveTextContent(
      "This removes the notification from your inbox. It cannot be restored.",
    );
    expect(mocks.dismiss).not.toHaveBeenCalled();
    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();

    const cancel = within(confirmation).getByRole("button", { name: "Cancel" });
    const confirm = within(confirmation).getByRole("button", {
      name: "Dismiss notification",
    });
    await waitFor(() => expect(cancel).toHaveFocus());
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(cancel).toHaveFocus();

    fireEvent.click(cancel);
    await waitFor(() => expect(actions).toHaveFocus());
    expect(screen.queryByRole("dialog", { name: "Dismiss notification?" }))
      .not.toBeInTheDocument();
    expect(screen.getByText("Activity 1")).toBeInTheDocument();
  });

  it("guards repeated confirmation and removes only the confirmed row after backend success", async () => {
    let resolveDismiss: ((value: unknown) => void) | undefined;
    mocks.dismiss.mockImplementation(() => new Promise((resolve) => {
      resolveDismiss = resolve;
    }));
    inbox([notification(1), notification(2)]);
    unread("2", true);
    const rendered = render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for Activity 1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Dismiss notification" }));
    const confirm = screen.getByRole("button", { name: "Dismiss notification" });

    for (let index = 0; index < 5; index += 1) fireEvent.click(confirm);
    expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith(notification(1).notificationId);
    expect(screen.getByRole("button", { name: "Dismiss notification…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Activity 2/ })).toBeDisabled();
    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();

    inbox([notification(2)]);
    unread("1", true);
    resolveDismiss?.({
      ok: true,
      value: {
        notificationId: notification(1).notificationId,
        dismissedAt: "2026-10-19T11:00:00.000Z",
      },
    });
    await waitFor(() => expect(
      screen.queryByRole("dialog", { name: "Dismiss notification?" }),
    ).not.toBeInTheDocument());
    rendered.rerender(<DashboardAlertsControl />);
    expect(screen.queryByText("Activity 1")).not.toBeInTheDocument();
    expect(screen.getByText("Activity 2")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Project alerts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project alerts" })).toHaveFocus();
    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("keeps the original row and exposes a safe retry after a dismissal failure", async () => {
    inbox([notification(1)]);
    mocks.dismiss
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "dismiss_failed",
          message: "The notification could not be dismissed. Please try again.",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          notificationId: notification(1).notificationId,
          dismissedAt: "2026-10-19T11:00:00.000Z",
        },
      });
    render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for Activity 1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Dismiss notification" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The notification could not be dismissed. Please try again.",
    );
    expect(screen.getByText("Activity 1")).toBeInTheDocument();
    expect(screen.getByText("Unread")).toBeInTheDocument();
    expect(screen.queryByText(/SQL|postgres|secret/i)).not.toBeInTheDocument();
    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    await waitFor(() => expect(mocks.dismiss).toHaveBeenCalledTimes(2));
  });

  it("purges stale rows on dismissal access denial", async () => {
    inbox([notification(1)]);
    mocks.dismiss.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "access_denied",
        message: "You no longer have access to Project alerts.",
      },
    });
    render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for Activity 1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Dismiss notification" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    await waitFor(() => expect(screen.queryByText("Activity 1")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("You no longer have access");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it("ignores a dismissal completion after a profile switch", async () => {
    let resolveDismiss: ((value: unknown) => void) | undefined;
    mocks.dismiss.mockImplementation(() => new Promise((resolve) => {
      resolveDismiss = resolve;
    }));
    unread("1", true);
    inbox([notification(1)]);
    const rendered = render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for Activity 1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Dismiss notification" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    unread("0", false, { profileId: profileTwo });
    inbox([], { profileId: profileTwo });
    rendered.rerender(<DashboardAlertsControl />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    resolveDismiss?.({
      ok: true,
      value: {
        notificationId: notification(1).notificationId,
        dismissedAt: "2026-10-19T11:00:00.000Z",
      },
    });
    await waitFor(() => expect(mocks.dismiss).toHaveBeenCalledOnce());
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(screen.queryByText("Activity 1")).not.toBeInTheDocument();
  });

  it("closes across profile changes and never shows the previous profile's rows", () => {
    inbox([notification(1)]);
    const rendered = render(<DashboardAlertsControl />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts,/ }));
    expect(screen.getByText("Activity 1")).toBeInTheDocument();

    unread("0", false, { profileId: profileTwo });
    inbox([], { profileId: profileTwo, isPending: true });
    rendered.rerender(<DashboardAlertsControl />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Activity 1")).not.toBeInTheDocument();
  });

  it("removes the control when current permissions no longer authorize alerts", () => {
    const rendered = render(<DashboardAlertsControl />);
    expect(screen.getByRole("button", { name: /Alerts,/ })).toBeInTheDocument();

    unread("0", false, { canRead: false });
    inbox([], { canRead: false });
    rendered.rerender(<DashboardAlertsControl />);
    expect(screen.queryByRole("button", { name: /Alerts,/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
