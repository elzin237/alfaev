import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const detailHookMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  hasPermission: vi.fn(),
  archiveSupplier: vi.fn(),
  getSupplier: vi.fn(),
  updateSupplier: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: detailHookMocks.useAuth,
}));
vi.mock("../../../app/auth/permissionService", () => ({
  hasPermission: detailHookMocks.hasPermission,
}));
vi.mock("../services/supplierService", () => ({
  archiveSupplier: detailHookMocks.archiveSupplier,
  getSupplier: detailHookMocks.getSupplier,
  updateSupplier: detailHookMocks.updateSupplier,
}));

import { useSupplierDetail } from "./useSupplierDetail";

const activeSupplier = {
  id: "supplier-1",
  name: "Bosch",
  country: "Germany",
  contactPersonName: null,
  contactPhone: null,
  contactEmail: null,
  isActive: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  archivedAt: null,
};

function renderDetailHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {
    ...renderHook(() => useSupplierDetail("supplier-1"), { wrapper }),
    queryClient,
  };
}

beforeEach(() => {
  detailHookMocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-user-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  detailHookMocks.hasPermission.mockResolvedValue({ ok: true, value: false });
  detailHookMocks.getSupplier.mockResolvedValue({
    ok: true,
    value: activeSupplier,
  });
  detailHookMocks.archiveSupplier.mockResolvedValue({
    ok: true,
    value: { supplierId: "supplier-1" },
  });
  detailHookMocks.updateSupplier.mockResolvedValue({
    ok: true,
    value: { supplierId: "supplier-1" },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useSupplierDetail", () => {
  it("lets Admin edit an active Supplier without a permission lookup", async () => {
    detailHookMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });
    const { result } = renderDetailHook();

    await waitFor(() => expect(result.current.canEdit).toBe(true));
    expect(result.current.canArchive).toBe(true);
    expect(detailHookMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("allows suppliers.edit and fails closed for denied or failed checks", async () => {
    detailHookMocks.hasPermission.mockResolvedValueOnce({ ok: true, value: true });
    const allowed = renderDetailHook();
    await waitFor(() => expect(allowed.result.current.canEdit).toBe(true));
    allowed.unmount();

    detailHookMocks.hasPermission.mockResolvedValueOnce({ ok: true, value: false });
    const denied = renderDetailHook();
    await waitFor(() => expect(detailHookMocks.hasPermission).toHaveBeenCalled());
    expect(denied.result.current.canEdit).toBe(false);
    denied.unmount();

    detailHookMocks.hasPermission.mockResolvedValueOnce({
      ok: false,
      error: { code: "permission_check_failed", message: "safe" },
    });
    const failed = renderDetailHook();
    await waitFor(() => expect(detailHookMocks.hasPermission).toHaveBeenCalled());
    expect(failed.result.current.canEdit).toBe(false);
  });

  it("does not expose edit while the permission lookup is unresolved", async () => {
    detailHookMocks.hasPermission.mockReturnValue(new Promise(() => undefined));
    const { result } = renderDetailHook();

    await waitFor(() => expect(result.current.supplierQuery.isSuccess).toBe(true));
    expect(result.current.canEdit).toBe(false);
  });

  it("keeps edit and archive permissions independent", async () => {
    detailHookMocks.hasPermission.mockImplementation((permission: string) =>
      Promise.resolve({
        ok: true,
        value: permission === "suppliers.archive",
      }));
    const archiveOnly = renderDetailHook();
    await waitFor(() => expect(archiveOnly.result.current.canArchive).toBe(true));
    expect(archiveOnly.result.current.canEdit).toBe(false);
    archiveOnly.unmount();

    detailHookMocks.hasPermission.mockImplementation((permission: string) =>
      Promise.resolve({
        ok: true,
        value: permission === "suppliers.edit",
      }));
    const editOnly = renderDetailHook();
    await waitFor(() => expect(editOnly.result.current.canEdit).toBe(true));
    expect(editOnly.result.current.canArchive).toBe(false);
  });

  it("fails archive visibility closed while its permission is pending or failed", async () => {
    detailHookMocks.hasPermission.mockImplementation((permission: string) => {
      if (permission === "suppliers.archive") {
        return new Promise(() => undefined);
      }

      return Promise.resolve({ ok: true, value: false });
    });
    const pending = renderDetailHook();
    await waitFor(() => expect(pending.result.current.supplierQuery.isSuccess).toBe(true));
    expect(pending.result.current.canArchive).toBe(false);
    pending.unmount();

    detailHookMocks.hasPermission.mockResolvedValue({
      ok: false,
      error: { code: "permission_check_failed", message: "safe" },
    });
    const failed = renderDetailHook();
    await waitFor(() => expect(detailHookMocks.hasPermission).toHaveBeenCalled());
    expect(failed.result.current.canArchive).toBe(false);
  });

  it("keeps archived Suppliers read-only even for Admin", async () => {
    detailHookMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });
    detailHookMocks.getSupplier.mockResolvedValue({
      ok: true,
      value: {
        ...activeSupplier,
        isActive: false,
        archivedAt: "2026-09-03T00:00:00.000Z",
      },
    });
    const { result } = renderDetailHook();

    await waitFor(() => expect(result.current.supplierQuery.isSuccess).toBe(true));
    expect(result.current.canEdit).toBe(false);
  });

  it("uses profile-scoped permission/detail keys and invalidates exact detail and list queries", async () => {
    detailHookMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    const { result, queryClient } = renderDetailHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.canEdit).toBe(true));

    expect(queryClient.getQueryState([
      "permission",
      "auth-user-1",
      "profile-1",
      "suppliers.edit",
    ])).toBeDefined();
    expect(queryClient.getQueryState([
      "suppliers",
      "detail",
      "profile-1",
      "supplier-1",
    ])).toBeDefined();

    await act(async () => {
      await result.current.update({
        name: "Bosch Rexroth",
        catalogNumber: "BR-26",
        description: null,
        country: "Germany",
        contactPersonName: null,
        contactPhone: null,
        contactEmail: null,
      });
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["suppliers", "detail", "profile-1", "supplier-1"],
      exact: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["suppliers", "list", "profile-1"],
      exact: true,
    });
  });

  it("does not invalidate either query after a failed update", async () => {
    detailHookMocks.updateSupplier.mockResolvedValue({
      ok: false,
      error: { code: "supplier_update_failed", message: "safe" },
    });
    const { result, queryClient } = renderDetailHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.supplierQuery.isSuccess).toBe(true));

    await act(async () => {
      await result.current.update({
        name: "Bosch",
        catalogNumber: "BOSCH-26",
        description: null,
        country: "Germany",
        contactPersonName: null,
        contactPhone: null,
        contactEmail: null,
      });
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("invalidates exact detail and list queries after successful archive only", async () => {
    const { result, queryClient } = renderDetailHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.supplierQuery.isSuccess).toBe(true));

    await act(async () => {
      await result.current.archive();
    });

    expect(detailHookMocks.archiveSupplier).toHaveBeenCalledWith("supplier-1");
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["suppliers", "detail", "profile-1", "supplier-1"],
      exact: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["suppliers", "list", "profile-1"],
      exact: true,
    });

    invalidateQueries.mockClear();
    detailHookMocks.archiveSupplier.mockResolvedValueOnce({
      ok: false,
      error: { code: "supplier_archive_failed", message: "safe" },
    });
    await act(async () => {
      await result.current.archive();
    });
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
