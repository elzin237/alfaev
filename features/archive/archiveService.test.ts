import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../lib/supabase/client", () => ({
  supabase: { rpc: mocks.rpc },
}));

import { listAuditLogPage } from "./archiveService";

const row = {
  audit_log_id: "00000000-0000-4000-8000-000000000001",
  actor_user_id: "00000000-0000-4000-8000-000000000002",
  actor_full_name: "Historical Actor",
  action_type: "calendar.created",
  entity_type: "calendar_entry",
  entity_id: "00000000-0000-4000-8000-000000000003",
  summary: "Created company event",
  created_at: "2026-10-01T09:15:30.123456+02:00",
};

beforeEach(() => vi.resetAllMocks());

describe("archiveService", () => {
  it("calls the first page with the exact limit and null keyset cursor", async () => {
    mocks.rpc.mockResolvedValue({ data: [row], error: null });

    await expect(listAuditLogPage()).resolves.toEqual({
      ok: true,
      value: [{
        auditLogId: row.audit_log_id,
        actorUserId: row.actor_user_id,
        actorFullName: row.actor_full_name,
        actionType: row.action_type,
        entityType: row.entity_type,
        entityId: row.entity_id,
        summary: row.summary,
        createdAt: row.created_at,
      }],
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("list_audit_log_page", {
      p_limit: 50,
      p_before_created_at: null,
      p_before_id: null,
    });
  });

  it("uses the last-row cursor supplied by the infinite query", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    await listAuditLogPage({
      createdAt: row.created_at,
      auditLogId: row.audit_log_id,
    });

    expect(mocks.rpc).toHaveBeenCalledWith("list_audit_log_page", {
      p_limit: 50,
      p_before_created_at: row.created_at,
      p_before_id: row.audit_log_id,
    });
  });

  it.each([
    ["missing field", (() => {
      const { summary: _summary, ...malformed } = row;
      return malformed;
    })()],
    ["unexpected field", { ...row, metadata: { secret: true } }],
    ["invalid audit UUID", { ...row, audit_log_id: "not-a-uuid" }],
    ["invalid actor UUID", { ...row, actor_user_id: "not-a-uuid" }],
    ["invalid nullable entity UUID", { ...row, entity_id: "not-a-uuid" }],
    ["blank actor", { ...row, actor_full_name: " " }],
    ["blank summary", { ...row, summary: "" }],
    ["invalid timestamp", { ...row, created_at: "yesterday" }],
  ])("fails safely for a malformed row with %s", async (_label, malformed) => {
    mocks.rpc.mockResolvedValue({ data: [malformed], error: null });

    await expect(listAuditLogPage()).resolves.toEqual({
      ok: false,
      error: {
        code: "archive_page_failed",
        message: "Archive activity could not be loaded.",
      },
    });
  });

  it("accepts a null entity ID and hides provider or thrown error details", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ ...row, entity_id: null }], error: null });
    await expect(listAuditLogPage()).resolves.toMatchObject({
      ok: true,
      value: [{ entityId: null }],
    });

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "raw SQL" } });
    await expect(listAuditLogPage()).resolves.toMatchObject({
      ok: false,
      error: { code: "archive_page_failed" },
    });

    mocks.rpc.mockRejectedValueOnce(new Error("raw network detail"));
    await expect(listAuditLogPage()).resolves.toEqual({
      ok: false,
      error: {
        code: "archive_page_failed",
        message: "Archive activity could not be loaded.",
      },
    });
  });

  it("contains no total-count or direct-table request", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await listAuditLogPage();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls.flat().join(" ")).not.toMatch(/count|audit_logs/);
  });
});
