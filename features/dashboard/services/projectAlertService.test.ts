import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: mocks.rpc },
}));
// Preserve explicit coverage of the legacy Project-only release path.
vi.mock("../../../app/config/workOrderNotificationsActivation",()=>({isWorkOrderNotificationsEnabled:()=>false}));

import {
  dismissProjectAlertNotification,
  getProjectAlertUnreadCount,
  listProjectAlertNotifications,
  markProjectAlertRead,
  parseProjectAlertUnreadCount,
  PROJECT_ALERT_PAGE_SIZE,
} from "./projectAlertService";

const notificationId = "00000000-0000-4000-8000-000000000001";
const alertId = "00000000-0000-4000-8000-000000000002";
const projectId = "00000000-0000-4000-8000-000000000003";
const activityId = "00000000-0000-4000-8000-000000000004";
const productId = "00000000-0000-4000-8000-000000000005";
const createdAt = "2026-10-19T10:00:00.123456+02:00";

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    notification_id: notificationId,
    event_id: alertId,
    notification_kind: "activity",
    project_id: projectId,
    project_name: "Project Alpha",
    activity_id: activityId,
    activity_title: "Production update",
    activity_author_full_name: "Historical Author",
    resolution_id: null,
    resolver_full_name: null,
    resolved_at: null,
    created_at: createdAt,
    read_at: null,
    has_more: false,
    product_id: null,
    product_serial_number: null,
    product_name: null,
    shortage_event_type: null,
    shortage_quantity: null,
    is_baseline_detection: null,
    ...overrides,
  };
}

beforeEach(() => vi.resetAllMocks());

