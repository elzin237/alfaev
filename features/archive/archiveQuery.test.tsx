import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuditLogDetail: vi.fn(),
  listAuditLogPage: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("./archiveService", async (importOriginal) => {
  const original = await importOriginal<typeof import("./archiveService")>();
  return {
    ...original,
    getAuditLogDetail: mocks.getAuditLogDetail,
    listAuditLogPage: mocks.listAuditLogPage,
  };
});

import {
  archiveFilterOptionsQueryKey,
  archiveDetailQueryKey,
  archiveQueryKey,
  getNextArchivePageParam,
  useArchiveAuditLog,
  useArchiveAuditDetail,
} from "./archiveQuery";
import type { ArchiveAuditLogItem } from "./archiveService";
import { EMPTY_ARCHIVE_FILTERS } from "./archiveFilters";
import type { ArchiveFilters } from "./archiveFilters";

function item(index: number): ArchiveAuditLogItem {
  return {
    auditLogId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    actorUserId: "00000000-0000-4000-8000-000000000099",
    actorFullName: "Archive Actor",
    actionType: "project.updated",
    entityType: "project",
    entityId: null,
    summary: `Summary ${index}`,
    createdAt: `2026-10-01T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
  };
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    ...renderHook(() => useArchiveAuditLog(EMPTY_ARCHIVE_FILTERS), { wrapper }),
    client,
  };
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ profile: { id: "profile-1" } });
  mocks.listAuditLogPage.mockResolvedValue({ ok: true, value: [] });
  mocks.getAuditLogDetail.mockResolvedValue({ ok: false, error: {
    code: "archive_detail_failed", message: "Safe",
  } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("Archive infinite query", () => {
  it("uses a profile-scoped key and computes keyset continuation only for full pages", () => {
    expect(archiveQueryKey("profile-1", EMPTY_ARCHIVE_FILTERS)).toEqual([
      "archive", "audit-log", "profile-1", null, null, null, null, null, null,
    ]);
    expect(archiveQueryKey("profile-1", EMPTY_ARCHIVE_FILTERS)).not.toEqual(
      archiveQueryKey("profile-2", EMPTY_ARCHIVE_FILTERS),
    );
    expect(archiveFilterOptionsQueryKey("profile-1")).toEqual([
      "archive", "filter-options", "profile-1",
    ]);
    expect(archiveDetailQueryKey("profile-1", item(1).auditLogId)).toEqual([
      "archive", "detail", "profile-1", item(1).auditLogId,
    ]);
    expect(archiveDetailQueryKey("profile-1", item(1).auditLogId)).not.toEqual(
      archiveDetailQueryKey("profile-2", item(1).auditLogId),
    );
    expect(getNextArchivePageParam(Array.from({ length: 49 }, (_, index) => item(index))))
      .toBeUndefined();
    const full = Array.from({ length: 50 }, (_, index) => item(index));
    expect(getNextArchivePageParam(full)).toEqual({
      createdAt: full[49]!.createdAt,
      auditLogId: full[49]!.auditLogId,
    });
    expect(getNextArchivePageParam([])).toBeUndefined();
  });

  it("loads detail lazily and scopes it to profile plus audit ID", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      ({ id }: { id: string | null }) => useArchiveAuditDetail(id),
      { wrapper, initialProps: { id: null as string | null } },
    );
    expect(mocks.getAuditLogDetail).not.toHaveBeenCalled();

    const auditLogId = item(1).auditLogId;
    mocks.getAuditLogDetail.mockResolvedValueOnce({ ok: true, value: {
      ...item(1),
      beforeData: null,
      afterData: null,
      metadata: null,
      detailAuthorized: true,
      targetViewAuthorized: false,
      contextKind: null,
      contextId: null,
    } });
    hook.rerender({ id: auditLogId });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(mocks.getAuditLogDetail).toHaveBeenCalledExactlyOnceWith(auditLogId);
    expect(hook.result.current.data?.auditLogId).toBe(auditLogId);
  });

  it("includes normalized filters in the identity and sends them on every page", async () => {
    const filters: ArchiveFilters = {
      createdFrom: "2026-01-01T00:00:00.000Z",
      createdBefore: "2026-02-01T00:00:00.000Z",
      actorUserId: "00000000-0000-4000-8000-000000000099",
      entityType: " project ",
      actionType: " project.updated ",
      searchText: "  alpha  ",
    };
    expect(archiveQueryKey("profile-1", filters)).toEqual([
      "archive", "audit-log", "profile-1",
      filters.createdFrom,
      filters.createdBefore,
      filters.actorUserId,
      "project",
      "project.updated",
      "alpha",
    ]);

    const first = Array.from({ length: 50 }, (_, index) => item(index));
    mocks.listAuditLogPage
      .mockResolvedValueOnce({ ok: true, value: first })
      .mockResolvedValueOnce({ ok: true, value: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useArchiveAuditLog(filters), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => { await result.current.fetchNextPage(); });
    const normalized = { ...filters, entityType: "project", actionType: "project.updated", searchText: "alpha" };
    expect(mocks.listAuditLogPage).toHaveBeenNthCalledWith(1, normalized, null);
    expect(mocks.listAuditLogPage).toHaveBeenNthCalledWith(2, normalized, {
      createdAt: first[49]!.createdAt,
      auditLogId: first[49]!.auditLogId,
    });
  });

  it("starts at a clean first page when filter identity changes", async () => {
    mocks.listAuditLogPage.mockResolvedValue({ ok: true, value: [item(1)] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const filtered = { ...EMPTY_ARCHIVE_FILTERS, entityType: "project" };
    const hook = renderHook(
      ({ filters }: { filters: ArchiveFilters }) => useArchiveAuditLog(filters),
      { wrapper, initialProps: { filters: EMPTY_ARCHIVE_FILTERS } },
    );
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    hook.rerender({ filters: filtered });
    await waitFor(() => expect(mocks.listAuditLogPage).toHaveBeenLastCalledWith(filtered, null));
    await waitFor(() => expect(hook.result.current.data?.pages).toEqual([[item(1)]]));
  });

  it("loads first page once, uses its last row as cursor, and appends without refetching it", async () => {
    const first = Array.from({ length: 50 }, (_, index) => item(index));
    const second = [item(51), item(52)];
    mocks.listAuditLogPage
      .mockResolvedValueOnce({ ok: true, value: first })
      .mockResolvedValueOnce({ ok: true, value: second });
    const { result } = setup();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.listAuditLogPage).toHaveBeenNthCalledWith(
      1,
      EMPTY_ARCHIVE_FILTERS,
      null,
    );
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => { await result.current.fetchNextPage(); });

    expect(mocks.listAuditLogPage).toHaveBeenNthCalledWith(2, {
      ...EMPTY_ARCHIVE_FILTERS,
    }, {
        createdAt: first[49]!.createdAt,
        auditLogId: first[49]!.auditLogId,
      });
    expect(mocks.listAuditLogPage).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.data?.pages).toEqual([first, second]));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("stops after an empty continuation for an exact-multiple dataset", async () => {
    const first = Array.from({ length: 50 }, (_, index) => item(index));
    mocks.listAuditLogPage
      .mockResolvedValueOnce({ ok: true, value: first })
      .mockResolvedValueOnce({ ok: true, value: [] });
    const { result } = setup();
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(result.current.data?.pages).toEqual([first, []]);
  });
});
