import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../lib/supabase/client", () => ({
  supabase: { rpc: mocks.rpc },
}));

import { EMPTY_ARCHIVE_FILTERS } from "./archiveFilters";
import { getAuditLogFilterOptions, listAuditLogPage } from "./archiveService";

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
      p_created_from: null,
      p_created_before: null,
      p_actor_user_id: null,
      p_entity_type: null,
      p_action_type: null,
      p_search_text: null,
    });
  });

  it("uses the last-row cursor supplied by the infinite query", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    await listAuditLogPage(EMPTY_ARCHIVE_FILTERS, {
      createdAt: row.created_at,
      auditLogId: row.audit_log_id,
    });

    expect(mocks.rpc).toHaveBeenCalledWith("list_audit_log_page", {
      p_limit: 50,
      p_before_created_at: row.created_at,
      p_before_id: row.audit_log_id,
      p_created_from: null,
      p_created_before: null,
      p_actor_user_id: null,
      p_entity_type: null,
      p_action_type: null,
      p_search_text: null,
    });
  });

  it("serializes normalized filters to the exact expanded RPC parameters", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await listAuditLogPage({
      createdFrom: "2026-03-28T23:00:00.000Z",
      createdBefore: "2026-03-29T22:00:00.000Z",
      actorUserId: row.actor_user_id,
      entityType: " calendar_entry ",
      actionType: " calendar.created ",
      searchText: "  Actor event  ",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("list_audit_log_page", {
      p_limit: 50,
      p_before_created_at: null,
      p_before_id: null,
      p_created_from: "2026-03-28T23:00:00.000Z",
      p_created_before: "2026-03-29T22:00:00.000Z",
      p_actor_user_id: row.actor_user_id,
      p_entity_type: "calendar_entry",
      p_action_type: "calendar.created",
      p_search_text: "Actor event",
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

  it("strictly parses the narrow filter-options object", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        actors: [{ user_id: row.actor_user_id, full_name: row.actor_full_name }],
        entity_types: ["calendar_entry", "future_entity"],
        action_types: ["calendar.created", "future.changed"],
      },
      error: null,
    });
    await expect(getAuditLogFilterOptions()).resolves.toEqual({
      ok: true,
      value: {
        actors: [{ userId: row.actor_user_id, fullName: row.actor_full_name }],
        entityTypes: ["calendar_entry", "future_entity"],
        actionTypes: ["calendar.created", "future.changed"],
      },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("get_audit_log_filter_options");
  });

  it.each([
    ["missing top-level key", { actors: [], entity_types: [] }],
    ["extra top-level key", { actors: [], entity_types: [], action_types: [], email: [] }],
    ["sensitive actor field", {
      actors: [{ user_id: row.actor_user_id, full_name: row.actor_full_name, email: "hidden" }],
      entity_types: [], action_types: [],
    }],
    ["invalid actor", {
      actors: [{ user_id: "invalid", full_name: row.actor_full_name }],
      entity_types: [], action_types: [],
    }],
    ["duplicate entity", {
      actors: [], entity_types: ["project", "project"], action_types: [],
    }],
    ["blank action", { actors: [], entity_types: [], action_types: [" "] }],
  ])("fails safely for malformed filter options with %s", async (_label, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(getAuditLogFilterOptions()).resolves.toEqual({
      ok: false,
      error: {
        code: "archive_filter_options_failed",
        message: "Archive filter options could not be loaded.",
      },
    });
  });
});