describe("projectAlertService inbox", () => {
  it("calls the bounded RPC with paired null and exact continuation cursors", async () => {
    mocks.rpc.mockResolvedValue({ data: [validRow()], error: null });

    await expect(listProjectAlertNotifications()).resolves.toEqual({
      ok: true,
      value: {
        items: [{
          notificationId,
          alertId,
          notificationKind: "activity",
          projectId,
          projectName: "Project Alpha",
          activityId,
          activityTitle: "Production update",
          activityAuthorFullName: "Historical Author",
          resolutionId: null,
          resolverFullName: null,
          resolvedAt: null,
          productId: null,
          productSerialNumber: null,
          productName: null,
          shortageEventType: null,
          shortageQuantity: null,
          isBaselineDetection: null,
          createdAt,
          readAt: null,
        }],
        hasMore: false,
      },
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "list_project_notifications",
      {
        p_limit: PROJECT_ALERT_PAGE_SIZE,
        p_before_created_at: null,
        p_before_recipient_id: null,
      },
    );

    mocks.rpc.mockClear();
    await listProjectAlertNotifications({ createdAt, notificationId });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "list_project_notifications",
      {
        p_limit: 20,
        p_before_created_at: createdAt,
        p_before_recipient_id: notificationId,
      },
    );
  });

  it.each([
    ["missing field", () => {
      const { project_name: _removed, ...row } = validRow();
      return row;
    }],
    ["extra field", () => validRow({ email: "private@example.com" })],
    ["bad notification UUID", () => validRow({ notification_id: "bad" })],
    ["bad Project UUID", () => validRow({ project_id: "bad" })],
    ["bad timestamp", () => validRow({ created_at: "yesterday" })],
    ["bad read timestamp", () => validRow({ read_at: "later" })],
    ["untrimmed title", () => validRow({ activity_title: " Update " })],
    ["wrong has-more type", () => validRow({ has_more: 1 })],
  ])("rejects a strict projection with %s", async (_name, row) => {
    mocks.rpc.mockResolvedValue({ data: [row()], error: null });
    await expect(listProjectAlertNotifications()).resolves.toMatchObject({
      ok: false,
      error: { code: "inbox_load_failed" },
    });
  });

  it("rejects duplicate rows, inconsistent has-more values, oversized pages, and invalid cursors", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [validRow({ has_more: true }), validRow({ has_more: true })],
      error: null,
    });
    await expect(listProjectAlertNotifications()).resolves.toMatchObject({
      ok: false,
    });

    mocks.rpc.mockResolvedValueOnce({
      data: [
        validRow({ has_more: true }),
        validRow({
          notification_id: "00000000-0000-4000-8000-000000000099",
          has_more: false,
        }),
      ],
      error: null,
    });
    await expect(listProjectAlertNotifications()).resolves.toMatchObject({
      ok: false,
    });

    mocks.rpc.mockResolvedValueOnce({
      data: Array.from({ length: 21 }, (_, index) => validRow({
        notification_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      })),
      error: null,
    });
    await expect(listProjectAlertNotifications()).resolves.toMatchObject({
      ok: false,
    });

    mocks.rpc.mockClear();
    await expect(listProjectAlertNotifications({
      createdAt: "invalid",
      notificationId,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts one bounded 20-row page and preserves its continuation signal", async () => {
    const rows = Array.from({ length: 20 }, (_, index) => validRow({
      notification_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      activity_id: `00000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`,
      has_more: true,
    }));
    mocks.rpc.mockResolvedValue({ data: rows, error: null });

    const result = await listProjectAlertNotifications();
    expect(result).toMatchObject({
      ok: true,
      value: { hasMore: true, items: expect.any(Array) },
    });
    if (!result.ok) throw new Error("Expected a valid alert page");
    expect(result.value.items).toHaveLength(20);
    expect(result.value.items[result.value.items.length - 1]?.notificationId)
      .toBe("00000000-0000-4000-8000-000000000020");
  });

  it("parses existing Activity and Issue-resolution shapes with null shortage context", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [validRow({
        notification_kind: "issue_resolved",
        resolution_id: "00000000-0000-4000-8000-000000000090",
        resolver_full_name: "Issue Resolver",
        resolved_at: "2026-10-20T12:00:00.000Z",
      })],
      error: null,
    });
    await expect(listProjectAlertNotifications()).resolves.toMatchObject({
      ok: true,
      value: {
        items: [{
          notificationKind: "issue_resolved",
          activityId,
          resolutionId: "00000000-0000-4000-8000-000000000090",
          resolverFullName: "Issue Resolver",
          productId: null,
          shortageEventType: null,
        }],
      },
    });
  });

  it("parses exact opening, resolution, and baseline shortage context without numeric conversion", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [validRow({
        notification_kind: "shortage",
        activity_id: null,
        activity_title: null,
        activity_author_full_name: null,
        product_id: productId,
        product_serial_number: "1234567",
        product_name: "Precision Resistor",
        shortage_event_type: "opened",
        shortage_quantity: "9007199254740993.1250",
        is_baseline_detection: true,
      })],
      error: null,
    });
    await expect(listProjectAlertNotifications()).resolves.toEqual({
      ok: true,
      value: {
        items: [{
          notificationId,
          alertId,
          notificationKind: "shortage",
          projectId,
          projectName: "Project Alpha",
          activityId: null,
          activityTitle: null,
          activityAuthorFullName: null,
          resolutionId: null,
          resolverFullName: null,
          resolvedAt: null,
          productId,
          productSerialNumber: "1234567",
          productName: "Precision Resistor",
          shortageEventType: "opened",
          shortageQuantity: "9007199254740993.1250",
          isBaselineDetection: true,
          createdAt,
          readAt: null,
        }],
        hasMore: false,
      },
    });

    mocks.rpc.mockResolvedValueOnce({
      data: [validRow({
        notification_kind: "shortage",
        activity_id: null,
        activity_title: null,
        activity_author_full_name: null,
        product_id: productId,
        product_serial_number: "1234567",
        product_name: "Precision Resistor",
        shortage_event_type: "resolved",
        shortage_quantity: "0",
        is_baseline_detection: false,
      })],
      error: null,
    });
    await expect(listProjectAlertNotifications()).resolves.toMatchObject({
      ok: true,
      value: { items: [{ shortageEventType: "resolved", shortageQuantity: "0" }] },
    });
  });

  it.each([
    ["missing Product", { product_id: null }],
    ["untrimmed Product name", { product_name: " Resistor " }],
    ["unknown event", { shortage_event_type: "increased" }],
    ["numeric quantity", { shortage_quantity: 12 }],
    ["zero opening", { shortage_quantity: "0" }],
    ["nonzero resolution", {
      shortage_event_type: "resolved",
      shortage_quantity: "1",
    }],
    ["baseline resolution", {
      shortage_event_type: "resolved",
      shortage_quantity: "0",
      is_baseline_detection: true,
    }],
    ["Activity shortage field", {
      notification_kind: "activity",
      activity_id: activityId,
      activity_title: "Production update",
      activity_author_full_name: "Historical Author",
      product_id: productId,
    }],
  ])("rejects malformed kind-specific projection: %s", async (_name, invalid) => {
    mocks.rpc.mockResolvedValue({
      data: [validRow({
        notification_kind: "shortage",
        activity_id: null,
        activity_title: null,
        activity_author_full_name: null,
        product_id: productId,
        product_serial_number: "1234567",
        product_name: "Precision Resistor",
        shortage_event_type: "opened",
        shortage_quantity: "12.50",
        is_baseline_detection: false,
        ...invalid,
      })],
      error: null,
    });
    await expect(listProjectAlertNotifications()).resolves.toMatchObject({
      ok: false,
      error: { code: "inbox_load_failed" },
    });
  });

  it("maps backend and network failures without exposing raw details", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "permission denied for secret table" },
    });
    await expect(listProjectAlertNotifications()).resolves.toEqual({
      ok: false,
      error: {
        code: "access_denied",
        message: "You no longer have access to Project alerts.",
      },
    });

    mocks.rpc.mockRejectedValueOnce(new Error("database host and secret"));
    const failed = await listProjectAlertNotifications();
    expect(failed).toMatchObject({
      ok: false,
      error: { code: "inbox_load_failed" },
    });
    expect(JSON.stringify(failed)).not.toMatch(/secret|database host/i);
  });
});

