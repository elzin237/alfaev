import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAuditLogPage: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("./archiveService", async (importOriginal) => {
  const original = await importOriginal<typeof import("./archiveService")>();
  return { ...original, listAuditLogPage: mocks.listAuditLogPage };
});

import {
  archiveQueryKey,
  getNextArchivePageParam,
  useArchiveAuditLog,
} from "./archiveQuery";
import type { ArchiveAuditLogItem } from "./archiveService";

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
  return { ...renderHook(useArchiveAuditLog, { wrapper }), client };
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ profile: { id: "profile-1" } });
  mocks.listAuditLogPage.mockResolvedValue({ ok: true, value: [] });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Archive infinite query", () => {
  it("uses a profile-scoped key and computes keyset continuation only for full pages", () => {
    expect(archiveQueryKey("profile-1")).toEqual([
      "archive", "audit-log", "profile-1",
    ]);
    expect(archiveQueryKey("profile-1")).not.toEqual(archiveQueryKey("profile-2"));
    expect(getNextArchivePageParam(Array.from({ length: 49 }, (_, index) => item(index))))
      .toBeUndefined();
    const full = Array.from({ length: 50 }, (_, index) => item(index));
    expect(getNextArchivePageParam(full)).toEqual({
      createdAt: full[49]!.createdAt,
      auditLogId: full[49]!.auditLogId,
    });
    expect(getNextArchivePageParam([])).toBeUndefined();
  });

  it("loads first page once, uses its last row as cursor, and appends without refetching it", async () => {
    const first = Array.from({ length: 50 }, (_, index) => item(index));
    const second = [item(51), item(52)];
    mocks.listAuditLogPage
      .mockResolvedValueOnce({ ok: true, value: first })
      .mockResolvedValueOnce({ ok: true, value: second });
    const { result } = setup();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.listAuditLogPage).toHaveBeenNthCalledWith(1, null);
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => { await result.current.fetchNextPage(); });

    expect(mocks.listAuditLogPage).toHaveBeenNthCalledWith(2, {
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
