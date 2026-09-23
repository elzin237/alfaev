import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const detailMocks = vi.hoisted(() => ({
  getWorkOrderDetail: vi.fn(),
  hasPermission: vi.fn(),
  listWorkOrderProjectChoices: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: detailMocks.useAuth,
}));
vi.mock("../../../app/auth/permissionService", () => ({
  hasPermission: detailMocks.hasPermission,
}));
vi.mock("../services/workOrderService", () => ({
  getWorkOrderDetail: detailMocks.getWorkOrderDetail,
  isWorkOrderId: (value: unknown) =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  listWorkOrderProjectChoices: detailMocks.listWorkOrderProjectChoices,
}));

import { useWorkOrderDetail } from "./useWorkOrderDetail";

const workOrderId = "00000000-0000-4000-8000-000000000010";
const draftDetail = {
  id: workOrderId,
  workOrderNumber: "RN-2026-0042",
  status: "draft" as const,
  projectId: null,
  projectName: null,
  customerName: null,
  description: null,
  createdAt: "2026-09-22T09:00:00.000Z",
  updatedAt: "2026-09-22T09:00:00.000Z",
};

function renderDetailHook(id = workOrderId) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(() => useWorkOrderDetail(id), { wrapper }),
    queryClient,
  };
}

beforeEach(() => {
  detailMocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-user-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  detailMocks.getWorkOrderDetail.mockResolvedValue({
    ok: true,
    value: draftDetail,
  });
  detailMocks.hasPermission.mockResolvedValue({ ok: true, value: false });
  detailMocks.listWorkOrderProjectChoices.mockResolvedValue({
    ok: true,
    value: [],
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useWorkOrderDetail", () => {
  it("uses profile-scoped detail and Project-choice keys", async () => {
    detailMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    const { queryClient, result } = renderDetailHook();

    await waitFor(() => expect(result.current.canEditDraft).toBe(true));
    await waitFor(() => expect(
      detailMocks.listWorkOrderProjectChoices,
    ).toHaveBeenCalledOnce());
    expect(queryClient.getQueryState([
      "work-orders",
      "detail",
      "profile-1",
      workOrderId,
    ])).toBeDefined();
    expect(queryClient.getQueryState([
      "work-orders",
      "project-choices",
      "profile-1",
    ])).toBeDefined();
  });

  it("lets an active Admin edit a Draft and loads choices without permission lookup", async () => {
    detailMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });
    const { result } = renderDetailHook();

    await waitFor(() => expect(result.current.canEditDraft).toBe(true));
    await waitFor(() => expect(
      detailMocks.listWorkOrderProjectChoices,
    ).toHaveBeenCalledOnce());
    expect(detailMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("allows work_orders.edit_draft and fails closed for view-only permission", async () => {
    detailMocks.hasPermission.mockResolvedValueOnce({ ok: true, value: true });
    const editor = renderDetailHook();
    await waitFor(() => expect(editor.result.current.canEditDraft).toBe(true));
    expect(detailMocks.hasPermission).toHaveBeenCalledWith(
      "work_orders.edit_draft",
    );
    editor.unmount();
    detailMocks.hasPermission.mockClear();
    detailMocks.listWorkOrderProjectChoices.mockClear();

    detailMocks.hasPermission.mockResolvedValueOnce({ ok: true, value: false });
    const viewer = renderDetailHook();
    await waitFor(() => expect(detailMocks.hasPermission).toHaveBeenCalled());
    expect(viewer.result.current.canEditDraft).toBe(false);
    expect(detailMocks.listWorkOrderProjectChoices).not.toHaveBeenCalled();
  });

  it("does not fetch choices for a Finished Work Order", async () => {
    detailMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    detailMocks.getWorkOrderDetail.mockResolvedValue({
      ok: true,
      value: { ...draftDetail, status: "finished" },
    });
    const { result } = renderDetailHook();

    await waitFor(() => expect(result.current.detailQuery.isSuccess).toBe(true));
    expect(result.current.canEditDraft).toBe(false);
    expect(detailMocks.listWorkOrderProjectChoices).not.toHaveBeenCalled();
  });

  it("does not fetch detail or choices for an invalid ID", () => {
    const { result, queryClient } = renderDetailHook("not-a-uuid");

    expect(result.current.detailQuery.fetchStatus).toBe("idle");
    expect(detailMocks.getWorkOrderDetail).not.toHaveBeenCalled();
    expect(detailMocks.listWorkOrderProjectChoices).not.toHaveBeenCalled();
    expect(queryClient.getQueryState([
      "work-orders",
      "detail",
      "profile-1",
      "not-a-uuid",
    ])?.fetchStatus).toBe("idle");
  });

  it("does not fetch choices before detail resolves", async () => {
    detailMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    detailMocks.getWorkOrderDetail.mockReturnValue(new Promise(() => undefined));
    const { result } = renderDetailHook();

    await waitFor(() => expect(detailMocks.hasPermission).toHaveBeenCalled());
    expect(result.current.canEditDraft).toBe(false);
    expect(detailMocks.listWorkOrderProjectChoices).not.toHaveBeenCalled();
  });

  it("fails closed while permission is pending and after a missing detail result", async () => {
    detailMocks.hasPermission.mockReturnValueOnce(new Promise(() => undefined));
    const pendingPermission = renderDetailHook();
    await waitFor(() => expect(
      pendingPermission.result.current.detailQuery.isSuccess,
    ).toBe(true));
    expect(pendingPermission.result.current.canEditDraft).toBe(false);
    expect(detailMocks.listWorkOrderProjectChoices).not.toHaveBeenCalled();
    pendingPermission.unmount();

    detailMocks.hasPermission.mockClear();
    detailMocks.listWorkOrderProjectChoices.mockClear();
    detailMocks.hasPermission.mockResolvedValueOnce({ ok: true, value: true });
    detailMocks.getWorkOrderDetail.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "work_order_not_found",
        message: "The Work Order could not be found.",
      },
    });
    const missingDetail = renderDetailHook();
    await waitFor(() => expect(
      missingDetail.result.current.detailQuery.isSuccess,
    ).toBe(true));
    expect(missingDetail.result.current.canEditDraft).toBe(false);
    expect(detailMocks.listWorkOrderProjectChoices).not.toHaveBeenCalled();
  });

  it("fails closed for inactive and missing identities", () => {
    detailMocks.useAuth.mockReturnValueOnce({
      session: { user: { id: "auth-inactive" } },
      profile: { id: "profile-inactive", isActive: false },
      isAdmin: true,
    });
    const inactive = renderDetailHook();
    expect(inactive.result.current.canEditDraft).toBe(false);
    inactive.unmount();

    detailMocks.useAuth.mockReturnValueOnce({
      session: null,
      profile: null,
      isAdmin: false,
    });
    const missing = renderDetailHook();
    expect(missing.result.current.canEditDraft).toBe(false);
    expect(detailMocks.listWorkOrderProjectChoices).not.toHaveBeenCalled();
  });
});