describe("projectAlertService unread count", () => {
  it.each([
    ["0", 0n, "0", false],
    [1, 1n, "1", true],
    [99, 99n, "99", true],
    ["100", 100n, "99+", true],
    ["9223372036854775807", 9223372036854775807n, "99+", true],
  ])("parses %p safely", (raw, exactValue, displayValue, hasUnread) => {
    expect(parseProjectAlertUnreadCount(raw)).toEqual({
      exactValue,
      displayValue,
      hasUnread,
    });
  });

  it("never presents an unsafe JavaScript number as an exact count", () => {
    expect(parseProjectAlertUnreadCount(Number.MAX_SAFE_INTEGER + 1)).toEqual({
      exactValue: null,
      displayValue: "99+",
      hasUnread: true,
    });
  });

  it.each([-1, "-1", 1.5, "1.5", "01", "many", null, undefined])(
    "rejects malformed count %p",
    (raw) => expect(parseProjectAlertUnreadCount(raw)).toBeNull(),
  );

  it("calls the parameter-free count RPC and strictly parses its response", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "100", error: null });
    await expect(getProjectAlertUnreadCount()).resolves.toEqual({
      ok: true,
      value: { exactValue: 100n, displayValue: "99+", hasUnread: true },
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "get_project_alert_unread_count",
    );

    mocks.rpc.mockResolvedValueOnce({ data: "bad", error: null });
    await expect(getProjectAlertUnreadCount()).resolves.toMatchObject({
      ok: false,
      error: { code: "unread_count_load_failed" },
    });
  });
});

describe("projectAlertService mark read", () => {
  it("sends only the notification ID and validates the exact matching receipt", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ notification_id: notificationId, read_at: createdAt }],
      error: null,
    });
    await expect(markProjectAlertRead(notificationId)).resolves.toEqual({
      ok: true,
      value: { notificationId, readAt: createdAt },
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "mark_project_alert_read",
      { p_notification_id: notificationId },
    );
  });

  it.each([
    ["no row", []],
    ["multiple rows", [
      { notification_id: notificationId, read_at: createdAt },
      { notification_id: notificationId, read_at: createdAt },
    ]],
    ["wrong ID", [{
      notification_id: "00000000-0000-4000-8000-000000000099",
      read_at: createdAt,
    }]],
    ["null timestamp", [{ notification_id: notificationId, read_at: null }]],
    ["extra field", [{
      notification_id: notificationId,
      read_at: createdAt,
      recipient_id: "private",
    }]],
  ])("rejects %s", async (_name, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(markProjectAlertRead(notificationId)).resolves.toMatchObject({
      ok: false,
      error: { code: "mark_read_failed" },
    });
  });

  it("rejects invalid input locally and safely maps unavailable notifications", async () => {
    await expect(markProjectAlertRead("not-a-uuid")).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    await expect(markProjectAlertRead(notificationId)).resolves.toMatchObject({
      ok: false,
      error: { code: "notification_unavailable" },
    });
  });
});

describe("projectAlertService dismissal", () => {
  it("sends only the notification ID and validates the exact matching receipt", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ notification_id: notificationId, dismissed_at: createdAt }],
      error: null,
    });
    await expect(dismissProjectAlertNotification(notificationId)).resolves.toEqual({
      ok: true,
      value: { notificationId, dismissedAt: createdAt },
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "dismiss_project_alert_notification",
      { p_notification_id: notificationId },
    );
  });

  it.each([
    ["no row", []],
    ["multiple rows", [
      { notification_id: notificationId, dismissed_at: createdAt },
      { notification_id: notificationId, dismissed_at: createdAt },
    ]],
    ["wrong ID", [{
      notification_id: "00000000-0000-4000-8000-000000000099",
      dismissed_at: createdAt,
    }]],
    ["null timestamp", [{ notification_id: notificationId, dismissed_at: null }]],
    ["extra field", [{
      notification_id: notificationId,
      dismissed_at: createdAt,
      recipient_id: "private",
    }]],
  ])("rejects %s", async (_name, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(dismissProjectAlertNotification(notificationId)).resolves.toMatchObject({
      ok: false,
      error: { code: "dismiss_failed" },
    });
  });

  it("maps authorization, unavailable, invalid-input, and network failures safely", async () => {
    await expect(dismissProjectAlertNotification("not-a-uuid")).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "permission denied for secret table" },
    });
    await expect(dismissProjectAlertNotification(notificationId)).resolves.toEqual({
      ok: false,
      error: {
        code: "access_denied",
        message: "You no longer have access to Project alerts.",
      },
    });

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002" } });
    await expect(dismissProjectAlertNotification(notificationId)).resolves.toMatchObject({
      ok: false,
      error: { code: "notification_unavailable" },
    });

    mocks.rpc.mockRejectedValueOnce(new Error("database host and secret"));
    const failed = await dismissProjectAlertNotification(notificationId);
    expect(failed).toEqual({
      ok: false,
      error: {
        code: "dismiss_failed",
        message: "The notification could not be dismissed. Please try again.",
      },
    });
    expect(JSON.stringify(failed)).not.toMatch(/secret|database host/i);
  });
});
